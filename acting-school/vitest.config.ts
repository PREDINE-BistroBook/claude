import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@server': r('./src/server'),
      '@web': r('./src/web'),
    },
  },
  test: {
    include: ['tests/api/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    // UTC, like Cloudflare Workers: the server must take "today" from the school's time zone (lib/clock.ts).
    // ACTING_SCHOOL_DO_LIMITS: every database createDb opens (in tests and in the `npm run seed`
    // subprocess) fails queries over the Durable Object limits (lib/sqlLimits.ts).
    env: { TZ: 'UTC', ACTING_SCHOOL_DO_LIMITS: '1' },
    testTimeout: 20000,
  },
});
