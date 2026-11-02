import { LitElement, css, html, type PropertyValues } from 'lit';
import { POST_VISIBILITY_CHOICE, channelKey, channelName, type AttachableShare, type ComposeTarget, type PostVisibility, defaultPostVisibility } from '../domain/posts';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';
import './sx-post-composer';
import type { SxPostComposer } from './sx-post-composer';

/** Erklärung je Stufe „Wer sieht es“ – unabhängig vom Verlauf formuliert. */
const HINT: Record<PostVisibility, string> = {
  public: 'Alle, die den Verlauf sehen – mit „Sichtbar bis“ auch weiter oben.',
  members: 'Nur Mitglieder der Gruppe – bleibt immer in der Gruppe.',
  unlisted: 'Nur wer den Link hat – erscheint in keinem Verlauf.',
  private: 'Nur du – im Bereich „Privat“ deiner Seite.',
};

/**
 * Text-Beitrag über den Plus-Knopf (Konzept 21.4, F-405): „Wo steht es?“ (Profil, Gruppen mit Schreibrecht, Häfen und
 * Boote), dann das gemeinsame Formular `sx-post-composer` mit den Stufen dieses Verlaufs. Mobil randlos als Vollbild
 * (`dialogStyles`). Rein präsentational – meldet `sx-compose-submit` { channel, body, link, visibility, reach?,
 * shareId } und `sx-compose-close`; der Controller leert es mit `clear()`.
 */
export class SxComposeDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    loading: { type: Boolean },
    busy: { type: Boolean },
    error: { type: String },
    targets: { attribute: false },
    shares: { attribute: false },
    /** gewählter Verlauf (`channelKey`) */
    selected: { type: String },
  };
  declare open: boolean;
  declare loading: boolean;
  declare busy: boolean;
  declare error: string;
  declare targets: ComposeTarget[];
  declare shares: AttachableShare[];
  declare selected: string;

  constructor() {
    super();
    this.open = false;
    this.loading = false;
    this.busy = false;
    this.error = '';
    this.targets = [];
    this.shares = [];
    this.selected = 'user';
  }

  static styles = [
    base,
    dialogStyles,
    css`
      dialog {
        width: min(560px, calc(100vw - 32px));
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    if (!changed.has('open')) return;
    const d = this.renderRoot.querySelector('dialog');
    if (this.open && d && !d.open) d.showModal();
    else if (!this.open && d?.open) d.close();
  }

  clear() {
    this.renderRoot.querySelector<SxPostComposer>('sx-post-composer')?.clear();
  }

  private target(): ComposeTarget | undefined {
    return this.targets.find((t) => channelKey(t.ref) === this.selected) ?? this.targets[0];
  }

  private submit(e: CustomEvent) {
    e.stopPropagation();
    const t = this.target();
    if (!t) return;
    emit(this, 'sx-compose-submit', { channel: { kind: t.ref.kind, id: t.id }, ...e.detail });
  }

  render() {
    const t = this.target();
    return html`<dialog aria-labelledby="ch" @close=${() => this.open && emit(this, 'sx-compose-close')} @cancel=${(e: Event) => {
        e.preventDefault();
        emit(this, 'sx-compose-close');
      }}>
      <header>
        <h2 id="ch">Neuer Beitrag</h2>
        <button class="btn ghost icon" type="button" aria-label="Schließen" @click=${() => emit(this, 'sx-compose-close')}>${icon('x')}</button>
      </header>
      <div class="body">
        ${this.loading
          ? html`<p class="muted" role="status">Lade …</p>`
          : html`<label><span class="label">Wo steht es?</span>
                <select @change=${(e: Event) => (this.selected = (e.target as HTMLSelectElement).value)}>
                  ${this.targets.map((x) => html`<option value=${channelKey(x.ref)} ?selected=${t === x}>${x.ref.kind === 'user' ? 'Mein Profil' : channelName(x.ref)}</option>`)}
                </select></label>
              ${t
                ? html`<sx-post-composer label="Text" placeholder="Was gibt es Neues?" ?busy=${this.busy} .choices=${t.choices} preset=${defaultPostVisibility(t.ref.kind)} .reaches=${t.reaches} .shares=${this.shares}
                    hint="Höchstens 5 Beiträge pro Tag und Verlauf. Reiner Text, Links werden klickbar."
                    .choiceHints=${Object.fromEntries(t.choices.map((v) => [v, `${POST_VISIBILITY_CHOICE[v]}: ${HINT[v]}`]))}
                    @sx-post-submit=${(e: CustomEvent) => this.submit(e)}></sx-post-composer>`
                : ''}`}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      </div>
    </dialog>`;
  }
}
customElements.define('sx-compose-dialog', SxComposeDialog);
