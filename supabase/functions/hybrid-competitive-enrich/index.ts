const KEEPA_BASE = 'https://api.keepa.com'
const KEEPA_DOMAIN_US = 1
const ASIN_RE = /^[A-Z0-9]{10}$/

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function statValue(stats: any, key: 'current' | 'avg30' | 'avg90', idx: number): number | null {
  const arr = stats?.[key]
  if (!Array.isArray(arr)) return null
  const value = arr[idx]
  if (value === -1 || value === -2 || value === 0 || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function priceFromCents(value: number | null): number | null {
  return value === null ? null : Math.round(value) / 100
}

function normalizeProduct(raw: any) {
  const stats = raw.stats || {}
  const ratingRaw = statValue(stats, 'current', 16)
  const monthlySold = Number(raw.monthlySold || 0) || null
  return {
    asin: String(raw.asin || '').toUpperCase(),
    parent_asin: raw.parentAsin || raw.parent || null,
    title: String(raw.title || '').slice(0, 320),
    brand: String(raw.brand || raw.manufacturer || '').slice(0, 120),
    price: priceFromCents(
      statValue(stats, 'current', 18) ||
      statValue(stats, 'current', 1) ||
      statValue(stats, 'avg30', 18) ||
      statValue(stats, 'avg30', 1),
    ),
    rating: ratingRaw === null ? null : Math.round(ratingRaw) / 10,
    reviews: statValue(stats, 'current', 17),
    monthly_sold: monthlySold,
    bsr_current: statValue(stats, 'current', 3),
    bsr_avg30: statValue(stats, 'avg30', 3),
    bsr_avg90: statValue(stats, 'avg90', 3),
    sales_signal_source: monthlySold ? 'keepa_monthlySold_badge' : 'keepa_bsr_only',
  }
}

async function keepaGet(path: string, params: Record<string, string | number>, apiKey: string) {
  const url = new URL(`${KEEPA_BASE}${path}`)
  url.searchParams.set('key', apiKey)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const res = await fetch(url.toString())
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = json?.error?.message || json?.error?.type || JSON.stringify(json).slice(0, 300)
    throw new Error(`Keepa ${path} ${res.status}: ${detail}`)
  }
  return json
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const apiKey = Deno.env.get('KEEPA_API_KEY')
    if (!apiKey) throw new Error('KEEPA_API_KEY env var is not available')
    const body = await req.json().catch(() => ({}))
    const asins = Array.from(new Set((body.asins || [])
      .map((asin: unknown) => String(asin || '').toUpperCase())
      .filter((asin: string) => ASIN_RE.test(asin))))
      .slice(0, 50)
    if (!asins.length) throw new Error('No valid ASINs supplied')

    const products: any[] = []
    let tokensConsumed = 0
    for (let i = 0; i < asins.length; i += 20) {
      const chunk = asins.slice(i, i + 20)
      const result = await keepaGet('/product', {
        domain: KEEPA_DOMAIN_US,
        asin: chunk.join(','),
        stats: 90,
        history: 0,
        rating: 1,
      }, apiKey)
      tokensConsumed += Number(result.tokensConsumed || 0)
      products.push(...(result.products || []).map(normalizeProduct))
    }

    return new Response(JSON.stringify({
      ok: true,
      source: 'keepa_product_api',
      source_version: 'hybrid-competitive-enrich-v1',
      tokens_consumed: tokensConsumed,
      products,
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
})
