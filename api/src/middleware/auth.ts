import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyJWT } from '../lib/crypto'
import type { AppContext } from '../types'

export const authMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  const token = getCookie(c, 'decodego_session')

  if (!token) {
    return c.json({ error: 'Missing or expired session cookie' }, 401)
  }

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
