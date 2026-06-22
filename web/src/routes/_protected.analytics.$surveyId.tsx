import { createFileRoute, Link } from '@tanstack/react-router'
import { useAuth } from '../context/AuthContext'
import { apiRequest } from '../lib/api'

interface QuestionAnalytic {
  question_id: string
  label: string
  type: 'short_text' | 'long_text' | 'multiple_choice' | 'rating' | 'date'
  count: number
  average?: number // For rating questions
  tally?: Record<string, number> // For multiple_choice questions
}

interface AnalyticsData {
  total: number
  /** Total unique visits tracked via Cloudflare KV (≥ total responses) */
  visits: number
  /** Average survey completion duration in seconds, null if no data yet */
  avgDuration: number | null
  questions: QuestionAnalytic[]
}

interface SurveyData {
  id: string
  slug: string
  title: string
}

export const Route = createFileRoute('/_protected/analytics/$surveyId')({
  loader: async ({ params }) => {
    const [surveyRes, analyticsRes, responsesRes] = await Promise.all([
      apiRequest<{ survey: SurveyData }>(`/api/surveys/${params.surveyId}`),
      apiRequest<AnalyticsData>(`/api/responses/${params.surveyId}/analytics`),
      apiRequest<{ responses: { submitted_at: number }[] }>(`/api/responses/${params.surveyId}`),
    ])
    return {
      survey: surveyRes.survey,
      data: analyticsRes,
      responses: responsesRes.responses || [],
    }
  },
  component: Analytics,
})

