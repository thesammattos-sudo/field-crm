import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true })
  }, [loading, user, navigate])

  async function onSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (authError) {
      setError(authError.message || 'Login failed.')
      setSaving(false)
      return
    }

    setSaving(false)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="min-h-screen bg-field-cream dark:bg-field-black flex items-center justify-center p-4">
      <div className="w-full max-w-md card-static p-6 sm:p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <img src="/field-logo.png" alt="Field Property" className="h-12 w-auto" />
          <h1 className="font-display text-2xl font-semibold text-field-black mt-4">Sign in</h1>
          <p className="text-field-stone text-sm mt-1">Access your CRM dashboard</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-field-stone-light">Email</label>
            <input
              type="email"
              className="input mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label className="text-xs text-field-stone-light">Password</label>
            <input
              type="password"
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? 'Signing in…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}

