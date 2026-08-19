import { createClient } from '@supabase/supabase-js'

// Dedicated NPD project (toniiq-npd, ref gmfndxaoeztxohbbkudu). Migrated off the
// shared warehouse project (hamreqogmporpgdjglyn) on 2026-08-19 to isolate the app
// from warehouse ETL churn and schema-cache pressure.
const supabaseUrl = 'https://gmfndxaoeztxohbbkudu.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtZm5keGFvZXp0eG9oYmJrdWR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDU3ODMsImV4cCI6MjEwMjcyMTc4M30.U_t8nwIrEfROL7a4aBBC08jFj6gJuZ2B1fV_2kUumeU'

// Retry transient edge 5xx (502/503/504) and network blips with short backoff so
// they surface as a brief delay rather than a stuck/empty screen. Real responses
// (including 4xx and Postgres 5xx) are returned unretried. Kept as defensive
// hardening even on the dedicated project.
async function fetchWithRetry(input, init, attempt = 0) {
  try {
    const res = await fetch(input, init)
    if ([502, 503, 504].includes(res.status) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
      return fetchWithRetry(input, init, attempt + 1)
    }
    return res
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
      return fetchWithRetry(input, init, attempt + 1)
    }
    throw err
  }
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: fetchWithRetry },
})

// PostgREST caps unranged selects at 1000 rows, which silently truncates
// universe tables (poe_snapshots is already past the cap). Page through with
// .range() until a short page signals the end. buildQuery must return a fresh
// query each call, with a deterministic order so pages don't overlap.
const PAGE_SIZE = 1000

export async function fetchAllRows(buildQuery) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
    if (error) return { data: null, error }
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null }
  }
}
