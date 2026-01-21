import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, DollarSign, ArrowRight, Phone, CheckCircle2, FileText, CheckSquare, AlertTriangle } from 'lucide-react'
import { projects as initialProjects, leads as initialLeads, pipelineStages, companyInfo } from '../data'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { format, formatDistanceToNow } from 'date-fns'

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
      stage: l.stage || 'new',
      budget: l.budget ?? l.budget_display ?? l.budgetDisplay ?? 0,
      lastContactDate: l.last_contact_date ?? l.lastContactDate ?? null,
    }))
  }, [leads])

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
    const today = format(new Date(), 'yyyy-MM-dd')
    const todayPlus2 = format(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')

    function isCompleted(a) {
      return !!(a?.completed ?? a?.done ?? false)
    }

    return (activities || [])
      .map(a => {
        const enabled = a?.reminder_enabled ?? a?.reminderEnabled ?? false
        if (!enabled) return null
        if (isCompleted(a)) return null

        const reminderDate = String(a?.reminder_date ?? a?.reminderDate ?? '').slice(0, 10)
        if (!reminderDate) return null

        const id = a?.id
        if (id == null) return null

        const reminderTime = String(a?.reminder_time ?? a?.reminderTime ?? '').trim()
        const title = a?.title || a?.subject || 'Activity'
        const leadName = a?.lead_name ?? a?.leadName ?? a?.lead ?? ''

        const overdue = reminderDate < today
        const dueToday = reminderDate === today
        const dueSoon = reminderDate > today && reminderDate <= todayPlus2
        const dueLater = reminderDate > todayPlus2

        return {
          id,
          title,
          leadName: leadName ? String(leadName) : '',
          reminderDate,
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
      {/* REMINDERS (top priority) */}
      {attentionReminders.length > 0 && (
        <div className="rounded-2xl border-2 border-red-500 bg-red-600 p-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-extrabold tracking-wide text-white">
                ⚠️ REMINDERS
              </h2>
              <p className="text-sm text-white/90 mt-1">
                {attentionReminders.length} reminder{attentionReminders.length === 1 ? '' : 's'} need attention.
              </p>
            </div>
            <Link to="/activities" className="text-sm font-semibold text-red-900 hover:underline">
              View all →
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {attentionReminders.map((r) => {
              const dateLabel = r.reminderDate ? format(new Date(r.reminderDate), 'MMM d, yyyy') : '—'
              const timeLabel = r.reminderTime ? r.reminderTime : '—'
              return (
                <Link
                  key={String(r.id)}
                  to={`/activities?activity=${encodeURIComponent(String(r.id))}`}
                  className={clsx(
                    "block rounded-xl border p-4 transition-transform hover:-translate-y-0.5 hover:shadow-lg",
                    "bg-red-700/80 border-red-300 animate-pulse"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold truncate text-white">
                        {r.title}
                      </p>
                      <p className="text-sm mt-1 truncate text-white/90">
                        {r.leadName ? `Lead: ${r.leadName} · ` : ''}{dateLabel} · {timeLabel}
                      </p>
                    </div>
                    <span className="text-xs font-extrabold uppercase tracking-wide px-3 py-1 rounded-full flex-shrink-0 bg-white text-red-700">
                      {r.overdue ? 'Overdue' : 'Due Today'}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

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
                const count = normalizedLeads.filter(l => l.stage === stage.id).length
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
          <div className="card-static p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold">Upcoming Reminders</h2>
              <Link to="/activities" className="text-sm text-field-black font-medium hover:underline">View all →</Link>
            </div>

            {upcomingReminders.length === 0 ? (
              <div className="text-sm text-field-stone py-4 text-center">
                {loading ? 'Loading…' : 'No reminders'}
              </div>
            ) : (
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
                          ? "bg-red-600 border-red-500 text-white animate-pulse"
                          : r.dueSoon
                            ? "bg-orange-100 border-orange-300"
                            : "bg-field-sand border-gray-200"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={clsx("text-sm font-semibold truncate", urgent ? "text-white" : "text-field-black")}>
                            {r.title}
                          </p>
                          <p className={clsx("text-xs mt-1 truncate", urgent ? "text-white/90" : "text-field-stone")}>
                            {r.leadName ? `Lead: ${r.leadName} · ` : ''}{dateLabel} · {timeLabel}
                          </p>
                        </div>
                        <span className={clsx(
                          "text-[10px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full flex-shrink-0",
                          urgent
                            ? "bg-white text-red-700"
                            : r.dueSoon
                              ? "bg-orange-500 text-white"
                              : "bg-white border border-gray-200 text-field-stone"
                        )}>
                          {urgent ? (r.overdue ? 'Overdue' : 'Today') : (r.dueSoon ? 'Next 2 days' : 'Later')}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

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

    </div>
  )
}
