import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PDFViewer from '../components/PDFViewer'

export default function IngredientDetailPage() {
  const { ingredientName } = useParams()
  const navigate = useNavigate()

  // Safe decode — some ingredient names have special chars that break decodeURIComponent
  let decodedIngredient = ingredientName
  try {
    decodedIngredient = decodeURIComponent(ingredientName)
  } catch {
    decodedIngredient = ingredientName
  }

  const [quotations, setQuotations] = useState([])
  const [documents, setDocuments] = useState([])
  const [supplierMap, setSupplierMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedDocument, setSelectedDocument] = useState(null)
  const [sortColumn, setSortColumn] = useState('supplier')
  const [sortDirection, setSortDirection] = useState('asc')

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      try {
        // Extract core keyword from ingredient name for fuzzy document matching
        // e.g. "Beet Root Powder (Beta Vulgaris Root; 4% Nitrates), 20:1 min extract" → "Beet Root"
        // e.g. "Natural Astaxanthin 5% Powder" → "Astaxanthin"
        const coreKeyword = extractCoreIngredient(decodedIngredient)

        // Load quotations (exact match) + all documents + suppliers in parallel
        const [quotationsRes, allDocsRes, suppliersRes] = await Promise.all([
          supabase.from('quotations').select('*').eq('ingredient', decodedIngredient).order('supplier_name'),
          supabase.from('supplier_documents').select('*').order('filename'),
          supabase.from('suppliers').select('id, name, tier'),
        ])

        // Build supplier lookup map
        const sMap = {}
        ;(suppliersRes.data || []).forEach(s => { sMap[s.id] = s })
        setSupplierMap(sMap)

        if (quotationsRes.data) setQuotations(quotationsRes.data)

        // Fuzzy match documents: check if document ingredient contains core keyword or vice versa
        if (allDocsRes.data) {
          const matched = allDocsRes.data.filter(doc => {
            if (!doc.ingredient || doc.ingredient === 'General' || doc.ingredient === '_Images') return false
            const docIng = doc.ingredient.toLowerCase()
            const queryIng = decodedIngredient.toLowerCase()
            const keyword = coreKeyword.toLowerCase()
            // Match if: doc ingredient contains keyword, or keyword contains doc ingredient,
            // or the full query name contains the doc ingredient
            return docIng.includes(keyword) || keyword.includes(docIng) || queryIng.includes(docIng)
          })
          setDocuments(matched)
        }
      } catch (error) {
        console.error('Error loading ingredient data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [decodedIngredient])

  // Extract the core ingredient name from a detailed spec string
  function extractCoreIngredient(name) {
    // Remove parenthetical specs, percentages, extract ratios
    let core = name
      .replace(/\(.*?\)/g, '')           // Remove (Beta Vulgaris Root; 4% Nitrates)
      .replace(/\d+%\s*/g, '')           // Remove 5%, 98%
      .replace(/\d+:\d+\s*(min\s*)?/g, '')  // Remove 20:1 min
      .replace(/extract|powder|capsule|granular|beadlets/gi, '')  // Remove form words
      .replace(/natural|organic|pure|liposomal/gi, '')  // Remove qualifier words
      .replace(/\s+/g, ' ')
      .trim()
    // Take the first meaningful word(s) — usually the ingredient name
    // If very short after cleaning, use original
    if (core.length < 3) core = name.split(/[,(]/)[0].trim()
    return core
  }

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

  // Sort quotations
  const sortedQuotations = [...quotations].sort((a, b) => {
    let aVal = a[sortColumn]
    let bVal = b[sortColumn]

    // Handle supplier name from map
    if (sortColumn === 'supplier') {
      aVal = (supplierMap[a.supplier_id]?.name || a.supplier_name || '').toLowerCase()
      bVal = (supplierMap[b.supplier_id]?.name || b.supplier_name || '').toLowerCase()
    } else if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase()
      bVal = bVal.toLowerCase()
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  // Group documents by supplier
  const documentsBySupplier = documents.reduce((acc, doc) => {
    const supplierName = supplierMap[doc.supplier_id]?.name || 'Unknown'
    if (!acc[supplierName]) acc[supplierName] = []
    acc[supplierName].push(doc)
    return acc
  }, {})

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const findCheapest = () => {
    if (quotations.length === 0) return null
    return quotations.reduce((min, q) =>
      !min || (q.price_per_kg && q.price_per_kg < min.price_per_kg) ? q : min
    )
  }

  const cheapest = findCheapest()
  const numSuppliers = new Set(quotations.map(q => q.supplier_id || q.supplier_name)).size
  const avgPrice = quotations.length > 0
    ? (quotations.reduce((sum, q) => sum + (q.price_per_kg || 0), 0) / quotations.length).toFixed(2)
    : 0

  if (loading) {
    return (
      <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
        Loading ingredient details...
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

      {/* Ingredient header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {decodedIngredient}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {numSuppliers} supplier{numSuppliers !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Number of Suppliers', value: numSuppliers },
          { label: 'Average Price/kg', value: `$${avgPrice}` },
          { label: 'Best Price/kg', value: cheapest ? `$${cheapest.price_per_kg?.toFixed(2) || '—'}` : '—' },
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

      {/* Price Comparison Table */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Price Comparison
        </h2>

        {quotations.length === 0 ? (
          <p className="text-xs py-4" style={{ color: 'var(--text-faint)' }}>
            No quotations available
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {[
                    { key: 'supplier', label: 'Supplier' },
                    { key: 'tier', label: 'Tier' },
                    { key: 'price_per_kg', label: 'Price/kg' },
                    { key: 'moc', label: 'MOQ' },
                    { key: 'lead_time_days', label: 'Lead Time' },
                    { key: 'quote_date', label: 'Quote Date' },
                    { key: 'spec', label: 'Spec' },
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
                {sortedQuotations.map((quote, i) => {
                  const isCheapest = cheapest && quote.id === cheapest.id
                  const supplierInfo = supplierMap[quote.supplier_id]
                  const supplierTier = supplierInfo?.tier || 'new'
                  const tierColor = tierColors[supplierTier?.toLowerCase()] || tierColors.new
                  const rowBg = isCheapest ? 'rgba(16, 185, 129, 0.05)' : 'transparent'

                  return (
                    <tr
                      key={i}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background: rowBg,
                      }}
                    >
                      <td className="py-2 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {supplierInfo?.name || quote.supplier_name}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded"
                          style={{
                            background: tierColor.bg,
                            color: tierColor.text,
                          }}
                        >
                          {supplierTier}
                        </span>
                      </td>
                      <td
                        className="py-2 px-3 font-medium"
                        style={{
                          color: isCheapest ? '#10b981' : 'var(--text-body)',
                        }}
                      >
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
                      <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                        {quote.spec || '—'}
                      </td>
                      <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        {quote.notes ? quote.notes.substring(0, 40) + (quote.notes.length > 40 ? '...' : '') : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Documents Section */}
      <div>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Documents
        </h2>

        {documents.length === 0 ? (
          <p className="text-xs py-4" style={{ color: 'var(--text-faint)' }}>
            No documents available
          </p>
        ) : (
          <div className="space-y-4">
            {Object.entries(documentsBySupplier).map(([supplierName, docs]) => (
              <div key={supplierName}>
                <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                  {supplierName}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {docs.map((doc) => (
                    <div
                      key={doc.id}
                      className="rounded-lg border p-3 flex flex-col gap-2"
                      style={{
                        background: 'var(--bg-card)',
                        borderColor: 'var(--border-default)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                          {doc.filename}
                        </p>
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
                            href="#"
                          onClick={async (e) => {
                            e.preventDefault()
                            const { data } = await supabase.storage.from('supplier-documents').createSignedUrl(doc.storage_path, 3600)
                            if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                          }}
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
              </div>
            ))}
          </div>
        )}
      </div>

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
