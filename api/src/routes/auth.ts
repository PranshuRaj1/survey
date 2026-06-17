import { Hono } from 'hono'
import { generateId, hashPassword, signJWT, verifyPassword } from '../lib/crypto'
import { authMiddleware } from '../middleware/auth'
import type { AppContext } from '../types'

export const authRoutes = new Hono<AppContext>()

authRoutes.post('/signup', async (c) => {
  let body: { email?: string; password?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return c.json({ error: 'Email and password must be strings' }, 400)
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(body.email)) {
    return c.json({ error: 'Invalid email format' }, 400)
  }

  if (!body.email || !body.password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  if (body.password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(body.email.toLowerCase().trim())
    .first()

  if (existing) {
    return c.json({ error: 'Email already in use' }, 409)
  }

  const id = generateId()
  const passwordHash = await hashPassword(body.password)

  await c.env.DB.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
    .bind(id, body.email.toLowerCase().trim(), passwordHash)
    .run()

  const token = await signJWT({ userId: id, email: body.email }, c.env.JWT_SECRET)

  await c.env.KV.put(`session:${id}`, token, { expirationTtl: 60 * 60 * 24 * 7 })

  return c.json({ token, user: { id, email: body.email } }, 201)
})

authRoutes.post('/login', async (c) => {
  let body: { email?: string; password?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return c.json({ error: 'Email and password must be strings' }, 400)
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(body.email)) {
    return c.json({ error: 'Invalid email format' }, 400)
  }

  if (!body.email || !body.password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const user = await c.env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .bind(body.email.toLowerCase().trim())
    .first<{ id: string; email: string; password_hash: string }>()

  if (!user) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  const valid = await verifyPassword(body.password, user.password_hash)

  if (!valid) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  const token = await signJWT({ userId: user.id, email: user.email }, c.env.JWT_SECRET)

  await c.env.KV.put(`session:${user.id}`, token, { expirationTtl: 60 * 60 * 24 * 7 })

  return c.json({ token, user: { id: user.id, email: user.email } })
})

authRoutes.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId')
  await c.env.KV.delete(`session:${userId}`)
  return c.json({ success: true })
})

authRoutes.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')

  const user = await c.env.DB.prepare('SELECT id, email, created_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string; created_at: number }>()

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  return c.json({ user })
})