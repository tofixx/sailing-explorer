// Vorschau-Deployment für einen Branch: eigener Worker unter dev-<branch>.segeln-potsdam.de,
// eigene Vorschau-Datenbank und eigener Bucket – die Produktion bleibt unberührt.
//
//   node scripts/deploy-preview.mjs deploy <branch>   (nach `npm run build`)
//   node scripts/deploy-preview.mjs delete <branch>
//
// Braucht CLOUDFLARE_API_TOKEN (wie der Produktions-Deploy). Anmeldung/Teilen sind in der
// Vorschau absichtlich gesperrt (keine Secrets, Fail-closed) – sie dient der Oberfläche.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG = 'dist/sailing_explorer/wrangler.json';
const DB_NAME = 'sailing-explorer-preview';
const BUCKET = 'sailing-explorer-tracks-preview';
const ZONE = 'segeln-potsdam.de';

const [action, branch] = process.argv.slice(2);
if (!action || !branch) {
  console.error('Aufruf: node scripts/deploy-preview.mjs <deploy|delete> <branch>');
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

const s = slug(branch);
if (!s || s === 'main') {
  console.error(`Kein Vorschau-Name für Branch „${branch}“.`);
  process.exit(2);
}
const workerName = `sailing-explorer-${s}`;
const host = `dev-${s}.${ZONE}`;

const wrangler = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32', ...opts });

if (action === 'delete') {
  try {
    wrangler(['delete', '--name', workerName, '--force']);
    console.log(`Vorschau ${workerName} entfernt.`);
  } catch {
    console.log(`Vorschau ${workerName} gab es nicht (mehr).`);
  }
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
