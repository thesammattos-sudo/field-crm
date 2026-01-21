import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

function looksLikeMissingRelationError(message, table) {
  if (!message) return false
  return message.includes('relation') && message.includes(table) && message.includes('does not exist')
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function init() {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      setUser(data?.session?.user || null)
      setLoading(false)
    }

    init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
    })

    return () => {
      mounted = false
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function ensureProfile() {
      if (!user) {
        setProfile(null)
        return
      }

      // Try to fetch profile. If missing, create it on first login.
      const fetchRes = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return

      if (fetchRes.error) {
        // If profiles table isn't created or access is blocked, fall back to local display data.
        const msg = fetchRes.error.message || ''
        if (!looksLikeMissingRelationError(msg, 'profiles')) {
          // swallow errors but still allow app usage
        }
        setProfile({
          id: user.id,
          email: user.email || null,
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
          role: 'owner',
        })
        return
      }

      if (fetchRes.data) {
        setProfile(fetchRes.data)
        return
      }

      const displayName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        (user.email ? String(user.email).split('@')[0] : null)

      const insertRes = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email || null,
          full_name: displayName,
          role: 'owner',
          created_at: new Date().toISOString(),
        })
        .select('*')
        .maybeSingle()

      if (cancelled) return

      if (insertRes.error) {
        // fallback profile
        setProfile({
          id: user.id,
          email: user.email || null,
          full_name: displayName,
          role: 'owner',
        })
        return
      }

      setProfile(insertRes.data || {
        id: user.id,
        email: user.email || null,
        full_name: displayName,
        role: 'owner',
      })
    }

    ensureProfile()
    return () => { cancelled = true }
  }, [user])

  const value = useMemo(() => ({
    user,
    profile,
    role: profile?.role || 'owner',
    loading,
    async signOut() {
      await supabase.auth.signOut()
    },
  }), [user, profile, loading])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

