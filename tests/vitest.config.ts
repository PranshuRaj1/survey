/**
 * Vitest configuration for the survey API test suite.
 *
 * Uses @cloudflare/vitest-pool-workers to run tests inside a real workerd
 * sandbox — the same runtime as production. Each test gets isolated D1/KV
 * storage (isolatedStorage: true) so there is no cross-test pollution.
 *
 * Run:
 *   pnpm test              — single run
 *   pnpm test:watch        — watch mode
 *   pnpm test:coverage     — with V8 coverage report
 */
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // Point at the test-only wrangler config that uses in-memory D1/KV.
        // This is SEPARATE from api/wrangler.jsonc and has no effect on deploys.
        wrangler: {
          configPath: './wrangler.test.toml',
        },

        // Each individual `it()` test receives its own isolated D1 + KV state.
        // Migrations are applied in beforeEach() inside each test file.
        isolatedStorage: true,

        // Share one worker process per test file (faster than one per test).
        singleWorker: true,

        miniflare: {
          // vitest-pool-workers requires compatibilityDate >= 2022-10-31.
          // Do NOT add export_commonjs_default here — it became the default on
          // this date and workerd will error if it's explicitly re-specified.
          compatibilityDate: '2026-05-22',
        },
      },
    },

    // Coverage using Istanbul engine (required for Cloudflare Workers vitest pool)
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html', 'json-summary'],
      include: ['../api/src/**/*.ts'],
      exclude: ['../api/src/types.ts'],
      all: true,
      allowExternal: true,
    },
  },
})
