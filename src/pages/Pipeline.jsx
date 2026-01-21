import { useEffect, useMemo, useState } from 'react'
import { Phone, Mail, MessageCircle } from 'lucide-react'
import { pipelineStages } from '../data'
import ModalPortal from '../components/ModalPortal'
import ConfirmDialog from '../components/ConfirmDialog'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'

const stageIdSet = new Set(pipelineStages.map(s => s.id))
const stageLabelToId = Object.fromEntries(
  pipelineStages.map(s => [String(s.label || '').trim().toLowerCase(), s.id])
)

function normalizeStageId(raw) {
  const rawStr = String(raw ?? '').trim()
  if (!rawStr) return 'new'

  // If it's already a stage id, keep it.
  if (stageIdSet.has(rawStr)) return rawStr
  const rawLower = rawStr.toLowerCase()
  if (stageIdSet.has(rawLower)) return rawLower

  // If it's a label (e.g. "Qualified", "PDF Sent"), map to id.
  if (stageLabelToId[rawLower]) return stageLabelToId[rawLower]

  // Normalize common variants (spaces/hyphens) -> underscores.
  const token = rawLower.replace(/[-\s]+/g, '_')
  if (stageIdSet.has(token)) return token
  const tokenAsLabel = token.replace(/_/g, ' ')
  if (stageLabelToId[tokenAsLabel]) return stageLabelToId[tokenAsLabel]

  // Known special cases.
  const special = {
    booked: 'won',
    won: 'won',
    closed_won: 'won',
    closedwon: 'won',
    pdf: 'pdf_sent',
  }
  if (special[token]) return special[token]

  // Fallback: keep pipeline usable.
  return 'new'
}

const emptyLeadForm = {
  name: '',
  phone: '',
  email: '',

  source: 'Website',

  project: '',
  unit: '',
  budget: '',
  investmentType: '',

  stage: 'new',
  priority: 'medium',
  lastContactDate: '',

  country: '',
  notes: '',
}

