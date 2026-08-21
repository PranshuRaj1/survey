/**
 * src/memory.test.ts
 *
 * WHAT THIS FILE TESTS
 * --------------------
 * Server-side memory management — verifies that response data is handled
 * correctly under various edge-case conditions, and documents the known
 * in-memory aggregation gap in the analytics endpoint.
 *
 * TC IDs COVERED
 * --------------
 * TC-MEM-01  Analytics in-memory map is populated correctly (answers grouped by question)
 * TC-MEM-02  Soft-deleted questions are excluded from analytics (no ghost data)
 * TC-MEM-03  Export excludes answers for questions not in the questions set (safe pivot)
 * TC-MEM-04  [GAP] Analytics loads ALL answer rows into memory — no streaming/paging
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { addQuestion, api, createSurvey, publishSurvey, signupAndLogin } from '../helpers/app'
import { applyMigrations, seedQuestion, seedResponse } from '../helpers/db'

// ─── Setup ────────────────────────────────────────────────────────────────────

let cookie: string
let surveyId: string

beforeEach(async () => {
  await applyMigrations(env.DB)
  cookie = await signupAndLogin('memory@example.com')
  const s = await createSurvey(cookie, 'Memory Test Survey')
  surveyId = s.id
})

// ─── TC-MEM-01 ───────────────────────────────────────────────────────────────

describe('TC-MEM-01 — Analytics groups answers by question correctly', () => {
  it('returns one analytics entry per active question with correct counts', async () => {
    const q1 = await addQuestion(cookie, surveyId, {
      label: 'Rating Q',
      type: 'rating',
      sortOrder: 0,
      config: { min: 1, max: 5 },
    })
    const q2 = await addQuestion(cookie, surveyId, {
      label: 'Choice Q',
      type: 'multiple_choice',
      sortOrder: 1,
      config: { options: ['Yes', 'No'] },
    })
    await publishSurvey(cookie, surveyId)

    // Seed 3 responses directly.
    await seedResponse(env.DB, surveyId, [
      { questionId: q1, value: 4 },
      { questionId: q2, value: 'Yes' },
    ])
    await seedResponse(env.DB, surveyId, [
      { questionId: q1, value: 2 },
      { questionId: q2, value: 'No' },
    ])
    await seedResponse(env.DB, surveyId, [
      { questionId: q1, value: 5 },
      { questionId: q2, value: 'Yes' },
    ])

    const res = await api(`/api/responses/${surveyId}/analytics`, { cookie })
    expect(res.status).toBe(200)

    const body = await res.json<{
      total: number
      questions: Array<{
        question_id: string
        type: string
        average?: number
        count: number
        tally?: Record<string, number>
      }>
    }>()

    expect(body.total).toBe(3)

    const ratingQ = body.questions.find((q) => q.question_id === q1)
    expect(ratingQ).toBeDefined()
    expect(ratingQ?.count).toBe(3)
    // Average of 4, 2, 5 = 11/3 ≈ 3.67
    expect(ratingQ?.average).toBeCloseTo(3.67, 1)

    const choiceQ = body.questions.find((q) => q.question_id === q2)
    expect(choiceQ).toBeDefined()
    expect(choiceQ?.tally?.Yes).toBe(2)
    expect(choiceQ?.tally?.No).toBe(1)
  })
})

// ─── TC-MEM-02 ───────────────────────────────────────────────────────────────

describe('TC-MEM-02 — Soft-deleted questions are excluded from analytics', () => {
  it('does not include deleted_at != null questions in the analytics question list', async () => {
    const activeQId = await addQuestion(cookie, surveyId, {
      label: 'Active Question',
      type: 'short_text',
      sortOrder: 0,
    })
    await publishSurvey(cookie, surveyId)

    // Soft-delete by inserting directly (simulating a previously active question).
    const deletedQId = await seedQuestion(env.DB, surveyId, {
      label: 'Deleted Question',
      type: 'short_text',
      sortOrder: 1,
      deletedAt: Math.floor(Date.now() / 1000),
    })

    await seedResponse(env.DB, surveyId, [
      { questionId: activeQId, value: 'hello' },
      { questionId: deletedQId, value: 'ghost answer' },
    ])

    const res = await api(`/api/responses/${surveyId}/analytics`, { cookie })
    expect(res.status).toBe(200)

    const body = await res.json<{
      questions: Array<{ question_id: string; label: string }>
    }>()

    const ids = body.questions.map((q) => q.question_id)
    // Active question must be present.
    expect(ids).toContain(activeQId)
    // Deleted question must NOT appear in analytics.
    expect(ids).not.toContain(deletedQId)
  })
})

// ─── TC-MEM-03 ───────────────────────────────────────────────────────────────

describe('TC-MEM-03 — CSV export correctly handles orphan answers (safe pivot)', () => {
  /**
   * Scenario: A response was submitted when Q2 existed. Q2 is later soft-deleted.
   * The export must still include Q2 as a "(Deleted)" column.
   */
  it('includes deleted question columns marked "(Deleted)" in the CSV header', async () => {
    const q1 = await addQuestion(cookie, surveyId, {
      label: 'Name',
      type: 'short_text',
      sortOrder: 0,
    })
    await publishSurvey(cookie, surveyId)

    // Seed a deleted question with an existing answer.
    const deletedQId = await seedQuestion(env.DB, surveyId, {
      label: 'Old Question',
      type: 'short_text',
      sortOrder: 1,
      deletedAt: Math.floor(Date.now() / 1000),
    })

    await seedResponse(env.DB, surveyId, [
      { questionId: q1, value: 'Alice' },
      { questionId: deletedQId, value: 'historic answer' },
    ])

    const res = await api(`/api/responses/${surveyId}/export`, { cookie })
    expect(res.status).toBe(200)

    const csv = await res.text()
    const headerLine = csv.split('\n')[0] ?? ''
    // The deleted question should appear as "Old Question (Deleted)" in the header.
    expect(headerLine).toContain('Deleted')
  })
})

