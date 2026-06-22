import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { generateId } from '../lib/crypto'
import type { AppContext } from '../types'

export const publicRoutes = new Hono<AppContext>()

publicRoutes.get('/survey/:slug', async (c) => {
  const slug = c.req.param('slug')

  // Set visitor cookie if missing, even for cached responses (so real browsers carry it on the subsequent POST /visit request)
  let visitorId = getCookie(c, 'visitor_id')
  if (!visitorId) {
    visitorId = crypto.randomUUID()
    setCookie(c, 'visitor_id', visitorId, {
      maxAge: 60 * 60 * 24 * 365, // 1 year
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    })
  }

  const cacheKey = `survey:${slug}`
  const cached = (await c.env.KV.get(cacheKey, 'json')) as { survey: { id: string } } | null

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
     WHERE survey_id = ? AND deleted_at IS NULL
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

publicRoutes.post('/survey/:slug/visit', async (c) => {
  const slug = c.req.param('slug')
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown'

  // Retrieve survey ID only - minimal query to avoid loading questions or configs
  const survey = await c.env.DB.prepare(
    "SELECT id FROM surveys WHERE slug = ? AND status = 'published'",
  )
    .bind(slug)
    .first<{ id: string }>()

  if (!survey) {
    return c.json({ error: 'Survey not found or not published' }, 404)
  }

  // 1. Read or generate first-party httpOnly visitor ID cookie to handle CGNAT/unique visits.
  let visitorId = getCookie(c, 'visitor_id')
  const hasCookie = !!visitorId

  if (!visitorId) {
    visitorId = crypto.randomUUID()
    setCookie(c, 'visitor_id', visitorId, {
      maxAge: 60 * 60 * 24 * 365, // 1 year
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    })
  }

  // 2. Check browser session-based unique visit lock (30 minutes)
  const cookieLockKey = `visit_cookie_lock:${survey.id}:${visitorId}`
  const cookieLocked = await c.env.KV.get(cookieLockKey)

  if (cookieLocked) {
    return c.json({ ok: true })
  }

  // 3. If the client did not send a cookie (e.g. a crawler/bot script), enforce a coarse 30-minute IP-based lock
  // to block automated visit inflation from a single IP. Real browsers bypass this lock because they get a
  // cookie on their very first request (during GET /survey/:slug).
  const isLocal =
    ip === 'unknown' ||
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.16.')
  if (!hasCookie && !isLocal) {
    const ipLockKey = `visit_ip_lock:${survey.id}:${ip}`
    const ipLocked = await c.env.KV.get(ipLockKey)
    if (ipLocked) {
      return c.json({ ok: true })
    }
    // Lock the IP for 30 minutes (1800 seconds) to block script crawlers
    await c.env.KV.put(ipLockKey, '1', { expirationTtl: 1800 })
  }

  // 4. Mark cookie locked (30 minutes) and increment visit count
  await c.env.KV.put(cookieLockKey, '1', { expirationTtl: 1800 })

  const countKey = `visits:${survey.id}`
  const current = await c.env.KV.get(countKey)
  const next = current ? parseInt(current, 10) + 1 : 1
  await c.env.KV.put(countKey, String(next))

  return c.json({ ok: true })
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

  let body: { answers: Array<{ question_id: string; value: unknown }>; duration?: unknown }
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

  // Optional: completion duration in seconds (must be a positive integer if provided)
  const duration =
    typeof body.duration === 'number' && Number.isInteger(body.duration) && body.duration > 0
      ? body.duration
      : null

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
    `SELECT id, type, label, required, config_json, sort_order FROM questions WHERE survey_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC`,
  )
    .bind(survey.id)
    .all<{
      id: string
      type: string
      label: string
      required: number
      config_json: string
      sort_order: number
    }>()

  const questionMap = new Map(questions.results.map((q) => [q.id, q]))
  const submittedMap = new Map(body.answers.map((a) => [a.question_id, a.value]))

  // 1. Check if any submitted question ID is invalid (doesn't belong to the survey)
  for (const answer of body.answers) {
    if (!questionMap.has(answer.question_id)) {
      return c.json({ error: `Invalid question_id: ${answer.question_id}` }, 400)
    }
  }

  // Helper to evaluate a logic condition
  const evaluateCondition = (answerVal: any, operator: string, targetVal: any): boolean => {
    if (operator === 'filled')
      return answerVal !== undefined && answerVal !== null && answerVal !== ''
    if (operator === 'empty')
      return answerVal === undefined || answerVal === null || answerVal === ''
    if (answerVal === undefined || answerVal === null) return false

    switch (operator) {
      case 'equals':
        return String(answerVal) === String(targetVal)
      case 'not_equals':
        return String(answerVal) !== String(targetVal)
      case 'contains':
        return String(answerVal).toLowerCase().includes(String(targetVal).toLowerCase())
      case 'greater_than':
        return Number(answerVal) > Number(targetVal)
      case 'less_than':
        return Number(answerVal) < Number(targetVal)
      default:
        return false
    }
  }

  // Determine which questions are actually visible (Fix 1, 2)
  const visibleQuestionIds = new Set<string>()
  for (const q of questions.results) {
    let config: any = {}
    try {
      config = JSON.parse(q.config_json)
    } catch {}

    if (!config.logic) {
      visibleQuestionIds.add(q.id)
      continue
    }

    const { action, strategy, conditions } = config.logic
    if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
      visibleQuestionIds.add(q.id)
      continue
    }

    let matches = strategy === 'all'
    for (const cond of conditions) {
      const triggerVal = visibleQuestionIds.has(cond.question_id)
        ? submittedMap.get(cond.question_id)
        : undefined
      const condMet = evaluateCondition(triggerVal, cond.operator, cond.value)

      if (strategy === 'all') {
        matches = matches && condMet
      } else {
        matches = matches || condMet
      }
    }

    const isVisible = action === 'show' ? matches : !matches
    if (isVisible) {
      visibleQuestionIds.add(q.id)
    }
  }

  // Filter submitted answers to only keep visible ones (Fix 6)
  const visibleAnswers = body.answers.filter((a) => visibleQuestionIds.has(a.question_id))

  // 2. Check for required questions (only on visible ones!)
  for (const q of questions.results) {
    if (!visibleQuestionIds.has(q.id)) continue
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

  // 3. Validate specific question types for visible answers
  for (const answer of visibleAnswers) {
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

  // Insert the parent response + visible answers atomically in a single D1 batch
  // so a failure in any answer write rolls back the entire submission.
  const responseId = generateId()

  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO responses (id, survey_id, respondent_ip, completion_duration) VALUES (?, ?, ?, ?)`,
    ).bind(responseId, survey.id, ip, duration),
    ...visibleAnswers.map((a) =>
      c.env.DB.prepare(
        `INSERT INTO response_answers (id, response_id, question_id, value_json)
         VALUES (?, ?, ?, ?)`,
      ).bind(generateId(), responseId, a.question_id, JSON.stringify(a.value)),
    ),
  ]

  await c.env.DB.batch(stmts)

  return c.json({ success: true, responseId }, 201)
})
