import { css, html } from 'lit';
import { icon, type IconName } from './icons';
import type { CoverRef } from '../domain/cover';
import { linkify } from '../domain/comment-text';
import type { PostVisibility } from '../domain/posts';

/** Gemeinsame Grundstile aller Komponenten – nutzt ausschließlich Tokens. */
export const base = css`
  :host {
    font-family: var(--font);
    color: var(--text);
  }
  * {
    box-sizing: border-box;
  }
  [hidden] {
    display: none !important;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    min-height: var(--control-h);
    padding: 0 var(--s-3);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: 600 var(--fs-m) / 1 var(--font);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s var(--ease), border-color 0.15s var(--ease), color 0.15s var(--ease);
    text-decoration: none;
  }
  .btn:hover {
    background: var(--surface-hover);
  }
  .btn:focus-visible,
  input:focus-visible,
  select:focus-visible,
  button:focus-visible,
  a:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .btn.primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .btn.ghost {
    border-color: transparent;
    background: transparent;
  }
  .btn.ghost:hover {
    background: var(--surface-hover);
  }
  .btn.danger {
    color: var(--err);
  }
  .btn.icon {
    padding: 0;
    width: var(--control-h);
  }
  .btn.small {
    min-height: var(--control-h-s);
    font-size: var(--fs-s);
    padding: 0 var(--s-2);
  }
  .btn.small.icon {
    width: var(--control-h-s);
  }
  .btn[disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* alle Eingabefelder im selben Raster – auch Suche (Entdecken, Auswahllisten), Adressen und Zahlen */
  input[type='text'],
  input[type='email'],
  input[type='search'],
  input[type='url'],
  input[type='number'],
  select {
    width: 100%;
    min-height: max(38px, var(--control-h));
    padding: 0 var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: var(--fs-m) var(--font);
  }
  input:focus,
  select:focus {
    border-color: var(--accent);
  }

  .label {
    display: block;
    font-size: var(--fs-s);
    font-weight: 600;
    color: var(--text-2);
    margin-bottom: var(--s-1);
  }
  .muted {
    color: var(--text-2);
  }
  .faint {
    color: var(--text-3);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  svg.i {
    width: 18px;
    height: 18px;
    flex: none;
  }
  /* Kleine Abschnittsüberschrift (Seitenleiste, Dialoge) */
  .eyebrow {
    margin: 0;
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 700;
    text-transform: uppercase;
  }
  .hint {
    font-size: var(--fs-s);
    color: var(--text-3);
    margin-top: var(--s-1);
  }
  /* Abzeichen „Fahrtenbuch“ (Konzept 19, F-302) */
  .logtag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--border-soft);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    vertical-align: middle;
  }
  .logtag svg {
    width: 12px;
    height: 12px;
  }
`;

/** Abzeichen „Fahrtenbuch“: Törn ohne GPS-Aufzeichnung (F-302) – Stil `.logtag` aus `base`. */
export const logbookTag = () =>
  html`<span class="logtag" title="Ohne GPS-Aufzeichnung – Strecke vom Segler angegeben">${icon('book')} Fahrtenbuch</span>`;

/**
 * Seite über der Karte (F-351, Hafen- und Vereinsseite mit Ort): Hintergrund durchsichtig, der Inhalt als Tafel mit
 * Abstand oben, damit der Ort auf der Karte darüber sichtbar bleibt. Gesetzt über das Attribut `on-map`.
 */
export const onMapStyles = css`
  :host([on-map]) {
    background: transparent;
  }
  :host([on-map]) .page {
    margin-top: min(34vh, 300px);
    margin-bottom: var(--s-6);
    background: var(--overlay);
    backdrop-filter: blur(10px) saturate(1.2);
    border: 1px solid var(--border);
    border-radius: var(--radius-l);
    box-shadow: var(--shadow-2);
  }
  @media (max-width: 760px) {
    :host([on-map]) .page {
      margin: min(30vh, 220px) var(--s-2) var(--s-4);
    }
  }
`;

