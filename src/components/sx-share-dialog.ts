import { LitElement, html, css, type PropertyValues } from 'lit';
import type { Boat, ShareMeta, SupportStatus } from '../services/api';
import { needsSupport, quotaText, type SupportTier } from '../domain/support';
import { storageHint } from '../domain/limits';
import { CONTENT_LABELS, FORMATS, type ImageContent, type ImageFormat } from '../services/share-image';
import { DEFAULT_VISIBILITY, VISIBILITY_LABEL, isVisibility, type Visibility } from '../domain/visibility';
import { icon } from './icons';
import { base, dialogStyles, emit } from './shared';
import { VISIBILITY_ICON } from './sx-visibility-picker';
import './sx-support';
import './sx-filter-select';

/** Was nach dem Hochladen wer sieht – ein Satz je Stufe (Konzept 1.1). */
export const SHARE_CONSEQUENCE: Record<Visibility, string> = {
  public: 'Track mit Positionen und Zeiten und der Titel sind für alle sichtbar – auf deinem Profil, der Bootsseite und unter Entdecken, auch für Suchmaschinen.',
  unlisted: 'Nur wer den geheimen Link hat, sieht den Track mit Positionen und Zeiten; nirgends gelistet, den Link kannst du jederzeit erneuern.',
  private: 'Nur du siehst den Törn, wenn du angemeldet bist – freigeben kannst du ihn später.',
};

/** Erklärung über dem fertigen Link. */
const RESULT_TEXT: Record<Visibility, string> = {
  public: 'Jeder sieht den Törn interaktiv mit Karte, Wind, Wellen und Diagrammen – auch auf deinem Profil und unter Entdecken. In Messengern erscheint das Übersichtsbild als Vorschau.',
  unlisted: 'Wer diesen Link hat, sieht den Törn interaktiv mit Karte, Wind, Wellen und Diagrammen. Nirgends gelistet; unter „Konto & Freigaben“ kannst du den Link erneuern.',
  private: 'Diese Freigabe siehst nur du, wenn du angemeldet bist.',
};

export interface ShareResult {
  share: ShareMeta;
  url: string;
}

export type ShareTab = 'image' | 'link';

/**
 * Wie kann ein Link entstehen?
 *  form    – angemeldet, Formular
 *  login   – Anmeldung nötig
 *  offline – kein Backend (nur Link mit eingebetteten Daten)
 */
export type LinkState = 'form' | 'login' | 'offline';

export interface ImageState {
  url: string;
  busy: boolean;
  format: ImageFormat;
  content: ImageContent;
}

/** Wozu der Dialog geöffnet wurde: nur speichern (F-225) oder teilen (Bild/Link). */
export type SharePurpose = 'save' | 'share';

/**
 * Teilen als Bild (lokal, ohne Anmeldung) oder als Link (Upload) – bzw. nur Speichern (F-225): gleiches Formular, ohne
 * Reiter, danach „Jetzt teilen“.
 */
