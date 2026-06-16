import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

export const Route = createFileRoute('/signup')({
  component: Signup,
})

function Signup() {
  const { signup, isAuthenticated, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [latency, setLatency] = useState<number | null>(null)
  const [networkStatus, setNetworkStatus] = useState('Network_Idle')
  const navigate = useNavigate()

  useEffect(() => {
    const measurePing = async () => {
      const start = performance.now()
      try {
        setNetworkStatus('Connecting...')
        await fetch('/api/health')
        const end = performance.now()
        setLatency(Math.round(end - start))
        setNetworkStatus('Network_Idle')
      } catch {
        setNetworkStatus('Offline')
        setLatency(null)
      }
    }
    measurePing()
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      navigate({ to: '/dashboard', replace: true })
    }
  }, [isAuthenticated, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setSubmitting(true)
    try {
      await signup(email, password)
      navigate({ to: '/dashboard', replace: true })
    } catch (err: any) {
      setError(err?.message || 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-margin-mobile md:p-margin-desktop font-body-md text-body-md selection:bg-secondary-fixed selection:text-on-secondary-fixed bg-grid-pattern flex-grow w-full relative">
      <div className="relative w-full max-w-[440px]">
        {/* Hard Pop Shadow */}
        <div aria-hidden="true" className="absolute inset-0 bg-on-background translate-x-[6px] translate-y-[6px] border-[3px] border-on-background"></div>
        {/* Module Canvas */}
        <main className="relative bg-surface border-[3px] border-on-background flex flex-col shadow-none z-10">
          {/* Module Header */}
          <header className="bg-on-background text-background px-4 py-3 flex justify-between items-center border-b-[3px] border-on-background">
            <span className="font-label-sm text-label-sm uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 bg-secondary-fixed inline-block"></span>
              AUTH_MODULE // REGISTER
            </span>
            <span className="font-label-sm text-label-sm opacity-60">SYS.ON</span>
          </header>
          {/* Module Body */}
          <div className="p-gutter flex flex-col gap-8">
            <div className="flex flex-col gap-1">
              <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg uppercase tracking-tight text-on-background">
                DECODEGO
              </h1>
              <p className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>terminal</span>
                Register access keys to start.
              </p>
            </div>

            {error && (
              <div className="bg-error-container text-on-error-container border-[3px] border-error p-3 font-label-sm text-label-sm uppercase flex items-center gap-2">
                <span className="material-symbols-outlined">warning</span>
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-col gap-6">
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="font-label-sm text-label-sm uppercase flex items-center justify-between" htmlFor="email">
                    <span>Target_Address</span>
                  </label>
                  <input
                    className="w-full bg-surface-container-lowest border-[3px] border-on-background p-3 font-label-lg text-label-lg focus:outline-none focus:bg-primary-fixed focus:border-on-background placeholder:text-on-background/30 placeholder:font-label-sm rounded-none transition-colors"
                    id="email"
                    placeholder="user@domain.com"
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-label-sm text-label-sm uppercase flex items-center justify-between" htmlFor="password">
                    <span>Secret_Passcode</span>
                  </label>
                  <input
                    className="w-full bg-surface-container-lowest border-[3px] border-on-background p-3 font-label-lg text-label-lg focus:outline-none focus:bg-primary-fixed focus:border-on-background placeholder:text-on-background/30 placeholder:font-label-sm rounded-none transition-colors"
                    id="password"
                    placeholder="••••••••"
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-label-sm text-label-sm uppercase flex items-center justify-between" htmlFor="confirmPassword">
                    <span>Confirm_Passcode</span>
                  </label>
                  <input
                    className="w-full bg-surface-container-lowest border-[3px] border-on-background p-3 font-label-lg text-label-lg focus:outline-none focus:bg-primary-fixed focus:border-on-background placeholder:text-on-background/30 placeholder:font-label-sm rounded-none transition-colors"
                    id="confirmPassword"
                    placeholder="••••••••"
                    required
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>

                <button className="relative group cursor-pointer mt-2 w-full" type="submit" disabled={submitting}>
                  <div aria-hidden="true" className="absolute inset-0 bg-on-background translate-x-[4px] translate-y-[4px] border-[3px] border-on-background transition-transform duration-75 group-active:translate-x-0 group-active:translate-y-0"></div>
                  <div className="relative w-full bg-primary text-on-primary border-[3px] border-on-background py-3 px-4 font-label-lg text-label-lg uppercase flex justify-between items-center transition-transform duration-75 group-active:translate-x-[4px] group-active:translate-y-[4px]">
                    <span>{submitting ? 'Registering...' : 'Register'}</span>
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>arrow_right_alt</span>
                  </div>
                </button>
              </form>

              <div className="flex items-center gap-4 py-2">
                <div className="h-px flex-1 border-t-2 border-dashed border-outline-variant"></div>
                <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest bg-surface px-2">ALREADY_REGISTERED</span>
                <div className="h-px flex-1 border-t-2 border-dashed border-outline-variant"></div>
              </div>

              <div className="flex flex-col gap-3">
                <Link to="/login" className="w-full bg-surface-container-lowest border-[3px] border-on-background py-3 px-4 font-label-lg text-label-lg uppercase flex justify-center items-center gap-3 hover:bg-secondary-fixed hover:text-on-secondary-fixed transition-colors text-center">
                  <span className="material-symbols-outlined">login</span>
                  <span>Sign In Instead</span>
                </Link>
              </div>
            </div>
          </div>
          <div className="bg-surface-container border-t-[3px] border-on-background p-2 px-4 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 inline-block border border-on-background ${networkStatus === 'Offline' ? 'bg-error' : 'bg-primary animate-pulse'}`}></span>
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">{networkStatus}</span>
            </div>
            <span className="font-label-sm text-label-sm text-on-surface-variant">{latency !== null ? `${latency}ms` : '---'}</span>
          </div>
        </main>
      </div>
    </div>
  )
}
