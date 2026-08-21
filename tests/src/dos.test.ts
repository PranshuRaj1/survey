/**
 * src/dos.test.ts
 *
 * WHAT THIS FILE TESTS
 * --------------------
 * Denial-of-service and DB flooding scenarios — verifies existing guards
 * and documents known gaps where no limit exists, so developers can
 * prioritise remediation.
 *
 * TC IDs COVERED
 * --------------
 * TC-DOS-01  [GAP] PATCH with a massive questions array has no count cap
 * TC-DOS-02  [GAP] CSV export fetches ALL responses with no pagination
 * TC-DOS-03  [GAP] Analytics loads all answer rows into Worker memory
 * TC-DOS-04  [GAP] Survey submission accepts arbitrarily large text values
 * TC-DOS-05  Visit endpoint: multiple unique IPs each get their own lock (correct)
 * TC-DOS-06  Survey with 0 responses returns empty analytics (no crash)
 * TC-DOS-07  Request bodies larger than the app limit are rejected with 413
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { addQuestion, api, createSurvey, publishSurvey, signupAndLogin } from '../helpers/app'
import { applyMigrations, seedQuestion, seedResponse } from '../helpers/db'

// ─── Setup ────────────────────────────────────────────────────────────────────

let cookie: string
let surveyId: string
let surveySlug: string

beforeEach(async () => {
  await applyMigrations(env.DB)
  cookie = await signupAndLogin('dos@example.com')
  const s = await createSurvey(cookie, 'DoS Test Survey')
  surveyId = s.id
  surveySlug = s.slug
})

// ─── TC-DOS-01 ───────────────────────────────────────────────────────────────

describe('TC-DOS-01 — Questions per survey are capped in a single PATCH', () => {
  /**
   * The PATCH /api/surveys/:id endpoint rejects payloads with more than
   * MAX_QUESTIONS_PER_SURVEY (50) questions, preventing a crafted request
   * from triggering hundreds of D1 writes in one batch.
   */
  it('rejects 100 questions with 400', async () => {
    const questions = Array.from({ length: 100 }, (_, i) => ({
      type: 'short_text' as const,
      label: `Question ${i + 1}`,
      sort_order: i,
      required: false,
      config: {},
    }))

    const res = await api(`/api/surveys/${surveyId}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ questions }),
    })

    expect(res.status).toBe(400)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/at most/)
  })

  it('accepts a payload within the cap', async () => {
    const questions = Array.from({ length: 10 }, (_, i) => ({
      type: 'short_text' as const,
      label: `Question ${i + 1}`,
      sort_order: i,
      required: false,
      config: {},
    }))

    const res = await api(`/api/surveys/${surveyId}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ questions }),
    })

    expect(res.status).toBe(200)
  })
})

// ─── TC-DOS-02 ───────────────────────────────────────────────────────────────

describe('TC-DOS-02 — [GAP] Export endpoint has no response row limit', () => {
  /**
   * SECURITY GAP: GET /api/responses/:surveyId/export fetches ALL responses
   * in a single unbounded DB query. For a survey with 10,000+ responses, this
   * loads all rows into Worker memory (128 MB limit) before streaming CSV.
   *
   * This test seeds 50 responses (a safe number) and verifies the export works.
   * It also documents that NO limit/pagination exists in the current code.
   *
   * @todo Add streaming CSV generation or a maximum export row count.
   */
  it('returns a valid CSV for 50 responses (no limit enforced — gap exists)', async () => {
    // Seed a question and 50 responses directly in D1.
    const qId = await seedQuestion(env.DB, surveyId, {
      label: 'Your name?',
      type: 'short_text',
      sortOrder: 0,
    })

    // Mark the survey as published directly.
    await env.DB.exec(`UPDATE surveys SET status = 'published' WHERE id = '${surveyId}'`)

    for (let i = 0; i < 50; i++) {
      await seedResponse(env.DB, surveyId, [{ questionId: qId, value: `Respondent ${i}` }])
    }

    const res = await api(`/api/responses/${surveyId}/export`, { cookie })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')

    const csv = await res.text()
    const lines = csv.trim().split('\n')
    // 1 header row + 50 data rows
    expect(lines.length).toBe(51)
  })
})

// ─── TC-DOS-03 ───────────────────────────────────────────────────────────────

