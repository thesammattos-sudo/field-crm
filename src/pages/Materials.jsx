import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import ModalPortal from '../components/ModalPortal'
import ConfirmDialog from '../components/ConfirmDialog'

const getStatusColor = (status) => {
  const colors = {
    pending: 'bg-gray-100 text-gray-600',
    quoted: 'bg-purple-50 text-purple-600',
    ordered: 'bg-blue-50 text-blue-600',
    in_progress: 'bg-amber-50 text-amber-600',
    scheduled: 'bg-indigo-50 text-indigo-600',
    delivered: 'bg-green-50 text-green-600',
  }
  return colors[status] || 'bg-gray-100 text-gray-600'
}

const emptyMaterialForm = {
  name: '',
  quantity: '',
  price: '',
  supplier: '',
  project: '',
  delivery_date: '',
  status: 'pending',
}

function normalizeMaterial(row) {
  return {
    id: row.id,
    name: row.name ?? '',
    quantity: row.quantity ?? '',
    price: row.price ?? row.total ?? '',
    supplier: row.supplier ?? row.supplier_name ?? row.supplierName ?? '',
    project: row.project ?? row.project_name ?? row.projectName ?? '',
    delivery_date: row.delivery_date ?? row.deliveryDate ?? null,
    status: row.status ?? 'pending',
  }
}

function looksLikeMissingColumnError(message) {
  if (!message) return false
  return message.includes('column') && message.includes('does not exist')
}

