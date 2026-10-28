// Erzeugt ein VAPID-Schlüsselpaar für Web Push (Konzept 17.7). Einmal ausführen, dann beide Werte als Secrets setzen:
//
//   node scripts/vapid-keys.mjs
//   npx wrangler secret put VAPID_PUBLIC_KEY    (öffentlicher Schlüssel, 65 Byte base64url)
//   npx wrangler secret put VAPID_PRIVATE_KEY   (privater Schlüssel `d`, base64url – nie einchecken)
//
// Lokal: beide Zeilen in .dev.vars. Ein neues Paar macht alle bestehenden Push-Abos ungültig.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${d}`);
