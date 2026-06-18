import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import type { AppContext } from '../types'

export const responseRoutes = new Hono<AppContext>()

responseRoutes.use('*', authMiddleware)

responseRoutes.get('/:surveyId', async (c) => {
  const userId = c.get('userId')
  const surveyId = c.req.param('surveyId')

  const survey = await c.env.DB.prepare('SELECT id FROM surveys WHERE id = ? AND owner_id = ?')
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

  const survey = await c.env.DB.prepare('SELECT id FROM surveys WHERE id = ? AND owner_id = ?')
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

  // Fetch visit count from KV; falls back to total responses if no visits have been tracked yet
  // (e.g. for surveys that pre-date visit tracking). Capped to prevent impossible negative bounce.
  const rawVisits = await c.env.KV.get(`visits:${surveyId}`)
  const totalCount = total?.count ?? 0
  const visits = Math.max(totalCount, rawVisits ? parseInt(rawVisits, 10) : 0)

  // Query the actual average completion duration (in seconds) from D1
  const durationRow = await c.env.DB.prepare(
    'SELECT AVG(completion_duration) as avg_duration FROM responses WHERE survey_id = ? AND completion_duration IS NOT NULL',
  )
    .bind(surveyId)
    .first<{ avg_duration: number | null }>()
  const avgDuration = durationRow?.avg_duration ?? null

  const questions = await c.env.DB.prepare(
    `SELECT id, type, label, config_json
     FROM questions WHERE survey_id = ? ORDER BY sort_order`,
  )
    .bind(surveyId)
    .all<{ id: string; type: string; label: string; config_json: string }>()

  // Fetch all answers for all questions in this survey in a single query
  //console.log(`[D1 Query] Fetching all answers for survey: ${surveyId}`)
  const answers = await c.env.DB.prepare(
    `SELECT ra.question_id, ra.value_json
     FROM response_answers ra
     JOIN questions q ON q.id = ra.question_id
     WHERE q.survey_id = ?`,
  )
    .bind(surveyId)
    .all<{ question_id: string; value_json: string }>()

  // Group answers by question ID in memory
  const answersMap = new Map<string, any[]>()
  for (const a of answers.results) {
    let list = answersMap.get(a.question_id)
    if (!list) {
      list = []
      answersMap.set(a.question_id, list)
    }
    try {
      list.push(JSON.parse(a.value_json))
    } catch {}
  }

  // Compute metrics in-memory
  const analytics = questions.results.map((q) => {
    const values = answersMap.get(q.id) ?? []

    if (q.type === 'rating') {
      const nums = values.filter((v) => typeof v === 'number') as number[]
      const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
      return { question_id: q.id, label: q.label, type: q.type, average: avg, count: nums.length }
    }

    if (q.type === 'multiple_choice') {
      const tally: Record<string, number> = Object.create(null)
      for (const v of values) {
        if (v === null || v === undefined) continue
        const choices = Array.isArray(v) ? v : [v]
        for (const choice of choices) {
          if (typeof choice === 'string' && choice.trim() !== '') {
            tally[choice] = (tally[choice] ?? 0) + 1
          }
        }
      }
      return { question_id: q.id, label: q.label, type: q.type, tally, count: values.length }
    }

    return { question_id: q.id, label: q.label, type: q.type, count: values.length }
  })

  return c.json({ total: totalCount, visits, avgDuration, questions: analytics })
})

responseRoutes.get('/:surveyId/export', async (c) => {
  const userId = c.get('userId')
  const surveyId = c.req.param('surveyId')

  const survey = await c.env.DB.prepare('SELECT id FROM surveys WHERE id = ? AND owner_id = ?')
    .bind(surveyId, userId)
    .first<{ id: string }>()

  if (!survey) {
    return c.json({ error: 'Survey not found' }, 404)
  }

  // 1. Fetch active questions currently in the survey
  const questions = await c.env.DB.prepare(
    `SELECT id, label, type
     FROM questions
     WHERE survey_id = ?
     ORDER BY sort_order ASC`,
  )
    .bind(surveyId)
    .all<{ id: string; label: string; type: string }>()

  const activeQuestionIds = new Set(questions.results.map((q) => q.id))

  // 2. Fetch all responses (no limit)
  const responses = await c.env.DB.prepare(
    `SELECT id, submitted_at
     FROM responses
     WHERE survey_id = ?
     ORDER BY submitted_at DESC`,
  )
    .bind(surveyId)
    .all<{ id: string; submitted_at: number }>()

  // 3. Fetch response answers in a single query (joining responses to filter by survey_id)
  const answers = await c.env.DB.prepare(
    `SELECT ra.response_id, ra.question_id, ra.value_json
     FROM response_answers ra
     JOIN responses r ON r.id = ra.response_id
     WHERE r.survey_id = ?`,
  )
    .bind(surveyId)
    .all<{ response_id: string; question_id: string; value_json: string }>()

  // Pivot answers by response_id and question_id in memory (safely dropping missing questions)
  const answersMap = new Map<string, Map<string, unknown>>()
  for (const a of answers.results) {
    if (!activeQuestionIds.has(a.question_id)) {
      continue
    }
    let responseMap = answersMap.get(a.response_id)
    if (!responseMap) {
      responseMap = new Map<string, unknown>()
      answersMap.set(a.response_id, responseMap)
    }
    try {
      responseMap.set(a.question_id, JSON.parse(a.value_json))
    } catch {
      // Safe fallback
    }
  }

  // CSV formatting helper
  const formatCsvCell = (val: unknown): string => {
    if (val === null || val === undefined || val === '') {
      return ''
    }
    let strVal = ''
    if (Array.isArray(val)) {
      strVal = val.map((item) => String(item ?? '')).join(', ')
    } else {
      strVal = String(val)
    }

    // CSV Injection Prevention
    if (/^[=+\-@]/.test(strVal)) {
      strVal = `'${strVal}`
    }

    // Wrap in double quotes and escape internal double quotes
    return `"${strVal.replace(/"/g, '""')}"`
  }

  // CSV Date formatter (YYYY-MM-DD HH:MM:SS UTC)
  const formatUtcDate = (unix: number) => {
    const date = new Date(unix * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const yyyy = date.getUTCFullYear()
    const mm = pad(date.getUTCMonth() + 1)
    const dd = pad(date.getUTCDate())
    const hh = pad(date.getUTCHours())
    const min = pad(date.getUTCMinutes())
    const ss = pad(date.getUTCSeconds())
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} UTC`
  }

  // Build CSV content
  const headers = ['Response ID', 'Submitted At', ...questions.results.map((q) => q.label)]
  const csvRows = [headers.map((h) => formatCsvCell(h)).join(',')]

  for (const r of responses.results) {
    const row: string[] = []
    row.push(formatCsvCell(r.id))
    row.push(formatCsvCell(formatUtcDate(r.submitted_at)))

    const respAnswers = answersMap.get(r.id)
    for (const q of questions.results) {
      const val = respAnswers?.get(q.id)
      row.push(formatCsvCell(val))
    }
    csvRows.push(row.join(','))
  }

  const csvString = csvRows.join('\n')

  return c.text(csvString, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="survey_${surveyId}_responses.csv"`,
    'Cache-Control': 'no-store',
  })
})
