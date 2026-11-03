import { LitElement, css, html, type PropertyValues } from 'lit';
import { commentLength } from '../domain/comment-text';
import { POST_LINK_MAX, POST_MAX } from '../domain/groups';
import { POST_VISIBILITY_CHOICE, type AttachableShare, type PostVisibility, type Reach, type ReachOption } from '../domain/posts';
import { fmtDate, fmtNum } from '../util/html';
import { audienceHintText, audienceOf, needsAudienceHint, type Audience } from '../domain/large-groups';
import { icon } from './icons';
import { POST_VISIBILITY_ICON, base, emit } from './shared';
import './sx-reach-picker';

/**
 * Text-Beitrag schreiben (Konzept 11.4, 21): Text, optionaler Link, „Wer sieht es“ aus den Stufen des Verlaufs
 * (`choices`, F-402), „Sichtbar bis“ mit Kette (`reaches`, F-409; Vorschlag „überall“) und ein eigener Törn als Anhang
 * (`shares`, F-426). Gruppenseite, eigene Seite und der Plus-Knopf (`sx-compose-dialog`) nutzen dasselbe Formular.
 * Mit `audience` zeigt es ab 100 Personen den Publikums-Hinweis (F-465) mit kleineren Gruppen (`smaller`) und der
 * Schnellwahl „Nur hier“ bzw. „Nur Mitglieder“; senden bleibt möglich.
 * Rein präsentational – meldet `sx-post-submit` { body, link, visibility, reach?, shareId } und `sx-compose-pick`
 * { key } (kleinere Gruppe gewählt); der Host leert es nach Erfolg mit `clear()`.
 */
export class SxPostComposer extends LitElement {
  static properties = {
    label: { type: String },
    placeholder: { type: String },
    hint: { type: String },
    choices: { attribute: false },
    /** vorgewählte Stufe des Verlaufs (`defaultPostVisibility`, F-445: in Gruppen „Nur Mitglieder“) */
    preset: { type: String },
    /** Erklärung je Stufe (z. B. „Nur Mitglieder von …“) */
    choiceHints: { attribute: false },
    busy: { type: Boolean },
    /** Stufen „Sichtbar bis“ des Verlaufs (leer: keine Auswahl, der Server nimmt den Standard) */
    reaches: { attribute: false },
    /** eigene Törns zum Anhängen (leer: keine Auswahl) */
    shares: { attribute: false },
    /** Publikum je Stufe (F-465); null = unbekannt, kein Hinweis */
    audience: { attribute: false },
    /** kleinere Verläufe zum Wechseln (eigene Teams des Vereins), Schlüssel `channelKey` */
    smaller: { attribute: false },
    body: { state: true },
    link: { state: true },
    visibility: { state: true },
    reach: { state: true },
    shareId: { state: true },
  };
  declare label: string;
  declare placeholder: string;
  declare hint: string;
  declare choices: PostVisibility[];
  declare preset: PostVisibility;
  declare choiceHints: Partial<Record<PostVisibility, string>>;
  declare busy: boolean;
  declare reaches: ReachOption[];
  declare shares: AttachableShare[];
  declare audience: Audience | null;
  declare smaller: Array<{ key: string; label: string }>;
  declare reach: Reach;
  declare shareId: string;
  declare body: string;
  declare link: string;
  /** eigene Wahl; null = Vorwahl des Verlaufs */
  declare visibility: PostVisibility | null;