/** Gemeinsame Dialog-Stile für native <dialog>-Elemente. */
export const dialogStyles = css`
  dialog {
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-l);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-2);
  }
  dialog::backdrop {
    background: var(--backdrop);
    backdrop-filter: blur(2px);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-4) var(--s-4) var(--s-2) var(--s-5);
  }
  header h2 {
    flex: 1;
    margin: 0;
    font-size: var(--fs-l);
    letter-spacing: -0.01em;
  }
  .body {
    padding: var(--s-2) var(--s-5) var(--s-5);
    display: grid;
    gap: var(--s-4);
  }
  .actions {
    display: flex;
    gap: var(--s-2);
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .note {
    font-size: var(--fs-s);
    color: var(--text-2);
    background: var(--surface-2);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
    padding: var(--s-3);
    display: flex;
    gap: var(--s-2);
    line-height: 1.5;
  }
  .note.warn {
    background: var(--warn-bg);
    border-color: transparent;
  }
  .error {
    color: var(--err);
    font-size: var(--fs-s);
  }
  p {
    margin: 0;
  }
  /* Handy (F-291): randlos als Vollbild statt schwebendem Fenster; der Inhalt scrollt, der Kopf mit „Schließen“ bleibt
     stehen. Steht am Ende, damit es die Grundregeln oben schlägt;
     dialog[open] schlägt die Breiten der einzelnen Dialoge. */
  @media (max-width: 760px) {
    dialog[open] {
      width: 100%;
      max-width: 100%;
      height: 100vh;
      height: 100dvh;
      max-height: 100vh;
      max-height: 100dvh;
      margin: 0;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    dialog::backdrop {
      backdrop-filter: none;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--surface);
      border-bottom: 1px solid var(--border-soft);
      padding-top: calc(var(--s-3) + env(safe-area-inset-top, 0px));
      padding-bottom: var(--s-3);
    }
    .body {
      padding: var(--s-4);
    }
  }
`;

/**
 * Titelbild-Streifen (Konzept 13.2): überall dasselbe 3:1-Banner (`COVER_BANNER_RATIO`) mit dem gespeicherten
 * Ausschnitt – im Seitenkopf (sx-cover), auf /entdecken und in den Neuigkeiten, damit der Eigner überall denselben
 * Ausschnitt sieht, den er im Kopf eingestellt hat (F-211, F-330). Feste Breite ohne Mindestbreite aus der Datei.
 */
export const coverBannerStyles = css`
  .cover-banner {
    display: block;
    width: 100%;
    min-width: 0;
    max-width: none;
    height: auto;
    aspect-ratio: 3 / 1;
    object-fit: cover;
    background: var(--surface-2);
  }
`;

/** Ausschnitt eines Titelbilds: horizontal mittig, vertikal die gespeicherte Fokus-Position (F-211). */
export function coverPosition(y: number): string {
  return `object-position: 50% ${y}%`;
}

/** Titelbild als Streifen in Listen (Entdecken, Neuigkeiten) – braucht `coverBannerStyles`. */
export function coverBanner(cover: CoverRef, cls = '') {
  return html`<img class="cover-banner ${cls}" src=${cover.src} style=${coverPosition(cover.y)} alt="" loading="lazy" decoding="async" />`;
}

/** Eingabe „E-Mail oder Profilname“: mit @ in der Mitte eine Adresse, sonst ein Profilname (führendes @ erlaubt). */
export function inviteTarget(raw: string): { email: string } | { handle: string } {
  const v = raw.trim();
  return v.indexOf('@') > 0 ? { email: v } : { handle: v.replace(/^@/, '') };
}

/** Name einer offenen Einladung: eingeladenes Konto, selbst eingegebene Adresse oder Einladungslink. */
export function pendingLabel(i: { email: string | null; invitee: { handle: string; displayName: string } | null; usesLeft: number }): string {
  if (i.invitee) return `${i.invitee.displayName} (@${i.invitee.handle})`;
  return i.email ?? `Einladungslink · noch ${i.usesLeft}×`;
}

/** Öffnet die Dateiauswahl für GPX-Dateien und meldet die Auswahl als 'sx-files'. */
export function pickGpx(host: HTMLElement): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gpx,application/gpx+xml';
  input.multiple = true;
  input.addEventListener('change', () => input.files?.length && emit(host, 'sx-files', input.files));
  input.click();
}

