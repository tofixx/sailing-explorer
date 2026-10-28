import { css } from 'lit';

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

  input[type='text'],
  input[type='email'],
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
