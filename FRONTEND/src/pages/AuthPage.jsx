import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api from '../services/api'
import { Footer } from '../components/SiteChrome'

export function AuthPage({ mode, onSignedIn }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const isReg     = mode === 'register'
  const [error, setError] = useState('')
  const [busy, setBusy]   = useState(false)

  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true)
    const f = new FormData(e.currentTarget)
    try {
      if (isReg) await api.post('/auth/register', {
        fullName: f.get('fullName'), email: f.get('email'), password: f.get('password'),
      })
      const { data } = await api.post('/auth/login', { email: f.get('email'), password: f.get('password') })
      onSignedIn(data.user)
      navigate(location.state?.from || (data.user.role === 'admin' ? '/admin' : '/account'))
    } catch (err) {
      setError(err.response?.data?.error || 'Could not connect. Check that the API and database are running.')
    } finally { setBusy(false) }
  }

  return (
    <>
      <main>
        <div className="auth-layout">
          <aside className="auth-side">
            <span className="eyebrow">{isReg ? 'New to the workshop' : 'Welcome back'}</span>
            <h2>Every repair starts with a good conversation.</h2>
            <p>Create an account to request a service and keep all your booking updates in one place.</p>
            <div className="auth-side-note">
              Your account is private.<br />
              Only you and the mechanic see your booking details.
            </div>
          </aside>

          <div className="auth-form-side">
            <span className="eyebrow">{isReg ? 'Create account' : 'Sign in'}</span>
            <h1>{isReg ? 'Join the workshop.' : 'Sign in to continue.'}</h1>
            <p>{isReg ? 'A few details, then tell us about your bike.' : 'Access your bookings and repair updates.'}</p>
            <div className="form-card">
              <form onSubmit={submit}>
                {isReg && (
                  <div className="field">
                    <label className="field-label" htmlFor="fullName">Your name</label>
                    <input id="fullName" name="fullName" autoComplete="name" minLength={2} maxLength={120} required />
                  </div>
                )}
                <div className="field">
                  <label className="field-label" htmlFor="email">Email address</label>
                  <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="password">Password</label>
                  <input id="password" name="password" type="password"
                    autoComplete={isReg ? 'new-password' : 'current-password'}
                    minLength={10} maxLength={72} required />
                  {isReg && <span className="field-hint">At least 10 characters.</span>}
                </div>
                {error && <div className="msg msg-error" role="alert">{error}</div>}
                <div className="form-footer">
                  <button className="btn btn-primary btn-full" disabled={busy}>
                    {busy ? 'Please wait…' : isReg ? 'Create account' : 'Sign in'}
                  </button>
                </div>
              </form>
            </div>
            <p className="auth-switch">
              {isReg ? 'Already have an account? ' : 'New to the workshop? '}
              <Link to={isReg ? '/login' : '/register'}>{isReg ? 'Sign in' : 'Create an account'}</Link>
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}

/* ── Route guard ──────────────────────────────────────────── */
