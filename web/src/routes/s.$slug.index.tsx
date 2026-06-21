import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../lib/api'

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
    logic?: {
      action: 'show' | 'hide'
      strategy: 'all' | 'any'
      conditions: Array<{
        question_id: string
        operator:
          | 'equals'
          | 'not_equals'
          | 'contains'
          | 'greater_than'
          | 'less_than'
          | 'filled'
          | 'empty'
        value: any
      }>
    }
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

export const Route = createFileRoute('/s/$slug/')({
  loader: async ({ params }) => {
    const res = await apiRequest<{ survey: PublicSurveyDetail }>(
      `/api/public/survey/${params.slug}`,
    )
    if (!res.survey || res.survey.questions.length === 0) {
      throw new Error('This survey contains no questions or could not be loaded.')
    }
    return { survey: res.survey }
  },
  pendingComponent: () => (
    <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
      Establishing Secure Uplink...
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-6 bg-grid-pattern">
      <div className="bg-surface brutal-border brutal-shadow p-8 max-w-md w-full flex flex-col gap-4 text-center">
        <span className="material-symbols-outlined text-4xl text-error">warning</span>
        <h1 className="font-headline-sm text-headline-sm uppercase text-error">LINK_FAILED</h1>
        <p className="font-body-md text-on-surface-variant">
          {error?.message || 'This survey contains no questions or could not be loaded.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-primary text-on-primary font-label-lg uppercase py-3 brutal-border"
        >
          Retry Connection
        </button>
      </div>
    </div>
  ),
  component: PublicSurvey,
})

// Evaluation logic helper functions
function evaluateCondition(answerVal: any, operator: string, targetVal: any): boolean {
  if (operator === 'filled')
    return answerVal !== undefined && answerVal !== null && answerVal !== ''
  if (operator === 'empty') return answerVal === undefined || answerVal === null || answerVal === ''
  if (answerVal === undefined || answerVal === null) return false

  switch (operator) {
    case 'equals':
      return String(answerVal) === String(targetVal)
    case 'not_equals':
      return String(answerVal) !== String(targetVal)
    case 'contains':
      return String(answerVal).toLowerCase().includes(String(targetVal).toLowerCase())
    case 'greater_than':
      return Number(answerVal) > Number(targetVal)
    case 'less_than':
      return Number(answerVal) < Number(targetVal)
    default:
      return false
  }
}

function getVisibleQuestions(questions: Question[], answers: Record<string, any>): Set<string> {
  const visible = new Set<string>()

  for (const q of questions) {
    if (!q.config?.logic) {
      visible.add(q.id)
      continue
    }

    const { action, strategy, conditions } = q.config.logic
    if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
      visible.add(q.id)
      continue
    }

    let matches = strategy === 'all'

    for (const cond of conditions) {
      const triggerVal = visible.has(cond.question_id) ? answers[cond.question_id] : undefined
      const conditionMet = evaluateCondition(triggerVal, cond.operator, cond.value)

      if (strategy === 'all') {
        matches = matches && conditionMet
      } else {
        matches = matches || conditionMet
      }
    }

    const isVisible = action === 'show' ? matches : !matches
    if (isVisible) {
      visible.add(q.id)
    }
  }

  return visible
}

