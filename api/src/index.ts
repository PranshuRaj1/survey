import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
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

app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'https://your-deployed-frontend.pages.dev'], // will add link here [LINK]
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
)

app.use('*', csrf())

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

app.route('/api/auth', authRoutes)
app.route('/api/surveys', surveyRoutes)
app.route('/api/responses', responseRoutes)
app.route('/api/public', publicRoutes)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
