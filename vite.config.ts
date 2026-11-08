import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so dist/ works from any static host path.
  base: './',
  build: { chunkSizeWarningLimit: 1200 }, // three + model-viewer are one ~1 MB bundle
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