export function emit<T>(el: HTMLElement, name: string, detail?: T): void {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

/** Beitragstext mit klickbaren http(s)-Links – Lit escaped alle Textstücke, nie `innerHTML` (Sicherheit 2). */
export function linkedText(t: string) {
  return linkify(t).map((p) => (p.href ? html`<a href=${p.href} rel="nofollow ugc noopener noreferrer" target="_blank">${p.text}</a>` : p.text));
}

/**
 * Karte `p-<id>` in einer Liste in den Blick holen (Anker aus `/p/<id>`, neue Karte nach dem Schreiben, F-406). Liefert
 * true, wenn sie gerendert ist; der Aufrufer merkt sich das, damit späteres Nachladen nicht erneut springt.
 */
export function revealCard(root: ShadowRoot | HTMLElement, id: string): boolean {
  const el = root.querySelector<HTMLElement>(`#p-${CSS.escape(id)}`);
  if (!el) return false;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  el.focus({ preventScroll: true });
  return true;
}

/** Hervorgehobene Karte (`.hl`): Rahmen in Akzentfarbe, verblasst langsam. */
export const highlightStyles = css`
  .hl {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .hl:focus {
    outline: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .hl {
      animation: hl-fade 3s var(--ease) 1.5s forwards;
    }
    @keyframes hl-fade {
      to {
        border-color: var(--border-soft);
        box-shadow: none;
      }
    }
  }
`;

/** Symbol je Beitrags-Sichtbarkeit („Wer sieht es“, Konzept 21). */
export const POST_VISIBILITY_ICON: Record<PostVisibility, IconName> = { public: 'globe', members: 'community', unlisted: 'link', private: 'lock' };

/**
 * Aufklapp-Menü am Zahnrad (Kartenstil, „Ansehen als …“): Tafel, Überschrift, Einträge mit `aria-pressed`. Die Lage
 * der Tafel (über bzw. unter dem Knopf) setzt jede Komponente selbst; mobil kommt sie als Sheet vom unteren Rand.
 */
export const menuStyles = css`
  .menu {
    position: absolute;
    right: 0;
    width: min(300px, calc(100vw - 24px));
    padding: var(--s-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--shadow-2);
    display: grid;
    gap: 2px;
    z-index: 20;
  }
  @media (max-width: 760px) {
    .menu {
      position: fixed;
      inset: auto 0 0 0;
      width: 100%;
      border-radius: var(--radius-l) var(--radius-l) 0 0;
      padding-bottom: var(--s-3);
    }
  }
  .title {
    margin: var(--s-2) var(--s-2) var(--s-1);
    font-size: var(--fs-s);
    color: var(--text-2);
    font-weight: 600;
  }
  .item {
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 2px var(--s-2);
    align-items: center;
    width: 100%;
    min-height: 44px;
    padding: var(--s-1) var(--s-2);
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: 500 var(--fs-m) / 1.3 var(--font);
    text-align: left;
    cursor: pointer;
  }
  .item:hover:not([disabled]) {
    background: var(--surface-hover);
  }
  .item[aria-pressed='true'] {
    background: var(--surface-2);
    font-weight: 650;
  }
  .item .mark {
    color: var(--accent);
    display: flex;
  }
  .item small {
    font-weight: 500;
    color: var(--text-2);
    margin-left: var(--s-1);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--border-soft);
    margin: var(--s-1) 0;
  }
  .hint,
  .error {
    margin: var(--s-1) var(--s-2);
    font-size: var(--fs-s);
    line-height: 1.4;
  }
  .hint {
    color: var(--text-2);
  }
  .error {
    color: var(--err);
  }
`;

/**
 * Nach dem Austreten (F-446): „Weiter folgen?“ – nur bei öffentlichen Gruppen (nur denen kann man folgen). Ja → Folgen
 * mit „Nur Direktes“, Nein → nichts.
 */
export const offerFollow = (g: { visibility: string; name: string }): boolean =>
  g.visibility === 'public' && confirm(`„${g.name}“ weiter folgen? Du siehst dann ihre öffentlichen Neuigkeiten – Benachrichtigungen nur für Direktes.`);

/** Karten der Beitragslisten (eigene Seite „Mein Verlauf“, Beiträge für Besucher). */
export const postCardStyles = css`
  ol.posts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-3);
  }
  .post {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border-soft);
    min-width: 0;
  }
  .post.private {
    border-style: dashed;
  }
  .post .head {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
  }
  .post .head .t {
    font-weight: 650;
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .post .head .t a {
    color: inherit;
  }
  .post .body {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.5;
  }
  .post .body a,
  .post .link {
    color: var(--accent);
    overflow-wrap: anywhere;
  }
  .post .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-3);
    font-size: var(--fs-s);
    color: var(--text-2);
  }
  .post .meta span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .post .meta svg {
    width: 14px;
    height: 14px;
  }
  .post .meta b {
    font-weight: 600;
    color: var(--text);
  }
  .post .tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    align-items: center;
  }
  .more {
    display: flex;
    justify-content: center;
    margin-top: var(--s-3);
  }
  .empty {
    padding: var(--s-4);
    text-align: center;
    color: var(--text-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }
`;

/**
 * „Beitrag schreiben“ auf Gruppen-, Hafen- und Bootsseiten (F-405): öffnet „+ Neu → Text“ mit dem Verlauf der Seite
 * (derselbe Weg wie die Kopfzeile, kein eigenes Formular). Nur zeigen, wer dort schreiben darf.
 */
export const writePostButton = (host: HTMLElement) =>
  html`<button class="btn small primary" type="button" @click=${() => emit(host, 'sx-compose-open', { kind: 'text' })}>${icon('pencil')} Beitrag schreiben</button>`;

/**
 * Zahnrad-Menü der Seite (sx-page-menu, N6): mit Maus erst bei Hover bzw. Fokus über Kopf oder Titelbild sichtbar,
 * auf Touch-Geräten immer. Für Seiten mit `.hero` (und davor ggf. `sx-cover`).
 */
export const pageMenuReveal = css`
  @media (hover: hover) and (pointer: fine) {
    .hero sx-page-menu {
      opacity: 0;
      transition: opacity 0.15s var(--ease);
    }
    .hero:hover sx-page-menu,
    .hero:focus-within sx-page-menu,
    sx-cover:hover + .hero sx-page-menu,
    .hero sx-page-menu[open] {
      opacity: 1;
    }
  }
`;
