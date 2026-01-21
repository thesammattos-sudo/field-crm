import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, DollarSign, ArrowRight, Phone, CheckCircle2, FileText, CheckSquare, AlertTriangle } from 'lucide-react'
import { projects as initialProjects, leads as initialLeads, pipelineStages, companyInfo } from '../data'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { format, formatDistanceToNow } from 'date-fns'
import ModalPortal from '../components/ModalPortal'

function looksLikeMissingRelationError(message, table) {
  if (!message) return false
  return message.includes('relation') && message.includes(table) && message.includes('does not exist')
}

function looksLikeMissingColumnError(message) {
  if (!message) return false
  return message.includes('column') && message.includes('does not exist')
}

function parseMoneyLike(value) {
  if (value == null) return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const s = String(value).trim()
  if (!s) return 0
  const lower = s.toLowerCase()
  const multiplier = lower.includes('m') ? 1_000_000 : lower.includes('k') ? 1_000 : 1
  const m = lower.replace(/,/g, '').match(/(\d+(\.\d+)?)/)
  const num = m ? Number(m[1]) : 0
  return Number.isFinite(num) ? num * multiplier : 0
}

function formatUsdCompact(amount) {
  const n = Number(amount) || 0
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString()}`
}

const stageIdSet = new Set(pipelineStages.map(s => s.id))
const stageLabelToId = Object.fromEntries(
  pipelineStages.map(s => [String(s.label || '').trim().toLowerCase(), s.id])
)

function normalizeStageId(raw) {
  const rawStr = String(raw ?? '').trim()
  if (!rawStr) return 'new'
  if (stageIdSet.has(rawStr)) return rawStr
  const lower = rawStr.toLowerCase()
  if (stageIdSet.has(lower)) return lower
  if (stageLabelToId[lower]) return stageLabelToId[lower]

  const token = lower.replace(/[-\s]+/g, '_')
  if (stageIdSet.has(token)) return token

  const special = {
    booked: 'won',
    won: 'won',
    closed_won: 'won',
    closedwon: 'won',
    closed_lost: 'lost',
    closedlost: 'lost',
    pdf: 'pdf_sent',
  }
  if (special[token]) return special[token]

  return 'new'
}

function parseBudgetForTotal(value) {
  if (value == null) return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const s = String(value).trim()
  if (!s) return 0

  // Handle ranges like "$100K-130K"
  const parts = s.replace(/\s+/g, '').split('-')
  const pick = parts.length >= 2 ? parts[1] : parts[0]
  // Handle "+": "$300K+"
  const cleaned = pick.replace('+', '')
  const lower = cleaned.toLowerCase()
  const multiplier = lower.includes('m') ? 1_000_000 : lower.includes('k') ? 1_000 : 1
  const m = lower.replace(/,/g, '').match(/(\d+(\.\d+)?)/)
  const num = m ? Number(m[1]) : 0
  return Number.isFinite(num) ? num * multiplier : 0
}

function parseMonthYear(value) {
  if (!value) return null
  const m = String(value).match(/([A-Za-z]{3,})\s+(\d{4})/)
  if (!m) return null
  const d = new Date(`${m[1]} 1, ${m[2]}`)
  return Number.isNaN(d.getTime()) ? null : d
}

function getCompletionDate(project) {
  const direct = project?.completionDate || project?.completion_date || null
  if (direct) {
    const d = new Date(direct)
    if (!Number.isNaN(d.getTime())) return d
  }
  const fromString = parseMonthYear(project?.completion)
  if (fromString) return fromString
  const milestoneCompletion = project?.milestones?.find(m => String(m?.name || '').toLowerCase().includes('completion'))?.date
  const fromMilestone = parseMonthYear(milestoneCompletion)
  return fromMilestone || null
}

function computeProgress(project) {
  const p = project?.progress ?? project?.progress_percent ?? null
  if (typeof p === 'number' && Number.isFinite(p)) return Math.max(0, Math.min(100, p))
  const status = project?.status
  if (status === 'complete') return 100
  if (status === 'construction') return 65
  if (status === 'pre_construction') return 25
  if (status === 'planning') return 10
  return 0
}

function computeUnitCounts(project) {
  const units = Array.isArray(project?.units) ? project.units : null
  if (units) {
    const total = units.length
    const available = units.filter(u => u.status === 'available').length
    return { total, available }
  }
  const total = Number(project?.totalUnits ?? project?.total_units ?? 0) || 0
  const available = Number(project?.availableUnits ?? project?.available_units ?? 0) || 0
  return { total, available }
}

const getStatusColor = (status) => {
  const colors = {
    pre_construction: 'bg-field-gold text-white',
    construction: 'bg-amber-500 text-white',
    complete: 'bg-green-600 text-white',
    available: 'bg-green-500',
    reserved: 'bg-field-gold',
    sold: 'bg-field-black',
  }
  return colors[status] || 'bg-gray-400'
}

const getActivityIcon = (type) => {
  return type === 'call' ? '📞' : type === 'site_visit' ? '🏠' : type === 'follow_up' ? '📋' : type === 'meeting' ? '👥' : '📌'
}

export default function Dashboard() {
  const [projects, setProjects] = useState([])
  const [leads, setLeads] = useState([])
  const [activities, setActivities] = useState([])
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchDashboardData() {
      setLoading(true)
      setError('')
      // eslint-disable-next-line no-console
      console.log('[Dashboard] Fetching dashboard data…')

      const [projectsRes, leadsRes, activitiesRes, documentsRes] = await Promise.all([
        (async () => {
          let res = await supabase.from('projects').select('*').order('updated_at', { ascending: false })
          if (res.error && looksLikeMissingColumnError(res.error.message)) {
            res = await supabase.from('projects').select('*')
          }
          return res
        })(),
        (async () => {
          let res = await supabase.from('leads').select('*').order('created_at', { ascending: false })
          if (res.error && looksLikeMissingColumnError(res.error.message)) {
            res = await supabase.from('leads').select('*')
          }
          return res
        })(),
        (async () => {
          let res = await supabase.from('activities').select('*').order('due_date', { ascending: true })
          if (res.error && looksLikeMissingColumnError(res.error.message)) {
            res = await supabase.from('activities').select('*')
          }
          return res
        })(),
        (async () => {
          // Optional: used for "Recent Activity"
          let res = await supabase.from('documents').select('*').order('created_at', { ascending: false }).limit(10)
          if (res.error && looksLikeMissingColumnError(res.error.message)) {
            res = await supabase.from('documents').select('*').limit(10)
          }
          return res
        })(),
      ])

      if (cancelled) return

      // eslint-disable-next-line no-console
      console.log('[Dashboard] leadsRes', { error: leadsRes.error, count: Array.isArray(leadsRes.data) ? leadsRes.data.length : null })
      // eslint-disable-next-line no-console
      console.log('[Dashboard] sample lead row', Array.isArray(leadsRes.data) ? leadsRes.data[0] : null)
      // eslint-disable-next-line no-console
      console.log('[Dashboard] raw stage values', Array.isArray(leadsRes.data)
        ? Array.from(new Set((leadsRes.data || []).map(l => (l?.stage ?? l?.stage_label ?? l?.stageLabel ?? l?.stage_id ?? l?.stageId ?? '')))).slice(0, 25)
        : [])

      const nextError =
        (projectsRes.error && !looksLikeMissingRelationError(projectsRes.error.message, 'projects') ? projectsRes.error.message : '') ||
        (leadsRes.error && !looksLikeMissingRelationError(leadsRes.error.message, 'leads') ? leadsRes.error.message : '') ||
        (activitiesRes.error && !looksLikeMissingRelationError(activitiesRes.error.message, 'activities') ? activitiesRes.error.message : '') ||
        ''
      if (nextError) setError(nextError)

      const dbProjects = Array.isArray(projectsRes.data) ? projectsRes.data : []
      const dbLeads = Array.isArray(leadsRes.data) ? leadsRes.data : []
      const dbActivities = Array.isArray(activitiesRes.data) ? activitiesRes.data : []
      const dbDocuments = Array.isArray(documentsRes.data) ? documentsRes.data : []

      setProjects(dbProjects.length ? dbProjects : (initialProjects || []))
      setLeads(dbLeads.length ? dbLeads : (initialLeads || []))
      setActivities(dbActivities)

      // Recent activity feed (merge latest events across tables)
      const events = []

      for (const l of dbLeads.slice(0, 10)) {
        const ts = l.created_at || l.updated_at || l.createdAt || null
        if (!ts) continue
        events.push({
          key: `lead-${l.id}`,
          at: new Date(ts),
          title: `New lead added`,
          detail: l.name || 'Unnamed lead',
          icon: Users,
        })
      }

      for (const d of dbDocuments.slice(0, 10)) {
        const ts = d.created_at || d.updated_at || d.createdAt || null
        if (!ts) continue
        events.push({
          key: `doc-${d.id}`,
          at: new Date(ts),
          title: `Document uploaded`,
          detail: d.name || d.title || 'Document',
          icon: FileText,
        })
      }

      for (const a of dbActivities.slice(0, 10)) {
        const ts = a.created_at || a.updated_at || a.createdAt || null
        if (!ts) continue
        events.push({
          key: `act-${a.id}`,
          at: new Date(ts),
          title: `Activity added`,
          detail: a.title || a.subject || 'Activity',
          icon: Calendar,
        })
      }

      const cleaned = events
        .filter(e => e.at && !Number.isNaN(e.at.getTime()))
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, 5)

      setRecent(cleaned)
      setLoading(false)
    }

    fetchDashboardData()
    return () => { cancelled = true }
  }, [])

  const normalizedProjects = useMemo(() => {
    return (projects || []).map(p => {
      const { total, available } = computeUnitCounts(p)
      const completionDate = getCompletionDate(p)
      const completionLabel = p.completion || (completionDate ? format(completionDate, 'MMM yyyy') : '—')
      return {
        id: p.id,
        slug: p.slug || p.project_slug || '',
        name: p.name || '',
        location: p.location || '',
        status: p.status || 'planning',
        coverImage: p.coverImage || p.cover_image || p.cover_image_url || '',
        priceDisplay: p.priceDisplay || p.price_display || '',
        completion: completionLabel,
        completionDate,
        progress: computeProgress(p),
        totalUnits: total,
        availableUnits: available,
      }
    })
  }, [projects])

  const normalizedLeads = useMemo(() => {
    return (leads || []).map(l => ({
      id: l.id,
      name: l.name || '',
      stage: normalizeStageId(l.stage ?? l.stage_id ?? l.stageId ?? l.stage_label ?? l.stageLabel ?? 'new'),
      stageRaw: l.stage ?? l.stage_id ?? l.stageId ?? l.stage_label ?? l.stageLabel ?? null,
      budget: l.budget ?? l.budget_display ?? l.budgetDisplay ?? 0,
      lastContactDate: l.last_contact_date ?? l.lastContactDate ?? null,
    }))
  }, [leads])

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[Dashboard] leads state updated', { count: (leads || []).length })
  }, [leads])

  useEffect(() => {
    const dist = normalizedLeads.reduce((acc, l) => {
      acc[l.stage] = (acc[l.stage] || 0) + 1
      return acc
    }, {})
    // eslint-disable-next-line no-console
    console.log('[Dashboard] normalized stage distribution', dist)
  }, [normalizedLeads])

  const todayActivities = useMemo(() => {
    const isToday = (dateValue) => {
      if (!dateValue) return false
      const d = new Date(dateValue)
      const now = new Date()
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    }
    return (activities || [])
      .filter(a => isToday(a.due_date || a.dueDate || a.time))
      .map(a => ({
        id: a.id,
        subject: a.title || a.subject || 'Activity',
        contactName: a.contact || a.contact_name || a.contactName || '—',
        done: a.completed ?? a.done ?? false,
        type: a.type || 'follow_up',
      }))
  }, [activities])

  const tasksDueTodayTotal = useMemo(() => todayActivities.length, [todayActivities])
  const tasksDueTodayPending = useMemo(() => todayActivities.filter(a => !a.done).length, [todayActivities])

  const followUpsNeeded = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    return normalizedLeads.filter(l => {
      if (!l.lastContactDate) return true
      const d = new Date(l.lastContactDate)
      if (Number.isNaN(d.getTime())) return true
      return d.getTime() <= cutoff.getTime()
    }).length
  }, [normalizedLeads])

  const reminderRows = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const dayAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2)

    function isCompleted(a) {
      return !!(a?.completed ?? a?.done ?? false)
    }

    function normalizeBool(v) {
      if (typeof v === 'boolean') return v
      if (typeof v === 'number') return v === 1
      const s = String(v ?? '').trim().toLowerCase()
      if (!s) return false
      return s === 'true' || s === 't' || s === '1' || s === 'yes' || s === 'y'
    }

    function parseLocalDateOnly(value) {
      const datePart = String(value || '').slice(0, 10) // yyyy-mm-dd
      const [Y, M, D] = datePart.split('-').map(n => Number(n))
      if (!Y || !M || !D) return null
      const dt = new Date(Y, M - 1, D)
      return Number.isNaN(dt.getTime()) ? null : dt
    }

    return (activities || [])
      .map(a => {
        const enabledRaw = (a?.reminder_enabled ?? a?.reminderEnabled ?? false)
        const enabled = normalizeBool(enabledRaw)
        if (!enabled) return null
        if (isCompleted(a)) return null

        const reminderDateValue = a?.reminder_date ?? a?.reminderDate ?? null
        const reminderAt = parseLocalDateOnly(reminderDateValue)
        if (!reminderAt) return null

        // Only show if overdue / today / tomorrow (i.e. reminderAt < dayAfter)
        if (reminderAt.getTime() >= dayAfter.getTime()) return null

        const id = a?.id
        if (id == null) return null

        const reminderTime = String(a?.reminder_time ?? a?.reminderTime ?? '').trim()
        const title = a?.title || a?.subject || 'Activity'
        const leadName = a?.lead_name ?? a?.leadName ?? a?.lead ?? ''

        const overdue = reminderAt.getTime() < today.getTime()
        const dueToday = reminderAt.getTime() === today.getTime()
        const dueSoon = reminderAt.getTime() === tomorrow.getTime()
        const dueLater = reminderAt.getTime() >= dayAfter.getTime()

        return {
          id,
          title,
          leadName: leadName ? String(leadName) : '',
          reminderDate: format(reminderAt, 'yyyy-MM-dd'),
          reminderTime,
          overdue,
          dueToday,
          dueSoon,
          dueLater,
        }
      })
      .filter(Boolean)
      .sort((x, y) => {
        const xu = x.overdue || x.dueToday
        const yu = y.overdue || y.dueToday
        if (xu !== yu) return xu ? -1 : 1
        if (x.dueSoon !== y.dueSoon) return x.dueSoon ? -1 : 1
        return String(x.reminderDate).localeCompare(String(y.reminderDate)) || String(x.reminderTime || '00:00').localeCompare(String(y.reminderTime || '00:00'))
      })
  }, [activities])

  const attentionReminders = useMemo(() => {
    return reminderRows.filter(r => r.overdue || r.dueToday)
  }, [reminderRows])

  const upcomingReminders = useMemo(() => {
    return reminderRows
  }, [reminderRows])

  const reminderToast = useMemo(() => {
    if (attentionReminders.length === 0) return null
    const anyOverdue = attentionReminders.some(r => r.overdue)
    const anyToday = attentionReminders.some(r => r.dueToday)
    const title = anyOverdue ? '⚠️ OVERDUE REMINDER' : (anyToday ? 'REMINDER DUE TODAY' : 'REMINDER')
    const firstId = attentionReminders[0]?.id ?? null
    return { title, count: attentionReminders.length, firstId }
  }, [attentionReminders])

  const pipelineValueAll = useMemo(() => {
    return normalizedLeads.reduce((sum, l) => sum + parseBudgetForTotal(l.budget), 0)
  }, [normalizedLeads])

  const stats = useMemo(() => ([
    { label: 'Active Leads', value: normalizedLeads.length, change: 'All leads', trend: 'neutral', icon: Users, to: '/pipeline' },
    { label: 'Pipeline Value', value: formatUsdCompact(pipelineValueAll), change: `${normalizedLeads.length} leads`, trend: 'neutral', icon: DollarSign, to: '/pipeline' },
    { label: 'Tasks Due Today', value: `${tasksDueTodayTotal}`, change: `${tasksDueTodayPending} pending`, trend: 'neutral', icon: CheckSquare, to: '/activities' },
    { label: 'Follow-ups Needed', value: `${followUpsNeeded}`, change: 'No contact in 7+ days', trend: 'neutral', icon: AlertTriangle, to: '/pipeline' },
  ]), [normalizedLeads.length, pipelineValueAll, tasksDueTodayTotal, tasksDueTodayPending, followUpsNeeded])

  const projectsByCompletion = useMemo(() => {
    return [...normalizedProjects].sort((a, b) => {
      const ad = a.completionDate ? a.completionDate.getTime() : Number.POSITIVE_INFINITY
      const bd = b.completionDate ? b.completionDate.getTime() : Number.POSITIVE_INFINITY
      return ad - bd
    })
  }, [normalizedProjects])

  return (
    <div className="space-y-6 lg:space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-semibold text-field-black tracking-tight">Dashboard</h1>
          <p className="text-field-stone mt-1">Field Property Bali overview</p>
        </div>

        {/* Quick Actions (Dashboard only) */}
        <div className="flex items-center gap-2 sm:pt-1">
          <Link
            to="/pipeline"
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-field-black text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Users className="w-4 h-4" />
            <span>Add New Lead</span>
          </Link>
          <a
            href={companyInfo.whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-[#25D366] text-white text-xs font-semibold hover:bg-[#20bd5a] transition-colors shadow-sm"
          >
            <Phone className="w-4 h-4" />
            <span>WhatsApp</span>
          </a>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <Link
            key={i}
            to={stat.to}
            className="card-static p-5 animate-fade-in group hover:-translate-y-0.5 hover:shadow-lg transition-all"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex justify-between items-start mb-3">
              <span className="text-xs font-medium text-field-stone uppercase tracking-wide">{stat.label}</span>
              <stat.icon className="w-5 h-5 text-field-stone-light group-hover:text-field-black transition-colors" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-semibold text-field-black">{stat.value}</span>
              <span className={clsx(
                "text-xs font-medium",
                stat.trend === 'up' ? 'text-green-600' : 'text-field-stone'
              )}>{stat.change}</span>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-field-black opacity-0 group-hover:opacity-100 transition-opacity">
              View <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </Link>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-5 gap-6">
        {/* Left Column - 3 cols */}
        <div className="lg:col-span-3 space-y-6">
          {/* Projects (Big + Vertical) */}
          <div className="card-static p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold">Projects</h2>
              <Link to="/projects" className="text-sm text-field-black font-medium hover:underline">View all →</Link>
            </div>

            <div className="h-[560px] overflow-y-auto pr-2">
              <div className="space-y-5">
                {projectsByCompletion.slice(0, 3).map((project, i) => {
                  const soldOut = (Number(project.availableUnits) || 0) === 0 && (Number(project.totalUnits) || 0) > 0
                  return (
                    <div
                      key={project.slug || project.id || i}
                      className="rounded-2xl overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition-all"
                    >
                      <div className="relative h-[200px] sm:h-[220px]">
                        {project.coverImage ? (
                          <img
                            src={project.coverImage}
                            alt={project.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-field-sand to-white" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />

                        <div className="absolute top-4 left-4 flex items-center gap-2">
                          <span className={clsx(
                            "inline-flex px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wide",
                            getStatusColor(project.status)
                          )}>
                            {String(project.status).replace('_', ' ')}
                          </span>
                          {soldOut && (
                            <span className="inline-flex px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-field-black text-white">
                              Sold Out
                            </span>
                          )}
                        </div>

                        <div className="absolute bottom-4 left-4 right-4">
                          <h3 className="font-display text-2xl sm:text-3xl font-semibold text-white leading-tight">
                            {project.name}
                          </h3>
                          <p className="text-white/85 text-sm sm:text-base">
                            {project.location || '—'} · {project.completion}
                          </p>
                        </div>
                      </div>

                      <div className="p-5">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <p className="text-[11px] text-field-stone uppercase tracking-wide">Availability</p>
                            <p className="font-semibold text-field-black">
                              {project.availableUnits}/{project.totalUnits || '—'} units
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-field-stone uppercase tracking-wide">Progress</p>
                            <p className="font-semibold text-field-black">{project.progress}%</p>
                          </div>
                          <div className="sm:text-right">
                            <p className="text-[11px] text-field-stone uppercase tracking-wide">Price</p>
                            <p className="font-semibold text-field-black">{project.priceDisplay || '—'}</p>
                          </div>
                        </div>

                        <div className="mt-4 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-field-gold rounded-full transition-all duration-500"
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-xs text-field-stone">{project.progress}% complete</p>
                          <Link
                            to={project.slug ? `/projects/${project.slug}` : '/projects'}
                            className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-field-black text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                          >
                            View Details <ArrowRight className="w-4 h-4" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {projectsByCompletion.length === 0 && (
                  <div className="text-sm text-field-stone py-10">
                    {loading ? 'Loading projects…' : 'No projects yet.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pipeline Overview */}
          <div className="card-static p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold">Pipeline Overview</h2>
              <Link to="/pipeline" className="text-sm text-field-black font-medium hover:underline">View all →</Link>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {pipelineStages.slice(0, 6).map(stage => {
                const count = normalizedLeads.filter(l => {
                  const raw = String(l.stageRaw ?? l.stage ?? '').trim().toLowerCase()
                  const label = String(stage.label || '').trim().toLowerCase()
                  const id = String(stage.id || '').trim().toLowerCase()
                  if (!raw) return id === 'new'
                  return raw === id || raw === label || normalizeStageId(raw) === id
                }).length
                return (
                  <div 
                    key={stage.id} 
                    className="flex-1 min-w-[100px] p-3 bg-field-sand rounded-lg"
                    style={{ borderLeft: `3px solid ${stage.color}` }}
                  >
                    <p className="text-[11px] text-field-stone mb-1">{stage.label}</p>
                    <p className="font-display text-2xl font-semibold">{count}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right Column - 2 cols */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upcoming Reminders */}
          {upcomingReminders.length > 0 && (
            <div className="card-static p-5">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-semibold">Upcoming Reminders</h2>
                <Link to="/activities" className="text-sm text-field-black font-medium hover:underline">View all →</Link>
              </div>

              <div className="space-y-3">
                {upcomingReminders.slice(0, 8).map((r) => {
                  const dateLabel = r.reminderDate ? format(new Date(r.reminderDate), 'MMM d, yyyy') : '—'
                  const timeLabel = r.reminderTime ? r.reminderTime : '—'
                  const urgent = r.overdue || r.dueToday
                  return (
                    <Link
                      key={String(r.id)}
                      to={`/activities?activity=${encodeURIComponent(String(r.id))}`}
                      className={clsx(
                        "block p-4 rounded-xl border transition-transform hover:-translate-y-0.5 hover:shadow-lg",
                        urgent
                          ? "bg-red-100 border-red-300 text-red-800 animate-pulse"
                          : r.dueSoon
                            ? "bg-orange-100 border-orange-300 text-orange-800"
                            : "bg-field-sand border-gray-200"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={clsx("text-sm font-semibold truncate", urgent ? "text-red-800" : r.dueSoon ? "text-orange-800" : "text-field-black")}>
                            {r.title}
                          </p>
                          <p className={clsx("text-xs mt-1 truncate", urgent ? "text-red-800/80" : r.dueSoon ? "text-orange-800/80" : "text-field-stone")}>
                            {r.leadName ? `Lead: ${r.leadName} · ` : ''}{dateLabel} · {timeLabel}
                          </p>
                        </div>
                        <span className={clsx(
                          "text-[10px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full flex-shrink-0",
                          urgent
                            ? "bg-red-200 text-red-800"
                            : r.dueSoon
                              ? "bg-orange-200 text-orange-800"
                              : "bg-white border border-gray-200 text-field-stone"
                        )}>
                          {urgent ? (r.overdue ? 'Overdue' : 'Today') : (r.dueSoon ? 'Tomorrow' : 'Later')}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          {/* Today's Tasks */}
          <div className="card-static p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold">Today's Tasks</h2>
              <span className="text-xs font-semibold text-field-black bg-field-sand px-2.5 py-1 rounded-full">
                {todayActivities.filter(a => !a.done).length} pending
              </span>
            </div>
            <div className="space-y-2">
              {todayActivities.map(activity => (
                <div 
                  key={activity.id}
                  className={clsx(
                    "flex items-center gap-3 p-3 rounded-lg",
                    activity.done ? 'bg-gray-50 opacity-60' : 'bg-field-sand'
                  )}
                >
                  <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-sm">
                    {getActivityIcon(activity.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={clsx(
                      "text-sm font-medium truncate",
                      activity.done && "line-through text-field-stone"
                    )}>{activity.subject}</p>
                    <p className="text-xs text-field-stone">{activity.contactName}</p>
                  </div>
                  <div className={clsx(
                    "w-5 h-5 rounded flex items-center justify-center",
                    activity.done ? "bg-field-black" : "border-2 border-gray-300"
                  )}>
                    {activity.done && <CheckCircle2 className="w-4 h-4 text-white" />}
                  </div>
                </div>
              ))}

              {!loading && todayActivities.length === 0 && (
                <div className="text-sm text-field-stone py-6 text-center">
                  No tasks due today
                </div>
              )}
            </div>
            <Link 
              to="/activities" 
              className="block mt-4 py-2.5 text-center bg-field-sand rounded-lg text-sm text-field-stone font-medium hover:bg-gray-200 transition-colors"
            >
              View all activities →
            </Link>
          </div>

          {/* Recent Activity */}
          <div className="card-static p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold">Recent Activity</h2>
              <span className="text-xs text-field-stone">{recent.length ? 'Last 5' : (loading ? 'Loading…' : '—')}</span>
            </div>
            <div className="space-y-3">
              {recent.map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.key} className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-field-sand flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-field-black" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-field-black">{item.title}</p>
                      <p className="text-xs text-field-stone truncate">{item.detail}</p>
                    </div>
                    <p className="text-[11px] text-field-stone whitespace-nowrap">
                      {item.at ? formatDistanceToNow(item.at, { addSuffix: true }) : ''}
                    </p>
                  </div>
                )
              })}
              {!loading && recent.length === 0 && (
                <div className="text-sm text-field-stone py-6 text-center">
                  No recent actions yet
                </div>
              )}
            </div>
          </div>

          {/* Project Timeline */}
          <div className="card-static p-5">
            <h2 className="font-semibold mb-4">Project Timelines</h2>
            <div className="space-y-4">
              {projectsByCompletion.map(project => {
                const soldOut = (Number(project.availableUnits) || 0) === 0 && (Number(project.totalUnits) || 0) > 0
                return (
                <div key={project.slug || project.id}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">{project.name}</span>
                      {soldOut && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide bg-field-black text-white px-2 py-0.5 rounded-full">
                          Sold Out
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-field-stone whitespace-nowrap">{project.completion}</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-field-gold rounded-full transition-all duration-500"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-field-stone mt-1">{project.progress}% complete</p>
                </div>
              )})}

              {projectsByCompletion.length === 0 && (
                <div className="text-sm text-field-stone py-6 text-center">
                  {loading ? 'Loading timelines…' : 'No projects yet'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Top-right reminder toast (keep) */}
      {reminderToast && (
        <ModalPortal>
          <div
            style={{
              position: 'fixed',
              top: 16,
              right: 16,
              zIndex: 9999,
              maxWidth: 520,
              width: 'calc(100vw - 32px)',
            }}
          >
            <div className="rounded-2xl border border-red-300 bg-red-100 p-4 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold tracking-wide text-red-800 uppercase">
                    {reminderToast.title}
                  </p>
                  <p className="mt-1 text-sm text-red-800/80">
                    You have {reminderToast.count} urgent reminder{reminderToast.count === 1 ? '' : 's'} that need attention
                  </p>
                </div>
                <Link
                  to={reminderToast.firstId ? `/activities?activity=${encodeURIComponent(String(reminderToast.firstId))}` : '/activities'}
                  className="inline-flex items-center justify-center h-9 px-3 rounded-lg bg-white border border-red-200 text-red-800 font-semibold text-sm hover:bg-red-50 transition-colors"
                >
                  View
                </Link>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

    </div>
  )
}