export default function Materials() {
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyMaterialForm)
  const [confirmDelete, setConfirmDelete] = useState(null) // order

  async function fetchMaterials() {
    setLoading(true)
    setError('')
    let res = await supabase
      .from('materials')
      .select('*')
      .order('created_at', { ascending: false })

    if (res.error && looksLikeMissingColumnError(res.error.message)) {
      res = await supabase.from('materials').select('*')
    }

    if (res.error) {
      // Helpful message if table doesn't exist yet.
      const msg = res.error.message || 'Failed to load materials.'
      if (msg.includes('relation') && msg.includes('materials') && msg.includes('does not exist')) {
        setError('Supabase table "materials" does not exist yet. Create it in Supabase, then refresh this page.')
      } else {
        setError(msg)
      }
      setMaterials([])
      setLoading(false)
      return
    }

    setMaterials((res.data || []).map(normalizeMaterial))
    setLoading(false)
  }

  useEffect(() => {
    fetchMaterials()
  }, [])

  function openAddModal() {
    setEditing(null)
    setForm(emptyMaterialForm)
    setShowModal(true)
  }

  function openEditModal(order) {
    setEditing(order)
    const dateValue = order.delivery_date ? String(order.delivery_date).slice(0, 10) : ''
    setForm({
      name: order.name ?? '',
      quantity: order.quantity ?? '',
      price: order.price ?? '',
      supplier: order.supplier ?? '',
      project: order.project ?? '',
      delivery_date: dateValue,
      status: order.status ?? 'pending',
    })
    setShowModal(true)
  }

  function closeModal() {
    if (saving) return
    setShowModal(false)
    setEditing(null)
    setForm(emptyMaterialForm)
  }

  async function upsertMaterial(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payload = {
      name: form.name.trim(),
      quantity: form.quantity.trim(),
      price: form.price.trim(),
      supplier: form.supplier.trim(),
      project: form.project.trim(),
      delivery_date: form.delivery_date || null,
      status: form.status,
    }

    let res
    if (editing?.id) {
      res = await supabase.from('materials').update(payload).eq('id', editing.id).select('*').single()
    } else {
      res = await supabase.from('materials').insert(payload).select('*').single()
    }

    if (res.error) {
      setError(res.error.message || 'Failed to save order.')
      setSaving(false)
      return
    }

    const saved = normalizeMaterial(res.data || {})
    setMaterials(prev => {
      const idx = prev.findIndex(m => m.id === saved.id)
      if (idx === -1) return [saved, ...prev]
      const next = [...prev]
      next[idx] = saved
      return next
    })

    setSaving(false)
    closeModal()
  }

  async function deleteMaterial(order) {
    setError('')
    setDeleting(true)
    const { error: supaError } = await supabase.from('materials').delete().eq('id', order.id)
    if (supaError) {
      setError(supaError.message || 'Failed to delete order.')
      setDeleting(false)
      return
    }
    setMaterials(prev => prev.filter(m => m.id !== order.id))
    setDeleting(false)
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-semibold text-field-black tracking-tight">Materials</h1>
          <p className="text-field-stone mt-1">Orders & deliveries</p>
        </div>
        <button className="btn-primary" onClick={openAddModal}>+ New Order</button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card-static p-6 text-sm text-field-stone">Loading orders…</div>
      ) : materials.length === 0 ? (
        <div className="card-static p-8 text-center">
          <p className="text-field-black font-semibold">No orders yet</p>
          <p className="text-sm text-field-stone mt-1">Create your first material order to get started.</p>
          <button className="btn-primary mt-4" onClick={openAddModal}>+ New Order</button>
        </div>
      ) : null}

      {/* Mobile Cards */}
      <div className="lg:hidden space-y-3">
        {materials.map((m, i) => (
          <div key={m.id} className="card p-4 animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-semibold">{m.name}</h3>
              <span className={clsx("text-xs font-semibold px-2.5 py-1 rounded-full capitalize", getStatusColor(m.status))}>
                {m.status.replace('_', ' ')}
              </span>
            </div>
            <p className="text-sm text-field-stone mb-2">{m.supplier}</p>
            <div className="flex justify-between text-sm">
              <span className="text-field-stone">{m.project}</span>
              <span className="font-medium">{m.price || '—'}</span>
            </div>
            <p className="text-xs text-field-stone mt-2">Qty: {m.quantity}</p>
            <p className="text-xs text-field-stone mt-2">Delivery: {m.delivery_date || '—'}</p>

            <div className="flex items-center justify-end gap-2 mt-3">
              <button className="p-2 hover:bg-field-sand rounded-lg" onClick={() => openEditModal(m)} title="Edit">
                <Pencil className="w-4 h-4 text-field-stone" />
              </button>
              <button className="p-2 hover:bg-red-50 rounded-lg" onClick={() => setConfirmDelete(m)} title="Delete">
                <Trash2 className="w-4 h-4 text-red-600" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table */}
      {materials.length > 0 && (
        <div className="hidden lg:block card-static overflow-hidden">
        <div className="grid grid-cols-6 gap-4 px-6 py-4 bg-field-sand text-xs font-semibold text-field-stone uppercase tracking-wider">
          <div className="col-span-2">Material</div>
          <div>Supplier</div>
          <div>Project</div>
          <div>Delivery</div>
          <div>Status</div>
        </div>
        {materials.map((m, i) => (
          <div key={m.id} className="grid grid-cols-6 gap-4 px-6 py-4 border-t border-gray-100 items-center hover:bg-field-sand/50 animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="col-span-2">
              <p className="font-medium">{m.name}</p>
              <p className="text-sm text-field-stone">
                {m.quantity}{m.price ? ` · ${m.price}` : ''}
              </p>
            </div>
            <div className="text-sm text-field-stone">{m.supplier}</div>
            <div className="text-sm text-field-stone">{m.project}</div>
            <div className="text-sm text-field-stone">{m.delivery_date || '—'}</div>
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className={clsx("text-xs font-semibold px-2.5 py-1 rounded-full capitalize", getStatusColor(m.status))}>
                  {m.status.replace('_', ' ')}
                </span>
                <div className="flex items-center gap-2">
                  <button className="p-2 hover:bg-field-sand rounded-lg" onClick={() => openEditModal(m)} title="Edit">
                    <Pencil className="w-4 h-4 text-field-stone" />
                  </button>
                  <button className="p-2 hover:bg-red-50 rounded-lg" onClick={() => setConfirmDelete(m)} title="Delete">
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        </div>
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
                backgroundColor: 'white',
                borderRadius: '8px',
                padding: '24px',
                width: '100%',
                maxWidth: '450px',
                maxHeight: '85vh',
                overflowY: 'auto',
              }}
              onClick={(e) => e.stopPropagation()}
            >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>{editing ? 'Edit Order' : 'New Order'}</h2>
              <button type="button" onClick={closeModal} disabled={saving}>✕</button>
            </div>

            <form onSubmit={upsertMaterial} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label className="text-xs text-field-stone-light">Material name</label>
                  <input
                    className="input mt-1"
                    value={form.name}
                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-field-stone-light">Quantity</label>
                    <input
                      className="input mt-1"
                      value={form.quantity}
                      onChange={(e) => setForm(f => ({ ...f, quantity: e.target.value }))}
                      placeholder="8 pools / 10m² / 4 pallets…"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Price</label>
                    <input
                      className="input mt-1"
                      value={form.price}
                      onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                      placeholder="$18,000 / TBD…"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Supplier</label>
                    <input
                      className="input mt-1"
                      value={form.supplier}
                      onChange={(e) => setForm(f => ({ ...f, supplier: e.target.value }))}
                      placeholder="Supplier name…"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Project</label>
                    <input
                      className="input mt-1"
                      value={form.project}
                      onChange={(e) => setForm(f => ({ ...f, project: e.target.value }))}
                      placeholder="OMMA Villas…"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Delivery date</label>
                    <input
                      type="date"
                      className="input mt-1"
                      value={form.delivery_date}
                      onChange={(e) => setForm(f => ({ ...f, delivery_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Status</label>
                    <select
                      className="input mt-1"
                      value={form.status}
                      onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}
                    >
                      <option value="pending">Pending</option>
                      <option value="quoted">Quoted</option>
                      <option value="ordered">Ordered</option>
                      <option value="in_progress">In progress</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="delivered">Delivered</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Create Order')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete order?"
        message={confirmDelete?.name ? `Delete order "${confirmDelete.name}"? This cannot be undone.` : 'Delete this order? This cannot be undone.'}
        confirmText="Delete"
        cancelText="Cancel"
        loading={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete
          setConfirmDelete(null)
          if (target) await deleteMaterial(target)
        }}
      />
    </div>
  )
}
