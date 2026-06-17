import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { apiRequest } from '../lib/api'

export const Route = createFileRoute('/s/$slug/')({
  component: PublicSurvey,
})

interface Question {
  id: string
  type: 'short_text' | 'long_text' | 'multiple_choice' | 'rating' | 'date'
  label: string
  sort_order: number
  required: boolean
  config: {
    options?: string[]
    min?: number
    max?: number
  }
}

interface PublicSurveyDetail {
  id: string
  slug: string
  title: string
  brand_color: string
  logo_url: string | null
  font_family: string
  questions: Question[]
}

function PublicSurvey() {
  const { slug } = Route.useParams()
  const [survey, setSurvey] = useState<PublicSurveyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  const fetchSurvey = async () => {
    try {
      const res = await apiRequest<{ survey: PublicSurveyDetail }>(`/api/public/survey/${slug}`)
      setSurvey(res.survey)
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load survey')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSurvey()
  }, [slug])

  // Keyboard navigation
  useEffect(() => {
    if (!survey || survey.questions.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const q = survey.questions[currentIdx]
      if (!q) return
      if (q.type === 'multiple_choice' && q.config.options) {
        const options = q.config.options
        const currentAnswer = answers[q.id]
        let currentOptIdx = options.indexOf(currentAnswer)

        if (e.key === 'ArrowDown') {
          e.preventDefault()
          const nextOptIdx = currentOptIdx < options.length - 1 ? currentOptIdx + 1 : 0
          setAnswers((prev) => ({ ...prev, [q.id]: options[nextOptIdx] }))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          const prevOptIdx = currentOptIdx > 0 ? currentOptIdx - 1 : options.length - 1
          setAnswers((prev) => ({ ...prev, [q.id]: options[prevOptIdx] }))
        }
      }

      if (e.key === 'Enter') {
        // Only trigger Enter if we aren't focused on a textarea
        const activeEl = document.activeElement
        if (activeEl?.tagName === 'TEXTAREA') return

        e.preventDefault()
        if (currentIdx < survey.questions.length - 1) {
          handleNext()
        } else {
          handleSubmit()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [survey, currentIdx, answers])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
        Establishing Secure Uplink...
      </div>
    )
  }

  if (loadError || !survey || survey.questions.length === 0) {
    return (
      <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-6 bg-grid-pattern">
        <div className="bg-surface brutal-border brutal-shadow p-8 max-w-md w-full flex flex-col gap-4 text-center">
          <span className="material-symbols-outlined text-4xl text-error">warning</span>
          <h1 className="font-headline-sm text-headline-sm uppercase text-error">LINK_FAILED</h1>
          <p className="font-body-md text-on-surface-variant">
            {loadError || 'This survey contains no questions or could not be loaded.'}
          </p>
          <button onClick={() => window.location.reload()} className="bg-primary text-on-primary font-label-lg uppercase py-3 brutal-border">
            Retry Connection
          </button>
        </div>
      </div>
    )
  }

  const currentQ = survey.questions[currentIdx]
  if (!currentQ) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
        Question Not Found
      </div>
    )
  }
  const progressPercent = Math.round((currentIdx / survey.questions.length) * 100)

  const handleNext = () => {
    // Validate if current question is required
    if (currentQ.required) {
      const val = answers[currentQ.id]
      if (val === undefined || val === null || val === '') {
        setValidationError(`Question "${currentQ.label}" is required.`)
        return
      }
    }
    setValidationError(null)
    setCurrentIdx(currentIdx + 1)
  }

  const handlePrev = () => {
    setValidationError(null)
    setCurrentIdx(currentIdx - 1)
  }

  const handleSubmit = async () => {
    // Validate all required questions
    for (const q of survey.questions) {
      if (q.required) {
        const val = answers[q.id]
        if (val === undefined || val === null || val === '') {
          setValidationError(`Required field missing: "${q.label}"`)
          // Navigate back to the unanswered question
          const qIdx = survey.questions.findIndex((item) => item.id === q.id)
          setCurrentIdx(qIdx)
          return
        }
      }
    }

    setValidationError(null)
    setSubmitting(true)
    try {
      const formattedAnswers = Object.entries(answers).map(([qId, val]) => ({
        question_id: qId,
        value: val,
      }))

      await apiRequest(`/api/public/survey/${slug}/respond`, {
        method: 'POST',
        body: JSON.stringify({ answers: formattedAnswers }),
      })

      navigate({ to: `/s/${slug}/thank-you` })
    } catch (err: any) {
      setValidationError(err?.message || 'Submission failed. Please check rate-limits and inputs.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div 
      className="bg-background text-on-background min-h-screen flex flex-col font-body-md selection:bg-primary-container selection:text-on-primary-container relative"
      style={{ fontFamily: survey.font_family === 'Anton' ? 'Anton' : survey.font_family === 'JetBrains Mono' ? 'JetBrains Mono' : 'Inter' }}
    >
      {/* Dynamic Grid Background */}
      <div className="absolute inset-0 pointer-events-none opacity-20 z-0 bg-grid-pattern"></div>

      {/* TopAppBar */}
      <header className="w-full top-0 bg-background border-b-4 border-on-background sticky z-50 shrink-0">
        <div className="flex justify-between items-center h-16 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
          <span className="font-headline-md text-headline-md uppercase tracking-tighter text-on-background">
            {survey.title}
          </span>
          <button aria-label="Help" className="text-on-surface-variant hover:bg-secondary-container transition-colors active:translate-y-[2px] p-2 border-[2px] border-on-background shadow-[2px_2px_0px_#1b1b1b] flex items-center justify-center bg-surface">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>help_outline</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-center px-margin-mobile md:px-margin-desktop py-12 relative z-10">
        <div 
          key={currentIdx + '-' + (validationError ? 'error' : 'ok')} 
          className={`w-full max-w-2xl bg-surface-container-lowest flex flex-col transition-all duration-300 ${
            validationError 
              ? 'border-[3px] border-error shadow-[4px_4px_0px_0px_var(--color-error)] animate-shake' 
              : 'neo-border neo-shadow'
          }`}
        >
          {/* Card Header (Terminal Style) */}
          <div className="bg-on-background text-on-primary px-4 py-2 border-b-[3px] border-on-background flex justify-between items-center">
            <span className="font-label-sm text-label-sm uppercase tracking-wider">survey_module_v1.0</span>
            <span className="font-label-sm text-label-sm" style={{ color: survey.brand_color }}>
              Q {String(currentIdx + 1).padStart(2, '0')}/{String(survey.questions.length).padStart(2, '0')}
            </span>
          </div>

          {/* Optional Logo */}
          {survey.logo_url && (
            <div className="border-b-[3px] border-on-background p-4 flex justify-center bg-surface shrink-0 h-16 items-center">
              <img src={survey.logo_url} alt="Logo" className="max-h-12 object-contain" />
            </div>
          )}

          {/* Card Body */}
          <div className="p-8 md:p-12 flex flex-col gap-8">
            {validationError && (
              <div className="bg-error-container text-on-error-container border-[3px] border-error p-4 font-label-sm text-label-sm uppercase flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">warning</span>
                <span>{validationError}</span>
              </div>
            )}

            {/* Question label */}
            <div>
              <div className="font-label-sm text-label-sm mb-2 flex items-center gap-2" style={{ color: survey.brand_color }}>
                <span className="inline-block w-2 h-2 rounded-none" style={{ backgroundColor: survey.brand_color }}></span>
                <span className="uppercase">Question {currentIdx + 1}</span>
                {currentQ.required && <span className="text-error font-bold">* Required</span>}
              </div>
              <h1 className="font-headline-sm text-headline-sm text-on-background uppercase">
                {currentQ.label}
              </h1>
            </div>

            {/* Inputs based on type */}
            <div className="min-h-[140px] flex flex-col justify-center">
              {currentQ.type === 'short_text' && (
                <input
                  className="w-full bg-surface border-[3px] border-on-background p-3 font-body-md text-sm focus:outline-none focus:bg-primary-fixed-dim/10 focus:border-primary placeholder:text-outline/40"
                  type="text"
                  placeholder="Type your response here..."
                  value={answers[currentQ.id] || ''}
                  onChange={(e) => {
                    setAnswers({ ...answers, [currentQ.id]: e.target.value })
                    setValidationError(null)
                  }}
                />
              )}

              {currentQ.type === 'long_text' && (
                <textarea
                  className="w-full bg-surface border-[3px] border-on-background p-3 font-body-md text-sm focus:outline-none focus:bg-primary-fixed-dim/10 focus:border-primary placeholder:text-outline/40 h-32"
                  placeholder="Type detailed response here..."
                  value={answers[currentQ.id] || ''}
                  onChange={(e) => {
                    setAnswers({ ...answers, [currentQ.id]: e.target.value })
                    setValidationError(null)
                  }}
                />
              )}

              {currentQ.type === 'date' && (
                <input
                  className="w-full bg-surface border-[3px] border-on-background p-3 font-label-lg text-label-lg focus:outline-none focus:bg-primary-fixed-dim/10"
                  type="date"
                  value={answers[currentQ.id] || ''}
                  onChange={(e) => {
                    setAnswers({ ...answers, [currentQ.id]: e.target.value })
                    setValidationError(null)
                  }}
                />
              )}

              {currentQ.type === 'rating' && (
                <div className="flex justify-between items-center gap-2 py-3 bg-surface-container border border-dashed border-on-background/30 px-3">
                  {[1, 2, 3, 4, 5].map((val) => {
                    const isSelected = answers[currentQ.id] === val
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setAnswers({ ...answers, [currentQ.id]: val })
                          setValidationError(null)
                        }}
                        className={`w-12 h-12 brutal-border font-headline-sm flex items-center justify-center transition-all ${
                          isSelected ? 'bg-secondary-container translate-x-[2px] translate-y-[2px] shadow-none' : 'bg-surface hover:-translate-y-[2px] shadow-[2px_2px_0px_#1b1b1b]'
                        }`}
                        style={isSelected ? { backgroundColor: survey.brand_color, color: '#ffffff' } : {}}
                      >
                        {val}
                      </button>
                    )
                  })}
                </div>
              )}

              {currentQ.type === 'multiple_choice' && (
                <div className="flex flex-col gap-3">
                  {(currentQ.config.options || []).map((opt, optIdx) => {
                    const isSelected = answers[currentQ.id] === opt
                    const alphabet = String.fromCharCode(65 + optIdx)
                    return (
                      <label key={optIdx} className="relative cursor-pointer group" onClick={() => {
                        setAnswers({ ...answers, [currentQ.id]: opt })
                        setValidationError(null)
                      }}>
                        <div className={`w-full p-4 border-2 border-on-background flex items-center justify-between transition-all duration-200 ${
                          isSelected ? 'bg-secondary-container translate-x-[2px] translate-y-[2px] shadow-none' : 'bg-surface shadow-[2px_2px_0px_#1b1b1b] hover:bg-surface-container-low group-hover:-translate-y-[1px]'
                        }`} style={isSelected ? { backgroundColor: survey.brand_color, color: '#ffffff' } : {}}>
                          <div className="flex items-center gap-4">
                            <span className={`font-label-lg text-label-lg px-2 py-1 border border-on-background ${
                              isSelected ? 'bg-black text-white' : 'bg-surface-container text-on-surface-variant'
                            }`}>{alphabet}</span>
                            <span className="font-body-lg text-body-lg font-medium">{opt}</span>
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Card Footer Navigation */}
          <div className="border-t-[3px] border-on-background bg-surface px-8 py-6 flex flex-col sm:flex-row justify-between items-center gap-6">
            {/* Progress */}
            <div className="flex flex-col w-full sm:w-1/3 gap-2">
              <div className="flex justify-between font-label-sm text-label-sm text-on-surface-variant">
                <span>PROGRESS</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 w-full bg-surface-container-high neo-border-sm rounded-none overflow-hidden flex">
                <div 
                  className="h-full border-r-[2px] border-on-background transition-all" 
                  style={{ width: `${progressPercent}%`, backgroundColor: survey.brand_color }}
                ></div>
              </div>
            </div>
            {/* Navigation Buttons */}
            <div className="flex gap-4 w-full sm:w-auto">
              <button
                disabled={currentIdx === 0}
                onClick={handlePrev}
                className="px-6 py-3 bg-surface text-on-surface border-2 border-on-background shadow-[2px_2px_0px_#1b1b1b] font-label-lg text-label-lg uppercase tracking-wide transition-all flex items-center gap-2 disabled:opacity-40"
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                PREV
              </button>
              
              {currentIdx < survey.questions.length - 1 ? (
                <button
                  onClick={handleNext}
                  className="px-8 py-3 bg-primary text-on-primary border-2 border-on-background shadow-[4px_4px_0px_#1b1b1b] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[3px_3px_0px_#1b1b1b] font-label-lg text-label-lg uppercase tracking-wide transition-all flex items-center gap-2"
                  type="button"
                  style={{ backgroundColor: survey.brand_color }}
                >
                  NEXT
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="px-8 py-3 bg-secondary text-on-secondary border-2 border-on-background shadow-[4px_4px_0px_#1b1b1b] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[3px_3px_0px_#1b1b1b] font-label-lg text-label-lg uppercase tracking-wide transition-all flex items-center gap-2"
                  type="button"
                  style={{ backgroundColor: '#00ff00', color: '#000000' }}
                >
                  {submitting ? 'SENDING...' : 'SUBMIT'}
                  <span className="material-symbols-outlined text-[18px]">done</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Hotkeys reminder */}
        <div className="mt-8 font-label-sm text-label-sm text-on-surface-variant text-center hidden md:block">
          <span className="bg-surface-container-high px-2 py-1 neo-border-sm mr-2">ENTER</span> to proceed • <span className="bg-surface-container-high px-2 py-1 neo-border-sm mx-2">↑/↓</span> to select
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full bottom-0 bg-surface-container border-t-2 border-on-background mt-auto shrink-0 z-10">
        <div className="flex flex-col md:flex-row justify-between items-center py-4 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <span className="font-label-lg text-label-lg text-primary uppercase">DECODEGO</span>
            <span className="font-label-sm text-label-sm text-on-surface-variant">© 2024 DECODEGO LABS. ALL RIGHTS RESERVED.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
