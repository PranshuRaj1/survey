import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiRequest } from '../lib/api'

interface Question {
  id?: string
  type: 'short_text' | 'long_text' | 'multiple_choice' | 'rating' | 'date'
  label: string
  sort_order: number
  required: boolean
  config: {
    options?: string[]
    min?: number
    max?: number
  }
  deleted_at?: number | null
  response_count?: number
  created_at?: number
}

interface SurveyDetail {
  id: string
  slug: string
  title: string
  status: 'draft' | 'published' | 'closed'
  brand_color: string
  logo_url: string | null
  font_family: string
  created_at: number
  updated_at: number
  questions: Question[]
}

interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'publish'
  link?: string
  duration?: number
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const duration = toast.duration ?? (toast.type === 'publish' ? 10000 : 4000)
    const timer = setTimeout(() => {
      onClose()
    }, duration)
    return () => clearTimeout(timer)
  }, [toast.duration, toast.type, onClose])

  const handleCopy = async () => {
    if (toast.link) {
      try {
        await navigator.clipboard.writeText(toast.link)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (err) {
        console.error('Failed to copy text: ', err)
      }
    }
  }

  let bgColorClass = 'bg-surface text-on-surface'
  if (toast.type === 'error') {
    bgColorClass = 'bg-error-container text-on-error-container'
  } else if (toast.type === 'publish') {
    bgColorClass = 'bg-secondary-fixed text-on-secondary-fixed'
  } else if (toast.type === 'success') {
    bgColorClass = 'bg-primary-fixed text-on-primary-fixed'
  }

  return (
    <div
      className={`pointer-events-auto brutal-border p-4 brutal-shadow flex flex-col gap-3 transition-all duration-200 animate-shake ${bgColorClass}`}
      style={{ minWidth: '300px' }}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-grow font-label-lg text-xs uppercase font-bold tracking-tight leading-normal">
          {toast.message}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 border-2 border-on-background bg-background text-on-background hover:bg-surface-container flex items-center justify-center font-bold text-xs cursor-pointer active:translate-y-0.5 transition-transform"
        >
          ✕
        </button>
      </div>

      {toast.link && (
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={toast.link}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="flex-grow bg-background text-on-background border-2 border-on-background p-1.5 text-xs font-label-sm focus:outline-none select-all"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="bg-primary text-on-primary border-2 border-on-background px-3 py-1.5 font-label-sm text-xs uppercase hover:bg-primary-container active:translate-y-0.5 shrink-0 cursor-pointer transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_protected/builder/$surveyId')({
  loader: async ({ params }) => {
    const res = await apiRequest<{ survey: SurveyDetail }>(`/api/surveys/${params.surveyId}`)
    return { survey: res.survey }
  },
  component: Builder,
})

function Builder() {
  const { surveyId } = Route.useParams()
  const { survey: initialSurvey } = Route.useLoaderData()
  const { user, logout } = useAuth()
  const [survey, setSurvey] = useState<SurveyDetail>(initialSurvey)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'questions' | 'design' | 'share'>('questions')
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [previewQIndex, setPreviewQIndex] = useState(0)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const navigate = useNavigate()

  useEffect(() => {
    setSurvey(initialSurvey)
  }, [initialSurvey])

  const [toasts, setToasts] = useState<Toast[]>([])
  const addToast = (
    message: string,
    type: 'success' | 'error' | 'publish',
    link?: string,
    duration?: number,
  ) => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, message, type, link, duration }])
  }
  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
        Loading Builder Environment...
      </div>
    )
  }

  const activeQuestions = survey.questions.filter((q) => !q.deleted_at)
  const deletedQuestions = survey.questions.filter((q) => q.deleted_at)

  const saveChanges = async (updatedSurvey: SurveyDetail) => {
    if (updatedSurvey.status === 'published') {
      const activeQs = updatedSurvey.questions.filter((q) => !q.deleted_at)
      const hasEmptyMC = activeQs.some(
        (q) =>
          q.type === 'multiple_choice' && (!q.config?.options || q.config.options.length === 0),
      )
      if (hasEmptyMC) {
        addToast('Multiple choice questions need at least one option', 'error')
        return
      }
    }
    setSaving(true)
    try {
      const res = await apiRequest<{ survey: SurveyDetail; status_reverted?: boolean }>(
        `/api/surveys/${surveyId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: updatedSurvey.title,
            brand_color: updatedSurvey.brand_color,
            logo_url: updatedSurvey.logo_url,
            font_family: updatedSurvey.font_family,
            status: updatedSurvey.status,
            questions: updatedSurvey.questions,
          }),
        },
      )
      setSurvey(res.survey)
      if (res.status_reverted) {
        addToast(
          'Configuration saved! Survey reverted to draft because it has no questions.',
          'success',
        )
      } else {
        addToast(
          'Configuration saved successfully!',
          'success',
          `${window.location.origin}/s/${res.survey.slug}`,
        )
      }
    } catch (err: any) {
      addToast(err?.message || 'Failed to save changes', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateTitle = (title: string) => {
    const updated = { ...survey, title }
    setSurvey(updated)
  }

  const handleAddQuestion = () => {
    const newQ: Question = {
      id: 'temp_' + Math.random().toString(36).substring(2, 9),
      type: 'short_text',
      label: 'New Question',
      sort_order: activeQuestions.length,
      required: false,
      config: {},
      created_at: Math.floor(Date.now() / 1000),
    }
    const updated = { ...survey, questions: [...survey.questions, newQ] }
    setSurvey(updated)
  }

  const handleUpdateQuestion = (id: string, fields: Partial<Question>) => {
    const questions = survey.questions.map((q) => {
      if (q.id === id) {
        return { ...q, ...fields }
      }
      return q
    })
    setSurvey({ ...survey, questions })
  }

  const handleDeleteQuestion = (id: string) => {
    const q = survey.questions.find((item) => item.id === id)
    if (!q) return

    if (q.response_count && q.response_count > 0) {
      const confirmDelete = window.confirm(
        `This question has ${q.response_count} responses. Deleting it will hide it from new respondents, but existing answers stay in your data and CSV export.\n\nAre you sure you want to delete it?`,
      )
      if (!confirmDelete) return
    }

    let updated: Question[]
    if (q.id && !q.id.startsWith('temp_')) {
      updated = survey.questions.map((item) => {
        if (item.id === id) {
          return { ...item, deleted_at: Math.floor(Date.now() / 1000) }
        }
        return item
      })
    } else {
      updated = survey.questions.filter((item) => item.id !== id)
    }

    let activeIdx = 0
    const reordered = updated.map((item) => {
      if (!item.deleted_at) {
        return { ...item, sort_order: activeIdx++ }
      }
      return item
    })

    setSurvey({ ...survey, questions: reordered })

    const activeLength = reordered.filter((item) => !item.deleted_at).length
    if (previewQIndex >= activeLength && activeLength > 0) {
      setPreviewQIndex(activeLength - 1)
    }
  }

  const handleMoveQuestion = (activeIdx: number, direction: 'up' | 'down') => {
    const activeQs = survey.questions.filter((q) => !q.deleted_at)
    if (direction === 'up' && activeIdx === 0) return
    if (direction === 'down' && activeIdx === activeQs.length - 1) return

    const targetIdx = direction === 'up' ? activeIdx - 1 : activeIdx + 1
    const temp = activeQs[activeIdx]
    const target = activeQs[targetIdx]
    if (temp === undefined || target === undefined) return
    activeQs[activeIdx] = target
    activeQs[targetIdx] = temp

    const reorderedActive = activeQs.map((q, idx) => ({ ...q, sort_order: idx }))
    const archivedQs = survey.questions.filter((q) => q.deleted_at)
    setSurvey({ ...survey, questions: [...reorderedActive, ...archivedQs] })
  }

  const handleRestoreQuestion = (id: string) => {
    const activeQs = survey.questions.filter((q) => !q.deleted_at)
    const updated = survey.questions.map((q) => {
      if (q.id === id) {
        return {
          ...q,
          deleted_at: null,
          sort_order: activeQs.length,
        }
      }
      return q
    })
    setSurvey({ ...survey, questions: updated })
  }

  const handleAddChoiceOption = (qId: string, text: string) => {
    if (!text.trim()) return
    const q = survey.questions.find((item) => item.id === qId)
    if (!q) return
    const currentOptions = q.config.options || []
    const updatedOptions = [...currentOptions, text.trim()]
    handleUpdateQuestion(qId, { config: { ...q.config, options: updatedOptions } })
  }

  const handleRemoveChoiceOption = (qId: string, optIndex: number) => {
    const q = survey.questions.find((item) => item.id === qId)
    if (!q) return
    const currentOptions = q.config.options || []
    const updatedOptions = currentOptions.filter((_, i) => i !== optIndex)
    handleUpdateQuestion(qId, { config: { ...q.config, options: updatedOptions } })
  }

  const handlePublish = async () => {
    const activeQs = survey.questions.filter((q) => !q.deleted_at)
    if (activeQs.length === 0) {
      addToast('Cannot publish a survey with no questions', 'error')
      return
    }
    const hasEmptyMC = activeQs.some(
      (q) => q.type === 'multiple_choice' && (!q.config?.options || q.config.options.length === 0),
    )
    if (hasEmptyMC) {
      addToast('Multiple choice questions need at least one option', 'error')
      return
    }
    try {
      await apiRequest(`/api/surveys/${surveyId}/publish`, { method: 'POST' })
      setSurvey({ ...survey, status: 'published' })
      addToast(
        'Survey published successfully!',
        'publish',
        `${window.location.origin}/s/${survey.slug}`,
        10000,
      )
    } catch (err: any) {
      addToast(err?.message || 'Failed to publish survey', 'error')
    }
  }

  const handleCopyLink = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopyStatus('copied')
    setTimeout(() => setCopyStatus('idle'), 2000)
  }

  const selectedPreviewQ =
    survey.questions[previewQIndex] ||
    ({
      id: '',
      type: 'short_text',
      label: '',
      sort_order: 0,
      required: false,
      config: {},
    } as Question)

  return (
    <div className="h-screen flex flex-col font-body-md bg-background text-on-background overflow-hidden">
      {/* TopNavBar */}
      <header className="w-full border-b-3 border-on-background bg-background text-primary font-label-lg text-label-lg z-20 shrink-0">
        <div className="flex justify-between items-center px-margin-desktop h-16 w-full max-w-container-max mx-auto">
          {/* Brand */}
          <Link
            to="/dashboard"
            className="font-headline-md text-headline-md uppercase tracking-tighter text-on-background hover:text-primary transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined font-bold">terminal</span>
            DECODEGO
          </Link>
          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-8">
            <Link
              to="/dashboard"
              className="text-on-surface hover:bg-secondary-container hover:text-on-secondary-container px-3 py-1 border-2 border-transparent transition-colors"
            >
              Dashboard
            </Link>
            <span className="text-primary underline underline-offset-4 decoration-3 px-3 py-1">
              Builder
            </span>
            <Link
              to="/responses/$surveyId"
              params={{ surveyId }}
              className="text-on-surface hover:bg-secondary-container hover:text-on-secondary-container px-3 py-1 border-2 border-transparent transition-colors"
            >
              Responses
            </Link>
          </nav>
          {/* Actions */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => saveChanges(survey)}
              disabled={saving}
              className="bg-surface text-on-surface border-2 border-on-background px-4 py-2 font-label-lg uppercase neo-brutalist-shadow neo-brutalist-shadow-hover transition-all"
            >
              {saving ? 'Saving...' : 'Save Config'}
            </button>
            <div
              className="w-10 h-10 border-2 border-on-background overflow-hidden bg-surface-container-high"
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
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* SideNavBar */}
        <aside className="h-full w-64 border-r-3 border-on-background bg-surface text-primary font-label-sm text-label-sm uppercase flex flex-col py-unit gap-2 z-10 shrink-0">
          <div className="px-4 py-4 border-b-2 border-on-background mb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 border-2 border-on-background bg-secondary flex items-center justify-center">
                <span className="material-symbols-outlined text-on-secondary text-sm">
                  rocket_launch
                </span>
              </div>
              <div className="overflow-hidden">
                <div className="font-headline-sm text-headline-sm text-on-surface leading-none uppercase truncate">
                  {survey.title}
                </div>
                <div className="text-on-surface-variant text-[10px] tracking-widest mt-1 capitalize">
                  {survey.status} Mode
                </div>
              </div>
            </div>
          </div>
          {/* Navigation tabs */}
          <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
            <button
              onClick={() => setActiveTab('questions')}
              className={`w-full flex items-center gap-3 px-3 py-2 border-2 border-on-background text-left transition-transform ${
                activeTab === 'questions'
                  ? 'bg-primary text-on-primary -translate-x-[2px] -translate-y-[2px] neo-shadow-sm'
                  : 'text-on-surface-variant hover:bg-secondary-fixed hover:text-on-secondary-fixed'
              }`}
            >
              <span className="material-symbols-outlined">edit_note</span>
              Questions
            </button>
            <button
              onClick={() => setActiveTab('design')}
              className={`w-full flex items-center gap-3 px-3 py-2 border-2 border-on-background text-left transition-transform ${
                activeTab === 'design'
                  ? 'bg-primary text-on-primary -translate-x-[2px] -translate-y-[2px] neo-shadow-sm'
                  : 'text-on-surface-variant hover:bg-secondary-fixed hover:text-on-secondary-fixed'
              }`}
            >
              <span className="material-symbols-outlined">palette</span>
              Design
            </button>
            <button
              onClick={() => setActiveTab('share')}
              disabled={survey.status !== 'published'}
              className={`w-full flex items-center gap-3 px-3 py-2 border-2 border-on-background text-left transition-transform ${
                survey.status !== 'published'
                  ? 'opacity-40 cursor-not-allowed'
                  : activeTab === 'share'
                    ? 'bg-primary text-on-primary -translate-x-[2px] -translate-y-[2px] neo-shadow-sm'
                    : 'text-on-surface-variant hover:bg-secondary-fixed hover:text-on-secondary-fixed'
              }`}
            >
              <span className="material-symbols-outlined">ios_share</span>
              Share Module
            </button>
            <Link
              to="/analytics/$surveyId"
              params={{ surveyId }}
              className="flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:bg-secondary-fixed hover:text-on-secondary-fixed border-2 border-transparent hover:border-on-background"
            >
              <span className="material-symbols-outlined">analytics</span>
              Results
            </Link>
          </nav>
          {/* Bottom CTA */}
          <div className="px-4 mt-auto pb-4">
            {survey.status === 'draft' ? (
              <button
                type="button"
                onClick={handlePublish}
                disabled={activeQuestions.length === 0}
                className={`w-full bg-secondary text-on-secondary border-2 border-on-background px-4 py-3 font-label-lg uppercase transition-all flex justify-center items-center gap-2 ${
                  activeQuestions.length === 0
                    ? 'opacity-40 cursor-not-allowed pointer-events-none'
                    : 'neo-brutalist-shadow neo-brutalist-shadow-hover'
                }`}
              >
                <span className="material-symbols-outlined">publish</span>
                Publish Survey
              </button>
            ) : (
              <div className="w-full bg-surface-container border-2 border-on-background px-4 py-3 font-label-sm uppercase text-center text-on-surface-variant font-bold">
                PUBLISHED ACTIVE
              </div>
            )}
          </div>
        </aside>

        {/* Main Workspace Area */}
        <main className="flex-1 flex bg-surface-container-low overflow-hidden">
          {/* Left Panel: Question Builder / Settings */}
          <div className="w-1/2 min-w-[400px] border-r-3 border-on-background flex flex-col bg-surface-container-lowest overflow-hidden">
            {activeTab === 'questions' && (
              <>
                <div className="bg-on-background text-background px-6 py-3 flex justify-between items-center shrink-0">
                  <h2 className="font-label-lg text-label-lg uppercase">Questions Structure</h2>
                  <span className="text-xs font-label-sm px-2 py-1 bg-surface-container-highest text-on-background border border-background">
                    {activeQuestions.length} {activeQuestions.length === 1 ? 'ITEM' : 'ITEMS'}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {/* Title editing */}
                  <div className="border-3 border-on-background bg-surface-bright p-4">
                    <label className="font-label-sm text-xs text-on-surface-variant uppercase block mb-1">
                      Survey Title
                    </label>
                    <input
                      className="w-full font-headline-sm text-headline-sm text-on-surface border-b-2 border-on-background bg-transparent focus:outline-none focus:bg-primary-fixed-dim/10 focus:border-primary p-2 transition-colors uppercase"
                      type="text"
                      value={survey.title}
                      onChange={(e) => handleUpdateTitle(e.target.value)}
                    />
                  </div>

                  {activeQuestions.map((q, qIndex) => (
                    <div
                      key={q.id || qIndex}
                      className="border-3 border-on-background bg-surface-bright relative group"
                    >
                      <div className="absolute -left-3 top-3 bottom-3 w-1.5 bg-secondary group-hover:bg-primary transition-colors"></div>
                      <div className="flex justify-between items-start p-4 border-b border-dashed border-on-background/30 bg-surface-container-low">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              disabled={qIndex === 0}
                              onClick={() => handleMoveQuestion(qIndex, 'up')}
                              className="text-on-surface hover:text-primary disabled:opacity-30 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                keyboard_arrow_up
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={qIndex === activeQuestions.length - 1}
                              onClick={() => handleMoveQuestion(qIndex, 'down')}
                              className="text-on-surface hover:text-primary disabled:opacity-30 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                keyboard_arrow_down
                              </span>
                            </button>
                          </div>
                          <div>
                            <span className="font-label-sm text-xs bg-primary text-on-primary px-2 py-0.5 border border-on-background">
                              Q{qIndex + 1}
                            </span>
                            <select
                              value={q.type}
                              onChange={(e) =>
                                handleUpdateQuestion(q.id || '', { type: e.target.value as any })
                              }
                              className="font-label-sm text-xs bg-surface-container-highest text-on-surface px-2 py-0.5 border border-on-background ml-2 rounded-none focus:outline-none"
                            >
                              <option value="short_text">Short Text</option>
                              <option value="long_text">Long Text</option>
                              <option value="multiple_choice">Multiple Choice</option>
                              <option value="rating">Rating Scale</option>
                              <option value="date">Date Input</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(q.id || '')}
                            className="p-1 hover:bg-error-container hover:text-error transition-colors cursor-pointer"
                            title="Delete Block"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </div>
                      </div>
                      <div className="p-4 space-y-3">
                        <input
                          className="w-full font-body-md text-on-surface border-b-2 border-on-background bg-transparent focus:outline-none focus:bg-primary-fixed-dim/10 focus:border-primary p-2 transition-colors"
                          type="text"
                          value={q.label}
                          onChange={(e) =>
                            handleUpdateQuestion(q.id || '', { label: e.target.value })
                          }
                        />

                        {/* Config rendering based on type */}
                        {q.type === 'multiple_choice' && (
                          <div className="space-y-2 pl-2 border-l-2 border-dashed border-on-background/30 mt-3">
                            <label className="font-label-sm text-xs text-on-surface-variant uppercase block">
                              Choices:
                            </label>
                            {(q.config.options || []).map((opt, optIdx) => (
                              <div key={optIdx} className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-on-background rounded-full bg-surface-container-high"></div>
                                <span className="flex-1 font-body-md text-sm text-on-surface p-1">
                                  {opt}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveChoiceOption(q.id || '', optIdx)}
                                  className="p-1 text-on-surface-variant hover:text-error cursor-pointer"
                                >
                                  <span className="material-symbols-outlined text-[16px]">
                                    close
                                  </span>
                                </button>
                              </div>
                            ))}
                            {/* Input to add option */}
                            <form
                              onSubmit={(e) => {
                                e.preventDefault()
                                const input = (e.target as HTMLFormElement).elements.namedItem(
                                  'newOpt',
                                ) as HTMLInputElement
                                handleAddChoiceOption(q.id || '', input.value)
                                input.value = ''
                              }}
                              className="flex gap-2"
                            >
                              <input
                                name="newOpt"
                                className="flex-1 font-body-md text-sm text-on-surface border-b border-on-background bg-transparent focus:outline-none py-1 placeholder:text-outline/50"
                                placeholder="Add option..."
                                type="text"
                              />
                              <button
                                type="submit"
                                className="px-2 py-0.5 brutal-border bg-surface hover:bg-secondary-fixed text-xs font-label-sm uppercase cursor-pointer"
                              >
                                Add
                              </button>
                            </form>
                          </div>
                        )}

                        {q.type === 'rating' && (
                          <div className="flex gap-4 p-2 bg-surface-container border border-dashed border-on-background/30 mt-2">
                            <div className="flex-1">
                              <label className="font-label-sm text-[10px] text-outline uppercase block">
                                Min Scale (1)
                              </label>
                              <input
                                className="w-full bg-transparent border-b border-on-background text-xs py-1"
                                type="text"
                                placeholder="Poor / Low"
                                value={q.config.min === 1 ? 'Poor' : ''}
                                readOnly
                              />
                            </div>
                            <div className="flex-1">
                              <label className="font-label-sm text-[10px] text-outline uppercase block">
                                Max Scale (5)
                              </label>
                              <input
                                className="w-full bg-transparent border-b border-on-background text-xs py-1"
                                type="text"
                                placeholder="Excellent / High"
                                value={q.config.max === 5 ? 'Excellent' : ''}
                                readOnly
                              />
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-2">
                          <input
                            type="checkbox"
                            id={`req-${q.id}`}
                            checked={q.required}
                            onChange={(e) =>
                              handleUpdateQuestion(q.id || '', { required: e.target.checked })
                            }
                            className="w-4 h-4 border-2 border-on-background text-primary focus:ring-primary focus:ring-offset-0 bg-transparent rounded-none"
                          />
                          <label
                            className="font-label-sm text-xs text-on-surface-variant uppercase cursor-pointer select-none"
                            htmlFor={`req-${q.id}`}
                          >
                            Required Field
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}

                  {deletedQuestions.length > 0 && (
                    <div className="border-3 border-dashed border-on-background bg-surface-bright/50 p-4 mt-6">
                      <h3 className="font-label-lg text-sm uppercase mb-3 flex items-center gap-2 text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm">archive</span>
                        Archived Questions ({deletedQuestions.length})
                      </h3>
                      <div className="space-y-3">
                        {deletedQuestions.map((q) => (
                          <div
                            key={q.id}
                            className="border-2 border-on-background bg-surface-bright/80 p-3 flex justify-between items-center opacity-70"
                          >
                            <div className="flex-1 min-w-0 pr-3">
                              <div className="font-label-sm text-[10px] text-outline uppercase">
                                {q.type}
                              </div>
                              <div className="font-body-md text-sm truncate font-bold text-on-surface">
                                {q.label}
                              </div>
                              {q.response_count !== undefined && q.response_count > 0 && (
                                <div className="font-label-sm text-[9px] text-primary uppercase mt-1 font-bold">
                                  {q.response_count} historical response(s)
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRestoreQuestion(q.id || '')}
                              className="px-3 py-1.5 brutal-border bg-surface text-on-surface hover:bg-secondary-fixed text-xs font-label-sm uppercase cursor-pointer transition-colors"
                            >
                              Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleAddQuestion}
                    className="w-full border-3 border-dashed border-on-background py-6 flex flex-col items-center justify-center gap-2 hover:bg-secondary-fixed/20 hover:border-solid hover:border-primary transition-all group"
                  >
                    <div className="w-10 h-10 border-2 border-on-background bg-background flex items-center justify-center group-hover:bg-primary group-hover:text-on-primary transition-colors">
                      <span className="material-symbols-outlined">add</span>
                    </div>
                    <span className="font-label-lg text-sm uppercase text-on-background">
                      Add Block
                    </span>
                  </button>
                </div>
              </>
            )}

            {activeTab === 'design' && (
              <>
                <div className="bg-on-background text-background px-6 py-3 flex justify-between items-center shrink-0">
                  <h2 className="font-label-lg text-label-lg uppercase">Branding & Style</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Brand Color */}
                  <div className="border-3 border-on-background bg-surface-bright p-4 space-y-3">
                    <label className="font-label-sm text-xs text-on-surface-variant uppercase block">
                      Brand Highlight Color
                    </label>
                    <div className="flex gap-3 items-center">
                      <input
                        type="color"
                        value={survey.brand_color}
                        onChange={(e) => setSurvey({ ...survey, brand_color: e.target.value })}
                        className="w-12 h-12 brutal-border cursor-pointer p-0"
                      />
                      <input
                        type="text"
                        value={survey.brand_color}
                        onChange={(e) => setSurvey({ ...survey, brand_color: e.target.value })}
                        className="flex-grow font-label-lg text-label-lg brutal-border p-2 bg-surface uppercase focus:outline-none"
                        maxLength={7}
                      />
                    </div>
                    {/* presets */}
                    <div className="flex gap-2 pt-2">
                      {['#0052d0', '#fdd400', '#b9003f', '#00ff00', '#6366f1'].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setSurvey({ ...survey, brand_color: c })}
                          className="w-6 h-6 brutal-border border"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Font Family Selection */}
                  <div className="border-3 border-on-background bg-surface-bright p-4 space-y-3">
                    <label className="font-label-sm text-xs text-on-surface-variant uppercase block">
                      Typography font
                    </label>
                    <select
                      value={survey.font_family}
                      onChange={(e) => setSurvey({ ...survey, font_family: e.target.value })}
                      className="w-full brutal-border p-3 bg-surface font-label-lg uppercase rounded-none focus:outline-none"
                    >
                      <option value="Inter">Inter (Clean / Balanced)</option>
                      <option value="JetBrains Mono">JetBrains Mono (Monospaced / Lab)</option>
                      <option value="Anton">Anton (Heavy / Brutalist)</option>
                    </select>
                  </div>

                  {/* Logo URL Input */}
                  <div className="border-3 border-on-background bg-surface-bright p-4 space-y-3">
                    <label className="font-label-sm text-xs text-on-surface-variant uppercase block">
                      Logo Asset URL
                    </label>
                    <input
                      className="w-full brutal-border p-3 bg-surface font-body-md text-sm focus:outline-none"
                      type="url"
                      placeholder="https://example.com/logo.png"
                      value={survey.logo_url || ''}
                      onChange={(e) => setSurvey({ ...survey, logo_url: e.target.value || null })}
                    />
                    <p className="text-[10px] text-outline uppercase font-label-sm">
                      Optional. Image will render at the top header of public forms.
                    </p>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'share' && (
              <>
                <div className="bg-on-background text-background px-6 py-3 flex justify-between items-center shrink-0">
                  <h2 className="font-label-lg text-label-lg uppercase">Module Sharing</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Public Link */}
                  <div className="border-3 border-on-background bg-surface-bright p-4 space-y-3">
                    <label className="font-label-sm text-xs text-on-surface-variant uppercase block">
                      DESTINATION_PATH
                    </label>
                    <div className="flex flex-col gap-2">
                      <input
                        className="w-full brutal-border p-3 bg-surface font-label-lg text-sm text-primary select-all focus:outline-none"
                        readOnly
                        type="text"
                        value={`${window.location.origin}/s/${survey.slug}`}
                      />
                      <button
                        onClick={() => handleCopyLink(`${window.location.origin}/s/${survey.slug}`)}
                        className="bg-primary text-on-primary brutal-border font-label-lg uppercase py-3 hover:bg-primary-container transition-colors flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-sm">content_copy</span>
                        <span>{copyStatus === 'copied' ? 'Copied!' : 'Copy Public Link'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Iframe Embed */}
                  <div className="border-3 border-on-background bg-surface-bright p-4 space-y-3">
                    <label className="font-label-sm text-xs text-on-surface-variant uppercase block">
                      INTEGRATION_PAYLOAD (IFRAME)
                    </label>
                    <textarea
                      className="w-full brutal-border p-3 bg-surface font-label-sm text-xs text-on-surface focus:outline-none h-24"
                      readOnly
                      value={`<iframe src="${window.location.origin}/s/${survey.slug}" width="100%" height="600px" frameborder="0"></iframe>`}
                    />
                    <button
                      onClick={() =>
                        handleCopyLink(
                          `<iframe src="${window.location.origin}/s/${survey.slug}" width="100%" height="600px" frameborder="0"></iframe>`,
                        )
                      }
                      className="w-full bg-surface brutal-border font-label-lg uppercase py-3 hover:bg-secondary-container transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-sm">code</span>
                      <span>Copy Embed Snippet</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right Panel: Live Preview */}
          <div className="w-1/2 flex-grow bg-surface-variant p-8 flex flex-col items-center justify-center relative overflow-y-auto pattern-grid select-none">
            {/* Status Badge */}
            <div className="absolute top-6 right-6 flex items-center gap-2 bg-on-background text-background px-3 py-1 font-label-sm text-xs border-2 border-background shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]">
              <div
                className="w-2 h-2 bg-secondary-fixed rounded-full animate-pulse"
                style={{ backgroundColor: survey.brand_color }}
              ></div>
              LIVE PREVIEW
            </div>

            {activeQuestions.length === 0 ? (
              <div className="bg-surface-bright border-4 border-on-background p-8 font-label-lg uppercase text-center w-full max-w-lg">
                Add questions on the left to activate preview.
              </div>
            ) : (
              <div
                className={`bg-surface-bright border-4 border-on-background neo-brutalist-shadow flex flex-col transition-all duration-300 w-full ${
                  previewDevice === 'mobile' ? 'max-w-[340px]' : 'max-w-lg'
                }`}
                style={{
                  fontFamily:
                    survey.font_family === 'Anton'
                      ? 'Anton'
                      : survey.font_family === 'JetBrains Mono'
                        ? 'JetBrains Mono'
                        : 'Inter',
                }}
              >
                {/* Preview Header */}
                <div
                  className="h-4 border-b-4 border-on-background flex items-center px-2 gap-1"
                  style={{ backgroundColor: survey.brand_color }}
                >
                  <div className="w-2 h-2 bg-on-background"></div>
                  <div className="w-2 h-2 bg-on-background"></div>
                  <div className="w-2 h-2 bg-on-background"></div>
                </div>
                {/* Optional Logo */}
                {survey.logo_url && (
                  <div className="border-b-2 border-on-background p-4 flex justify-center bg-surface shrink-0 h-16 items-center">
                    <img src={survey.logo_url} alt="Logo" className="max-h-12 object-contain" />
                  </div>
                )}{' '}
                {/* Progress Bar */}
                <div className="w-full h-2 bg-surface-container-high border-b-2 border-on-background">
                  <div
                    className="h-full border-r-2 border-on-background transition-all"
                    style={{
                      width: `${((previewQIndex + 1) / activeQuestions.length) * 100}%`,
                      backgroundColor: survey.brand_color,
                    }}
                  ></div>
                </div>
                {/* Question Content */}
                <div className="p-8 flex flex-col min-h-[350px]">
                  <div
                    className="font-label-sm mb-4 uppercase tracking-widest text-xs flex items-center gap-2"
                    style={{ color: survey.brand_color }}
                  >
                    <span>
                      Question {previewQIndex + 1} of {activeQuestions.length}
                    </span>
                    {selectedPreviewQ.required && <span className="text-error font-bold">*</span>}
                  </div>
                  <h3 className="font-headline-sm text-headline-sm mb-6 leading-tight uppercase">
                    {selectedPreviewQ.label}
                  </h3>

                  {/* Input Rendering based on selected Question type */}
                  <div className="flex-grow flex flex-col justify-center">
                    {selectedPreviewQ.type === 'short_text' && (
                      <input
                        className="w-full bg-surface border-[3px] border-on-background p-3 font-body-md text-sm focus:outline-none"
                        type="text"
                        placeholder="Type short response here..."
                        disabled
                      />
                    )}

                    {selectedPreviewQ.type === 'long_text' && (
                      <textarea
                        className="w-full bg-surface border-[3px] border-on-background p-3 font-body-md text-sm focus:outline-none h-24"
                        placeholder="Type detailed response here..."
                        disabled
                      />
                    )}

                    {selectedPreviewQ.type === 'date' && (
                      <input
                        className="w-full bg-surface border-[3px] border-on-background p-3 font-label-lg text-label-lg focus:outline-none"
                        type="date"
                        disabled
                      />
                    )}

                    {selectedPreviewQ.type === 'rating' && (
                      <div className="flex justify-between items-center gap-2 py-3 bg-surface-container border border-dashed border-on-background/30 px-3">
                        {[1, 2, 3, 4, 5].map((val) => (
                          <button
                            key={val}
                            type="button"
                            className="w-10 h-10 brutal-border bg-surface font-label-lg text-sm hover:-translate-y-[2px] transition-transform flex items-center justify-center active:bg-secondary-container"
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedPreviewQ.type === 'multiple_choice' && (
                      <div className="space-y-3">
                        {(selectedPreviewQ.config.options || ['No Options Defined']).map(
                          (opt, optIdx) => (
                            <label key={optIdx} className="block relative cursor-pointer">
                              <div className="p-3 border-3 border-on-background bg-surface hover:bg-surface-container flex items-center gap-3">
                                <div className="w-5 h-5 border-2 border-on-background bg-surface-bright flex items-center justify-center rounded-full"></div>
                                <span className="font-body-md text-sm font-medium">{opt}</span>
                              </div>
                            </label>
                          ),
                        )}
                      </div>
                    )}
                  </div>

                  {/* Preview Navigation */}
                  <div className="flex justify-between items-center mt-8 pt-6 border-t-2 border-dashed border-on-background/20">
                    <button
                      disabled={previewQIndex === 0}
                      onClick={() => setPreviewQIndex(previewQIndex - 1)}
                      className="font-label-lg uppercase flex items-center gap-2 hover:bg-surface-container p-2 border-2 border-transparent transition-colors disabled:opacity-45"
                    >
                      <span className="material-symbols-outlined">arrow_back</span>
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={previewQIndex === activeQuestions.length - 1}
                      onClick={() => setPreviewQIndex(previewQIndex + 1)}
                      className="bg-on-background text-background border-2 border-on-background px-6 py-2 font-label-lg uppercase hover:bg-primary hover:text-white transition-colors flex items-center gap-2 disabled:opacity-45"
                      style={{ backgroundColor: survey.brand_color }}
                    >
                      Next
                      <span className="material-symbols-outlined">arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Preview Device Toggles */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface-bright border-2 border-on-background p-1 neo-brutalist-shadow-sm z-10">
              <button
                onClick={() => setPreviewDevice('desktop')}
                className={`p-2 border-2 ${
                  previewDevice === 'desktop'
                    ? 'bg-on-background text-background border-on-background'
                    : 'text-on-surface hover:bg-surface-container border-transparent'
                }`}
              >
                <span className="material-symbols-outlined">desktop_windows</span>
              </button>
              <button
                onClick={() => setPreviewDevice('mobile')}
                className={`p-2 border-2 ${
                  previewDevice === 'mobile'
                    ? 'bg-on-background text-background border-on-background'
                    : 'text-on-surface hover:bg-surface-container border-transparent'
                }`}
              >
                <span className="material-symbols-outlined">smartphone</span>
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Toast notifications container */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-4 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </div>
  )
}
