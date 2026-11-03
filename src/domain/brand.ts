// Markenname an einer Stelle (F-515). Bis 03.11.2026 hieß die App „Sail Explorer“; Kennungen wie IndexedDB-Name,
// Speicher-Schlüssel, Cookies, Cloudflare-Ressourcen und die Domain behalten den alten Namen bewusst (sonst gingen
// Sitzungen und Gast-Daten verloren). `index.html`, `public/manifest.webmanifest`, `public/sw.js` und `APP_NAME` in
// `wrangler.jsonc` (Mails, Seitentitel des Workers) nennen den Namen statisch – der Test zu F-515 hält sie gleich.

/** Sichtbarer Name der App. Enthält „&“: in HTML/XML escapen (Lit und HTMLRewriter tun das selbst). */
export const APP_NAME = 'Luv & Leute';
