# Survey builder

A self-hostable, custom-branded survey builder. Creators sign up, build forms in a drag-and-reorder builder, publish them at a public URL, and collect anonymous responses. Results are available as per-question analytics and as a CSV export. The entire stack runs on the Cloudflare Developer Platform — no long-running servers.

**UI/UX inspiration:** [Figma design file](https://www.figma.com/design/3yhAkyosZzMW30xUTGy37e/survey-design?node-id=0-1&t=RpabRbU4rkj7QA1e-1)

---

## What it does

- Sign up / log in with email and password; sessions are stored in Cloudflare KV and validated on every request
- Build surveys with five question types: short text, long text, multiple choice, rating, and date
- Per-survey branding: custom accent color, logo URL, and font family
- Publish a survey to a unique slug; respondents need no account
- View individual responses and per-question aggregates (average for rating questions, choice tally for multiple choice)
- Export all responses as a CSV file, including columns for questions that were later deleted
- Analytics dashboard showing total responses, visit count, and average completion time

---

## Tech stack

| Layer | Technology |
|---|---|
| API runtime | Hono 4 on Cloudflare Workers |
| Frontend | React 19 + Vite 8 |
| Client routing | TanStack Router 1 |
| Database | Cloudflare D1 (SQLite) |
| Cache / sessions / rate limiting | Cloudflare KV |
| Language | TypeScript (strict mode, both packages) |
| Lint / format | Biome 2 |
| Package manager | pnpm 9 (workspaces) |
| CSS | Tailwind CSS 4 (Vite plugin) |

---

## Environment variables

Only one secret needs to be set manually. The D1 and KV bindings are injected automatically by Wrangler from `wrangler.jsonc`.

| Variable | Where | Description |
|---|---|---|
| `JWT_SECRET` | `api/.dev.vars` locally; Wrangler secret in production | Signs and verifies session JWTs. Generate with `openssl rand -base64 32`. |
| `DB` | Wrangler binding (`d1_databases`) | Cloudflare D1 database — injected automatically, no manual value needed. |
| `KV` | Wrangler binding (`kv_namespaces`) | Cloudflare KV namespace — injected automatically, no manual value needed. |

---

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Create Cloudflare resources (first time only)
cd api
pnpm wrangler d1 create survey          # copy database_id into wrangler.jsonc
pnpm wrangler kv namespace create KV    # copy id into wrangler.jsonc

# 3. Apply migrations locally
pnpm wrangler d1 migrations apply survey --local

# 4. Create api/.dev.vars
echo "JWT_SECRET=$(openssl rand -base64 32)" > .dev.vars

# 5. Start both dev servers from the repo root
cd ..
pnpm dev
```

API runs at `http://localhost:8787`, frontend at `http://localhost:5173`.

---

## Deployment

```bash
# Apply migrations to production D1
cd api
pnpm wrangler d1 migrations apply survey --remote

# Set the production JWT secret
pnpm wrangler secret put JWT_SECRET

# Deploy the Worker
pnpm deploy

# Build and deploy the frontend (Cloudflare Pages or any static host)
cd ..
pnpm build   # output: web/dist/
```

After deploying the frontend, update the CORS `origin` list in `api/src/index.ts` with the production Pages URL and redeploy the Worker.

---


