/**
 * Shared clients + helpers for Phase A automation Edge Functions.
 *
 * Credentials live in `system_config` (service_role RLS) and are loaded once per
 * invocation. All HTTP calls use fetch with explicit error handling — no
 * swallowed failures.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

export function svcClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from env')
  return createClient(url, key)
}

export async function loadSecrets(sb: SupabaseClient) {
  const { data, error } = await sb.from('system_config').select('key,value').in('key', [
    'datarova_api_key', 'apify_api_token', 'anthropic_api_key'
  ])
  if (error) throw new Error(`Failed loading secrets: ${error.message}`)
  const m: Record<string, string> = {}
  for (const row of data || []) m[row.key] = row.value
  if (!m.datarova_api_key) throw new Error('datarova_api_key not in system_config')
  if (!m.apify_api_token) throw new Error('apify_api_token not in system_config')
  if (!m.anthropic_api_key) throw new Error('anthropic_api_key not in system_config')
  return m as { datarova_api_key: string; apify_api_token: string; anthropic_api_key: string }
}

// ── Datarova ─────────────────────────────────────────────────────────────
const DATAROVA_BASE = 'https://api.datarova.com/v0'

export interface DatarovaRecord { start_date?: string; clicks?: number; sales?: number; conversion_rate?: number }
export interface DatarovaKeyword { keyword: string; records: DatarovaRecord[] }

export async function datarovaKeywords(apiKey: string, opts: {
  keywords: string[]; start: string; end: string; marketplace?: string
}): Promise<DatarovaKeyword[]> {
  const url = new URL(`${DATAROVA_BASE}/keywords`)
  url.searchParams.set('marketplace', opts.marketplace || 'US')
  url.searchParams.set('keywords', opts.keywords.join(','))
  url.searchParams.set('start_date', opts.start)
  url.searchParams.set('end_date', opts.end)
  url.searchParams.set('interval', 'monthly')
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!res.ok) throw new Error(`Datarova ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json?.data?.keywords ?? []
}

export function firstOfMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

// ── Apify ────────────────────────────────────────────────────────────────
/**
 * Apify run-sync call. ONE retry on TIMED-OUT or 5xx (transient Apify errors).
 * Per-call timeout enforced via AbortController + Apify's own timeout param.
 */
export async function apifyRunSync(apiToken: string, actor: string, input: unknown, timeoutMs = 180_000): Promise<any[]> {
  const actorSlug = actor.replace('/', '~')
  const url = `https://api.apify.com/v2/acts/${actorSlug}/run-sync-get-dataset-items?token=${apiToken}&timeout=${Math.floor(timeoutMs / 1000)}`

  async function attempt(): Promise<{ ok: true; data: any[] } | { ok: false; retryable: boolean; error: string }> {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs + 5000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      })
      if (res.ok) {
        return { ok: true, data: await res.json() }
      }
      const body = (await res.text()).slice(0, 400)
      // TIMED-OUT (often transient — Apify runner overload) and 5xx are retryable
      const isTimedOut = body.includes('TIMED-OUT') || body.includes('timed-out')
      const isServerErr = res.status >= 500
      return {
        ok: false,
        retryable: isTimedOut || isServerErr,
        error: `${res.status}: ${body}`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, retryable: msg.includes('aborted') || msg.includes('network'), error: `network: ${msg}` }
    } finally {
      clearTimeout(t)
    }
  }

  const first = await attempt()
  if (first.ok) return first.data
  if (!first.retryable) throw new Error(`Apify ${actor} ${first.error}`)

  // ONE retry after brief pause
  console.warn(`Apify ${actor} ${first.error} — retrying once after 3s`)
  await new Promise(r => setTimeout(r, 3000))
  const second = await attempt()
  if (second.ok) return second.data
  throw new Error(`Apify ${actor} (after 1 retry) ${second.error}`)
}

// ── Anthropic ────────────────────────────────────────────────────────────
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'

export type AnthropicModel = 'claude-opus-4-5' | 'claude-sonnet-4-5' | 'claude-sonnet-4-7'
export const SONNET: AnthropicModel = 'claude-sonnet-4-5'
export const OPUS: AnthropicModel = 'claude-opus-4-5'

export interface AnthropicMessage { role: 'user' | 'assistant'; content: string | any[] }
export interface AnthropicOpts {
  model: AnthropicModel
  system?: string
  messages: AnthropicMessage[]
  max_tokens: number
  temperature?: number
  tools?: any[]
  thinking?: { type: 'enabled'; budget_tokens: number }
}

