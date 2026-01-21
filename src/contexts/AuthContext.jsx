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

  async function refreshProfile(targetUser = user) {
    if (!targetUser) {
      setProfile(null)
      return { data: null, error: null }
    }

    const fetchRes = await supabase
      .from('profiles')
      .select('*')
      .eq('id', targetUser.id)
      .maybeSingle()

    if (fetchRes.error) {
      const msg = fetchRes.error.message || ''
      if (looksLikeMissingRelationError(msg, 'profiles')) {
        const fallback = {
          id: targetUser.id,
          email: targetUser.email || null,
          full_name: targetUser.user_metadata?.full_name || targetUser.user_metadata?.name || null,
          role: 'owner',
        }
        setProfile(fallback)
        return { data: fallback, error: null }
      }
      // swallow errors but keep last profile if any
      return { data: null, error: fetchRes.error }
    }

    if (fetchRes.data) setProfile(fetchRes.data)
    return { data: fetchRes.data || null, error: null }
  }

  async function updateProfile({ full_name, email }) {
    if (!user) return { error: new Error('Not signed in') }

    const trimmedName = typeof full_name === 'string' ? full_name.trim() : ''
    const trimmedEmail = typeof email === 'string' ? email.trim() : ''

    // 1) Update profiles table (if it exists)
    let nextProfile = {
      ...(profile || {}),
      id: user.id,
      full_name: trimmedName || null,
      email: trimmedEmail || user.email || null,
    }

    const updateRes = await supabase
      .from('profiles')
      .update({
        full_name: trimmedName || null,
        email: trimmedEmail || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select('*')
      .maybeSingle()

    if (!updateRes.error && updateRes.data) {
      nextProfile = updateRes.data
    } else if (updateRes.error) {
      const msg = updateRes.error.message || ''
      if (!looksLikeMissingRelationError(msg, 'profiles')) {
        // If RLS blocks or schema differs, we still allow local UI update.
      }
    }

    // 2) Update auth user metadata and possibly email
    // Note: Email changes can require verification, and may fail depending on Supabase settings.
    let authErr = null
    const updates = {}
    if (trimmedName) updates.data = { full_name: trimmedName }
    if (trimmedEmail && trimmedEmail !== user.email) updates.email = trimmedEmail

    if (Object.keys(updates).length > 0) {
      const res = await supabase.auth.updateUser(updates)
      if (res.error) authErr = res.error
      if (res.data?.user) setUser(res.data.user)
    }

    setProfile(nextProfile)
    return { error: authErr }
  }

  async function updatePassword(newPassword) {
    if (!user) return { error: new Error('Not signed in') }
    const res = await supabase.auth.updateUser({ password: newPassword })
    if (res.data?.user) setUser(res.data.user)
    return { error: res.error || null }
  }

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
    refreshProfile,
    updateProfile,
    updatePassword,
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

