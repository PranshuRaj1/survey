import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiRequest } from '../lib/api'

interface Answer {
  question_id: string
  label: string
  type: string
  value: unknown
}

interface ResponseItem {
  id: string
  submitted_at: number
  answers: Answer[]
}

interface Question {
  id: string
  label: string
  type: string
  deleted_at?: number | null
  created_at?: number
}

interface SurveyData {
  id: string
  title: string
  questions: Question[]
}

interface ProcessedResponseItem extends ResponseItem {
  completionPercentage: number
  status: 'COMPLETED' | 'PARTIAL'
  totalQuestionsCount: number
}

export const Route = createFileRoute('/_protected/responses/$surveyId')({
  loader: async ({ params }) => {
    const [surveyRes, responseRes] = await Promise.all([
      apiRequest<{ survey: SurveyData }>(`/api/surveys/${params.surveyId}`),
      apiRequest<{ responses: ResponseItem[] }>(`/api/responses/${params.surveyId}`),
    ])
    return {
      survey: surveyRes.survey,
      responses: responseRes.responses || [],
    }
  },
  component: Responses,
})

function Responses() {
  const { surveyId } = Route.useParams()
  const { survey, responses } = Route.useLoaderData()
  const { user, logout } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'PARTIAL'>('ALL')
  const [activeResponse, setActiveResponse] = useState<ProcessedResponseItem | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const handleExportCsv = async () => {
    setIsExporting(true)
    try {
      const response = await fetch(`/api/responses/${surveyId}/export`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        let errorMsg = 'Failed to export responses'
        try {
          const errData = (await response.json()) as { error?: string }
          if (errData?.error) {
            errorMsg = errData.error
          }
        } catch {
          try {
            const errText = await response.text()
            if (errText) errorMsg = errText
          } catch {}
        }
        throw new Error(errorMsg)
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `survey_${surveyId}_responses.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Error exporting responses')
    } finally {
      setIsExporting(false)
    }
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
        Loading Respondent Logs...
      </div>
    )
  }

  // Process and filter responses
  const processedResponses: ProcessedResponseItem[] = responses.map((r) => {
    const submittedAt = Number(r.submitted_at)
    // A question was active at response submission time if it was created before submission
    // and not deleted yet (or deleted after submission)
    const activeQuestionsAtSubmission = survey.questions.filter((q) => {
      const createdAt =
        q.created_at !== undefined && q.created_at !== null ? Number(q.created_at) : 0
      const deletedAt =
        q.deleted_at !== undefined && q.deleted_at !== null && q.deleted_at !== 0
          ? Number(q.deleted_at)
          : null

      const isCreated = createdAt <= submittedAt
      const isNotDeleted = deletedAt === null || submittedAt < deletedAt
      return isCreated && isNotDeleted
    })

    const totalQuestions = activeQuestionsAtSubmission.length
    const activeQuestionIds = new Set(activeQuestionsAtSubmission.map((q) => q.id))
    const answeredCount = r.answers.filter((ans) => activeQuestionIds.has(ans.question_id)).length

    const completionPercentage =
      totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0
    const status = completionPercentage === 100 ? 'COMPLETED' : 'PARTIAL'

    return {
      ...r,
      completionPercentage,
      status,
      totalQuestionsCount: totalQuestions,
    }
  })

  const filteredResponses = processedResponses.filter((r) => {
    const matchesSearch = r.id.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const formatDate = (unix: number) => {
    return new Date(unix * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen flex flex-col font-body-md bg-grid relative text-on-background">
      {/* TopNavBar */}
      <nav className="bg-background w-full brutal-border-bottom border-on-background flex justify-between items-center px-margin-desktop h-16 max-w-container-max mx-auto z-40 sticky top-0 bg-opacity-90 backdrop-blur-sm">
        <div className="flex items-center gap-8">
          <Link
            to="/dashboard"
            className="font-headline-md text-headline-md uppercase tracking-tighter text-on-background flex items-center gap-2"
          >
            <span className="material-symbols-outlined font-bold">terminal</span>
            DECODEGO
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
            <span className="text-primary underline underline-offset-4 decoration-3 font-label-lg text-label-lg px-2 py-1">
              Responses
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => logout()}
            title="Logout"
            type="button"
            className="p-2 text-on-surface hover:bg-secondary-container transition-colors brutal-border border-transparent hover:border-on-background flex items-center justify-center"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
          <button
            className="w-10 h-10 brutal-border overflow-hidden bg-surface-container-high cursor-pointer p-0"
            onClick={() => logout()}
            title="Logout"
            type="button"
          >
            <img
              alt="User profile"
              className="w-full h-full object-cover grayscale cursor-pointer"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuAcsXqYKmI7YaFI8DstQ3tZ25yD9R2zzfAvBMJJ3E-7_4aSLITbpDv-sgEHy54wqpxJZqxNb7hF7gUsuvFVZAG-dgF0h7nBD_zKjjv7PMPhWZiZp599fPnqWrPfrXMnCdAD_ucpG3AUzn_qh7og2ma5wJcu8LcdjKybXAl9MBhyYbAJvvp29cAHScnr3Ax6I5qaGiTrgiREIOVc0ITWnLrwrM8n34Gyj6A77j8NBuSA3A5blgrhqCT87wOhghYdiLukXuWOGyO3rys"
            />
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 flex flex-col gap-8">
        <header className="flex items-center justify-between brutal-border bg-surface p-6 brutal-shadow">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              aria-label="Back to Dashboard"
              className="w-10 h-10 brutal-border flex items-center justify-center hover:bg-secondary-container brutal-button-hover bg-background"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </Link>
            <div>
              <h1 className="font-headline-lg text-headline-lg uppercase text-on-background leading-none truncate max-w-xs sm:max-w-md">
                {survey.title}
              </h1>
              <p className="font-label-sm text-label-sm text-on-surface-variant uppercase mt-1 tracking-widest">
                Analytics / Respondent Logs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleExportCsv}
              disabled={isExporting}
              type="button"
              className="bg-primary text-on-primary hover:bg-primary/90 brutal-border px-4 py-2 font-bold flex items-center gap-2 brutal-button-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[20px]">
                {isExporting ? 'sync' : 'download'}
              </span>
              <span className="font-label-lg text-label-lg uppercase">
                {isExporting ? 'EXPORTING...' : 'EXPORT CSV'}
              </span>
            </button>
            <div className="bg-secondary-container px-4 py-2 brutal-border font-bold">
              <span className="font-label-lg text-label-lg text-on-secondary-container">
                TOTAL: {responses.length}
              </span>
            </div>
          </div>
        </header>

        {/* Search and Filters */}
        <section className="flex flex-col md:flex-row gap-4 bg-surface p-4 brutal-border">
          <div className="flex-grow flex items-center border-b-2 border-on-background bg-background px-3 py-2">
            <span className="material-symbols-outlined text-outline mr-2">search</span>
            <input
              className="bg-transparent border-none focus:ring-0 font-label-sm text-label-sm w-full text-on-background placeholder:text-outline p-0 uppercase focus:outline-none"
              placeholder="SEARCH RESPONDENT ID..."
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-4">
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'COMPLETED' | 'PARTIAL')}
                className="appearance-none bg-background brutal-border font-label-sm text-label-sm uppercase pl-4 pr-10 py-2 focus:ring-0 focus:border-on-background cursor-pointer rounded-none"
              >
                <option value="ALL">ALL STATUSES</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="PARTIAL">PARTIAL</option>
              </select>
              <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                expand_more
              </span>
            </div>
          </div>
        </section>

        {/* Data Table */}
        <section className="brutalist-border bg-surface overflow-x-auto">
          {filteredResponses.length === 0 ? (
            <div className="text-center font-label-lg py-12">
              No respondent submissions match current criteria.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-on-background text-background font-label-lg text-label-lg uppercase">
                  <th className="p-4 border-r border-background w-1/4">RESPONDENT_ID</th>
                  <th className="p-4 border-r border-background w-1/4">DATE_SUBMITTED</th>
                  <th className="p-4 border-r border-background w-1/4">COMPLETION</th>
                  <th className="p-4 border-r border-background w-1/8 text-center">STATUS</th>
                  <th className="p-4 w-1/8 text-center">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="font-label-sm text-label-sm text-on-surface">
                {filteredResponses.map((res) => (
                  <tr
                    key={res.id}
                    className="border-b border-on-background hover:bg-secondary-fixed transition-colors duration-100 group"
                  >
                    <td className="p-4 border-r border-on-background font-bold truncate max-w-[150px]">
                      #{res.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="p-4 border-r border-on-background">
                      {formatDate(res.submitted_at)}
                    </td>
                    <td className="p-4 border-r border-on-background">
                      <div className="flex items-center gap-2">
                        <div className="w-full bg-background brutal-border h-4">
                          <div
                            className="bg-primary h-full border-r-2 border-on-background transition-all"
                            style={{ width: `${res.completionPercentage}%` }}
                          ></div>
                        </div>
                        <span className="font-bold">{res.completionPercentage}%</span>
                      </div>
                    </td>
                    <td className="p-4 border-r border-on-background text-center">
                      <span
                        className={`inline-block px-2 py-1 uppercase text-[10px] font-bold tracking-wider rounded-none ${
                          res.status === 'COMPLETED' ? 'status-completed' : 'status-partial'
                        }`}
                      >
                        {res.status}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setActiveResponse(res)}
                          type="button"
                          className="w-8 h-8 brutal-border bg-background flex items-center justify-center hover:bg-primary hover:text-on-primary transition-colors"
                          title="View Details"
                        >
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-on-background text-background w-full border-t-3 border-on-background mt-auto">
        <div className="flex justify-between items-center px-margin-desktop py-4 w-full">
          <span className="font-label-lg text-label-lg font-bold">DECODEGO</span>
          <span className="font-label-sm text-label-sm text-surface-variant">
            © 2026 DECODEGO_LABS. ALL RIGHTS RESERVED.
          </span>
        </div>
      </footer>

      {/* Details Modal */}
      {activeResponse && (
        <div className="fixed inset-0 bg-inverse-surface/80 z-50 backdrop-blur-sm flex items-center justify-center p-margin-mobile md:p-margin-desktop">
          <main className="bg-surface brutal-border brutal-shadow w-full max-w-[700px] flex flex-col relative max-h-[85vh]">
            <header className="bg-on-background text-background flex justify-between items-center px-6 py-4 border-b-3 border-on-background">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-2xl">visibility</span>
                <h1 className="font-label-lg text-label-lg uppercase tracking-wider">
                  RESPONSE_DETAILS {'//'} #{activeResponse.id.slice(0, 12).toUpperCase()}
                </h1>
              </div>
              <button
                aria-label="Close details"
                type="button"
                className="text-background hover:text-secondary-fixed transition-colors"
                onClick={() => setActiveResponse(null)}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </header>
            <div className="p-8 overflow-y-auto space-y-6 flex-1">
              <div className="grid grid-cols-2 gap-4 p-4 brutal-border bg-surface-container-low mb-2 font-label-sm">
                <div>
                  <span className="text-outline uppercase block">SUBMISSION DATE</span>
                  <span className="font-bold">{formatDate(activeResponse.submitted_at)}</span>
                </div>
                <div>
                  <span className="text-outline uppercase block">COMPLETION</span>
                  <span className="font-bold">
                    {activeResponse.completionPercentage}% (
                    {
                      activeResponse.answers.filter((ans) => {
                        const q = survey.questions.find((q) => q.id === ans.question_id)
                        if (!q) return false
                        const createdAt =
                          q.created_at !== undefined && q.created_at !== null
                            ? Number(q.created_at)
                            : 0
                        const deletedAt =
                          q.deleted_at !== undefined && q.deleted_at !== null && q.deleted_at !== 0
                            ? Number(q.deleted_at)
                            : null
                        const submittedAt = Number(activeResponse.submitted_at)
                        return (
                          createdAt <= submittedAt &&
                          (deletedAt === null || submittedAt < deletedAt)
                        )
                      }).length
                    }
                    /{activeResponse.totalQuestionsCount} ANSWERS)
                  </span>
                </div>
              </div>

              {survey.questions
                .filter((q) => {
                  const createdAt =
                    q.created_at !== undefined && q.created_at !== null ? Number(q.created_at) : 0
                  const deletedAt =
                    q.deleted_at !== undefined && q.deleted_at !== null && q.deleted_at !== 0
                      ? Number(q.deleted_at)
                      : null
                  const submittedAt = Number(activeResponse.submitted_at)

                  const isCreated = createdAt <= submittedAt
                  const isNotDeleted = deletedAt === null || submittedAt < deletedAt
                  return isCreated && isNotDeleted
                })
                .map((q, qIdx) => {
                  const answer = activeResponse.answers.find((a) => a.question_id === q.id)
                  let valText = '[NO RESPONSE]'
                  if (
                    answer &&
                    answer.value !== undefined &&
                    answer.value !== null &&
                    answer.value !== ''
                  ) {
                    if (Array.isArray(answer.value)) {
                      valText = answer.value.join(', ')
                    } else {
                      valText = String(answer.value)
                    }
                  }

                  return (
                    <div
                      key={q.id}
                      className="p-4 border-2 border-on-background bg-surface-bright flex flex-col gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="bg-on-background text-background px-2 py-0.5 text-[10px] font-label-sm">
                          Q{qIdx + 1}
                        </span>
                        <span className="font-label-sm text-xs text-outline uppercase">
                          {q.type.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="font-bold font-body-md text-sm text-on-background flex items-center gap-2">
                        <span>{q.label}</span>
                        {q.deleted_at !== undefined &&
                          q.deleted_at !== null &&
                          q.deleted_at !== 0 && (
                            <span className="bg-error-container text-on-error-container text-[10px] px-2 py-0.5 font-bold uppercase brutal-border">
                              Archived
                            </span>
                          )}
                      </div>
                      <div
                        className={`p-3 border border-dashed border-on-background/30 font-label-lg text-sm bg-surface-container ${
                          valText === '[NO RESPONSE]' ? 'text-outline/60 italic' : 'text-primary'
                        }`}
                      >
                        {valText}
                      </div>
                    </div>
                  )
                })}
            </div>
            <footer className="bg-surface-container-low border-t-3 border-on-background p-6 flex justify-end shrink-0">
              <button
                onClick={() => setActiveResponse(null)}
                type="button"
                className="bg-on-background text-background font-label-lg text-label-lg uppercase px-8 py-3 neo-shadow-hover transition-all"
              >
                Close Details
              </button>
            </footer>
          </main>
        </div>
      )}
    </div>
  )
}
