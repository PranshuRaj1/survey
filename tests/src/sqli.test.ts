/**
 * src/sqli.test.ts
 *
 * WHAT THIS FILE TESTS
 * --------------------
 * SQL injection resistance — verifies that all user-controlled input is passed
 * through D1's prepared statement parameterisation and never interpolated
 * directly into SQL strings.
 *
 * TC IDs COVERED
 * --------------
 * TC-SQLI-01  SQL injection via email field (signup/login)
 * TC-SQLI-02  SQL injection via survey title
 * TC-SQLI-03  SQL injection via config_json logic condition value
 * TC-SQLI-04  Dynamic IN (...) clause with 0 responses (correct early-exit guard)
 * TC-SQLI-05  Dynamic SET clause in survey PATCH (only whitelisted column names)
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { addQuestion, api, createSurvey, signupAndLogin } from '../helpers/app'
import { applyMigrations } from '../helpers/db'

// ─── Setup ────────────────────────────────────────────────────────────────────

let cookie: string
let surveyId: string

beforeEach(async () => {
  await applyMigrations(env.DB)
  cookie = await signupAndLogin('sqli@example.com')
  const s = await createSurvey(cookie, 'SQLi Test Survey')
  surveyId = s.id
})

// ─── TC-SQLI-01 ───────────────────────────────────────────────────────────────

describe('TC-SQLI-01 — SQL injection via email field', () => {
  const injections = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    '" OR ""="',
    "admin'--",
    "' UNION SELECT id, email, password_hash FROM users --",
  ]

  for (const payload of injections) {
    it(`signup with email="${payload}" is rejected by email validation (not DB error)`, async () => {
      const res = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: payload, password: 'Password123!' }),
      })

      // Email regex rejects these before they reach D1.
      expect(res.status).toBe(400)

      // D1 tables must still exist — injection did not corrupt the schema.
      const userCount = await env.DB.prepare('SELECT COUNT(*) as c FROM users').first<{
        c: number
      }>()
      expect(userCount?.c).toBeGreaterThanOrEqual(0)
    })

    it(`login with email="${payload}" is rejected safely`, async () => {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: payload, password: 'Password123!' }),
      })

      expect(res.status).toBe(400)
    })
  }
})

// ─── TC-SQLI-02 ───────────────────────────────────────────────────────────────

describe('TC-SQLI-02 — SQL injection via survey title', () => {
  it('stores the injection payload as a literal title string', async () => {
    const maliciousTitle = "'; DROP TABLE surveys; --"

    const res = await api('/api/surveys', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ title: maliciousTitle }),
    })

    expect(res.status).toBe(201)

    // The title must be stored verbatim — no DROP executed.
    const row = await env.DB.prepare(
      'SELECT title FROM surveys WHERE owner_id IN (SELECT id FROM users WHERE email = ?)',
    )
      .bind('sqli@example.com')
      .all<{ title: string }>()

    const titles = row.results.map((r: { title: string }) => r.title)
    expect(titles).toContain(maliciousTitle)

    // surveys table still exists.
    const count = await env.DB.prepare('SELECT COUNT(*) as c FROM surveys').first<{ c: number }>()
    expect(count?.c).toBeGreaterThanOrEqual(1)
  })

  it('PATCH title with injection payload is stored safely', async () => {
    const inject = "1' OR '1'='1"
    const res = await api(`/api/surveys/${surveyId}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ title: inject }),
    })

    expect(res.status).toBe(200)
    const body = await res.json<{ survey: { title: string } }>()
    expect(body.survey.title).toBe(inject)
  })
})

// ─── TC-SQLI-03 ───────────────────────────────────────────────────────────────

describe('TC-SQLI-03 — SQL injection via logic condition value in config_json', () => {
  it('stores the injection payload verbatim in config_json without executing SQL', async () => {
    const q1Id = await addQuestion(cookie, surveyId, {
      label: 'Q1',
      type: 'short_text',
      sortOrder: 0,
    })

    const injectedValue = "' UNION SELECT password_hash FROM users --"

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
            config: {},
          },
          {
            type: 'short_text',
            label: 'Q2 with malicious logic value',
            sort_order: 1,
            required: false,
            config: {
              logic: {
                action: 'show',
                strategy: 'all',
                conditions: [
                  {
                    question_id: q1Id,
                    operator: 'equals',
                    value: injectedValue,
                  },
                ],
              },
            },
          },
        ],
      }),
    })

    expect(res.status).toBe(200)

    // Retrieve config_json from DB and confirm value is stored literally.
    const qRow = await env.DB.prepare(
      "SELECT config_json FROM questions WHERE survey_id = ? AND label = 'Q2 with malicious logic value'",
    )
      .bind(surveyId)
      .first<{ config_json: string }>()

    expect(qRow).not.toBeNull()
    const config = JSON.parse(qRow?.config_json ?? '{}')
    expect(config.logic.conditions[0].value).toBe(injectedValue)

    // users table still intact.
    const userCount = await env.DB.prepare('SELECT COUNT(*) as c FROM users').first<{ c: number }>()
    expect(userCount?.c).toBeGreaterThanOrEqual(1)
  })
})

// ─── TC-SQLI-04 ───────────────────────────────────────────────────────────────

describe('TC-SQLI-04 — Dynamic IN (...) clause is guarded when responses list is empty', () => {
  /**
   * The responses route builds:
   *   WHERE ra.response_id IN (${placeholders})
   * using responseIds.map(). If the survey has 0 responses the code returns early
   * (before this query is reached) via:
   *   if (responses.results.length === 0) return c.json({...})
   *
   * This test confirms that the early-return path executes correctly.
   */
  it('GET /api/responses/:id returns empty array without SQL error when 0 responses exist', async () => {
    const res = await api(`/api/responses/${surveyId}`, { cookie })
    expect(res.status).toBe(200)
    const body = await res.json<{ responses: unknown[]; total: number }>()
    expect(body.responses).toHaveLength(0)
    expect(body.total).toBe(0)
  })
})

// ─── TC-SQLI-05 ───────────────────────────────────────────────────────────────

describe('TC-SQLI-05 — Dynamic SET clause in survey PATCH uses only whitelisted column names', () => {
  /**
   * The PATCH handler builds:
   *   UPDATE surveys SET ${fields.join(', ')} WHERE id = ?
   * where `fields` is populated only with hard-coded strings like 'title = ?',
   * never from user input. User values only reach DB as bind parameters.
   *
   * This test verifies correct behaviour by sending unexpected extra keys in
   * the body and confirming they are silently ignored.
   */
  it('ignores unknown body keys and only updates whitelisted fields', async () => {
    const res = await api(`/api/surveys/${surveyId}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({
        title: 'Legitimate Title',
        // These keys are not whitelisted and must be ignored:
        owner_id: 'attacker-id',
        status: 'published', // this IS whitelisted but needs questions to publish
        injected_column: 'injected_value',
      }),
    })

    // 400 because we're trying to publish without questions.
    // The important thing: no SQL error and owner_id was not changed.
    expect([200, 400]).toContain(res.status)

    const row = await env.DB.prepare('SELECT owner_id, title FROM surveys WHERE id = ?')
      .bind(surveyId)
      .first<{ owner_id: string; title: string }>()

    // owner_id must NOT be changed to 'attacker-id'.
    expect(row?.owner_id).not.toBe('attacker-id')
  })
})
