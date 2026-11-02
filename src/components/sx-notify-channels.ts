import { LitElement, css, html } from 'lit';
import type { NotifyChannel } from '../services/api';
import { DEFAULT_LEVEL_CHOICES, NOTIFY_LEVEL_HINT, NOTIFY_LEVEL_LABEL, type NotifyLevel } from '../domain/notifications';
import { base, emit } from './shared';
import './sx-notify-bell';

const KIND_LABEL: Record<NotifyChannel['kind'], string> = { group: 'Gruppe', user: 'Profil', boat: 'Boot', harbor: 'Hafen' };

/**
 * Übersicht „Benachrichtigungen je Verlauf“ im Konto (Konzept 24.6, F-449): Voreinstellung für Verläufe ohne eigene
 * Wahl und alle Gruppen (Mitglied) und gefolgten Verläufe mit ihrer Glocke (`sx-notify-bell`, derselbe Baustein wie auf
 * den Seiten). Rein präsentational – meldet `sx-notify-default` { level } und (über die Glocken) `sx-notify-level`.
 */
export class SxNotifyChannels extends LitElement {
  static properties = { data: { attribute: false }, busy: { type: Boolean } };
  declare data: { defaultLevel: NotifyLevel; channels: NotifyChannel[] } | null;
  declare busy: boolean;

  constructor() {
    super();
    this.data = null;
    this.busy = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: grid;
        gap: var(--s-2);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-1);
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--s-2);
      }
      .name {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .sub {
        display: block;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
    `,
  ];

  /** Mitgliedschaften und Folgen getrennt (F-446), jeweils mit Glocke. */
  private list(title: string, items: NotifyChannel[], fallback: NotifyLevel, empty: string) {
    return html`<div class="label">${title}</div>
      ${items.length
        ? html`<ul aria-label=${title}>
            ${items.map(
              (c) => html`<li>
                <span class="name">${c.path ? html`<a href=${c.path}>${c.name || c.ref}</a>` : c.name || c.ref}
                  <span class="sub">${KIND_LABEL[c.kind]}${c.level ? '' : ' · Voreinstellung'}</span></span>
                <sx-notify-bell kind=${c.kind} target-id=${c.ref} label=${c.name} level=${c.level ?? fallback}></sx-notify-bell>
              </li>`,
            )}
          </ul>`
        : html`<p class="hint">${empty}</p>`}`;
  }

  render() {
    const d = this.data;
    if (!d) return html`<p class="hint">Lade …</p>`;
    return html`<label><span class="label">Voreinstellung für Mitgliedschaften (neue Gruppen)</span>
        <select .value=${d.defaultLevel} ?disabled=${this.busy} @change=${(e: Event) => emit(this, 'sx-notify-default', { level: (e.target as HTMLSelectElement).value as NotifyLevel })}>
          ${DEFAULT_LEVEL_CHOICES.map((l) => html`<option value=${l} ?selected=${l === d.defaultLevel}>${NOTIFY_LEVEL_LABEL[l]} – ${NOTIFY_LEVEL_HINT[l]}</option>`)}
        </select></label>
      ${this.list('Mitgliedschaften', d.channels.filter((c) => c.member), d.defaultLevel, 'Noch in keinem Verein oder Team.')}
      ${this.list('Du folgst', d.channels.filter((c) => !c.member), d.defaultLevel, 'Du folgst noch nichts. Folgende sehen nur Öffentliches; Standard „Nur Direktes“.')}
      <p class="hint">Automatische Einträge wie Beitritte, neue Boote oder Meilensteine benachrichtigen nie. „Stumm“ blendet den Verlauf auch in deinen Neuigkeiten aus.</p>`;
  }
}
customElements.define('sx-notify-channels', SxNotifyChannels);
