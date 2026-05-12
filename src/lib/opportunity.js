export function normalizeIdeaName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(supplements?|capsules?|powders?|gumm(y|ies)|tablets?|softgels?|liquid|organic|pure|natural|for women|for men|for kids)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatNumber(value) {
  const n = Number(value || 0)
  if (!n) return '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

export function formatGrowth(value) {
  if (value === null || value === undefined) return '-'
  const pct = Number(value) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%`
}

export function formatUsd(value) {
  if (value === null || value === undefined) return '-'
  return `$${Number(value).toFixed(2)}`
}

function formatScore(review) {
  return review?.toniiq_fit_score === null || review?.toniiq_fit_score === undefined
    ? 'not assigned'
    : `${review.toniiq_fit_score}/100`
}

export function buildOpportunityPrompt({ candidate, snapshot, review }) {
  return [
    `Review this Toniiq product opportunity: ${candidate?.ingredient_name || snapshot?.customer_need || 'Untitled idea'}.`,
    '',
    'Start ritual:',
    '1. Read CLAUDE.md in Product Development.',
    '2. Treat POE/Datarova/Amazon numbers as Tier 1 source-backed data. Do not invent missing market numbers.',
    '3. Use the app/Supabase context first, then local files only if this moves into development.',
    '',
    `Current review status: ${review?.status || 'not reviewed'}`,
    `Priority: ${review?.priority || 'unassigned'}`,
    `Strategic/review score: ${formatScore(review)}`,
    `Signal type: ${review?.signal_type || 'not assigned'}`,
    `Signal tags: ${(review?.signal_tags || []).join(', ') || 'none'}`,
    review?.source_context ? `Source context:\n${review.source_context}` : null,
    '',
    'POE context:',
    `- Customer need: ${snapshot?.customer_need || candidate?.ingredient_name || 'n/a'}`,
    `- Top terms: ${[snapshot?.top_search_term_1, snapshot?.top_search_term_2, snapshot?.top_search_term_3].filter(Boolean).join(', ') || 'n/a'}`,
    `- 90d search volume: ${formatNumber(snapshot?.search_volume_90d)}`,
    `- 90d growth: ${formatGrowth(snapshot?.search_volume_growth_90d)}`,
    `- 180d growth: ${formatGrowth(snapshot?.search_volume_growth_180d)}`,
    `- Avg price: ${formatUsd(snapshot?.avg_price_usd)}`,
    `- POE import date: ${snapshot?.import_date || 'n/a'}`,
    '',
    'Strategic question:',
    review?.next_action || 'Is there a real Toniiq opportunity here, or is this just noisy market movement?',
    '',
    'Output wanted:',
    '- Clear go / watch / reject recommendation',
    '- The Toniiq product thesis if there is one',
    '- The exact next research action',
    '- Any missing evidence marked as pending',
  ].filter(Boolean).join('\n')
}
