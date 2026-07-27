import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hamreqogmporpgdjglyn.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhbXJlcW9nbXBvcnBnZGpnbHluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDk5MTIsImV4cCI6MjA4ODAyNTkxMn0.5dziRHehoUfycKYUq52JOc8zYGdoF0g7wxT3Zux6dXk'

// The shared warehouse project intermittently returns edge 5xx (502/503/504)
// under heavy ETL load. Retry transient gateway errors (and network blips) with
// short backoff so they surface as a brief delay rather than a stuck/empty
// screen. Real responses (including 4xx and Postgres 5xx) are returned unretried.
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