/**
 * Anthropic Messages API call with auto-retry on transient errors.
 *
 * Retry policy (added 2026-05-13 after Phase A runs failed from 429 rate limits
 * when 3 pipelines ran in parallel and overflowed the 30K Sonnet input-tokens/min cap):
 *  - 429 rate_limit_error: 3 attempts with 8s / 20s / 45s backoff (jittered)
 *  - 5xx server errors: 2 attempts with 3s / 10s backoff
 *  - 529 overloaded_error: same as 429
 *  - Network errors (fetch throws): 2 attempts with 2s / 5s backoff
 *  - Other 4xx (auth, bad request, content policy): no retry, throw immediately
 *
 * Max total retry time: 73s on rate limits + Anthropic call time. Caller's
 * Supabase wall-clock budget should be sized to account for one retry.
 */
export async function anthropicCall(apiKey: string, opts: AnthropicOpts): Promise<{ content: any[]; usage: any; stop_reason: string }> {
  const RATE_LIMIT_BACKOFFS = [8000, 20000, 45000]
  const SERVER_ERR_BACKOFFS = [3000, 10000]
  const NETWORK_ERR_BACKOFFS = [2000, 5000]

  let rateLimitAttempt = 0
  let serverErrAttempt = 0
  let networkErrAttempt = 0

  while (true) {
    let res: Response
    try {
      res = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(opts),
      })
    } catch (netErr) {
      const errMsg = netErr instanceof Error ? netErr.message : String(netErr)
      if (networkErrAttempt < NETWORK_ERR_BACKOFFS.length) {
        const wait = NETWORK_ERR_BACKOFFS[networkErrAttempt]
        console.warn(`anthropicCall network error (${errMsg}) — retry ${networkErrAttempt + 1} after ${wait}ms`)
        await new Promise(r => setTimeout(r, wait))
        networkErrAttempt++
        continue
      }
      throw new Error(`Anthropic network: ${errMsg}`)
    }

    if (res.ok) {
      const json = await res.json()
      // Surface truncation explicitly so callers can fail fast with a useful error
      // instead of throwing a confusing JSON.parse error on a half-written response.
      if (json.stop_reason === 'max_tokens') {
        throw new Error(`Anthropic response truncated at max_tokens (${opts.max_tokens}). Raise max_tokens or reduce output size.`)
      }
      return json
    }

    const body = (await res.text()).slice(0, 500)

    // 429 rate limit or 529 overloaded → retry with jittered exponential backoff
    if ((res.status === 429 || res.status === 529) && rateLimitAttempt < RATE_LIMIT_BACKOFFS.length) {
      const base = RATE_LIMIT_BACKOFFS[rateLimitAttempt]
      const jitter = Math.floor(Math.random() * (base * 0.25))
      const wait = base + jitter
      console.warn(`anthropicCall ${res.status} (rate limit/overloaded) — retry ${rateLimitAttempt + 1}/${RATE_LIMIT_BACKOFFS.length} after ${wait}ms`)
      await new Promise(r => setTimeout(r, wait))
      rateLimitAttempt++
      continue
    }

    // 5xx server error → brief retry
    if (res.status >= 500 && serverErrAttempt < SERVER_ERR_BACKOFFS.length) {
      const wait = SERVER_ERR_BACKOFFS[serverErrAttempt]
      console.warn(`anthropicCall ${res.status} server error — retry ${serverErrAttempt + 1} after ${wait}ms`)
      await new Promise(r => setTimeout(r, wait))
      serverErrAttempt++
      continue
    }

    // Non-retryable or retries exhausted
    throw new Error(`Anthropic ${res.status}: ${body}`)
  }
}

/** Extract clean text from Anthropic response, concatenating all text blocks. */
export function extractText(r: { content: any[] }): string {
  return r.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()
}

/**
 * Robust JSON extractor for LLM text output.
 *
 * Handles:
 *   1. Properly fenced ```json ... ``` blocks
 *   2. Half-fenced blocks (opening ```json with no closing fence — happens on
 *      truncated responses or when the model just forgets to close)
 *   3. Bare JSON with no fences
 *   4. Prose-prefixed JSON ("Here's the JSON: { ... }")
 *
 * Strategy: strip any leading ```json / ``` prefix, then balance-match braces
 * from the first { to find the JSON object boundary. This survives trailing
 * prose, partial closing fences, and truncated tails.
 */
