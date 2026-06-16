import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { apiRequest } from '../lib/api'

export const Route = createFileRoute('/s/$slug/thank-you')({
  component: ThankYou,
})

interface SurveyMeta {
  title: string
  brand_color: string
  font_family: string
}

function ThankYou() {
  const { slug } = Route.useParams()
  const [survey, setSurvey] = useState<SurveyMeta | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function getMeta() {
      try {
        const res = await apiRequest<{ survey: SurveyMeta }>(`/api/public/survey/${slug}`)
        setSurvey(res.survey)
      } catch (err) {
        console.error('Failed to load thank you page details:', err)
      } finally {
        setLoading(false)
      }
    }
    getMeta()
  }, [slug])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
        Verifying Submission Receipt...
      </div>
    )
  }

  const brandColor = survey?.brand_color || '#0052d0'
  const fontFamily = survey?.font_family === 'Anton' ? 'Anton' : survey?.font_family === 'JetBrains Mono' ? 'JetBrains Mono' : 'Inter'

  return (
    <div 
      className="bg-background text-on-background min-h-screen flex flex-col relative selection:bg-secondary-container selection:text-on-background"
      style={{ fontFamily }}
    >
      {/* Dynamic Grid Background */}
      <div className="absolute inset-0 pointer-events-none z-0 bg-grid-pattern opacity-40"></div>

      {/* Main Content Area */}
      <main className="flex-grow flex items-center justify-center p-margin-mobile md:p-margin-desktop relative z-10 w-full max-w-container-max mx-auto">
        {/* Card */}
        <div className="w-full max-w-2xl bg-surface-container-lowest border-[3px] border-on-background shadow-[8px_8px_0px_0px_rgba(27,27,27,1)] flex flex-col rounded-none">
          {/* Header */}
          <div className="bg-on-background px-6 py-3 border-b-[3px] border-on-background flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div 
                className="w-3 h-3 border-[1px] border-surface-container-lowest animate-pulse"
                style={{ backgroundColor: brandColor }}
              ></div>
              <span className="font-label-sm text-label-sm text-surface-container-lowest uppercase tracking-widest">SYS_STATUS // 200_OK</span>
            </div>
            <span className="font-label-sm text-label-sm text-surface-variant hidden sm:inline-block">SEQ_ID: <span className="text-secondary-fixed">88X-OMEGA</span></span>
          </div>

          {/* Body */}
          <div className="p-8 md:p-16 flex flex-col items-center text-center">
            <div className="mb-10 relative group cursor-default">
              {/* Hard Offset Shadow */}
              <div 
                className="absolute inset-0 border-[2px] border-on-background translate-x-[6px] translate-y-[6px] transition-transform duration-300 group-hover:translate-x-[2px] group-hover:translate-y-[2px]"
                style={{ backgroundColor: brandColor }}
              ></div>
              {/* Primary Icon Surface */}
              <div className="w-24 h-24 bg-surface-container-lowest border-[3px] border-on-background flex items-center justify-center relative z-10 transition-transform duration-300 group-hover:-translate-y-1 group-hover:-translate-x-1">
                <span className="material-symbols-outlined text-[56px] text-primary" style={{ fontVariationSettings: "'FILL' 1", color: brandColor }}>check_circle</span>
              </div>
            </div>

            {/* Typography */}
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg uppercase mb-6 text-on-background tracking-tight">
              TRANSMISSION<br/><span style={{ color: brandColor }}>_COMPLETE</span>
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-md mb-12">
              Your responses have been successfully encoded and committed to the central data matrix. You may now terminate this session.
            </p>

            <div className="w-full border-t-[2px] border-dashed border-outline mb-12 relative flex justify-center">
              <div className="absolute -top-[10px] bg-surface-container-lowest px-4 font-label-sm text-label-sm text-outline-variant tracking-widest uppercase">END OF SEQUENCE</div>
            </div>

            {/* CTA */}
            <Link to="/signup" className="group relative w-full sm:w-auto inline-flex items-center justify-center">
              <div className="absolute inset-0 bg-on-background translate-x-[4px] translate-y-[4px] transition-transform duration-100 group-active:translate-x-0 group-active:translate-y-0"></div>
              <div 
                className="relative w-full sm:w-auto text-on-primary border-[3px] border-on-background px-8 py-4 flex items-center justify-center gap-3 transition-transform duration-100 group-active:translate-x-[4px] group-active:translate-y-[4px] font-label-lg text-label-lg uppercase tracking-wide"
                style={{ backgroundColor: brandColor }}
              >
                <span>Create your own survey</span>
                <span className="material-symbols-outlined text-[20px]">add_box</span>
              </div>
            </Link>

            <div className="mt-8 pt-6 border-t-[2px] border-on-background w-full flex justify-center items-center gap-2">
              <span className="font-label-sm text-label-sm text-on-surface-variant">POWERED BY</span>
              <span className="font-headline-sm text-headline-sm tracking-tighter text-on-background uppercase mt-1">DECODEGO</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-surface-container border-t-2 border-on-background mt-auto shrink-0 py-4">
        <div className="flex justify-between items-center px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto font-label-sm text-label-sm text-on-surface-variant">
          <span>DECODEGO Survey Platform</span>
          <span>© 2024 DECODEGO_LABS. ALL RIGHTS RESERVED.</span>
        </div>
      </footer>
    </div>
  )
}