export default function Pipeline() {
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [activities, setActivities] = useState([])

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
    const rawStage = row.stage ?? row.stage_id ?? row.stageId ?? row.stage_label ?? row.stageLabel ?? ''
    const country = row.country ?? row.origin_country ?? row.originCountry ?? ''
    const investmentType = row.investment_type ?? row.investmentType ?? row.investment ?? ''

    // If interest was stored as a combined string (e.g. "OMMA Villas - Unit 3"), try to split it.
    let project = interestedIn || ''
    let unit = interestedUnit || ''
    if (project && !unit) {
      const m = String(project).match(/^\s*(.+?)\s*[-–—|•]\s*(Unit\s*\d+)\s*$/i)
      if (m) {
        project = m[1]
        unit = m[2]
      }
    }

    return {
      uid: `db-${row.id}`,
      dbId: row.id,
      id: row.id,
      name: row.name ?? '',
      email: row.email ?? null,
      phone: row.phone ?? '',
      stage: normalizeStageId(rawStage),
      priority: normalizePriority(row.priority),
      source: row.source ?? 'Website',
      budgetDisplay,
      interestedIn: project || '',
      interestedUnit: unit || '',
      notes: row.notes ?? '',
      lastContactDate: lastContactDate || '',
      nextActivity: row.next_activity ?? row.nextActivity ?? null,
      nextActivityDisplay: row.next_activity_display ?? row.nextActivityDisplay ?? '',
      country,
      investmentType,
    }
  }

  function normalizePriority(raw) {
    const v = String(raw ?? '').trim().toLowerCase()
    if (!v) return 'medium'
    if (v === 'hot') return 'high'
    if (v === 'warm') return 'medium'
    if (v === 'cold') return 'low'
    if (v === 'high' || v === 'medium' || v === 'low') return v
    return 'medium'
  }

  const projectOptions = useMemo(() => ([
    'OMMA Villas',
    'Tropicalia Breeze',
    'Tropicalia Villas',
  ]), [])

  const unitOptions = useMemo(() => {
    const project = String(form.project || '').trim()
    const makeUnits = (count, soldOut) => Array.from({ length: count }, (_, i) => {
      const unitNum = i + 1
      const label = soldOut ? `Unit ${unitNum} (Sold out)` : `Unit ${unitNum}`
      return { value: `Unit ${unitNum}`, label, disabled: !!soldOut }
    })
    if (project === 'OMMA Villas') return makeUnits(8, false)
    if (project === 'Tropicalia Breeze') return makeUnits(6, false)
    if (project === 'Tropicalia Villas') return makeUnits(6, true)
    return []
  }, [form.project])

  async function fetchLeadsFromSupabase() {
    setError('')

    if (import.meta.env.DEV) console.log('Fetching leads from Supabase...')

    let res = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (res.error && looksLikeMissingColumnError(res.error.message)) {
      res = await supabase.from('leads').select('*')
    }

    if (import.meta.env.DEV) {
      console.log('Leads:', res.data)
      console.log('Error:', res.error)
    }

    if (res.error) {
      const msg = res.error.message || 'Failed to load leads.'
      if (!looksLikeMissingRelationError(msg)) setError(msg)
      return
    }

    const dbLeads = (res.data || []).map(normalizeDbLead)
    if (import.meta.env.DEV) {
      console.log('Normalized leads:', dbLeads)
      console.log('Lead count:', dbLeads.length)
      console.log('Stage distribution:', dbLeads.reduce((acc, l) => {
        acc[l.stage] = (acc[l.stage] || 0) + 1
        return acc
      }, {}))
    }
    setLeads(dbLeads)
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
    const fetchLeads = async () => {
      await fetchLeadsFromSupabase()
    }

    ;(async () => {
      setLoading(true)
      await Promise.all([fetchLeads(), fetchActivitiesForPipeline()])
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
    setForm({
      name: lead.name || '',
      phone: lead.phone || '',
      email: lead.email || '',
      source: lead.source || 'Website',

      project: lead.interestedIn || '',
      unit: lead.interestedUnit || '',
      budget: lead.budgetDisplay || '',
      investmentType: lead.investmentType || '',
      stage: lead.stage || 'new',
      priority: normalizePriority(lead.priority),
      lastContactDate: lead.lastContactDate || lead.createdAt || '',

      country: lead.country || '',
      notes: lead.notes || '',
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

  function viewActivitiesForLead() {
    const leadName = String(editingLead?.name || '').trim()
    if (!leadName) return
    closeModal()
    navigate(`/activities?lead=${encodeURIComponent(leadName)}`)
  }

  async function upsertLeadWithFallbacks({ isEditing, dbId, payloads }) {
    let last = null
    for (const payload of payloads) {
      let res
      if (isEditing && dbId) {
        res = await supabase.from('leads').update(payload).eq('id', dbId).select('*').single()
      } else {
        res = await supabase.from('leads').insert(payload).select('*').single()
      }

      last = res
      if (!res.error) return res
      if (looksLikeMissingColumnError(res.error.message)) continue
      return res
    }
    return last
  }

  async function saveLead(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const name = form.name.trim()
    const phone = form.phone.trim()
    const email = form.email.trim() || null

    if (!name || !phone) {
      setError('Name and Phone are required.')
      setSaving(false)
      return
    }

    const project = String(form.project || '').trim() || null
    const unit = String(form.unit || '').trim() || null
    const budget = String(form.budget || '').trim() || null
    const investmentType = String(form.investmentType || '').trim() || null
    const country = String(form.country || '').trim() || null
    const notes = String(form.notes || '').trim() || null

    const payloadFullSnake = {
      name,
      phone,
      email,
      source: form.source,
      stage: form.stage,
      priority: form.priority,
      last_contact_date: form.lastContactDate || null,
      interest: project,
      interested_unit: unit,
      budget,
      investment_type: investmentType,
      country,
      notes,
    }

    const payloadSnakeNoExtras = {
      name,
      phone,
      email,
      source: form.source,
      stage: form.stage,
      priority: form.priority,
      last_contact_date: form.lastContactDate || null,
      interest: project ? (unit ? `${project} - ${unit}` : project) : null,
      budget,
      notes,
    }

    const payloadCamel = {
      name,
      phone,
      email,
      source: form.source,
      stage: form.stage,
      priority: form.priority,
      lastContactDate: form.lastContactDate || null,
      interestedIn: project,
      interestedUnit: unit,
      budgetDisplay: budget,
      investmentType,
      country,
      notes,
    }

    const payloadMinimal = {
      name,
      phone,
      email,
      source: form.source,
      stage: form.stage,
      notes,
    }

    const isEditing = !!editingLead
    const dbId = editingLead?.dbId ?? null
    const prevName = editingLead?.name || ''
    const nextName = form.name.trim()

    const res = await upsertLeadWithFallbacks({
      isEditing,
      dbId,
      payloads: [payloadFullSnake, payloadSnakeNoExtras, payloadCamel, payloadMinimal],
    })

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
        {pipelineStages.map((stage, i) => {
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {editingLead && (
                    <button
                      type="button"
                      onClick={viewActivitiesForLead}
                      disabled={saving}
                      className="text-sm font-medium text-field-stone hover:text-field-black hover:underline"
                      style={{ background: 'transparent', padding: 0 }}
                    >
                      View Activities →
                    </button>
                  )}
                  <button type="button" onClick={closeModal} disabled={saving}>✕</button>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={saveLead} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Required */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-field-stone-light uppercase tracking-wider mb-3">Required</p>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-field-stone-light">Name <span className="text-red-600">*</span></label>
                      <input
                        className="input mt-1"
                        value={form.name}
                        onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-field-stone-light">Phone <span className="text-red-600">*</span></label>
                        <input
                          className="input mt-1"
                          value={form.phone}
                          onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                          placeholder="+62 8xx xxx xxxx"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs text-field-stone-light">Email</label>
                        <input
                          type="email"
                          className="input mt-1"
                          value={form.email}
                          onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                          placeholder="name@email.com"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Lead Source */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-field-stone-light uppercase tracking-wider mb-3">Lead Source</p>
                  <div>
                    <label className="text-xs text-field-stone-light">Source</label>
                    <select
                      className="input mt-1"
                      value={form.source}
                      onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))}
                    >
                      {['Instagram', 'Facebook', 'Website', 'Referral', 'Agent', 'Walk-in', 'WhatsApp', 'Other'].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Interest */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-field-stone-light uppercase tracking-wider mb-3">Interest</p>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-field-stone-light">Project</label>
                      <select
                        className="input mt-1"
                        value={form.project}
                        onChange={(e) => {
                          const nextProject = e.target.value
                          setForm(f => {
                            const next = { ...f, project: nextProject }
                            // reset unit if it doesn't apply
                            next.unit = ''
                            return next
                          })
                        }}
                      >
                        <option value="">Select project…</option>
                        {projectOptions.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-field-stone-light">Unit</label>
                      <select
                        className="input mt-1"
                        value={form.unit}
                        onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                        disabled={!form.project}
                      >
                        <option value="">{form.project ? 'Select unit…' : 'Select a project first…'}</option>
                        {unitOptions.map(u => (
                          <option key={u.value} value={u.value} disabled={u.disabled}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                      {form.project === 'Tropicalia Villas' && (
                        <p className="text-[11px] text-field-stone mt-1">Tropicalia Villas is sold out.</p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-field-stone-light">Budget</label>
                      <select
                        className="input mt-1"
                        value={form.budget}
                        onChange={(e) => setForm(f => ({ ...f, budget: e.target.value }))}
                      >
                        <option value="">Select budget…</option>
                        {['$100K-130K', '$130K-200K', '$200K-300K', '$300K+'].map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-field-stone-light">Investment Type</label>
                      <select
                        className="input mt-1"
                        value={form.investmentType}
                        onChange={(e) => setForm(f => ({ ...f, investmentType: e.target.value }))}
                      >
                        <option value="">Select type…</option>
                        {['Personal Use', 'Rental Investment', 'Resale'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Qualification */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-field-stone-light uppercase tracking-wider mb-3">Qualification</p>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="text-xs text-field-stone-light">Stage</label>
                      <select
                        className="input mt-1"
                        value={form.stage}
                        onChange={(e) => setForm(f => ({ ...f, stage: e.target.value }))}
                      >
                        <option value="new">New Lead</option>
                        <option value="contacted">Contacted</option>
                        <option value="qualified">Qualified</option>
                        <option value="pdf_sent">PDF Sent</option>
                        <option value="site_visit">Site Visit</option>
                        <option value="negotiating">Negotiating</option>
                        <option value="won">Closed Won</option>
                        <option value="lost">Closed Lost</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-field-stone-light">Priority</label>
                      <select
                        className="input mt-1"
                        value={form.priority}
                        onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}
                      >
                        <option value="high">Hot</option>
                        <option value="medium">Warm</option>
                        <option value="low">Cold</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-field-stone-light">Last Contact Date</label>
                      <input
                        type="date"
                        className="input mt-1"
                        value={form.lastContactDate || ''}
                        onChange={(e) => setForm(f => ({ ...f, lastContactDate: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Additional */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-field-stone-light uppercase tracking-wider mb-3">Additional</p>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-field-stone-light">Country</label>
                      <input
                        className="input mt-1"
                        value={form.country}
                        onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))}
                        placeholder="Australia"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-field-stone-light">Notes</label>
                      <textarea
                        className="input mt-1 min-h-[90px]"
                        value={form.notes}
                        onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                      />
                    </div>
                  </div>
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
