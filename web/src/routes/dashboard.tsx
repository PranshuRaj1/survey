import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiRequest } from '../lib/api'

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
})

interface Survey {
  id: string
  slug: string
  title: string
  status: 'draft' | 'published' | 'closed'
  brand_color: string
  logo_url: string | null
  created_at: number
  updated_at: number
  response_count: number
}

function Dashboard() {
  const { user, logout, isAuthenticated, isLoading } = useAuth()
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [loadingSurveys, setLoadingSurveys] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeShareSurvey, setActiveShareSurvey] = useState<Survey | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate({ to: '/login', replace: true })
    }
  }, [isAuthenticated, isLoading, navigate])

  const fetchSurveys = async () => {
    try {
      const res = await apiRequest<{ surveys: Survey[] }>('/api/surveys')
      setSurveys(res.surveys)
    } catch (err) {
      console.error('Failed to load surveys:', err)
    } finally {
      setLoadingSurveys(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      fetchSurveys()
    }
  }, [isAuthenticated])

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
        Verifying Session...
      </div>
    )
  }

  const handleCreateSurvey = async () => {
    try {
      const res = await apiRequest<{ survey: { id: string } }>('/api/surveys', {
        method: 'POST',
        body: JSON.stringify({ title: 'New survey' }),
      })
      navigate({ to: `/builder/${res.survey.id}` })
    } catch (err) {
      alert('Failed to create survey')
    }
  }

  const handleDeleteSurvey = async (id: string) => {
    if (!confirm('Are you sure you want to delete this survey? All associated responses will be lost.')) {
      return
    }
    try {
      await apiRequest(`/api/surveys/${id}`, { method: 'DELETE' })
      setSurveys(surveys.filter((s) => s.id !== id))
    } catch (err: any) {
      alert(err?.message || 'Failed to delete survey')
    }
  }

  // Calculate metrics
  const totalResponses = surveys.reduce((acc, s) => acc + s.response_count, 0)
  const activeModules = surveys.filter((s) => s.status === 'published').length

  // Filter surveys
  const filteredSurveys = surveys.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.slug.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleCopyLink = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopyStatus('copied')
    setTimeout(() => setCopyStatus('idle'), 2000)
  }

  return (
    <div className="min-h-screen flex flex-col font-body-md bg-grid relative text-on-background">
      {/* TopNavBar */}
      <nav className="bg-background w-full brutal-border-bottom border-on-background flex justify-between items-center px-margin-desktop h-16 max-w-container-max mx-auto z-40 bg-opacity-90 backdrop-blur-sm sticky top-0">
        <div className="font-headline-md text-headline-md tracking-tighter text-on-background flex items-center gap-2">
          <span className="material-symbols-outlined text-[32px] font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>terminal</span>
          DECODEGO
        </div>
        <div className="hidden md:flex items-center gap-6 h-full">
          <Link to="/dashboard" className="h-full flex items-center text-primary underline underline-offset-4 decoration-3 font-label-lg text-label-lg px-4 brutal-border-l brutal-border-r border-transparent">
            Dashboard
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={handleCreateSurvey} className="hidden md:flex items-center gap-2 bg-primary text-on-primary font-label-lg text-label-lg px-4 py-2 brutal-border hard-shadow hover:bg-surface-tint">
            <span className="material-symbols-outlined text-[18px]">add</span>
            Create Survey
          </button>
          <div className="flex gap-2 items-center">
            <button onClick={() => logout()} title="Logout" className="p-2 text-on-surface hover:bg-secondary-container transition-colors duration-100 brutal-border border-transparent hover:border-on-background flex items-center justify-center">
              <span className="material-symbols-outlined">logout</span>
            </button>
            <div className="w-10 h-10 brutal-border overflow-hidden bg-surface-container-high ml-2 relative group cursor-pointer" onClick={() => logout()} title="Logout">
              <img alt="User profile" className="w-full h-full object-cover grayscale" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAcsXqYKmI7YaFI8DstQ3tZ25yD9R2zzfAvBMJJ3E-7_4aSLITbpDv-sgEHy54wqpxJZqxNb7hF7gUsuvFVZAG-dgF0h7nBD_zKjjv7PMPhWZiZp599fPnqWrPfrXMnCdAD_ucpG3AUzn_qh7og2ma5wJcu8LcdjKybXAl9MBhyYbAJvvp29cAHScnr3Ax6I5qaGiTrgiREIOVc0ITWnLrwrM8n34Gyj6A77j8NBuSA3A5blgrhqCT87wOhghYdiLukXuWOGyO3rys" />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span className="material-symbols-outlined text-white text-sm">logout</span>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Canvas */}
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 flex flex-col gap-8">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b-3 border-on-background pb-4">
          <div>
            <div className="font-label-sm text-label-sm uppercase bg-secondary-container text-on-secondary-container px-2 py-1 inline-block mb-2 brutal-border">System Overview</div>
            <h1 className="font-display-lg text-display-lg text-on-background">DASHBOARD_</h1>
            <p className="font-label-lg text-label-lg text-outline">MANAGE YOUR DATA COLLECTION MODULES.</p>
          </div>
          <div className="flex gap-4">
            <div className="bg-surface brutal-border p-4 flex flex-col justify-between min-w-[140px] hard-shadow bg-secondary-container">
              <span className="font-label-sm text-label-sm uppercase text-on-surface">Total Responses</span>
              <span className="font-headline-md text-headline-md font-bold mt-2">{totalResponses.toLocaleString()}</span>
            </div>
            <div className="bg-surface brutal-border p-4 flex flex-col justify-between min-w-[140px] hard-shadow">
              <span className="font-label-sm text-label-sm uppercase text-outline">Active Modules</span>
              <span className="font-headline-md text-headline-md font-bold mt-2 text-primary">{String(activeModules).padStart(2, '0')}</span>
            </div>
          </div>
        </header>

        {/* Controls / Filters */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-surface-container-low p-4 brutal-border">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="relative flex-grow md:w-64">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
              <input
                className="w-full bg-surface border-2 border-on-background pl-10 pr-4 py-2 font-label-lg text-label-lg focus:outline-none focus:bg-primary-fixed focus:border-on-background placeholder:text-outline/50 placeholder:font-label-sm"
                placeholder="FILTER_MODULES..."
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <button onClick={handleCreateSurvey} className="md:hidden w-full flex items-center justify-center gap-2 bg-primary text-on-primary font-label-lg text-label-lg px-4 py-3 brutal-border hard-shadow active:translate-x-1 active:translate-y-1">
            <span className="material-symbols-outlined text-[18px]">add</span>
            Create Survey
          </button>
        </div>

        {/* Loading / Survey Grid */}
        {loadingSurveys ? (
          <div className="text-center font-label-lg text-label-lg py-12">Loading surveys...</div>
        ) : filteredSurveys.length === 0 ? (
          <div className="text-center font-label-lg text-label-lg py-12 brutal-border bg-surface flex flex-col items-center gap-4 p-8">
            <span className="material-symbols-outlined text-4xl">inventory_2</span>
            <span>No data collection modules found.</span>
            <button onClick={handleCreateSurvey} className="bg-primary text-on-primary font-label-lg text-label-lg px-6 py-3 brutal-border hard-shadow">
              Create First Survey
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredSurveys.map((survey) => (
              <div key={survey.id} className="bg-surface flex flex-col brutal-border relative group">
                {/* Header Bar */}
                <div className="bg-on-background text-surface px-4 py-2 flex justify-between items-center border-b border-surface">
                  <span className="font-label-sm text-label-sm uppercase tracking-widest flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-none ${survey.status === 'published' ? 'bg-[#00ff00] animate-pulse' : 'bg-outline'}`}></span>
                    ID: {survey.slug}
                  </span>
                  <button onClick={() => handleDeleteSurvey(survey.id)} className="text-surface hover:text-error transition-colors" title="Delete Survey">
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
                {/* Body */}
                <div className="p-6 flex-grow flex flex-col gap-4">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-headline-sm text-headline-sm uppercase text-on-background line-clamp-1">{survey.title}</h3>
                      <span className={`font-label-sm text-label-sm px-2 py-1 brutal-border border-[2px] uppercase ${
                        survey.status === 'published' 
                          ? 'bg-primary-container text-on-primary-container' 
                          : 'bg-surface-variant text-on-surface-variant'
                      }`}>
                        {survey.status}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-px bg-on-background mt-auto brutal-border border-[2px]">
                    <div className="bg-surface p-3 flex flex-col">
                      <span className="font-label-sm text-label-sm text-outline uppercase">Responses</span>
                      <span className="font-label-lg text-label-lg text-on-background mt-1">{survey.response_count}</span>
                    </div>
                    <div className="bg-surface p-3 flex flex-col">
                      <span className="font-label-sm text-label-sm text-outline uppercase">Color Accent</span>
                      <span className="font-label-sm text-label-sm text-on-background mt-2 flex items-center gap-1 font-bold">
                        <span className="w-3 h-3 inline-block brutal-border border" style={{ backgroundColor: survey.brand_color }}></span>
                        {survey.brand_color.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Footer Actions */}
                <div className="border-t-2 border-on-background flex bg-surface-container-lowest">
                  <Link to="/builder/$surveyId" params={{ surveyId: survey.id }} className="flex-1 py-3 font-label-sm text-label-sm uppercase hover:bg-secondary-container transition-colors border-r-2 border-on-background flex items-center justify-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">edit_note</span> Edit
                  </Link>
                  {survey.status === 'published' ? (
                    <button onClick={() => setActiveShareSurvey(survey)} className="flex-1 py-3 font-label-sm text-label-sm uppercase hover:bg-secondary-container transition-colors border-r-2 border-on-background flex items-center justify-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">share</span> Share
                    </button>
                  ) : (
                    <button disabled className="flex-1 py-3 font-label-sm text-label-sm uppercase opacity-40 border-r-2 border-on-background flex items-center justify-center gap-1 cursor-not-allowed">
                      <span className="material-symbols-outlined text-[16px]">share</span> Share
                    </button>
                  )}
                  <Link to="/analytics/$surveyId" params={{ surveyId: survey.id }} className="flex-1 py-3 font-label-sm text-label-sm uppercase bg-primary text-on-primary hover:bg-surface-tint transition-colors flex items-center justify-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">analytics</span> View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-on-background w-full brutal-border-top border-on-background flex justify-between items-center px-margin-desktop py-4 text-background z-10 mt-auto">
        <div className="font-label-lg text-label-lg font-bold">
          DECODEGO
        </div>
        <div className="font-label-sm text-label-sm text-surface-variant flex gap-4">
          <span className="hidden md:inline">© 2024 DECODEGO_LABS. ALL RIGHTS RESERVED.</span>
        </div>
      </footer>

      {/* Share Modal Overlay */}
      {activeShareSurvey && (
        <div className="fixed inset-0 bg-inverse-surface/80 z-50 backdrop-blur-sm flex items-center justify-center p-margin-mobile md:p-margin-desktop">
          {/* Modal Container */}
          <main className="bg-surface brutal-border brutal-shadow w-full max-w-[800px] flex flex-col relative">
            {/* Modal Header */}
            <header className="bg-on-background text-background flex justify-between items-center px-6 py-4 border-b-3 border-on-background">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>ios_share</span>
                <h1 className="font-label-lg text-label-lg uppercase tracking-wider">SHARE_MODULE // {activeShareSurvey.slug}</h1>
              </div>
              <button aria-label="Close modal" className="text-background hover:text-tertiary-fixed transition-colors" onClick={() => setActiveShareSurvey(null)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </header>
            {/* Modal Body */}
            <div className="p-8 flex flex-col gap-8">
              {/* Section 1: Public Link */}
              <section className="flex flex-col gap-3">
                <div className="flex justify-between items-end mb-1">
                  <label className="font-label-sm text-label-sm uppercase text-on-surface-variant flex items-center gap-2">
                    <span className="w-2 h-2 bg-secondary-container inline-block border border-on-background"></span>
                    DESTINATION_PATH
                  </label>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-grow flex items-center bg-surface-bright brutal-border-bottom sm:neo-border-sm px-4 py-3">
                    <span className="material-symbols-outlined text-on-surface-variant mr-3">link</span>
                    <input
                      className="w-full bg-transparent border-none p-0 focus:ring-0 font-label-lg text-label-lg text-primary selection:bg-secondary-container selection:text-on-secondary-fixed focus:outline-none"
                      readOnly
                      type="text"
                      value={`${window.location.origin}/s/${activeShareSurvey.slug}`}
                    />
                  </div>
                  <button
                    onClick={() => handleCopyLink(`${window.location.origin}/s/${activeShareSurvey.slug}`)}
                    className="bg-primary text-on-primary neo-border-sm font-label-lg text-label-lg uppercase px-6 py-3 sm:ml-[-2px] neo-shadow hover:bg-primary-container transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">content_copy</span>
                    <span>{copyStatus === 'copied' ? 'Copied!' : 'Copy Link'}</span>
                  </button>
                </div>
              </section>
              <hr className="border-t border-dashed border-on-surface-variant/40" />
              {/* Section 2: Embed Code */}
              <section className="flex flex-col gap-3">
                <label className="font-label-sm text-label-sm uppercase text-on-surface-variant flex items-center gap-2">
                  <span className="w-2 h-2 bg-primary inline-block border border-on-background"></span>
                  INTEGRATION_PAYLOAD (IFRAME)
                </label>
                <div className="relative group">
                  <pre className="bg-inverse-on-surface neo-border-sm p-4 font-label-sm text-label-sm text-on-surface overflow-x-auto">
                    <code>{`<iframe src="${window.location.origin}/s/${activeShareSurvey.slug}" width="100%" height="600px" frameborder="0"></iframe>`}</code>
                  </pre>
                  <button
                    onClick={() => handleCopyLink(`<iframe src="${window.location.origin}/s/${activeShareSurvey.slug}" width="100%" height="600px" frameborder="0"></iframe>`)}
                    className="absolute top-4 right-4 bg-surface neo-border-sm px-3 py-1 font-label-sm text-label-sm uppercase hover:bg-secondary-container transition-colors neo-shadow-hover flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">code</span>
                    <span>Copy Snippet</span>
                  </button>
                </div>
              </section>
            </div>
            {/* Modal Footer */}
            <footer className="bg-surface-container-low border-t-3 border-on-background p-6 flex justify-end">
              <button onClick={() => setActiveShareSurvey(null)} className="bg-on-background text-background font-label-lg text-label-lg uppercase px-8 py-3 neo-shadow-hover transition-all">
                Done
              </button>
            </footer>
          </main>
        </div>
      )}
    </div>
  )
}
