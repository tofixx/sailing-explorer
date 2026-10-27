import { LitElement, html, css, type PropertyValues } from 'lit';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

/** Hängt den Bot-Schutz in ein Element ein; liefert eine Aufräumfunktion. */
export type CaptchaMount = (el: HTMLElement, onToken: (token: string | null) => void) => Promise<() => void>;

/**
 * Anmeldung per Magic Link in drei Zuständen:
 *  form    – E-Mail eingeben
 *  sent    – Link verschickt; Code aus der Mail eintippen (sx-login-code { code })
 *  confirm – Link geöffnet: „Als … anmelden?“ (Schutz gegen untergeschobene Links)
 */
export class SxLoginDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    reason: { type: String },
    busy: { type: Boolean },
    error: { type: String },
    sentTo: { type: String },
    devCode: { type: String },
    devLink: { type: String },
    confirmEmail: { type: String },
    currentEmail: { type: String },
    captcha: { state: true },
  };
  declare open: boolean;
  declare reason: string;
  declare busy: boolean;
  declare error: string;
  declare sentTo: string;
  declare devLink: string;
  /** nur lokal im Log-Modus: der Code (Test ohne Mailserver) */
  declare devCode: string;
  declare confirmEmail: string;
  declare currentEmail: string;
  declare captcha: string | null;
  /** Wird von außen gesetzt; ohne Mount kein Bot-Schutz im Formular. */
  mountCaptcha: CaptchaMount | null = null;
  private unmount: (() => void) | null = null;

  constructor() {
    super();
    this.open = false;
    this.reason = '';
    this.busy = false;
    this.error = '';
    this.sentTo = '';
    this.devCode = '';
    this.devLink = '';
    this.confirmEmail = '';
    this.currentEmail = '';
    this.captcha = null;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      .ts {
        min-height: 65px;
      }
      form.code {
        display: grid;
        gap: var(--s-2);
        padding-top: var(--s-3);
        border-top: 1px solid var(--border-soft);
      }
      form.code .row {
        display: flex;
        gap: var(--s-2);
      }
      form.code input {
        flex: 1;
        min-width: 0;
        font-size: 1.25rem;
        letter-spacing: 0.2em;
        font-variant-numeric: tabular-nums;
      }
      .small {
        font-size: var(--fs-s);
      }
      .center {
        text-align: center;
        display: grid;
        gap: var(--s-3);
        justify-items: center;
        padding: var(--s-2) 0;
      }
      .badge {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: var(--accent-soft);
        color: var(--accent);
        display: grid;
        place-items: center;
      }
      .badge svg {
        width: 26px;
        height: 26px;
      }
      .dev {
        font-size: var(--fs-s);
        word-break: break-all;
      }
      .email {
        font-weight: 700;
        word-break: break-all;
      }
    `,
  ];

  private get state(): 'form' | 'sent' | 'confirm' {
    return this.confirmEmail ? 'confirm' : this.sentTo ? 'sent' : 'form';
  }

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) dlg.showModal();
      else if (!this.open && dlg.open) dlg.close();
    }
    const needCaptcha = this.open && this.state === 'form';
    if (needCaptcha && !this.unmount) this.attachCaptcha();
    if (!needCaptcha && this.unmount) {
      this.unmount();
      this.unmount = null;
    }
  }

  private async attachCaptcha() {
    const el = this.renderRoot.querySelector<HTMLElement>('.ts');
    if (!el || !this.mountCaptcha) return;
    this.unmount = () => {}; // Platzhalter gegen doppeltes Einhängen
    this.captcha = null;
    try {
      this.unmount = await this.mountCaptcha(el, (t) => (this.captcha = t));
    } catch {
      // Ohne Bot-Schutz weiter; der Server lehnt ab, falls er einen verlangt.
    }
  }

  private submit(e: Event) {
    e.preventDefault();
    const email = (this.renderRoot.querySelector('input[type=email]') as HTMLInputElement).value;
    emit(this, 'sx-login-submit', { email, turnstile: this.captcha });
  }

  private close = () => emit(this, 'sx-close', 'login');

  private submitCode(e: Event) {
    e.preventDefault();
    const code = String(new FormData(e.target as HTMLFormElement).get('code') ?? '').replace(/\s/g, '');
    if (code) emit(this, 'sx-login-code', { code });
  }

  private body() {
    switch (this.state) {
      case 'confirm':
        return html`<div class="body">
          <div class="center">
            <div class="badge">${icon('user')}</div>
            <p>Anmelden als<br /><span class="email">${this.confirmEmail}</span>?</p>
            ${this.currentEmail && this.currentEmail !== this.confirmEmail
              ? html`<p class="muted">Du bist gerade als <b>${this.currentEmail}</b> angemeldet und wirst abgemeldet.</p>`
              : ''}
          </div>
          <div class="note">${icon('info')}<span>Nur bestätigen, wenn du den Link selbst angefordert hast.</span></div>
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          <div class="actions">
            <button class="btn" @click=${this.close}>Abbrechen</button>
            <button class="btn primary" ?disabled=${this.busy} @click=${() => emit(this, 'sx-login-confirm')}>${icon('check')} ${this.busy ? 'Melde an …' : 'Anmelden'}</button>
          </div>
        </div>`;
      case 'sent':
        return html`<div class="body">
          <div class="center">
            <div class="badge">${icon('mail')}</div>
            <p><b>Prüf dein Postfach.</b><br /><span class="muted">Wir haben einen Anmeldelink an <b>${this.sentTo}</b> geschickt. Er ist 15 Minuten gültig. Nach dem Klick bist du angemeldet – auch in diesem Tab.</span></p>
          </div>
          ${this.devLink ? html`<div class="note warn"><span class="dev">Entwicklungsmodus – kein Mailversand:<br /><a href=${this.devLink}>${this.devLink}</a>${this.devCode ? html`<br />Code: ${this.devCode}` : ''}</span></div>` : ''}
          <form class="code" @submit=${this.submitCode}>
            <label class="label" for="code">Oder den Code aus der Mail eingeben</label>
            <div class="row">
              <input id="code" name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="\\d{3} ?\\d{3}" maxlength="7" placeholder="123 456" />
              <button class="btn primary" type="submit" ?disabled=${this.busy}>${icon('check')} ${this.busy ? 'Melde an …' : 'Anmelden'}</button>
            </div>
            <span class="muted small">Praktisch in der App auf dem Home-Bildschirm oder wenn die Mail auf einem anderen Gerät ankommt.</span>
          </form>
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          <div class="actions"><button class="btn" @click=${() => emit(this, 'sx-login-reset')}>Andere Adresse</button></div>
        </div>`;
      default:
        return html`<form class="body" @submit=${this.submit}>
          <p class="muted">${this.reason || 'Melde dich mit deiner E-Mail-Adresse an. Du bekommst einen Link – ohne Passwort.'}</p>
          <div>
            <label class="label" for="email">E-Mail-Adresse</label>
            <input id="email" type="email" required autocomplete="email" inputmode="email" placeholder="du@example.org" maxlength="254" />
          </div>
          ${this.mountCaptcha ? html`<div class="ts"></div>` : ''}
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          <div class="note">${icon('info')}<span>Wir speichern nur deine E-Mail-Adresse, um dir deine Tracks zuzuordnen. Kein Newsletter, keine Weitergabe.</span></div>
          <div class="actions">
            <button type="button" class="btn" @click=${this.close}>Abbrechen</button>
            <button type="submit" class="btn primary" ?disabled=${this.busy}>${icon('mail')} ${this.busy ? 'Sende …' : 'Link senden'}</button>
          </div>
        </form>`;
    }
  }

  render() {
    return html`<dialog aria-labelledby="h" @close=${this.close}>
      <header>
        <h2 id="h">Anmelden</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      ${this.body()}
    </dialog>`;
  }
}
customElements.define('sx-login-dialog', SxLoginDialog);
