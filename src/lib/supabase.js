import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hamreqogmporpgdjglyn.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhbXJlcW9nbXBvcnBnZGpnbHluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDk5MTIsImV4cCI6MjA4ODAyNTkxMn0.5dziRHehoUfycKYUq52JOc8zYGdoF0g7wxT3Zux6dXk'

export const supabase = createClient(supabaseUrl, supabaseKey)
