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

  const ip =
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For') ??
    'unknown'

  const rateLimitKey = `ratelimit:${ip}`
  const current = await c.env.KV.get(rateLimitKey)
  const count = current ? parseInt(current) : 0

  if (count >= 10) {
    return c.json({ error: 'Too many submissions. Try again later.' }, 429)
  }

  await c.env.KV.put(rateLimitKey, String(count + 1), { expirationTtl: 60 * 60 })

  const survey = await c.env.DB.prepare(
    `SELECT id FROM surveys WHERE slug = ? AND status = 'published'`,
  )
    .bind(slug)
    .first<{ id: string }>()

  if (!survey) {
    return c.json({ error: 'Survey not found or not published' }, 404)
  }

  const body = await c.req.json<{
    answers: Array<{ question_id: string; value: unknown }>
  }>()

  if (!body.answers || !Array.isArray(body.answers)) {
    return c.json({ error: 'answers array is required' }, 400)
  }

  const responseId = generateId()

  await c.env.DB.prepare(
    `INSERT INTO responses (id, survey_id, respondent_ip) VALUES (?, ?, ?)`,
  )
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