function PublicSurvey() {
  const { survey } = Route.useLoaderData()
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [debouncedAnswers, setDebouncedAnswers] = useState<Record<string, any>>({})
  const [currentQId, setCurrentQId] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  const debounceTimeoutsRef = useRef<Record<string, number>>({})
  const startTimeRef = useRef<number>(Date.now())

  // Set initial question ID once questions are loaded
  useEffect(() => {
    if (survey?.questions?.length > 0 && !currentQId) {
      setCurrentQId(survey.questions[0]?.id || null)
    }
  }, [survey, currentQId])

  // Log the visit exactly once on survey mount
  useEffect(() => {
    let cancelled = false

    const logVisit = async () => {
      if (cancelled) return
      try {
        await apiRequest(`/api/public/survey/${survey.slug}/visit`, { method: 'POST' })
      } catch {
        // visit tracking is best-effort, never block the survey from rendering
      }
    }

    logVisit()
    return () => {
      cancelled = true
    }
  }, [survey.slug])

  // Helper to update answers with debouncing for text changes (Fix 7)
  const updateAnswer = (qId: string, val: any, type: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: val }))
    setValidationError(null)

    if (debounceTimeoutsRef.current[qId]) {
      clearTimeout(debounceTimeoutsRef.current[qId])
    }

    if (type === 'short_text' || type === 'long_text') {
      debounceTimeoutsRef.current[qId] = window.setTimeout(() => {
        setDebouncedAnswers((prev) => ({ ...prev, [qId]: val }))
      }, 250) as unknown as number
    } else {
      setDebouncedAnswers((prev) => ({ ...prev, [qId]: val }))
    }
  }

  // Clear answer state for any question that becomes hidden (Fix 6)
  useEffect(() => {
    const visibleIds = getVisibleQuestions(survey.questions, debouncedAnswers)
    let stateChanged = false
    const nextAnswers = { ...answers }
    const nextDebounced = { ...debouncedAnswers }

    for (const q of survey.questions) {
      if (!visibleIds.has(q.id)) {
        if (nextAnswers[q.id] !== undefined) {
          delete nextAnswers[q.id]
          stateChanged = true
        }
        if (nextDebounced[q.id] !== undefined) {
          delete nextDebounced[q.id]
          stateChanged = true
        }
      }
    }

    if (stateChanged) {
      setAnswers(nextAnswers)
      setDebouncedAnswers(nextDebounced)
    }
  }, [debouncedAnswers, survey.questions])

  // Get active list of questions based on debounced answers
  const visibleQuestions = getVisibleQuestions(survey.questions, debouncedAnswers)
  const visibleList = survey.questions.filter((q) => visibleQuestions.has(q.id))

  // Find currently active question
  const activeQ = visibleList.find((q) => q.id === currentQId) || visibleList[0]
  const activeIdx = visibleList.findIndex((q) => q.id === activeQ?.id)

  // Calculate dynamic progress percent (Fix 4)
  const progressPercent =
    visibleList.length > 0 && activeIdx >= 0
      ? Math.round((activeIdx / visibleList.length) * 100)
      : 0

  const handleNext = () => {
    if (!activeQ) return
    // Validate if current question is required (immediately evaluate)
    if (activeQ.required) {
      const val = answers[activeQ.id]
      if (val === undefined || val === null || val === '') {
        setValidationError(`Question "${activeQ.label}" is required.`)
        return
      }
    }

    // Evaluate visible questions with latest answers for immediate navigation
    const visibleQuestionsImmediate = getVisibleQuestions(survey.questions, answers)
    const visibleListImmediate = survey.questions.filter((q) => visibleQuestionsImmediate.has(q.id))
    const currentImmediateIdx = visibleListImmediate.findIndex((q) => q.id === activeQ.id)

    setValidationError(null)
    const nextQ = visibleListImmediate[currentImmediateIdx + 1]
    if (nextQ) {
      setCurrentQId(nextQ.id)
    }
  }

  const handlePrev = () => {
    if (!activeQ) return
    const visibleQuestionsImmediate = getVisibleQuestions(survey.questions, answers)
    const visibleListImmediate = survey.questions.filter((q) => visibleQuestionsImmediate.has(q.id))
    const currentImmediateIdx = visibleListImmediate.findIndex((q) => q.id === activeQ.id)

    setValidationError(null)
    const prevQ = visibleListImmediate[currentImmediateIdx - 1]
    if (prevQ) {
      setCurrentQId(prevQ.id)
    }
  }

  const handleSubmit = async () => {
    const visibleQuestionsImmediate = getVisibleQuestions(survey.questions, answers)
    const visibleListImmediate = survey.questions.filter((q) => visibleQuestionsImmediate.has(q.id))

    // Validate all required questions that are currently visible
    for (const q of visibleListImmediate) {
      if (q.required) {
        const val = answers[q.id]
        if (val === undefined || val === null || val === '') {
          setValidationError(`Required field missing: "${q.label}"`)
          setCurrentQId(q.id)
          return
        }
      }
    }

    setValidationError(null)
    setSubmitting(true)
    try {
      const formattedAnswers = visibleListImmediate.map((q) => ({
        question_id: q.id,
        value: answers[q.id] !== undefined ? answers[q.id] : null,
      }))

      const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000))

      await apiRequest(`/api/public/survey/${survey.slug}/respond`, {
        method: 'POST',
        body: JSON.stringify({ answers: formattedAnswers, duration }),
      })

      navigate({ to: `/s/${survey.slug}/thank-you` })
    } catch (err: any) {
      setValidationError(err?.message || 'Submission failed. Please check rate-limits and inputs.')
    } finally {
      setSubmitting(false)
    }
  }

  // Keyboard navigation
  useEffect(() => {
    if (!survey || survey.questions.length === 0 || !activeQ) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const q = activeQ
      if (q.type === 'multiple_choice' && q.config.options) {
        const options = q.config.options
        const currentAnswer = answers[q.id]
        const currentOptIdx = options.indexOf(currentAnswer)

        if (e.key === 'ArrowDown') {
          e.preventDefault()
          const nextOptIdx = currentOptIdx < options.length - 1 ? currentOptIdx + 1 : 0
          updateAnswer(q.id, options[nextOptIdx], q.type)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          const prevOptIdx = currentOptIdx > 0 ? currentOptIdx - 1 : options.length - 1
          updateAnswer(q.id, options[prevOptIdx], q.type)
        }
      }

      if (e.key === 'Enter') {
        const activeEl = document.activeElement
        if (activeEl?.tagName === 'TEXTAREA') return

        e.preventDefault()
        const isLast = activeIdx === visibleList.length - 1
        if (!isLast) {
          handleNext()
        } else {
          handleSubmit()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [survey, activeQ, activeIdx, visibleList, answers])

  if (!activeQ) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
        Question Not Found
      </div>
    )
  }

  return (
    <div
      className="bg-background text-on-background min-h-screen flex flex-col font-body-md selection:bg-primary-container selection:text-on-primary-container relative"
      style={{
        fontFamily:
          survey.font_family === 'Anton'
            ? 'Anton'
            : survey.font_family === 'JetBrains Mono'
              ? 'JetBrains Mono'
              : 'Inter',
      }}
    >
      {/* Dynamic Grid Background */}
      <div className="absolute inset-0 pointer-events-none opacity-20 z-0 bg-grid-pattern"></div>

      {/* TopAppBar */}
      <header className="w-full top-0 bg-background border-b-4 border-on-background sticky z-50 shrink-0">
        <div className="flex justify-between items-center h-16 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
          <span className="font-headline-md text-headline-md uppercase tracking-tighter text-on-background">
            {survey.title}
          </span>
          <button
            aria-label="Help"
            className="text-on-surface-variant hover:bg-secondary-container transition-colors active:translate-y-[2px] p-2 border-[2px] border-on-background shadow-[2px_2px_0px_#1b1b1b] flex items-center justify-center bg-surface"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: "'FILL' 0" }}
            >
              help_outline
            </span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-center px-margin-mobile md:px-margin-desktop py-12 relative z-10">
        <div
          key={`${activeQ.id}-${validationError ? 'error' : 'ok'}`}
          className={`w-full max-w-2xl bg-surface-container-lowest flex flex-col transition-all duration-300 ${
            validationError
              ? 'border-[3px] border-error shadow-[4px_4px_0px_0px_var(--color-error)] animate-shake'
              : 'neo-border neo-shadow'
          }`}
        >
          {/* Card Header (Terminal Style) */}
          <div className="bg-on-background text-on-primary px-4 py-2 border-b-[3px] border-on-background flex justify-between items-center">
            <span className="font-label-sm text-label-sm uppercase tracking-wider">
              survey_module_v1.0
            </span>
            <span className="font-label-sm text-label-sm" style={{ color: survey.brand_color }}>
              Q {String(activeIdx + 1).padStart(2, '0')}/
              {String(visibleList.length).padStart(2, '0')}
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
              <div
                className="font-label-sm text-label-sm mb-2 flex items-center gap-2"
                style={{ color: survey.brand_color }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-none"
                  style={{ backgroundColor: survey.brand_color }}
                ></span>
                <span className="uppercase">Question {activeIdx + 1}</span>
                {activeQ.required && <span className="text-error font-bold">* Required</span>}
              </div>
              <h1 className="font-headline-sm text-headline-sm text-on-background uppercase">
                {activeQ.label}
              </h1>
            </div>

            {/* Inputs based on type */}
            <div className="min-h-[140px] flex flex-col justify-center">
              {activeQ.type === 'short_text' && (
                <input
                  className="w-full bg-surface border-[3px] border-on-background p-3 font-body-md text-sm focus:outline-none focus:bg-primary-fixed-dim/10 focus:border-primary placeholder:text-outline/40"
                  type="text"
                  placeholder="Type your response here..."
                  value={answers[activeQ.id] || ''}
                  onChange={(e) => {
                    updateAnswer(activeQ.id, e.target.value, activeQ.type)
                  }}
                />
              )}

              {activeQ.type === 'long_text' && (
                <textarea
                  className="w-full bg-surface border-[3px] border-on-background p-3 font-body-md text-sm focus:outline-none focus:bg-primary-fixed-dim/10 focus:border-primary placeholder:text-outline/40 h-32"
                  placeholder="Type detailed response here..."
                  value={answers[activeQ.id] || ''}
                  onChange={(e) => {
                    updateAnswer(activeQ.id, e.target.value, activeQ.type)
                  }}
                />
              )}

              {activeQ.type === 'date' && (
                <input
                  className="w-full bg-surface border-[3px] border-on-background p-3 font-label-lg text-label-lg focus:outline-none focus:bg-primary-fixed-dim/10"
                  type="date"
                  value={answers[activeQ.id] || ''}
                  onChange={(e) => {
                    updateAnswer(activeQ.id, e.target.value, activeQ.type)
                  }}
                />
              )}

              {activeQ.type === 'rating' && (
                <div className="flex justify-between items-center gap-2 py-3 bg-surface-container border border-dashed border-on-background/30 px-3">
                  {[1, 2, 3, 4, 5].map((val) => {
                    const isSelected = answers[activeQ.id] === val
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          updateAnswer(activeQ.id, val, activeQ.type)
                        }}
                        className={`w-12 h-12 brutal-border font-headline-sm flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-secondary-container translate-x-[2px] translate-y-[2px] shadow-none'
                            : 'bg-surface hover:-translate-y-[2px] shadow-[2px_2px_0px_#1b1b1b]'
                        }`}
                        style={
                          isSelected
                            ? { backgroundColor: survey.brand_color, color: '#ffffff' }
                            : {}
                        }
                      >
                        {val}
                      </button>
                    )
                  })}
                </div>
              )}

              {activeQ.type === 'multiple_choice' && (
                <div className="flex flex-col gap-3">
                  {(activeQ.config.options || []).map((opt, optIdx) => {
                    const isSelected = answers[activeQ.id] === opt
                    const alphabet = String.fromCharCode(65 + optIdx)
                    return (
                      <label
                        key={optIdx}
                        className="relative cursor-pointer group"
                        onClick={() => {
                          updateAnswer(activeQ.id, opt, activeQ.type)
                        }}
                      >
                        <div
                          className={`w-full p-4 border-2 border-on-background flex items-center justify-between transition-all duration-200 ${
                            isSelected
                              ? 'bg-secondary-container translate-x-[2px] translate-y-[2px] shadow-none'
                              : 'bg-surface shadow-[2px_2px_0px_#1b1b1b] hover:bg-surface-container-low group-hover:-translate-y-[1px]'
                          }`}
                          style={
                            isSelected
                              ? { backgroundColor: survey.brand_color, color: '#ffffff' }
                              : {}
                          }
                        >
                          <div className="flex items-center gap-4">
                            <span
                              className={`font-label-lg text-label-lg px-2 py-1 border border-on-background ${
                                isSelected
                                  ? 'bg-black text-white'
                                  : 'bg-surface-container text-on-surface-variant'
                              }`}
                            >
                              {alphabet}
                            </span>
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
                  className="h-full border-r-[2px] border-on-background transition-all duration-300 ease-out"
                  style={{ width: `${progressPercent}%`, backgroundColor: survey.brand_color }}
                ></div>
              </div>
            </div>
            {/* Navigation Buttons */}
            <div className="flex gap-4 w-full sm:w-auto">
              <button
                disabled={activeIdx === 0}
                onClick={handlePrev}
                className="px-6 py-3 bg-surface text-on-surface border-2 border-on-background shadow-[2px_2px_0px_#1b1b1b] font-label-lg text-label-lg uppercase tracking-wide transition-all flex items-center gap-2 disabled:opacity-40"
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                PREV
              </button>

              {activeIdx < visibleList.length - 1 ? (
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
          <span className="bg-surface-container-high px-2 py-1 neo-border-sm mr-2">ENTER</span> to
          proceed •{' '}
          <span className="bg-surface-container-high px-2 py-1 neo-border-sm mx-2">↑/↓</span> to
          select
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full bottom-0 bg-surface-container border-t-2 border-on-background mt-auto shrink-0 z-10">
        <div className="flex flex-col md:flex-row justify-between items-center py-4 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <span className="font-label-lg text-label-lg text-primary uppercase">DECODEGO</span>
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              © 2026 DECODEGO LABS. ALL RIGHTS RESERVED.
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}
