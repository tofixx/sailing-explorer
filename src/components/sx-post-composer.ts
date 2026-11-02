import { LitElement, css, html } from 'lit';
import { commentLength } from '../domain/comment-text';
import { POST_LINK_MAX, POST_MAX } from '../domain/groups';
import { POST_VISIBILITY_CHOICE, type PostVisibility } from '../domain/posts';
import { icon } from './icons';
import { POST_VISIBILITY_ICON, base, emit } from './shared';

/**
 * Text-Beitrag schreiben (Konzept 11.4, 21): Text, optionaler Link und „Wer sieht es“ aus den Stufen des Verlaufs
 * (`choices`, F-402). Gruppenseite und eigene Seite nutzen dasselbe Formular. Rein präsentational – meldet
 * `sx-post-submit` { body, link, visibility }; der Host leert es nach Erfolg mit `clear()`.
 */
export class SxPostComposer extends LitElement {
  static properties = {
    label: { type: String },
    placeholder: { type: String },
    hint: { type: String },
    choices: { attribute: false },
    /** Erklärung je Stufe (z. B. „Nur Mitglieder von …“) */
    choiceHints: { attribute: false },
    busy: { type: Boolean },
    body: { state: true },
    link: { state: true },
    visibility: { state: true },
  };
  declare label: string;
  declare placeholder: string;
  declare hint: string;
  declare choices: PostVisibility[];
  declare choiceHints: Partial<Record<PostVisibility, string>>;
  declare busy: boolean;
  declare body: string;
  declare link: string;
  declare visibility: PostVisibility;

  constructor() {
    super();
    this.label = 'Beitrag';
    this.placeholder = '';
    this.hint = '';
    this.choices = ['public'];
    this.choiceHints = {};
    this.busy = false;
    this.body = '';
    this.link = '';
    this.visibility = 'public';
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
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-2);
        align-items: center;
      }
    `,
  ];

  /** Nach erfolgreichem Posten (vom Host aufgerufen). */
  clear() {
    this.body = '';
    this.link = '';
  }

  private submit(e: Event) {
    e.preventDefault();
    const visibility = this.choices.includes(this.visibility) ? this.visibility : this.choices[0];
    emit(this, 'sx-post-submit', { body: this.body, link: this.link.trim(), visibility });
  }

  render() {
    const len = commentLength(this.body.trim());
    const current = this.choices.includes(this.visibility) ? this.visibility : this.choices[0];
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
      <div class="row"><button class="btn primary" type="submit" ?disabled=${this.busy || !len || len > POST_MAX}>${icon('comment')} Veröffentlichen</button>
        ${this.hint ? html`<span class="hint">${this.hint}</span>` : ''}</div>
    </form>`;
  }
}
customElements.define('sx-post-composer', SxPostComposer);
