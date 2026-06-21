import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { authRoutes } from './routes/auth'
import { publicRoutes } from './routes/public'
import { responseRoutes } from './routes/responses'
import { surveyRoutes } from './routes/surveys'
import type { AppContext } from './types'

const app = new Hono<AppContext>()

app.use('*', logger())
app.use('*', secureHeaders())

app.use('*', async (c, next) => {
  const origins = ['http://localhost:5173', c.env.FRONTEND_URL].filter(Boolean)
  return cors({
    origin: origins,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })(c, next)
})

app.use('*', async (c, next) => {
  const origins = ['http://localhost:5173', c.env.FRONTEND_URL].filter(Boolean)
  return csrf({ origin: origins })(c, next)
})

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

app.route('/api/auth', authRoutes)
app.route('/api/surveys', surveyRoutes)
app.route('/api/responses', responseRoutes)
app.route('/api/public', publicRoutes)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  if (err instanceof HTTPException) {
    return err.getResponse()
  }
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
