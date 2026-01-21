import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import ModalPortal from './ModalPortal'
import { supabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import ConfirmDialog from './ConfirmDialog'

function looksLikeMissingRelationError(message, table) {
  if (!message) return false
  return message.includes('relation') && message.includes(table) && message.includes('does not exist')
}

export default function SettingsModal({ open, onClose }) {
  const { user, profile, role, updateProfile, updatePassword, refreshProfile } = useAuth()
  const isOwner = role === 'owner'

  // Profile form
  const [fullName, setFullName] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')

  // Password form
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')

  // Dark mode
  const [darkMode, setDarkMode] = useState(false)

  // Add new user (owner-only)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState('sales_rep')
  const [newUserSaving, setNewUserSaving] = useState(false)
  const [newUserMsg, setNewUserMsg] = useState('')
  const [newUserErr, setNewUserErr] = useState('')

  // Manage existing users (owner-only)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersErr, setUsersErr] = useState('')
  const [users, setUsers] = useState([])
  const [deletingUser, setDeletingUser] = useState(false)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(null) // user row

  const isolatedAuthClient = useMemo(() => {
    // Separate client so creating users does NOT overwrite the current session.
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'fieldcrm_user_create',
      },
    })
  }, [])

  async function fetchUsersList() {
    if (!isOwner) return
    setUsersLoading(true)
    setUsersErr('')

    const res = await supabase
      .from('profiles')
      .select('id,email,name,role,created_at')
      .order('created_at', { ascending: true })

    if (res.error) {
      const msg = res.error.message || ''
      if (looksLikeMissingRelationError(msg, 'profiles')) {
        setUsers([{
          id: user?.id || 'me',
          email: user?.email || '',
          name: profile?.name || user?.user_metadata?.name || '',
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

  useEffect(() => {
    if (!open) return
    // reset ephemeral messages when opening
    setProfileMsg('')
    setProfileErr('')
    setPwMsg('')
    setPwErr('')
    setNewUserMsg('')
    setNewUserErr('')
    setUsersErr('')

    const pName = profile?.name || profile?.full_name || user?.user_metadata?.name || user?.user_metadata?.full_name || ''
    setFullName(pName)
    setNewPassword('')
    setConfirmPassword('')
    setNewUserEmail('')
    setNewUserPassword('')
    setNewUserRole('sales_rep')

    const theme = typeof window !== 'undefined' ? window.localStorage.getItem('fieldcrm_theme') : null
    setDarkMode(theme === 'dark')
  }, [open, user, profile])

  useEffect(() => {
    if (!open) return
    if (!isOwner) return
    fetchUsersList()
  }, [open, isOwner, user?.id, user?.email, profile?.name, role])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  async function saveProfile(e) {
    e.preventDefault()
    setProfileSaving(true)
    setProfileErr('')
    setProfileMsg('')

    const { error } = await updateProfile({ name: fullName, email: user?.email || '' })
    if (error) {
      setProfileErr(error.message || 'Could not update profile.')
      setProfileSaving(false)
      return
    }

    await refreshProfile?.()
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

  async function createNewUser(e) {
    e.preventDefault()
    if (!isOwner) return

    setNewUserSaving(true)
    setNewUserErr('')
    setNewUserMsg('')

    const email = newUserEmail.trim()
    const password = newUserPassword
    const roleValue = newUserRole

    if (!email) {
      setNewUserErr('Email is required.')
      setNewUserSaving(false)
      return
    }
    if (!password || password.length < 8) {
      setNewUserErr('Password must be at least 8 characters.')
      setNewUserSaving(false)
      return
    }

    const signUpRes = await isolatedAuthClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: roleValue,
        },
      },
    })

    if (signUpRes.error) {
      setNewUserErr(signUpRes.error.message || 'Failed to create user.')
      setNewUserSaving(false)
      return
    }

    const newUserId = signUpRes.data?.user?.id || null

    // Try to create a profile row for the new user (requires RLS/policy allowing owners).
    if (newUserId) {
      const upsertRes = await supabase
        .from('profiles')
        .upsert({
          id: newUserId,
          email,
          name: null,
          role: roleValue,
          created_at: new Date().toISOString(),
        })

      if (upsertRes.error) {
        const msg = upsertRes.error.message || ''
        if (looksLikeMissingRelationError(msg, 'profiles')) {
          setNewUserMsg('User created in Auth. Profiles table is missing, so role will default on first login.')
        } else {
          setNewUserMsg('User created in Auth. Could not set role in profiles due to permissions/policy.')
        }
      } else {
        setNewUserMsg('User created.')
      }
    } else {
      setNewUserMsg('User created.')
    }

    setNewUserEmail('')
    setNewUserPassword('')
    setNewUserRole('sales_rep')
    setNewUserSaving(false)

    // refresh list after creating user (best-effort)
    await fetchUsersList()
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
      setUsersErr(res.error.message || 'Failed to update role.')
    }
  }

  async function deleteUser(userRow) {
    if (!userRow?.id) return
    if (userRow.id === user?.id) {
      setUsersErr('You cannot delete your own user.')
      return
    }

    setDeletingUser(true)
    setUsersErr('')

    // NOTE: Client apps cannot delete auth users without Admin API/service role.
    // We delete the profile row (so the user disappears from the CRM users list).
    const res = await supabase.from('profiles').delete().eq('id', userRow.id)
    if (res.error) {
      setUsersErr(res.error.message || 'Failed to delete user.')
      setDeletingUser(false)
      return
    }

    setUsers(prev => prev.filter(u => u.id !== userRow.id))
    setDeletingUser(false)
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
        onClick={() => {
          if (profileSaving || pwSaving || newUserSaving || deletingUser) return
          onClose?.()
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--fieldcrm-panel)',
            borderRadius: '8px',
            padding: '24px',
            width: '100%',
            maxWidth: '560px',
            maxHeight: '85vh',
            overflowY: 'auto',
            color: 'var(--fieldcrm-text)',
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

          {/* 1) User Profile */}
          <div className="mb-6">
            <h3 className="font-semibold text-field-black">User Profile</h3>
            <p className="text-sm text-field-stone mt-1">View and edit your name.</p>

            <form onSubmit={saveProfile} className="mt-3 space-y-4">
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

              <div>
                <label className="text-xs text-field-stone-light">Name</label>
                <input
                  className="input mt-1"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="submit" className="btn-primary" disabled={profileSaving}>
                  {profileSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>

          {/* 2) Change Password */}
          <div className="border-t border-gray-100 pt-6 mb-6">
            <h3 className="font-semibold text-field-black">Change Password</h3>
            <p className="text-sm text-field-stone mt-1">Update your login password.</p>

            <form onSubmit={changePassword} className="mt-3 space-y-4">
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

              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="submit" className="btn-primary" disabled={pwSaving}>
                  {pwSaving ? 'Updating…' : 'Update password'}
                </button>
              </div>
            </form>
          </div>

          {/* Owner-only sections */}
          {isOwner && (
            <>
              {/* Invite new users */}
              <div className="border-t border-gray-100 pt-6 mb-6">
                <h3 className="font-semibold text-field-black">Invite New Users</h3>
                <p className="text-sm text-field-stone mt-1">Create a new user and assign a role.</p>

                {newUserErr && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                    {newUserErr}
                  </div>
                )}
                {newUserMsg && (
                  <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
                    {newUserMsg}
                  </div>
                )}

                <form onSubmit={createNewUser} className="mt-3 grid sm:grid-cols-3 gap-3 items-end">
                  <div className="sm:col-span-2">
                    <label className="text-xs text-field-stone-light">Email</label>
                    <input
                      type="email"
                      className="input mt-1"
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      placeholder="new.user@company.com"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-field-stone-light">Role</label>
                    <select
                      className="input mt-1"
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value)}
                    >
                      <option value="owner">Owner</option>
                      <option value="sales_rep">Sales rep</option>
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="text-xs text-field-stone-light">Temporary password</label>
                    <input
                      type="password"
                      className="input mt-1"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      autoComplete="new-password"
                    />
                    <p className="text-[11px] text-field-stone mt-2">
                      Depending on Supabase auth settings, the user may need to confirm their email before signing in.
                    </p>
                  </div>
                  <div className="sm:col-span-3 flex justify-end pt-1">
                    <button type="submit" className="btn-primary" disabled={newUserSaving}>
                      {newUserSaving ? 'Creating…' : 'Create user'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Manage existing users */}
              <div className="border-t border-gray-100 pt-6 mb-6">
                <h3 className="font-semibold text-field-black">Manage Users</h3>
                <p className="text-sm text-field-stone mt-1">View users, change roles, and delete users.</p>

                {usersErr && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                    {usersErr}
                  </div>
                )}

                <div className="mt-4 card-static overflow-hidden">
                  <div className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-gray-200 text-[11px] font-semibold text-field-stone-light uppercase tracking-wider">
                    <div className="col-span-4">Name</div>
                    <div className="col-span-5">Email</div>
                    <div className="col-span-2">Role</div>
                    <div className="col-span-1 text-right"> </div>
                  </div>

                  {usersLoading ? (
                    <div className="px-4 py-4 text-sm text-field-stone">Loading…</div>
                  ) : users.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-field-stone">No users found.</div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {users.map(u => (
                        <div key={u.id} className="grid grid-cols-12 gap-3 px-4 py-3 items-center">
                          <div className="col-span-4">
                            <div className="text-sm font-medium text-field-black truncate">
                              {u.name || '—'}
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
                              disabled={u.id === user?.id}
                            >
                              <option value="owner">Owner</option>
                              <option value="sales_rep">Sales rep</option>
                            </select>
                          </div>
                          <div className="col-span-1 flex justify-end">
                            <button
                              type="button"
                              className="p-2 rounded-lg hover:bg-red-50"
                              disabled={u.id === user?.id}
                              onClick={() => setConfirmDeleteUser(u)}
                              title={u.id === user?.id ? 'You cannot delete yourself' : 'Delete user'}
                            >
                              <span className="text-red-600 font-semibold">✕</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-field-stone mt-2">
                  Note: deleting here removes the user’s profile record. Deleting Auth users requires a server-side Admin API.
                </p>
              </div>

              {/* App settings (owner only) */}
              <div className="border-t border-gray-100 pt-6">
                <h3 className="font-semibold text-field-black">App Settings</h3>
                <p className="text-sm text-field-stone mt-1">Owner-only app preferences.</p>

                <div className="mt-3 card-static p-4">
                  <p className="text-sm text-field-stone">
                    More admin settings can be added here (notifications, defaults, integrations).
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Dark mode */}
          <div className="border-t border-gray-100 pt-6">
            <h3 className="font-semibold text-field-black">Appearance</h3>
            <p className="text-sm text-field-stone mt-1">Toggle dark mode for the whole app.</p>

            <div className="mt-3 card-static p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-field-black">Dark mode</p>
                  <p className="text-sm text-field-stone mt-1">
                    Uses a dark gray background and lighter text.
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
          </div>

          {/* 4) Close button */}
          <div className="flex items-center justify-end gap-3 pt-6">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onClose?.()}
              disabled={profileSaving || pwSaving || newUserSaving || deletingUser}
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDeleteUser}
        title="Delete user?"
        message={confirmDeleteUser?.email ? `Delete user "${confirmDeleteUser.email}"? This will remove their CRM profile.` : 'Delete this user?'}
        confirmText="Delete"
        cancelText="Cancel"
        loading={deletingUser}
        onCancel={() => setConfirmDeleteUser(null)}
        onConfirm={async () => {
          const target = confirmDeleteUser
          setConfirmDeleteUser(null)
          if (target) await deleteUser(target)
        }}
      />
    </ModalPortal>
  )
}

