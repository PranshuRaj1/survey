/**
 * src/deduplication.test.ts
 *
 * WHAT THIS FILE TESTS
 * --------------------
 * Deduplication at submission time — verifies the server correctly rejects
 * duplicate question answers in a single payload, rejects answers for
 * question IDs that don't belong to the survey, and strips answers for
 * questions that are hidden by conditional logic.
 *
 * TC IDs COVERED
 * --------------
 * TC-DEDUP-01  Duplicate question_id in one submission payload → 400
 * TC-DEDUP-02  Answer referencing a question_id not in the survey → 400
 * TC-DEDUP-03  Answer for a logic-hidden question is silently discarded server-side
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { addQuestion, api, createSurvey, publishSurvey, signupAndLogin } from '../helpers/app'
import { applyMigrations } from '../helpers/db'

// ─── Setup ────────────────────────────────────────────────────────────────────

let cookie: string
let surveySlug: string
let q1Id: string

beforeEach(async () => {
  await applyMigrations(env.DB)
  cookie = await signupAndLogin('owner@example.com')
  const survey = await createSurvey(cookie, 'Dedup Test Survey')
  surveySlug = survey.slug

  q1Id = await addQuestion(cookie, survey.id, {
    label: 'What is your name?',
    type: 'short_text',
    sortOrder: 0,
  })

  await publishSurvey(cookie, survey.id)
})

// ─── TC-DEDUP-01 ─────────────────────────────────────────────────────────────

describe('TC-DEDUP-01 — Duplicate question_id in one submission', () => {
  it('returns 400 when the same question_id appears twice in the answers array', async () => {
    const res = await api(`/api/public/survey/${surveySlug}/respond`, {
      method: 'POST',
      ip: '10.0.0.1', // local IP skips rate-limit; we just test dedup
      body: JSON.stringify({
        answers: [
          { question_id: q1Id, value: 'Alice' },
          { question_id: q1Id, value: 'Bob' }, // duplicate
        ],
        duration: 10,
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/duplicate/i)
  })
})

// ─── TC-DEDUP-02 ─────────────────────────────────────────────────────────────

describe('TC-DEDUP-02 — Answer for a non-existent question_id', () => {
  it('returns 400 when a fabricated UUID is submitted as question_id', async () => {
    const fakeId = crypto.randomUUID().replace(/-/g, '')

    const res = await api(`/api/public/survey/${surveySlug}/respond`, {
      method: 'POST',
      ip: '10.0.0.1',
      body: JSON.stringify({
        answers: [{ question_id: fakeId, value: 'Injected' }],
        duration: 5,
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/invalid question_id/i)
  })

  it('returns 400 even if a valid Q is also included alongside the fake one', async () => {
    const fakeId = crypto.randomUUID().replace(/-/g, '')

    const res = await api(`/api/public/survey/${surveySlug}/respond`, {
      method: 'POST',
      ip: '10.0.0.1',
      body: JSON.stringify({
        answers: [
          { question_id: q1Id, value: 'Alice' },
          { question_id: fakeId, value: 'Injected' },
        ],
        duration: 5,
      }),
    })

    expect(res.status).toBe(400)
  })
})

// ─── TC-DEDUP-03 ─────────────────────────────────────────────────────────────

describe('TC-DEDUP-03 — Answers for hidden (conditional) questions are discarded', () => {
  /**
   * Survey layout:
   *   Q1 (short_text, sort_order 0) — always visible
   *   Q2 (short_text, sort_order 1) — shown ONLY when Q1 equals "yes"
   *
   * Test: submit Q1="no" + Q2="secret".
   * Expected: server visibility logic hides Q2 → its answer is NOT stored.
   */
  it("strips the hidden question's answer from the database", async () => {
    const ownerCookie = await signupAndLogin('logic@example.com')
    const { id: surveyId, slug } = await createSurvey(ownerCookie, 'Logic Survey')

    // Add Q1 (unconditional)
    const qId1 = await addQuestion(ownerCookie, surveyId, {
      label: 'Do you agree?',
      type: 'short_text',
      sortOrder: 0,
    })

    // Add Q2 with a "show when Q1 equals yes" logic rule.
    const qId2 = await addQuestion(ownerCookie, surveyId, {
      label: 'Why do you agree?',
      type: 'short_text',
      sortOrder: 1,
      config: {
        logic: {
          action: 'show',
          strategy: 'all',
          conditions: [{ question_id: qId1, operator: 'equals', value: 'yes' }],
        },
      },
    })

    await publishSurvey(ownerCookie, surveyId)

    // Submit Q1="no" + Q2 answer (Q2 should be hidden).
    const res = await api(`/api/public/survey/${slug}/respond`, {
      method: 'POST',
      ip: '10.0.0.1',
      body: JSON.stringify({
        answers: [
          { question_id: qId1, value: 'no' },
          { question_id: qId2, value: 'secret answer that should be discarded' },
        ],
        duration: 5,
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json<{ responseId: string }>()

    // Verify directly in D1 that no answer row was created for Q2.
    const q2Answer = await env.DB.prepare(
      'SELECT id FROM response_answers WHERE response_id = ? AND question_id = ?',
    )
      .bind(body.responseId, qId2)
      .first()

    expect(q2Answer).toBeNull()

    // Verify Q1 answer WAS stored.
    const q1Answer = await env.DB.prepare(
      'SELECT value_json FROM response_answers WHERE response_id = ? AND question_id = ?',
    )
      .bind(body.responseId, qId1)
      .first<{ value_json: string }>()

    expect(JSON.parse(q1Answer?.value_json ?? 'null')).toBe('no')
  })
})
