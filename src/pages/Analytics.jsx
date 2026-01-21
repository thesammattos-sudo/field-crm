import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend, LabelList } from 'recharts'
import { pipelineStages } from '../data'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

const stageIdSet = new Set(pipelineStages.map(s => s.id))
const stageLabelToId = Object.fromEntries(
  pipelineStages.map(s => [String(s.label || '').trim().toLowerCase(), s.id])
)

function normalizeStageId(raw) {
  const rawStr = String(raw ?? '').trim()
  if (!rawStr) return 'new'
  if (stageIdSet.has(rawStr)) return rawStr
  const rawLower = rawStr.toLowerCase()
  if (stageIdSet.has(rawLower)) return rawLower
  if (stageLabelToId[rawLower]) return stageLabelToId[rawLower]
  const token = rawLower.replace(/[-\s]+/g, '_')
  if (stageIdSet.has(token)) return token
  const special = { booked: 'won', won: 'won', closed_won: 'won', closedwon: 'won', pdf: 'pdf_sent' }
  if (special[token]) return special[token]
  return 'new'
}

function monthKey(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}

function monthLabel(d) {
  return d.toLocaleString(undefined, { month: 'short' })
}

// Brand palette
const BRAND_BLACK = '#1a1a1a'
const BRAND_GOLD = '#C9A55C'
const BRAND_GRAYS = ['#525252', '#78716c', '#a8a29e', '#d4d4d4']

const SOURCE_COLORS = [
  BRAND_BLACK,
  BRAND_GOLD,
  ...BRAND_GRAYS,
  '#16a34a', // keep green accent for variety
  '#f59e0b', // amber accent
]

