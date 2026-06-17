import { Hono } from 'hono'
import { generateId } from '../lib/crypto'
import type { AppContext } from '../types'

export const publicRoutes = new Hono<AppContext>()

publicRoutes.get('/survey/:slug', async (c) => {
  const slug = c.req.param('slug')

  const cacheKey = `survey:${slug}`
  const cached = await c.env.KV.get(cacheKey, 'json')
  if (cached) {
    return c.json(cached)
  }

  const survey = await c.env.DB.prepare(
    `SELECT id, slug, title, brand_color, logo_url, font_family
     FROM surveys
     WHERE slug = ? AND status = 'published'`,
  )
    .bind(slug)
    .first<{
      id: string
      slug: string
      title: string
      brand_color: string
      logo_url: string | null
      font_family: string
    }>()

  if (!survey) {
    return c.json({ error: 'Survey not found or not published' }, 404)
  }

  const questions = await c.env.DB.prepare(
    `SELECT id, type, label, sort_order, required, config_json
     FROM questions
     WHERE survey_id = ?
     ORDER BY sort_order ASC`,
  )
    .bind(survey.id)
    .all<{
      id: string
      type: string
      label: string
      sort_order: number
      required: number
      config_json: string
    }>()

  const result = {
    survey: {
      ...survey,
      questions: questions.results.map((q) => ({
        id: q.id,
        type: q.type,
        label: q.label,
        sort_order: q.sort_order,
        required: q.required === 1,
        config: JSON.parse(q.config_json),
      })),
    },
  }

  await c.env.KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 })

  return c.json(result)
})

publicRoutes.post('/survey/:slug/respond', async (c) => {
  const slug = c.req.param('slug')

  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown'

  const survey = await c.env.DB.prepare(
    `SELECT id FROM surveys WHERE slug = ? AND status = 'published'`,
  )
    .bind(slug)
    .first<{ id: string }>()

  if (!survey) {
    return c.json({ error: 'Survey not found or not published' }, 404)
  }

  const rateLimitKey = `ratelimit:${survey.id}:${ip}`
  const current = await c.env.KV.get(rateLimitKey)
  const count = current ? parseInt(current, 10) : 0

  if (count >= 10) {
    return c.json({ error: 'Too many submissions. Try again later.' }, 429)
  }

  await c.env.KV.put(rateLimitKey, String(count + 1), { expirationTtl: 60 * 60 })

  let body: { answers: Array<{ question_id: string; value: unknown }> }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (!body.answers || !Array.isArray(body.answers)) {
    return c.json({ error: 'answers array is required' }, 400)
  }

  const seenQuestions = new Set<string>()
  for (const a of body.answers) {
    if (!a || typeof a !== 'object') {
      return c.json({ error: 'Each answer in the answers array must be a valid object' }, 400)
    }
    if (typeof a.question_id !== 'string') {
      return c.json({ error: 'question_id must be a string' }, 400)
    }
    if (seenQuestions.has(a.question_id)) {
      return c.json({ error: 'Duplicate answer for the same question is not allowed' }, 400)
    }
    seenQuestions.add(a.question_id)
  }

  const questions = await c.env.DB.prepare(
    `SELECT id, type, label, required, config_json FROM questions WHERE survey_id = ?`,
  )
    .bind(survey.id)
    .all<{ id: string; type: string; label: string; required: number; config_json: string }>()

  const questionMap = new Map(questions.results.map((q) => [q.id, q]))
  const submittedMap = new Map(body.answers.map((a) => [a.question_id, a.value]))

  // 1. Check if any submitted question ID is invalid (doesn't belong to the survey)
  for (const answer of body.answers) {
    if (!questionMap.has(answer.question_id)) {
      return c.json({ error: `Invalid question_id: ${answer.question_id}` }, 400)
    }
  }

  // 2. Check for required questions
  for (const q of questions.results) {
    const isRequired = q.required === 1
    if (isRequired) {
      const val = submittedMap.get(q.id)
      if (
        val === undefined ||
        val === null ||
        val === '' ||
        (Array.isArray(val) && val.length === 0)
      ) {
        return c.json({ error: `Question "${q.label}" is required` }, 400)
      }
    }
  }

  // 3. Validate specific question types
  for (const answer of body.answers) {
    const q = questionMap.get(answer.question_id)
    if (!q) continue
    const val = answer.value

    if (val === undefined || val === null || val === '') continue

    if (q.type === 'multiple_choice') {
      try {
        const config = JSON.parse(q.config_json) as { options?: string[] }
        if (config?.options && Array.isArray(config.options)) {
          const allowed = new Set(config.options)
          const submitted = Array.isArray(val) ? val : [val]
          for (const s of submitted) {
            if (typeof s !== 'string' || !allowed.has(s)) {
              return c.json({ error: `Invalid choice "${s}" for question "${q.label}"` }, 400)
            }
          }
        }
      } catch {
        // Safe fallback if config_json is malformed
      }
    } else if (q.type === 'rating') {
      if (typeof val !== 'number') {
        return c.json({ error: `Rating for question "${q.label}" must be a number` }, 400)
      }
      try {
        const config = JSON.parse(q.config_json) as { min?: number; max?: number }
        const min = config?.min ?? 1
        const max = config?.max ?? 5
        if (val < min || val > max) {
          return c.json(
            { error: `Rating for question "${q.label}" must be between ${min} and ${max}` },
            400,
          )
        }
      } catch {}
    }
  }

  const responseId = generateId()

  await c.env.DB.prepare(`INSERT INTO responses (id, survey_id, respondent_ip) VALUES (?, ?, ?)`)
    .bind(responseId, survey.id, ip)
    .run()

  const stmts = body.answers.map((a) =>
    c.env.DB.prepare(
      `INSERT INTO response_answers (id, response_id, question_id, value_json)
       VALUES (?, ?, ?, ?)`,
    ).bind(generateId(), responseId, a.question_id, JSON.stringify(a.value)),
  )

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts)
  }

  return c.json({ success: true, responseId }, 201)
})