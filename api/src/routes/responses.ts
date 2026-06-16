import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import type { AppContext } from '../types'

export const responseRoutes = new Hono<AppContext>()

responseRoutes.use('*', authMiddleware)

responseRoutes.get('/:surveyId', async (c) => {
  const userId = c.get('userId')
  const surveyId = c.req.param('surveyId')

  const survey = await c.env.DB.prepare(
    'SELECT id FROM surveys WHERE id = ? AND owner_id = ?',
  )
    .bind(surveyId, userId)
    .first()

  if (!survey) {
    return c.json({ error: 'Survey not found' }, 404)
  }

  const responses = await c.env.DB.prepare(
    `SELECT id, submitted_at, respondent_ip
     FROM responses
     WHERE survey_id = ?
     ORDER BY submitted_at DESC
     LIMIT 100`,
  )
    .bind(surveyId)
    .all<{ id: string; submitted_at: number; respondent_ip: string }>()

  if (responses.results.length === 0) {
    return c.json({ responses: [], total: 0 })
  }

  const responseIds = responses.results.map((r) => r.id)
  const placeholders = responseIds.map(() => '?').join(',')

  const answers = await c.env.DB.prepare(
    `SELECT ra.response_id, ra.question_id, ra.value_json,
            q.label, q.type
     FROM response_answers ra
     JOIN questions q ON q.id = ra.question_id
     WHERE ra.response_id IN (${placeholders})`,
  )
    .bind(...responseIds)
    .all<{
      response_id: string
      question_id: string
      value_json: string
      label: string
      type: string
    }>()

  const answersByResponse: Record<string, typeof answers.results> = {}
  for (const a of answers.results) {
    let list = answersByResponse[a.response_id]
    if (!list) {
      list = []
      answersByResponse[a.response_id] = list
    }
    list.push(a)
  }

  const result = responses.results.map((r) => ({
    id: r.id,
    submitted_at: r.submitted_at,
    answers: (answersByResponse[r.id] ?? []).map((a) => ({
      question_id: a.question_id,
      label: a.label,
      type: a.type,
      value: JSON.parse(a.value_json),
    })),
  }))

  return c.json({ responses: result, total: result.length })
})

responseRoutes.get('/:surveyId/analytics', async (c) => {
  const userId = c.get('userId')
  const surveyId = c.req.param('surveyId')

  const survey = await c.env.DB.prepare(
    'SELECT id FROM surveys WHERE id = ? AND owner_id = ?',
  )
    .bind(surveyId, userId)
    .first()

  if (!survey) {
    return c.json({ error: 'Survey not found' }, 404)
  }

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM responses WHERE survey_id = ?',
  )
    .bind(surveyId)
    .first<{ count: number }>()

  const questions = await c.env.DB.prepare(
    `SELECT id, type, label, config_json
     FROM questions WHERE survey_id = ? ORDER BY sort_order`,
  )
    .bind(surveyId)
    .all<{ id: string; type: string; label: string; config_json: string }>()

  const analytics = await Promise.all(
    questions.results.map(async (q) => {
      const answers = await c.env.DB.prepare(
        `SELECT value_json FROM response_answers WHERE question_id = ?`,
      )
        .bind(q.id)
        .all<{ value_json: string }>()

      const values = answers.results.map((a) => JSON.parse(a.value_json))

      if (q.type === 'rating') {
        const nums = values.filter((v) => typeof v === 'number') as number[]
        const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
        return { question_id: q.id, label: q.label, type: q.type, average: avg, count: nums.length }
      }

      if (q.type === 'multiple_choice') {
        const tally: Record<string, number> = {}
        for (const v of values) {
          const choices = Array.isArray(v) ? v : [v]
          for (const choice of choices) {
            tally[choice] = (tally[choice] ?? 0) + 1
          }
        }
        return { question_id: q.id, label: q.label, type: q.type, tally, count: values.length }
      }

      return { question_id: q.id, label: q.label, type: q.type, count: values.length }
    }),
  )

  return c.json({ total: total?.count ?? 0, questions: analytics })
})