  constructor() {
    super();
    this.label = 'Beitrag';
    this.placeholder = '';
    this.hint = '';
    this.choices = ['public'];
    this.preset = 'public';
    this.choiceHints = {};
    this.busy = false;
    this.body = '';
    this.link = '';
    this.visibility = null;
    this.reaches = [];
    this.shares = [];
    this.audience = null;
    this.smaller = [];
    this.reach = 'all';
    this.shareId = '';
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      form {
        display: grid;
        gap: var(--s-2);
        padding: var(--s-3);
        border-radius: var(--radius);
        background: var(--surface);
        border: 1px solid var(--border-soft);
      }
      label {
        display: grid;
        gap: var(--s-1);
      }
      textarea {
        min-height: 88px;
        resize: vertical;
      }
      .counter {
        justify-self: end;
        font-size: var(--fs-s);
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
      }
      fieldset {
        border: 0;
        padding: 0;
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
      }
      legend {
        margin-bottom: var(--s-1);
      }
      .opt {
        display: inline-flex;
        align-items: center;
        gap: var(--s-1);
        min-height: 40px;
        padding: 0 var(--s-3);
        border: 1px solid var(--border);
        border-radius: 999px;
        cursor: pointer;
      }
      .opt:has(input:checked) {
        border-color: var(--accent);
        background: var(--accent-soft);
        font-weight: 600;
      }
      .opt svg {
        width: 16px;
        height: 16px;
      }
      /* Publikums-Hinweis (F-465): ruhig, kein Fehler – senden bleibt möglich */
      .audience {
        display: grid;
        gap: var(--s-2);
        padding: var(--s-2) var(--s-3);
        border-radius: var(--radius);
        background: var(--warn-bg);
      }
      .audience p {
        margin: 0;
      }
      /* lange Team-Namen brechen um statt das Formular bei 375 px zu verbreitern */
      .audience .btn {
        white-space: normal;
        max-width: 100%;
        height: auto;
        text-align: left;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
      }
    `,
  ];

  /** Anderer Verlauf (andere Stufen bzw. Vorwahl): wieder dessen Vorwahl – „Öffentlich“ wählt man je Verlauf bewusst. */
  willUpdate(changed: PropertyValues<this>) {
    if (changed.has('preset') || changed.has('choices')) this.visibility = null;
  }

  /** Gewählte Stufe: eigene Wahl, sonst die Vorwahl des Verlaufs, sonst die erste. */
  private current(): PostVisibility {
    if (this.visibility && this.choices.includes(this.visibility)) return this.visibility;
    return this.choices.includes(this.preset) ? this.preset : this.choices[0];
  }

  /** Nach erfolgreichem Posten (vom Host aufgerufen). */
  clear() {
    this.body = '';
    this.link = '';
    this.shareId = '';
  }

  /** Gewählte Stufe „Sichtbar bis“ – gibt es sie im Verlauf nicht, die höchste vorhandene. */
  private currentReach(): Reach | undefined {
    if (!this.reaches.length) return undefined;
    return this.reaches.some((o) => o.reach === this.reach) ? this.reach : this.reaches[this.reaches.length - 1].reach;
  }

  private submit(e: Event) {
    e.preventDefault();
    const visibility = this.current();
    const reach = visibility === 'public' ? this.currentReach() : undefined;
    emit(this, 'sx-post-submit', { body: this.body, link: this.link.trim(), visibility, ...(reach ? { reach } : {}), shareId: this.shareId || null });
  }

  /** „Sichtbar bis“ nur bei öffentlich; sonst der Hinweis, dass es im Verlauf bleibt. */
  private reachPicker(visibility: PostVisibility) {
    if (!this.reaches.length) return '';
    return html`<sx-reach-picker .options=${visibility === 'public' ? this.reaches : this.reaches.slice(0, 1)} .value=${this.currentReach() ?? 'all'}
      note=${visibility === 'public' ? '' : 'Nicht öffentliche Beiträge bleiben nur hier.'}
      @sx-reach-change=${(e: CustomEvent<{ reach: Reach }>) => (this.reach = e.detail.reach)}></sx-reach-picker>`;
  }

  /**
   * Publikums-Hinweis (F-465): ab 100 Personen „Geht an ca. N Personen – lieber in einer kleineren Gruppe schreiben?“
   * mit Teams des Vereins und der Schnellwahl einer kleineren Stufe, wenn es die hier gibt. Keine Namen, nur Zahlen.
   */
  private audienceHint(visibility: PostVisibility) {
    const reach = visibility === 'public' ? this.currentReach() : undefined;
    const n = audienceOf(this.audience, visibility, reach);
    if (!needsAudienceHint(n)) return '';
    const here = audienceOf(this.audience, 'public', 'here');
    const members = this.choices.includes('members') ? audienceOf(this.audience, 'members', undefined) : null;
    return html`<div class="audience" role="note">
      <p>${audienceHintText(n)}</p>
      <div class="row">
        ${this.smaller.map((s) => html`<button class="btn" type="button" @click=${() => emit(this, 'sx-compose-pick', { key: s.key })}>${s.label}</button>`)}
        ${visibility === 'public' && reach !== 'here' && here !== null && here < n
          ? html`<button class="btn" type="button" @click=${() => (this.reach = 'here')}>Nur hier (ca. ${fmtNum(here, 0)})</button>`
          : ''}
        ${visibility !== 'members' && members !== null && members < n
          ? html`<button class="btn" type="button" @click=${() => (this.visibility = 'members')}>Nur Mitglieder (ca. ${fmtNum(members, 0)})</button>`
          : ''}
      </div>
    </div>`;
  }

  /** Eigenen Törn anhängen (F-426) – fällt für Leser weg, die den Törn nicht sehen dürfen. */
  private sharePicker() {
    if (!this.shares.length) return '';
    return html`<label><span class="label">Törn anhängen (optional)</span>
      <select .value=${this.shareId} @change=${(e: Event) => (this.shareId = (e.target as HTMLSelectElement).value)}>
        <option value="">Kein Törn</option>
        ${this.shares.map((s) => html`<option value=${s.id} ?selected=${s.id === this.shareId}>${s.title}${s.startedAt ? ` · ${fmtDate(s.startedAt)}` : ''}</option>`)}
      </select>
      <span class="hint">Wer den Törn nicht sehen darf, sieht den Beitrag ohne Anhang.</span></label>`;
  }

  render() {
    const len = commentLength(this.body.trim());
    const current = this.current();
    return html`<form aria-label=${this.label} @submit=${(e: Event) => this.submit(e)}>
      <label><span class="label">${this.label}</span>
        <textarea maxlength=${POST_MAX + 200} .value=${this.body} placeholder=${this.placeholder}
          @input=${(e: Event) => (this.body = (e.target as HTMLTextAreaElement).value)}></textarea></label>
      <!-- Zähler erst nahe der Grenze ansagen (ab 90 %), sonst bei jedem Tastendruck -->
      <div class="counter" aria-live=${len >= POST_MAX * 0.9 ? 'polite' : 'off'}>${len} / ${POST_MAX}</div>
      <label><span class="label">Link (optional)</span>
        <input type="text" inputmode="url" maxlength=${POST_LINK_MAX} placeholder="https://…" .value=${this.link}
          @input=${(e: Event) => (this.link = (e.target as HTMLInputElement).value)} /></label>
      ${this.choices.length > 1
        ? html`<fieldset>
            <legend class="label">Wer sieht es?</legend>
            ${this.choices.map(
              (v) => html`<label class="opt" title=${this.choiceHints[v] ?? ''}>
                <input type="radio" name="vis" .checked=${v === current} @change=${() => (this.visibility = v)} />
                ${icon(POST_VISIBILITY_ICON[v])} ${POST_VISIBILITY_CHOICE[v]}</label>`,
            )}
          </fieldset>
          ${this.choiceHints[current] ? html`<p class="hint">${this.choiceHints[current]}</p>` : ''}`
        : ''}
      ${this.reachPicker(current)} ${this.audienceHint(current)} ${this.sharePicker()}
      <div class="row"><button class="btn primary" type="submit" ?disabled=${this.busy || !len || len > POST_MAX}>${icon('comment')} Veröffentlichen</button>
        ${this.hint ? html`<span class="hint">${this.hint}</span>` : ''}</div>
    </form>`;
  }
}
customElements.define('sx-post-composer', SxPostComposer);
