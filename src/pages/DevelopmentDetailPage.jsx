import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PipelineBreadcrumb from '../components/PipelineBreadcrumb'

const STAGES = [
  { key: 'sourcing', label: 'Sourcing', color: 'var(--blue)', icon: '🔍' },
  { key: 'formulation', label: 'Formulation', color: 'var(--amber)', icon: '🧪' },
  { key: 'r_and_d', label: 'R&D', color: 'var(--green)', icon: '🔬' },
  { key: 'pre_greenlight', label: 'Pre-Greenlight', color: '#a78bfa', icon: '✅' },
]

const ARTIFACT_LABELS = {
  costing_model: 'Costing Model',
  formulation_strategy: 'Formulation Strategy',
  competitive_analysis: 'Competitive Analysis',
  product_brief: 'Product Brief',
  spec_sheet: 'Spec Sheet',
  coa: 'COA',
  supplier_quote: 'Supplier Quote',
  other: 'Other',
}

function StageTracker({ currentStage }) {
  const currentIdx = STAGES.findIndex(s => s.key === currentStage)
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, i) => {
        const isComplete = i < currentIdx
        const isCurrent = i === currentIdx
        return (
          <div key={stage.key} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium border"
                style={{
                  background: isCurrent ? stage.color + '20' : isComplete ? 'var(--bg-active)' : 'transparent',
                  borderColor: isCurrent ? stage.color : isComplete ? 'var(--border-strong)' : 'var(--border-default)',
                  color: isCurrent ? stage.color : isComplete ? 'var(--text-muted)' : 'var(--text-faint)',
                }}
              >
                {isComplete ? '✓' : stage.icon}
              </div>
              <span
                className="text-[11px] font-medium"
                style={{ color: isCurrent ? stage.color : isComplete ? 'var(--text-muted)' : 'var(--text-faint)' }}
              >
                {stage.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className="w-8 h-px mx-2"
                style={{ background: i < currentIdx ? 'var(--border-strong)' : 'var(--border-default)' }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function MetricCard({ label, value, sub }) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-subtle)' }}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>
        {label}
      </p>
      <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
        {value || '—'}
      </p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

function IngredientsTable({ ingredients }) {
  if (!ingredients || !ingredients.length) {
    return (
      <p className="text-xs py-4 text-center" style={{ color: 'var(--text-faint)' }}>
        No formulation data synced yet. Run a Cowork session to populate.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
            {['Ingredient', 'Dose (mg)', 'Potency', 'Supplier', 'Cost/kg', 'Cost/serving'].map(h => (
              <th key={h} className="text-left py-2 px-3 font-medium" style={{ color: 'var(--text-faint)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ingredients.map((ing, i) => {
            // Support both field naming conventions
            const name = ing.ingredient || ing.name || '—'
            const potency = ing.potency_pct ?? (ing.potency != null ? (ing.potency < 1 ? ing.potency * 100 : ing.potency) : null)
            const costServing = ing.cost_per_serving != null ? Number(ing.cost_per_serving) : null
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td className="py-2 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>{name}</td>
                <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{ing.dose_mg || '—'}</td>
                <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{potency != null ? `${potency}%` : '—'}</td>
                <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>{ing.supplier || '—'}</td>
                <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{ing.cost_per_kg ? `$${Number(ing.cost_per_kg)}` : '—'}</td>
                <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{costServing != null ? `$${costServing.toFixed(4)}` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ArtifactsList({ artifacts }) {
  if (!artifacts || !artifacts.length) {
    return (
      <p className="text-xs py-4 text-center" style={{ color: 'var(--text-faint)' }}>
        No artifacts uploaded yet. Generate files via Cowork to populate.
      </p>
    )
  }

  const handleDownload = async (artifact) => {
    const { data, error } = await supabase.storage
      .from('development-artifacts')
      .createSignedUrl(artifact.storage_path, 3600) // 1hr signed URL
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank')
    }
  }

  return (
    <div className="space-y-2">
      {artifacts.map(a => (
        <div
          key={a.id}
          className="flex items-center justify-between rounded-lg border px-4 py-3"
          style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-sm">
              {a.artifact_type === 'costing_model' ? '📊' :
               a.artifact_type === 'product_brief' ? '📄' :
               a.artifact_type === 'coa' ? '🔬' :
               a.artifact_type === 'competitive_analysis' ? '📈' : '📎'}
            </span>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                {a.filename}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                {ARTIFACT_LABELS[a.artifact_type] || a.artifact_type}
                {a.version > 1 && ` · v${a.version}`}
                {' · '}
                {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {a.file_size_bytes && ` · ${(a.file_size_bytes / 1024).toFixed(0)} KB`}
              </p>
            </div>
          </div>
          <button
            onClick={() => handleDownload(a)}
            className="text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors"
            style={{
              borderColor: 'var(--border-default)',
              color: 'var(--text-muted)',
              background: 'transparent',
            }}
            onMouseEnter={(e) => { e.target.style.background = 'var(--bg-active)'; e.target.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--text-muted)' }}
          >
            Download
          </button>
        </div>
      ))}
    </div>
  )
}

function SupplierQuotes({ quotations }) {
  if (!quotations || !quotations.length) {
    return (
      <p className="text-xs py-4 text-center" style={{ color: 'var(--text-faint)' }}>
        No relevant quotations found. Quotation data will appear once the supplier database is populated.
      </p>
    )
  }

  // Group by ingredient for easier scanning
  const grouped = quotations.reduce((acc, q) => {
    const key = q.ingredient || 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(q)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([ingredient, quotes]) => (
        <div key={ingredient}>
          <h4 className="text-xs font-semibold mb-2 px-1" style={{ color: 'var(--text-primary)' }}>
            {ingredient}
            <span className="ml-2 font-normal" style={{ color: 'var(--text-faint)' }}>
              {quotes.length} quote{quotes.length !== 1 ? 's' : ''}
            </span>
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {['Supplier', 'Spec', 'Price/kg', 'MOQ', 'Lead Time', 'Manufacturer', 'Quote Date', 'Notes'].map(h => (
                    <th key={h} className="text-left py-2 px-2 font-medium" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quotes.sort((a, b) => Number(a.price_per_kg || 0) - Number(b.price_per_kg || 0)).map((q, i) => {
                  const isCheapest = i === 0
                  return (
                    <tr
                      key={i}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background: isCheapest ? 'var(--green-muted)' : 'transparent',
                      }}
                    >
                      <td className="py-2 px-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {q.supplier_name || '—'}
                      </td>
                      <td className="py-2 px-2 max-w-[180px]" style={{ color: 'var(--text-body)' }}>
                        {q.spec || '—'}
                      </td>
                      <td className="py-2 px-2 font-semibold" style={{ color: isCheapest ? 'var(--green-text)' : 'var(--text-body)' }}>
                        {q.price_per_kg ? `$${Number(q.price_per_kg).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 px-2" style={{ color: 'var(--text-muted)' }}>{q.moq || '—'}</td>
                      <td className="py-2 px-2" style={{ color: 'var(--text-muted)' }}>
                        {q.lead_time_days ? `${q.lead_time_days}d` : '—'}
                      </td>
                      <td className="py-2 px-2" style={{ color: 'var(--text-muted)' }}>{q.manufacturer || '—'}</td>
                      <td className="py-2 px-2" style={{ color: 'var(--text-faint)' }}>
                        {q.quote_date ? new Date(q.quote_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                      </td>
                      <td className="py-2 px-2 max-w-[250px] truncate" style={{ color: 'var(--text-muted)' }} title={q.comments || ''}>
                        {q.comments || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function DecisionLog({ log }) {
  if (!log || !log.length) {
    return (
      <p className="text-xs py-4 text-center" style={{ color: 'var(--text-faint)' }}>
        No decisions logged yet.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {log.map((entry, i) => (
        <div key={i} className="flex gap-3">
          <div
            className="w-px flex-shrink-0 mt-1"
            style={{ background: 'var(--border-default)', minHeight: 20 }}
          />
          <div>
            <p className="text-[10px] font-medium mb-0.5" style={{ color: 'var(--text-faint)' }}>
              {entry.date}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-body)' }}>{entry.decision}</p>
            {entry.context && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{entry.context}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function GreenLightChecklist({ checklist }) {
  const items = [
    { key: 'spec_sheet', label: 'Spec sheet finalized' },
    { key: 'coa_plan', label: 'COA plan confirmed' },
    { key: 'costing_model', label: 'Costing model locked' },
    { key: 'label_design', label: 'Label design approved' },
    { key: 'gdrive_folder', label: 'GDrive folder created' },
  ]
  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.key} className="flex items-center gap-2">
          <span
            className="w-4 h-4 rounded border flex items-center justify-center text-[10px]"
            style={{
              borderColor: checklist?.[item.key] ? 'var(--green)' : 'var(--border-default)',
              background: checklist?.[item.key] ? 'var(--green-muted)' : 'transparent',
              color: checklist?.[item.key] ? 'var(--green)' : 'var(--text-faint)',
            }}
          >
            {checklist?.[item.key] ? '✓' : ''}
          </span>
          <span
            className="text-xs"
            style={{ color: checklist?.[item.key] ? 'var(--text-body)' : 'var(--text-muted)' }}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function DevelopmentDetailPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState(null)
  const [concept, setConcept] = useState(null)
  const [candidate, setCandidate] = useState(null)
  const [formulation, setFormulation] = useState(null)
  const [costing, setCosting] = useState(null)
  const [artifacts, setArtifacts] = useState([])
  const [quotations, setQuotations] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    async function load() {
      // Load project
      const { data: proj } = await supabase
        .from('development_projects')
        .select('*')
        .eq('id', projectId)
        .single()

      if (proj) {
        setProject(proj)

        // Load concept and candidate
        if (proj.concept_id) {
          const { data: conceptData } = await supabase
            .from('product_concepts')
            .select('id, concept_name, candidate_id')
            .eq('id', proj.concept_id)
            .maybeSingle()
          if (conceptData) {
            setConcept(conceptData)
            if (conceptData.candidate_id) {
              const { data: candidateData } = await supabase
                .from('idea_candidates')
                .select('id, ingredient_name')
                .eq('id', conceptData.candidate_id)
                .maybeSingle()
              if (candidateData) setCandidate(candidateData)
            }
          }
        }

        // Load current formulation
        const { data: form } = await supabase
          .from('development_formulations')
          .select('*')
          .eq('project_id', projectId)
          .eq('is_current', true)
          .single()
        if (form) setFormulation(form)

        // Load current costing
        const { data: cost } = await supabase
          .from('development_costing')
          .select('*')
          .eq('project_id', projectId)
          .eq('is_current', true)
          .single()
        if (cost) setCosting(cost)

        // Load artifacts
        const { data: arts } = await supabase
          .from('development_artifacts')
          .select('*')
          .eq('project_id', projectId)
          .eq('is_current', true)
          .order('created_at', { ascending: false })
        if (arts) setArtifacts(arts)

        // Load relevant quotations — use formulation ingredient names for precise matching
        let searchTerms = []
        if (form?.ingredients?.length) {
          // Extract meaningful multi-word ingredient names, stripping supplier info in parens
          searchTerms = form.ingredients.map(ing => {
            const name = ing.ingredient || ing.name || ''
            // Remove "(BannerBio)" style suffixes and percentage specs like "5%"
            const cleaned = name.replace(/\s*\(.*?\)/g, '').replace(/\s*\d+%/g, '').trim()
            // Take the primary ingredient name (before any numeric/spec info)
            // e.g., "Astaxanthin 5% (BannerBio)" → "Astaxanthin"
            // e.g., "Black Pepper Extract 95% (Nutravative)" → "Black Pepper Extract"
            // e.g., "Lycopene 10% Beadlets (BannerBio)" → "Lycopene"
            const parts = cleaned.split(/\s+/)
            // For multi-word ingredients like "Black Pepper Extract", "Sunflower Lecithin", "MCT Oil"
            // Use the full cleaned name for the search
            return cleaned.toLowerCase()
          }).filter(w => w.length > 2)
          searchTerms = [...new Set(searchTerms)]
        } else {
          searchTerms = proj.name.toLowerCase().split(/\s+/).filter(w => w.length > 3)
        }
        if (searchTerms.length > 0) {
          const { data: quotes } = await supabase
            .from('quotations')
            .select('*')
            .or(searchTerms.map(w => {
              // Use the first word only for matching to avoid over-specific queries
              // but exclude very generic words that cause false positives
              const firstWord = w.split(/\s+/)[0]
              const skipWords = ['black', 'red', 'green', 'white', 'oil', 'extract']
              // If first word is generic, use first two words
              const term = skipWords.includes(firstWord) && w.split(/\s+/).length > 1
                ? w.split(/\s+/).slice(0, 2).join(' ')
                : firstWord
              return `ingredient.ilike.%${term}%`
            }).join(','))
            .order('ingredient', { ascending: true })
            .order('price_per_kg', { ascending: true })
            .limit(50)
          if (quotes) setQuotations(quotes)
        }
      }
      setLoading(false)
    }
    load()
  }, [projectId])

  if (loading) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div>
    )
  }

  if (!project) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Project not found</p>
        <Link to="/development" className="text-xs underline mt-2 inline-block" style={{ color: 'var(--blue)' }}>
          Back to Development
        </Link>
      </div>
    )
  }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'costing', label: 'Costing' },
    { key: 'suppliers', label: 'Suppliers' },
    { key: 'artifacts', label: `Artifacts${artifacts.length ? ` (${artifacts.length})` : ''}` },
    { key: 'decisions', label: 'Decisions' },
  ]

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4">
        <PipelineBreadcrumb candidate={candidate} concept={concept} project={project} current="development" />
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {project.name}
          </h1>
          <StageTracker currentStage={project.stage} />
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-medium px-2 py-1 rounded border"
            style={{
              color: project.priority === 'high' ? 'var(--red-text)' : project.priority === 'medium' ? 'var(--amber-text)' : 'var(--blue-text)',
              borderColor: project.priority === 'high' ? 'var(--red)' : project.priority === 'medium' ? 'var(--amber)' : 'var(--blue)',
              background: project.priority === 'high' ? 'var(--red-muted)' : project.priority === 'medium' ? 'var(--amber-muted)' : 'var(--blue-muted)',
            }}
          >
            {project.priority} priority
          </span>
        </div>
      </div>

      {/* Current focus callout */}
      {project.current_focus && (
        <div
          className="rounded-lg border-l-2 px-4 py-3 mb-6"
          style={{ background: 'var(--bg-raised)', borderColor: 'var(--blue)' }}
        >
          <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>
            Current Focus
          </p>
          <p className="text-sm" style={{ color: 'var(--text-body)' }}>{project.current_focus}</p>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <MetricCard
          label="Phase B Score"
          value={project.phase_b_composite_score ? `${Number(project.phase_b_composite_score)}/100` : null}
          sub={project.phase_b_tier}
        />
        <MetricCard
          label="COGS"
          value={project.current_cogs ? `$${Number(project.current_cogs).toFixed(2)}` : null}
        />
        <MetricCard
          label="Target Margin"
          value={project.target_margin_pct ? `${Number(project.target_margin_pct)}%` : '40%'}
        />
        <MetricCard
          label="Target Price"
          value={project.target_retail_price ? `$${Number(project.target_retail_price).toFixed(2)}` : null}
        />
        <MetricCard
          label="Format"
          value={project.format}
          sub={project.manufacturer}
        />
      </div>

      {/* Tabs */}
      <div
        className="flex gap-0 border-b mb-6"
        style={{ borderColor: 'var(--border-default)' }}
      >
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2.5 text-xs font-medium transition-colors relative"
            style={{
              color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div
                className="absolute bottom-0 left-0 right-0 h-[2px]"
                style={{ background: 'var(--accent)' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[400px]">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 space-y-6">
              {/* Product details */}
              <div
                className="rounded-lg border p-4"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
              >
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                  Product Details
                </h3>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p style={{ color: 'var(--text-faint)' }}>Format</p>
                    <p style={{ color: 'var(--text-body)' }}>{project.format || '—'}</p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-faint)' }}>Target Customer</p>
                    <p style={{ color: 'var(--text-body)' }}>{project.target_customer || '—'}</p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-faint)' }}>Manufacturer</p>
                    <p style={{ color: 'var(--text-body)' }}>{project.manufacturer || '—'}</p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-faint)' }}>Local Folder</p>
                    <p style={{ color: 'var(--text-body)' }}>{project.local_folder_path || '—'}</p>
                  </div>
                </div>
              </div>

              {/* Quick formulation view */}
              {formulation && (
                <div
                  className="rounded-lg border p-4"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
                >
                  <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                    Current Formulation {formulation.name && `— ${formulation.name}`}
                  </h3>
                  <IngredientsTable ingredients={formulation.ingredients} />
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Greenlight checklist */}
              <div
                className="rounded-lg border p-4"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
              >
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                  Greenlight Checklist
                </h3>
                <GreenLightChecklist checklist={project.greenlight_checklist} />
              </div>

              {/* Recent decisions */}
              <div
                className="rounded-lg border p-4"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
              >
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                  Recent Decisions
                </h3>
                <DecisionLog log={project.decision_log?.slice(0, 5)} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'costing' && (
          <div className="space-y-5">
            {formulation || costing ? (
              <>
                {/* Costing sheet header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formulation?.name || project.name}
                    </h3>
                    <div className="flex gap-4 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {formulation?.format && <span>{formulation.format}</span>}
                      {formulation?.servings_per_container && <span>{formulation.servings_per_container} servings/bottle</span>}
                      {formulation?.total_weight_per_serving && <span>{formulation.total_weight_per_serving}mg fill weight</span>}
                      {formulation && <span>v{formulation.version}</span>}
                    </div>
                  </div>
                </div>

                {/* Ingredient costing table — mirrors the costing sheet layout */}
                <div
                  className="rounded-lg border overflow-hidden"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: 'var(--bg-raised)', borderBottom: '1px solid var(--border-default)' }}>
                          {['Ingredient', 'Dose/Serving', 'Potency', 'Supplier', 'Cost/kg', 'Cost/Bottle', 'Cost/Serving', 'Notes'].map(h => (
                            <th key={h} className="text-left py-2.5 px-3 font-semibold" style={{ color: 'var(--text-faint)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(formulation?.ingredients || []).map((ing, i) => {
                          const name = ing.ingredient || ing.name || '—'
                          const potency = ing.potency_pct ?? (ing.potency != null ? (ing.potency < 1 ? ing.potency * 100 : ing.potency) : null)
                          const costServing = ing.cost_per_serving != null ? Number(ing.cost_per_serving) : null
                          const costBottle = costServing != null && formulation?.servings_per_container
                            ? costServing * formulation.servings_per_container : null
                          return (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td className="py-2 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>{name}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{ing.dose_mg ? `${ing.dose_mg}mg` : '—'}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{potency != null ? `${potency}%` : '—'}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>{ing.supplier || '—'}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{ing.cost_per_kg ? `$${Number(ing.cost_per_kg)}` : '—'}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{costBottle != null ? `$${costBottle.toFixed(3)}` : '—'}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{costServing != null ? `$${costServing.toFixed(4)}` : '—'}</td>
                              <td className="py-2 px-3 max-w-[200px] truncate" style={{ color: 'var(--text-faint)' }} title={ing.notes || ''}>{ing.notes || ''}</td>
                            </tr>
                          )
                        })}
                        {/* Non-ingredient costs */}
                        {costing && (
                          <>
                            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>Packaging Components</td>
                              <td colSpan={4}></td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>${Number(costing.packaging_cost || 0).toFixed(2)}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>
                                {formulation?.servings_per_container ? `$${(Number(costing.packaging_cost || 0) / formulation.servings_per_container).toFixed(4)}` : '—'}
                              </td>
                              <td></td>
                            </tr>
                            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>Co-packing</td>
                              <td colSpan={4}></td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>${Number(costing.copacking_cost || 0).toFixed(2)}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>
                                {formulation?.servings_per_container ? `$${(Number(costing.copacking_cost || 0) / formulation.servings_per_container).toFixed(4)}` : '—'}
                              </td>
                              <td></td>
                            </tr>
                            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>Ship to FBA</td>
                              <td colSpan={4}></td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>${Number(costing.shipping_cost || 0).toFixed(2)}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>
                                {formulation?.servings_per_container ? `$${(Number(costing.shipping_cost || 0) / formulation.servings_per_container).toFixed(4)}` : '—'}
                              </td>
                              <td></td>
                            </tr>
                            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>Amazon Fulfillment</td>
                              <td colSpan={4}></td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>${Number(costing.amazon_fees || 0).toFixed(2)}</td>
                              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>
                                {formulation?.servings_per_container ? `$${(Number(costing.amazon_fees || 0) / formulation.servings_per_container).toFixed(4)}` : '—'}
                              </td>
                              <td></td>
                            </tr>
                          </>
                        )}
                        {/* Total row */}
                        {costing && (
                          <tr style={{ background: 'var(--bg-raised)', borderTop: '2px solid var(--border-default)' }}>
                            <td className="py-2.5 px-3 font-bold" style={{ color: 'var(--text-primary)' }}>TOTAL COGS</td>
                            <td colSpan={4}></td>
                            <td className="py-2.5 px-3 font-bold" style={{ color: 'var(--text-primary)' }}>
                              ${Number(costing.total_cogs || 0).toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 font-bold" style={{ color: 'var(--text-primary)' }}>
                              {formulation?.servings_per_container ? `$${(Number(costing.total_cogs || 0) / formulation.servings_per_container).toFixed(4)}` : '—'}
                            </td>
                            <td></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Margin analysis */}
                {costing?.margin_scenarios && Object.keys(costing.margin_scenarios).length > 0 && (
                  <div
                    className="rounded-lg border p-5"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
                  >
                    <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-faint)' }}>
                      Margin Analysis
                    </h3>
                    <div className="grid grid-cols-4 gap-3">
                      {Object.entries(costing.margin_scenarios)
                        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                        .map(([key, price]) => {
                          const isTarget = key === '40%' || key === String(Number(project.target_margin_pct))
                          return (
                            <div
                              key={key}
                              className="text-center rounded-lg border px-3 py-3"
                              style={{
                                borderColor: isTarget ? 'var(--green)' : 'var(--border-subtle)',
                                background: isTarget ? 'var(--green-muted)' : 'var(--bg-raised)',
                              }}
                            >
                              <p className="text-[10px] font-medium uppercase" style={{ color: isTarget ? 'var(--green-text)' : 'var(--text-faint)' }}>
                                {key.includes('%') ? key : `${key}%`} margin
                              </p>
                              <p className="text-xl font-bold mt-1" style={{ color: isTarget ? 'var(--green-text)' : 'var(--text-primary)' }}>
                                ${Number(price).toFixed(2)}
                              </p>
                              {formulation?.servings_per_container && (
                                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                                  ${(Number(price) / formulation.servings_per_container).toFixed(3)}/serving
                                </p>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {(formulation?.notes || costing?.notes) && (
                  <div className="text-xs pt-2" style={{ color: 'var(--text-muted)' }}>
                    {formulation?.notes && <p>{formulation.notes}</p>}
                    {costing?.notes && <p className="mt-1">{costing.notes}</p>}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-center py-10" style={{ color: 'var(--text-faint)' }}>
                No costing data synced yet. Generate a costing sheet via Cowork to populate.
              </p>
            )}
          </div>
        )}

        {activeTab === 'suppliers' && (
          <SupplierQuotes quotations={quotations} />
        )}

        {activeTab === 'artifacts' && (
          <ArtifactsList artifacts={artifacts} />
        )}

        {activeTab === 'decisions' && (
          <div
            className="rounded-lg border p-5"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
          >
            <DecisionLog log={project.decision_log} />
          </div>
        )}
      </div>
    </div>
  )
}
