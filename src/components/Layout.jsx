import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Menu, Home, Users, Building2, Truck, Package, FileText, CheckSquare, Settings, Search, LogOut, ArrowRight } from 'lucide-react'
import { activities } from '../data'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import SettingsModal from './SettingsModal'
import ModalPortal from './ModalPortal'

const navItems = [
  { section: 'OVERVIEW', items: [
    { path: '/dashboard', label: 'Dashboard', icon: Home },
    { path: '/pipeline', label: 'Pipeline', icon: Users },
    { path: '/projects', label: 'Projects', icon: Building2 },
  ]},
  { section: 'OPERATIONS', items: [
    { path: '/suppliers', label: 'Suppliers', icon: Truck },
    { path: '/materials', label: 'Materials', icon: Package },
    { path: '/documents', label: 'Documents', icon: FileText },
  ]},
  { section: 'TASKS', items: [
    { path: '/activities', label: 'Activities', icon: CheckSquare, badge: activities.filter(a => !a.done && a.timeDisplay.includes('Today')).length },
  ]},
]

function looksLikeMissingRelationError(message, table) {
  if (!message) return false
  return message.includes('relation') && message.includes(table) && message.includes('does not exist')
}

function looksLikeMissingColumnError(message) {
  if (!message) return false
  return message.includes('column') && message.includes('does not exist')
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const navigate = useNavigate()
  const { user, profile, role, signOut } = useAuth()

  const [attentionReminders, setAttentionReminders] = useState([])
  const [reminderGateOpen, setReminderGateOpen] = useState(false)
  const [reminderGateDismissed, setReminderGateDismissed] = useState(false)
  const [reminderBannerDismissed, setReminderBannerDismissed] = useState(false)
  const defaultTitleRef = useRef('')

  const displayName = profile?.name || profile?.full_name || user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email || 'User'
  const initials = String(displayName || 'U')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase() || 'U'

  const filteredNavItems = useMemo(() => {
    if (role !== 'sales_rep') return navItems
    const hidden = new Set(['/suppliers', '/materials', '/documents'])
    return navItems
      .map(group => ({
        ...group,
        items: group.items.filter(item => !hidden.has(item.path)),
      }))
      .filter(group => group.items.length > 0)
  }, [role])

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)

  const trimmed = query.trim()

  useEffect(() => {
    defaultTitleRef.current = document.title || 'Field Property CRM'
  }, [])

  const reminderBuckets = useMemo(() => {
    const urgent = attentionReminders.filter(r => r.overdue || r.dueToday)
    const soon = attentionReminders.filter(r => r.dueSoon)
    const later = attentionReminders.filter(r => r.dueLater)
    const anyOverdue = urgent.some(r => r.overdue)
    const anyDueToday = urgent.some(r => r.dueToday)
    return { urgent, soon, later, anyOverdue, anyDueToday }
  }, [attentionReminders])

  // Fetch "must-attend" reminders on app open (and refresh periodically).
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    function todayLocalISO() {
      const d = new Date()
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    }

    function addDaysISO(isoDate, days) {
      const [Y, M, D] = String(isoDate).split('-').map(n => Number(n))
      if (!Y || !M || !D) return isoDate
      const dt = new Date(Y, M - 1, D + days, 0, 0, 0, 0)
      const yyyy = dt.getFullYear()
      const mm = String(dt.getMonth() + 1).padStart(2, '0')
      const dd = String(dt.getDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    }

    function normalizeRow(a, today, untilISO) {
      const enabled = a?.reminder_enabled ?? a?.reminderEnabled ?? false
      if (!enabled) return null
      const completed = !!(a?.completed ?? a?.done ?? false)
      if (completed) return null

      const reminderDate = String(a?.reminder_date ?? a?.reminderDate ?? '').slice(0, 10)
      if (!reminderDate) return null
      if (reminderDate > untilISO) return null

      const title = a?.title || a?.subject || 'Activity'
      const leadName = a?.lead_name ?? a?.leadName ?? a?.lead ?? ''
      const id = a?.id
      if (id == null) return null
      const reminderTime = String(a?.reminder_time ?? a?.reminderTime ?? '').trim()

      const overdue = reminderDate < today
      const dueToday = reminderDate === today
      const dueSoon = reminderDate > today && reminderDate <= addDaysISO(today, 2)
      const dueLater = reminderDate > addDaysISO(today, 2)

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
    }

    async function fetchReminders() {
      const today = todayLocalISO()
      const until = addDaysISO(today, 2)
      let res = await supabase
        .from('activities')
        .select('*')
        .eq('reminder_enabled', true)
        .lte('reminder_date', until)

      if (res.error && looksLikeMissingColumnError(res.error.message)) {
        res = await supabase.from('activities').select('*')
      }

      if (res.error) {
        const msg = res.error.message || ''
        if (looksLikeMissingRelationError(msg, 'activities')) return
        return
      }

      const rows = (res.data || [])
        .map(a => normalizeRow(a, today, until))
        .filter(Boolean)
        .sort((x, y) => {
          // urgent first
          const xu = (x.overdue || x.dueToday)
          const yu = (y.overdue || y.dueToday)
          if (xu !== yu) return xu ? -1 : 1
          // then soon
          if (x.dueSoon !== y.dueSoon) return x.dueSoon ? -1 : 1
          return String(x.reminderTime || '00:00').localeCompare(String(y.reminderTime || '00:00'))
        })

      if (cancelled) return
      setAttentionReminders(rows)
      setReminderBannerDismissed(false)

      const urgentCount = rows.filter(r => r.overdue || r.dueToday).length
      if (urgentCount === 0) {
        setReminderGateOpen(false)
        setReminderGateDismissed(false)
        return
      }

      if (!reminderGateDismissed) setReminderGateOpen(true)
    }

    fetchReminders()
    const t = window.setInterval(fetchReminders, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [user?.id, reminderGateDismissed])

  // Tab title: show count + blink while reminders exist.
  useEffect(() => {
    const base = defaultTitleRef.current || 'Field Property CRM'
    const count = reminderBuckets.urgent.length + reminderBuckets.soon.length
    let t = null

    if (count > 0) {
      const withCount = `(${count}) ${base}`
      let flip = false
      document.title = withCount
      // Blink only if urgent (overdue / due today).
      if (reminderBuckets.urgent.length > 0) {
        t = window.setInterval(() => {
          flip = !flip
          document.title = flip ? withCount : base
        }, 900)
      }
    } else {
      document.title = base
    }

    return () => {
      if (t) window.clearInterval(t)
    }
  }, [reminderBuckets.urgent.length, reminderBuckets.soon.length])

  useEffect(() => {
    return () => {
      if (blurTimer.current) window.clearTimeout(blurTimer.current)
    }
  }, [])

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const t = window.setTimeout(async () => {
      const q = trimmed
      const like = `%${q}%`

      async function searchLeads() {
        let res = await supabase.from('leads').select('id,name,phone').ilike('name', like).limit(5)
        if (res.error && looksLikeMissingColumnError(res.error.message)) {
          res = await supabase.from('leads').select('*').limit(25)
        }
        if (res.error) {
          const msg = res.error.message || ''
          if (looksLikeMissingRelationError(msg, 'leads')) return []
          return []
        }
        const rows = Array.isArray(res.data) ? res.data : []
        if (res.error && looksLikeMissingColumnError(res.error.message)) {
          return rows
            .filter(r => String(r?.name || '').toLowerCase().includes(q.toLowerCase()))
            .slice(0, 5)
        }
        return rows
      }

      async function searchSuppliers() {
        let res = await supabase.from('suppliers').select('id,name').ilike('name', like).limit(5)
        if (res.error && looksLikeMissingColumnError(res.error.message)) {
          res = await supabase.from('suppliers').select('*').limit(25)
        }
        if (res.error) {
          const msg = res.error.message || ''
          if (looksLikeMissingRelationError(msg, 'suppliers')) return []
          return []
        }
        const rows = Array.isArray(res.data) ? res.data : []
        if (res.error && looksLikeMissingColumnError(res.error.message)) {
          return rows
            .filter(r => String(r?.name || '').toLowerCase().includes(q.toLowerCase()))
            .slice(0, 5)
        }
        return rows
      }

      async function searchDocuments() {
        let res = await supabase.from('documents').select('id,name,url').ilike('name', like).limit(5)
        if (res.error && looksLikeMissingColumnError(res.error.message)) {
          res = await supabase.from('documents').select('*').limit(25)
        }
        if (res.error) {
          const msg = res.error.message || ''
          if (looksLikeMissingRelationError(msg, 'documents')) return []
          return []
        }
        const rows = Array.isArray(res.data) ? res.data : []
        if (res.error && looksLikeMissingColumnError(res.error.message)) {
          return rows
            .filter(r => String(r?.name || r?.title || '').toLowerCase().includes(q.toLowerCase()))
            .slice(0, 5)
        }
        return rows
      }

      async function searchActivities() {
        // Try title first; fallback to subject if needed; final fallback to local filtering
        let res = await supabase.from('activities').select('id,title,subject').or(`title.ilike.${like},subject.ilike.${like}`).limit(5)
        if (res.error && looksLikeMissingColumnError(res.error.message)) {
          res = await supabase.from('activities').select('*').limit(25)
        }
        if (res.error) {
          const msg = res.error.message || ''
          if (looksLikeMissingRelationError(msg, 'activities')) return []
          return []
        }
        const rows = Array.isArray(res.data) ? res.data : []
        if (res.error && looksLikeMissingColumnError(res.error.message)) {
          return rows
            .filter(r => String(r?.title || r?.subject || '').toLowerCase().includes(q.toLowerCase()))
            .slice(0, 5)
        }
        return rows
      }

      const [leads, suppliers, documents, activities] = await Promise.all([
        searchLeads(),
        searchSuppliers(),
        searchDocuments(),
        searchActivities(),
      ])

      if (cancelled) return

      const next = []

      for (const l of leads) {
        const name = l?.name || 'Unnamed lead'
        next.push({
          key: `lead-${l.id}-${name}`,
          type: 'Lead',
          title: name,
          subtitle: l?.phone ? String(l.phone) : null,
          onSelect: () => navigate('/pipeline'),
        })
      }
      for (const s of suppliers) {
        const name = s?.name || 'Supplier'
        next.push({
          key: `supplier-${s.id}-${name}`,
          type: 'Supplier',
          title: name,
          subtitle: null,
          onSelect: () => navigate('/suppliers'),
        })
      }
      for (const d of documents) {
        const name = d?.name || d?.title || 'Document'
        const url = d?.url || d?.link_url || null
        next.push({
          key: `document-${d.id}-${name}`,
          type: 'Document',
          title: name,
          subtitle: url ? 'Open file' : null,
          onSelect: () => {
            if (url) window.open(url, '_blank', 'noopener,noreferrer')
            else navigate('/documents')
          },
        })
      }
      for (const a of activities) {
        const title = a?.title || a?.subject || 'Activity'
        next.push({
          key: `activity-${a.id}-${title}`,
          type: 'Activity',
          title,
          subtitle: null,
          onSelect: () => navigate('/activities'),
        })
      }

      setResults(next.slice(0, 12))
      setSearching(false)
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [trimmed, navigate])

  const groupedResults = useMemo(() => {
    const groups = new Map()
    for (const r of results) {
      const arr = groups.get(r.type) || []
      arr.push(r)
      groups.set(r.type, arr)
    }
    return Array.from(groups.entries())
  }, [results])

  return (
    <div className="min-h-screen bg-field-cream dark:bg-field-black">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        "fixed top-0 left-0 bottom-0 w-[280px] bg-white dark:bg-field-dark border-r border-gray-200 dark:border-gray-800 z-50 transition-transform duration-300 lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="pt-6 pb-2 px-4 border-b border-gray-200">
            <a
              href="https://www.fieldpropertybali.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block"
            >
              <img src="/field-logo.png" alt="Field Property" className="h-16 w-auto" />
            </a>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-6 px-6 py-6">
            {filteredNavItems.map((group) => (
              <div key={group.section}>
                <p className="text-[10px] font-semibold text-field-stone-light tracking-[1.5px] px-3 mb-2">
                  {group.section}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) => clsx(
                        "nav-item",
                        isActive && "active"
                      )}
                    >
                      <item.icon className="w-4 h-4" />
                      <span className="flex-1">{item.label}</span>
                      {item.badge > 0 && (
                        <span className="bg-field-black text-white text-[11px] font-semibold px-2 py-0.5 rounded-full">
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* User */}
          <div className="px-6 pt-4 pb-6 border-t border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-field-black flex items-center justify-center text-white font-semibold text-sm">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-field-black truncate">{displayName}</p>
                <p className="text-xs text-field-stone capitalize">{role?.replace('_', ' ')}</p>
              </div>
              <button
                type="button"
                className="p-2 hover:bg-field-sand rounded-lg"
                onClick={() => setSettingsOpen(true)}
                aria-label="Open settings"
              >
                <Settings className="w-4 h-4 text-field-stone" />
              </button>
            </div>

            <button
              type="button"
              className="mt-4 w-full btn-secondary flex items-center justify-center gap-2"
              onClick={async () => {
                await signOut()
                navigate('/login', { replace: true })
              }}
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="lg:ml-[280px] min-h-screen">
        {/* Global header */}
        <header className="sticky top-0 z-30 bg-white dark:bg-field-dark border-b border-gray-200 dark:border-gray-800">
          <div className="px-4 lg:px-8 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 -ml-2 hover:bg-field-sand rounded-lg lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="relative flex-1 max-w-xl">
                <div className={clsx(
                  "flex items-center gap-2 bg-field-sand/60 dark:bg-field-black border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 transition-colors",
                  open && "bg-white"
                )}>
                  <Search className="w-4 h-4 text-field-stone" />
                  <input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
                    onFocus={() => { if (trimmed.length >= 2) setOpen(true) }}
                    onBlur={() => {
                      blurTimer.current = window.setTimeout(() => setOpen(false), 150)
                    }}
                    className="w-full bg-transparent outline-none text-sm text-field-black placeholder:text-field-stone dark:placeholder:text-gray-400"
                    placeholder="Search leads, suppliers, documents, activities…"
                  />
                  {searching && <span className="text-[11px] text-field-stone">Searching…</span>}
                </div>

                {open && trimmed.length >= 2 && (
                  <div
                    className="absolute left-0 right-0 mt-2 bg-white dark:bg-field-dark border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden"
                    onMouseDown={() => {
                      // prevent input blur while clicking results
                      if (blurTimer.current) window.clearTimeout(blurTimer.current)
                    }}
                  >
                    {results.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-field-stone">
                        {searching ? 'Searching…' : 'No results'}
                      </div>
                    ) : (
                      <div className="max-h-[60vh] overflow-y-auto">
                        {groupedResults.map(([type, items]) => (
                          <div key={type}>
                            <div className="px-4 pt-3 pb-1 text-[11px] font-semibold text-field-stone-light uppercase tracking-wider">
                              {type}
                            </div>
                            <div className="pb-2">
                              {items.map((item) => (
                                <button
                                  key={item.key}
                                  type="button"
                                  className="w-full text-left px-4 py-2 hover:bg-field-sand/60 transition-colors"
                                  onClick={() => {
                                    setOpen(false)
                                    setQuery('')
                                    item.onSelect()
                                  }}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-field-black truncate">{item.title}</p>
                                      {item.subtitle && (
                                        <p className="text-xs text-field-stone truncate">{item.subtitle}</p>
                                      )}
                                    </div>
                                    <ArrowRight className="w-4 h-4 text-field-stone-light flex-shrink-0" />
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="hidden lg:flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-field-black flex items-center justify-center text-white font-semibold text-xs">
                  {initials}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="p-4 lg:p-8">
          <Outlet />
        </div>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Aggressive reminder banner (top-right) */}
      {!reminderBannerDismissed && (reminderBuckets.urgent.length > 0 || reminderBuckets.soon.length > 0) && (
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
            <div
              className={clsx(
                "rounded-2xl shadow-2xl border-2 p-4",
                reminderBuckets.urgent.length > 0
                  ? "bg-red-600 border-red-400 text-white animate-pulse"
                  : "bg-orange-400 border-orange-300 text-black"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={clsx(
                    "font-extrabold tracking-wide",
                    reminderBuckets.urgent.length > 0 ? "text-white text-lg" : "text-black text-base"
                  )}>
                    {reminderBuckets.anyOverdue
                      ? '⚠️ OVERDUE REMINDER'
                      : reminderBuckets.anyDueToday
                        ? '⚠️ REMINDER DUE TODAY'
                        : 'Upcoming reminder'}
                  </p>
                  <p className={clsx(
                    "mt-1",
                    reminderBuckets.urgent.length > 0 ? "text-white/90 text-sm" : "text-black/80 text-sm"
                  )}>
                    {reminderBuckets.urgent.length > 0
                      ? `You have ${reminderBuckets.urgent.length} urgent reminder${reminderBuckets.urgent.length === 1 ? '' : 's'} that need attention.`
                      : `You have ${reminderBuckets.soon.length} reminder${reminderBuckets.soon.length === 1 ? '' : 's'} due in the next 2 days.`}
                  </p>
                </div>
                <button
                  type="button"
                  className={clsx(
                    "px-2 py-1 rounded-lg font-bold",
                    reminderBuckets.urgent.length > 0 ? "text-white/90 hover:text-white" : "text-black/70 hover:text-black"
                  )}
                  onClick={() => setReminderBannerDismissed(true)}
                  aria-label="Dismiss reminders banner"
                >
                  ✕
                </button>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className={clsx(
                    "px-3 py-2 rounded-lg font-semibold",
                    reminderBuckets.urgent.length > 0
                      ? "bg-white/15 hover:bg-white/25 text-white"
                      : "bg-white/50 hover:bg-white/70 text-black"
                  )}
                  onClick={() => navigate('/activities')}
                >
                  View →
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Blocking reminders gate (shows on every app open if reminders exist) */}
      {reminderGateOpen && reminderBuckets.urgent.length > 0 && (
        <ModalPortal>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              padding: '16px',
            }}
          >
            <div
              style={{
                backgroundColor: '#b91c1c',
                borderRadius: '12px',
                padding: '22px',
                width: '100%',
                maxWidth: '640px',
                maxHeight: '85vh',
                overflowY: 'auto',
                color: '#fff',
                border: '2px solid rgba(255,255,255,0.25)',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-display text-2xl sm:text-3xl font-extrabold mt-1">
                    ⚠️ OVERDUE REMINDER
                  </h2>
                  <p className="text-sm sm:text-base text-white/90 mt-2">
                    You have {reminderBuckets.urgent.length} reminder{reminderBuckets.urgent.length === 1 ? '' : 's'} that need attention!
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {reminderBuckets.urgent.map((r) => (
                  <button
                    key={String(r.id)}
                    type="button"
                    onClick={() => {
                      setReminderGateDismissed(true)
                      setReminderGateOpen(false)
                      navigate(`/activities?activity=${encodeURIComponent(String(r.id))}`)
                    }}
                    className={clsx(
                      "w-full text-left rounded-xl border p-4",
                      "bg-white/10 border-white/25 hover:bg-white/15"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-semibold truncate text-white">
                          {r.title}
                        </p>
                        <p className="text-sm mt-1 truncate text-white/90">
                          {r.leadName ? `Lead: ${r.leadName} · ` : ''}{r.reminderDate}{r.reminderTime ? ` · ${r.reminderTime}` : ''}
                        </p>
                      </div>
                      <span className="text-xs font-extrabold uppercase tracking-wide px-3 py-1 rounded-full flex-shrink-0 bg-white text-red-700">
                        {r.overdue ? 'Overdue' : 'Due Today'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                <button
                  type="button"
                  className="bg-white/15 hover:bg-white/25 text-white rounded-lg font-semibold px-4 py-3"
                  onClick={() => {
                    setReminderGateDismissed(true)
                    setReminderGateOpen(false)
                  }}
                >
                  Got it
                </button>
                <button
                  type="button"
                  className="bg-white text-red-700 hover:bg-white/90 rounded-lg font-extrabold px-4 py-3"
                  onClick={() => {
                    setReminderGateDismissed(true)
                    setReminderGateOpen(false)
                    navigate('/activities')
                  }}
                >
                  View All
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  )
}
