/**
 * src/edge-cases.test.ts
 *
 * WHAT THIS FILE TESTS
 * --------------------
 * Edge cases and miscellaneous bugs identified in the test-cases document.
 * Covers cascade deletes, publish guards, logic ordering violations, CSV
 * injection prevention, completion_duration coercion, and slug generation.
 *
 * TC IDs COVERED
 * --------------
 * TC-EDGE-01  [GAP] Slug collision in generateSlug — no retry on UNIQUE conflict
 * TC-EDGE-02  Deleting a survey cascades to responses and answers
 * TC-EDGE-03  Publishing a multiple-choice question with 0 options is blocked
 * TC-EDGE-04  Publishing a survey with no questions is blocked
 * TC-EDGE-05  Logic ordering violation on save is rejected
 * TC-EDGE-06  CSV injection: answer values starting with = + - @ are prefixed with '
 * TC-EDGE-07  GET /api/auth/me requires authentication
 * TC-EDGE-08  completion_duration: non-integer and negative values stored as NULL
 * TC-EDGE-09  Deleted survey's slug can no longer be used publicly
 * TC-EDGE-10  Rating answers must be numbers (string rating → 400)
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
  cookie = await signupAndLogin('edge@example.com')
  const s = await createSurvey(cookie, 'Edge Case Survey')
  surveyId = s.id
  surveySlug = s.slug
})

// ─── TC-EDGE-01 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-01 — [GAP] generateSlug has no retry on UNIQUE constraint collision', () => {
  /**
   * RISK: generateSlug appends only 5 random chars. For titles like "survey",
   * the probability of a collision rises with volume. A collision triggers an
   * unhandled D1 constraint error → 500 Internal Server Error.
   *
   * This test verifies that the CURRENT slug format is unique for 10 surveys
   * with the same title (probabilistic pass). A true collision scenario requires
   * mocking Math.random, which is beyond this test's scope.
   *
   * @todo Wrap the INSERT in a retry loop that regenerates the slug on conflict.
   */
  it('creates 10 surveys with the same title without slug collision', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api('/api/surveys', {
          method: 'POST',
          cookie,
          body: JSON.stringify({ title: 'Same Title' }),
        }),
      ),
    )

    const statuses = results.map((r) => r.status)
    // All must succeed (probabilistically — 5 random chars from 36^5 = 60M space).
    expect(statuses.every((s) => s === 201)).toBe(true)

    // All slugs must be unique.
    const slugs = await Promise.all(
      results.map(async (r) => {
        const b = await r.json<{ survey: { slug: string } }>()
        return b.survey.slug
      }),
    )
    const unique = new Set(slugs)
    expect(unique.size).toBe(10)
  })
})

