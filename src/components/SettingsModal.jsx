import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import ModalPortal from './ModalPortal'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

function looksLikeMissingRelationError(message, table) {
  if (!message) return false
  return message.includes('relation') && message.includes(table) && message.includes('does not exist')
}

export default function SettingsModal({ open, onClose }) {
  const { user, profile, role, updateProfile, updatePassword } = useAuth()

  const canManageUsers = role === 'owner'

  const tabs = useMemo(() => {
    const base = [
      { id: 'profile', label: 'User settings' },
      ...(canManageUsers ? [{ id: 'users', label: 'Users' }] : []),
      { id: 'password', label: 'Password' },
      { id: 'app', label: 'App settings' },
    ]
    return base
  }, [canManageUsers])

  const [tab, setTab] = useState('profile')

  // Profile form
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')

  // Users management
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersErr, setUsersErr] = useState('')
  const [users, setUsers] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('sales_rep')
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const [inviteErr, setInviteErr] = useState('')

  // Password form
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')

  // App settings
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    if (!open) return
    // reset ephemeral messages when opening
    setProfileMsg('')
    setProfileErr('')
    setInviteMsg('')
    setInviteErr('')
    setPwMsg('')
    setPwErr('')

    setTab(canManageUsers ? tab : (tab === 'users' ? 'profile' : tab))

    const pName = profile?.full_name || profile?.name || user?.user_metadata?.full_name || user?.user_metadata?.name || ''
    const pEmail = profile?.email || user?.email || ''
    setFullName(pName)
    setEmail(pEmail)

    const theme = typeof window !== 'undefined' ? window.localStorage.getItem('fieldcrm_theme') : null
    setDarkMode(theme === 'dark')
  }, [open, user, profile, canManageUsers]) // intentionally not depending on `tab`

  useEffect(() => {
    if (!open) return
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    if (tab !== 'users') return
    if (!canManageUsers) return

    let cancelled = false
    async function loadUsers() {
      setUsersLoading(true)
      setUsersErr('')
      const res = await supabase
        .from('profiles')
        .select('id,email,full_name,role,created_at')
        .order('created_at', { ascending: true })

      if (cancelled) return

      if (res.error) {
        const msg = res.error.message || ''
        if (looksLikeMissingRelationError(msg, 'profiles')) {
          setUsers([{
            id: profile?.id || user?.id || 'me',
            email: profile?.email || user?.email || '',
            full_name: profile?.full_name || user?.user_metadata?.full_name || '',
            role: role || 'owner',
          }])
        } else {
          setUsersErr(res.error.message || 'Failed to load users.')
          setUsers([])
        }
        setUsersLoading(false)
        return
      }

      setUsers(Array.isArray(res.data) ? res.data : [])
      setUsersLoading(false)
    }

    loadUsers()
    return () => { cancelled = true }
  }, [open, tab, canManageUsers, profile?.id, profile?.email, profile?.full_name, role, user?.id, user?.email, user?.user_metadata?.full_name])

  if (!open) return null

  async function saveProfile(e) {
    e.preventDefault()
    setProfileSaving(true)
    setProfileErr('')
    setProfileMsg('')

    const { error } = await updateProfile({ full_name: fullName, email })
    if (error) {
      setProfileErr(error.message || 'Could not update profile.')
      setProfileSaving(false)
      return
    }

    setProfileMsg('Saved.')
    setProfileSaving(false)
  }

  async function changePassword(e) {
    e.preventDefault()
    setPwSaving(true)
    setPwErr('')
    setPwMsg('')

    if (!newPassword || newPassword.length < 8) {
      setPwErr('Password must be at least 8 characters.')
      setPwSaving(false)
      return
    }
    if (newPassword !== confirmPassword) {
      setPwErr('Passwords do not match.')
      setPwSaving(false)
      return
    }

    const { error } = await updatePassword(newPassword)
    if (error) {
      setPwErr(error.message || 'Could not update password.')
      setPwSaving(false)
      return
    }

    setPwMsg('Password updated.')
    setNewPassword('')
    setConfirmPassword('')
    setPwSaving(false)
  }

  function toggleDarkMode(next) {
    setDarkMode(next)
    try {
      window.localStorage.setItem('fieldcrm_theme', next ? 'dark' : 'light')
    } catch {}
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', !!next)
    }
  }

  async function updateUserRole(userId, nextRole) {
    // optimistic UI
    setUsers(prev => prev.map(u => (u.id === userId ? { ...u, role: nextRole } : u)))
    const res = await supabase
      .from('profiles')
      .update({ role: nextRole, updated_at: new Date().toISOString() })
      .eq('id', userId)

    if (res.error) {
      // revert by reloading list if possible
      setUsersErr(res.error.message || 'Failed to update role.')
    }
  }

  async function invite(e) {
    e.preventDefault()
    setInviteSaving(true)
    setInviteErr('')
    setInviteMsg('')

    const targetEmail = inviteEmail.trim()
    if (!targetEmail) {
      setInviteErr('Email is required.')
      setInviteSaving(false)
      return
    }

    // Client-side apps cannot securely invite via Supabase Admin API.
    // We store an invite request if an `invites` table exists; otherwise we show a helpful message.
    const res = await supabase
      .from('invites')
      .insert({
        email: targetEmail,
        role: inviteRole,
        invited_by: user?.id || null,
        created_at: new Date().toISOString(),
        status: 'pending',
      })

    if (res.error) {
      const msg = res.error.message || ''
      if (looksLikeMissingRelationError(msg, 'invites')) {
        setInviteErr('Invites require backend setup (missing "invites" table / server-side invite flow).')
      } else {
        setInviteErr(res.error.message || 'Failed to create invite.')
      }
      setInviteSaving(false)
      return
    }

    setInviteMsg('Invite created.')
    setInviteEmail('')
    setInviteRole('sales_rep')
    setInviteSaving(false)
  }

  return (
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
        onClick={() => onClose?.()}
      >
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            width: '100%',
            maxWidth: '720px',
            maxHeight: '85vh',
            overflowY: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>Settings</h2>
              <p className="text-sm text-field-stone mt-1 mb-0">
                Manage your account and app preferences.
              </p>
            </div>
            <button type="button" onClick={() => onClose?.()} aria-label="Close">✕</button>
          </div>

          <div className="flex flex-wrap gap-2 mb-5">
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                className={clsx(
                  "px-3 py-2 rounded-lg text-sm border transition-colors",
                  tab === t.id ? "bg-field-sand border-gray-200 font-semibold" : "bg-white border-gray-200 hover:bg-field-sand/60"
                )}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'profile' && (
            <form onSubmit={saveProfile} className="space-y-4">
              {profileErr && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {profileErr}
                </div>
              )}
              {profileMsg && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
                  {profileMsg}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-field-stone-light">Name</label>
                  <input
                    className="input mt-1"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="text-xs text-field-stone-light">Email</label>
                  <input
                    type="email"
                    className="input mt-1"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                  <p className="text-[11px] text-field-stone mt-2">
                    Changing your login email may require verification depending on your Supabase settings.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" className="btn-secondary" onClick={() => onClose?.()} disabled={profileSaving}>
                  Close
                </button>
                <button type="submit" className="btn-primary" disabled={profileSaving}>
                  {profileSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          )}

          {tab === 'users' && canManageUsers && (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-field-black">Invite user</h3>
                <p className="text-sm text-field-stone mt-1">
                  Create an invite request and assign a role.
                </p>

                {inviteErr && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                    {inviteErr}
                  </div>
                )}
                {inviteMsg && (
                  <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
                    {inviteMsg}
                  </div>
                )}

                <form onSubmit={invite} className="mt-3 grid sm:grid-cols-3 gap-3 items-end">
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Email</label>
                    <input
                      type="email"
                      className="input mt-1"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="new.user@company.com"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Role</label>
                    <select
                      className="input mt-1"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                    >
                      <option value="owner">Owner</option>
                      <option value="sales_rep">Sales rep</option>
                    </select>
                  </div>
                  <div className="sm:col-span-3 flex justify-end">
                    <button type="submit" className="btn-primary" disabled={inviteSaving}>
                      {inviteSaving ? 'Creating…' : 'Invite'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="border-t border-gray-100 pt-6">
                <h3 className="font-semibold text-field-black">Manage users</h3>
                <p className="text-sm text-field-stone mt-1">
                  View users and adjust their role.
                </p>

                {usersErr && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                    {usersErr}
                  </div>
                )}

                <div className="mt-4 card-static overflow-hidden">
                  <div className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-gray-200 text-[11px] font-semibold text-field-stone-light uppercase tracking-wider">
                    <div className="col-span-5">User</div>
                    <div className="col-span-5">Email</div>
                    <div className="col-span-2">Role</div>
                  </div>

                  {usersLoading ? (
                    <div className="px-4 py-4 text-sm text-field-stone">Loading…</div>
                  ) : users.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-field-stone">No users found.</div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {users.map(u => (
                        <div key={u.id} className="grid grid-cols-12 gap-3 px-4 py-3 items-center">
                          <div className="col-span-5">
                            <div className="text-sm font-medium text-field-black truncate">
                              {u.full_name || '—'}
                              {u.id === user?.id && <span className="ml-2 text-[11px] text-field-stone">(you)</span>}
                            </div>
                          </div>
                          <div className="col-span-5">
                            <div className="text-sm text-field-stone truncate">{u.email || '—'}</div>
                          </div>
                          <div className="col-span-2">
                            <select
                              className="input !py-2"
                              value={u.role || 'sales_rep'}
                              onChange={(e) => updateUserRole(u.id, e.target.value)}
                            >
                              <option value="owner">Owner</option>
                              <option value="sales_rep">Sales rep</option>
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'password' && (
            <form onSubmit={changePassword} className="space-y-4">
              {pwErr && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {pwErr}
                </div>
              )}
              {pwMsg && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
                  {pwMsg}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-field-stone-light">New password</label>
                  <input
                    type="password"
                    className="input mt-1"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="text-xs text-field-stone-light">Confirm password</label>
                  <input
                    type="password"
                    className="input mt-1"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" className="btn-secondary" onClick={() => onClose?.()} disabled={pwSaving}>
                  Close
                </button>
                <button type="submit" className="btn-primary" disabled={pwSaving}>
                  {pwSaving ? 'Updating…' : 'Update password'}
                </button>
              </div>
            </form>
          )}

          {tab === 'app' && (
            <div className="space-y-4">
              <div className="card-static p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-field-black">Dark mode</p>
                    <p className="text-sm text-field-stone mt-1">
                      Toggle a darker theme (experimental).
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={darkMode}
                      onChange={(e) => toggleDarkMode(e.target.checked)}
                    />
                    {darkMode ? 'On' : 'Off'}
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" className="btn-secondary" onClick={() => onClose?.()}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

