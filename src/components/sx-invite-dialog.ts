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

  private what(p: InvitePeek) {
    const target = html`<span class="target">„${p.target || (p.kind === 'crew' ? 'Törn' : p.kind === 'group' ? 'Gruppe' : 'Boot')}“</span>`;
    if (p.kind === 'group') return html`${p.groupKind === 'team' ? 'ins Team' : 'in den Verein'} ${target} ein`;
    return p.kind === 'boat_admin' ? html`das Boot ${target} mitzuverwalten` : html`in die Crew des Törns ${target}`;
  }

  private explain(p: InvitePeek) {
    if (p.kind === 'group') {
      return 'Als Mitglied siehst du die Neuigkeiten der Gruppe und kannst deine Boote zuordnen. Mitgliedschaft öffnet keine nicht öffentlichen Törns anderer. Mit öffentlichem Profil erscheinst du namentlich, sonst nur als Anzahl. Du kannst jederzeit austreten.';
    }
    return p.kind === 'boat_admin'
      ? 'Als Admin bearbeitest du die Bootsseite und ordnest deine Törns dem Boot zu. Löschen und weitere Admins einladen kann nur der Eigner. Du kannst das Boot jederzeit wieder verlassen.'
      : 'Solange der Törn öffentlich ist, erscheinst du dort – mit öffentlichem Profil namentlich und auf deiner Profilseite unter „Mitgesegelt“, sonst nur als Anzahl. Deine E-Mail-Adresse sieht niemand. Du kannst dich jederzeit wieder entfernen.';
  }

  /** Was als Nächstes zu tun ist: anmelden, andere Adresse, Profil anlegen oder annehmen. */
  private next(p: InvitePeek) {
    const cancel = html`<button class="btn" @click=${this.close}>Später</button>`;
    if (p.isOwner) {
      const own = p.kind === 'crew' ? 'Das ist dein eigener Törn. Teile den Link mit deiner Crew.' : p.kind === 'group' ? 'Das ist deine eigene Gruppe. Teile den Link mit deinen Leuten.' : 'Du bist der Eigner dieses Boots. Die Einladung gilt nur für die eingeladene Adresse.';
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
          <p>${r.kind === 'crew' ? html`Du bist jetzt in der Crew von` : r.kind === 'group' ? html`Du bist jetzt Mitglied von` : html`Du bist jetzt Admin von`}<br /><span class="target">„${r.target || ''}“</span></p>
        </div>
        ${r.kind === 'crew' && !r.path ? html`<div class="note">${icon('lock')}<span>Der Törn ist gerade nicht öffentlich. Du erscheinst dort, sobald der Eigentümer ihn öffentlich schaltet.</span></div>` : ''}
        <div class="actions">
          <button class="btn" @click=${this.close}>Schließen</button>
          ${r.path ? html`<a class="btn primary" href=${r.path}>${icon('open')} ${r.kind === 'crew' ? 'Törn ansehen' : r.kind === 'group' ? 'Zur Gruppe' : 'Bootsseite ansehen'}</a>` : ''}
        </div>
      </div>`;
    }
    return html`<div class="body">
      <div class="center">
        <div class="badge">${icon(p.kind === 'crew' ? 'anchor' : 'sail')}</div>
        <p><b>${p.inviter || 'Ein Segler oder eine Seglerin'}</b> lädt dich ${p.kind === 'group' ? '' : 'ein, '}${this.what(p)}.</p>
      </div>
      <p class="muted">${this.explain(p)}</p>
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