// ─── TC-EDGE-02 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-02 — Survey deletion cascades to responses and response_answers', () => {
  it('removes all child rows when the survey is deleted', async () => {
    const qId = await addQuestion(cookie, surveyId, {
      label: 'Name',
      type: 'short_text',
      sortOrder: 0,
    })
    await publishSurvey(cookie, surveyId)

    // Seed 3 responses with answers.
    for (let i = 0; i < 3; i++) {
      await seedResponse(env.DB, surveyId, [{ questionId: qId, value: `Person ${i}` }])
    }

    // Confirm data exists before deletion.
    const beforeCount = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM responses WHERE survey_id = ?',
    )
      .bind(surveyId)
      .first<{ c: number }>()
    expect(beforeCount?.c).toBe(3)

    // Delete the survey.
    const deleteRes = await api(`/api/surveys/${surveyId}`, {
      method: 'DELETE',
      cookie,
    })
    expect(deleteRes.status).toBe(200)

    // Responses must be gone.
    const afterResponses = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM responses WHERE survey_id = ?',
    )
      .bind(surveyId)
      .first<{ c: number }>()
    expect(afterResponses?.c).toBe(0)

    // Answers must be gone too (CASCADE from responses).
    const afterAnswers = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM response_answers
       WHERE response_id NOT IN (SELECT id FROM responses)`,
    ).first<{ c: number }>()
    expect(afterAnswers?.c).toBe(0)
  })
})

// ─── TC-EDGE-03 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-03 — Multiple-choice question with 0 options blocks publishing', () => {
  it('returns 400 when trying to publish a survey with an option-less multiple_choice question', async () => {
    await addQuestion(cookie, surveyId, {
      label: 'Pick one',
      type: 'multiple_choice',
      sortOrder: 0,
      config: { options: [] }, // empty options!
    })

    const res = await api(`/api/surveys/${surveyId}/publish`, {
      method: 'POST',
      cookie,
    })

    expect(res.status).toBe(400)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/at least one option/i)
  })

  it('allows publishing once options are added', async () => {
    await addQuestion(cookie, surveyId, {
      label: 'Pick one',
      type: 'multiple_choice',
      sortOrder: 0,
      config: { options: ['Yes', 'No'] },
    })

    const res = await api(`/api/surveys/${surveyId}/publish`, {
      method: 'POST',
      cookie,
    })

    expect(res.status).toBe(200)
  })
})

// ─── TC-EDGE-04 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-04 — Cannot publish a survey with no questions', () => {
  it('returns 400 with "no questions" message', async () => {
    const res = await api(`/api/surveys/${surveyId}/publish`, {
      method: 'POST',
      cookie,
    })

    expect(res.status).toBe(400)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/no questions/i)
  })
})

// ─── TC-EDGE-05 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-05 — Logic ordering violation is rejected on save', () => {
  it('returns 400 when a question depends on a later question (sort_order violation)', async () => {
    // Q1 sort_order=0, Q2 sort_order=1.
    // We try to make Q1 depend on Q2 — a forward dependency.
    const q1Id = await addQuestion(cookie, surveyId, {
      label: 'Q1',
      type: 'short_text',
      sortOrder: 0,
    })
    const q2Id = await addQuestion(cookie, surveyId, {
      label: 'Q2',
      type: 'short_text',
      sortOrder: 1,
    })

    // Now PATCH both with Q1 depending on Q2 (Q2 has higher sort_order).
    const res = await api(`/api/surveys/${surveyId}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({
        questions: [
          {
            id: q1Id,
            type: 'short_text',
            label: 'Q1',
            sort_order: 0,
            required: false,
            config: {
              logic: {
                action: 'show',
                strategy: 'all',
                conditions: [{ question_id: q2Id, operator: 'equals', value: 'yes' }],
              },
            },
          },
          {
            id: q2Id,
            type: 'short_text',
            label: 'Q2',
            sort_order: 1,
            required: false,
            config: {},
          },
        ],
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/logic ordering violation/i)
  })
})

// ─── TC-EDGE-06 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-06 — CSV export prevents formula injection', () => {
  /**
   * Answer values starting with = + - @ are prefixed with a single-quote (')
   * in the CSV output to prevent spreadsheet formula injection (e.g. Excel).
   */
  const injectionPayloads = [
    '=SUM(A1:A100)',
    '+CMD|"/C calc"!A0',
    '-2+3+cmd|"/C calc"!A0',
    '@SUM(1+1)',
  ]

  for (const payload of injectionPayloads) {
    it(`prefixes "${payload}" with a single quote in the CSV`, async () => {
      const qId = await seedQuestion(env.DB, surveyId, {
        label: 'Name',
        type: 'short_text',
        sortOrder: 0,
      })
      await env.DB.exec(`UPDATE surveys SET status = 'published' WHERE id = '${surveyId}'`)
      await seedResponse(env.DB, surveyId, [{ questionId: qId, value: payload }])

      const res = await api(`/api/responses/${surveyId}/export`, { cookie })
      expect(res.status).toBe(200)

      const csv = await res.text()
      // The payload should appear prefixed with ' inside a quoted CSV cell.
      const expected = `'${payload.replace(/"/g, '""')}`
      expect(csv).toContain(expected)
    })
  }
})

// ─── TC-EDGE-07 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-07 — GET /api/auth/me requires authentication', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await api('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns the user object for an authenticated request', async () => {
    const res = await api('/api/auth/me', { cookie })
    expect(res.status).toBe(200)
    const body = await res.json<{ user: { email: string } }>()
    expect(body.user.email).toBe('edge@example.com')
  })
})

