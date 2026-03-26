import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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
          {ingredients.map((ing, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td className="py-2 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>{ing.ingredient}</td>
              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{ing.dose_mg || '—'}</td>
              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{ing.potency_pct ? `${ing.potency_pct}%` : '—'}</td>
              <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>{ing.supplier || '—'}</td>
              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{ing.cost_per_kg ? `$${ing.cost_per_kg}` : '—'}</td>
              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{ing.cost_per_serving ? `$${ing.cost_per_serving.toFixed(4)}` : '—'}</td>
            </tr>
          ))}
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
            {['Ingredient', 'Supplier', 'Price/kg', 'MOQ', 'Lead Time', 'Source'].map(h => (
              <th key={h} className="text-left py-2 px-3 font-medium" style={{ color: 'var(--text-faint)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {quotations.map((q, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td className="py-2 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>{q.ingredient}</td>
              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{q.supplier_name || '—'}</td>
              <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>{q.price_per_kg ? `$${Number(q.price_per_kg).toFixed(2)}` : '—'}</td>
              <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>{q.moq || '—'}</td>
              <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>{q.lead_time_days ? `${q.lead_time_days}d` : '—'}</td>
              <td className="py-2 px-3">
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    background: q.source_type === 'current_pricing' ? 'var(--green-muted)' : 'var(--blue-muted)',
                    color: q.source_type === 'current_pricing' ? 'var(--green-text)' : 'var(--blue-text)',
                  }}
                >
                  {q.source_type === 'current_pricing' ? 'Active' : 'New Quote'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
    { key: 'costing', label: 'Costing model locked' },
    { key: 'label', label: 'Label design approved' },
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

        // Load relevant quotations (match by project name keywords)
        // This is a fuzzy match - in production we'd use formulation ingredients
        const nameWords = proj.name.toLowerCase().split(/\s+/).filter(w => w.length > 3)
        if (nameWords.length > 0) {
          const { data: quotes } = await supabase
            .from('quotations')
            .select('*')
            .or(nameWords.map(w => `ingredient.ilike.%${w}%`).join(','))
            .order('price_per_kg', { ascending: true })
            .limit(20)
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
    { key: 'formulation', label: 'Formulation' },
    { key: 'costing', label: 'Costing' },
    { key: 'suppliers', label: 'Suppliers' },
    { key: 'artifacts', label: `Artifacts${artifacts.length ? ` (${artifacts.length})` : ''}` },
    { key: 'decisions', label: 'Decisions' },
  ]

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4">
        <Link to="/development" className="text-xs" style={{ color: 'var(--text-faint)' }}>Development</Link>
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>/</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{project.name}</span>
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
          value={project.phase_b_composite_score ? `${project.phase_b_composite_score}/100` : null}
          sub={project.phase_b_tier}
        />
        <MetricCard
          label="COGS"
          value={project.current_cogs ? `$${project.current_cogs.toFixed(2)}` : null}
        />
        <MetricCard
          label="Target Margin"
          value={project.target_margin_pct ? `${project.target_margin_pct}%` : '35%'}
        />
        <MetricCard
          label="Target Price"
          value={project.target_retail_price ? `$${project.target_retail_price.toFixed(2)}` : null}
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

        {activeTab === 'formulation' && (
          <div
            className="rounded-lg border p-5"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Formulation {formulation ? `v${formulation.version}` : ''}
                {formulation?.name && ` — ${formulation.name}`}
              </h3>
              {formulation && (
                <div className="flex gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formulation.format && <span>Format: {formulation.format}</span>}
                  {formulation.servings_per_container && <span>{formulation.servings_per_container} servings</span>}
                  {formulation.total_weight_per_serving && <span>{formulation.total_weight_per_serving}mg/serving</span>}
                </div>
              )}
            </div>
            <IngredientsTable ingredients={formulation?.ingredients} />
            {formulation?.notes && (
              <p className="text-xs mt-4 pt-3 border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>
                {formulation.notes}
              </p>
            )}
          </div>
        )}

        {activeTab === 'costing' && (
          <div className="space-y-4">
            {costing ? (
              <>
                <div className="grid grid-cols-4 gap-3">
                  <MetricCard label="Ingredient Cost" value={costing.ingredient_cost_per_unit ? `$${Number(costing.ingredient_cost_per_unit).toFixed(2)}` : null} />
                  <MetricCard label="Packaging" value={`$${Number(costing.packaging_cost || 0.65).toFixed(2)}`} />
                  <MetricCard label="Co-packing" value={costing.copacking_cost ? `$${Number(costing.copacking_cost).toFixed(2)}` : null} />
                  <MetricCard label="Total COGS" value={costing.total_cogs ? `$${Number(costing.total_cogs).toFixed(2)}` : null} />
                </div>

                {costing.margin_scenarios && Object.keys(costing.margin_scenarios).length > 0 && (
                  <div
                    className="rounded-lg border p-5"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
                  >
                    <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                      Margin Scenarios
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      {Object.entries(costing.margin_scenarios).map(([key, price]) => (
                        <div key={key} className="text-center">
                          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{key.replace('margin_', '')}% Margin</p>
                          <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>${Number(price).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {costing.target_sell_price && (
                  <div
                    className="rounded-lg border-l-2 px-4 py-3"
                    style={{ background: 'var(--green-muted)', borderColor: 'var(--green)' }}
                  >
                    <span className="text-xs" style={{ color: 'var(--green-text)' }}>
                      Target sell price: <span className="font-semibold">${Number(costing.target_sell_price).toFixed(2)}</span>
                    </span>
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
