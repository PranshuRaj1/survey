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
    `SELECT id, type, label, sort_order, required, config_json
     FROM questions
     WHERE survey_id = ?
     ORDER BY sort_order ASC`,
  )
    .bind(id)
    .all<{
      id: string
      type: string
      label: string
      sort_order: number
      required: number
      config_json: string
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
  const body = await c.req.json<{ title?: string }>()

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
    'SELECT id, slug FROM surveys WHERE id = ? AND owner_id = ?',
  )
    .bind(id, userId)
    .first<{ id: string; slug: string }>()

  if (!existing) {
    return c.json({ error: 'Survey not found' }, 404)
  }

  const body = await c.req.json<{
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
    }>
  }>()

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
    const existingQuestions = await c.env.DB.prepare('SELECT id FROM questions WHERE survey_id = ?')
      .bind(id)
      .all<{ id: string }>()

    const existingIds = existingQuestions.results.map((q) => q.id)
    const incomingIds = body.questions.map((q) => q.id).filter(Boolean) as string[]
    const toDelete = existingIds.filter((exId) => !incomingIds.includes(exId))
    const placeholders = toDelete.map(() => '?').join(', ')

    if (toDelete.length > 0) {
      const answerCheck = await c.env.DB.prepare(
        `SELECT DISTINCT question_id FROM response_answers WHERE question_id IN (${placeholders})`,
      )
        .bind(...toDelete)
        .all<{ question_id: string }>()

      if (answerCheck.results.length > 0) {
        return c.json(
          {
            error: 'Cannot delete questions that already have responses',
            details: {
              question_ids: answerCheck.results.map((r) => r.question_id),
            },
          },
          400,
        )
      }
    }

    const stmts: ReturnType<typeof c.env.DB.prepare>[] = []

    if (toDelete.length > 0) {
      stmts.push(
        c.env.DB.prepare(
          `DELETE FROM questions WHERE survey_id = ? AND id IN (${placeholders})`,
        ).bind(id, ...toDelete),
      )
    }

    body.questions.forEach((q, i) => {
      const qId = q.id

      if (qId && existingIds.includes(qId)) {
        stmts.push(
          c.env.DB.prepare(
            `UPDATE questions
             SET type = ?, label = ?, sort_order = ?, required = ?, config_json = ?
             WHERE id = ? AND survey_id = ?`,
          ).bind(
            q.type,
            q.label,
            q.sort_order ?? i,
            q.required ? 1 : 0,
            JSON.stringify(q.config ?? {}),
            qId,
            id,
          ),
        )
      } else {
        const newId = qId || generateId()
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO questions (id, survey_id, type, label, sort_order, required, config_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            newId,
            id,
            q.type,
            q.label,
            q.sort_order ?? i,
            q.required ? 1 : 0,
            JSON.stringify(q.config ?? {}),
          ),
        )
      }
    })

    if (stmts.length > 0) {
      await c.env.DB.batch(stmts)
    }

    await c.env.KV.delete(`survey:${existing.slug}`)
  }

  const updated = await c.env.DB.prepare(
    `SELECT id, slug, title, status, brand_color, logo_url, font_family, created_at, updated_at
     FROM surveys WHERE id = ?`,
  )
    .bind(id)
    .first()

  const questions = await c.env.DB.prepare(
    `SELECT id, type, label, sort_order, required, config_json
     FROM questions WHERE survey_id = ? ORDER BY sort_order`,
  )
    .bind(id)
    .all<{
      id: string
      type: string
      label: string
      sort_order: number
      required: number
      config_json: string
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

  await c.env.DB.prepare(`UPDATE surveys SET status = 'published', updated_at = ? WHERE id = ?`)
    .bind(Math.floor(Date.now() / 1000), id)
    .run()

  await c.env.KV.delete(`survey:${existing.slug}`)

  return c.json({ success: true, slug: existing.slug })
})