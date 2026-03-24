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
    return <p className="text-sm text-slate-500">No data</p>
  }

  // Auto-detect columns from the first item if not provided
  const cols = columns || Object.keys(data[0]).filter(k => k !== 'keywords' && k !== 'total_sales')

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-600/50">
            {cols.map(col => (
              <th key={col} className="text-left py-2 px-3 text-slate-400 font-medium text-xs uppercase tracking-wider">
                {col.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20">
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
                  <td key={col} className="py-2 px-3 text-slate-200">{String(val)}</td>
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
    return <p className="text-sm text-slate-500">No data</p>
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span className="text-slate-500 mt-0.5">•</span>
          <span className="text-slate-200">
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
          {label && <h4 className="text-sm font-semibold text-slate-300 mb-2">{label}</h4>}
          <BulletList items={data} />
        </div>
      )
    }

    // If items are objects → try table
    if (typeof data[0] === 'object') {
      return (
        <div className="mb-4">
          {label && <h4 className="text-sm font-semibold text-slate-300 mb-2">{label}</h4>}
          <div className="bg-slate-700/20 rounded-lg p-3 border border-slate-600/30">
            <JsonTable data={data} />
          </div>
        </div>
      )
    }
  }

  if (typeof data === 'string') {
    return (
      <div className="mb-4">
        {label && <h4 className="text-sm font-semibold text-slate-300 mb-2">{label}</h4>}
        <p className="text-sm text-slate-200">{data}</p>
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

  useEffect(() => {
    loadData()
  }, [candidateId])

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
    } catch (err) {
      console.error('Error loading discovery data:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900">
        <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
          <div className="max-w-[1600px] mx-auto px-6 py-4">
            <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">
              Toniiq Idea Pipeline
            </Link>
          </div>
        </header>
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mx-auto mb-4"></div>
            <p className="text-slate-400">Loading ingredient discovery...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!candidate) {
    return (
      <div className="min-h-screen bg-slate-900">
        <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
          <div className="max-w-[1600px] mx-auto px-6 py-4">
            <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">
              Toniiq Idea Pipeline
            </Link>
          </div>
        </header>
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <p className="text-slate-400">Ingredient not found</p>
            <Link to="/concepts" className="text-indigo-400 hover:text-indigo-300 mt-2 inline-block">Back to concepts</Link>
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
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">
              Toniiq Idea Pipeline
            </Link>
            <nav className="flex gap-3 items-center text-sm">
              <Link to="/" className="text-slate-400 hover:text-white transition-colors">Pipeline</Link>
              <span className="text-slate-600">/</span>
              <Link to="/concepts" className="text-slate-400 hover:text-white transition-colors">Concepts</Link>
              <span className="text-slate-600">/</span>
              <span className="text-white">{candidate.ingredient_name}</span>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-8">
        <button
          onClick={() => navigate(-1)}
          className="text-indigo-400 hover:text-indigo-300 text-sm font-medium mb-6 flex items-center gap-1"
        >
          ← Back
        </button>

        {/* Header section */}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-8 mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">{candidate.ingredient_name}</h1>
              <div className="flex items-center gap-3">
                {candidate.category && (
                  <span className="text-sm px-3 py-1 rounded-full bg-slate-700 text-slate-300">
                    {candidate.category}
                  </span>
                )}
                {concepts.length > 0 && (
                  <span className="text-sm px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {concepts.length} concept{concepts.length !== 1 ? 's' : ''} generated
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-4">
              {datarova && (
                <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                  <p className="text-xs text-slate-400 mb-1">Keyword Score</p>
                  <p className="text-3xl font-bold text-indigo-300">{datarova.datarova_deep_score || '—'}</p>
                </div>
              )}
              {redditResearch && (
                <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                  <p className="text-xs text-slate-400 mb-1">Reddit Score</p>
                  <p className="text-3xl font-bold text-amber-300">{redditResearch.reddit_score || '—'}<span className="text-lg text-slate-400">/10</span></p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-8">
          <div className="border-b border-slate-700/50 mb-6">
            <div className="flex gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-3 font-medium border-b-2 transition-colors flex items-center gap-2 ${
                    activeTab === tab.id
                      ? 'border-indigo-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-white'
                  } ${!tab.hasData ? 'opacity-50' : ''}`}
                >
                  <span>{tab.icon}</span>
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded-full">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-6">
            {/* ── KEYWORD TAB ── */}
            {activeTab === 'keyword' && (
              datarova ? (
                <div className="space-y-6">
                  {/* Top stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <Stat label="Monthly Clicks" value={formatNumber(datarova.total_monthly_clicks)} />
                    <Stat label="Monthly Sales" value={formatNumber(datarova.total_monthly_sales)} />
                    <Stat label="3M Growth" value={formatPct(datarova.growth_3m_clicks_pct)} color={parseFloat(datarova.growth_3m_clicks_pct) > 0 ? 'text-emerald-400' : 'text-red-400'} />
                    <Stat label="YoY Growth" value={formatPct(datarova.growth_yoy_clicks_pct)} color={parseFloat(datarova.growth_yoy_clicks_pct) > 0 ? 'text-emerald-400' : 'text-red-400'} />
                    <Stat label="Keywords Tracked" value={datarova.total_related_keywords} />
                  </div>

                  {/* Primary keyword */}
                  {datarova.primary_keyword && (
                    <div className="bg-slate-700/20 rounded-lg p-4 border border-slate-600/30">
                      <p className="text-xs text-slate-400 mb-1">Primary Keyword</p>
                      <p className="text-lg font-semibold text-white">"{datarova.primary_keyword}"</p>
                      <p className="text-sm text-slate-400 mt-1">{formatNumber(datarova.primary_keyword_clicks)} clicks/mo</p>
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
                    <div className="bg-indigo-500/10 rounded-lg p-4 border border-indigo-500/20">
                      <p className="text-sm text-slate-200">{datarova.opportunity_summary}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-slate-400 text-center py-8">No keyword data available for this ingredient</p>
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
                    <SmartRender data={redditResearch.combinations_discussed} label="Combinations Discussed" />
                    <SmartRender data={redditResearch.brand_landscape} label="Brand Landscape" />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <SmartRender data={redditResearch.underserved_needs} label="Underserved Needs" />
                    <SmartRender data={redditResearch.safety_concerns} label="Safety Concerns" />
                  </div>
                  <SmartRender data={redditResearch.concept_suggestions} label="Reddit-Derived Concept Suggestions" />
                </div>
              ) : (
                <p className="text-slate-400 text-center py-8">No Reddit research available for this ingredient</p>
              )
            )}

            {/* ── SCIENCE TAB ── */}
            {activeTab === 'science' && (
              scienceResearch ? (
                <div className="space-y-6">
                  {scienceResearch.bioavailability_notes && (
                    <div className="bg-purple-500/10 rounded-lg p-4 border border-purple-500/20">
                      <h4 className="text-sm font-semibold text-purple-300 mb-2">Bioavailability Notes</h4>
                      <p className="text-sm text-slate-200 leading-relaxed">{scienceResearch.bioavailability_notes}</p>
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
                <p className="text-slate-400 text-center py-8">No science research available for this ingredient</p>
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
                      className="w-full text-left bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/50 hover:border-indigo-500/30 rounded-lg p-5 transition-all group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <h4 className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                              {concept.concept_name}
                            </h4>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              concept.status === 'selected' ? 'bg-green-500/20 text-green-300'
                              : concept.status === 'rejected' ? 'bg-red-500/20 text-red-300'
                              : 'bg-slate-600/30 text-slate-300'
                            }`}>
                              {concept.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            {concept.concept_type && (
                              <span className="text-xs px-2 py-0.5 bg-indigo-500/20 rounded text-indigo-300">
                                {concept.concept_type.replace(/_/g, ' ')}
                              </span>
                            )}
                            {concept.format && (
                              <span className="text-xs px-2 py-0.5 bg-slate-600/50 rounded text-slate-300">
                                {concept.format}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="w-24 h-2 bg-slate-600 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500"
                              style={{ width: `${Math.min(100, Math.max(0, parseFloat(concept.confidence_score) * 10))}%` }}
                            />
                          </div>
                          <span className="text-sm font-bold text-white w-8">
                            {parseFloat(concept.confidence_score).toFixed(1)}
                          </span>
                        </div>
                      </div>
                      {concept.positioning_angle && (
                        <p className="text-sm text-slate-400 line-clamp-2">{concept.positioning_angle}</p>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
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

function Stat({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-slate-700/30 rounded-lg p-3">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
