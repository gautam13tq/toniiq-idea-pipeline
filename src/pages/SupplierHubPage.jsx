import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function SupplierHubPage() {
  const [activeTab, setActiveTab] = useState('supplier')
  const [suppliers, setSuppliers] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [ingredientSearch, setIngredientSearch] = useState('')

  const [stats, setStats] = useState({
    totalSuppliers: 0,
    totalIngredients: 0,
    totalQuotations: 0,
    totalDocuments: 0,
  })

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      try {
        // Load all data in 3 parallel queries instead of N+1
        const [suppliersRes, quotationsRes, docsRes] = await Promise.all([
          supabase.from('suppliers').select('id, name, tier, type, contact_name, email').order('name'),
          supabase.from('quotations').select('id, ingredient, supplier_id, supplier_name, price_per_kg, source_type'),
          supabase.from('supplier_documents').select('id, supplier_id, ingredient'),
        ])

        const supplierData = suppliersRes.data || []
        const quotationData = quotationsRes.data || []
        const docData = docsRes.data || []

        // Build supplier count maps client-side
        const quoteCountBySupplier = new Map()
        const ingredientsBySupplier = new Map()
        quotationData.forEach(q => {
          if (q.supplier_id) {
            quoteCountBySupplier.set(q.supplier_id, (quoteCountBySupplier.get(q.supplier_id) || 0) + 1)
            if (!ingredientsBySupplier.has(q.supplier_id)) ingredientsBySupplier.set(q.supplier_id, new Set())
            if (q.ingredient) ingredientsBySupplier.get(q.supplier_id).add(q.ingredient)
          }
        })

        const docCountBySupplier = new Map()
        docData.forEach(d => {
          if (d.supplier_id) docCountBySupplier.set(d.supplier_id, (docCountBySupplier.get(d.supplier_id) || 0) + 1)
        })

        // Enrich suppliers with counts
        const enrichedSuppliers = supplierData.map(s => ({
          ...s,
          ingredientCount: ingredientsBySupplier.get(s.id)?.size || 0,
          quotationCount: quoteCountBySupplier.get(s.id) || 0,
          documentCount: docCountBySupplier.get(s.id) || 0,
        }))
        setSuppliers(enrichedSuppliers)

        // Aggregate ingredients from quotations
        const ingredientMap = new Map()
        quotationData.forEach(q => {
          if (!q.ingredient) return
          if (!ingredientMap.has(q.ingredient)) {
            ingredientMap.set(q.ingredient, { name: q.ingredient, suppliers: new Set(), bestPrice: null })
          }
          const ing = ingredientMap.get(q.ingredient)
          ing.suppliers.add(q.supplier_id || q.supplier_name)
          if (q.price_per_kg && (!ing.bestPrice || q.price_per_kg < ing.bestPrice)) {
            ing.bestPrice = q.price_per_kg
          }
        })

        const ingredientList = Array.from(ingredientMap.values()).map(i => ({
          name: i.name,
          supplierCount: i.suppliers.size,
          bestPrice: i.bestPrice,
        }))
        setIngredients(ingredientList)

        setStats({
          totalSuppliers: supplierData.length,
          totalIngredients: ingredientList.length,
          totalQuotations: quotationData.length,
          totalDocuments: docData.length,
        })
      } catch (error) {
        console.error('Error loading data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(supplierSearch.toLowerCase())
  )

  const filteredIngredients = ingredients.filter(i =>
    i.name.toLowerCase().includes(ingredientSearch.toLowerCase())
  )

  const tierColors = {
    core: { bg: '#1e40af', text: '#3b82f6' },
    preferred: { bg: '#065f46', text: '#10b981' },
    new: { bg: '#374151', text: '#9ca3af' },
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Supplier Hub
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Manage suppliers, quotations, and ingredient sourcing
        </p>
      </div>

      {/* Stats bar */}
      <div
        className="grid grid-cols-4 gap-3 mb-6"
        style={{ gridAutoFlow: 'column' }}
      >
        {[
          { label: 'Total Suppliers', value: stats.totalSuppliers },
          { label: 'Total Ingredients', value: stats.totalIngredients },
          { label: 'Total Quotations', value: stats.totalQuotations },
          { label: 'Total Documents', value: stats.totalDocuments },
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

      {/* Tab selector */}
      <div className="flex items-center gap-6 mb-6 border-b" style={{ borderColor: 'var(--border-default)' }}>
        {['supplier', 'ingredient'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-2 py-3 text-sm font-medium transition-all"
            style={{
              color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === tab ? '2px solid var(--blue)' : 'transparent',
            }}
          >
            {tab === 'supplier' ? 'By Supplier' : 'By Ingredient'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>
          Loading suppliers and ingredients...
        </div>
      ) : activeTab === 'supplier' ? (
        /* Supplier View */
        <div>
          {/* Search */}
          <input
            type="text"
            placeholder="Search suppliers..."
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border mb-6 text-sm"
            style={{
              background: 'var(--bg-raised)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />

          {/* Supplier grid */}
          {filteredSuppliers.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No suppliers found
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSuppliers.map((supplier) => {
                const tierColor = tierColors[supplier.tier?.toLowerCase()] || tierColors.new
                return (
                  <Link
                    key={supplier.id}
                    to={`/suppliers/${supplier.id}`}
                    className="rounded-lg border p-4 transition-all hover:border-blue-500"
                    style={{
                      background: 'var(--bg-card)',
                      borderColor: 'var(--border-default)',
                    }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {supplier.name}
                      </h3>
                      <span
                        className="text-[11px] font-medium px-2 py-1 rounded-full"
                        style={{
                          background: tierColor.bg,
                          color: tierColor.text,
                        }}
                      >
                        {supplier.tier || 'New'}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <div className="flex justify-between">
                        <span>Ingredients:</span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {supplier.ingredientCount}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Quotations:</span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {supplier.quotationCount}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Documents:</span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {supplier.documentCount}
                        </span>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Ingredient View */
        <div>
          {/* Search */}
          <input
            type="text"
            placeholder="Search ingredients..."
            value={ingredientSearch}
            onChange={(e) => setIngredientSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border mb-6 text-sm"
            style={{
              background: 'var(--bg-raised)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />

          {/* Ingredient grid */}
          {filteredIngredients.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No ingredients found
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredIngredients.map((ingredient) => (
                <Link
                  key={ingredient.name}
                  to={`/suppliers/ingredient/${encodeURIComponent(ingredient.name)}`}
                  className="rounded-lg border p-4 transition-all hover:border-blue-500"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border-default)',
                  }}
                >
                  <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                    {ingredient.name}
                  </h3>

                  <div className="space-y-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <div className="flex justify-between">
                      <span>Suppliers:</span>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {ingredient.supplierCount}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Best Price:</span>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {ingredient.bestPrice ? `$${ingredient.bestPrice.toFixed(2)}/kg` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-medium"
                        style={{
                          background: ingredient.bestPrice ? '#065f4610' : '#1e40af10',
                          color: ingredient.bestPrice ? '#10b981' : '#3b82f6',
                        }}
                      >
                        {ingredient.bestPrice ? 'Active' : 'Sourcing'}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
