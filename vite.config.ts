import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so dist/ works from any static host path.
  base: './',
  build: { chunkSizeWarningLimit: 1200 }, // three + model-viewer are one ~1 MB bundle
  server: {
    // During development the scan server (npm run server) runs on 8787.
    proxy: { '/api': 'http://localhost:8787', '/custom-models': 'http://localhost:8787' },
    // Allow HTTPS tunnels (e.g. Cloudflare quick tunnels) to reach the dev server.
    allowedHosts: ['.trycloudflare.com'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
