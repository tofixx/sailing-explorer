/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ mode }) => ({
  // Für Unit-Tests wird kein Worker-Runtime benötigt.
  plugins: mode === 'test' ? [] : [cloudflare()],
  server: { host: true, port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
}));