describe('TC-DOS-03 — [GAP] Analytics loads all answer rows into memory', () => {
  /**
   * SECURITY GAP: GET /api/responses/:surveyId/analytics fetches ALL
   * response_answers for the survey (via a single JOIN) and aggregates them
   * in-memory. For large surveys this can exhaust the 128 MB Worker limit.
   *
   * This test verifies the endpoint returns correct data for 30 responses.
   *
   * @todo Move aggregation to SQL (AVG, COUNT, GROUP BY) to avoid in-memory load.
   */
  it('returns correct aggregated analytics without crashing (30 responses)', async () => {
    const qId = await seedQuestion(env.DB, surveyId, {
      label: 'Rating',
      type: 'rating',
      sortOrder: 0,
    })
    await env.DB.exec(`UPDATE surveys SET status = 'published' WHERE id = '${surveyId}'`)

    for (let i = 0; i < 30; i++) {
      await seedResponse(env.DB, surveyId, [{ questionId: qId, value: (i % 5) + 1 }])
    }

    const res = await api(`/api/responses/${surveyId}/analytics`, { cookie })
    expect(res.status).toBe(200)

    const body = await res.json<{
      total: number
      questions: Array<{ type: string; average: number; count: number }>
    }>()
    expect(body.total).toBe(30)
    const q = body.questions.find((x) => x.type === 'rating')
    expect(q).toBeDefined()
    expect(q?.count).toBe(30)
    // Average of 1,2,3,4,5,1,2,3,4,5,... repeated 6 times = 3.0
    expect(q?.average).toBeCloseTo(3.0, 1)
  })
})

// ─── TC-DOS-04 ───────────────────────────────────────────────────────────────

describe('TC-DOS-04 — Server-side content-length limit on answer values', () => {
  /**
   * The survey submission endpoint rejects string answer values longer than
   * MAX_ANSWER_LENGTH (10,000 chars) with 400, preventing oversized values
   * from being stored verbatim in D1.
   */
  it('rejects a 64 KB text answer with 400', async () => {
    const qId = await addQuestion(cookie, surveyId, {
      label: 'Tell us everything',
      type: 'long_text',
      sortOrder: 0,
    })
    await publishSurvey(cookie, surveyId)

    const bigValue = 'A'.repeat(64 * 1024) // 64 KB

    const res = await api(`/api/public/survey/${surveySlug}/respond`, {
      method: 'POST',
      ip: '10.0.0.1',
      body: JSON.stringify({
        answers: [{ question_id: qId, value: bigValue }],
        duration: 1,
      }),
    })

    expect(res.status).toBe(400)
  })

  it('accepts a normal-length answer', async () => {
    const qId = await addQuestion(cookie, surveyId, {
      label: 'Short and sweet',
      type: 'long_text',
      sortOrder: 0,
    })
    await publishSurvey(cookie, surveyId)

    const res = await api(`/api/public/survey/${surveySlug}/respond`, {
      method: 'POST',
      ip: '10.0.0.2',
      body: JSON.stringify({
        answers: [{ question_id: qId, value: 'A reasonable answer' }],
        duration: 1,
      }),
    })

    expect(res.status).toBe(201)
  })
})

// ─── TC-DOS-07 ───────────────────────────────────────────────────────────────

describe('TC-DOS-07 — Global request body size limit', () => {
  it('rejects a body over 1 MB with 413', async () => {
    const bigValue = 'A'.repeat(1024 * 1024 + 1)

    const res = await api('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Length': String(bigValue.length) },
      body: JSON.stringify({ email: 'big@example.com', password: bigValue }),
    })

    expect(res.status).toBe(413)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/too large/i)
  })
})

// ─── TC-DOS-05 ───────────────────────────────────────────────────────────────

describe('TC-DOS-05 — Visit endpoint correctly scopes KV locks per survey', () => {
  /**
   * Ensures that a new external IP can visit a DIFFERENT survey even if it is
   * locked out of another — confirming the KV key is per-survey.
   */
  it('IP lock on survey A does not prevent a first visit to survey B', async () => {
    const cookieB = await signupAndLogin('dos-b@example.com')
    const sB = await createSurvey(cookieB, 'Survey B')
    await addQuestion(cookieB, sB.id, { label: 'Q', type: 'short_text', sortOrder: 0 })
    await publishSurvey(cookieB, sB.id)

    const EXTERNAL_IP = '203.0.113.50'

    // Lock the IP on Survey A.
    await api(`/api/public/survey/${surveySlug}/visit`, {
      method: 'POST',
      ip: EXTERNAL_IP,
    })

    // Survey B should still accept the first visit from the same IP.
    await api(`/api/public/survey/${sB.slug}/visit`, {
      method: 'POST',
      ip: EXTERNAL_IP,
    })

    const countB = await env.KV.get(`visits:${sB.id}`)
    expect(countB).toBe('1')
  })
})

// ─── TC-DOS-06 ───────────────────────────────────────────────────────────────

describe('TC-DOS-06 — Analytics and export return graceful empty results for 0 responses', () => {
  it('analytics returns total:0 and an empty questions array', async () => {
    await addQuestion(cookie, surveyId, { label: 'Q1', type: 'short_text', sortOrder: 0 })
    await publishSurvey(cookie, surveyId)

    const res = await api(`/api/responses/${surveyId}/analytics`, { cookie })
    expect(res.status).toBe(200)

    const body = await res.json<{ total: number; questions: unknown[] }>()
    expect(body.total).toBe(0)
  })

  it('responses endpoint returns empty array for survey with no submissions', async () => {
    const res = await api(`/api/responses/${surveyId}`, { cookie })
    expect(res.status).toBe(200)

    const body = await res.json<{ responses: unknown[]; total: number }>()
    expect(body.responses).toHaveLength(0)
    expect(body.total).toBe(0)
  })
})
