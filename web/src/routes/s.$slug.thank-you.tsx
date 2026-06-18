import { createFileRoute, Link } from '@tanstack/react-router'
import { apiRequest } from '../lib/api'

interface SurveyMeta {
  title: string
  brand_color: string
  font_family: string
}

export const Route = createFileRoute('/s/$slug/thank-you')({
  loader: async ({ params }) => {
    const res = await apiRequest<{ survey: SurveyMeta }>(`/api/public/survey/${params.slug}`)
    return { survey: res.survey }
  },
  pendingComponent: () => (
    <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
      Verifying Submission Receipt...
    </div>
  ),
  component: ThankYou,
})

function ThankYou() {
  const { survey } = Route.useLoaderData()

  const brandColor = survey?.brand_color || '#0052d0'
  const fontFamily =
    survey?.font_family === 'Anton'
      ? 'Anton'
      : survey?.font_family === 'JetBrains Mono'
        ? 'JetBrains Mono'
        : 'Inter'

  return (
    <div
      className="bg-background text-on-background min-h-screen flex flex-col relative selection:bg-secondary-container selection:text-on-background"
      style={{ fontFamily }}
    >
      {/* Dynamic Grid Background */}
      <div className="absolute inset-0 pointer-events-none z-0 bg-grid-pattern opacity-40"></div>

      {/* Main Content Area */}
      <main className="flex-grow flex flex-col relative w-full">
        {/* Top Navigation Header */}
        <header className="w-full top-0 border-b-4 border-on-background bg-background z-50">
          <div className="flex justify-between items-center h-16 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
            <div className="font-headline-md text-headline-md uppercase tracking-tighter text-on-background">
              {survey?.title || 'DECODEGO'}
            </div>
            <div className="flex items-center gap-4">
              <span
                className="material-symbols-outlined text-primary"
                style={{ color: brandColor }}
              >
                help_outline
              </span>
            </div>
          </div>
        </header>

        {/* Confirmation Card Center */}
        <div className="flex-grow flex items-center justify-center p-margin-mobile md:p-margin-desktop relative">
          <div className="w-full max-w-2xl relative">
            <div className="bg-background border-[3px] border-on-background brutal-shadow p-8 md:p-12 relative overflow-hidden">
              <div className="flex flex-col items-center text-center space-y-6">
                <div
                  className="w-20 h-20 border-2 border-on-background flex items-center justify-center"
                  style={{ backgroundColor: brandColor, color: '#ffffff' }}
                >
                  <span
                    className="material-symbols-outlined text-4xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    check_circle
                  </span>
                </div>
                <div className="space-y-4">
                  <h1 className="font-headline-lg text-headline-lg uppercase tracking-tight text-on-background">
                    Submission Received
                  </h1>
                  <p className="font-body-lg text-body-lg max-w-md mx-auto leading-relaxed">
                    Thank you for your response. Your data has been successfully recorded.
                  </p>
                </div>
                <div className="pt-8 w-full flex flex-col md:flex-row gap-4 justify-center">
                  <Link
                    to="/signup"
                    className="text-on-primary border-2 border-on-background px-8 py-4 font-label-lg text-label-lg uppercase tracking-widest brutal-shadow brutal-shadow-active hover:bg-primary transition-colors flex items-center justify-center gap-2"
                    style={{ backgroundColor: brandColor }}
                  >
                    <span>Create Your Own Survey</span>
                    <span className="material-symbols-outlined">add_circle</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t-2 border-on-background bg-surface-container mt-auto">
        <div className="flex flex-col md:flex-row justify-between items-center py-6 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
          <div className="font-label-lg text-label-lg text-primary flex items-center gap-2">
            <span className="material-symbols-outlined text-sm" style={{ color: brandColor }}>
              bolt
            </span>
            <span style={{ color: brandColor }}>Powered by DECODEGO</span>
          </div>
          <div className="font-label-sm text-label-sm text-on-surface mt-4 md:mt-0 uppercase tracking-tighter">
            © 2026 DECODEGO LABS. ALL RIGHTS RESERVED.
          </div>
          <div className="flex gap-6 mt-4 md:mt-0">
            <a
              className="font-label-sm text-label-sm text-on-surface-variant hover:text-tertiary transition-opacity duration-200 uppercase"
              href="#"
            >
              Support
            </a>
            <a
              className="font-label-sm text-label-sm text-on-surface-variant hover:text-tertiary transition-opacity duration-200 uppercase"
              href="#"
            >
              Terms
            </a>
            <a
              className="font-label-sm text-label-sm text-on-surface-variant hover:text-tertiary transition-opacity duration-200 uppercase"
              href="#"
            >
              Privacy
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
