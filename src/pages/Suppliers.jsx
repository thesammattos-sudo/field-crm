import { useEffect, useMemo, useState } from 'react'
import { X, Phone, Mail, Star, Pencil, Trash2 } from 'lucide-react'
import { materials } from '../data'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import ModalPortal from '../components/ModalPortal'
import ConfirmDialog from '../components/ConfirmDialog'

const emptySupplierForm = {
  name: '',
  category: '',
  subcategory: '',
  contact: '',
  phone: '',
  email: '',
  rating: 5,
  activeOrders: 0,
  totalOrders: 0,
  paymentTerms: '',
  notes: '',
}

function normalizeSupplier(row) {
  return {
    id: row.id,
    name: row.name ?? '',
    category: row.category ?? '',
    subcategory: row.subcategory ?? '',
    contact: row.contact ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    rating: row.rating ?? 0,
    activeOrders: row.active_orders ?? row.activeOrders ?? 0,
    totalOrders: row.total_orders ?? row.totalOrders ?? 0,
    paymentTerms: row.payment_terms ?? row.paymentTerms ?? '',
    notes: row.notes ?? '',
  }
}

function buildSupplierPayload(form, variant) {
  const rating = Number(form.rating) || 0
  const activeOrders = Number(form.activeOrders) || 0
  const totalOrders = Number(form.totalOrders) || 0

  if (variant === 'camel') {
    return {
      name: form.name?.trim(),
      category: form.category?.trim(),
      subcategory: form.subcategory?.trim(),
      contact: form.contact?.trim(),
      phone: form.phone?.trim(),
      email: form.email?.trim(),
      rating,
      activeOrders,
      totalOrders,
      paymentTerms: form.paymentTerms?.trim(),
      notes: form.notes?.trim(),
    }
  }

  // default: snake_case
  return {
    name: form.name?.trim(),
    category: form.category?.trim(),
    subcategory: form.subcategory?.trim(),
    contact: form.contact?.trim(),
    phone: form.phone?.trim(),
    email: form.email?.trim(),
    rating,
    active_orders: activeOrders,
    total_orders: totalOrders,
    payment_terms: form.paymentTerms?.trim(),
    notes: form.notes?.trim(),
  }
}

function looksLikeMissingColumnError(message) {
  if (!message) return false
  return message.includes('column') && message.includes('does not exist')
}

