import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PDFViewer from '../components/PDFViewer'

export default function SupplierDetailPage() {
  const { supplierId } = useParams()
  const navigate = useNavigate()
  const [supplier, setSupplier] = useState(null)
  const [quotations, setQuotations] = useState([])
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedDocument, setSelectedDocument] = useState(null)
  const [sortColumn, setSortColumn] = useState('ingredient')
  const [sortDirection, setSortDirection] = useState('asc')
  const [docFilter, setDocFilter] = useState({ ingredient: '', docType: '' })

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      try {
        // Load supplier
        const { data: supplierData, error: supplierError } = await supabase
          .from('suppliers')
          .select('*')
          .eq('id', supplierId)
          .single()

        if (!supplierError && supplierData) {
          setSupplier(supplierData)
        }

        // Load quotations
        const { data: quotationData } = await supabase
          .from('quotations')
          .select('*')
          .eq('supplier_id', supplierId)
          .order('ingredient')

        if (quotationData) {
          setQuotations(quotationData)
        }

        // Load documents
        const { data: documentData } = await supabase
          .from('supplier_documents')
          .select('*')
          .eq('supplier_id', supplierId)
          .order('ingredient')

        if (documentData) {
          setDocuments(documentData)
        }
      } catch (error) {
        console.error('Error loading supplier data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [supplierId])

  const handleGetSignedUrl = async (document) => {
    try {
      const { data, error } = await supabase.storage
        .from('supplier-documents')
        .createSignedUrl(document.storage_path, 3600)

      if (data?.signedUrl && !error) {
        setSelectedDocument({ ...document, signedUrl: data.signedUrl })
      }
    } catch (error) {
      console.error('Error getting signed URL:', error)
    }
  }

  const tierColors = {
    core: { bg: '#1e40af', text: '#3b82f6' },
    preferred: { bg: '#065f46', text: '#10b981' },
    new: { bg: '#374151', text: '#9ca3af' },
  }

  const tierColor = supplier && tierColors[supplier.tier?.toLowerCase()] || tierColors.new

  // Overview stats
  const uniqueIngredients = new Set(quotations.map(q => q.ingredient)).size
  const avgPrice = quotations.length > 0
    ? (quotations.reduce((sum, q) => sum + (q.price_per_kg || 0), 0) / quotations.length).toFixed(2)
    : 0

  // Get unique ingredients for overview
  const ingredientOverview = Array.from(new Set(quotations.map(q => q.ingredient)))
    .map(ing => {
      const quotes = quotations.filter(q => q.ingredient === ing)
      const best = quotes.reduce((min, q) => !min || (q.price_per_kg && q.price_per_kg < min.price_per_kg) ? q : min)
      return { ingredient: ing, price: best?.price_per_kg, moc: best?.moc }
    })

  // Sort and filter quotations
  const sortedQuotations = [...quotations].sort((a, b) => {
    let aVal = a[sortColumn]
    let bVal = b[sortColumn]

    if (sortColumn === 'ingredient') {
      aVal = aVal?.toLowerCase() || ''
      bVal = bVal?.toLowerCase() || ''
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  // Filter documents
  const filteredDocuments = documents.filter(doc => {
    const ingredientMatch = !docFilter.ingredient || doc.ingredient?.toLowerCase().includes(docFilter.ingredient.toLowerCase())
    const typeMatch = !docFilter.docType || doc.doc_type?.toLowerCase() === docFilter.docType.toLowerCase()
    return ingredientMatch && typeMatch
  })

  // Get unique doc types
  const uniqueDocTypes = Array.from(new Set(documents.map(d => d.doc_type).filter(Boolean)))

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
        Loading supplier details...
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate('/suppliers')}
          className="text-sm mb-4 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          ← Back to Supplier Hub
        </button>
        <p style={{ color: 'var(--text-muted)' }}>Supplier not found</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header with back button */}
      <button
        onClick={() => navigate('/suppliers')}
        className="text-sm mb-4 transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        ← Back to Supplier Hub
      </button>

      {/* Supplier header */}
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {supplier.name}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {supplier.contact_email && (
              <span>{supplier.contact_email}</span>
            )}
          </p>
        </div>
        <span
          className="text-xs font-medium px-3 py-1 rounded-full ml-auto"
          style={{
            background: tierColor.bg,
            color: tierColor.text,
          }}
        >
          {supplier.tier || 'New'}
        </span>
      </div>

      {/* Tab selector */}
      <div className="flex items-center gap-6 mb-6 border-b" style={{ borderColor: 'var(--border-default)' }}>
        {['overview', 'quotations', 'documents'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-2 py-3 text-sm font-medium transition-all capitalize"
            style={{
              color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === tab ? '2px solid var(--blue)' : 'transparent',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div>
          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Total Ingredients', value: uniqueIngredients },
              { label: 'Avg Price/kg', value: `$${avgPrice}` },
              { label: 'Documents', value: documents.length },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border px-4 py-3"
                style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-subtle)' }}
              >
                <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>
                  {stat.label}
                </p>
                <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Ingredients list */}
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Ingredients
          </h2>
          {ingredientOverview.length === 0 ? (
            <p className="text-xs py-4" style={{ color: 'var(--text-faint)' }}>
              No quotations yet
            </p>
          ) : (
            <div className="grid gap-2">
              {ingredientOverview.map((ing) => (
                <Link
                  key={ing.ingredient}
                  to={`/suppliers/ingredient/${encodeURIComponent(ing.ingredient)}`}
                  className="rounded-lg border p-3 flex items-center justify-between hover:border-blue-500 transition-all"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border-default)',
                  }}
                >
                  <span style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: '500' }}>
                    {ing.ingredient}
                  </span>
                  <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {ing.price && (
                      <span>${ing.price.toFixed(2)}/kg</span>
                    )}
                    {ing.moc && (
                      <span style={{ color: 'var(--text-faint)' }}>MOQ: {ing.moc}</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quotations Tab */}
      {activeTab === 'quotations' && (
        <div>
          {sortedQuotations.length === 0 ? (
            <p className="text-xs py-4" style={{ color: 'var(--text-faint)' }}>
              No quotations
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                    {[
                      { key: 'ingredient', label: 'Ingredient' },
                      { key: 'spec', label: 'Spec' },
                      { key: 'price_per_kg', label: 'Price/kg' },
                      { key: 'moc', label: 'MOQ' },
                      { key: 'lead_time_days', label: 'Lead Time' },
                      { key: 'quote_date', label: 'Quote Date' },
                      { key: 'source_type', label: 'Source Type' },
                      { key: 'notes', label: 'Notes' },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className="text-left py-2 px-3 font-medium cursor-pointer hover:bg-opacity-50 transition-colors"
                        style={{ color: 'var(--text-faint)', userSelect: 'none' }}
                      >
                        <div className="flex items-center gap-1">
                          {col.label}
                          {sortColumn === col.key && (
                            <span style={{ fontSize: '10px' }}>
                              {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedQuotations.map((quote, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="py-2 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {quote.ingredient}
                      </td>
                      <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>
                        {quote.spec || '—'}
                      </td>
                      <td className="py-2 px-3" style={{ color: 'var(--text-body)' }}>
                        {quote.price_per_kg ? `$${quote.price_per_kg.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                        {quote.moc || '—'}
                      </td>
                      <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                        {quote.lead_time_days ? `${quote.lead_time_days}d` : '—'}
                      </td>
                      <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        {quote.quote_date ? new Date(quote.quote_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        {quote.source_type || '—'}
                      </td>
                      <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        {quote.notes ? quote.notes.substring(0, 50) + (quote.notes.length > 50 ? '...' : '') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Documents Tab */}
      {activeTab === 'documents' && (
        <div>
          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              placeholder="Filter by ingredient..."
              value={docFilter.ingredient}
              onChange={(e) => setDocFilter({ ...docFilter, ingredient: e.target.value })}
              className="flex-1 px-3 py-2 rounded-lg border text-xs"
              style={{
                background: 'var(--bg-raised)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
            <select
              value={docFilter.docType}
              onChange={(e) => setDocFilter({ ...docFilter, docType: e.target.value })}
              className="px-3 py-2 rounded-lg border text-xs"
              style={{
                background: 'var(--bg-raised)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="">All Types</option>
              {uniqueDocTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {/* Documents grid */}
          {filteredDocuments.length === 0 ? (
            <p className="text-xs py-4" style={{ color: 'var(--text-faint)' }}>
              No documents found
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="rounded-lg border p-3 flex flex-col gap-2"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border-default)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {doc.filename}
                      </p>
                      {doc.ingredient && (
                        <p className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>
                          {doc.ingredient}
                        </p>
                      )}
                    </div>
                    {doc.doc_type && (
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded flex-shrink-0"
                        style={{
                          background: 'var(--bg-active)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {doc.doc_type}
                      </span>
                    )}
                  </div>

                  {doc.upload_date && (
                    <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                      {new Date(doc.upload_date).toLocaleDateString()}
                    </p>
                  )}

                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleGetSignedUrl(doc)}
                      className="flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors"
                      style={{
                        background: 'var(--bg-active)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      View
                    </button>
                    {doc.storage_path && (
                      <a
                        href={`/api/download?path=${encodeURIComponent(doc.storage_path)}`}
                        className="flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors text-center"
                        style={{
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-default)',
                        }}
                      >
                        Download
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PDF Viewer */}
      {selectedDocument && (
        <PDFViewer
          url={selectedDocument.signedUrl}
          filename={selectedDocument.filename}
          onClose={() => setSelectedDocument(null)}
        />
      )}
    </div>
  )
}