export class SxShareDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    purpose: { type: String },
    tab: { type: String },
    linkState: { type: String },
    defaultTitle: { type: String },
    summary: { type: String },
    busy: { type: Boolean },
    error: { type: String },
    result: { attribute: false },
    boats: { attribute: false },
    image: { attribute: false },
    supportTiers: { attribute: false },
    checkoutBusy: { type: Boolean },
    supportStatus: { attribute: false },
    checking: { type: Boolean },
    visibility: { type: String },
    copied: { state: true },
    offer: { state: true },
  };
  declare open: boolean;
  declare purpose: SharePurpose;
  declare tab: ShareTab;
  declare linkState: LinkState;
  declare defaultTitle: string;
  declare summary: string;
  declare busy: boolean;
  declare error: string;
  declare result: ShareResult | null;
  declare boats: Boat[];
  declare image: ImageState | null;
  /** Stufen des Unterstützen-Sliders; null = Unterstützen nicht eingerichtet */
  declare supportTiers: SupportTier[] | null;
  /** Checkout wird angelegt */
  declare checkoutBusy: boolean;
  /** Kontingent des Kontos; null = (noch) unbekannt */
  declare supportStatus: SupportStatus | null;
  /** Unterstützer-Status wird gerade neu geladen */
  declare checking: boolean;
  /** gewählte Sichtbarkeit im Formular (Standard „Öffentlich“, E1) */
  declare visibility: Visibility;
  declare copied: boolean;
  /** gesperrte Stufe angetippt: Unterstützen-Angebot unter der Auswahl zeigen */
  declare offer: boolean;

  constructor() {
    super();
    this.open = false;
    this.purpose = 'share';
    this.tab = 'link';
    this.linkState = 'form';
    this.defaultTitle = '';
    this.summary = '';
    this.busy = false;
    this.error = '';
    this.result = null;
    this.boats = [];
    this.image = null;
    this.supportTiers = null;
    this.checkoutBusy = false;
    this.supportStatus = null;
    this.checking = false;
    this.visibility = DEFAULT_VISIBILITY;
    this.copied = false;
    this.offer = false;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      dialog {
        width: min(620px, calc(100vw - 32px));
      }
      .tabs {
        display: flex;
        gap: var(--s-1);
        border-bottom: 1px solid var(--border-soft);
        margin: 0 var(--s-5);
      }
      .tabs button {
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        border: 0;
        background: none;
        padding: var(--s-2) var(--s-3);
        min-height: var(--control-h);
        font: 600 var(--fs-m) var(--font);
        color: var(--text-2);
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        cursor: pointer;
      }
      .tabs button[aria-selected='true'] {
        color: var(--accent);
        border-bottom-color: var(--accent);
      }
      .opt {
        display: flex;
        gap: var(--s-3);
        align-items: flex-start;
        padding: var(--s-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        cursor: pointer;
      }
      .opt:has(input:checked) {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .opt input {
        margin-top: 3px;
        accent-color: var(--accent);
      }
      .opt b {
        display: flex;
        align-items: center;
        gap: var(--s-1);
      }
      .opt b svg {
        width: 15px;
        height: 15px;
      }
      .opt small {
        display: block;
        color: var(--text-2);
        font-size: var(--fs-s);
      }
      .vis {
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        font-weight: 600;
        color: var(--text);
        margin-right: var(--s-1);
      }
      .vis svg {
        width: 15px;
        height: 15px;
      }
      .locked-offer {
        display: grid;
        gap: var(--s-3);
      }
      .check {
        display: flex;
        gap: var(--s-2);
        align-items: center;
        font-size: var(--fs-m);
        cursor: pointer;
      }
      .check input {
        accent-color: var(--accent);
        width: 16px;
        height: 16px;
      }
      .linkrow {
        display: flex;
        gap: var(--s-2);
      }
      .linkrow input {
        font-family: var(--font-mono);
        font-size: var(--fs-s);
      }
      .preview {
        position: relative;
        border-radius: var(--radius);
        overflow: hidden;
        border: 1px solid var(--border-soft);
        background: var(--surface-2);
        display: grid;
        place-items: center;
      }
      .preview img {
        display: block;
        width: 100%;
        height: auto;
      }
      .preview.square img {
        max-width: 360px;
      }
      .preview .busy {
        position: absolute;
        inset: auto var(--s-2) var(--s-2) auto;
        background: var(--overlay);
        border-radius: 999px;
        padding: 2px var(--s-3);
        font-size: var(--fs-s);
      }
      .quota {
        display: flex;
        align-items: center;
        gap: var(--s-1);
      }
      .quota svg {
        width: 14px;
        height: 14px;
      }
      .support {
        padding-top: var(--s-3);
        border-top: 1px solid var(--border-soft);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
      }
      .chips label {
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        padding: var(--s-1) var(--s-3);
        min-height: var(--control-h-s);
        border: 1px solid var(--border);
        border-radius: 999px;
        font-size: var(--fs-s);
        cursor: pointer;
        user-select: none;
      }
      .chips label:has(input:checked) {
        border-color: var(--accent);
        background: var(--accent-soft);
        color: var(--accent);
      }
      .chips input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .chips label:has(input:focus-visible) {
        box-shadow: var(--focus);
      }
      .formats {
        display: flex;
        gap: var(--s-2);
        flex-wrap: wrap;
      }
    `,
  ];

  updated(changed: PropertyValues<this>) {
    const dlg = this.renderRoot.querySelector('dialog')!;
    if (changed.has('open')) {
      if (this.open && !dlg.open) {
        this.copied = false;
        this.offer = false;
        dlg.showModal();
      } else if (!this.open && dlg.open) dlg.close();
    }
  }

  private close = () => emit(this, 'sx-close', 'share');

  private selectTab(tab: ShareTab) {
    this.tab = tab;
    emit(this, 'sx-share-tab', tab);
  }

  // ------------------------------------------------------------ Bild

  private setImage(patch: Partial<Pick<ImageState, 'format' | 'content'>>) {
    if (!this.image) return;
    emit(this, 'sx-image-options', { format: patch.format ?? this.image.format, content: { ...this.image.content, ...patch.content } });
  }

  private imageTab() {
    const img = this.image;
    if (!img) return html`<div class="body"><p class="muted">Erzeuge Bild …</p></div>`;
    const canShareFiles = typeof navigator.canShare === 'function';
    return html`<div class="body">
      <div class="preview ${img.format}">
        ${img.url ? html`<img src=${img.url} alt="Vorschau des Übersichtsbilds" />` : html`<p class="muted">Erzeuge Bild …</p>`}
        ${img.busy && img.url ? html`<span class="busy">Aktualisiere …</span>` : ''}
      </div>
      <div>
        <div class="label">Format</div>
        <div class="formats" role="radiogroup" aria-label="Bildformat">
          ${(Object.keys(FORMATS) as ImageFormat[]).map(
            (f) => html`<label class="opt"><input type="radio" name="format" .checked=${img.format === f} @change=${() => this.setImage({ format: f })} />
              <span><b>${FORMATS[f].label}</b><small>${FORMATS[f].width} × ${FORMATS[f].height}</small></span></label>`,
          )}
        </div>
      </div>
      <div>
        <div class="label">Im Bild zeigen</div>
        <div class="chips">
          ${CONTENT_LABELS.map(
            ([key, label]) => html`<label>
              <input type="checkbox" .checked=${img.content[key]} @change=${(e: Event) => this.setImage({ content: { [key]: (e.target as HTMLInputElement).checked } as Partial<ImageContent> as ImageContent })} />
              ${img.content[key] ? icon('check') : ''}${label}
            </label>`,
          )}
        </div>
        <div class="hint">Die Angaben stehen am Rand, der Track wird nicht verdeckt. Das Bild entsteht nur in deinem Browser.</div>
      </div>
      <div class="actions">
        ${canShareFiles ? html`<button class="btn" ?disabled=${!img.url} @click=${() => emit(this, 'sx-image-share')}>${icon('share')} Teilen …</button>` : ''}
        <button class="btn primary" ?disabled=${!img.url} @click=${() => emit(this, 'sx-image-download')}>${icon('download')} Bild herunterladen</button>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------ Link

  private submit(e: Event) {
    e.preventDefault();
    const data = new FormData(e.target as HTMLFormElement);
    emit(this, 'sx-share-submit', {
      title: String(data.get('title') || ''),
      visibility: isVisibility(this.visibility) ? this.visibility : DEFAULT_VISIBILITY,
      boatId: String(data.get('boat') || '') || null,
      includeView: data.get('view') === 'on',
    });
  }

  private async copy() {
    if (!this.result) return;
    try {
      await navigator.clipboard.writeText(this.result.url);
      this.copied = true;
    } catch {
      this.renderRoot.querySelector<HTMLInputElement>('.linkrow input')?.select();
    }
  }

  private nativeShare() {
    if (!this.result) return;
    navigator.share?.({ title: this.result.share.title, text: this.result.share.summary, url: this.result.url }).catch(() => {});
  }

  /** Nach dem Speichern: Bestätigung und „Jetzt teilen“. */
  private savedPanel(r: ShareResult) {
    const vis: Visibility = isVisibility(r.share.visibility) ? r.share.visibility : 'public';
    return html`<div class="body">
      <p class="muted visibility-note">
        <span class="vis">${icon('check')} Gespeichert</span>
        „${r.share.title}“ liegt in deinem Konto – ${VISIBILITY_LABEL[vis]}.
      </p>
      <div class="actions">
        <button class="btn" @click=${this.close}>Schließen</button>
        <button class="btn primary" @click=${() => {
          this.purpose = 'share';
          this.tab = 'link';
        }}>${icon('share')} Jetzt teilen</button>
      </div>
    </div>`;
  }

  private linkTab() {
    const r = this.result;
    if (r && this.purpose === 'save') return this.savedPanel(r);
    if (r) {
      const vis: Visibility = isVisibility(r.share.visibility) ? r.share.visibility : 'public';
      return html`<div class="body">
        <p class="muted visibility-note">
          <span class="vis">${icon(VISIBILITY_ICON[vis])} ${VISIBILITY_LABEL[vis]}</span>
          ${RESULT_TEXT[vis]}
        </p>
        <div class="linkrow">
          <input type="text" readonly .value=${r.url} aria-label="Freigabe-Link" @focus=${(e: Event) => (e.target as HTMLInputElement).select()} />
          <button class="btn primary" @click=${this.copy}>${icon(this.copied ? 'check' : 'copy')} ${this.copied ? 'Kopiert' : 'Kopieren'}</button>
        </div>
        <div class="actions">
          ${'share' in navigator ? html`<button class="btn" @click=${this.nativeShare}>${icon('share')} Teilen …</button>` : ''}
          <a class="btn" href=${r.url} target="_blank" rel="noopener">${icon('open')} Öffnen</a>
          ${r.share.isOwner ? html`<button class="btn" @click=${() => emit(this, 'sx-account')}>${icon('folder')} Konto &amp; Freigaben</button>` : ''}
        </div>
        ${this.supportTiers && !this.supportStatus?.supporter
          ? html`<sx-support class="support" variant="offer" .tiers=${this.supportTiers} .status=${this.supportStatus} ?busy=${this.checkoutBusy}></sx-support>`
          : ''}
      </div>`;
    }
    if (this.linkState === 'login') {
      return html`<div class="body">
        <p class="muted">${this.purpose === 'save' ? 'Gespeichert wird dein Törn in deinem Konto' : 'Für einen Link wird dein Törn gespeichert'} – dafür meldest du dich einmal mit deiner E-Mail-Adresse an. Danach geht es direkt hier weiter.</p>
        ${this.purpose === 'share' ? html`<div class="note">${icon('info')}<span>Als Bild teilen geht ohne Anmeldung – im Reiter „Als Bild“.</span></div>` : ''}
        <div class="actions">
          ${this.purpose === 'share' ? html`<button class="btn" @click=${() => this.selectTab('image')}>${icon('image')} Als Bild teilen</button>` : ''}
          <button class="btn primary" @click=${() => emit(this, 'sx-login-for-share')}>${icon('mail')} ${this.purpose === 'save' ? 'Anmelden &amp; speichern' : 'Anmelden &amp; Link erstellen'}</button>
        </div>
      </div>`;
    }
    if (this.linkState === 'offline') {
      return html`<div class="body">
        <p class="muted">Teilen per Server ist hier nicht verfügbar. Kleine Tracks lassen sich als Link mit eingebetteten Daten teilen.</p>
        <div class="actions"><button class="btn primary" @click=${() => emit(this, 'sx-share-inline')}>${icon('link')} Link kopieren</button></div>
      </div>`;
    }
    if (needsSupport(this.supportStatus)) {
      return html`<div class="body">
        <sx-support variant="required" .tiers=${this.supportTiers} .status=${this.supportStatus} ?busy=${this.checkoutBusy} ?checking=${this.checking}></sx-support>
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
        <div class="actions">
          <button class="btn" @click=${() => this.selectTab('image')}>${icon('image')} Als Bild teilen</button>
        </div>
      </div>`;
    }
    return html`<form class="body" @submit=${this.submit}>
      <div>
        <label class="label" for="title">Titel</label>
        <input id="title" name="title" type="text" maxlength="120" .value=${this.defaultTitle} required />
        ${this.summary ? html`<div class="hint">${this.summary}</div>` : ''}
        ${quotaText(this.supportStatus) ? html`<div class="hint quota">${icon('info')} ${quotaText(this.supportStatus)}</div>` : ''}
        ${this.limitHints()}
      </div>
      <div>
        <div class="label" aria-hidden="true">Wer darf es sehen?</div>
        <sx-visibility-picker
          label="Wer darf es sehen?"
          .value=${this.visibility}
          ?supporter=${!!this.supportStatus?.supporter}
          @sx-visibility-change=${(e: CustomEvent<{ value: Visibility }>) => {
            this.visibility = e.detail.value;
            this.offer = false;
          }}
          @sx-visibility-locked=${() => (this.offer = true)}
        ></sx-visibility-picker>
        <div class="hint consequence" aria-live="polite">${SHARE_CONSEQUENCE[isVisibility(this.visibility) ? this.visibility : 'public']}</div>
      </div>
      ${this.offer ? this.lockedOffer() : ''}
      ${this.boats.length
        ? html`<div>
            <label class="label" for="boat">Boot</label>
            <sx-filter-select label="Boote filtern"><select id="boat" name="boat">
              <option value="">Kein Boot</option>
              ${this.boats.map((b) => html`<option value=${b.id}>${b.name}</option>`)}
            </select></sx-filter-select>
          </div>`
        : ''}
      <label class="check"><input type="checkbox" name="view" checked /> Aktuelle Ansicht mitgeben (Einfärbung &amp; Ebenen)</label>
      <div class="note warn">${icon('info')}<span>Die GPX-Dateien werden mit allen Positionen und Zeitstempeln gespeichert, dazu das Übersichtsbild für die Link-Vorschau. Du kannst die Freigabe jederzeit unter „Konto &amp; Freigaben“ ändern oder löschen.</span></div>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      <div class="actions">
        <button type="button" class="btn" @click=${this.close}>Abbrechen</button>
        <button type="submit" class="btn primary" ?disabled=${this.busy || !!this.supportStatus?.storagePaused}>${icon(this.purpose === 'save' ? 'check' : 'share')} ${this.busy ? 'Speichere …' : this.purpose === 'save' ? 'Speichern' : 'Speichern & Link erstellen'}</button>
      </div>
    </form>`;
  }

  /** Speicher fast voll (Konto) bzw. Notbremse aktiv (Plattform) – Konzept 5.1/5.2. */
  private limitHints() {
    const st = this.supportStatus;
    const storage = storageHint(st);
    return html`${storage ? html`<div class="hint quota storage">${icon('info')} ${storage}</div>` : ''}
      ${st?.storagePaused
        ? html`<div class="note warn paused" role="status">${icon('info')}<span>Der Speicher von Sail Explorer ist gerade knapp – neue Törns sind vorübergehend pausiert.${st.supporter ? '' : ' Unterstützer können weiter speichern.'} Als Bild teilen geht weiterhin.</span></div>`
        : ''}`;
  }

  /** Gesperrte Stufe gewählt: erklären und – wenn eingerichtet – das Unterstützen-Angebot zeigen. */
  private lockedOffer() {
    return html`<div class="locked-offer" role="status">
      <div class="note">${icon('pennant')}<span>„Nur mit Link“ und „Nur ich“ gibt es für Unterstützer. Kostenlos geteilte Törns sind öffentlich.${this.supportTiers?.length ? '' : ' Unterstützen ist auf dieser Installation nicht eingerichtet.'}</span></div>
      ${this.supportTiers?.length
        ? html`<sx-support variant="offer" .tiers=${this.supportTiers} .status=${this.supportStatus} ?busy=${this.checkoutBusy}></sx-support>`
        : ''}
    </div>`;
  }

  render() {
    return html`<dialog aria-labelledby="h" @close=${this.close}>
      <header>
        <h2 id="h">${this.purpose === 'save' ? 'Törn speichern' : 'Törn teilen'}</h2>
        <button class="btn ghost icon" aria-label="Schließen" @click=${this.close}>${icon('x')}</button>
      </header>
      ${this.purpose === 'save'
        ? this.linkTab()
        : html`<div class="tabs" role="tablist">
              <button role="tab" aria-selected=${this.tab === 'image'} @click=${() => this.selectTab('image')}>${icon('image')} Als Bild</button>
              <button role="tab" aria-selected=${this.tab === 'link'} @click=${() => this.selectTab('link')}>${icon('link')} Als Link</button>
            </div>
            <div role="tabpanel">${this.tab === 'image' ? this.imageTab() : this.linkTab()}</div>`}
    </dialog>`;
  }
}
customElements.define('sx-share-dialog', SxShareDialog);
