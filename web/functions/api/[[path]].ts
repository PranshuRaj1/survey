import { handle } from 'hono/cloudflare-pages'
import app from '../../../api/src/index'

export const onRequest = handle(app)