function Analytics() {
  const { surveyId } = Route.useParams()
  const { survey, data, responses } = Route.useLoaderData()
  const { user, logout } = useAuth()

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
        Compiling Analytics...
      </div>
    )
  }

  // Calculate dynamic stats
  // Format a real duration (seconds) into a human-readable string.
  // Returns 'N/A' when no completion data has been collected yet.
  const formatDuration = (secs: number | null): string => {
    if (secs === null || secs === undefined || secs === 0) return 'N/A'
    const mins = Math.floor(secs / 60)
    const remainingSecs = Math.round(secs % 60)
    return mins > 0 ? `${mins}m ${remainingSecs}s` : `${remainingSecs}s`
  }

  const estTime = formatDuration(data.avgDuration)
  const estTimeSub =
    data.avgDuration !== null ? 'Avg. actual completion time' : 'No submissions yet'

  // Real bounce rate: visitors who loaded the survey but never submitted.
  // Guards against division-by-zero when visits is 0.
  const visits = data.visits || data.total || 0
  const bounceRate =
    visits > 0 ? Math.max(0, Math.round(((visits - data.total) / visits) * 100)) : 0
  const bounceRateText = `${bounceRate}%`
  const engagementText =
    visits === 0
      ? 'No visits yet'
      : bounceRate === 0
        ? 'Perfect completion rate'
        : bounceRate < 20
          ? 'Exceptional engagement'
          : bounceRate < 40
            ? 'Excellent engagement'
            : bounceRate < 60
              ? 'Good engagement'
              : 'Needs improvement'

  const generateChartPoints = () => {
    if (responses.length === 0) return '0,95 100,95'

    // Sort ascending by time
    const sorted = [...responses].sort((a, b) => a.submitted_at - b.submitted_at)

    const totalCount = sorted.length
    const points: string[] = []

    // Start at (0, 95)
    points.push('0,95')

    sorted.forEach((_res, index) => {
      const x = Math.round(((index + 1) / totalCount) * 100)
      const count = index + 1
      const y = Math.round(95 - (count / totalCount) * 90)
      points.push(`${x},${y}`)
    })

    return points.join(' ')
  }

  return (
    <div className="min-h-screen flex flex-col font-body-md bg-grid relative text-on-background">
      {/* TopNavBar */}
      <nav className="bg-background w-full brutal-border-bottom border-on-background flex justify-between items-center px-margin-desktop h-16 max-w-container-max mx-auto z-40 sticky top-0 bg-opacity-90 backdrop-blur-sm">
        <div className="flex items-center gap-8">
          <Link to="/dashboard" className="flex items-center">
            <img src="/favicon.jpg" alt="DECODEGO" className="h-10 w-auto object-contain" />
          </Link>
          <div className="hidden md:flex gap-6">
            <Link to="/dashboard" className="text-on-surface font-label-lg text-label-lg px-2 py-1">
              Dashboard
            </Link>
            <Link
              to="/builder/$surveyId"
              params={{ surveyId }}
              className="text-on-surface font-label-lg text-label-lg px-2 py-1"
            >
              Builder
            </Link>
            <Link
              to="/responses/$surveyId"
              params={{ surveyId }}
              className="text-on-surface font-label-lg text-label-lg px-2 py-1"
            >
              Responses
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => logout()}
            title="Logout"
            className="p-2 text-on-surface hover:bg-secondary-container transition-colors brutal-border border-transparent hover:border-on-background flex items-center justify-center"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
          <div
            className="w-10 h-10 brutal-border overflow-hidden bg-surface-container-high"
            onClick={() => logout()}
            title="Logout"
          >
            <img
              alt="User profile"
              className="w-full h-full object-cover grayscale cursor-pointer"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuAcsXqYKmI7YaFI8DstQ3tZ25yD9R2zzfAvBMJJ3E-7_4aSLITbpDv-sgEHy54wqpxJZqxNb7hF7gUsuvFVZAG-dgF0h7nBD_zKjjv7PMPhWZiZp599fPnqWrPfrXMnCdAD_ucpG3AUzn_qh7og2ma5wJcu8LcdjKybXAl9MBhyYbAJvvp29cAHScnr3Ax6I5qaGiTrgiREIOVc0ITWnLrwrM8n34Gyj6A77j8NBuSA3A5blgrhqCT87wOhghYdiLukXuWOGyO3rys"
            />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 flex flex-col gap-8">
        {/* Header Section */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <div className="inline-flex items-center gap-2 bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm px-2 py-1 neo-brutalist-border w-max uppercase">
              <span className="material-symbols-outlined text-[16px]">analytics</span>
              ID: {survey.slug}
            </div>
            <Link
              to="/responses/$surveyId"
              params={{ surveyId }}
              className="brutal-border px-3 py-1 font-label-sm text-label-sm hover:bg-secondary-container bg-surface flex items-center gap-2 uppercase"
            >
              <span className="material-symbols-outlined text-[18px]">visibility</span>
              View Submissions Log
            </Link>
          </div>
          <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg uppercase text-on-background truncate max-w-xs sm:max-w-2xl">
            {survey.title}
          </h1>
        </div>

        {/* Summary Stats Row */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Stat Card 1 */}
          <div className="bg-surface neo-brutalist-border neo-brutalist-shadow flex flex-col">
            <div className="bg-on-background text-background font-label-sm text-label-sm px-4 py-2 uppercase border-b-3 border-on-background flex justify-between items-center">
              Total Responses
              <span className="material-symbols-outlined text-[16px]">group</span>
            </div>
            <div className="p-6">
              <div className="font-headline-md text-headline-md text-primary font-bold">
                {data.total}
              </div>
              <div className="font-label-sm text-label-sm text-on-surface-variant mt-2">
                All-time submissions
              </div>
            </div>
          </div>
          {/* Stat Card 2 */}
          <div className="bg-surface neo-brutalist-border neo-brutalist-shadow flex flex-col">
            <div className="bg-on-background text-background font-label-sm text-label-sm px-4 py-2 uppercase border-b-3 border-on-background flex justify-between items-center">
              Completion Rate
              <span className="material-symbols-outlined text-[16px]">done_all</span>
            </div>
            <div className="p-6">
              <div className="font-headline-md text-headline-md text-secondary-container font-bold">
                {data.total > 0 ? '100%' : '0%'}
              </div>
              <div className="w-full bg-surface-variant h-2 mt-4 neo-brutalist-border">
                <div
                  className="bg-secondary-container h-full"
                  style={{ width: data.total > 0 ? '100%' : '0%' }}
                ></div>
              </div>
            </div>
          </div>
          {/* Stat Card 3 */}
          <div className="bg-surface neo-brutalist-border neo-brutalist-shadow flex flex-col">
            <div className="bg-on-background text-background font-label-sm text-label-sm px-4 py-2 uppercase border-b-3 border-on-background flex justify-between items-center">
              Avg. Time (Est.)
              <span className="material-symbols-outlined text-[16px]">timer</span>
            </div>
            <div className="p-6">
              <div className="font-headline-md text-headline-md text-on-background font-bold">
                {estTime}
              </div>
              <div className="font-label-sm text-label-sm text-on-surface-variant mt-2">
                {estTimeSub}
              </div>
            </div>
          </div>
          {/* Stat Card 4 */}
          <div className="bg-surface neo-brutalist-border neo-brutalist-shadow flex flex-col">
            <div className="bg-on-background text-background font-label-sm text-label-sm px-4 py-2 uppercase border-b-3 border-on-background flex justify-between items-center">
              Bounce Rate
              <span className="material-symbols-outlined text-[16px]">exit_to_app</span>
            </div>
            <div className="p-6">
              <div className="font-headline-md text-headline-md text-error font-bold">
                {bounceRateText}
              </div>
              <div className="font-label-sm text-label-sm text-on-surface-variant mt-2">
                {engagementText}
              </div>
            </div>
          </div>
        </section>

        {/* Dynamic Chart Representation */}
        <section className="bg-surface neo-brutalist-border neo-brutalist-shadow flex flex-col">
          <div className="bg-on-background text-background font-label-sm text-label-sm px-4 py-2 uppercase border-b-3 border-on-background flex justify-between items-center">
            Cumulative Submission Trend
          </div>
          <div className="p-6 h-64 md:h-80 relative flex items-end">
            <div className="absolute inset-6 bottom-12 border-l-2 border-b-2 border-on-background/20 flex items-end justify-between px-2 pb-2">
              <div className="absolute -left-8 top-0 h-full flex flex-col justify-between text-[10px] font-label-sm text-on-surface-variant">
                <span>{data.total}</span>
                <span>{Math.round(data.total / 2)}</span>
                <span>0</span>
              </div>
              <div className="absolute -bottom-6 left-0 w-full flex justify-between text-[10px] font-label-sm text-on-surface-variant px-2">
                <span>Period Start</span>
                <span>Period Mid</span>
                <span>Period End</span>
              </div>
              {/* SVG Line representation based on dynamic count */}
              <svg
                className="absolute inset-0 w-full h-full pb-8 pl-4"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <polyline
                  fill="none"
                  points={generateChartPoints()}
                  stroke="#0052d0"
                  strokeLinejoin="miter"
                  strokeWidth="3"
                ></polyline>
              </svg>
            </div>
          </div>
        </section>

        {/* Question Analysis Section */}
        <section className="flex flex-col gap-6">
          <h2 className="font-headline-sm text-headline-sm uppercase text-on-background border-b-3 border-on-background pb-2">
            Question Breakdown
          </h2>

          {data.questions.length === 0 ? (
            <div className="text-center py-8 font-label-lg brutal-border bg-surface uppercase">
              No questions defined for analysis.
            </div>
          ) : (
            data.questions.map((q, idx) => (
              <div key={q.question_id} className="bg-surface neo-brutalist-border flex flex-col">
                <div className="bg-surface-variant font-label-lg text-label-lg px-4 py-3 border-b-2 border-dashed border-on-background flex gap-4 items-start">
                  <span className="bg-on-background text-background px-2 py-0.5 text-xs font-label-sm">
                    Q{idx + 1}
                  </span>
                  <div>{q.label}</div>
                  <span className="text-xs text-outline font-label-sm uppercase ml-auto">
                    {q.type.replace('_', ' ')}
                  </span>
                </div>

                <div className="p-6">
                  {q.type === 'multiple_choice' && q.tally ? (
                    <div className="flex flex-col gap-4">
                      {Object.entries(q.tally).map(([option, votes]) => {
                        const pct = q.count > 0 ? Math.round((votes / q.count) * 100) : 0
                        return (
                          <div key={option} className="flex flex-col gap-1">
                            <div className="flex justify-between font-label-sm text-label-sm">
                              <span>{option}</span>
                              <span className="font-bold">
                                {pct}% ({votes} {votes === 1 ? 'vote' : 'votes'})
                              </span>
                            </div>
                            <div className="w-full bg-surface-variant h-4 neo-brutalist-border">
                              <div
                                className="bg-primary h-full border-r-2 border-on-background"
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : q.type === 'rating' ? (
                    <div className="flex flex-col md:flex-row items-center gap-8">
                      <div className="flex flex-col items-center justify-center p-8 border-4 border-on-background rounded-full w-44 h-44 bg-primary-container text-on-primary-container neo-brutalist-shadow shrink-0">
                        <div className="font-display-lg text-display-lg leading-none">
                          {q.average ? Number(q.average).toFixed(1) : '0.0'}
                        </div>
                        <div className="font-label-sm text-label-sm uppercase mt-2">Average</div>
                      </div>
                      <div className="flex-grow w-full flex flex-col gap-3 font-label-sm text-label-sm">
                        <span className="text-outline uppercase text-xs">
                          Rating Distribution Details:
                        </span>
                        <div className="bg-surface-container-low p-4 brutal-border">
                          <span>
                            Total ratings collected: <span className="font-bold">{q.count}</span>
                          </span>
                          <div className="mt-2 text-outline text-[11px] uppercase">
                            Scale: 1 (Poor) to 5 (Excellent). Average dynamically computed from
                            submissions.
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-surface-container-low p-4 brutal-border text-center font-label-sm">
                      <span className="text-outline uppercase">{q.count} answers collected</span>
                      <div className="mt-2 text-xs italic">
                        Responses can be reviewed individually in the submissions table logs.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-on-background w-full border-t-3 border-on-background mt-auto">
        <div className="flex flex-col md:flex-row justify-between items-center px-margin-desktop py-4 w-full max-w-container-max mx-auto gap-4">
          <div className="font-label-lg text-label-lg font-bold text-background uppercase">
            DECODEGO
          </div>
          <div className="text-background font-label-sm text-label-sm">
            © 2026 DECODEGO_LABS. ALL RIGHTS RESERVED.
          </div>
        </div>
      </footer>
    </div>
  )
}
