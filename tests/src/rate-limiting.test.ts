/**
 * src/rate-limiting.test.ts
 *
 * WHAT THIS FILE TESTS
 * --------------------
 * Rate limiting — verifies the KV-backed per-IP per-survey submission throttle,
 * the visit-count cookie lock, and the IP-based bot lock. Also documents the
 * known gap where the login endpoint has no rate limiting.
 *
 * TC IDs COVERED
 * --------------
 * TC-RATE-01  Response submission rate limit (10 per hour per IP per survey)
 * TC-RATE-02  Rate limit counter persists across requests within the same hour
 * TC-RATE-03  Rate limit is per-survey, not global — different survey is not blocked
 * TC-RATE-04  Visit cookie lock — same visitor_id only counts once in 30 min
 * TC-RATE-05  Visit IP lock — requests without a cookie from non-local IP are locked
 * TC-RATE-06  [GAP] Login endpoint has no rate limiting (documented current behaviour)
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { addQuestion, api, createSurvey, publishSurvey, signupAndLogin } from '../helpers/app'
import { applyMigrations } from '../helpers/db'

// ─── Setup ────────────────────────────────────────────────────────────────────

let cookie: string
let surveyIdA: string
let slugA: string
let slugB: string
let questionIdA: string

beforeEach(async () => {
  await applyMigrations(env.DB)
  cookie = await signupAndLogin('ratelimit@example.com')

  // Survey A — used for rate limit exhaustion.
  const sA = await createSurvey(cookie, 'Rate Limit Survey A')
  surveyIdA = sA.id
  slugA = sA.slug
  questionIdA = await addQuestion(cookie, surveyIdA, {
    label: 'Q1',
    type: 'short_text',
    sortOrder: 0,
  })
  await publishSurvey(cookie, surveyIdA)

  // Survey B — used to confirm the limit is per-survey.
  const sB = await createSurvey(cookie, 'Rate Limit Survey B')
  slugB = sB.slug
  await addQuestion(cookie, sB.id, {
    label: 'Q1',
    type: 'short_text',
    sortOrder: 0,
  })
  await publishSurvey(cookie, sB.id)
})

// ─── Shared submission helper ─────────────────────────────────────────────────

async function submitTo(slug: string, questionId: string, ip: string): Promise<Response> {
  return api(`/api/public/survey/${slug}/respond`, {
    method: 'POST',
    ip,
    body: JSON.stringify({
      answers: [{ question_id: questionId, value: 'test' }],
      duration: 1,
    }),
  })
}

// ─── TC-RATE-01 ───────────────────────────────────────────────────────────────

describe('TC-RATE-01 — Response submission rate limit: 10 per IP per survey per hour', () => {
  it('allows the first 10 submissions and blocks the 11th with 429', async () => {
    const EXTERNAL_IP = '203.0.113.1'

    // Requests 1–10 must succeed.
    for (let i = 0; i < 10; i++) {
      const res = await submitTo(slugA, questionIdA, EXTERNAL_IP)
      expect(res.status).toBe(201)
    }

    // Request 11 must be throttled.
    const res11 = await submitTo(slugA, questionIdA, EXTERNAL_IP)
    expect(res11.status).toBe(429)
    const body = await res11.json<{ error: string }>()
    expect(body.error).toMatch(/too many/i)
  })
})

// ─── TC-RATE-02 ───────────────────────────────────────────────────────────────

describe('TC-RATE-02 — Rate limit counter accumulates correctly', () => {
  it('5 + 5 submissions from the same IP total 10 and the 11th is blocked', async () => {
    const IP = '203.0.113.2'

    // First batch of 5.
    for (let i = 0; i < 5; i++) {
      await submitTo(slugA, questionIdA, IP)
    }

    // Second batch of 5.
    for (let i = 0; i < 5; i++) {
      const res = await submitTo(slugA, questionIdA, IP)
      expect(res.status).toBe(201)
    }

    // 11th must be blocked.
    const res11 = await submitTo(slugA, questionIdA, IP)
    expect(res11.status).toBe(429)
  })
})

// ─── TC-RATE-03 ───────────────────────────────────────────────────────────────

describe('TC-RATE-03 — Rate limit is scoped per survey', () => {
  it("exhausting Survey A's limit does not block Survey B", async () => {
    const IP = '203.0.113.3'

    // Exhaust Survey A.
    for (let i = 0; i < 10; i++) {
      await submitTo(slugA, questionIdA, IP)
    }
    const blockedA = await submitTo(slugA, questionIdA, IP)
    expect(blockedA.status).toBe(429)

    // Survey B — fetch its question id first.
    const pubRes = await api(`/api/public/survey/${slugB}`)
    const pubBody = await pubRes.json<{
      survey: { questions: Array<{ id: string }> }
    }>()
    const qIdB = pubBody.survey.questions[0]?.id ?? ''
    expect(qIdB).not.toBe('')

    // Submit to Survey B — must still succeed.
    const resB = await submitTo(slugB, qIdB, IP)
    expect(resB.status).toBe(201)
  })
})

// ─── TC-RATE-04 ───────────────────────────────────────────────────────────────

describe('TC-RATE-04 — Visit cookie lock prevents duplicate visit counts', () => {
  it('two visit requests with the same visitor_id only increment the counter once', async () => {
    const VISITOR_COOKIE = 'visitor_id=test-uuid-abc-123'

    // First visit.
    const res1 = await api(`/api/public/survey/${slugA}/visit`, {
      method: 'POST',
      ip: '10.0.0.1', // local IP so IP-lock is skipped
      headers: { Cookie: VISITOR_COOKIE },
    })
    expect(res1.status).toBe(200)

    // Second visit with same cookie (within 30 min lock window).
    const res2 = await api(`/api/public/survey/${slugA}/visit`, {
      method: 'POST',
      ip: '10.0.0.1',
      headers: { Cookie: VISITOR_COOKIE },
    })
    expect(res2.status).toBe(200)

    // Visit count in KV must be exactly 1.
    const count = await env.KV.get(`visits:${surveyIdA}`)
    expect(count).toBe('1')
  })
})

// ─── TC-RATE-05 ───────────────────────────────────────────────────────────────

describe('TC-RATE-05 — Visit IP lock blocks script flooding from non-local IPs', () => {
  it('only the first cookieless visit from an external IP increments the counter', async () => {
    const EXTERNAL_IP = '203.0.113.10'

    // First cookieless visit from the external IP.
    const res1 = await api(`/api/public/survey/${slugA}/visit`, {
      method: 'POST',
      ip: EXTERNAL_IP,
      // No Cookie header → no visitor_id → IP lock logic kicks in.
    })
    expect(res1.status).toBe(200)

    // Subsequent visits from the same IP (within 30 min) must NOT increment.
    for (let i = 0; i < 4; i++) {
      const res = await api(`/api/public/survey/${slugA}/visit`, {
        method: 'POST',
        ip: EXTERNAL_IP,
      })
      expect(res.status).toBe(200)
    }

    // Counter must still be exactly 1.
    const count = await env.KV.get(`visits:${surveyIdA}`)
    expect(count).toBe('1')
  })
})

// ─── TC-RATE-06 ───────────────────────────────────────────────────────────────

describe('TC-RATE-06 — [KNOWN GAP] Login endpoint has no rate limiting', () => {
  /**
   * SECURITY GAP: /api/auth/login performs no throttling.
   * An attacker can enumerate passwords at full speed.
   *
   * This test verifies the CURRENT behaviour (all requests pass through)
   * and documents the expected fix: add per-IP KV rate limiting similar to
   * the one on /api/public/survey/:slug/respond.
   *
   * @todo Implement rate limiting on the login endpoint.
   */
  it('allows 15 rapid login attempts without any 429 response', async () => {
    await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'target@example.com', password: 'RealPass123!' }),
    })

    const responses = await Promise.all(
      Array.from({ length: 15 }, () =>
        api('/api/auth/login', {
          method: 'POST',
          ip: '203.0.113.99',
          body: JSON.stringify({
            email: 'target@example.com',
            password: 'WrongPass!',
          }),
        }),
      ),
    )

    // All 15 must return 401 — NONE 429. This documents the gap.
    const statuses = responses.map((r) => r.status)
    expect(statuses.every((s) => s === 401)).toBe(true)
  })
})
