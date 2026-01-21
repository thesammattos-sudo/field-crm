import { useEffect, useMemo, useState } from 'react'
import { Phone, Home, FileText, Users, Search, MapPin, Pencil, Trash2, Mail, MessageCircle } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import ModalPortal from '../components/ModalPortal'
import ConfirmDialog from '../components/ConfirmDialog'
import { useLocation, useNavigate } from 'react-router-dom'

const getActivityIcon = (type) => {
  const icons = {
    call: Phone,
    email: Mail,
    meeting: Users,
    site_visit: Home,
    whatsapp: MessageCircle,
    follow_up: FileText,
    document_sent: FileText,
    inspection: Search,
    other: FileText,
  }
  const Icon = icons[type] || FileText
  return <Icon className="w-4 h-4" />
}

const getPriorityColor = (p) => p === 'high' ? 'border-field-gold' : p === 'medium' ? 'border-field-stone-light' : 'border-gray-300'

const emptyActivityForm = {
  title: '',
  type: 'call',
  leadName: '',
  projectName: '',
  contact: '',
  location: '',
  due_date: '',
  priority: 'medium',
  reminderEnabled: false,
  reminderDate: '',
  reminderTime: '',
  notes: '',
}

function looksLikeMissingColumnError(message) {
  if (!message) return false
  return message.includes('column') && message.includes('does not exist')
}

function normalizeActivity(row) {
  return {
    id: row.id,
    title: row.title ?? row.subject ?? '',
    type: row.type ?? 'follow_up',
    contact: row.contact ?? row.contact_name ?? row.contactName ?? '',
    location: row.location ?? null,
    // New text-based linking
    leadName: row.lead_name ?? row.leadName ?? row.lead ?? null,
    projectName: row.project_name ?? row.projectName ?? row.project ?? null,
    due_date: row.due_date ?? row.dueDate ?? row.time ?? null,
    priority: row.priority ?? 'medium',
    completed: row.completed ?? row.done ?? false,
    notes: row.notes ?? row.description ?? '',
    reminderEnabled: row.reminder_enabled ?? row.reminderEnabled ?? false,
    reminderDate: row.reminder_date ?? row.reminderDate ?? null,
    reminderTime: row.reminder_time ?? row.reminderTime ?? '',
    attachmentUrl: row.attachment_url ?? row.attachmentUrl ?? null,
    attachmentPath: row.attachment_path ?? row.attachmentPath ?? null,
    attachmentName: row.attachment_name ?? row.attachmentName ?? null,
    attachmentMimeType: row.attachment_mime_type ?? row.attachmentMimeType ?? null,
    attachmentSize: row.attachment_size ?? row.attachmentSize ?? null,
  }
}