export default function Suppliers() {
  const [selected, setSelected] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptySupplierForm)
  const [confirmDelete, setConfirmDelete] = useState(null) // supplier

  const selectedSupplier = useMemo(() => {
    if (!selected) return null
    return suppliers.find(s => s.id === selected.id) || selected
  }, [selected, suppliers])

  async function fetchSuppliers() {
    setLoading(true)
    setError('')
    const { data, error: supaError } = await supabase.from('suppliers').select('*')
    if (supaError) {
      setError(supaError.message || 'Failed to load suppliers.')
      setSuppliers([])
      setLoading(false)
      return
    }
    setSuppliers((data || []).map(normalizeSupplier))
    setLoading(false)
  }

  useEffect(() => {
    fetchSuppliers()
  }, [])

  function openAddModal() {
    setEditing(null)
    setForm(emptySupplierForm)
    setShowModal(true)
  }

  function openEditModal(supplier) {
    setEditing(supplier)
    setForm({
      ...emptySupplierForm,
      ...supplier,
      rating: supplier.rating ?? 0,
      activeOrders: supplier.activeOrders ?? 0,
      totalOrders: supplier.totalOrders ?? 0,
    })
    setShowModal(true)
  }

  function closeModal() {
    if (saving) return
    setShowModal(false)
    setEditing(null)
    setForm(emptySupplierForm)
  }

  async function upsertSupplier(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payloadSnake = buildSupplierPayload(form, 'snake')
    const payloadCamel = buildSupplierPayload(form, 'camel')

    let result
    if (editing?.id) {
      result = await supabase.from('suppliers').update(payloadSnake).eq('id', editing.id).select('*').single()
      if (result.error && looksLikeMissingColumnError(result.error.message)) {
        result = await supabase.from('suppliers').update(payloadCamel).eq('id', editing.id).select('*').single()
      }
    } else {
      result = await supabase.from('suppliers').insert(payloadSnake).select('*').single()
      if (result.error && looksLikeMissingColumnError(result.error.message)) {
        result = await supabase.from('suppliers').insert(payloadCamel).select('*').single()
      }
    }

    if (result.error) {
      setError(result.error.message || 'Failed to save supplier.')
      setSaving(false)
      return
    }

    const saved = normalizeSupplier(result.data || {})
    setSuppliers(prev => {
      const idx = prev.findIndex(s => s.id === saved.id)
      if (idx === -1) return [saved, ...prev]
      const next = [...prev]
      next[idx] = saved
      return next
    })

    setSaving(false)
    closeModal()
  }

  async function deleteSupplier(supplier) {
    setError('')
    setDeleting(true)
    const { error: supaError } = await supabase.from('suppliers').delete().eq('id', supplier.id)
    if (supaError) {
      setError(supaError.message || 'Failed to delete supplier.')
      setDeleting(false)
      return
    }

    setSuppliers(prev => prev.filter(s => s.id !== supplier.id))
    if (selected?.id === supplier.id) setSelected(null)
    setDeleting(false)
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-semibold text-field-black tracking-tight">Suppliers</h1>
          <p className="text-field-stone mt-1">Construction partners</p>
        </div>
        <button className="btn-primary" onClick={openAddModal}>+ Add Supplier</button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card-static p-6 text-sm text-field-stone">Loading suppliers…</div>
      ) : suppliers.length === 0 ? (
        <div className="card-static p-8 text-center">
          <p className="text-field-black font-semibold">No suppliers yet</p>
          <p className="text-sm text-field-stone mt-1">Add your first supplier to get started.</p>
          <button className="btn-primary mt-4" onClick={openAddModal}>+ Add Supplier</button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {suppliers.map((s, i) => (
            <div
              key={s.id ?? i}
              className="card p-5 cursor-pointer animate-fade-in"
              style={{ animationDelay: `${i * 50}ms` }}
              onClick={() => setSelected(s)}
            >
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-field-black flex items-center justify-center text-white font-semibold flex-shrink-0">
                  {s.name ? s.name.split(' ').map(w => w[0]).join('').slice(0, 2) : 'S'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{s.name}</h3>
                      <p className="text-sm text-field-stone">{s.subcategory || s.category}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        className="p-2 hover:bg-field-sand rounded-lg"
                        title="Edit"
                        onClick={(e) => { e.stopPropagation(); openEditModal(s) }}
                      >
                        <Pencil className="w-4 h-4 text-field-stone" />
                      </button>
                      <button
                        className="p-2 hover:bg-red-50 rounded-lg"
                        title="Delete"
                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(s) }}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 mt-2">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={clsx("w-3.5 h-3.5", i < (s.rating || 0) ? "fill-field-gold text-field-gold" : "text-gray-300")} />
                    ))}
                  </div>
                </div>
                {s.activeOrders > 0 && (
                  <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg h-fit">{s.activeOrders} active</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedSupplier && (
        <ModalPortal>
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }} onClick={() => setSelected(null)}>
            <div style={{
              backgroundColor: 'var(--fieldcrm-panel)',
              borderRadius: '8px',
              padding: '24px',
              width: '100%',
              maxWidth: '500px',
              maxHeight: '85vh',
              overflowY: 'auto',
              color: 'var(--fieldcrm-text)',
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>{selectedSupplier.name}</h2>
                <button type="button" onClick={() => setSelected(null)}>✕</button>
              </div>

              <div className="flex gap-4 mb-6">
                <div className="w-16 h-16 rounded-xl bg-field-black flex items-center justify-center text-white font-semibold text-xl shrink-0">
                  {selectedSupplier.name ? selectedSupplier.name.split(' ').map(w => w[0]).join('').slice(0, 2) : 'S'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-field-stone">{selectedSupplier.category} · {selectedSupplier.subcategory}</p>
                  <div className="flex items-center gap-1 mt-2">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={clsx("w-4 h-4", i < (selectedSupplier.rating || 0) ? "fill-field-gold text-field-gold" : "text-gray-300")} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-field-sand rounded-lg mb-6">
                <p className="text-sm text-field-stone">📝 {selectedSupplier.notes || '—'}</p>
              </div>

              <div className="space-y-4 mb-6">
                <div><p className="text-xs text-field-stone-light mb-1">Contact</p><p className="font-medium">{selectedSupplier.contact || '—'}</p></div>
                <div><p className="text-xs text-field-stone-light mb-1">Phone</p><p className="font-medium">{selectedSupplier.phone || '—'}</p></div>
                <div><p className="text-xs text-field-stone-light mb-1">Email</p><p className="font-medium">{selectedSupplier.email || '—'}</p></div>
                <div><p className="text-xs text-field-stone-light mb-1">Payment Terms</p><p className="font-medium">{selectedSupplier.paymentTerms || '—'}</p></div>
              </div>

              <h3 className="font-semibold mb-3">Recent Orders</h3>
              {materials.filter(m => m.supplierId === selectedSupplier.id).length > 0 ? (
                <div className="space-y-2">
                  {materials.filter(m => m.supplierId === selectedSupplier.id).map(m => (
                    <div key={m.id} className="flex justify-between p-3 bg-field-sand rounded-lg">
                      <div><p className="font-medium text-sm">{m.name}</p><p className="text-xs text-field-stone">{m.project}</p></div>
                      <div className="text-right"><p className="font-semibold text-sm">{m.total}</p><p className="text-xs text-field-stone capitalize">{m.status}</p></div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-field-stone text-center py-4">No orders yet</p>
              )}

              <div className="flex gap-3 mt-6">
                <a
                  href={selectedSupplier.phone ? `tel:${selectedSupplier.phone}` : undefined}
                  className={clsx(
                    "flex-1 btn-primary flex items-center justify-center gap-2",
                    !selectedSupplier.phone && "opacity-50 pointer-events-none"
                  )}
                >
                  <Phone className="w-4 h-4" /> Call
                </a>
                <a
                  href={selectedSupplier.email ? `mailto:${selectedSupplier.email}` : undefined}
                  className={clsx(
                    "flex-1 btn-secondary flex items-center justify-center gap-2",
                    !selectedSupplier.email && "opacity-50 pointer-events-none"
                  )}
                >
                  <Mail className="w-4 h-4" /> Email
                </a>
              </div>

              <div className="flex gap-3 mt-3">
                <button
                  type="button"
                  className="flex-1 btn-secondary"
                  onClick={() => { setSelected(null); openEditModal(selectedSupplier) }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="flex-1 btn-secondary text-red-700 hover:bg-red-50"
                  onClick={() => setConfirmDelete(selectedSupplier)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {showModal && (
        <ModalPortal>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '16px',
            }}
            onClick={closeModal}
          >
            <div
              style={{
                backgroundColor: 'var(--fieldcrm-panel)',
                borderRadius: '8px',
                padding: '24px',
                width: '100%',
                maxWidth: '450px',
                maxHeight: '85vh',
                overflowY: 'auto',
                color: 'var(--fieldcrm-text)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>
                {editing ? 'Edit Supplier' : 'Add Supplier'}
              </h2>
              <button type="button" onClick={closeModal} disabled={saving}>✕</button>
            </div>

            <form
              onSubmit={upsertSupplier}
              style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
            >
              {/* Name (always first) */}
              <div>
                <label className="text-xs text-field-stone-light">Name</label>
                <input
                  className="input mt-1"
                  value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-field-stone-light">Contact</label>
                  <input
                    className="input mt-1"
                    value={form.contact}
                    onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-field-stone-light">Phone</label>
                  <input
                    className="input mt-1"
                    value={form.phone}
                    onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-field-stone-light">Email</label>
                  <input
                    type="email"
                    className="input mt-1"
                    value={form.email}
                    onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-field-stone-light">Rating (0–5)</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    className="input mt-1"
                    value={form.rating}
                    onChange={(e) => setForm(f => ({ ...f, rating: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-field-stone-light">Category</label>
                  <input
                    className="input mt-1"
                    value={form.category}
                    onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="Materials / Contractor"
                  />
                </div>
                <div>
                  <label className="text-xs text-field-stone-light">Subcategory</label>
                  <input
                    className="input mt-1"
                    value={form.subcategory}
                    onChange={(e) => setForm(f => ({ ...f, subcategory: e.target.value }))}
                    placeholder="Stone & Tile / Electrical…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-field-stone-light">Payment Terms</label>
                  <input
                    className="input mt-1"
                    value={form.paymentTerms}
                    onChange={(e) => setForm(f => ({ ...f, paymentTerms: e.target.value }))}
                    placeholder="Net 30 / COD / 50% upfront…"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-field-stone-light">Notes</label>
                <textarea
                  className="input mt-1 min-h-[90px]"
                  value={form.notes}
                  onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Add any notes about the supplier…"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Supplier')}
                </button>
              </div>
            </form>
          </div>
          </div>
        </ModalPortal>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete supplier?"
        message={confirmDelete?.name ? `Delete supplier "${confirmDelete.name}"? This cannot be undone.` : 'Delete this supplier? This cannot be undone.'}
        confirmText="Delete"
        cancelText="Cancel"
        loading={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete
          setConfirmDelete(null)
          if (target) await deleteSupplier(target)
        }}
      />
    </div>
  )
}
