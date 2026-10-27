import { inviteAcceptedText, inviteExplain, inviteTargetLabel, inviteWhat } from '../domain/invite-text';
import { LitElement, html, css, type PropertyValues } from 'lit';
import type { InviteAccepted, InvitePeek } from '../services/api';
import { fmtDate } from '../util/html';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';

/**
 * Einladung annehmen (Konzept 10.2) – reine Darstellung, Aktionen gehen als Events raus:
 *  loading – Einladung wird geladen
 *  error   – ungültig/abgelaufen
 *  ready   – zeigen; anmelden, Profil anlegen oder ausdrücklich „Annehmen“
 *  done    – angenommen
 */
export class SxInviteDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    state: { type: String },
    peek: { attribute: false },
    result: { attribute: false },
    signedIn: { type: Boolean },
    userEmail: { type: String },
    busy: { type: Boolean },
    error: { type: String },
    errorCode: { type: String },
  };
  declare open: boolean;
  declare state: 'loading' | 'error' | 'ready' | 'done';
  declare peek: InvitePeek | null;
  declare result: InviteAccepted | null;
  declare signedIn: boolean;
  declare userEmail: string;
  declare busy: boolean;
  declare error: string;
  /** Fehlercode vom Server, z. B. invite_wrong_account */
  declare errorCode: string;

  constructor() {
    super();
    this.open = false;
    this.state = 'loading';
    this.peek = null;
    this.result = null;
    this.signedIn = false;
    this.userEmail = '';
    this.busy = false;
    this.error = '';
    this.errorCode = '';
  }

  static styles = [
    base,
    dialogStyles,
    css`
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
      .target {
        font-weight: 700;
        word-break: break-word;
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) dlg.showModal();
      else if (!this.open && dlg.open) dlg.close();
    }
  }

  private close = () => emit(this, 'sx-close', 'invite');

  /** Was als Nächstes zu tun ist: anmelden, andere Adresse, Profil anlegen oder annehmen. */
  private next(p: InvitePeek) {
    const cancel = html`<button class="btn" @click=${this.close}>Später</button>`;
    if (p.isOwner) {
      const own =
        p.kind === 'crew' ? 'Das ist dein eigener Törn. Teile den Link mit deiner Crew.'
        : p.kind === 'group' ? 'Das ist deine eigene Gruppe. Teile den Link mit deinen Leuten.'
        : p.kind === 'friend' ? 'Das ist deine eigene Einladung. Teile den Link mit deinen Freunden.'
        : 'Du bist der Eigner dieses Boots. Die Einladung gilt nur für die eingeladene Adresse.';
      return html`<div class="note">${icon('info')}<span>${own}</span></div>
        <div class="actions"><button class="btn" @click=${this.close}>Schließen</button></div>`;
    }
    if (p.alreadyMember) {
      return html`<div class="note">${icon('check')}<span>Du bist schon dabei.</span></div>
        <div class="actions"><button class="btn" @click=${this.close}>Schließen</button></div>`;
    }
    if (!this.signedIn) {
      return html`<div class="note">${icon('mail')}<span>Zum Annehmen meldest du dich ${p.bound ? 'mit der E-Mail-Adresse an, an die die Einladung ging' : 'mit deiner E-Mail-Adresse an'} – ohne Passwort, per Link.</span></div>
        <div class="actions">${cancel}<button class="btn primary" @click=${() => emit(this, 'sx-invite-login')}>${icon('user')} Anmelden</button></div>`;
    }
    if (p.emailMatches === false) {
      return html`<div class="note warn">${icon('info')}<span>Diese Einladung gilt für eine andere E-Mail-Adresse. Du bist als <b>${this.userEmail}</b> angemeldet.</span></div>
        <div class="actions">${cancel}<button class="btn primary" @click=${() => emit(this, 'sx-invite-login')}>${icon('user')} Mit dieser Adresse anmelden</button></div>`;
    }
    return html`${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      <div class="actions">
        ${cancel}
        <button class="btn primary" ?disabled=${this.busy} @click=${() => emit(this, 'sx-invite-accept')}>${icon('check')} ${this.busy ? 'Nehme an …' : 'Annehmen'}</button>
      </div>`;
  }

  private body() {
    if (this.state === 'loading') return html`<div class="body"><p class="muted">Lade Einladung …</p></div>`;
    if (this.state === 'error' || !this.peek) {
      return html`<div class="body">
        <p class="error" role="alert">${this.error || 'Die Einladung ist ungültig, abgelaufen oder wurde schon benutzt.'}</p>
        <p class="muted">Bitte frag nach einer neuen Einladung.</p>
        <div class="actions"><button class="btn" @click=${this.close}>Schließen</button></div>
      </div>`;
    }
    const p = this.peek;
    if (this.state === 'done' && this.result) {
      const r = this.result;
      return html`<div class="body">
        <div class="center">
          <div class="badge">${icon(r.kind === 'crew' ? 'anchor' : 'sail')}</div>
          <p>${inviteAcceptedText(r)}</p>
        </div>
        ${r.kind === 'crew' && !r.path ? html`<div class="note">${icon('lock')}<span>Der Törn ist gerade nicht öffentlich. Du erscheinst dort, sobald der Eigentümer ihn öffentlich schaltet.</span></div>` : ''}
        <div class="actions">
          <button class="btn" @click=${this.close}>Schließen</button>
          ${r.path ? html`<a class="btn primary" href=${r.path}>${icon('open')} ${inviteTargetLabel(r.kind)}</a>` : ''}
        </div>
      </div>`;
    }
    return html`<div class="body">
      <div class="center">
        <div class="badge">${icon(p.kind === 'crew' ? 'anchor' : 'sail')}</div>
        <p><b>${p.inviter || 'Ein Segler oder eine Seglerin'}</b> lädt dich ${inviteWhat(p)}.</p>
      </div>
      <p class="muted">${inviteExplain(p)}</p>
      <p class="hint">Gültig bis ${fmtDate(p.expiresAt)}${p.bound ? ' · gilt nur für die eingeladene E-Mail-Adresse' : ''}</p>
      ${this.next(p)}
    </div>`;
  }

  render() {
    return html`<dialog aria-labelledby="h" @close=${this.close}>
      <header>
        <h2 id="h">Einladung</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      ${this.body()}
    </dialog>`;
  }
}
customElements.define('sx-invite-dialog', SxInviteDialog);