function isToday(dateValue) {
  if (!dateValue) return false
  const d = new Date(dateValue)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export default function Activities() {
  const location = useLocation()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  // Dropdown data (we save names as text).
  const [leads, setLeads] = useState([])
  const projectOptions = useMemo(() => ([
    'OMMA Villas',
    'Tropicalia Breeze',
    'Tropicalia Villas',
  ]), [])

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyActivityForm)
  const [attachmentFile, setAttachmentFile] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null) // activity
  const [collapsedGroups, setCollapsedGroups] = useState(() => ({}))

  const leadFilter = useMemo(() => {
    const lead = new URLSearchParams(location.search).get('lead')
    return String(lead || '').trim()
  }, [location.search])

  const leadFilterKey = useMemo(() => leadFilter.toLowerCase(), [leadFilter])

  async function fetchActivities() {
    setLoading(true)
    setError('')

    let res = await supabase
      .from('activities')
      .select('*')
      .order('due_date', { ascending: true })

    if (res.error && looksLikeMissingColumnError(res.error.message)) {
      res = await supabase.from('activities').select('*')
    }

    if (res.error) {
      setError(res.error.message || 'Failed to load activities.')
      setActivities([])
      setLoading(false)
      return
    }

    setActivities((res.data || []).map(normalizeActivity))
    setLoading(false)
  }

  useEffect(() => {
    fetchActivities()
  }, [])

  useEffect(() => {
    // Fetch leads when the modal opens (so dropdown isn't empty).
    if (!showModal) return
    ;(async () => {
      const { data } = await supabase.from('leads').select('id,name')
      setLeads((data || []).filter(l => l?.name))
    })()
  }, [showModal])

  const filteredActivities = useMemo(() => {
    return activities.filter(a => {
      if (filter === 'all') return true
      if (filter === 'today') return isToday(a.due_date)
      if (filter === 'pending') return !a.completed
      return true
    })
  }, [activities, filter])

  const filteredActivitiesForLead = useMemo(() => {
    if (!leadFilter) return filteredActivities
    return filteredActivities.filter(a => String(a.leadName || '').trim().toLowerCase() === leadFilterKey)
  }, [filteredActivities, leadFilter, leadFilterKey])

  const groupedActivities = useMemo(() => {
    const map = new Map()
    for (const a of filteredActivitiesForLead) {
      const name = String(a.leadName || '').trim()
      const key = name || 'General'
      const arr = map.get(key) || []
      arr.push(a)
      map.set(key, arr)
    }

    // Sort groups: General first, then A→Z
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === 'General') return -1
      if (b === 'General') return 1
      return a.localeCompare(b)
    })

    return keys.map(k => {
      const items = (map.get(k) || []).slice().sort((x, y) => {
        const xd = x.due_date ? new Date(x.due_date).getTime() : Number.POSITIVE_INFINITY
        const yd = y.due_date ? new Date(y.due_date).getTime() : Number.POSITIVE_INFINITY
        if (xd !== yd) return xd - yd
        return String(x.title || '').localeCompare(String(y.title || ''))
      })
      const pendingCount = items.filter(i => !i.completed).length
      return { group: k, items, pendingCount }
    })
  }, [filteredActivitiesForLead])

  function clearLeadFilter() {
    const params = new URLSearchParams(location.search)
    params.delete('lead')
    const next = params.toString()
    navigate(next ? `/activities?${next}` : '/activities')
  }

  function openAddModal() {
    setEditing(null)
    setForm(emptyActivityForm)
    setAttachmentFile(null)
    setShowModal(true)
  }

  function openEditModal(activity) {
    setEditing(activity)
    const due = activity.due_date ? format(new Date(activity.due_date), 'yyyy-MM-dd') : ''
    const reminderDate = activity.reminderDate ? String(activity.reminderDate).slice(0, 10) : ''
    setForm({
      title: activity.title ?? '',
      type: activity.type ?? 'call',
      leadName: activity.leadName ?? '',
      projectName: activity.projectName ?? '',
      contact: activity.contact ?? '',
      location: activity.location ?? '',
      due_date: due,
      priority: activity.priority ?? 'medium',
      reminderEnabled: !!activity.reminderEnabled,
      reminderDate,
      reminderTime: activity.reminderTime ?? '',
      notes: activity.notes ?? '',
    })
    setAttachmentFile(null)
    setShowModal(true)
  }

  function closeModal() {
    if (saving) return
    setShowModal(false)
    setEditing(null)
    setForm(emptyActivityForm)
    setAttachmentFile(null)
  }

  async function upsertActivity(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    // Optional attachment upload
    let attachmentPath = null
    let attachmentUrl = null
    let attachmentMeta = null

    if (attachmentFile) {
      const bucket = 'activity-attachments'
      const safeName = attachmentFile.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '')
      const key = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      attachmentPath = `${key}-${safeName}`

      const uploadRes = await supabase.storage.from(bucket).upload(attachmentPath, attachmentFile)
      if (uploadRes.error) {
        setError(uploadRes.error.message || 'Failed to upload attachment.')
        setSaving(false)
        return
      }

      const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(attachmentPath)
      attachmentUrl = publicData?.publicUrl || null
      attachmentMeta = {
        attachment_path: attachmentPath,
        attachment_url: attachmentUrl,
        attachment_name: attachmentFile.name,
        attachment_mime_type: attachmentFile.type || null,
        attachment_size: typeof attachmentFile.size === 'number' ? attachmentFile.size : null,
      }
    }

    const leadName = String(form.leadName || '').trim()
    const projectName = String(form.projectName || '').trim()

    const payloadSnakeFull = {
      title: form.title.trim(),
      type: form.type,
      contact: form.contact.trim(),
      location: form.location.trim() || null,
      due_date: form.due_date || null,
      priority: form.priority,
      reminder_enabled: !!form.reminderEnabled,
      reminder_date: form.reminderEnabled ? (form.reminderDate || null) : null,
      reminder_time: form.reminderEnabled ? (form.reminderTime || null) : null,
      notes: form.notes.trim() || null,
      ...(attachmentMeta || {}),
    }

    // Use text-based linking (omit fields entirely if not selected)
    if (leadName) payloadSnakeFull.lead_name = leadName
    if (projectName) payloadSnakeFull.project_name = projectName

    // Debug: show values being sent to Supabase
    // eslint-disable-next-line no-console
    console.log('[Activities] upsert payload (snake)', payloadSnakeFull)

    const payloadSnakeMinimal = {
      title: form.title.trim(),
      type: form.type,
      contact: form.contact.trim(),
      due_date: form.due_date || null,
      priority: form.priority,
    }

    // Legacy fallback (older schema)
    const payloadAlt = {
      subject: form.title.trim(),
      type: form.type,
      contactName: form.contact.trim(),
      time: form.due_date || null,
      priority: form.priority,
    }

    // eslint-disable-next-line no-console
    console.log('[Activities] upsert payload (legacy)', payloadAlt)

    let result
    if (editing?.id) {
      result = await supabase.from('activities').update(payloadSnakeFull).eq('id', editing.id).select('*').single()
      if (result.error && looksLikeMissingColumnError(result.error.message)) {
        // try minimal fields
        result = await supabase.from('activities').update(payloadSnakeMinimal).eq('id', editing.id).select('*').single()
        if (result.error && looksLikeMissingColumnError(result.error.message)) {
          // last resort legacy schema
          result = await supabase.from('activities').update(payloadAlt).eq('id', editing.id).select('*').single()
        }
      }
    } else {
      result = await supabase.from('activities').insert({ ...payloadSnakeFull, completed: false }).select('*').single()
      if (result.error && looksLikeMissingColumnError(result.error.message)) {
        result = await supabase.from('activities').insert({ ...payloadSnakeMinimal, completed: false }).select('*').single()
        if (result.error && looksLikeMissingColumnError(result.error.message)) {
          result = await supabase.from('activities').insert({ ...payloadAlt, done: false }).select('*').single()
        }
      }
    }

    if (result.error) {
      // Cleanup attachment if we uploaded but DB write failed
      if (attachmentPath) {
        await supabase.storage.from('activity-attachments').remove([attachmentPath])
      }
      setError(result.error.message || 'Failed to save activity.')
      setSaving(false)
      return
    }

    const saved = normalizeActivity(result.data || {})
    setActivities(prev => {
      const idx = prev.findIndex(a => a.id === saved.id)
      if (idx === -1) return [saved, ...prev]
      const next = [...prev]
      next[idx] = saved
      return next
    })

    setSaving(false)
    closeModal()
  }

  async function deleteActivity(activity) {
    setError('')
    setDeleting(true)
    if (activity.attachmentPath) {
      await supabase.storage.from('activity-attachments').remove([activity.attachmentPath])
    }
    const { error: supaError } = await supabase.from('activities').delete().eq('id', activity.id)
    if (supaError) {
      setError(supaError.message || 'Failed to delete activity.')
      setDeleting(false)
      return
    }
    setActivities(prev => prev.filter(a => a.id !== activity.id))
    setDeleting(false)
  }

  async function toggleCompleted(activity) {
    const nextCompleted = !activity.completed
    setActivities(prev => prev.map(a => a.id === activity.id ? { ...a, completed: nextCompleted } : a))

    let result = await supabase.from('activities').update({ completed: nextCompleted }).eq('id', activity.id).select('*').single()
    if (result.error && looksLikeMissingColumnError(result.error.message)) {
      result = await supabase.from('activities').update({ done: nextCompleted }).eq('id', activity.id).select('*').single()
    }

    if (result.error) {
      setActivities(prev => prev.map(a => a.id === activity.id ? { ...a, completed: activity.completed } : a))
      setError(result.error.message || 'Failed to update activity.')
      return
    }

    const saved = normalizeActivity(result.data || {})
    setActivities(prev => prev.map(a => a.id === saved.id ? saved : a))
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-semibold text-field-black tracking-tight">Activities</h1>
          <p className="text-field-stone mt-1">Tasks & follow-ups</p>
        </div>
        <button className="btn-primary" onClick={openAddModal}>+ Add Activity</button>
      </div>

      {leadFilter && (
        <div className="mb-4 p-3 rounded-xl bg-field-sand border border-gray-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-field-black truncate">
              Viewing activities for: <span className="font-semibold">{leadFilter}</span>
            </p>
            <p className="text-xs text-field-stone">Clear the filter to see all leads.</p>
          </div>
          <button type="button" className="btn-secondary !px-3 !py-2" onClick={clearLeadFilter}>
            Clear
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {['all', 'today', 'pending'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              "px-4 py-2 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition-colors",
              filter === f ? "bg-field-black text-white" : "bg-field-sand text-field-stone hover:bg-gray-200"
            )}
          >
            {f === 'all' ? 'All Tasks' : f === 'today' ? 'Today' : 'Pending'}
          </button>
        ))}
      </div>

      <div className="card-static p-4 lg:p-6">
        {loading ? (
          <div className="text-sm text-field-stone">Loading activities…</div>
        ) : (
          <div className="space-y-5">
            {groupedActivities.map(({ group, items, pendingCount }) => {
              const isCollapsed = !!collapsedGroups[group]
              return (
                <div key={group} className="border border-gray-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-field-sand hover:bg-gray-200 transition-colors"
                    onClick={() => setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }))}
                  >
                    <div className="min-w-0 text-left">
                      <p className="font-semibold text-field-black truncate">
                        {group}
                      </p>
                      <p className="text-xs text-field-stone mt-0.5">
                        {items.length} activit{items.length === 1 ? 'y' : 'ies'} · {pendingCount} pending
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-field-black bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                      {isCollapsed ? 'Show' : 'Hide'}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="p-3 space-y-3">
                      {items.map((activity, i) => {
                        const dueLabel = activity.due_date
                          ? (isToday(activity.due_date) ? 'Today' : format(new Date(activity.due_date), 'MMM d, yyyy'))
                          : 'No due date'

                        const projectName = activity.projectName || null

                        return (
                          <div
                            key={activity.id ?? `${group}-${i}`}
                            className={clsx(
                              "flex items-center gap-4 p-4 rounded-xl border-l-4 transition-all animate-fade-in",
                              activity.completed ? "bg-gray-50 border-gray-300 opacity-60" : "bg-field-sand",
                              !activity.completed && getPriorityColor(activity.priority)
                            )}
                            style={{ animationDelay: `${i * 30}ms` }}
                          >
                            <div className={clsx(
                              "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                              activity.completed ? "bg-gray-200" : "bg-white border border-gray-200"
                            )}>
                              {getActivityIcon(activity.type)}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className={clsx("font-medium", activity.completed && "line-through text-field-stone")}>
                                {activity.title}
                              </p>
                              <p className="text-sm text-field-stone">
                                {activity.contact || '—'}
                                {projectName && <span className="ml-2 text-field-stone-light">· Project: {projectName}</span>}
                                {activity.location && (
                                  <span className="inline-flex items-center gap-1 ml-2">
                                    <MapPin className="w-3 h-3" /> {activity.location}
                                  </span>
                                )}
                              </p>
                            </div>

                            <div className="text-right flex-shrink-0">
                              <p className={clsx(
                                "text-sm font-medium",
                                isToday(activity.due_date) && !activity.completed ? "text-field-black" : "text-field-stone"
                              )}>
                                {dueLabel}
                              </p>
                              <p className={clsx(
                                "text-xs font-semibold uppercase",
                                activity.priority === 'high' ? "text-field-gold" : "text-field-stone-light"
                              )}>
                                {activity.priority}
                              </p>
                            </div>

                            <input
                              type="checkbox"
                              className="h-5 w-5 rounded border-gray-300 accent-field-black"
                              checked={!!activity.completed}
                              onChange={() => toggleCompleted(activity)}
                              aria-label="Mark complete"
                            />

                            <button
                              className="w-9 h-9 rounded-lg hover:bg-white/60 flex items-center justify-center transition-colors"
                              title="Edit"
                              onClick={() => openEditModal(activity)}
                            >
                              <Pencil className="w-4 h-4 text-field-stone" />
                            </button>
                            <button
                              className="w-9 h-9 rounded-lg hover:bg-red-50 flex items-center justify-center transition-colors"
                              title="Delete"
                              onClick={() => setConfirmDelete(activity)}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {groupedActivities.length === 0 && (
              <div className="text-center py-12 text-field-stone">
                <p>No activities found</p>
              </div>
            )}
          </div>
        )}
      </div>

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
                {editing ? 'Edit Activity' : 'Add Activity'}
              </h2>
              <button type="button" onClick={closeModal} disabled={saving}>✕</button>
            </div>

            <form onSubmit={upsertActivity} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label className="text-xs text-field-stone-light">Title</label>
                  <input
                    className="input mt-1"
                    value={form.title}
                    onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Type */}
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Type</label>
                    <select
                      className="input mt-1"
                      value={form.type}
                      onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
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

                  {/* Link to Lead */}
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Link to Lead</label>
                    <select
                      className="input mt-1"
                      value={form.leadName}
                      onChange={(e) => setForm(f => ({ ...f, leadName: e.target.value }))}
                    >
                      <option value="">Select a lead…</option>
                      {leads.map((lead) => (
                        <option key={lead.id} value={lead.name}>{lead.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Link to Project */}
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Link to Project</label>
                    <select
                      className="input mt-1"
                      value={form.projectName}
                      onChange={(e) => setForm(f => ({ ...f, projectName: e.target.value }))}
                    >
                      <option value="">Select a project…</option>
                      {projectOptions.map((project) => (
                        <option key={project} value={project}>{project}</option>
                      ))}
                    </select>
                  </div>

                  {/* Contact */}
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Contact</label>
                    <input
                      className="input mt-1"
                      value={form.contact}
                      onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))}
                      placeholder="Client / Contractor…"
                    />
                  </div>

                  {/* Location */}
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Location</label>
                    <input
                      className="input mt-1"
                      value={form.location}
                      onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))}
                      placeholder="Meeting address / site location…"
                    />
                  </div>

                  {/* Due date */}
                  <div>
                    <label className="text-xs text-field-stone-light">Due date</label>
                    <input
                      type="date"
                      className="input mt-1"
                      value={form.due_date}
                      onChange={(e) => setForm(f => ({ ...f, due_date: e.target.value }))}
                    />
                  </div>

                  {/* Priority */}
                  <div>
                    <label className="text-xs text-field-stone-light">Priority</label>
                    <select
                      className="input mt-1"
                      value={form.priority}
                      onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>

                  {/* Reminder */}
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Reminder</label>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="flex items-center gap-2 text-sm text-field-stone">
                        <input
                          type="checkbox"
                          checked={!!form.reminderEnabled}
                          onChange={(e) => setForm(f => ({ ...f, reminderEnabled: e.target.checked }))}
                        />
                        Reminder on/off
                      </label>
                    </div>

                    {form.reminderEnabled && (
                      <div className="mt-3 grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-field-stone-light">Reminder Date</label>
                          <input
                            type="date"
                            className="input mt-1"
                            value={form.reminderDate || ''}
                            onChange={(e) => setForm(f => ({ ...f, reminderDate: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-field-stone-light">Reminder Time</label>
                          <input
                            type="time"
                            className="input mt-1"
                            value={form.reminderTime || ''}
                            onChange={(e) => setForm(f => ({ ...f, reminderTime: e.target.value }))}
                          />
                        </div>
                      </div>
                    )}
                    <p className="text-[11px] text-field-stone mt-1">
                      (This stores reminder settings; notifications require backend scheduling.)
                    </p>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs text-field-stone-light">Notes / Description</label>
                  <textarea
                    className="input mt-1 min-h-[90px]"
                    value={form.notes}
                    onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Add details about the activity…"
                  />
                </div>

                {/* Attachment */}
                <div>
                  <label className="text-xs text-field-stone-light">Attachment</label>
                  <input
                    type="file"
                    className="input mt-1"
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                    onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
                  />
                  <p className="text-[11px] text-field-stone mt-1">
                    Uploads to Supabase Storage bucket <span className="font-mono">activity-attachments</span>.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Activity')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete activity?"
        message={confirmDelete?.title ? `Delete activity "${confirmDelete.title}"? This cannot be undone.` : 'Delete this activity? This cannot be undone.'}
        confirmText="Delete"
        cancelText="Cancel"
        loading={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete
          setConfirmDelete(null)
          if (target) await deleteActivity(target)
        }}
      />
    </div>
  )
}

