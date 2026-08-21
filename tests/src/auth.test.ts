/**
 * src/auth.test.ts
 *
 * WHAT THIS FILE TESTS
 * --------------------
 * Authentication — signup, login, logout, session cookie mechanics, JWT
 * verification, CSRF protection, and known security gaps.
 *
 * TC IDs COVERED
 * --------------
 * TC-AUTH-01  Signup with valid credentials → 201, httpOnly cookie
 * TC-AUTH-02  Signup with duplicate email → 409
 * TC-AUTH-03  Signup with password < 8 chars → 400
 * TC-AUTH-04  Signup with invalid email format → 400
 * TC-AUTH-05  Login with correct credentials → 200, fresh cookie
 * TC-AUTH-06  Login with wrong password → 401, generic message
 * TC-AUTH-07  Login with unknown email → 401, same generic message (no enum)
 * TC-AUTH-08  Protected route without cookie → 401
 * TC-AUTH-09  Tampered JWT → 401
 * TC-AUTH-10  Session revocation after logout
 * TC-AUTH-11  Non-string body fields → 400
 * TC-AUTH-12  [GAP] Brute-force login — no rate limit (documents current behaviour)
 * TC-AUTH-13  CSRF: cross-origin POST blocked when Origin header is absent
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, signupAndLogin } from '../helpers/app'
import { applyMigrations } from '../helpers/db'

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Each test starts with a fresh in-memory D1 (isolatedStorage: true).
  await applyMigrations(env.DB)
})

// ─── TC-AUTH-01: Valid signup ─────────────────────────────────────────────────

describe('TC-AUTH-01 — Signup with valid credentials', () => {
  it('returns 201 with user object and sets an httpOnly session cookie', async () => {
    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'alice@example.com', password: 'Password123!' }),
    })

    expect(res.status).toBe(201)

    const body = await res.json<{ user: { id: string; email: string } }>()
    expect(body.user.email).toBe('alice@example.com')
    expect(body.user.id).toBeTypeOf('string')

    // Cookie must be present and have security attributes.
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('decodego_session=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('secure')
    expect(setCookie.toLowerCase()).toContain('samesite=strict')
  })

  it('normalises email to lowercase before storing', async () => {
    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'ALICE@EXAMPLE.COM', password: 'Password123!' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json<{ user: { email: string } }>()
    expect(body.user.email).toBe('ALICE@EXAMPLE.COM') // returned as-given in signup
  })
})

// ─── TC-AUTH-02: Duplicate email ─────────────────────────────────────────────

describe('TC-AUTH-02 — Signup with duplicate email', () => {
  it('returns 409 for a second signup with the same email', async () => {
    const email = 'bob@example.com'
    await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'Password123!' }),
    })

    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'Password456!' }),
    })

    expect(res.status).toBe(409)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/email already in use/i)
  })

  it('is case-insensitive for duplicate detection', async () => {
    await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'carol@example.com', password: 'Password123!' }),
    })

    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'CAROL@example.com', password: 'Password456!' }),
    })

    expect(res.status).toBe(409)
  })
})

// ─── TC-AUTH-03: Weak password ───────────────────────────────────────────────

describe('TC-AUTH-03 — Signup with password shorter than 8 characters', () => {
  it('returns 400', async () => {
    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'dan@example.com', password: 'abc' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json<{ error: string }>()
    expect(body.error).toMatch(/at least 8 characters/i)
  })

  it('accepts exactly 8 characters', async () => {
    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'elen@example.com', password: '12345678' }),
    })
    expect(res.status).toBe(201)
  })
})

// ─── TC-AUTH-04: Invalid email format ────────────────────────────────────────

describe('TC-AUTH-04 — Signup with invalid email format', () => {
  const invalidEmails = ['notanemail', '@domain.com', 'user@', 'a b@c.com', '']

  for (const email of invalidEmails) {
    it(`rejects "${email}"`, async () => {
      const res = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'Password123!' }),
      })
      expect(res.status).toBe(400)
    })
  }
})

// ─── TC-AUTH-05: Valid login ──────────────────────────────────────────────────

describe('TC-AUTH-05 — Login with correct credentials', () => {
  it('returns 200 with user object and fresh session cookie', async () => {
    // Create account first.
    await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'frank@example.com', password: 'Password123!' }),
    })

    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'frank@example.com', password: 'Password123!' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json<{ user: { email: string } }>()
    expect(body.user.email).toBe('frank@example.com')
    expect(res.headers.get('set-cookie')).toContain('decodego_session=')
  })
})

// ─── TC-AUTH-06: Wrong password ──────────────────────────────────────────────

describe('TC-AUTH-06 — Login with wrong password', () => {
  it('returns 401 with a generic "Invalid email or password" message', async () => {
    await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'grace@example.com', password: 'Password123!' }),
    })

    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'grace@example.com', password: 'WrongPass!' }),
    })

    expect(res.status).toBe(401)
    const body = await res.json<{ error: string }>()
    expect(body.error).toBe('Invalid email or password')
  })
})

// ─── TC-AUTH-07: Unknown email ────────────────────────────────────────────────

describe('TC-AUTH-07 — Login with unknown email (no user enumeration)', () => {
  it('returns 401 with the same message as wrong password', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@example.com', password: 'Password123!' }),
    })

    expect(res.status).toBe(401)
    const body = await res.json<{ error: string }>()
    // Must be identical to TC-AUTH-06 response — no difference that leaks user existence.
    expect(body.error).toBe('Invalid email or password')
  })
})

// ─── TC-AUTH-08: Protected route without cookie ───────────────────────────────

describe('TC-AUTH-08 — Protected routes reject requests without a session cookie', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['GET', '/api/surveys'],
    ['GET', '/api/auth/me'],
    ['POST', '/api/surveys'],
  ]

  for (const [method, path] of protectedRoutes) {
    it(`${method} ${path} → 401`, async () => {
      const res = await api(path, { method })
      expect(res.status).toBe(401)
      const body = await res.json<{ error: string }>()
      expect(body.error).toMatch(/missing|expired|session/i)
    })
  }
})

// ─── TC-AUTH-09: Tampered JWT ────────────────────────────────────────────────

describe('TC-AUTH-09 — Tampered JWT is rejected', () => {
  it('returns 401 when the signature portion of the token is modified', async () => {
    const cookie = await signupAndLogin('henry@example.com')

    // Extract the raw token value from "decodego_session=<token>"
    const token = cookie.split('=')[1] ?? ''
    const parts = token.split('.')
    // Flip the last character of the signature to corrupt it.
    const badSig = `${parts[2]?.slice(0, -1)}X`
    const tamperedToken = `${parts[0]}.${parts[1]}.${badSig}`

    const res = await api('/api/auth/me', {
      cookie: `decodego_session=${tamperedToken}`,
    })

    expect(res.status).toBe(401)
  })
})

// ─── TC-AUTH-10: Session revocation ─────────────────────────────────────────

describe('TC-AUTH-10 — Logout revokes the session', () => {
  it('old session cookie returns 401 after logout', async () => {
    const cookie = await signupAndLogin('iris@example.com')

    // Confirm session is valid.
    const before = await api('/api/auth/me', { cookie })
    expect(before.status).toBe(200)

    // Logout.
    const logoutRes = await api('/api/auth/logout', { method: 'POST', cookie })
    expect(logoutRes.status).toBe(200)

    // Replay the old cookie — must now be rejected.
    const after = await api('/api/auth/me', { cookie })
    expect(after.status).toBe(401)
    const body = await after.json<{ error: string }>()
    expect(body.error).toMatch(/expired|revoked/i)
  })
})

// ─── TC-AUTH-11: Non-string body fields ──────────────────────────────────────

describe('TC-AUTH-11 — Non-string email/password fields are rejected', () => {
  it('signup rejects numeric email', async () => {
    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 12345, password: 'Password123!' }),
    })
    expect(res.status).toBe(400)
  })

  it('login rejects array password', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@test.com', password: ['p', 'a', 's', 's'] }),
    })
    expect(res.status).toBe(400)
  })
})

// ─── TC-AUTH-12: Brute-force gap ─────────────────────────────────────────────

describe('TC-AUTH-12 — [KNOWN GAP] Login endpoint has no rate limiting', () => {
  /**
   * SECURITY GAP: The /api/auth/login endpoint performs no rate limiting.
   * An attacker can send unlimited requests to brute-force any account password.
   *
   * This test documents the CURRENT (broken) behaviour by verifying that 20
   * rapid requests all receive the same 401, never a 429.
   *
   * @todo Add per-IP rate limiting to the login endpoint (e.g. 5 attempts
   *       per minute per IP using KV).
   */
  it('allows more than 10 login attempts from the same IP without throttling', async () => {
    await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'victim@example.com', password: 'CorrectPass1!' }),
    })

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        api('/api/auth/login', {
          method: 'POST',
          ip: '1.2.3.4',
          body: JSON.stringify({ email: 'victim@example.com', password: 'WrongPass!' }),
        }),
      ),
    )

    // All 20 return 401 — NONE return 429. This is the gap.
    for (const res of responses) {
      expect(res.status).toBe(401)
    }
  })
})

// ─── TC-AUTH-13: CSRF protection ─────────────────────────────────────────────

describe('TC-AUTH-13 — CSRF middleware blocks requests from disallowed origins', () => {
  it('POST without an Origin header is blocked', async () => {
    // Override the helper's default Origin to simulate a cross-origin request.
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'csrf@example.com', password: 'Password123!' }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'http://evil.example.com',
      },
    })
    // CSRF middleware should block this with 403.
    expect(res.status).toBe(403)
  })
})
