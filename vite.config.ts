/// <reference types="vitest/config" />
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Freigegebene Ordner für Dev-Server und Vitest: der Standard (Workspace-Wurzel) plus der echte Pfad von
 * `node_modules`. Ist `node_modules` eine Junction auf einen anderen Worktree, lehnt Vite sonst Importe wie
 * `leaflet.css?inline` ab („Denied ID …“), weil der aufgelöste Pfad außerhalb des Projekts liegt. Freigegeben wird nur
 * dieser eine Ordner mit denselben Paketen – nicht der übrige Worktree.
 */
function fsAllow(): string[] {
  const allow = [searchForWorkspaceRoot(root)];
  try {
    allow.push(realpathSync(new URL('node_modules', import.meta.url)));
  } catch {
    // noch kein npm ci – nichts zusätzlich freigeben
  }
  return allow;
}

export default defineConfig(({ mode }) => ({
  // Für Unit-Tests wird kein Worker-Runtime benötigt.
  plugins: mode === 'test' ? [] : [cloudflare()],
  server: { host: true, port: 5173, strictPort: true, fs: { allow: fsAllow() } },
  build: { target: 'es2022', sourcemap: false },
  // testTimeout: Worker-Tests (Miniflare) laufen parallel – unter Last brauchen einzelne mehr als die Standard-5 s.
  test: { include: ['test/**/*.test.ts'], environment: 'node', globalSetup: ['test/global-setup.ts'], testTimeout: 30_000 },
}));