// ─── TC-MEM-04 ───────────────────────────────────────────────────────────────

describe('TC-MEM-04 — [GAP] Analytics loads entire answer set into Worker memory', () => {
  /**
   * SECURITY GAP: GET /api/responses/:surveyId/analytics pulls ALL rows from
   * response_answers into a JS Map before computing metrics. For large surveys
   * (e.g. 100,000 responses × 20 questions = 2M rows) this can exhaust the
   * 128 MB Cloudflare Worker memory limit and crash the Worker.
   *
   * This test seeds 200 responses and confirms analytics still works at this
   * scale (a safe amount), while documenting the architectural gap.
   *
   * @todo Replace in-memory aggregation with SQL: AVG(), COUNT(), GROUP BY.
   */
  it('returns correct analytics for 200 responses without crashing (documents in-memory risk)', async () => {
    const qId = await addQuestion(cookie, surveyId, {
      label: 'Score',
      type: 'rating',
      sortOrder: 0,
      config: { min: 1, max: 5 },
    })
    await publishSurvey(cookie, surveyId)

    // Seed 200 responses with alternating ratings.
    for (let i = 0; i < 200; i++) {
      await seedResponse(env.DB, surveyId, [{ questionId: qId, value: (i % 5) + 1 }])
    }

    const res = await api(`/api/responses/${surveyId}/analytics`, { cookie })
    expect(res.status).toBe(200)

    const body = await res.json<{
      total: number
      questions: Array<{ count: number; average: number }>
    }>()

    expect(body.total).toBe(200)
    expect(body.questions[0]?.count).toBe(200)
    // Average of 1,2,3,4,5 repeated 40 times = 3.0
    expect(body.questions[0]?.average).toBeCloseTo(3.0, 1)
  })
})