export default function Analytics() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [leads, setLeads] = useState([])
  const [activities, setActivities] = useState([])
  const [range, setRange] = useState('month') // week | month | quarter | all

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError('')

      const [leadsRes, actsRes] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('activities').select('*').order('due_date', { ascending: true }),
      ])

      if (leadsRes.error) {
        if (!cancelled) setError(leadsRes.error.message || 'Failed to load analytics.')
      }
      if (!cancelled) setLeads(leadsRes.data || [])
      if (!cancelled) setActivities(actsRes.data || [])
      if (!cancelled) setLoading(false)
    }

    fetchData()
    return () => { cancelled = true }
  }, [])

  const dateRange = useMemo(() => {
    const now = new Date()
    if (range === 'week') {
      const start = new Date(now)
      start.setDate(now.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      return { id: range, label: 'This Week', start, end: now }
    }
    if (range === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { id: range, label: 'This Month', start, end: now }
    }
    if (range === 'quarter') {
      const q = Math.floor(now.getMonth() / 3)
      const start = new Date(now.getFullYear(), q * 3, 1)
      return { id: range, label: 'This Quarter', start, end: now }
    }
    return { id: 'all', label: 'All Time', start: null, end: now }
  }, [range])

  function inRange(dateLike) {
    if (!dateRange.start) return true
    if (!dateLike) return false
    const d = new Date(dateLike)
    if (Number.isNaN(d.getTime())) return false
    return d.getTime() >= dateRange.start.getTime() && d.getTime() <= dateRange.end.getTime()
  }

  function parseBudget(value) {
    if (value == null) return 0
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const s = String(value).trim()
    if (!s) return 0
    const parts = s.replace(/\s+/g, '').split('-')
    const pick = parts.length >= 2 ? parts[1] : parts[0]
    const cleaned = pick.replace('+', '')
    const lower = cleaned.toLowerCase()
    const multiplier = lower.includes('m') ? 1_000_000 : lower.includes('k') ? 1_000 : 1
    const m = lower.replace(/,/g, '').match(/(\d+(\.\d+)?)/)
    const num = m ? Number(m[1]) : 0
    return Number.isFinite(num) ? num * multiplier : 0
  }

  function normalizeProject(lead) {
    const raw = lead?.interest ?? lead?.interested_in ?? lead?.interestedIn ?? lead?.project ?? ''
    const s = String(raw || '').trim()
    if (!s) return ''
    // handle "OMMA Villas - Unit 3"
    const m = s.match(/^\s*(OMMA Villas|Tropicalia Breeze|Tropicalia Villas)\b/i)
    return m ? m[1] : s
  }

  function closeDateForLead(l) {
    return l.closed_at || l.closedAt || l.won_at || l.wonAt || l.lost_at || l.lostAt || l.updated_at || l.updatedAt || null
  }

  const normalizedLeads = useMemo(() => {
    return (leads || []).map(l => ({
      id: l.id,
      stage: normalizeStageId(l.stage ?? l.stage_id ?? l.stageId ?? l.stage_label ?? l.stageLabel ?? 'new'),
      source: (l.source || 'Other'),
      createdAt: l.created_at || l.createdAt || null,
      closeAt: closeDateForLead(l),
      budget: l.budget ?? l.budget_display ?? l.budgetDisplay ?? 0,
      project: normalizeProject(l),
      lastContactDate: l.last_contact_date ?? l.lastContactDate ?? null,
    }))
  }, [leads])

  const leadsFiltered = useMemo(() => {
    return normalizedLeads.filter(l => inRange(l.createdAt))
  }, [normalizedLeads, dateRange.start, dateRange.end])

  const activitiesNormalized = useMemo(() => {
    return (activities || []).map(a => ({
      id: a.id,
      dueDate: a.due_date ?? a.dueDate ?? a.time ?? null,
      completed: !!(a.completed ?? a.done ?? false),
      createdAt: a.created_at ?? a.createdAt ?? null,
    }))
  }, [activities])

  const activitiesFiltered = useMemo(() => {
    // use due date for performance
    return activitiesNormalized.filter(a => inRange(a.dueDate))
  }, [activitiesNormalized, dateRange.start, dateRange.end])

  // Conversion KPIs
  const kpis = useMemo(() => {
    const total = leadsFiltered.length
    const won = leadsFiltered.filter(l => l.stage === 'won').length
    const lost = leadsFiltered.filter(l => l.stage === 'lost').length
    const closed = won + lost

    const pipelineValue = leadsFiltered.reduce((sum, l) => sum + parseBudget(l.budget), 0)
    const avgDeal = total > 0 ? pipelineValue / total : 0

    const closeDurations = leadsFiltered
      .filter(l => (l.stage === 'won' || l.stage === 'lost') && l.createdAt && l.closeAt)
      .map(l => {
        const a = new Date(l.createdAt)
        const b = new Date(l.closeAt)
        if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
        const days = Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)))
        return days
      })
      .filter(v => typeof v === 'number')
    const avgCloseDays = closeDurations.length ? Math.round(closeDurations.reduce((s, d) => s + d, 0) / closeDurations.length) : null

    const conversionRate = total > 0 ? (won / total) * 100 : 0
    const winRateClosed = closed > 0 ? (won / closed) * 100 : 0
    const lostRateClosed = closed > 0 ? (lost / closed) * 100 : 0

    return {
      total, won, lost, closed,
      pipelineValue,
      avgDeal,
      avgCloseDays,
      conversionRate,
      winRateClosed,
      lostRateClosed,
    }
  }, [leadsFiltered])

  const funnelData = useMemo(() => {
    const counts = leadsFiltered.reduce((acc, l) => {
      acc[l.stage] = (acc[l.stage] || 0) + 1
      return acc
    }, {})

    const negotiatingCount = (counts.negotiating || 0) + (counts.closing || 0)
    const closedCount = (counts.won || 0) + (counts.lost || 0)

    const items = [
      { id: 'new', label: 'New Lead' },
      { id: 'contacted', label: 'Contacted' },
      { id: 'qualified', label: 'Qualified' },
      { id: 'pdf_sent', label: 'PDF Sent' },
      { id: 'site_visit', label: 'Site Visit' },
      { id: 'negotiating', label: 'Negotiating' },
      { id: 'closed', label: 'Closed' },
    ]

    const total = leadsFiltered.length || 1
    return items.map((it) => {
      const value =
        it.id === 'closed' ? closedCount
          : it.id === 'negotiating' ? negotiatingCount
            : (counts[it.id] || 0)
      const pct = Math.round((value / total) * 100)
      const color =
        it.id === 'closed' ? BRAND_BLACK
          : it.id === 'site_visit' || it.id === 'negotiating' ? BRAND_GOLD
            : it.id === 'new' ? BRAND_BLACK
              : it.id === 'contacted' ? BRAND_GRAYS[0]
                : it.id === 'qualified' ? BRAND_GRAYS[1]
                  : it.id === 'pdf_sent' ? BRAND_GRAYS[2]
                    : BRAND_GRAYS[1]
      return { stageId: it.id, stage: it.label, value, pct, color }
    })
  }, [leadsFiltered])

  const funnelDropoff = useMemo(() => {
    const rows = []
    for (let i = 1; i < funnelData.length; i++) {
      const prev = funnelData[i - 1]
      const cur = funnelData[i]
      const drop = prev.value > 0 ? Math.round(((prev.value - cur.value) / prev.value) * 100) : null
      rows.push({ from: prev.stage, to: cur.stage, drop })
    }
    return rows
  }, [funnelData])

  const sourceData = useMemo(() => {
    const counts = leadsFiltered.reduce((acc, l) => {
      const key = String(l.source || 'Other').trim() || 'Other'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [leadsFiltered])

  const sourceConversion = useMemo(() => {
    const by = new Map()
    for (const l of leadsFiltered) {
      const key = String(l.source || 'Other').trim() || 'Other'
      const cur = by.get(key) || { source: key, total: 0, won: 0, lost: 0 }
      cur.total += 1
      if (l.stage === 'won') cur.won += 1
      if (l.stage === 'lost') cur.lost += 1
      by.set(key, cur)
    }
    const rows = Array.from(by.values()).map(r => ({
      ...r,
      winRate: r.total > 0 ? (r.won / r.total) * 100 : 0,
    }))
    rows.sort((a, b) => b.winRate - a.winRate)
    const best = rows.find(r => r.total >= 3) || rows[0] || null
    return { rows, best }
  }, [leadsFiltered])

  const monthlyData = useMemo(() => {
    const now = new Date()
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: monthKey(d), label: monthLabel(d), count: 0 })
    }

    const index = new Map(months.map(m => [m.key, m]))
    for (const l of normalizedLeads) {
      if (!l.createdAt) continue
      const d = new Date(l.createdAt)
      if (Number.isNaN(d.getTime())) continue
      const k = monthKey(d)
      if (index.has(k)) index.get(k).count += 1
    }

    return months.map(m => ({ month: m.label, leads: m.count }))
  }, [normalizedLeads])

  const valueByProject = useMemo(() => {
    const known = ['OMMA Villas', 'Tropicalia Breeze', 'Tropicalia Villas']
    const map = new Map(known.map(p => [p, 0]))
    for (const l of leadsFiltered) {
      const proj = l.project || 'Other'
      const key = known.includes(proj) ? proj : 'Other'
      map.set(key, (map.get(key) || 0) + parseBudget(l.budget))
    }
    const rows = Array.from(map.entries()).map(([project, value]) => ({ project, value }))
    rows.sort((a, b) => b.value - a.value)
    return rows
  }, [leadsFiltered])

  const activityPerformance = useMemo(() => {
    const now = new Date()
    const overdue = activitiesFiltered.filter(a => {
      if (a.completed) return false
      if (!a.dueDate) return false
      const d = new Date(a.dueDate)
      if (Number.isNaN(d.getTime())) return false
      return d.getTime() < now.getTime()
    }).length
    const completed = activitiesFiltered.filter(a => a.completed).length
    return [{ name: 'Tasks', completed, overdue }]
  }, [activitiesFiltered])

  const insights = useMemo(() => {
    const tips = []

    // Best source share
    const topSource = sourceData[0]
    if (topSource) {
      const pct = leadsFiltered.length ? Math.round((topSource.value / leadsFiltered.length) * 100) : 0
      tips.push(`🔥 ${topSource.name} is your top lead source (${pct}% of leads)`)
    }

    // Leads needing follow-up (all leads, regardless of range)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    const followups = normalizedLeads.filter(l => {
      if (!l.lastContactDate) return true
      const d = new Date(l.lastContactDate)
      if (Number.isNaN(d.getTime())) return true
      return d.getTime() <= cutoff.getTime()
    }).length
    if (followups > 0) tips.push(`⚠️ ${followups} leads haven't been contacted in 7+ days`)

    // Lead volume change (current range vs previous same-length)
    const withCreated = normalizedLeads.filter(l => l.createdAt && !Number.isNaN(new Date(l.createdAt).getTime()))
    const end = dateRange.end
    const start = dateRange.start
    let cur = 0
    let prev = 0
    if (start) {
      const lenMs = end.getTime() - start.getTime()
      const prevStart = new Date(start.getTime() - lenMs)
      const prevEnd = new Date(end.getTime() - lenMs)
      cur = withCreated.filter(l => {
        const d = new Date(l.createdAt)
        return d.getTime() >= start.getTime() && d.getTime() <= end.getTime()
      }).length
      prev = withCreated.filter(l => {
        const d = new Date(l.createdAt)
        return d.getTime() >= prevStart.getTime() && d.getTime() <= prevEnd.getTime()
      }).length
    } else {
      // All time: last 30 days vs previous 30
      const curStart = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
      const prevStart = new Date(curStart.getTime() - 30 * 24 * 60 * 60 * 1000)
      const prevEnd = new Date(curStart.getTime())
      cur = withCreated.filter(l => {
        const d = new Date(l.createdAt)
        return d.getTime() >= curStart.getTime() && d.getTime() <= end.getTime()
      }).length
      prev = withCreated.filter(l => {
        const d = new Date(l.createdAt)
        return d.getTime() >= prevStart.getTime() && d.getTime() <= prevEnd.getTime()
      }).length
    }
    if (prev > 0) {
      const delta = Math.round(((cur - prev) / prev) * 100)
      if (delta !== 0) tips.push(`📈 Lead volume ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)}% vs previous period`)
    }

    // Best conversion source
    if (sourceConversion.best) {
      tips.push(`🏆 Best converting source: ${sourceConversion.best.source} (${Math.round(sourceConversion.best.winRate)}% win rate)`)
    }

    return tips.slice(0, 6)
  }, [sourceData, leadsFiltered.length, normalizedLeads, dateRange.start, dateRange.end, sourceConversion.best])

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-semibold text-field-black tracking-tight">Analytics</h1>
          <p className="text-field-stone mt-1">Pipeline trends & performance</p>
        </div>
        <div className="flex items-center gap-2">
          {[
            { id: 'week', label: 'This Week' },
            { id: 'month', label: 'This Month' },
            { id: 'quarter', label: 'This Quarter' },
            { id: 'all', label: 'All Time' },
          ].map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={clsx(
                "px-3 py-2 rounded-lg text-sm font-semibold transition-colors",
                range === r.id ? "bg-field-black text-white" : "bg-field-sand text-field-stone hover:bg-gray-200"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Conversion metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-static p-5">
          <p className="text-xs font-medium text-field-stone uppercase tracking-wide">Conversion Rate</p>
          <p className="font-display text-3xl font-semibold text-field-black mt-2">
            {kpis.total ? `${Math.round(kpis.conversionRate)}%` : '—'}
          </p>
          <p className="text-xs text-field-stone mt-1">Closed won / total leads</p>
        </div>
        <div className="card-static p-5">
          <p className="text-xs font-medium text-field-stone uppercase tracking-wide">Average Deal Size</p>
          <p className="font-display text-3xl font-semibold text-field-black mt-2">
            {kpis.total ? `$${Math.round(kpis.avgDeal).toLocaleString()}` : '—'}
          </p>
          <p className="text-xs text-field-stone mt-1">Pipeline value / leads</p>
        </div>
        <div className="card-static p-5">
          <p className="text-xs font-medium text-field-stone uppercase tracking-wide">Avg Time to Close</p>
          <p className="font-display text-3xl font-semibold text-field-black mt-2">
            {kpis.avgCloseDays == null ? '—' : `${kpis.avgCloseDays}d`}
          </p>
          <p className="text-xs text-field-stone mt-1">Created → close (closed only)</p>
        </div>
        <div className="card-static p-5">
          <p className="text-xs font-medium text-field-stone uppercase tracking-wide">Win vs Lost</p>
          <p className="font-display text-3xl font-semibold text-field-black mt-2">
            {kpis.closed ? `${Math.round(kpis.winRateClosed)}%` : '—'}
          </p>
          <p className="text-xs text-field-stone mt-1">
            Won {kpis.won} · Lost {kpis.lost}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Chart 1: Pipeline Funnel */}
        <div className="card-static p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Pipeline Funnel</h2>
            <span className="text-xs text-field-stone">{loading ? 'Loading…' : `${leadsFiltered.length} leads · ${dateRange.label}`}</span>
          </div>
          <div className={clsx("h-[320px]", loading && "opacity-60")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="stage" width={110} />
                <Tooltip />
                <Bar
                  dataKey="value"
                  radius={[8, 8, 8, 8]}
                  onClick={(data) => {
                    const id = data?.stageId
                    if (!id) return
                    navigate(`/pipeline?stage=${encodeURIComponent(id)}`)
                  }}
                >
                  {funnelData.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={entry.color} />
                  ))}
                  <LabelList
                    dataKey="pct"
                    position="right"
                    formatter={(v) => `${v}%`}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-1">
            {funnelDropoff.map((d, idx) => (
              <p key={idx} className="text-xs text-field-stone">
                Drop-off {d.from} → {d.to}: {d.drop == null ? '—' : `${d.drop}%`}
              </p>
            ))}
          </div>
        </div>

        {/* Chart 2: Leads by Source */}
        <div className="card-static p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Leads by Source</h2>
            <span className="text-xs text-field-stone">{loading ? 'Loading…' : `${sourceData.length} sources · ${dateRange.label}`}</span>
          </div>
          <div className={clsx("h-[320px]", loading && "opacity-60")}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip />
                <Legend />
                <Pie
                  data={sourceData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={2}
                  onClick={(entry) => {
                    const src = entry?.name
                    if (!src) return
                    navigate(`/pipeline?source=${encodeURIComponent(String(src))}`)
                  }}
                >
                  {sourceData.map((_, idx) => (
                    <Cell key={`slice-${idx}`} fill={SOURCE_COLORS[idx % SOURCE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4">
            {sourceConversion.best ? (
              <div className="p-3 rounded-xl bg-field-sand border border-gray-200">
                <p className="text-sm font-semibold text-field-black">
                  Top converting source: {sourceConversion.best.source}
                </p>
                <p className="text-xs text-field-stone mt-1">
                  {Math.round(sourceConversion.best.winRate)}% win rate · {sourceConversion.best.total} leads
                </p>
              </div>
            ) : (
              <p className="text-sm text-field-stone">No source conversion data yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Lead Value by Project + Activity Performance */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card-static p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Lead Value by Project</h2>
            <span className="text-xs text-field-stone">{dateRange.label}</span>
          </div>
          <div className={clsx("h-[320px]", loading && "opacity-60")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={valueByProject} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="project" />
                <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}K`} />
                <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}`} />
                <Bar dataKey="value" fill={BRAND_GOLD} radius={[8, 8, 8, 8]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-static p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Activity Performance</h2>
            <span className="text-xs text-field-stone">{dateRange.label}</span>
          </div>
          <div className={clsx("h-[320px]", loading && "opacity-60")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activityPerformance} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="completed" stackId="a" fill={BRAND_GOLD} radius={[8, 8, 0, 0]} />
                <Bar dataKey="overdue" stackId="a" fill={BRAND_BLACK} radius={[0, 0, 8, 8]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Chart 3: Monthly Leads */}
      <div className="card-static p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Monthly Leads (Last 6 Months)</h2>
          <span className="text-xs text-field-stone">{loading ? 'Loading…' : 'Trend'}</span>
        </div>
        <div className={clsx("h-[320px]", loading && "opacity-60")}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="month" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="leads" stroke={BRAND_GOLD} strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Insights */}
      <div className="card-static p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Insights</h2>
          <span className="text-xs text-field-stone">{dateRange.label}</span>
        </div>
        {insights.length === 0 ? (
          <p className="text-sm text-field-stone">Not enough data yet to generate insights.</p>
        ) : (
          <div className="space-y-2">
            {insights.map((t, i) => (
              <div key={i} className="p-3 rounded-xl bg-field-sand border border-gray-200 text-sm text-field-black">
                {t}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

