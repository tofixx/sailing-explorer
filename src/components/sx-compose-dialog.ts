import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { COMPOSE_LIMITS, POST_VISIBILITY_CHOICE, type ComposePostKind, channelKey, channelName, type AttachableShare, type ComposeTarget, type GalleryQuota, type PostVisibility, defaultPostVisibility } from '../domain/posts';
import type { Audience } from '../domain/large-groups';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';
import './sx-post-composer';
import './sx-poll-form';
import './sx-gallery-picker';
import type { SxPostComposer } from './sx-post-composer';

/**
 * Formular je Art (Konzept 21.4, 29): Titel, Beschriftung, Hinweis und das Formularteil im Slot von `sx-post-composer`,
 * das seine Nutzlast als `sx-payload` meldet. Länge und `plain` (ohne Link/Anhang) kommen aus `COMPOSE_LIMITS`
 * (src/domain/posts.ts, auch vom Worker genutzt). Neue Arten: eine Zeile.
 */
interface KindForm {
  title: string;
  label: string;
  placeholder: string;
  hint: string;
  /** Formularteil; bekommt den Dialog (z. B. das Galerie-Kontingent) */
  part?: (d: SxComposeDialog) => TemplateResult;
}
const KIND_FORMS: Record<ComposePostKind, KindForm> = {
  text: { title: 'Neuer Beitrag', label: 'Text', placeholder: 'Was gibt es Neues?', hint: 'Höchstens 5 Beiträge pro Tag und Verlauf. Reiner Text, Links werden klickbar.' },
  poll: { title: 'Neue Umfrage', label: 'Frage', placeholder: 'Wer segelt am Mittwoch?', hint: 'Zählt als Beitrag: höchstens 5 pro Tag und Verlauf.', part: () => html`<sx-poll-form></sx-poll-form>` },
  gallery: {
    title: 'Neue Fotos', label: 'Text (optional)', placeholder: 'Worum geht es?', hint: 'Zählt als Beitrag: höchstens 5 pro Tag und Verlauf.',
    part: (d) => html`<sx-gallery-picker .quota=${d.gallery} ?busy=${d.busy}></sx-gallery-picker>`,
  },
};

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
 * (`dialogStyles`). `kind` wählt das Formular je Art (`KIND_FORMS`). Rein präsentational – meldet `sx-compose-submit`
 * { channel, kind, body, link, visibility, reach?, shareId, [kind]: Nutzlast }, `sx-compose-channel` { ctx } (anderer
 * Verlauf gewählt – der Controller lädt dessen Publikum `audience`, F-465) und `sx-compose-close`; der Controller
 * leert es mit `clear()`.
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
    /** Publikum des gewählten Verlaufs (F-465), null solange unbekannt */
    audience: { attribute: false },
    /** Art des Beitrags (Text, Umfrage) */
    kind: { type: String },
    payload: { state: true },
    /** Galerie (Konzept 31): Kontingent dieses Monats und Fortschritt beim Hochladen („Foto 2 von 5 …“) */
    gallery: { attribute: false },
    progress: { type: String },
  };
  declare gallery: GalleryQuota | null;
  declare progress: string;
  declare kind: ComposePostKind;
  /** Nutzlast des Formularteils (`sx-payload`); null = unvollständig */
  declare payload: unknown;
  declare open: boolean;
  declare loading: boolean;
  declare busy: boolean;
  declare error: string;
  declare targets: ComposeTarget[];
  declare shares: AttachableShare[];
  declare selected: string;
  declare audience: Audience | null;

  constructor() {
    super();
    this.open = false;
    this.loading = false;
    this.busy = false;
    this.error = '';
    this.targets = [];
    this.shares = [];
    this.selected = 'user';
    this.audience = null;
    this.kind = 'text';
    this.payload = null;
    this.gallery = null;
    this.progress = '';
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
    (this.renderRoot.querySelector('sx-post-composer > *') as { clear?: () => void } | null)?.clear?.();
  }

  private target(): ComposeTarget | undefined {
    return this.targets.find((t) => channelKey(t.ref) === this.selected) ?? this.targets[0];
  }

  /** Verlauf wechseln (Auswahl oder kleinere Gruppe aus dem Hinweis) – das Publikum lädt der Controller neu. */
  private pick(key: string) {
    const t = this.targets.find((x) => channelKey(x.ref) === key);
    if (!t) return;
    this.selected = key;
    this.audience = null;
    emit(this, 'sx-compose-channel', { ctx: composeCtx(t) });
  }

  /** Eigene beschreibbare Teams des gewählten Vereins – die kleineren Gruppen im Hinweis (F-465). */
  private smaller(t: ComposeTarget) {
    return this.targets.filter((x) => t.ref.kind === 'group' && x.clubId === t.id).map((x) => ({ key: channelKey(x.ref), label: channelName(x.ref) }));
  }

  private submit(e: CustomEvent) {
    e.stopPropagation();
    const t = this.target();
    if (!t) return;
    const part = KIND_FORMS[this.kind].part ? { [this.kind]: this.payload } : {};
    emit(this, 'sx-compose-submit', { channel: { kind: t.ref.kind, id: t.id }, kind: this.kind, ...e.detail, ...part });
  }

  render() {
    const t = this.target();
    const f = KIND_FORMS[this.kind] ?? KIND_FORMS.text;
    return html`<dialog aria-labelledby="ch" @close=${() => this.open && emit(this, 'sx-compose-close')} @cancel=${(e: Event) => {
        e.preventDefault();
        emit(this, 'sx-compose-close');
      }}>
      <header>
        <h2 id="ch">${f.title}</h2>
        <button class="btn ghost icon" type="button" aria-label="Schließen" @click=${() => emit(this, 'sx-compose-close')}>${icon('x')}</button>
      </header>
      <div class="body">
        ${this.loading
          ? html`<p class="muted" role="status">Lade …</p>`
          : html`<label><span class="label">Wo steht es?</span>
                <select @change=${(e: Event) => this.pick((e.target as HTMLSelectElement).value)}>
                  ${this.targets.map((x) => html`<option value=${channelKey(x.ref)} ?selected=${t === x}>${x.ref.kind === 'user' ? 'Mein Profil' : channelName(x.ref)}</option>`)}
                </select></label>
              ${t
                ? html`<sx-post-composer label=${f.label} placeholder=${f.placeholder} max=${COMPOSE_LIMITS[this.kind].bodyMax} ?plain=${COMPOSE_LIMITS[this.kind].plain} .ready=${!f.part || !!this.payload}
                    ?busy=${this.busy} ?optional=${'bodyOptional' in COMPOSE_LIMITS[this.kind]} .choices=${t.choices} preset=${defaultPostVisibility(t.ref.kind)} .reaches=${t.reaches} .shares=${this.shares}
                    .audience=${this.audience} .smaller=${this.smaller(t)} @sx-compose-pick=${(e: CustomEvent<{ key: string }>) => this.pick(e.detail.key)}
                    hint=${f.hint}
                    .choiceHints=${Object.fromEntries(t.choices.map((v) => [v, `${POST_VISIBILITY_CHOICE[v]}: ${HINT[v]}`]))}
                    @sx-post-submit=${(e: CustomEvent) => this.submit(e)}
                    @sx-payload=${(e: CustomEvent<{ value: unknown }>) => {
                      e.stopPropagation();
                      this.payload = e.detail.value;
                    }}>${f.part?.(this) ?? ''}</sx-post-composer>`
                : ''}`}
        ${this.progress ? html`<p class="hint" role="status">${this.progress}</p>` : ''}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      </div>
    </dialog>`;
  }
}
customElements.define('sx-compose-dialog', SxComposeDialog);

/** `ctx` eines Verlaufs für die API (`user` bzw. `<art>:<id>`). */
export const composeCtx = (t: ComposeTarget): string => (t.ref.kind === 'user' ? 'user' : `${t.ref.kind}:${t.id}`);
