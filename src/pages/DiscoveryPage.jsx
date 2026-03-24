import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function formatNumber(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toLocaleString()
}

function renderJsonValue(value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return formatNumber(value)
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc list-inside">
        {value.map((item, i) => (
          <li key={i} className="text-slate-200">
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </li>
        ))}
      </ul>
    )
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function TabPanel({ title, data, columns }) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <p>No data available</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {Object.entries(data).map(([key, value]) => {
        if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return null

        return (
          <div key={key} className="bg-slate-700/30 rounded-lg p-4 border border-slate-600/50">
            <h4 className="text-sm font-semibold text-slate-300 mb-2">{key.replace(/_/g, ' ')}</h4>
            <div className="text-slate-200 text-sm">
              {renderJsonValue(value)}
            </div>
          </div>
        )
      })}
    </div>
  )
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

      // Load Datarova enrichment
      const { data: datarovaData } = await supabase
        .from('datarova_enrichments')
        .select('*')
        .eq('candidate_id', candidateId)
        .limit(1)
        .maybeSingle()

      if (datarovaData) setDatarova(datarovaData)

      // Load Reddit research
      const { data: redditData } = await supabase
        .from('reddit_concept_research')
        .select('*')
        .eq('candidate_id', candidateId)
        .limit(1)
        .maybeSingle()

      if (redditData) setRedditResearch(redditData)

      // Load Science research
      const { data: scienceData } = await supabase
        .from('science_concept_research')
        .select('*')
        .eq('candidate_id', candidateId)
        .limit(1)
        .maybeSingle()

      if (scienceData) setScienceResearch(scienceData)

      // Load related concepts
      const { data: conceptsData } = await supabase
        .from('product_concepts')
        .select('id, concept_name, confidence_score, status, positioning_angle')
        .eq('candidate_id', candidateId)
        .order('confidence_score', { ascending: false })

      setConcepts(conceptsData || [])
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
            <Link to="/concepts" className="text-indigo-400 hover:text-indigo-300 mt-2 inline-block">
              Back to concepts
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/" className="text-xl font-semibold text-white hover:text-indigo-300 transition-colors">
                Toniiq Idea Pipeline
              </Link>
            </div>
            <nav className="flex gap-3 items-center">
              <Link to="/" className="text-sm text-slate-400 hover:text-white transition-colors">
                Pipeline
              </Link>
              <span className="text-slate-600">/</span>
              <Link to="/concepts" className="text-sm text-slate-400 hover:text-white transition-colors">
                Concepts
              </Link>
              <span className="text-slate-600">/</span>
              <span className="text-sm text-white">{candidate.ingredient_name}</span>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {/* Back button */}
        <button
          onClick={() => navigate('/concepts')}
          className="text-indigo-400 hover:text-indigo-300 text-sm font-medium mb-6 flex items-center gap-1"
        >
          ← Back to Concepts
        </button>

        {/* Header section */}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-8 mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">{candidate.ingredient_name}</h1>
              {candidate.category && (
                <p className="text-slate-400">
                  Category: <span className="text-slate-300 font-semibold">{candidate.category}</span>
                </p>
              )}
            </div>
            <div className="flex gap-4">
              {datarova && (
                <div className="bg-slate-700/30 rounded-lg p-4">
                  <p className="text-sm text-slate-400 mb-1">Keyword Score</p>
                  <p className="text-2xl font-bold text-indigo-300">{datarova.datarova_deep_score || '—'}</p>
                </div>
              )}
              {redditResearch && (
                <div className="bg-slate-700/30 rounded-lg p-4">
                  <p className="text-sm text-slate-400 mb-1">Reddit Score</p>
                  <p className="text-2xl font-bold text-amber-300">{redditResearch.reddit_score || '—'}/10</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-8">
          <div className="border-b border-slate-700/50 mb-6">
            <div className="flex gap-1">
              {[
                { id: 'keyword', label: '📊 Keyword Data', icon: '📊' },
                { id: 'reddit', label: '💬 Reddit Research', icon: '💬' },
                { id: 'science', label: '🧪 Science Research', icon: '🧪' },
                { id: 'concepts', label: '💡 Generated Concepts', icon: '💡' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-3 font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-indigo-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-6">
            {activeTab === 'keyword' && datarova && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">Search Volume & Growth</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-slate-700/30 rounded-lg p-4">
                      <p className="text-sm text-slate-400 mb-2">Total Monthly Clicks</p>
                      <p className="text-2xl font-bold text-white">
                        {formatNumber(datarova.total_monthly_clicks)}
                      </p>
                    </div>
                    <div className="bg-slate-700/30 rounded-lg p-4">
                      <p className="text-sm text-slate-400 mb-2">3-Month Growth</p>
                      <p className="text-2xl font-bold text-emerald-400">
                        {datarova.growth_3m_clicks_pct ? `+${(datarova.growth_3m_clicks_pct * 100).toFixed(1)}%` : '—'}
                      </p>
                    </div>
                    <div className="bg-slate-700/30 rounded-lg p-4">
                      <p className="text-sm text-slate-400 mb-2">YoY Growth</p>
                      <p className="text-2xl font-bold text-emerald-400">
                        {datarova.growth_yoy_clicks_pct ? `+${(datarova.growth_yoy_clicks_pct * 100).toFixed(1)}%` : '—'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-700/50 pt-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Opportunities</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {datarova.combo_opportunities && (
                      <div className="bg-slate-700/20 rounded-lg p-4">
                        <h4 className="font-semibold text-white mb-2">Combo Opportunities</h4>
                        <TabPanel data={datarova.combo_opportunities} />
                      </div>
                    )}
                    {datarova.format_opportunities && (
                      <div className="bg-slate-700/20 rounded-lg p-4">
                        <h4 className="font-semibold text-white mb-2">Format Opportunities</h4>
                        <TabPanel data={datarova.format_opportunities} />
                      </div>
                    )}
                  </div>
                </div>

                {datarova.emerging_niches && (
                  <div className="border-t border-slate-700/50 pt-6">
                    <h3 className="text-lg font-semibold text-white mb-4">Emerging Niches</h3>
                    <TabPanel data={datarova.emerging_niches} />
                  </div>
                )}
              </div>
            )}

            {activeTab === 'reddit' && redditResearch && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">Reddit Community Insights</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {redditResearch.formats_discussed && (
                      <div>
                        <h4 className="font-semibold text-white mb-3">Formats Discussed</h4>
                        <TabPanel data={redditResearch.formats_discussed} />
                      </div>
                    )}
                    {redditResearch.dosages_discussed && (
                      <div>
                        <h4 className="font-semibold text-white mb-3">Dosages Discussed</h4>
                        <TabPanel data={redditResearch.dosages_discussed} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-700/50 pt-6 grid grid-cols-2 gap-6">
                  {redditResearch.pain_points && (
                    <div>
                      <h4 className="font-semibold text-white mb-3">Pain Points</h4>
                      <TabPanel data={redditResearch.pain_points} />
                    </div>
                  )}
                  {redditResearch.use_cases && (
                    <div>
                      <h4 className="font-semibold text-white mb-3">Use Cases</h4>
                      <TabPanel data={redditResearch.use_cases} />
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-700/50 pt-6 grid grid-cols-2 gap-6">
                  {redditResearch.brand_landscape && (
                    <div>
                      <h4 className="font-semibold text-white mb-3">Brand Landscape</h4>
                      <TabPanel data={redditResearch.brand_landscape} />
                    </div>
                  )}
                  {redditResearch.underserved_needs && (
                    <div>
                      <h4 className="font-semibold text-white mb-3">Underserved Needs</h4>
                      <TabPanel data={redditResearch.underserved_needs} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'science' && scienceResearch && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">Scientific Research</h3>

                  {scienceResearch.bioavailability_notes && (
                    <div className="bg-slate-700/20 rounded-lg p-4 mb-4">
                      <h4 className="font-semibold text-white mb-2">Bioavailability Notes</h4>
                      <p className="text-slate-200">{scienceResearch.bioavailability_notes}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    {scienceResearch.clinical_dosages && (
                      <div>
                        <h4 className="font-semibold text-white mb-3">Clinical Dosages</h4>
                        <TabPanel data={scienceResearch.clinical_dosages} />
                      </div>
                    )}
                    {scienceResearch.proven_combinations && (
                      <div>
                        <h4 className="font-semibold text-white mb-3">Proven Combinations</h4>
                        <TabPanel data={scienceResearch.proven_combinations} />
                      </div>
                    )}
                  </div>
                </div>

                {scienceResearch.active_compounds && (
                  <div className="border-t border-slate-700/50 pt-6">
                    <h4 className="font-semibold text-white mb-3">Active Compounds</h4>
                    <TabPanel data={scienceResearch.active_compounds} />
                  </div>
                )}

                {scienceResearch.novel_angles && (
                  <div className="border-t border-slate-700/50 pt-6">
                    <h4 className="font-semibold text-white mb-3">Novel Angles</h4>
                    <TabPanel data={scienceResearch.novel_angles} />
                  </div>
                )}
              </div>
            )}

            {activeTab === 'concepts' && (
              <div>
                {concepts.length > 0 ? (
                  <div className="space-y-3">
                    {concepts.map(concept => (
                      <button
                        key={concept.id}
                        onClick={() => navigate(`/concepts/${concept.id}`)}
                        className="w-full text-left bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/50 rounded-lg p-4 transition-all group"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                            {concept.concept_name}
                          </h4>
                          <span
                            className={`text-xs font-medium px-2 py-1 rounded ${
                              concept.status === 'selected'
                                ? 'bg-green-500/20 text-green-300'
                                : concept.status === 'rejected'
                                  ? 'bg-red-500/20 text-red-300'
                                  : 'bg-slate-600/30 text-slate-300'
                            }`}
                          >
                            {concept.status}
                          </span>
                        </div>
                        <p className="text-sm text-slate-400 mb-2">{concept.positioning_angle}</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-600 rounded-full overflow-hidden max-w-xs">
                            <div
                              className="h-full bg-indigo-500"
                              style={{
                                width: `${Math.min(100, Math.max(0, concept.confidence_score * 10))}%`,
                              }}
                            />
                          </div>
                          <span className="text-sm font-semibold text-white w-8">
                            {concept.confidence_score?.toFixed(1)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-400">
                    <p>No concepts generated yet for this ingredient</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
