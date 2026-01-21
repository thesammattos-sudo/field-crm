import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend } from 'recharts'
import { pipelineStages } from '../data'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [leads, setLeads] = useState([])

  useEffect(() => {
    let cancelled = false

    async function fetchLeads() {
      setLoading(true)
      setError('')

      const res = await supabase.from('leads').select('*').order('created_at', { ascending: false })
      if (res.error) {
        if (!cancelled) setError(res.error.message || 'Failed to load analytics.')
        if (!cancelled) setLeads([])
        if (!cancelled) setLoading(false)
        return
      }

      if (!cancelled) setLeads(res.data || [])
      if (!cancelled) setLoading(false)
    }

    fetchLeads()
    return () => { cancelled = true }
  }, [])

  const normalizedLeads = useMemo(() => {
    return (leads || []).map(l => ({
      id: l.id,
      stage: normalizeStageId(l.stage ?? l.stage_id ?? l.stageId ?? l.stage_label ?? l.stageLabel ?? 'new'),
      source: (l.source || 'Other'),
      createdAt: l.created_at || l.createdAt || null,
    }))
  }, [leads])

  const funnelData = useMemo(() => {
    const counts = normalizedLeads.reduce((acc, l) => {
      acc[l.stage] = (acc[l.stage] || 0) + 1
      return acc
    }, {})

    const closedCount = (counts.won || 0) + (counts.lost || 0) + (counts.closing || 0)

    const items = [
      { id: 'new', label: 'New Lead' },
      { id: 'contacted', label: 'Contacted' },
      { id: 'qualified', label: 'Qualified' },
      { id: 'pdf_sent', label: 'PDF Sent' },
      { id: 'site_visit', label: 'Site Visit' },
      { id: 'negotiating', label: 'Negotiating' },
      { id: 'closed', label: 'Closed' },
    ]

    return items.map((it) => {
      const value = it.id === 'closed' ? closedCount : (counts[it.id] || 0)
      const color =
        it.id === 'closed' ? BRAND_BLACK
          : it.id === 'site_visit' || it.id === 'negotiating' ? BRAND_GOLD
            : it.id === 'new' ? BRAND_BLACK
              : it.id === 'contacted' ? BRAND_GRAYS[0]
                : it.id === 'qualified' ? BRAND_GRAYS[1]
                  : it.id === 'pdf_sent' ? BRAND_GRAYS[2]
                    : BRAND_GRAYS[1]
      return { stage: it.label, value, color }
    })
  }, [normalizedLeads])

  const sourceData = useMemo(() => {
    const counts = normalizedLeads.reduce((acc, l) => {
      const key = String(l.source || 'Other').trim() || 'Other'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [normalizedLeads])

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

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-semibold text-field-black tracking-tight">Analytics</h1>
          <p className="text-field-stone mt-1">Pipeline trends & performance</p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Chart 1: Pipeline Funnel */}
        <div className="card-static p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Pipeline Funnel</h2>
            <span className="text-xs text-field-stone">{loading ? 'Loading…' : `${normalizedLeads.length} leads`}</span>
          </div>
          <div className={clsx("h-[320px]", loading && "opacity-60")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="stage" width={110} />
                <Tooltip />
                <Bar dataKey="value" radius={[8, 8, 8, 8]}>
                  {funnelData.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Leads by Source */}
        <div className="card-static p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Leads by Source</h2>
            <span className="text-xs text-field-stone">{loading ? 'Loading…' : `${sourceData.length} sources`}</span>
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
                >
                  {sourceData.map((_, idx) => (
                    <Cell key={`slice-${idx}`} fill={SOURCE_COLORS[idx % SOURCE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
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
    </div>
  )
}

