/**
 * helpers/app.ts
 *
 * HTTP helper for the test suite.
 *
 * PURPOSE
 * -------
 * Provides a thin typed wrapper around SELF.fetch() (the real Workers Fetcher
 * from @cloudflare/vitest-pool-workers) so individual test files don't have to
 * manage headers, cookie jars, or CSRF origin manually.
 *
 * KEY BEHAVIOURS
 * --------------
 * - Automatically sets Content-Type: application/json.
 * - Automatically sets Origin: http://localhost:5173 to pass the CSRF middleware
 *   (the app allows this origin in both CORS and CSRF configs).
 * - Accepts an optional `cookie` string (e.g. "decodego_session=xyz") that is
 *   forwarded in the Cookie header — simulates a real browser session.
 * - Accepts an optional `ip` string forwarded as CF-Connecting-IP — used by
 *   rate limiting and visit tracking tests.
 * - signupAndLogin() creates a user via the HTTP signup endpoint and returns the
 *   session cookie string ready to pass to subsequent calls.
 */

import { SELF } from 'cloudflare:test'

/** Base URL — host is irrelevant; SELF routes to the worker regardless. */
const BASE = 'http://localhost'

/** Origin that the app's CSRF + CORS allow list includes. */
const ALLOWED_ORIGIN = 'http://localhost:5173'

export interface ApiOptions extends Omit<RequestInit, 'headers'> {
  /** Raw Cookie header value, e.g. "decodego_session=abc123". */
  cookie?: string
  /** Simulated CF-Connecting-IP for rate-limit / visit tests. */
  ip?: string
  /** Override / extend individual headers. */
  headers?: Record<string, string>
}

// ─── Core Request Helper ──────────────────────────────────────────────────────

/**
 * Sends an HTTP request to the worker via SELF.fetch().
 *
 * All test assertions should go through this helper so CSRF + auth headers are
 * handled consistently.
 */
export async function api(path: string, options: ApiOptions = {}): Promise<Response> {
  const { cookie, ip, headers: extraHeaders, ...fetchOptions } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: ALLOWED_ORIGIN,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(ip ? { 'CF-Connecting-IP': ip } : {}),
    ...extraHeaders,
  }

  return SELF.fetch(`${BASE}${path}`, { ...fetchOptions, headers })
}

// ─── Cookie Utilities ─────────────────────────────────────────────────────────

/**
 * Extracts a named cookie value from a Set-Cookie response header.
 * Returns the full "name=value" pair (ready to paste into a Cookie header).
 * Returns null if the cookie is not present.
 */
export function extractCookie(res: Response, name: string): string | null {
  // set-cookie may be a comma-joined list in fetch responses.
  const raw = res.headers.get('set-cookie') ?? ''
  const match = raw.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`))
  return match ? `${name}=${match[1]}` : null
}

// ─── Auth Helpers ────────────────────────────────────────────────────────────

/**
 * Signs up a new user and returns the session cookie string.
 *
 * Uses the real HTTP endpoints so signup validation is exercised.
 * Throws if signup returns a non-2xx status (signals test precondition failure).
 */
export async function signupAndLogin(email: string, password = 'Password123!'): Promise<string> {
  const signupRes = await api('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  if (!signupRes.ok) {
    const body = await signupRes.json<{ error: string }>()
    throw new Error(
      `signupAndLogin: signup failed for ${email} — ${signupRes.status} ${body.error}`,
    )
  }

  const cookie = extractCookie(signupRes, 'decodego_session')
  if (!cookie) {
    throw new Error(`signupAndLogin: no session cookie returned for ${email}`)
  }
  return cookie
}

/**
 * Logs in with existing credentials and returns the session cookie string.
 */
export async function loginAs(email: string, password = 'Password123!'): Promise<string> {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const body = await res.json<{ error: string }>()
    throw new Error(`loginAs: login failed for ${email} — ${res.status} ${body.error}`)
  }

  const cookie = extractCookie(res, 'decodego_session')
  if (!cookie) throw new Error(`loginAs: no cookie for ${email}`)
  return cookie
}

// ─── Survey Shortcuts ─────────────────────────────────────────────────────────

/**
 * Creates a survey via the authenticated API and returns its id + slug.
 */
export async function createSurvey(
  cookie: string,
  title = 'Test Survey',
): Promise<{ id: string; slug: string }> {
  const res = await api('/api/surveys', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ title }),
  })
  const body = await res.json<{ survey: { id: string; slug: string } }>()
  if (!res.ok) throw new Error(`createSurvey failed: ${JSON.stringify(body)}`)
  return { id: body.survey.id, slug: body.survey.slug }
}

/**
 * Adds a question to a survey via PATCH and returns the question id.
 * Wraps the full questions-array replace mechanic the API uses.
 */
export async function addQuestion(
  cookie: string,
  surveyId: string,
  opts: {
    type?: 'short_text' | 'long_text' | 'multiple_choice' | 'rating' | 'date'
    label?: string
    required?: boolean
    sortOrder?: number
    config?: Record<string, unknown>
  } = {},
): Promise<string> {
  // First fetch existing questions so we can append.
  const existingRes = await api(`/api/surveys/${surveyId}`, { cookie })
  const existing = await existingRes.json<{
    survey: {
      questions: Array<{
        id: string
        type: string
        label: string
        sort_order: number
        required: boolean
        config: Record<string, unknown>
        deleted_at: number | null
      }>
    }
  }>()

  const newQ = {
    type: opts.type ?? 'short_text',
    label: opts.label ?? 'Untitled Question',
    sort_order: opts.sortOrder ?? existing.survey.questions.length,
    required: opts.required ?? false,
    config: opts.config ?? {},
  }

  const allQuestions = [
    ...existing.survey.questions.map((q) => ({
      id: q.id,
      type: q.type,
      label: q.label,
      sort_order: q.sort_order,
      required: q.required,
      config: q.config,
      deleted_at: q.deleted_at,
    })),
    newQ,
  ]

  const patchRes = await api(`/api/surveys/${surveyId}`, {
    method: 'PATCH',
    cookie,
    body: JSON.stringify({ questions: allQuestions }),
  })

  const patchBody = await patchRes.json<{
    survey: { questions: Array<{ id: string; label: string }> }
  }>()
  if (!patchRes.ok) throw new Error(`addQuestion failed: ${JSON.stringify(patchBody)}`)

  // The newly added question is always the last one.
  const questions = patchBody.survey.questions
  const last = questions[questions.length - 1]
  if (!last) throw new Error('addQuestion: no questions returned')
  return last.id
}

/**
 * Publishes a survey via POST /api/surveys/:id/publish.
 */
export async function publishSurvey(cookie: string, surveyId: string): Promise<void> {
  const res = await api(`/api/surveys/${surveyId}/publish`, {
    method: 'POST',
    cookie,
  })
  if (!res.ok) {
    const body = await res.json<{ error: string }>()
    throw new Error(`publishSurvey failed: ${body.error}`)
  }
}
