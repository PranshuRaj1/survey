import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

export type Env = {
  DB: D1Database
  KV: KVNamespace
  JWT_SECRET: string
  FRONTEND_URL: string
}

export type Variables = {
  userId: string
  userEmail: string
}

export type AppContext = {
  Bindings: Env
  Variables: Variables
}
