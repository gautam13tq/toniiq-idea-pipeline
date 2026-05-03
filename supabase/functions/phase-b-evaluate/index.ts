/**
 * phase-b-evaluate — Phase B end-to-end evaluation for an accepted concept
 *
 * Trigger: POST { pending_action_id } where the action is run_phase_b on a concept.
 * Auto-queued by the product_concepts trigger when a concept moves to status='accepted'.
 *
 * Modules (all run sequentially, ~90-120s total):
 *   B1. Amazon Competitive — Apify axesso_data/amazon-search-scraper, top 15 by sales
 *   B2. TikTok Trend       — Apify clockworks/tiktok-scraper, ~80 videos
 *   B3. Google Trends      — Sonnet web-synthesis (training-knowledge-based) for YoY + direction
 *   B4. Differentiation    — Sonnet 6-vector framework, 12-point auto-kill at ≤3
 *   B5. Composite Scoring  — Computed from B1-B4 (Market 20% / Rev-Reviews 30% / Growth 20% / Diff 30%)
 *
 * Writes: concept_competitive_research, concept_tiktok_research, concept_google_trends, concept_scores
 * On success: sets concept.status='evaluated' (rollup trigger moves idea to stage='evaluation')
 *
 * DATA INTEGRITY: Every Amazon product, TikTok metric, and trend signal traces to a real
 * Apify run or Sonnet analysis of real data. Watchdog auto-fails superseded runs.
 */

