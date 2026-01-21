import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Menu, Home, Users, Building2, Truck, Package, FileText, CheckSquare, Settings, Search, LogOut } from 'lucide-react'
import { activities } from '../data'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

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
  const navigate = useNavigate()
  const { user, profile, role, signOut } = useAuth()

  const displayName = profile?.full_name || profile?.name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'User'
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
    <div className="min-h-screen bg-field-cream">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        "fixed top-0 left-0 bottom-0 w-[280px] bg-white border-r border-gray-200 z-50 transition-transform duration-300 lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="pt-6 pb-2 px-4 border-b border-gray-200">
            <img src="/field-logo.png" alt="Field Property" className="h-16 w-auto" />
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
              <button className="p-2 hover:bg-field-sand rounded-lg">
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
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
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
                  "flex items-center gap-2 bg-field-sand/60 border border-gray-200 rounded-xl px-3 py-2 transition-colors",
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
                    className="w-full bg-transparent outline-none text-sm text-field-black placeholder:text-field-stone"
                    placeholder="Search leads, suppliers, documents, activities…"
                  />
                  {searching && <span className="text-[11px] text-field-stone">Searching…</span>}
                </div>

                {open && trimmed.length >= 2 && (
                  <div
                    className="absolute left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
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
    </div>
  )
}
