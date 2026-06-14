# AI Agent Instructions: Project DoCoDeGo (Branded Survey Builder)

## 1. Project Context & Philosophy
You are assisting with the development of a custom branded survey builder web application (similar to a minimal Typeform). 
The project operates under the DECODEGO framework: **DOcument, Compose, DEmonstrate, GOvern**.

**The Prime Directive:** AI-generated work is only useful when a human can own it end-to-end. Autonomy without accountability is catastrophe.
* **Do NOT write "black box" code.** The developer must retain absolute understanding and ownership of every line shipped.
* Prioritize readability, explicit logic, and clear variable naming over clever one-liners.
* If proposing a complex architectural pattern or advanced TypeScript feature, briefly explain *why* it is the best choice so the architecture remains strictly governed.

## 2. Tech Stack Boundaries
You must strictly adhere to the following stack. Do not suggest or install libraries outside of this paradigm without explicit permission.

* **Backend:** Hono on Cloudflare Workers.
* **Frontend:** React + Vite + TanStack Router. **Crucial:** Client-side routing *only*. Do not introduce SSR frameworks.
* **Persistence:** Cloudflare D1 (Relational/SQLite) for core data, KV for fast-read state, R2 for object storage. *Bridge the gap from standard PostgreSQL/Redis workflows to their Cloudflare serverless equivalents smoothly.*
* **Language:** TypeScript (Strict mode enabled on both sides).
* **Code Quality:** Biome.

## 3. Engineering & Design Principles
* **Anti-Complexity:** Hold to a strict anti-complexity principle. Cut scope cleanly rather than shipping sprawl. Prioritize a tight MVP with exceptional UX over a half-baked feature set.
* **Algorithmic Efficiency:** Rely on highly efficient data structures and algorithms for parsing survey responses and managing complex state, leveraging strong algorithmic problem-solving practices while keeping the implementation transparent.
* **Type Safety:** Leverage TypeScript heavily to share types between the Hono backend and the React frontend. A monorepo setup (or shared types directory) is preferred to ensure API contracts are strictly typed.
* **State Management:** Keep it simple. Use React context or standard hooks unless the survey builder UI complexity explicitly demands a global store.

## 4. Specific Rules for File Generation

### Backend (Hono + Cloudflare)
* Use standard RESTful patterns or RPC, keeping routes cleanly modular.
* Always validate incoming payloads before touching D1.
* When writing D1 queries, write standard SQLite syntax. Do not over-abstract the database layer with heavy ORMs; lightweight query builders are acceptable only if explicitly justified.

### Frontend (React + TanStack Router)
* Use functional components and hooks.
* TanStack Router must handle all routing. Ensure loader functions and route configurations are cleanly separated.
* For the Survey Builder UI: Architect the state model for questions (add/remove/reorder) cleanly before implementing the drag-and-drop UI to prevent messy component state.

### Formatting & Linting (Biome)
* **DO NOT use Prettier or ESLint.** Biome is configured at the root.
* Ensure all generated code adheres to standard Biome formatting (`pnpm check` must pass).
* If a Biome rule absolutely must be disabled, do so explicitly in `biome.json` (not inline) and document *why*.

## 5. MVP Priorities
Focus entirely on shipping these core features before exploring any stretch goals:
1. Sign-in flow.
2. Builder UI (3 question types, add/remove/reorder).
3. Per-survey branding (primary color + logo URL).
4. Shareable public URL (renders in the owner's brand, no login required to respond).
5. Anonymous response submission persisted server-side.
6. Owner dashboard: list own surveys, view responses.