// ─── TC-EDGE-08 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-08 — completion_duration coercion', () => {
  /**
   * The API accepts `duration` only when it is a positive integer.
   * All other values (negative, zero, float, string) are stored as NULL.
   */
  const invalidDurations: Array<{ label: string; value: unknown }> = [
    { label: 'negative', value: -5 },
    { label: 'zero', value: 0 },
    { label: 'float', value: 3.7 },
    { label: 'string', value: 'abc' },
    { label: 'null', value: null },
    { label: 'undefined (omitted)', value: undefined },
  ]

  it('stores NULL for invalid duration values while still returning 201', async () => {
    const qId = await addQuestion(cookie, surveyId, {
      label: 'Q',
      type: 'short_text',
      sortOrder: 0,
    })
    await publishSurvey(cookie, surveyId)

    for (const { label, value } of invalidDurations) {
      const body: Record<string, unknown> = {
        answers: [{ question_id: qId, value: 'test' }],
      }
      if (value !== undefined) body.duration = value

      const res = await api(`/api/public/survey/${surveySlug}/respond`, {
        method: 'POST',
        ip: '10.0.0.1',
        body: JSON.stringify(body),
      })

      expect(res.status, `expected 201 for duration=${label}`).toBe(201)

      const { responseId } = await res.json<{ responseId: string }>()

      const row = await env.DB.prepare('SELECT completion_duration FROM responses WHERE id = ?')
        .bind(responseId)
        .first<{ completion_duration: number | null }>()

      expect(row?.completion_duration, `duration should be NULL for "${label}"`).toBeNull()
    }
  })

  it('stores the correct integer duration when value is valid', async () => {
    const qId = await addQuestion(cookie, surveyId, {
      label: 'Q',
      type: 'short_text',
      sortOrder: 0,
    })
    await publishSurvey(cookie, surveyId)

    const res = await api(`/api/public/survey/${surveySlug}/respond`, {
      method: 'POST',
      ip: '10.0.0.1',
      body: JSON.stringify({
        answers: [{ question_id: qId, value: 'test' }],
        duration: 42,
      }),
    })
    expect(res.status).toBe(201)
    const { responseId } = await res.json<{ responseId: string }>()

    const row = await env.DB.prepare('SELECT completion_duration FROM responses WHERE id = ?')
      .bind(responseId)
      .first<{ completion_duration: number | null }>()

    expect(row?.completion_duration).toBe(42)
  })
})

// ─── TC-EDGE-09 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-09 — Deleted survey slug is no longer publicly accessible', () => {
  it('returns 404 from the public endpoint after the survey is deleted', async () => {
    await addQuestion(cookie, surveyId, {
      label: 'Q',
      type: 'short_text',
      sortOrder: 0,
    })
    await publishSurvey(cookie, surveyId)

    // Confirm it's publicly accessible before deletion.
    const before = await api(`/api/public/survey/${surveySlug}`)
    expect(before.status).toBe(200)

    // Delete the survey.
    await api(`/api/surveys/${surveyId}`, { method: 'DELETE', cookie })

    // Public endpoint must now return 404.
    const after = await api(`/api/public/survey/${surveySlug}`)
    expect(after.status).toBe(404)
  })
})

// ─── TC-EDGE-10 ───────────────────────────────────────────────────────────────

describe('TC-EDGE-10 — Rating answer must be a number', () => {
  it('returns 400 when a string is submitted as a rating value', async () => {
    const { slug, qIds } = await (async () => {
      const { id, slug } = await createSurvey(cookie, 'Rating Survey')
      const qId = await addQuestion(cookie, id, {
        label: 'Rate us',
        type: 'rating',
        sortOrder: 0,
        config: { min: 1, max: 5 },
      })
      await publishSurvey(cookie, id)
      return { id, slug, qIds: [qId] }
    })()

    const res = await api(`/api/public/survey/${slug}/respond`, {
      method: 'POST',
      ip: '10.0.0.1',
      body: JSON.stringify({
        answers: [{ question_id: qIds[0], value: 'five' }], // string, not number
        duration: 1,
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/must be a number/i)
  })
})
