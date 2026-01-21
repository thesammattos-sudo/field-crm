import { useEffect, useMemo, useState } from 'react'
import { Phone, Mail, MessageCircle } from 'lucide-react'
import { leads as initialLeads, pipelineStages } from '../data'
import ModalPortal from '../components/ModalPortal'
import ConfirmDialog from '../components/ConfirmDialog'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'

const emptyLeadForm = {
  name: '',
  email: '',
  phone: '',
  budget: '',
  source: 'Website',
  interest: '',
  stage: 'new',
  notes: '',
  lastContactDate: '',
}

export default function Pipeline() {
  const [leads, setLeads] = useState(() => (
    (initialLeads || []).map(l => ({
      ...l,
      uid: `local-${l.id}`,
      dbId: null,
      lastContactDate: l.lastContactDate || l.createdAt || '',
    }))
  ))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [editingLead, setEditingLead] = useState(null) // lead object or null for new
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyLeadForm)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const stageLabelById = useMemo(() => {
    return Object.fromEntries(pipelineStages.map(s => [s.id, s.label]))
  }, [])

  const getPriorityColor = (p) => p === 'high' ? 'bg-field-gold' : p === 'medium' ? 'bg-field-stone-light' : 'bg-gray-300'

  function looksLikeMissingRelationError(message) {
    if (!message) return false
    return message.includes('relation') && message.includes('leads') && message.includes('does not exist')
  }

  function looksLikeMissingColumnError(message) {
    if (!message) return false
    return message.includes('column') && message.includes('does not exist')
  }

  function leadKey(lead) {
    const email = (lead.email || '').toString().trim().toLowerCase()
    if (email) return `email:${email}`
    const phone = (lead.phone || '').toString().replace(/[^0-9]/g, '')
    if (phone) return `phone:${phone}`
    const name = (lead.name || '').toString().trim().toLowerCase()
    return `name:${name}`
  }

  function normalizeDbLead(row) {
    const interestedIn = row.interestedIn ?? row.interested_in ?? row.interest ?? ''
    const interestedUnit = row.interestedUnit ?? row.interested_unit ?? ''
    const budgetDisplay = row.budget_display ?? row.budgetDisplay ?? row.budget ?? ''
    const lastContactDate = row.last_contact_date ?? row.lastContactDate ?? ''

    return {
      uid: `db-${row.id}`,
      dbId: row.id,
      id: row.id,
      name: row.name ?? '',
      email: row.email ?? null,
      phone: row.phone ?? '',
      stage: row.stage ?? 'new',
      priority: row.priority ?? 'medium',
      source: row.source ?? 'Website',
      budgetDisplay,
      interestedIn,
      interestedUnit,
      notes: row.notes ?? '',
      lastContactDate: lastContactDate || '',
      nextActivity: row.next_activity ?? row.nextActivity ?? null,
      nextActivityDisplay: row.next_activity_display ?? row.nextActivityDisplay ?? '',
    }
  }

  async function fetchLeadsFromSupabase() {
    setLoading(true)
    setError('')

    let res = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (res.error && looksLikeMissingColumnError(res.error.message)) {
      res = await supabase.from('leads').select('*')
    }

    if (res.error) {
      const msg = res.error.message || 'Failed to load leads.'
      if (!looksLikeMissingRelationError(msg)) setError(msg)
      setLoading(false)
      return
    }

    const dbLeads = (res.data || []).map(normalizeDbLead)
    if (dbLeads.length === 0) {
      setLoading(false)
      return
    }

    setLeads(prev => {
      const map = new Map()
      // Start with local leads
      for (const l of prev) map.set(leadKey(l), l)
      // Overlay/append Supabase leads
      for (const l of dbLeads) map.set(leadKey(l), l)
      return Array.from(map.values())
    })
    setLoading(false)
  }

  useEffect(() => {
    fetchLeadsFromSupabase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openAddModal() {
    setError('')
    setEditingLead(null)
    setForm(emptyLeadForm)
    setShowModal(true)
  }

  function openEditModal(lead) {
    setError('')
    setEditingLead(lead)
    const interestCombined = [lead.interestedIn, lead.interestedUnit].filter(Boolean).join(' - ')
    setForm({
      name: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      budget: lead.budgetDisplay || '',
      source: lead.source || 'Website',
      interest: interestCombined || '',
      stage: lead.stage || 'new',
      notes: lead.notes || '',
      lastContactDate: lead.lastContactDate || lead.createdAt || '',
    })
    setShowModal(true)
  }

  function closeModal() {
    if (saving) return
    setShowModal(false)
    setEditingLead(null)
    setForm(emptyLeadForm)
    setConfirmDeleteOpen(false)
  }

  async function saveLead(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payloadPreferred = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      budget: form.budget.trim() || null,
      source: form.source,
      interest: form.interest.trim() || null,
      stage: form.stage,
      notes: form.notes.trim() || null,
      last_contact_date: form.lastContactDate || null,
    }

    const payloadAlt = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      budgetDisplay: form.budget.trim() || null,
      source: form.source,
      interestedIn: form.interest.trim() || null,
      stage: form.stage,
      notes: form.notes.trim() || null,
      lastContactDate: form.lastContactDate || null,
    }

    const isEditing = !!editingLead
    const dbId = editingLead?.dbId ?? null

    let res
    if (isEditing && dbId) {
      res = await supabase.from('leads').update(payloadPreferred).eq('id', dbId).select('*').single()
      if (res.error && looksLikeMissingColumnError(res.error.message)) {
        res = await supabase.from('leads').update(payloadAlt).eq('id', dbId).select('*').single()
      }
    } else {
      res = await supabase.from('leads').insert(payloadPreferred).select('*').single()
      if (res.error && looksLikeMissingColumnError(res.error.message)) {
        res = await supabase.from('leads').insert(payloadAlt).select('*').single()
      }
    }

    if (res.error) {
      const msg = res.error.message || 'Failed to save lead.'
      if (looksLikeMissingRelationError(msg)) {
        setError('Supabase table "leads" does not exist yet. Create it in Supabase, then try again.')
      } else {
        setError(msg)
      }
      setSaving(false)
      return
    }

    const saved = normalizeDbLead(res.data || {})
    setLeads(prev => {
      if (editingLead?.uid) {
        return prev.map(l => l.uid === editingLead.uid ? saved : l)
      }
      return [saved, ...prev]
    })

    setSaving(false)
    closeModal()
  }

  async function deleteLead() {
    if (!editingLead) return
    setError('')
    setDeleting(true)
    if (editingLead.dbId) {
      const res = await supabase.from('leads').delete().eq('id', editingLead.dbId)
      if (res.error) {
        setError(res.error.message || 'Failed to delete lead.')
        setDeleting(false)
        return
      }
    }

    setLeads(prev => prev.filter(l => l.uid !== editingLead.uid))
    setDeleting(false)
    closeModal()
  }

  async function moveLeadToStage(lead, stageId) {
    // optimistic UI update
    setLeads(prev => prev.map(l => l.uid === lead.uid ? { ...l, stage: stageId } : l))
    if (lead.dbId) {
      const res = await supabase.from('leads').update({ stage: stageId }).eq('id', lead.dbId)
      if (res.error) {
        // rollback
        setLeads(prev => prev.map(l => l.uid === lead.uid ? { ...l, stage: lead.stage } : l))
        setError(res.error.message || 'Failed to move lead.')
      }
    }
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-semibold text-field-black tracking-tight">Pipeline</h1>
          <p className="text-field-stone mt-1">Track investor leads</p>
        </div>
        <button className="btn-primary" onClick={openAddModal}>+ Add Lead</button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Pipeline Board */}
      <div className="flex gap-4 overflow-x-auto pb-6">
        {pipelineStages.filter(s => s.id !== 'lost').map((stage, i) => {
          const stageLeads = leads.filter(l => l.stage === stage.id)
          return (
            <div 
              key={stage.id} 
              className="min-w-[300px] max-w-[300px] animate-fade-in"
              style={{ animationDelay: `${i * 50}ms` }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const uid = e.dataTransfer.getData('text/lead-uid')
                const lead = leads.find(l => l.uid === uid)
                if (lead) moveLeadToStage(lead, stage.id)
              }}
            >
              {/* Stage Header */}
              <div className="flex items-center gap-2 mb-4 px-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="font-semibold text-sm">{stage.label}</span>
                <span className="text-xs text-field-stone bg-field-sand px-2 py-0.5 rounded-full">
                  {stageLeads.length}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-3">
                {loading && i === 0 && (
                  <div className="text-xs text-field-stone px-1">Syncing leads…</div>
                )}
                {stageLeads.map((lead, j) => (
                  <div 
                    key={lead.uid}
                    className="card p-4 cursor-pointer animate-fade-in"
                    style={{ animationDelay: `${(i * 50) + (j * 80)}ms` }}
                    onClick={() => openEditModal(lead)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/lead-uid', lead.uid)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-semibold text-sm">{lead.name}</span>
                      <div className="flex items-center gap-2">
                        <a
                          href={lead.phone ? `https://wa.me/${String(lead.phone).replace(/[^0-9]/g, '')}` : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="WhatsApp"
                          draggable={false}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          className={clsx(
                            "w-7 h-7 rounded-lg flex items-center justify-center bg-[#25D366]/15 text-[#128C7E] hover:bg-[#25D366]/25 transition-colors",
                            !lead.phone && "opacity-50 pointer-events-none"
                          )}
                        >
                          <MessageCircle className="w-4 h-4" />
                        </a>
                        <div className={clsx("w-2 h-2 rounded-full", getPriorityColor(lead.priority))} />
                      </div>
                    </div>
                    <p className="font-display text-xl font-semibold text-field-black mb-2">{lead.budgetDisplay}</p>
                    <p className="text-xs text-field-stone mb-3">{lead.interestedIn} {lead.interestedUnit && `- ${lead.interestedUnit}`}</p>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-field-stone bg-field-sand px-2 py-1 rounded">{lead.source}</span>
                      <span className="text-[11px] text-field-stone-light">{lead.nextActivityDisplay}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {showModal && (
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
          }} onClick={closeModal}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              width: '100%',
              maxWidth: '500px',
              maxHeight: '85vh',
              overflowY: 'auto',
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>
                  {editingLead ? 'Lead Details' : 'Add Lead'}
                </h2>
                <button type="button" onClick={closeModal} disabled={saving}>✕</button>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={saveLead} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                    <label className="text-xs text-field-stone-light">Email</label>
                    <input
                      type="email"
                      className="input mt-1"
                      value={form.email}
                      onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
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
                    <label className="text-xs text-field-stone-light">Budget</label>
                    <input
                      className="input mt-1"
                      value={form.budget}
                      onChange={(e) => setForm(f => ({ ...f, budget: e.target.value }))}
                      placeholder="$130K"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Source</label>
                    <select
                      className="input mt-1"
                      value={form.source}
                      onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))}
                    >
                      <option value="Website">Website</option>
                      <option value="Instagram">Instagram</option>
                      <option value="Referral">Referral</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Interest</label>
                    <input
                      className="input mt-1"
                      value={form.interest}
                      onChange={(e) => setForm(f => ({ ...f, interest: e.target.value }))}
                      placeholder="Which property/unit?"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Stage</label>
                    <select
                      className="input mt-1"
                      value={form.stage}
                      onChange={(e) => setForm(f => ({ ...f, stage: e.target.value }))}
                    >
                      {pipelineStages.filter(s => s.id !== 'lost').map(s => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Last contact date</label>
                    <input
                      type="date"
                      className="input mt-1"
                      value={form.lastContactDate || ''}
                      onChange={(e) => setForm(f => ({ ...f, lastContactDate: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-field-stone-light">Notes</label>
                  <textarea
                    className="input mt-1 min-h-[90px]"
                    value={form.notes}
                    onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  {editingLead && (
                    <button
                      type="button"
                      className="btn-secondary text-red-700 hover:bg-red-50"
                      onClick={() => setConfirmDeleteOpen(true)}
                      disabled={saving || deleting}
                    >
                      Delete
                    </button>
                  )}
                  <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : (editingLead ? 'Save Changes' : 'Add Lead')}
                  </button>
                </div>
              </form>

              {editingLead && (
                <div className="mt-6 pt-6 border-t border-gray-100">
                  <div className="flex gap-3">
                    <a
                      href={form.phone ? `tel:${form.phone}` : undefined}
                      className={clsx("flex-1 btn-primary flex items-center justify-center gap-2", !form.phone && "opacity-50 pointer-events-none")}
                    >
                      <Phone className="w-4 h-4" /> Call
                    </a>
                    <a
                      href={form.email ? `mailto:${form.email}` : undefined}
                      className={clsx("flex-1 btn-secondary flex items-center justify-center gap-2", !form.email && "opacity-50 pointer-events-none")}
                    >
                      <Mail className="w-4 h-4" /> Email
                    </a>
                  </div>
                  <a
                    href={form.phone ? `https://wa.me/${String(form.phone).replace(/[^0-9]/g, '')}` : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={clsx(
                      "flex items-center justify-center gap-2 w-full mt-3 py-3 bg-[#25D366] text-white rounded-lg font-medium text-sm",
                      !form.phone && "opacity-50 pointer-events-none"
                    )}
                  >
                    <MessageCircle className="w-4 h-4" /> WhatsApp
                  </a>
                  <p className="text-xs text-field-stone mt-2">
                    Current stage: {stageLabelById[form.stage] || form.stage}
                  </p>
                </div>
              )}
            </div>
          </div>
        </ModalPortal>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete lead?"
        message={editingLead?.name ? `Delete lead "${editingLead.name}"? This cannot be undone.` : 'Delete this lead? This cannot be undone.'}
        confirmText="Delete"
        cancelText="Cancel"
        loading={deleting}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          setConfirmDeleteOpen(false)
          await deleteLead()
        }}
      />
    </div>
  )
}
