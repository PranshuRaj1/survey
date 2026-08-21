/**
 * helpers/db.ts
 *
 * Database helpers for the test suite.
 *
 * PURPOSE
 * -------
 * 1. applyMigrations(db, kv) — executes all four API migration files against
 *    the in-memory D1 instance provided by @cloudflare/vitest-pool-workers.
 *    The `db` and `kv` bindings must be passed from each test file (imported
 *    directly from 'cloudflare:test') because module-level imports of `env`
 *    don't resolve correctly inside vitest-pool-workers helper modules.
 *
 *    Call this in beforeEach() inside every test file (isolatedStorage: true
 *    means each test starts with a blank database).
 *
 * 2. Seed helpers — typed wrappers around raw D1 inserts so test files can
 *    create users, surveys, questions, and responses without going through the
 *    HTTP layer (useful for setting up preconditions quickly).
 *
 * 3. clearDatabase(db) — deletes all rows in dependency order.
 *
 * IMPORTANT
 * ---------
 * The SQL files are imported with the `?raw` Vite suffix so they are inlined
 * as plain strings at bundle time — no Node fs access is needed inside the
 * Workers runtime.
 */

// Inline each migration as a raw string via Vite's ?raw transform.
import sql0001 from '../../api/migrations/0001_init.sql?raw'
import sql0002 from '../../api/migrations/0002_add_completion_duration.sql?raw'
import sql0003 from '../../api/migrations/0003_soft_delete_questions.sql?raw'
import sql0004 from '../../api/migrations/0004_add_question_created_at.sql?raw'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestBindings {
  DB: D1Database
  KV: KVNamespace
}

// ─── Migration Runner ─────────────────────────────────────────────────────────

/**
 * Runs all API migrations against the supplied D1 instance in order.
 * Safe to call multiple times on a fresh (isolated) database.
 *
 * @param db - D1Database binding, obtained via `env.DB` in the test file.
 */
export async function applyMigrations(db: D1Database): Promise<void> {
  const migrations = [sql0001, sql0002, sql0003, sql0004]
  for (const sql of migrations) {
    // 1. Remove line comments (-- ...) and block comments (/* ... */)
    let cleaned = sql.replace(/--.*$/gm, '')
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')

    // 2. Split by semicolon, filter empties, and run each as a single-line statement
    const statements = cleaned
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    for (const stmt of statements) {
      const singleLine = stmt.replace(/\r?\n/g, ' ').trim()
      await db.exec(`${singleLine};`)
    }
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Deletes all rows in reverse dependency order.
 * Only needed when isolatedStorage is disabled.
 */
export async function clearDatabase(db: D1Database): Promise<void> {
  await db.exec('DELETE FROM response_answers;')
  await db.exec('DELETE FROM responses;')
  await db.exec('DELETE FROM questions;')
  await db.exec('DELETE FROM surveys;')
  await db.exec('DELETE FROM users;')
}

// ─── Seed Helpers ────────────────────────────────────────────────────────────

/**
 * Inserts a user row directly into D1 (bypasses HTTP).
 * Returns the new user id.
 */
export async function seedUser(
  db: D1Database,
  email: string,
  passwordHash = 'testhash',
): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '')
  await db
    .prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
    .bind(id, email.toLowerCase().trim(), passwordHash)
    .run()
  return id
}

/**
 * Inserts a survey row directly into D1. Returns the new survey id and slug.
 */
export async function seedSurvey(
  db: D1Database,
  ownerId: string,
  opts: {
    title?: string
    status?: 'draft' | 'published'
    slug?: string
  } = {},
): Promise<{ id: string; slug: string }> {
  const id = crypto.randomUUID().replace(/-/g, '')
  const slug = opts.slug ?? `test-survey-${Math.random().toString(36).slice(2, 7)}`
  const title = opts.title ?? 'Test Survey'
  const status = opts.status ?? 'draft'

  await db
    .prepare(
      `INSERT INTO surveys (id, owner_id, slug, title, status)
     VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, ownerId, slug, title, status)
    .run()

  return { id, slug }
}

/**
 * Inserts a question row directly into D1. Returns the new question id.
 */
export async function seedQuestion(
  db: D1Database,
  surveyId: string,
  opts: {
    type?: 'short_text' | 'long_text' | 'multiple_choice' | 'rating' | 'date'
    label?: string
    required?: boolean
    sortOrder?: number
    config?: Record<string, unknown>
    deletedAt?: number | null
  } = {},
): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '')
  const type = opts.type ?? 'short_text'
  const label = opts.label ?? 'Test Question'
  const required = opts.required ? 1 : 0
  const sortOrder = opts.sortOrder ?? 0
  const configJson = JSON.stringify(opts.config ?? {})
  const deletedAt = opts.deletedAt ?? null
  const createdAt = Math.floor(Date.now() / 1000)

  await db
    .prepare(
      `INSERT INTO questions
       (id, survey_id, type, label, sort_order, required, config_json, deleted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, surveyId, type, label, sortOrder, required, configJson, deletedAt, createdAt)
    .run()

  return id
}

/**
 * Inserts a response + answer rows directly into D1.
 * Returns the new response id.
 */
export async function seedResponse(
  db: D1Database,
  surveyId: string,
  answers: Array<{ questionId: string; value: unknown }>,
  opts: { ip?: string; duration?: number } = {},
): Promise<string> {
  const responseId = crypto.randomUUID().replace(/-/g, '')
  const ip = opts.ip ?? '127.0.0.1'
  const duration = opts.duration ?? null

  await db
    .prepare(
      `INSERT INTO responses (id, survey_id, respondent_ip, completion_duration)
     VALUES (?, ?, ?, ?)`,
    )
    .bind(responseId, surveyId, ip, duration)
    .run()

  for (const { questionId, value } of answers) {
    const answerId = crypto.randomUUID().replace(/-/g, '')
    await db
      .prepare(
        `INSERT INTO response_answers (id, response_id, question_id, value_json)
       VALUES (?, ?, ?, ?)`,
      )
      .bind(answerId, responseId, questionId, JSON.stringify(value))
      .run()
  }

  return responseId
}
