import { Hono } from 'hono'
import { generateId, generateSlug } from '../lib/crypto'
import { authMiddleware } from '../middleware/auth'
import type { AppContext } from '../types'

export const surveyRoutes = new Hono<AppContext>()

surveyRoutes.use('*', authMiddleware)

surveyRoutes.get('/', async (c) => {
  const userId = c.get('userId')

  const surveys = await c.env.DB.prepare(
    `SELECT id, slug, title, status, brand_color, logo_url, created_at, updated_at
     FROM surveys
     WHERE owner_id = ?
     ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all<{
      id: string
      slug: string
      title: string
      status: string
      brand_color: string
      logo_url: string | null
      created_at: number
      updated_at: number
    }>()

  const counts = await c.env.DB.prepare(
    `SELECT survey_id, COUNT(*) as count
     FROM responses
     WHERE survey_id IN (SELECT id FROM surveys WHERE owner_id = ?)
     GROUP BY survey_id`,
  )
    .bind(userId)
    .all<{ survey_id: string; count: number }>()

  const countMap = Object.fromEntries(counts.results.map((r) => [r.survey_id, r.count]))

  const result = surveys.results.map((s) => ({
    ...s,
    response_count: countMap[s.id] ?? 0,
  }))

  return c.json({ surveys: result })
})

surveyRoutes.get('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const survey = await c.env.DB.prepare(
    `SELECT id, slug, title, status, brand_color, logo_url, font_family, created_at, updated_at
     FROM surveys
     WHERE id = ? AND owner_id = ?`,
  )
    .bind(id, userId)
    .first<{
      id: string
      slug: string
      title: string
      status: string
      brand_color: string
      logo_url: string | null
      font_family: string
      created_at: number
      updated_at: number
    }>()

  if (!survey) {
    return c.json({ error: 'Survey not found' }, 404)
  }

  const questions = await c.env.DB.prepare(
    `SELECT q.id, q.type, q.label, q.sort_order, q.required, q.config_json, q.deleted_at, q.created_at,
            (SELECT COUNT(*) FROM response_answers ra WHERE ra.question_id = q.id) as response_count
     FROM questions q
     WHERE q.survey_id = ?
     ORDER BY q.sort_order ASC`,
  )
    .bind(id)
    .all<{
      id: string
      type: string
      label: string
      sort_order: number
      required: number
      config_json: string
      deleted_at: number | null
      created_at: number
      response_count: number
    }>()

  const parsedQuestions = questions.results.map((q) => ({
    ...q,
    required: q.required === 1,
    config: JSON.parse(q.config_json),
  }))

  return c.json({ survey: { ...survey, questions: parsedQuestions } })
})

surveyRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  let body: { title?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (body.title !== undefined && typeof body.title !== 'string') {
    return c.json({ error: 'Title must be a string' }, 400)
  }

  const title = body.title?.trim() || 'Untitled survey'
  const id = generateId()
  const slug = generateSlug(title)

  await c.env.DB.prepare(
    `INSERT INTO surveys (id, owner_id, slug, title)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(id, userId, slug, title)
    .run()

  const survey = await c.env.DB.prepare('SELECT * FROM surveys WHERE id = ?').bind(id).first()

  return c.json({ survey }, 201)
})

surveyRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    'SELECT id, slug, status FROM surveys WHERE id = ? AND owner_id = ?',
  )
    .bind(id, userId)
    .first<{ id: string; slug: string; status: string }>()

  if (!existing) {
    return c.json({ error: 'Survey not found' }, 404)
  }

  let body: {
    title?: string
    brand_color?: string
    logo_url?: string
    font_family?: string
    status?: string
    questions?: Array<{
      id?: string
      type: string
      label: string
      sort_order: number
      required?: boolean
      config?: Record<string, unknown>
      deleted_at?: number | null
      created_at?: number
    }>
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (body.title !== undefined && typeof body.title !== 'string') {
    return c.json({ error: 'Title must be a string' }, 400)
  }
  if (body.brand_color !== undefined) {
    if (typeof body.brand_color !== 'string') {
      return c.json({ error: 'Brand color must be a string' }, 400)
    }
    const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
    if (!hexColorRegex.test(body.brand_color)) {
      return c.json({ error: 'Brand color must be a valid hex color code (e.g., #ffffff)' }, 400)
    }
  }
  if (body.logo_url !== undefined && body.logo_url !== null && typeof body.logo_url !== 'string') {
    return c.json({ error: 'Logo URL must be a string' }, 400)
  }
  if (body.font_family !== undefined && typeof body.font_family !== 'string') {
    return c.json({ error: 'Font family must be a string' }, 400)
  }
  if (
    body.status !== undefined &&
    (typeof body.status !== 'string' || !['draft', 'published'].includes(body.status))
  ) {
    return c.json({ error: 'Status must be "draft" or "published"' }, 400)
  }
  if (body.questions !== undefined) {
    if (!Array.isArray(body.questions)) {
      return c.json({ error: 'Questions must be an array' }, 400)
    }
    for (const q of body.questions) {
      if (!q || typeof q !== 'object') {
        return c.json({ error: 'Each question must be a valid object' }, 400)
      }
      if (q.id !== undefined && typeof q.id !== 'string') {
        return c.json({ error: 'Question id must be a string' }, 400)
      }
      if (
        typeof q.type !== 'string' ||
        !['short_text', 'long_text', 'multiple_choice', 'rating', 'date'].includes(q.type)
      ) {
        return c.json({ error: `Invalid question type: ${q?.type}` }, 400)
      }
      if (typeof q.label !== 'string' || q.label.trim() === '') {
        return c.json({ error: 'Question label is required and must be a non-empty string' }, 400)
      }
      if (q.sort_order !== undefined && typeof q.sort_order !== 'number') {
        return c.json({ error: 'Question sort_order must be a number' }, 400)
      }
      if (q.required !== undefined && typeof q.required !== 'boolean') {
        return c.json({ error: 'Question required must be a boolean' }, 400)
      }
      if (q.config !== undefined && (typeof q.config !== 'object' || q.config === null)) {
        return c.json({ error: 'Question config must be a valid object' }, 400)
      }
      if (q.deleted_at !== undefined && q.deleted_at !== null && typeof q.deleted_at !== 'number') {
        return c.json({ error: 'Question deleted_at must be a number or null' }, 400)
      }
      if (q.created_at !== undefined && typeof q.created_at !== 'number') {
        return c.json({ error: 'Question created_at must be a number' }, 400)
      }
    }
  }

  const isPublished =
    body.status === 'published' || (body.status === undefined && existing.status === 'published')
  if (isPublished) {
    if (body.questions !== undefined) {
      const activeQs = body.questions.filter(
        (q) => q.deleted_at === undefined || q.deleted_at === null,
      )
      if (activeQs.length === 0) {
        return c.json({ error: 'Cannot publish a survey with no questions' }, 400)
      }
      for (const q of activeQs) {
        if (q.type === 'multiple_choice') {
          const opts = q.config?.options
          if (!Array.isArray(opts) || opts.length === 0) {
            return c.json({ error: 'Multiple choice questions need at least one option' }, 400)
          }
        }
      }
    } else {
      const existingQs = await c.env.DB.prepare(
        'SELECT type, config_json FROM questions WHERE survey_id = ? AND deleted_at IS NULL',
      )
        .bind(id)
        .all<{ type: string; config_json: string }>()

      if (existingQs.results.length === 0) {
        return c.json({ error: 'Cannot publish a survey with no questions' }, 400)
      }
      for (const q of existingQs.results) {
        if (q.type === 'multiple_choice') {
          let config: any = {}
          try {
            config = JSON.parse(q.config_json)
          } catch {}
          if (!Array.isArray(config.options) || config.options.length === 0) {
            return c.json({ error: 'Multiple choice questions need at least one option' }, 400)
          }
        }
      }
    }
  }

  const fields: string[] = []
  const values: unknown[] = []

  if (body.title !== undefined) {
    fields.push('title = ?')
    values.push(body.title.trim())
  }
  if (body.brand_color !== undefined) {
    fields.push('brand_color = ?')
    values.push(body.brand_color)
  }
  if (body.logo_url !== undefined) {
    fields.push('logo_url = ?')
    values.push(body.logo_url)
  }
  if (body.font_family !== undefined) {
    fields.push('font_family = ?')
    values.push(body.font_family)
  }
  if (body.status !== undefined) {
    fields.push('status = ?')
    values.push(body.status)
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?')
    values.push(Math.floor(Date.now() / 1000))
    values.push(id)

    await c.env.DB.prepare(`UPDATE surveys SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run()
  }

  if (body.questions !== undefined) {
    const existingQuestions = await c.env.DB.prepare(
      'SELECT id, deleted_at FROM questions WHERE survey_id = ?',
    )
      .bind(id)
      .all<{ id: string; deleted_at: number | null }>()

    const existingIds = existingQuestions.results.map((q) => q.id)
    const activeIds = existingQuestions.results
      .filter((q) => q.deleted_at === null)
      .map((q) => q.id)
    const incomingActiveIds = body.questions
      .filter((q) => q.deleted_at === undefined || q.deleted_at === null)
      .map((q) => q.id)
      .filter(Boolean) as string[]

    const toDelete = activeIds.filter((exId) => !incomingActiveIds.includes(exId))
    const placeholders = toDelete.map(() => '?').join(', ')

    const stmts: ReturnType<typeof c.env.DB.prepare>[] = []

    if (toDelete.length > 0) {
      stmts.push(
        c.env.DB.prepare(
          `UPDATE questions SET deleted_at = ? WHERE survey_id = ? AND id IN (${placeholders})`,
        ).bind(Math.floor(Date.now() / 1000), id, ...toDelete),
      )
    }

    body.questions.forEach((q, i) => {
      const qId = q.id

      if (qId && existingIds.includes(qId)) {
        const delAt = q.deleted_at ?? null
        stmts.push(
          c.env.DB.prepare(
            `UPDATE questions
             SET type = ?, label = ?, sort_order = ?, required = ?, config_json = ?, deleted_at = ?
             WHERE id = ? AND survey_id = ?`,
          ).bind(
            q.type,
            q.label,
            q.sort_order ?? i,
            q.required ? 1 : 0,
            JSON.stringify(q.config ?? {}),
            delAt,
            qId,
            id,
          ),
        )
      } else {
        const newId = qId || generateId()
        const delAt = q.deleted_at ?? null
        const createdAt = q.created_at ?? Math.floor(Date.now() / 1000)
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO questions (id, survey_id, type, label, sort_order, required, config_json, deleted_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            newId,
            id,
            q.type,
            q.label,
            q.sort_order ?? i,
            q.required ? 1 : 0,
            JSON.stringify(q.config ?? {}),
            delAt,
            createdAt,
          ),
        )
      }
    })

    if (stmts.length > 0) {
      await c.env.DB.batch(stmts)
    }
  }

  if (fields.length > 0 || body.questions !== undefined) {
    await c.env.KV.delete(`survey:${existing.slug}`)
  }

  const updated = await c.env.DB.prepare(
    `SELECT id, slug, title, status, brand_color, logo_url, font_family, created_at, updated_at
     FROM surveys WHERE id = ?`,
  )
    .bind(id)
    .first()

  const questions = await c.env.DB.prepare(
    `SELECT q.id, q.type, q.label, q.sort_order, q.required, q.config_json, q.deleted_at, q.created_at,
            (SELECT COUNT(*) FROM response_answers ra WHERE ra.question_id = q.id) as response_count
     FROM questions q WHERE q.survey_id = ? ORDER BY q.sort_order`,
  )
    .bind(id)
    .all<{
      id: string
      type: string
      label: string
      sort_order: number
      required: number
      config_json: string
      deleted_at: number | null
      created_at: number
      response_count: number
    }>()

  return c.json({
    survey: {
      ...updated,
      questions: questions.results.map((q) => ({
        ...q,
        required: q.required === 1,
        config: JSON.parse(q.config_json),
      })),
    },
  })
})

surveyRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    'SELECT id, slug FROM surveys WHERE id = ? AND owner_id = ?',
  )
    .bind(id, userId)
    .first<{ id: string; slug: string }>()

  if (!existing) {
    return c.json({ error: 'Survey not found' }, 404)
  }

  await c.env.DB.prepare('DELETE FROM surveys WHERE id = ?').bind(id).run()
  await c.env.KV.delete(`survey:${existing.slug}`)

  return c.json({ success: true })
})

surveyRoutes.post('/:id/publish', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    'SELECT id, slug FROM surveys WHERE id = ? AND owner_id = ?',
  )
    .bind(id, userId)
    .first<{ id: string; slug: string }>()

  if (!existing) {
    return c.json({ error: 'Survey not found' }, 404)
  }

  const existingQs = await c.env.DB.prepare(
    'SELECT type, config_json FROM questions WHERE survey_id = ? AND deleted_at IS NULL',
  )
    .bind(id)
    .all<{ type: string; config_json: string }>()

  if (existingQs.results.length === 0) {
    return c.json({ error: 'Cannot publish a survey with no questions' }, 400)
  }

  for (const q of existingQs.results) {
    if (q.type === 'multiple_choice') {
      let config: any = {}
      try {
        config = JSON.parse(q.config_json)
      } catch {}
      if (!Array.isArray(config.options) || config.options.length === 0) {
        return c.json({ error: 'Multiple choice questions need at least one option' }, 400)
      }
    }
  }

  await c.env.DB.prepare(`UPDATE surveys SET status = 'published', updated_at = ? WHERE id = ?`)
    .bind(Math.floor(Date.now() / 1000), id)
    .run()

  await c.env.KV.delete(`survey:${existing.slug}`)

  return c.json({ success: true, slug: existing.slug })
})
