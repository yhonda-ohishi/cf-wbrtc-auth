import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.toml' },
        miniflare: {
          // Add KV bindings for testing
          kvNamespaces: ['KV'],
          // Add secrets for testing
          bindings: {
            JWT_SECRET: 'test-jwt-secret',
            GOOGLE_CLIENT_SECRET: 'test-google-secret',
          },
        },
      },
    },
  },
});
