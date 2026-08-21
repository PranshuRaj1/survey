/**
 * src/idempotency.test.ts
 *
 * WHAT THIS FILE TESTS
 * --------------------
 * Idempotency — verifies that operations which should be safe to repeat
 * (publish, logout) behave correctly, and documents the known gap where
 * multiple survey submissions from the same respondent are all accepted.
 *
 * TC IDs COVERED
 * --------------
 * TC-IDEM-01  Submitting the same survey twice creates two separate response rows
 *             (no server-side per-respondent deduplication — by current design)
 * TC-IDEM-02  Publish is idempotent — publishing an already-published survey
 *             succeeds and does not double-count or corrupt state
 * TC-IDEM-03  Logout is idempotent — a second logout on an already-revoked
 *             session returns 401 (session already gone)
 * TC-IDEM-04  Concurrent signup with the same email — only one succeeds thanks
 *             to the DB UNIQUE constraint
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { addQuestion, api, createSurvey, publishSurvey, signupAndLogin } from '../helpers/app'
import { applyMigrations } from '../helpers/db'

// ─── Setup ────────────────────────────────────────────────────────────────────

let cookie: string
let surveyId: string
let surveySlug: string
let questionId: string

beforeEach(async () => {
  await applyMigrations(env.DB)
  cookie = await signupAndLogin('idem@example.com')
  const s = await createSurvey(cookie, 'Idempotency Survey')
  surveyId = s.id
  surveySlug = s.slug
  questionId = await addQuestion(cookie, surveyId, {
    label: 'Your name?',
    type: 'short_text',
    sortOrder: 0,
  })
  await publishSurvey(cookie, surveyId)
})

// ─── TC-IDEM-01 ───────────────────────────────────────────────────────────────

describe('TC-IDEM-01 — Double submission creates two response rows (no server-side dedup)', () => {
  /**
   * DESIGN NOTE: The application intentionally allows multiple submissions
   * per respondent (e.g. to support survey previews and retakes).
   * Rate limiting (10/hr/IP) is the only throttle.
   *
   * If single-response-per-respondent semantics are needed in future,
   * a unique respondent fingerprint (cookie-based) should be added.
   */
  it('both submissions return 201 and two rows appear in the responses table', async () => {
    const payload = JSON.stringify({
      answers: [{ question_id: questionId, value: 'Alice' }],
      duration: 5,
    })

    const [res1, res2] = await Promise.all([
      api(`/api/public/survey/${surveySlug}/respond`, {
        method: 'POST',
        ip: '10.0.0.1', // local → no rate limit applied
        body: payload,
      }),
      api(`/api/public/survey/${surveySlug}/respond`, {
        method: 'POST',
        ip: '10.0.0.1',
        body: payload,
      }),
    ])

    expect(res1.status).toBe(201)
    expect(res2.status).toBe(201)

    // Confirm two distinct response IDs were created.
    const b1 = await res1.json<{ responseId: string }>()
    const b2 = await res2.json<{ responseId: string }>()
    expect(b1.responseId).not.toBe(b2.responseId)

    // Confirm two rows in D1.
    const row = await env.DB.prepare('SELECT COUNT(*) as count FROM responses WHERE survey_id = ?')
      .bind(surveyId)
      .first<{ count: number }>()
    expect(row?.count).toBe(2)
  })
})

// ─── TC-IDEM-02 ───────────────────────────────────────────────────────────────

describe('TC-IDEM-02 — Publish is idempotent', () => {
  it('publishing an already-published survey returns success and leaves status as published', async () => {
    // Already published in beforeEach — publish a second time.
    const res = await api(`/api/surveys/${surveyId}/publish`, {
      method: 'POST',
      cookie,
    })

    expect(res.status).toBe(200)
    const body = await res.json<{ success: boolean }>()
    expect(body.success).toBe(true)

    // Confirm status is still "published" in D1.
    const row = await env.DB.prepare('SELECT status FROM surveys WHERE id = ?')
      .bind(surveyId)
      .first<{ status: string }>()
    expect(row?.status).toBe('published')
  })

  it('PATCH status=published on an already-published survey is a no-op', async () => {
    const res = await api(`/api/surveys/${surveyId}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ status: 'published' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ survey: { status: string } }>()
    expect(body.survey.status).toBe('published')
  })
})

// ─── TC-IDEM-03 ───────────────────────────────────────────────────────────────

describe('TC-IDEM-03 — Logout cannot be replayed', () => {
  it('a second logout with the same cookie returns 401 (session already revoked)', async () => {
    // First logout.
    const first = await api('/api/auth/logout', { method: 'POST', cookie })
    expect(first.status).toBe(200)

    // Second logout with the same (now-revoked) cookie.
    const second = await api('/api/auth/logout', { method: 'POST', cookie })
    expect(second.status).toBe(401)
  })
})

// ─── TC-IDEM-04 ───────────────────────────────────────────────────────────────

describe('TC-IDEM-04 — Concurrent signup with duplicate email', () => {
  it('only one signup succeeds when the same email is sent concurrently', async () => {
    const email = 'race@example.com'
    const password = 'Password123!'
    const payload = JSON.stringify({ email, password })

    // Fire 5 signup requests simultaneously.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api('/api/auth/signup', { method: 'POST', body: payload })),
    )

    const statuses = results.map((r) => r.status)
    const successes = statuses.filter((s) => s === 201)
    const conflicts = statuses.filter((s) => s === 409)

    // Exactly one must succeed; the rest must be 409 from the UNIQUE constraint.
    expect(successes).toHaveLength(1)
    expect(conflicts).toHaveLength(4)

    // Confirm only one user row exists in D1.
    const row = await env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE email = ?')
      .bind(email)
      .first<{ count: number }>()
    expect(row?.count).toBe(1)
  })
})
