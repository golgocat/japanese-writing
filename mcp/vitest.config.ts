import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: './wrangler.jsonc', environment: '' },
    remoteBindings: false,
    miniflare: { bindings: {
      APP_ORIGIN: 'https://mcp.example.test',
      GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'mock-only-not-a-credential',
      OWNER_EMAIL: 'owner@example.test',
      TEST_MIGRATIONS: await readD1Migrations('./migrations'),
    } },
  }))],
  test: { include: ['test/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 20_000, fileParallelism: false },
});
