import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function formatNumber(n) {
  if (!n && n !== 0) return '—'
  if (typeof n === 'string') n = parseFloat(n)
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatPct(n) {
  if (!n && n !== 0) return '—'
  const v = typeof n === 'string' ? parseFloat(n) : n
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

/* ─────────────────────────────────────────────
   Renders a JSONB array of objects as a table
   ───────────────────────────────────────────── */
function JsonTable({ data, columns }) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No data</p>
  }

  // Auto-detect columns from the first item if not provided
  const cols = columns || Object.keys(data[0]).filter(k => k !== 'keywords' && k !== 'total_sales')

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottomColor: 'var(--border-default)' }} className="border-b">
            {cols.map(col => (
              <th key={col} className="text-left py-2 px-3 font-medium text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {col.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={{ borderBottomColor: 'var(--border-default)' }} className="border-b" onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'} onMouseLeave={e => e.currentTarget.style.background = ''}>
              {cols.map(col => {
                let val = row[col]
                if (val === null || val === undefined) val = '—'
                else if (typeof val === 'number') {
                  if (col.includes('pct') || col.includes('conversion') || col.includes('growth')) val = formatPct(val)
                  else if (col.includes('clicks') || col.includes('sales')) val = formatNumber(val)
                  else val = val.toLocaleString()
                }
                else if (Array.isArray(val)) val = val.join(', ')
                else if (typeof val === 'object') val = JSON.stringify(val)
                return (
                  <td key={col} className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{String(val)}</td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* Renders a JSONB array of strings as bullet points */
function BulletList({ items }) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No data</p>
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5" style={{ color: 'var(--text-faint)' }}>•</span>
          <span style={{ color: 'var(--text-body)' }}>
            {typeof item === 'object' ? (item.text || item.name || item.need || item.pain_point || item.use_case || item.format || item.brand || JSON.stringify(item)) : String(item)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* Smart render for JSONB — objects become tables or structured cards */
function SmartRender({ data, label }) {
  if (!data) return null

  if (Array.isArray(data)) {
    if (data.length === 0) return null

    // If items are strings → bullet list
    if (typeof data[0] === 'string') {
      return (
        <div className="mb-4">
          {label && <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>{label}</h4>}
          <BulletList items={data} />
        </div>
      )
    }

    // If items are objects → try table
    if (typeof data[0] === 'object') {
      return (
        <div className="mb-4">
          {label && <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>{label}</h4>}
          <div className="rounded-lg p-3 border" style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border-default)' }}>
            <JsonTable data={data} />
          </div>
        </div>
      )
    }
  }

  if (typeof data === 'string') {
    return (
      <div className="mb-4">
        {label && <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-body)' }}>{label}</h4>}
        <p className="text-sm" style={{ color: 'var(--text-body)' }}>{data}</p>
      </div>
    )
  }

  return null
}

export default function DiscoveryPage() {
  const { candidateId } = useParams()
  const navigate = useNavigate()
  const [candidate, setCandidate] = useState(null)
  const [datarova, setDatarova] = useState(null)
  const [redditResearch, setRedditResearch] = useState(null)
  const [scienceResearch, setScienceResearch] = useState(null)
  const [concepts, setConcepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('keyword')
  const [enrichmentJob, setEnrichmentJob] = useState(null)

  useEffect(() => {
    loadData()
  }, [candidateId])

  // Poll for enrichment completion and auto-reload data
  useEffect(() => {
    if (!enrichmentJob || enrichmentJob.status === 'completed' || enrichmentJob.status === 'failed') return
    const interval = setInterval(async () => {
      const { data } = await supabase.from('enrichment_jobs')
        .select('*').eq('id', enrichmentJob.id).single()
      if (data) {
        setEnrichmentJob(data)
        if (data.status === 'completed') {
          clearInterval(interval)
          // Reload discovery data
          loadData()
        }
        if (data.status === 'failed') clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [enrichmentJob?.id, enrichmentJob?.status])

  async function loadData() {
    setLoading(true)
    try {
      // Load candidate
      const { data: candidateData, error: candidateError } = await supabase
        .from('idea_candidates')
        .select('*')
        .eq('id', candidateId)
        .single()
      if (candidateError) throw candidateError
      setCandidate(candidateData)

      // Load all data sources in parallel
      const [datarovaRes, redditRes, scienceRes, linksRes] = await Promise.all([
        supabase.from('datarova_enrichments').select('*').eq('candidate_id', candidateId).maybeSingle(),
        supabase.from('reddit_concept_research').select('*').eq('candidate_id', candidateId).maybeSingle(),
        supabase.from('science_concept_research').select('*').eq('candidate_id', candidateId).maybeSingle(),
        // Use junction table to find ALL concepts linked to this ingredient (primary + secondary)
        supabase.from('concept_ingredient_links').select('concept_id').eq('candidate_id', candidateId),
      ])

      if (datarovaRes.data) setDatarova(datarovaRes.data)
      if (redditRes.data) setRedditResearch(redditRes.data)
      if (scienceRes.data) setScienceResearch(scienceRes.data)

      // Load the actual concept details for linked concepts
      const conceptIds = (linksRes.data || []).map(l => l.concept_id)
      if (conceptIds.length > 0) {
        const { data: conceptsData } = await supabase
          .from('product_concepts')
          .select('id, concept_name, confidence_score, status, positioning_angle, concept_type, format')
          .in('id', conceptIds)
          .order('confidence_score', { ascending: false })
        setConcepts(conceptsData || [])
      } else {
        // Fallback: direct candidate_id match
        const { data: conceptsData } = await supabase
          .from('product_concepts')
          .select('id, concept_name, confidence_score, status, positioning_angle, concept_type, format')
          .eq('candidate_id', candidateId)
          .order('confidence_score', { ascending: false })
        setConcepts(conceptsData || [])
      }
      // Also check for enrichment jobs
      const { data: jobData } = await supabase.from('enrichment_jobs')
        .select('*').eq('candidate_id', candidateId)
        .order('created_at', { ascending: false }).limit(1)
      if (jobData?.[0]) setEnrichmentJob(jobData[0])

    } catch (err) {
      console.error('Error loading discovery data:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>
        </div>
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderBottomColor: 'var(--text-muted)' }}></div>
            <p style={{ color: 'var(--text-muted)' }}>Loading ingredient discovery...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!candidate) {
    return (
      <div className="min-h-screen">
        <div className="px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>
        </div>
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <p style={{ color: 'var(--text-muted)' }}>Ingredient not found</p>
            <Link to="/concepts" className="mt-2 inline-block transition-colors" style={{ color: 'var(--blue)' }}>Back to concepts</Link>
          </div>
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'keyword', label: 'Keyword Data', icon: '📊', hasData: !!datarova },
    { id: 'reddit', label: 'Reddit Research', icon: '💬', hasData: !!redditResearch },
    { id: 'science', label: 'Science Research', icon: '🧪', hasData: !!scienceResearch },
    { id: 'concepts', label: 'Product Concepts', icon: '💡', hasData: concepts.length > 0, count: concepts.length },
  ]

  return (
    <div className="min-h-screen">
      {/* Page Header */}
      <div className="px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <Link
          to="/"
          className="text-sm font-medium mb-2 flex items-center gap-1 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          ← Discovery
        </Link>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          {candidate.ingredient_name}
        </h1>
        {candidate.category && (
          <span className="text-xs mt-1 inline-block px-2 py-0.5 rounded" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>
            {candidate.category}
          </span>
        )}
      </div>

      <div className="px-6 py-8">
        <button
          onClick={() => navigate(-1)}
          className="text-sm font-medium mb-6 flex items-center gap-1 transition-colors"
          style={{ color: 'var(--blue)' }}
        >
          ← Back
        </button>

        {/* Header section */}
        <div className="rounded-lg p-8 mb-8 border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{candidate.ingredient_name}</h1>
              <div className="flex items-center gap-3">
                {candidate.category && (
                  <span className="text-sm px-3 py-1 rounded-full" style={{ backgroundColor: 'var(--bg-active)', color: 'var(--text-body)' }}>
                    {candidate.category}
                  </span>
                )}
                {concepts.length > 0 && (
                  <span className="text-sm px-3 py-1 rounded-full border" style={{ backgroundColor: 'var(--blue-muted)', color: 'var(--blue-text)', borderColor: 'rgba(96,165,250,0.2)' }}>
                    {concepts.length} concept{concepts.length !== 1 ? 's' : ''} generated
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-4">
              {datarova && (
                <div className="rounded-lg p-4 text-center" style={{ backgroundColor: 'var(--bg-hover)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Keyword Score</p>
                  <p className="text-3xl font-bold" style={{ color: 'var(--blue-text)' }}>{datarova.datarova_deep_score || '—'}</p>
                </div>
              )}
              {redditResearch && (
                <div className="rounded-lg p-4 text-center" style={{ backgroundColor: 'var(--bg-hover)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Reddit Score</p>
                  <p className="text-3xl font-bold" style={{ color: 'var(--amber-text)' }}>{redditResearch.reddit_score || '—'}<span className="text-lg" style={{ color: 'var(--text-muted)' }}>/10</span></p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Enrichment In Progress Banner */}
        {enrichmentJob && (enrichmentJob.status === 'pending' || enrichmentJob.status === 'running') && (
          <div className="rounded-lg p-5 mb-8 border" style={{ background: 'var(--blue-muted)', borderColor: 'rgba(96,165,250,0.3)' }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2" style={{ borderColor: 'var(--blue)' }} />
              <h3 className="text-base font-semibold" style={{ color: 'var(--blue-text)' }}>
                Generating Discovery Report for {candidate.ingredient_name}...
              </h3>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Running keyword analysis, Reddit research, science review, and concept synthesis. This usually takes 1-2 minutes.
            </p>
            <div className="flex gap-2">
              {['datarova', 'reddit', 'science', 'concepts'].map(step => {
                const completed = enrichmentJob.steps_completed || []
                const isCurrent = enrichmentJob.current_step === step
                const isDone = completed.some(s => s === step || s.startsWith(step + '_'))
                const isFailed = completed.some(s => s === step + '_failed')
                return (
                  <div key={step} className="flex-1 rounded-lg px-3 py-2 text-center" style={{
                    background: isDone && !isFailed ? 'var(--green-muted)' : isCurrent ? 'rgba(96,165,250,0.15)' : isFailed ? 'var(--red-muted)' : 'var(--bg-active)',
                    color: isDone && !isFailed ? 'var(--green-text)' : isCurrent ? 'var(--blue-text)' : isFailed ? 'var(--red-text)' : 'var(--text-faint)',
                  }}>
                    <div className="text-lg mb-1">
                      {isDone && !isFailed ? '✓' : isCurrent ? '◉' : isFailed ? '✗' : '○'}
                    </div>
                    <div className="text-xs font-medium">
                      {step === 'datarova' ? 'Keywords' : step === 'reddit' ? 'Reddit' : step === 'science' ? 'Science' : 'Concepts'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-8">
          <div className="mb-6 border-b" style={{ borderBottomColor: 'var(--border-default)' }}>
            <div className="flex gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-3 font-medium border-b-2 transition-colors flex items-center gap-2 ${!tab.hasData ? 'opacity-50' : ''}`}
                  style={{
                    borderBottomColor: activeTab === tab.id ? 'var(--accent)' : 'transparent',
                    color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                  onMouseEnter={(e) => {
                    if (activeTab !== tab.id) {
                      e.target.style.color = 'var(--text-primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== tab.id) {
                      e.target.style.color = 'var(--text-muted)';
                    }
                  }}
                >
                  <span>{tab.icon}</span>
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-active)', color: 'var(--text-body)' }}>{tab.count}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg p-6 border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
            {/* ── KEYWORD TAB ── */}
            {activeTab === 'keyword' && (
              datarova ? (
                <div className="space-y-6">
                  {/* Top stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <Stat label="Monthly Clicks" value={formatNumber(datarova.total_monthly_clicks)} />
                    <Stat label="Monthly Sales" value={formatNumber(datarova.total_monthly_sales)} />
                    <Stat label="3M Growth" value={formatPct(datarova.growth_3m_clicks_pct)} color={parseFloat(datarova.growth_3m_clicks_pct) > 0 ? 'var(--green-text)' : 'var(--red-text)'} />
                    <Stat label="YoY Growth" value={formatPct(datarova.growth_yoy_clicks_pct)} color={parseFloat(datarova.growth_yoy_clicks_pct) > 0 ? 'var(--green-text)' : 'var(--red-text)'} />
                    <Stat label="Keywords Tracked" value={datarova.total_related_keywords} />
                  </div>

                  {/* Primary keyword */}
                  {datarova.primary_keyword && (
                    <div className="rounded-lg p-4 border" style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border-default)' }}>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Primary Keyword</p>
                      <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>"{datarova.primary_keyword}"</p>
                      <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{formatNumber(datarova.primary_keyword_clicks)} clicks/mo</p>
                    </div>
                  )}

                  {/* Emerging niches */}
                  <SmartRender
                    data={datarova.emerging_niches}
                    label={`Emerging Niches (${(datarova.emerging_niches || []).length})`}
                  />

                  <div className="grid grid-cols-2 gap-6">
                    <SmartRender data={datarova.format_opportunities} label="Format Opportunities" />
                    <SmartRender data={datarova.combo_opportunities} label="Combo Opportunities" />
                  </div>

                  <SmartRender data={datarova.dosage_variants} label="Dosage Variants" />

                  {datarova.opportunity_summary && (
                    <div className="rounded-lg p-4 border" style={{ backgroundColor: 'var(--blue-muted)', borderColor: 'rgba(96,165,250,0.2)' }}>
                      <p className="text-sm" style={{ color: 'var(--text-body)' }}>{datarova.opportunity_summary}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No keyword data available for this ingredient</p>
              )
            )}

            {/* ── REDDIT TAB ── */}
            {activeTab === 'reddit' && (
              redditResearch ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <SmartRender data={redditResearch.formats_discussed} label="Formats Discussed" />
                    <SmartRender data={redditResearch.dosages_discussed} label="Dosages Discussed" />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <SmartRender data={redditResearch.pain_points} label="Pain Points" />
                    <SmartRender data={redditResearch.use_cases} label="Use Cases" />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <SmartRender data={redditResearch.combos_discussed || redditResearch.combinations_discussed} label="Combinations Discussed" />
                    <SmartRender data={redditResearch.brand_landscape} label="Brand Landscape" />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <SmartRender data={redditResearch.underserved_needs} label="Underserved Needs" />
                    <SmartRender data={redditResearch.safety_concerns} label="Safety Concerns" />
                  </div>
                  <SmartRender data={redditResearch.concept_suggestions} label="Reddit-Derived Concept Suggestions" />
                </div>
              ) : (
                <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No Reddit research available for this ingredient</p>
              )
            )}

            {/* ── SCIENCE TAB ── */}
            {activeTab === 'science' && (
              scienceResearch ? (
                <div className="space-y-6">
                  {scienceResearch.bioavailability_notes && (
                    <div className="rounded-lg p-4 border" style={{ backgroundColor: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.2)' }}>
                      <h4 className="text-sm font-semibold mb-2" style={{ color: '#c084fc' }}>Bioavailability Notes</h4>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>{scienceResearch.bioavailability_notes}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-6">
                    <SmartRender data={scienceResearch.clinical_dosages} label="Clinical Dosages" />
                    <SmartRender data={scienceResearch.proven_combinations} label="Proven Combinations" />
                  </div>
                  <SmartRender data={scienceResearch.active_compounds} label="Active Compounds" />
                  <SmartRender data={scienceResearch.novel_angles} label="Novel Angles" />
                  <SmartRender data={scienceResearch.concept_suggestions} label="Science-Derived Concept Suggestions" />
                </div>
              ) : (
                <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No science research available for this ingredient</p>
              )
            )}

            {/* ── CONCEPTS TAB ── */}
            {activeTab === 'concepts' && (
              concepts.length > 0 ? (
                <div className="space-y-3">
                  {concepts.map(concept => (
                    <button
                      key={concept.id}
                      onClick={() => navigate(`/concepts/${concept.id}`)}
                      className="w-full text-left rounded-lg p-5 transition-all group border"
                      style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border-default)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(31, 31, 35, 0.8)';
                        e.currentTarget.style.borderColor = 'rgba(96,165,250,0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                        e.currentTarget.style.borderColor = 'var(--border-default)';
                      }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <h4 className="font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>
                              {concept.concept_name}
                            </h4>
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{
                              backgroundColor: concept.status === 'selected' ? 'rgba(34,197,94,0.2)' : concept.status === 'rejected' ? 'rgba(239,68,68,0.2)' : 'var(--bg-active)',
                              color: concept.status === 'selected' ? 'var(--green-text)' : concept.status === 'rejected' ? 'var(--red-text)' : 'var(--text-body)'
                            }}>
                              {concept.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            {concept.concept_type && (
                              <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--blue-muted)', color: 'var(--blue-text)' }}>
                                {concept.concept_type.replace(/_/g, ' ')}
                              </span>
                            )}
                            {concept.format && (
                              <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-active)', color: 'var(--text-body)' }}>
                                {concept.format}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="w-24 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-active)' }}>
                            <div
                              className="h-full"
                              style={{ width: `${Math.min(100, Math.max(0, parseFloat(concept.confidence_score) * 10))}%`, backgroundColor: 'var(--blue)' }}
                            />
                          </div>
                          <span className="text-sm font-bold w-8" style={{ color: 'var(--text-primary)' }}>
                            {parseFloat(concept.confidence_score).toFixed(1)}
                          </span>
                        </div>
                      </div>
                      {concept.positioning_angle && (
                        <p className="text-sm line-clamp-2" style={{ color: 'var(--text-muted)' }}>{concept.positioning_angle}</p>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                  <p>No concepts generated yet for this ingredient</p>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color = 'var(--text-primary)' }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-hover)' }}>
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
    </div>
  )
}