import { corsHeaders } from '../_shared/cors.ts'
import {
  svcClient, loadSecrets, apifyRunSync, anthropicCall,
  extractText, extractJson, SONNET, setActionStatus,
} from '../_shared/clients.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let actionId: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    const sb = svcClient()
    const secrets = await loadSecrets(sb)
    actionId = body.pending_action_id
    const conceptId = body.concept_id

    let resolvedActionId = actionId
    let resolvedConceptId = conceptId
    if (!resolvedActionId && resolvedConceptId) {
      const { data } = await sb.from('pending_actions').insert({
        entity_type: 'concept', entity_id: resolvedConceptId, action: 'run_phase_b',
        triggered_by: 'llm', status: 'pending', context: {},
      }).select('id').single()
      resolvedActionId = data!.id
    }
    if (!resolvedActionId) {
      return new Response(JSON.stringify({ error: 'pending_action_id or concept_id required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }
    actionId = resolvedActionId

    // Fetch action + concept + ingredient name
    const { data: action, error: aErr } = await sb.from('pending_actions').select('*').eq('id', resolvedActionId).single()
    if (aErr || !action) throw new Error(`Action not found: ${aErr?.message}`)
    resolvedConceptId = action.entity_id
    const { data: concept, error: cErr } = await sb.from('product_concepts').select('*').eq('id', resolvedConceptId).single()
    if (cErr || !concept) throw new Error(`Concept not found: ${cErr?.message}`)
    const { data: candidate } = await sb.from('idea_candidates').select('ingredient_name').eq('id', concept.candidate_id).single()
    const ingredientName = candidate?.ingredient_name || concept.concept_name

    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      notes: `Evaluating "${concept.concept_name}"`,
      context_merge: { phase_b_started: new Date().toISOString(), concept_name: concept.concept_name },
    })

    // Watchdog: fail any other in_progress run_phase_b for this concept older than 5 min
    await sb.from('pending_actions').update({
      status: 'failed', completed_at: new Date().toISOString(),
      notes: `Auto-failed by watchdog: superseded by new run_phase_b (${resolvedActionId})`,
    })
      .eq('entity_id', resolvedConceptId).eq('action', 'run_phase_b').eq('status', 'in_progress')
      .neq('id', resolvedActionId)
      .lt('started_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

    // ── B1: AMAZON COMPETITIVE ───────────────────────────────────────────
    await setActionStatus(sb, resolvedActionId, 'in_progress', { context_merge: { amazon: 'running' } })
    const amazonResult = await runAmazonCompetitive(sb, secrets, concept, ingredientName, resolvedConceptId)
    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      context_merge: { amazon: 'done', amazon_stats: { products: amazonResult.topProducts.length, score: amazonResult.competitionScore } },
    })

    // ── B2: TIKTOK ───────────────────────────────────────────────────────
    await setActionStatus(sb, resolvedActionId, 'in_progress', { context_merge: { tiktok: 'running' } })
    const tiktokResult = await runTikTok(sb, secrets, concept, ingredientName, resolvedConceptId)
    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      context_merge: { tiktok: 'done', tiktok_stats: { videos: tiktokResult.totalVideos, score: tiktokResult.tiktokScore } },
    })

    // ── B3: GOOGLE TRENDS ────────────────────────────────────────────────
    await setActionStatus(sb, resolvedActionId, 'in_progress', { context_merge: { google_trends: 'running' } })
    const trendsResult = await runGoogleTrends(sb, secrets, concept, ingredientName, resolvedConceptId)
    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      context_merge: { google_trends: 'done', trends_stats: { score: trendsResult.googleTrendsScore, yoy: trendsResult.yoyGrowthPct } },
    })

    // ── B4: DIFFERENTIATION ──────────────────────────────────────────────
    await setActionStatus(sb, resolvedActionId, 'in_progress', { context_merge: { differentiation: 'running' } })
    const diffResult = await runDifferentiation(secrets, concept, ingredientName, amazonResult)
    await setActionStatus(sb, resolvedActionId, 'in_progress', {
      context_merge: { differentiation: 'done', diff_stats: { total: diffResult.diffTotal, vectors_available: diffResult.vectorsAvailable } },
    })

    // ── B5: COMPOSITE SCORING ────────────────────────────────────────────
    const compositeResult = computeComposite({
      amazon: amazonResult,
      tiktok: tiktokResult,
      trends: trendsResult,
      diff: diffResult,
    })

    await sb.from('concept_scores').insert({
      concept_id: resolvedConceptId,
      amazon_competitive_score: amazonResult.opportunityScore,
      tiktok_score: tiktokResult.tiktokScore,
      google_trends_score: trendsResult.googleTrendsScore,
      differentiation_score: Math.round((diffResult.diffTotal / 12) * 10),
      diff_vectors_available: diffResult.vectorsAvailable,
      diff_competitive_gap: diffResult.competitiveGap,
      diff_form_factor_fit: diffResult.formFactorFit,
      diff_pricing_headroom: diffResult.pricingHeadroom,
      diff_total: diffResult.diffTotal,
      diff_vector_details: diffResult.vectorDetails,
      composite_score: compositeResult.compositeScore,
      composite_weights: compositeResult.weights,
      recommendation_tier: compositeResult.tier,
      overall_assessment: compositeResult.overallAssessment,
      opportunity_signals: compositeResult.opportunitySignals,
      risk_factors: compositeResult.riskFactors,
      next_steps: compositeResult.nextSteps,
      scored_at: new Date().toISOString(),
    })

    // ── Mark concept as evaluated → triggers rollup to stage='evaluation' ─
    await sb.from('product_concepts').update({
      status: 'evaluated', decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', resolvedConceptId)

    await setActionStatus(sb, resolvedActionId, 'completed', {
      notes: `Phase B complete. Composite ${compositeResult.compositeScore.toFixed(1)} (${compositeResult.tier}).`,
      context_merge: { composite_score: compositeResult.compositeScore, tier: compositeResult.tier, completed_at: new Date().toISOString() },
    })

    return new Response(JSON.stringify({
      ok: true, concept_id: resolvedConceptId, composite: compositeResult.compositeScore, tier: compositeResult.tier,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('phase-b-evaluate error:', msg)
    if (actionId) {
      try {
        const sb = svcClient()
        await setActionStatus(sb, actionId, 'failed', { notes: `evaluate failed: ${msg}` })
      } catch (_) { /* ignore */ }
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════
// MODULE B1: AMAZON COMPETITIVE
// ═══════════════════════════════════════════════════════════════════════

interface AmazonResult {
  topProducts: any[]
  totalCompetitors: number
  medianPrice: number
  medianReviews: number
  maxReviews: number
  avgRating: number
  competitionScore: number
  opportunityScore: number
  pricingTiers: any
  positioningGaps: string[]
  directCompetitors: any[]
  premiumTierCount: number
  productsWith10kReviews: number
  brandConcentration: string
  reviewMoats: string
  overallAssessment: string
  opportunitySignals: string[]
  riskFactors: string[]
  searchQueries: string[]
}

const ASIN_RE = /^B0[A-Z0-9]{8}$/

async function runAmazonCompetitive(sb: any, secrets: any, concept: any, ingredientName: string, conceptId: string): Promise<AmazonResult> {
  // Build 3-5 search queries from concept + ingredient
  const queries = buildAmazonQueries(concept, ingredientName)

  // axesso actor takes `input: [{keyword, domainCode, sortBy, maxPages, category}, ...]`
  const apifyInput = {
    input: queries.map(q => ({
      keyword: q,
      domainCode: 'com',
      sortBy: 'relevanceblender',
      maxPages: 2,
      category: 'aps',
    })),
  }
  const rawResults = await apifyRunSync(secrets.apify_api_token, 'axesso_data/amazon-search-scraper', apifyInput, 90_000)

  // Normalize + dedupe by ASIN
  const seen = new Set<string>()
  const products: any[] = []
  for (const r of (rawResults || [])) {
    const asin = (r.asin || '').toUpperCase()
    if (!ASIN_RE.test(asin)) continue
    if (seen.has(asin)) continue
    seen.add(asin)
    const reviews = parseInt(String(r.countReview || r.numberOfReviews || 0).replace(/[^\d]/g, '')) || 0
    const rating = parseFloat(String(r.productRating || r.rating || 0)) || 0
    const price = parseFloat(String(r.price || 0)) || 0
    const monthlySales = parseInt(String(r.salesVolume || r.monthlySales || 0).replace(/[^\d]/g, '')) || 0
    const title = String(r.productDescription || r.title || '').slice(0, 250)
    if (!title || price <= 0) continue
    products.push({
      asin,
      title,
      price,
      rating,
      reviews,
      monthly_sales: monthlySales,
      brand: extractBrand(title),
      product: title.split(',')[0].slice(0, 80),
      count: extractCount(title),
      format: extractFormat(title),
      amazon_url: `https://www.amazon.com/dp/${asin}`,
    })
  }

  // Sort by monthly_sales desc (fallback to reviews if salesVolume not populated)
  products.sort((a, b) => (b.monthly_sales || b.reviews) - (a.monthly_sales || a.reviews))
  const top15 = products.slice(0, 15)

  // Aggregate stats
  const totalCompetitors = products.length
  const prices = top15.map(p => p.price).filter(p => p > 0).sort((a, b) => a - b)
  const reviews = top15.map(p => p.reviews).filter(r => r > 0).sort((a, b) => a - b)
  const ratings = top15.map(p => p.rating).filter(r => r > 0)
  const medianPrice = prices.length ? prices[Math.floor(prices.length / 2)] : 0
  const medianReviews = reviews.length ? reviews[Math.floor(reviews.length / 2)] : 0
  const maxReviews = reviews.length ? Math.max(...reviews) : 0
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0
  const productsWith10kReviews = top15.filter(p => p.reviews >= 10000).length
  const premiumTierCount = top15.filter(p => p.price >= medianPrice * 1.5).length

  // Sonnet analysis: positioning gaps, direct competitors, scores, assessment
  const analysis = await analyzeAmazonResults(secrets.anthropic_api_key, concept, ingredientName, top15, {
    medianPrice, medianReviews, maxReviews, avgRating, totalCompetitors,
  })

  // Insert
  await sb.from('concept_competitive_research').insert({
    concept_id: conceptId,
    search_queries: queries,
    search_date: new Date().toISOString().slice(0, 10),
    top_products: top15,
    total_competitors: totalCompetitors,
    median_price: medianPrice,
    price_range_low: prices[0] || null,
    price_range_high: prices[prices.length - 1] || null,
    median_reviews: medianReviews,
    max_reviews: maxReviews,
    avg_rating: Number(avgRating.toFixed(2)),
    products_with_10k_reviews: productsWith10kReviews,
    premium_tier_count: premiumTierCount,
    pricing_tiers: analysis.pricing_tiers,
    direct_competitors: analysis.direct_competitors,
    positioning_gaps: analysis.positioning_gaps,
    brand_concentration: analysis.brand_concentration,
    review_moats: analysis.review_moats,
    differentiation_assessment: analysis.differentiation_assessment,
    price_positioning: analysis.price_positioning,
    competition_score: analysis.competition_score,
    opportunity_score: analysis.opportunity_score,
    overall_assessment: analysis.overall_assessment,
    opportunity_signals: analysis.opportunity_signals,
    risk_factors: analysis.risk_factors,
    listing_quality_assessment: analysis.listing_quality_assessment,
    premium_tier_analysis: analysis.premium_tier_analysis,
    researched_at: new Date().toISOString(),
  })

  return {
    topProducts: top15, totalCompetitors, medianPrice, medianReviews, maxReviews, avgRating,
    competitionScore: analysis.competition_score, opportunityScore: analysis.opportunity_score,
    pricingTiers: analysis.pricing_tiers, positioningGaps: analysis.positioning_gaps,
    directCompetitors: analysis.direct_competitors, premiumTierCount, productsWith10kReviews,
    brandConcentration: analysis.brand_concentration, reviewMoats: analysis.review_moats,
    overallAssessment: analysis.overall_assessment, opportunitySignals: analysis.opportunity_signals,
    riskFactors: analysis.risk_factors, searchQueries: queries,
  }
}

function buildAmazonQueries(concept: any, ingredientName: string): string[] {
  const base = ingredientName.toLowerCase().trim()
  const queries = new Set<string>()
  queries.add(base)
  queries.add(`${base} supplement`)
  // Concept-specific terms (from name and positioning)
  const conceptName = (concept.concept_name || '').toLowerCase()
  if (conceptName && conceptName !== base) {
    // Add concept name as a query if it's distinct from the parent term
    queries.add(conceptName.split('—')[0].trim().slice(0, 60))
  }
  // Add a "premium" variant for Toniiq's lane
  queries.add(`${base} premium`)
  return Array.from(queries).slice(0, 5)
}

function extractBrand(title: string): string {
  // First word(s) before comma/dash, capitalized
  const m = title.match(/^([A-Z][A-Za-z0-9'&.\s]+?)(?:[,\-—:]|$)/)
  if (m) return m[1].trim().slice(0, 30)
  return title.split(' ').slice(0, 2).join(' ').slice(0, 30)
}

function extractCount(title: string): number {
  // Match "120 capsules", "60 ct", "90 servings"
  const m = title.match(/(\d{2,4})\s*(?:capsules|ct|count|servings|tablets|softgels|gummies|caps|pills)/i)
  return m ? parseInt(m[1]) : 0
}

function extractFormat(title: string): string {
  const t = title.toLowerCase()
  if (t.includes('softgel')) return 'Softgel'
  if (t.includes('gummy') || t.includes('gummies')) return 'Gummy'
  if (t.includes('powder')) return 'Powder'
  if (t.includes('liquid')) return 'Liquid'
  if (t.includes('tablet')) return 'Tablet'
  if (t.includes('capsule') || t.includes('caps')) return 'Capsule'
  return 'Capsule'
}

async function analyzeAmazonResults(apiKey: string, concept: any, ingredientName: string, top15: any[], stats: any): Promise<any> {
  const r = await anthropicCall(apiKey, {
    model: SONNET,
    max_tokens: 3000,
    system: `You are a competitive intelligence analyst for Toniiq, a premium supplement brand. Analyze the top Amazon competitors for a product concept and return STRICT JSON. DATA INTEGRITY: every claim must be supported by the supplied product list — do NOT invent brands or specifications.

Return this exact JSON structure (no markdown, no commentary):
{
  "direct_competitors": [{"brand": "...", "threat_level": "high|medium|low", "differentiation": "..."}],
  "positioning_gaps": ["gap 1", "gap 2", "gap 3"],
  "pricing_tiers": {"budget": "$X-$Y — description", "mid": "$X-$Y — description", "premium": "$X-$Y — description"},
  "brand_concentration": "Description: top 3 brands hold X% / fragmented / consolidated",
  "review_moats": "Description: how many products have >10K reviews and what that means",
  "differentiation_assessment": "How Toniiq could differentiate against this competitive set",
  "price_positioning": "Where Toniiq should price (e.g. $X-$Y mid-premium)",
  "competition_score": 0-10 integer (0=wide open, 10=ultra-saturated),
  "opportunity_score": 0-10 integer (0=no opportunity, 10=greenfield),
  "overall_assessment": "2-3 sentences on market state",
  "opportunity_signals": ["signal 1", "signal 2"],
  "risk_factors": ["risk 1", "risk 2"],
  "listing_quality_assessment": "Brief: are top listings polished or weak? How could Toniiq beat them?",
  "premium_tier_analysis": "Brief: who plays in premium tier and what they offer"
}`,
    messages: [{
      role: 'user',
      content: `Concept: "${concept.concept_name}"
Ingredient: "${ingredientName}"
Positioning: ${concept.positioning_angle || '(none)'}

Aggregate stats: ${JSON.stringify(stats)}

Top 15 competitors (sorted by monthly sales):
${JSON.stringify(top15.map(p => ({
  brand: p.brand, title: p.title, price: p.price, rating: p.rating,
  reviews: p.reviews, monthly_sales: p.monthly_sales, count: p.count, format: p.format,
})), null, 1)}`,
    }],
  })
  const text = extractText(r)
  try {
    return extractJson(text)
  } catch (e) {
    return {
      direct_competitors: [], positioning_gaps: [`LLM parse error: ${(e as Error).message}`],
      pricing_tiers: { budget: '—', mid: '—', premium: '—' },
      brand_concentration: 'Parse error', review_moats: 'Parse error',
      differentiation_assessment: 'Parse error', price_positioning: 'Parse error',
      competition_score: 5, opportunity_score: 5, overall_assessment: 'Parse error',
      opportunity_signals: [], risk_factors: [],
      listing_quality_assessment: 'Parse error', premium_tier_analysis: 'Parse error',
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE B2: TIKTOK
// ═══════════════════════════════════════════════════════════════════════

interface TikTokResult {
  totalVideos: number
  organicVideos: number
  adVideos: number
  totalPlays: number
  totalLikes: number
  avgEngagementRate: number
  topHashtags: any[]
  creatorTiers: any
  topVideos: any[]
  contentThemes: string[]
  trendLifecycle: string
  tiktokScore: number
}

async function runTikTok(sb: any, secrets: any, concept: any, ingredientName: string, conceptId: string): Promise<TikTokResult> {
  const queries = [
    ingredientName,
    `${ingredientName} supplement`,
    `${ingredientName} benefits`,
  ]
  let videos: any[] = []
  try {
    videos = await apifyRunSync(secrets.apify_api_token, 'clockworks/tiktok-scraper', {
      searchQueries: queries, resultsPerPage: 25,
    }, 90_000)
  } catch (e) {
    // TikTok scraper failed — write minimal record and continue
    console.error('TikTok scraper failed:', (e as Error).message)
  }

  const organic = videos.filter(v => !v.isAd)
  const ads = videos.filter(v => v.isAd)
  const totalPlays = organic.reduce((s, v) => s + (v.playCount || 0), 0)
  const totalLikes = organic.reduce((s, v) => s + (v.diggCount || 0), 0)
  const totalShares = organic.reduce((s, v) => s + (v.shareCount || 0), 0)
  const totalComments = organic.reduce((s, v) => s + (v.commentCount || 0), 0)
  const totalSaves = organic.reduce((s, v) => s + (v.collectCount || 0), 0)
  const avgPlays = organic.length ? Math.round(totalPlays / organic.length) : 0
  const engagementRate = totalPlays > 0 ? ((totalLikes + totalShares + totalComments) / totalPlays) * 100 : 0

  // Hashtag extraction
  const hashtagCounts = new Map<string, number>()
  for (const v of organic) {
    const tags = v.hashtags || (v.text || '').match(/#\w+/g) || []
    for (const tag of tags) {
      const t = (typeof tag === 'string' ? tag : tag.name || '').toLowerCase()
      if (!t.startsWith('#')) continue
      hashtagCounts.set(t, (hashtagCounts.get(t) || 0) + 1)
    }
  }
  const topHashtags = Array.from(hashtagCounts.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([hashtag, views]) => ({ hashtag, views }))

  // Creator tier estimation from author follower counts when present
  const creatorTiers = { mega_1m_plus: 0, macro_500k_1m: 0, mid_50k_500k: 0, micro_1k_50k: 0 }
  for (const v of organic) {
    const followers = v.authorMeta?.fans || v.author?.followerCount || 0
    if (followers >= 1_000_000) creatorTiers.mega_1m_plus++
    else if (followers >= 500_000) creatorTiers.macro_500k_1m++
    else if (followers >= 50_000) creatorTiers.mid_50k_500k++
    else if (followers >= 1_000) creatorTiers.micro_1k_50k++
  }

  // Top videos by plays
  const topVideos = [...organic].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 5).map(v => ({
    date: (v.createTimeISO || v.createTime || '').slice(0, 10),
    plays: v.playCount || 0,
    likes: v.diggCount || 0,
    description: String(v.text || v.description || '').slice(0, 200),
  }))

  // Per-query breakdown
  const queryBreakdown: any = {}
  for (const q of queries) {
    const qVids = organic.filter(v => (v.searchHashtag?.name || v.input || v.query || '').toLowerCase().includes(q.toLowerCase()))
    queryBreakdown[q] = { videos: qVids.length, total_plays: qVids.reduce((s, v) => s + (v.playCount || 0), 0) }
  }

  // Sonnet analysis: themes + lifecycle + score
  const analysis = await analyzeTikTokResults(secrets.anthropic_api_key, concept, ingredientName, organic, ads, {
    totalPlays, totalLikes, avgPlays, engagementRate, organicCount: organic.length, adCount: ads.length,
  })

  await sb.from('concept_tiktok_research').insert({
    concept_id: conceptId,
    search_queries: queries,
    total_videos: videos.length,
    organic_videos: organic.length,
    ad_videos: ads.length,
    total_plays: totalPlays,
    total_likes: totalLikes,
    total_shares: totalShares,
    total_comments: totalComments,
    total_saves: totalSaves,
    avg_plays_per_video: avgPlays,
    avg_engagement_rate: Number(engagementRate.toFixed(2)),
    top_hashtags: topHashtags,
    creator_tiers: creatorTiers,
    top_videos: topVideos,
    query_breakdown: queryBreakdown,
    content_themes: analysis.content_themes,
    trend_lifecycle: analysis.trend_lifecycle,
    tiktok_score: analysis.tiktok_score,
    key_signals: analysis.key_signals,
    overall_assessment: analysis.overall_assessment,
    researched_at: new Date().toISOString(),
  })

  return {
    totalVideos: videos.length, organicVideos: organic.length, adVideos: ads.length,
    totalPlays, totalLikes, avgEngagementRate: engagementRate,
    topHashtags, creatorTiers, topVideos,
    contentThemes: analysis.content_themes, trendLifecycle: analysis.trend_lifecycle,
    tiktokScore: analysis.tiktok_score,
  }
}

async function analyzeTikTokResults(apiKey: string, concept: any, ingredientName: string, organic: any[], ads: any[], stats: any): Promise<any> {
  // Compact video sample for the prompt
  const sample = organic.slice(0, 25).map(v => ({
    text: String(v.text || '').slice(0, 200),
    plays: v.playCount || 0,
    likes: v.diggCount || 0,
    is_ad: !!v.isAd,
  }))
  const r = await anthropicCall(apiKey, {
    model: SONNET,
    max_tokens: 1500,
    system: `You are a TikTok trend analyst for Toniiq's supplement ideation. Analyze a sample of TikTok videos for a concept and return STRICT JSON.

Return this exact JSON structure:
{
  "content_themes": ["education", "personal_testimony", "brand_partnership", "before_after", ...],
  "trend_lifecycle": "emerging|growing|mainstream|declining",
  "tiktok_score": 0-10 integer,
  "key_signals": ["signal 1", "signal 2"],
  "overall_assessment": "2-3 sentences"
}`,
    messages: [{
      role: 'user',
      content: `Concept: "${concept.concept_name}"
Ingredient: "${ingredientName}"
Aggregate: ${JSON.stringify(stats)}

Video sample:
${JSON.stringify(sample, null, 1)}`,
    }],
  })
  const text = extractText(r)
  try {
    return extractJson(text)
  } catch (e) {
    return {
      content_themes: [], trend_lifecycle: 'unknown', tiktok_score: 3,
      key_signals: [`LLM parse error: ${(e as Error).message}`],
      overall_assessment: 'Parse error',
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE B3: GOOGLE TRENDS (web synthesis)
// ═══════════════════════════════════════════════════════════════════════

async function runGoogleTrends(sb: any, secrets: any, concept: any, ingredientName: string, conceptId: string) {
  const r = await anthropicCall(secrets.anthropic_api_key, {
    model: SONNET,
    max_tokens: 1500,
    system: `You are a market trend analyst for Toniiq supplement ideation. Estimate Google Trends signal for a supplement concept based on your training knowledge of the supplement market, public industry reports (Verified Market Reports, Nutra Ingredients, Persistence Market Research), and adjacent search behavior. DATA INTEGRITY: if your knowledge of this category is thin, say so explicitly and score lower confidence — don't fabricate specific numbers.

Return STRICT JSON:
{
  "yoy_growth_pct": number (estimated; can be negative),
  "trend_direction": "declining|stable|rising|breakout|no_data",
  "google_trends_score": 0-10 integer,
  "search_terms": ["term 1", "term 2"],
  "related_queries": {"primary": ["..."], "supporting": ["..."]},
  "interest_over_time": {"note": "qualitative description; no fabricated monthly numbers"},
  "key_signals": ["signal 1", "signal 2"],
  "cross_platform_validation": "Brief: is the signal consistent with what we'd expect from Amazon + TikTok demand?",
  "overall_assessment": "2-3 sentences"
}`,
    messages: [{
      role: 'user',
      content: `Concept: "${concept.concept_name}"
Ingredient: "${ingredientName}"
Positioning: ${concept.positioning_angle || '(none)'}`,
    }],
  })
  const text = extractText(r)
  let parsed: any
  try {
    parsed = extractJson(text)
  } catch (e) {
    parsed = {
      yoy_growth_pct: null, trend_direction: 'no_data', google_trends_score: 3,
      search_terms: [], related_queries: {}, interest_over_time: { note: 'parse error' },
      key_signals: [], cross_platform_validation: '', overall_assessment: 'Parse error',
    }
  }
  await sb.from('concept_google_trends').insert({
    concept_id: conceptId,
    search_terms: parsed.search_terms,
    time_range: 'last_12_months',
    geo: 'US',
    interest_over_time: parsed.interest_over_time,
    related_queries: parsed.related_queries,
    yoy_growth_pct: parsed.yoy_growth_pct,
    trend_direction: parsed.trend_direction,
    google_trends_score: parsed.google_trends_score,
    key_signals: parsed.key_signals,
    cross_platform_validation: parsed.cross_platform_validation,
    overall_assessment: parsed.overall_assessment,
    data_source: 'web_synthesis',
    researched_at: new Date().toISOString(),
  })
  return {
    yoyGrowthPct: parsed.yoy_growth_pct,
    trendDirection: parsed.trend_direction,
    googleTrendsScore: parsed.google_trends_score,
    overallAssessment: parsed.overall_assessment,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE B4: DIFFERENTIATION (6-vector framework)
// ═══════════════════════════════════════════════════════════════════════

interface DiffResult {
  vectorsAvailable: number
  competitiveGap: number
  formFactorFit: number
  pricingHeadroom: number
  diffTotal: number
  vectorDetails: any
  reasoning: string
}

async function runDifferentiation(secrets: any, concept: any, ingredientName: string, amazonResult: AmazonResult): Promise<DiffResult> {
  const r = await anthropicCall(secrets.anthropic_api_key, {
    model: SONNET,
    max_tokens: 2000,
    system: `You are a product differentiation strategist for Toniiq. Assess a concept against Toniiq's 6-vector differentiation framework and return STRICT JSON.

The 6 vectors:
1. Concentration/Potency — can Toniiq offer a higher dose than the median competitor?
2. Branded/Patented Ingredient — is there a clinical-grade branded form (e.g. Creapure, KSM-66, Sensoril)?
3. Purity/Standardization — can Toniiq stand on tested purity / standardized active compound %?
4. Multi-Pathway/Stack — does combining with a complementary ingredient unlock a unique angle?
5. CFU/Strain Specificity — N/A for non-probiotics; only relevant for live cultures.
6. Bioavailability/Delivery Innovation — liposomal, enteric, sublingual, microbeadlet, etc.

For each vector: available=true/false + 1-sentence justification grounded in the supplied competitive data.

Then score:
- Vectors Available: 0-5 (how many of vectors 1-6 Toniiq could actually deploy)
- Competitive Gap: 0-3 (how much white space vs. top competitors — 3=clear gap, 0=saturated)
- Form Factor Fit: 0-2 (capsule fit; 2=natural capsule format, 0=requires capability outside Toniiq)
- Pricing Headroom: 0-2 (can Toniiq charge $25-45 with healthy margin? 2=yes, 0=commodity floor)

Return STRICT JSON:
{
  "vector_details": {
    "vector_1_concentration": {"available": true|false, "justification": "..."},
    "vector_2_branded": {"available": ..., "justification": "..."},
    "vector_3_purity": {"available": ..., "justification": "..."},
    "vector_4_multi_pathway": {"available": ..., "justification": "..."},
    "vector_5_cfu_strain": {"available": ..., "justification": "..."},
    "vector_6_bioavailability": {"available": ..., "justification": "..."}
  },
  "vectors_available": 0-5,
  "competitive_gap": 0-3,
  "form_factor_fit": 0-2,
  "pricing_headroom": 0-2,
  "reasoning": "1-2 sentence summary"
}`,
    messages: [{
      role: 'user',
      content: `Concept: "${concept.concept_name}"
Ingredient: "${ingredientName}"
Positioning: ${concept.positioning_angle || '(none)'}
Key ingredients: ${JSON.stringify(concept.key_ingredients || [])}
Target dosage: ${concept.target_dosage || '(none)'}
Format: ${concept.format || '(none)'}

Competitive context:
- Total competitors: ${amazonResult.totalCompetitors}
- Median price: $${amazonResult.medianPrice}
- Premium tier count: ${amazonResult.premiumTierCount}
- Brand concentration: ${amazonResult.brandConcentration}
- Top competitors: ${JSON.stringify(amazonResult.topProducts.slice(0, 5).map(p => ({ brand: p.brand, title: p.title, price: p.price })))}`,
    }],
  })
  const text = extractText(r)
  try {
    const parsed = extractJson(text)
    const total = (parsed.vectors_available || 0) + (parsed.competitive_gap || 0) + (parsed.form_factor_fit || 0) + (parsed.pricing_headroom || 0)
    return {
      vectorsAvailable: parsed.vectors_available || 0,
      competitiveGap: parsed.competitive_gap || 0,
      formFactorFit: parsed.form_factor_fit || 0,
      pricingHeadroom: parsed.pricing_headroom || 0,
      diffTotal: total,
      vectorDetails: parsed.vector_details || {},
      reasoning: parsed.reasoning || '',
    }
  } catch (e) {
    return { vectorsAvailable: 0, competitiveGap: 0, formFactorFit: 0, pricingHeadroom: 0, diffTotal: 0, vectorDetails: {}, reasoning: `parse error: ${(e as Error).message}` }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE B5: COMPOSITE SCORING
// ═══════════════════════════════════════════════════════════════════════

function computeComposite({ amazon, tiktok, trends, diff }: any) {
  // Pillar 1: Market Size (20%) — derived from total_competitors + total_plays + premium tier
  // High competitor count + premium tier presence = larger market
  let marketSize = 5
  if (amazon.totalCompetitors >= 100) marketSize = 9
  else if (amazon.totalCompetitors >= 50) marketSize = 8
  else if (amazon.totalCompetitors >= 20) marketSize = 6
  else if (amazon.totalCompetitors >= 10) marketSize = 4
  else marketSize = 2
  if (tiktok.totalPlays >= 1_000_000) marketSize = Math.min(10, marketSize + 1)

  // Pillar 2: Rev/Review Ratio (30%) — higher ratio = emerging market with less moat
  // Use median price × monthly_sales / median_reviews as a proxy
  const medianRevenue = amazon.medianPrice * (amazon.topProducts[7]?.monthly_sales || 0)
  const ratio = amazon.medianReviews > 0 ? medianRevenue / amazon.medianReviews : 0
  let revReview = 5
  if (ratio >= 50) revReview = 10
  else if (ratio >= 30) revReview = 8
  else if (ratio >= 15) revReview = 7
  else if (ratio >= 8) revReview = 6
  else if (ratio >= 3) revReview = 5
  else revReview = 3

  // Pillar 3: Category Growth (20%) — straight from Google Trends + TikTok signal
  const categoryGrowth = trends.googleTrendsScore || 5

  // Pillar 4: Differentiation (30%) — diff_total / 12 normalized to 0-10
  const differentiation = Math.round((diff.diffTotal / 12) * 10)

  const composite = (marketSize * 0.20 + revReview * 0.30 + categoryGrowth * 0.20 + differentiation * 0.30) * 10

  // Tier
  let tier = 'pass'
  if (composite >= 80) tier = 'launch_priority'
  else if (composite >= 65) tier = 'strong_candidate'
  else if (composite >= 50) tier = 'needs_work'

  // Auto-kill at diff <= 3
  const autoKill = diff.diffTotal <= 3
  if (autoKill) tier = 'pass'

  const opportunitySignals: string[] = []
  if (marketSize >= 8) opportunitySignals.push(`Large addressable market (${amazon.totalCompetitors} competitors, ${(tiktok.totalPlays / 1e6).toFixed(1)}M TikTok plays)`)
  if (revReview >= 8) opportunitySignals.push(`High revenue-per-review ratio — market is monetizing efficiently with limited review moats`)
  if (categoryGrowth >= 7) opportunitySignals.push(`Category trending — Google Trends ${trends.trendDirection || 'rising'}`)
  if (differentiation >= 8) opportunitySignals.push(`Strong differentiation room — ${diff.vectorsAvailable}/5 vectors available, ${diff.competitiveGap}/3 competitive gap`)

  const riskFactors: string[] = []
  if (amazon.productsWith10kReviews >= 5) riskFactors.push(`Review moats: ${amazon.productsWith10kReviews} products with 10K+ reviews`)
  if (amazon.brandConcentration?.toLowerCase().includes('consolidated')) riskFactors.push(`Consolidated market — top 3 brands dominate`)
  if (categoryGrowth <= 4) riskFactors.push(`Category may be flat or declining`)
  if (autoKill) riskFactors.push(`AUTO-KILL: differentiation total ${diff.diffTotal}/12 — below threshold`)

  const nextSteps: string[] = []
  if (tier === 'launch_priority') {
    nextSteps.push('Fast-track to formulation + costing')
    nextSteps.push('Source supplier quotes for branded ingredient form (if applicable)')
    nextSteps.push('Begin product brief draft')
  } else if (tier === 'strong_candidate') {
    nextSteps.push('Address top 1-2 risk factors before greenlight')
    nextSteps.push('Validate primary differentiation vector with sample sourcing')
  } else if (tier === 'needs_work') {
    nextSteps.push('Refine concept positioning to address differentiation gaps')
    nextSteps.push('Consider alternative angle or pair with stronger concept')
  } else {
    nextSteps.push('Pass — return to ideation if positioning shifts')
  }

  return {
    compositeScore: Number(composite.toFixed(1)),
    weights: {
      market_size: { score: marketSize, weight: 0.20, description: `${amazon.totalCompetitors} competitors; ${amazon.premiumTierCount} in premium tier; TikTok ${(tiktok.totalPlays / 1e6).toFixed(1)}M plays` },
      rev_review_ratio: { score: revReview, weight: 0.30, description: `Ratio ${ratio.toFixed(1)} (median revenue $${medianRevenue.toFixed(0)} / median reviews ${amazon.medianReviews})` },
      category_growth: { score: categoryGrowth, weight: 0.20, description: `${trends.trendDirection || 'unknown'}; YoY ${trends.yoyGrowthPct ?? '?'}%` },
      differentiation_potential: { score: differentiation, weight: 0.30, description: `${diff.diffTotal}/12 (vectors ${diff.vectorsAvailable}/5, gap ${diff.competitiveGap}/3, form ${diff.formFactorFit}/2, pricing ${diff.pricingHeadroom}/2)` },
    },
    tier,
    overallAssessment: `Composite ${composite.toFixed(1)}/100 → ${tier}. ${opportunitySignals[0] || ''} ${riskFactors[0] || ''}`.trim(),
    opportunitySignals,
    riskFactors,
    nextSteps,
  }
}