export function extractJson<T = any>(text: string): T {
  let body = text.trim()

  // 1. Strip a leading ```json or ``` opener if present.
  body = body.replace(/^```(?:json)?\s*/i, '')
  // 2. Strip a trailing ``` closer if present.
  body = body.replace(/\s*```\s*$/i, '')
  body = body.trim()

  // Direct parse attempt — covers well-formed responses.
  try { return JSON.parse(body) } catch { /* fall through to brace match */ }

  // 3. Find the first { or [ and balance-match to the corresponding close.
  const startIdx = body.search(/[\{\[]/)
  if (startIdx === -1) throw new Error(`No JSON object/array found in response. Preview: ${body.slice(0, 200)}`)

  const open = body[startIdx]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escape = false
  let endIdx = -1
  for (let i = startIdx; i < body.length; i++) {
    const ch = body[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  if (endIdx === -1) {
    throw new Error(`JSON appears truncated — found opening '${open}' but no matching close. Preview: ${body.slice(0, 200)}…${body.slice(-200)}`)
  }
  return JSON.parse(body.slice(startIdx, endIdx + 1))
}

// ── Pending actions helpers ──────────────────────────────────────────────
export interface PendingAction {
  id: string
  entity_type: 'idea' | 'concept'
  entity_id: string
  action: string
  status: string
  context: Record<string, any>
  notes?: string
}

export async function setActionStatus(
  sb: SupabaseClient, actionId: string,
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled',
  patch: { notes?: string; context_merge?: Record<string, any> } = {}
) {
  const updates: Record<string, any> = { status }
  // Fetch current row so we can:
  //   1. Set started_at only on the FIRST transition to in_progress (not on every
  //      context-merge call — used to overwrite started_at every step of the run,
  //      corrupting elapsed-time math).
  //   2. Clear completed_at when going back to in_progress (re-entry after a
  //      previous completion / failure — needed for retries).
  //   3. Merge context server-side without losing prior keys.
  const { data: cur } = await sb.from('pending_actions').select('started_at, completed_at, context').eq('id', actionId).single()
  if (status === 'in_progress') {
    if (!cur?.started_at) updates.started_at = new Date().toISOString()
    if (cur?.completed_at) updates.completed_at = null
  }
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updates.completed_at = new Date().toISOString()
  }
  if (patch.notes !== undefined) updates.notes = patch.notes
  if (patch.context_merge) {
    updates.context = { ...(cur?.context || {}), ...patch.context_merge }
  }
  await sb.from('pending_actions').update(updates).eq('id', actionId)
}

/**
 * Self-invoke the next Edge Function in the Phase A chain.
 *
 * TRUE fire-and-forget via pg_net (2026-05-13 v4 — the one that actually works).
 *
 * History:
 *  - v1: `await fetch(...)` — blocked caller for the full invoked-function
 *        runtime. Caller hit 150s wall clock waiting for response.
 *  - v2: EdgeRuntime.waitUntil(fetch). Bound caller lifetime to fetch's full
 *        response; if caller hit wall clock first, Deno aborted the in-flight
 *        fetch and the target function never even spawned.
 *  - v3: AbortController-based dispatch with 2s race. Same root issue — Deno
 *        cancels in-flight fetches when the function exits, and Supabase
 *        appears to tie spawned-function lifetime to the connection.
 *  - v4 (current): pg_net.http_post via Postgres RPC. The request is enqueued
 *        in postgres background workers and fired without any client-side
 *        connection holding it open. Decoupled from Deno's lifecycle entirely.
 *        The Edge Function returns after a single RPC call (~50-100ms).
 *
 * Requires: dispatch_edge_function() RPC must exist in the Supabase project
 * (migration 2026-05-13_add_dispatch_edge_function_via_pg_net).
 */
export async function invokeFunction(name: string, body: Record<string, any>) {
  const sb = svcClient()
  // The RPC reads the anon JWT from Vault internally via get_internal_auth_header(),
  // matching the proven pattern used by all the other Supabase crons in this project.
  // No need to pass the key through this layer.
  const { error } = await sb.rpc('dispatch_edge_function', {
    p_function_name: name,
    p_body: body,
  })
  if (error) {
    throw new Error(`invokeFunction(${name}) via pg_net RPC failed: ${error.message}`)
  }
}
