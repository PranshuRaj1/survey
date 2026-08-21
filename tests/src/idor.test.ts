/**
 * src/idor.test.ts
 *
 * WHAT THIS FILE TESTS
 * --------------------
 * Authorisation / Insecure Direct Object Reference (IDOR) — verifies that every
 * endpoint enforces owner-scoped access so User B cannot read, modify, export,
 * or delete User A's surveys and responses.
 *
 * TC IDs COVERED
 * --------------
 * TC-IDOR-01  Fetch another user's survey by ID → 404
 * TC-IDOR-02  Fetch another user's responses → 404
 * TC-IDOR-03  Export CSV for another user's survey → 404
 * TC-IDOR-04  Analytics for another user's survey → 404
 * TC-IDOR-05  PATCH another user's survey → 404
 * TC-IDOR-06  DELETE another user's survey → 404
 * TC-IDOR-07  Public survey endpoint exposes only safe fields (no owner_id etc.)
 * TC-IDOR-08  Draft survey is unreachable via the public URL
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { addQuestion, api, createSurvey, publishSurvey, signupAndLogin } from '../helpers/app'
import { applyMigrations } from '../helpers/db'

// ─── Setup ────────────────────────────────────────────────────────────────────

let cookieA: string
let cookieB: string
let surveyIdA: string
let slugA: string

beforeEach(async () => {
  await applyMigrations(env.DB)

  // User A owns a published survey.
  cookieA = await signupAndLogin('user-a@example.com')
  const survey = await createSurvey(cookieA, 'User A Survey')
  surveyIdA = survey.id
  slugA = survey.slug

  await addQuestion(cookieA, surveyIdA, { label: 'Q1', type: 'short_text' })
  await publishSurvey(cookieA, surveyIdA)

  // User B has no surveys.
  cookieB = await signupAndLogin('user-b@example.com')
})

// ─── TC-IDOR-01 ───────────────────────────────────────────────────────────────

describe("TC-IDOR-01 — Cannot fetch another user's survey by ID", () => {
  it("returns 404 when User B requests User A's survey", async () => {
    const res = await api(`/api/surveys/${surveyIdA}`, { cookie: cookieB })
    expect(res.status).toBe(404)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/not found/i)
  })
})

// ─── TC-IDOR-02 ───────────────────────────────────────────────────────────────

describe("TC-IDOR-02 — Cannot fetch another user's responses", () => {
  it("returns 404 when User B requests User A's response list", async () => {
    const res = await api(`/api/responses/${surveyIdA}`, { cookie: cookieB })
    expect(res.status).toBe(404)
  })
})

// ─── TC-IDOR-03 ───────────────────────────────────────────────────────────────

describe("TC-IDOR-03 — Cannot export CSV for another user's survey", () => {
  it("returns 404 when User B tries to export User A's data", async () => {
    const res = await api(`/api/responses/${surveyIdA}/export`, { cookie: cookieB })
    expect(res.status).toBe(404)
  })
})

// ─── TC-IDOR-04 ───────────────────────────────────────────────────────────────

describe("TC-IDOR-04 — Cannot access analytics for another user's survey", () => {
  it("returns 404 when User B requests User A's analytics", async () => {
    const res = await api(`/api/responses/${surveyIdA}/analytics`, { cookie: cookieB })
    expect(res.status).toBe(404)
  })
})

// ─── TC-IDOR-05 ───────────────────────────────────────────────────────────────

describe("TC-IDOR-05 — Cannot PATCH another user's survey", () => {
  it("returns 404 when User B tries to modify User A's survey", async () => {
    const res = await api(`/api/surveys/${surveyIdA}`, {
      method: 'PATCH',
      cookie: cookieB,
      body: JSON.stringify({ title: 'Hacked Title' }),
    })
    expect(res.status).toBe(404)

    // Confirm the title was NOT changed by fetching it as User A.
    const check = await api(`/api/surveys/${surveyIdA}`, { cookie: cookieA })
    const body = await check.json<{ survey: { title: string } }>()
    expect(body.survey.title).toBe('User A Survey')
  })
})

// ─── TC-IDOR-06 ───────────────────────────────────────────────────────────────

describe("TC-IDOR-06 — Cannot DELETE another user's survey", () => {
  it('returns 404 and survey still exists for User A', async () => {
    const res = await api(`/api/surveys/${surveyIdA}`, {
      method: 'DELETE',
      cookie: cookieB,
    })
    expect(res.status).toBe(404)

    // Survey must still exist for its owner.
    const check = await api(`/api/surveys/${surveyIdA}`, { cookie: cookieA })
    expect(check.status).toBe(200)
  })
})

// ─── TC-IDOR-07 ───────────────────────────────────────────────────────────────

describe('TC-IDOR-07 — Public survey endpoint exposes only safe fields', () => {
  it('does not include owner_id, password_hash, or response data in the response', async () => {
    const res = await api(`/api/public/survey/${slugA}`)
    expect(res.status).toBe(200)

    const body = await res.json<{ survey: Record<string, unknown> }>()
    const keys = Object.keys(body.survey)

    // Must NOT contain sensitive fields.
    expect(keys).not.toContain('owner_id')
    expect(keys).not.toContain('password_hash')
    expect(keys).not.toContain('respondent_ip')

    // Must contain the safe public fields.
    expect(keys).toContain('id')
    expect(keys).toContain('slug')
    expect(keys).toContain('title')
    expect(keys).toContain('brand_color')
    expect(keys).toContain('questions')
  })

  it('does not include deleted_at or response_count in question objects', async () => {
    const res = await api(`/api/public/survey/${slugA}`)
    const body = await res.json<{
      survey: { questions: Array<Record<string, unknown>> }
    }>()

    const question = body.survey.questions[0]
    expect(question).toBeDefined()
    expect(question).not.toHaveProperty('deleted_at')
    expect(question).not.toHaveProperty('response_count')
  })
})

// ─── TC-IDOR-08 ───────────────────────────────────────────────────────────────

describe('TC-IDOR-08 — Draft survey is unreachable via the public URL', () => {
  it('returns 404 for a draft survey slug', async () => {
    // Create a new survey — default status is "draft".
    const draftCookie = await signupAndLogin('drafter@example.com')
    const draft = await createSurvey(draftCookie, 'Draft Survey')

    const res = await api(`/api/public/survey/${draft.slug}`)
    expect(res.status).toBe(404)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/not published/i)
  })
})
