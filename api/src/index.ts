import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { AppContext } from './types'
import { authRoutes } from './routes/auth'
import { surveyRoutes } from './routes/surveys'
import { responseRoutes } from './routes/responses'
import { publicRoutes } from './routes/public'

const app = new Hono<AppContext>()

app.use('*', logger())

app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'https://your-deployed-frontend.pages.dev'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
)

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