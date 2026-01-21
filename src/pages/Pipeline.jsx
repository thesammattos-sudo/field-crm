import { useEffect, useMemo, useState } from 'react'
import { Phone, Mail, MessageCircle } from 'lucide-react'
import { pipelineStages } from '../data'
import ModalPortal from '../components/ModalPortal'
import ConfirmDialog from '../components/ConfirmDialog'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

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

const emptyQuickActivity = {
  title: '',
  type: 'call',
  due_date: '',
  priority: 'medium',
  notes: '',
}

export default function Pipeline() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [activities, setActivities] = useState([])
  const [showAddActivity, setShowAddActivity] = useState(false)
  const [activitySaving, setActivitySaving] = useState(false)
  const [activityError, setActivityError] = useState('')
  const [activityForm, setActivityForm] = useState(emptyQuickActivity)

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

  function normalizeNameKey(value) {
    return String(value || '').trim().toLowerCase()
  }

  function normalizeDbActivity(row) {
    const due = row.due_date ?? row.dueDate ?? row.time ?? null
    const completed = row.completed ?? row.done ?? false
    const leadName = row.lead_name ?? row.leadName ?? row.lead ?? null
    return {
      id: row.id,
      title: row.title ?? row.subject ?? '',
      type: row.type ?? 'follow_up',
      due_date: due,
      completed: !!completed,
      leadName: leadName ? String(leadName) : '',
      priority: row.priority ?? 'medium',
    }
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
    setLeads(dbLeads)
    setLoading(false)
  }

  async function fetchActivitiesForPipeline() {
    let res = await supabase
      .from('activities')
      .select('*')
      .order('due_date', { ascending: true })

    if (res.error && looksLikeMissingColumnError(res.error.message)) {
      res = await supabase.from('activities').select('*')
    }

    if (res.error) {
      // Don't hard-fail the pipeline if activities table isn't ready.
      return
    }

    setActivities((res.data || []).map(normalizeDbActivity))
  }

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      await Promise.all([fetchLeadsFromSupabase(), fetchActivitiesForPipeline()])
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activitiesByLead = useMemo(() => {
    const map = new Map()
    for (const a of activities) {
      const key = normalizeNameKey(a.leadName)
      if (!key) continue
      const arr = map.get(key) || []
      arr.push(a)
      map.set(key, arr)
    }
    // sort each list by due date then title
    for (const [k, arr] of map.entries()) {
      arr.sort((x, y) => {
        const xd = x.due_date ? new Date(x.due_date).getTime() : Number.POSITIVE_INFINITY
        const yd = y.due_date ? new Date(y.due_date).getTime() : Number.POSITIVE_INFINITY
        if (xd !== yd) return xd - yd
        return String(x.title || '').localeCompare(String(y.title || ''))
      })
      map.set(k, arr)
    }
    return map
  }, [activities])

  function pendingCountForLeadName(leadName) {
    const list = activitiesByLead.get(normalizeNameKey(leadName)) || []
    return list.filter(a => !a.completed).length
  }

  function nextPendingDueForLeadName(leadName) {
    const list = activitiesByLead.get(normalizeNameKey(leadName)) || []
    const pending = list.filter(a => !a.completed && a.due_date)
    if (pending.length === 0) return null
    const min = pending
      .map(a => new Date(a.due_date))
      .filter(d => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0]
    return min || null
  }

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
    setShowAddActivity(false)
    setActivityError('')
    setActivityForm(emptyQuickActivity)
  }

  function openAddActivityForLead() {
    setActivityError('')
    setActivityForm(emptyQuickActivity)
    setShowAddActivity(true)
  }

  async function addActivityForLead(e) {
    e.preventDefault()
    if (!editingLead) return
    setActivitySaving(true)
    setActivityError('')

    const leadName = String(form.name || editingLead.name || '').trim()
    const payload = {
      title: String(activityForm.title || '').trim(),
      type: activityForm.type,
      due_date: activityForm.due_date || null,
      priority: activityForm.priority,
      completed: false,
      lead_name: leadName || null,
      notes: String(activityForm.notes || '').trim() || null,
    }
    // omit lead_name if empty
    if (!leadName) delete payload.lead_name

    let res = await supabase.from('activities').insert(payload).select('*').single()
    if (res.error && looksLikeMissingColumnError(res.error.message)) {
      // minimal fallback
      const minimal = { title: payload.title, type: payload.type, due_date: payload.due_date, priority: payload.priority }
      if (payload.lead_name) minimal.lead_name = payload.lead_name
      res = await supabase.from('activities').insert(minimal).select('*').single()
    }

    if (res.error) {
      setActivityError(res.error.message || 'Failed to add activity.')
      setActivitySaving(false)
      return
    }

    setActivities(prev => [normalizeDbActivity(res.data || {}), ...prev])
    setActivitySaving(false)
    setShowAddActivity(false)
    setActivityForm(emptyQuickActivity)
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
    const prevName = editingLead?.name || ''
    const nextName = form.name.trim()

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

    // Keep activities linked when lead name changes (best effort).
    if (isEditing && prevName && nextName && prevName !== nextName) {
      const actRes = await supabase.from('activities').update({ lead_name: nextName }).eq('lead_name', prevName)
      if (!actRes.error) {
        setActivities(prev => prev.map(a => (normalizeNameKey(a.leadName) === normalizeNameKey(prevName) ? { ...a, leadName: nextName } : a)))
      }
    }

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
                {stageLeads.map((lead, j) => {
                  const pendingCount = pendingCountForLeadName(lead.name)
                  const nextDue = nextPendingDueForLeadName(lead.name)
                  return (
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
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-field-stone bg-field-sand px-2 py-1 rounded">{lead.source}</span>
                        {pendingCount > 0 && (
                          <span className="text-[11px] font-semibold text-field-black bg-field-sand px-2 py-1 rounded">
                            {pendingCount} task{pendingCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-field-stone-light">
                        {nextDue ? format(nextDue, 'MMM d') : (lead.nextActivityDisplay || '')}
                      </span>
                    </div>
                  </div>
                  )
                })}
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

                {editingLead && (
                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-field-black">Activities</h3>
                      <button type="button" className="btn-secondary !px-3 !py-2" onClick={openAddActivityForLead}>
                        + Add Activity
                      </button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {(activitiesByLead.get(normalizeNameKey(form.name || editingLead.name)) || []).map((a) => {
                        const dueLabel = a.due_date ? format(new Date(a.due_date), 'MMM d, yyyy') : 'No due date'
                        return (
                          <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-field-sand">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-field-black truncate">{a.title}</p>
                              <p className="text-[11px] text-field-stone">
                                {String(a.type).replace('_', ' ')} · {dueLabel}
                              </p>
                            </div>
                            <span className={clsx(
                              "text-[11px] font-semibold px-2 py-1 rounded-full",
                              a.completed ? "bg-field-black text-white" : "bg-white border border-gray-200 text-field-black"
                            )}>
                              {a.completed ? 'Completed' : 'Pending'}
                            </span>
                          </div>
                        )
                      })}
                      {(activitiesByLead.get(normalizeNameKey(form.name || editingLead.name)) || []).length === 0 && (
                        <div className="text-sm text-field-stone py-2">
                          No activities linked to this lead yet.
                        </div>
                      )}
                    </div>
                  </div>
                )}

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

      {showAddActivity && editingLead && (
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
          }} onClick={() => setShowAddActivity(false)}>
            <div style={{
              backgroundColor: 'var(--fieldcrm-panel)',
              borderRadius: '8px',
              padding: '24px',
              width: '100%',
              maxWidth: '450px',
              maxHeight: '85vh',
              overflowY: 'auto',
              color: 'var(--fieldcrm-text)',
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>Add Activity</h2>
                <button type="button" onClick={() => setShowAddActivity(false)} disabled={activitySaving}>✕</button>
              </div>

              {activityError && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {activityError}
                </div>
              )}

              <p className="text-sm text-field-stone mb-4">
                Lead: <span className="font-semibold text-field-black">{form.name || editingLead.name}</span>
              </p>

              <form onSubmit={addActivityForLead} className="space-y-4">
                <div>
                  <label className="text-xs text-field-stone-light">Title</label>
                  <input
                    className="input mt-1"
                    value={activityForm.title}
                    onChange={(e) => setActivityForm(f => ({ ...f, title: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-field-stone-light">Type</label>
                    <select
                      className="input mt-1"
                      value={activityForm.type}
                      onChange={(e) => setActivityForm(f => ({ ...f, type: e.target.value }))}
                    >
                      <option value="call">Call</option>
                      <option value="email">Email</option>
                      <option value="meeting">Meeting</option>
                      <option value="site_visit">Site Visit</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="follow_up">Follow-up</option>
                      <option value="document_sent">Document Sent</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Due date</label>
                    <input
                      type="date"
                      className="input mt-1"
                      value={activityForm.due_date}
                      onChange={(e) => setActivityForm(f => ({ ...f, due_date: e.target.value }))}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Priority</label>
                    <select
                      className="input mt-1"
                      value={activityForm.priority}
                      onChange={(e) => setActivityForm(f => ({ ...f, priority: e.target.value }))}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-field-stone-light">Notes</label>
                  <textarea
                    className="input mt-1 min-h-[90px]"
                    value={activityForm.notes}
                    onChange={(e) => setActivityForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={() => setShowAddActivity(false)} disabled={activitySaving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={activitySaving}>
                    {activitySaving ? 'Saving…' : 'Add Activity'}
                  </button>
                </div>
              </form>
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
