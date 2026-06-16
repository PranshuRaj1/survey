import type { MiddlewareHandler } from 'hono'
import { verifyJWT } from '../lib/crypto'
import type { AppContext } from '../types'

export const authMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  const payload = await verifyJWT(token, c.env.JWT_SECRET)

  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  const sessionKey = `session:${payload.userId}`
  const storedToken = await c.env.KV.get(sessionKey)

  if (storedToken !== token) {
    return c.json({ error: 'Session expired or revoked' }, 401)
  }

  c.set('userId', payload.userId as string)
  c.set('userEmail', payload.email as string)

  await next()
}