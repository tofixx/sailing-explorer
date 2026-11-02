// Vorschau-Deployment für einen Branch: eigener Worker unter dev-<branch>.segeln-potsdam.de,
// eigene Vorschau-Datenbank und eigener Bucket – die Produktion bleibt unberührt.
//
//   node scripts/deploy-preview.mjs deploy <branch>   (nach `npm run build`)
//   node scripts/deploy-preview.mjs delete <branch>
//   node scripts/deploy-preview.mjs prune            (entfernt Vorschauen, deren Branch es nicht mehr gibt)
//
// Braucht CLOUDFLARE_API_TOKEN (wie der Produktions-Deploy). Anmeldung/Teilen sind in der
// Vorschau absichtlich gesperrt (keine Secrets, Fail-closed) – sie dient der Oberfläche.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG = 'dist/sailing_explorer/wrangler.json';
const DB_NAME = 'sailing-explorer-preview';
const BUCKET = 'sailing-explorer-tracks-preview';
const ZONE = 'segeln-potsdam.de';
const PROD = 'sailing-explorer';

const [action, branch] = process.argv.slice(2);
if (!action || (!branch && action !== 'prune')) {
  console.error('Aufruf: node scripts/deploy-preview.mjs <deploy|delete> <branch> | prune');
  process.exit(2);
}

/** feature/share-image → share-image */
export function slug(name) {
  return name
    .toLowerCase()
    .replace(/^(feature|feat|fix|chore|refactor)\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

const wrangler = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32', ...opts });

// Worker direkt über die Cloudflare-API löschen: `wrangler delete` prüft zusätzlich KV-Namespaces und braucht dafür
// eine Berechtigung, die das CI-Token nicht hat (Workers Scripts:Edit genügt hier). 404 = gab es schon nicht mehr.
const account = /"account_id":\s*"([0-9a-f]+)"/.exec(readFileSync('wrangler.jsonc', 'utf8'))?.[1];
const cfApi = (path, init = {}) =>
  fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, ...init.headers },
  });
async function deleteWorker(name) {
  if (name === PROD) throw new Error('Die Produktion wird nie gelöscht.');
  const res = await cfApi(`/workers/scripts/${encodeURIComponent(name)}?force=true`, { method: 'DELETE' });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Löschen von ${name} fehlgeschlagen (${res.status}): ${await res.text()}`);
  return true;
}

// Vorschauen ohne Branch entfernen: Branches werden ohne Pull Request gemergt und gelöscht, dann greift
// preview-cleanup nicht. Läuft nach jedem Produktions-Deploy. Fail-safe: ohne Branch-Liste (oder ohne main darin)
// wird nichts gelöscht, die Produktion nie.
if (action === 'prune') {
  const heads = execFileSync('git', ['ls-remote', '--heads', 'origin'], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.split('refs/heads/')[1])
    .filter(Boolean);
  if (!heads.includes('main')) {
    console.error('Branch-Liste unvollständig – nichts entfernt.');
    process.exit(0);
  }
  const keep = new Set(heads.map((h) => `${PROD}-${slug(h)}`));
  const res = await cfApi('/workers/scripts');
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(`Worker-Liste nicht lesbar (${res.status})`);
  for (const { id } of body.result) {
    if (id === PROD || !id.startsWith(`${PROD}-`) || keep.has(id)) continue;
    if (await deleteWorker(id)) console.log(`Vorschau ${id} entfernt (Branch existiert nicht mehr).`);
  }
  process.exit(0);
}

const s = slug(branch);
if (!s || s === 'main') {
  console.error(`Kein Vorschau-Name für Branch „${branch}“.`);
  process.exit(2);
}
const workerName = `sailing-explorer-${s}`;
const host = `dev-${s}.${ZONE}`;

if (action === 'delete') {
  console.log((await deleteWorker(workerName)) ? `Vorschau ${workerName} entfernt.` : `Vorschau ${workerName} gab es nicht (mehr).`);
  process.exit(0);
}

// 1. Vorschau-Datenbank und -Bucket sicherstellen (idempotent)
let db = JSON.parse(wrangler(['d1', 'list', '--json'])).find((d) => d.name === DB_NAME);
if (!db) {
  wrangler(['d1', 'create', DB_NAME, '--location', 'weur']);
  db = JSON.parse(wrangler(['d1', 'list', '--json'])).find((d) => d.name === DB_NAME);
}
if (!db) throw new Error('Vorschau-Datenbank konnte nicht angelegt werden');
try {
  wrangler(['r2', 'bucket', 'create', BUCKET]);
} catch {
  // existiert bereits
}

// 2. Erzeugte Deploy-Konfiguration auf die Vorschau umschreiben
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
cfg.name = workerName;
// Zone-Route statt Custom Domain: die Wildcard-Route der Produktion (*.segeln-potsdam.de/*) ginge sonst vor; das
// spezifischere Muster gewinnt. DNS deckt der proxied *-Eintrag ab.
cfg.routes = [{ pattern: `${host}/*`, zone_name: ZONE }];
cfg.d1_databases = cfg.d1_databases.map((d) => ({ ...d, database_name: DB_NAME, database_id: db.uuid }));
cfg.r2_buckets = cfg.r2_buckets.map((b) => ({ ...b, bucket_name: BUCKET }));
cfg.vars = { ...cfg.vars, APP_NAME: `Sail Explorer (Vorschau ${s})`, APP_ORIGIN: `https://${host}`, CANONICAL_HOST: '', ALIAS_HOSTS: '' };
// Kein nächtlicher Cron in Vorschauen (Free-Tier: wenige Cron-Trigger pro Account)
cfg.triggers = { crons: [] };
writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));

// 3. Migrationen und Deploy
wrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote', '--config', CONFIG], { stdio: 'inherit' });
wrangler(['deploy', '--config', CONFIG], { stdio: 'inherit' });
console.log(`\nVorschau: https://${host}`);
