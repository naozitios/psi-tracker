import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Hits the real data.gov.sg API to confirm the response still matches the parser.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
