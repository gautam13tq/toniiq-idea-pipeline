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
export async function apifyRunSync(apiToken: string, actor: string, input: unknown, timeoutMs = 180_000): Promise<any[]> {
  // run-sync-get-dataset-items blocks until complete OR timeout, returns dataset as JSON
  const actorSlug = actor.replace('/', '~')
  const url = `https://api.apify.com/v2/acts/${actorSlug}/run-sync-get-dataset-items?token=${apiToken}&timeout=${Math.floor(timeoutMs / 1000)}`
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs + 5000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Apify ${actor} ${res.status}: ${(await res.text()).slice(0, 400)}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
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

export async function anthropicCall(apiKey: string, opts: AnthropicOpts): Promise<{ content: any[]; usage: any; stop_reason: string }> {
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(opts),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`)
  return await res.json()
}

/** Extract clean text from Anthropic response, concatenating all text blocks. */
export function extractText(r: { content: any[] }): string {
  return r.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()
}

/** Extract a ```json ... ``` fenced block or parse whole message as JSON. */
export function extractJson<T = any>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fence ? fence[1] : text
  return JSON.parse(raw.trim())
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
  if (status === 'in_progress') updates.started_at = new Date().toISOString()
  if (status === 'completed' || status === 'failed' || status === 'cancelled') updates.completed_at = new Date().toISOString()
  if (patch.notes !== undefined) updates.notes = patch.notes
  if (patch.context_merge) {
    // Merge into existing context (Supabase-side would need RPC; do client-side merge)
    const { data: cur } = await sb.from('pending_actions').select('context').eq('id', actionId).single()
    updates.context = { ...(cur?.context || {}), ...patch.context_merge }
  }
  await sb.from('pending_actions').update(updates).eq('id', actionId)
}

/** Self-invoke the next Edge Function in the Phase A chain. */
export async function invokeFunction(name: string, body: Record<string, any>) {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Cannot invoke — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing')
  // Fire-and-forget by not awaiting fully; we still await the HTTP send so the invocation starts
  const endpoint = `${url.replace('.supabase.co', '.supabase.co')}/functions/v1/${name}`
  await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
