import { LitElement, css, html, svg } from 'lit';
import type { DiscoverGroup, DiscoverHarbor } from '../services/api';
import { MILESTONES_NM } from '../domain/groups';
import { fmtNum } from '../domain/format';
import { seasonStatsShown, type SeasonStats } from '../domain/season-stats';
import { icon } from './icons';
import { POST_VISIBILITY_ICON, base, coverBanner, coverBannerStyles, emit } from './shared';
import type { PostVisibility } from '../domain/posts';

/** Stufen auf Folie 4 – Wörter wie im Schreib-Dialog (UX-NAVIGATION N7). */
const LEVELS: Array<[PostVisibility, string]> = [
  ['public', 'Öffentlich'],
  ['members', 'Nur Mitglieder'],
  ['unlisted', 'Nur mit Link'],
  ['private', 'Nur ich'],
];

/**
 * Gäste-Slider der Startseite (F-431, Konzept 22): vier Folien mit je einem Knopf – er ersetzt für Gäste die Karten
 * „Eigenen Törn anlegen“ und „Mitmachen“. Geblättert wird per Wischen (Scroll-Snap), Punkte und – mit Maus – Pfeile;
 * kein automatischer Wechsel. Rein präsentational, Daten vom GuestSliderController. Meldet:
 * `sx-compose-open` { kind: 'gpx' } (derselbe Weg wie „+ Neu → Törn (GPX)“), `sx-guest-stream` (zum Stream),
 * `sx-login`, `sx-guest-dismiss` (×). „Vereine & Häfen entdecken“ ist ein Link nach /entdecken.
 */
export class SxGuestSlider extends LitElement {
  static properties = {
    stats: { attribute: false },
    groups: { attribute: false },
    harbors: { attribute: false },
    index: { state: true },
  };
  /** Saison-Zahlen (null = nicht geladen oder Fehler – die Folie zeigt dann Text) */
  declare stats: SeasonStats | null;
  /** öffentliche Vereine und Teams (in der Nähe, falls ein Ort bekannt ist) – Folie 2 */
  declare groups: DiscoverGroup[];
  declare harbors: DiscoverHarbor[];
  /** sichtbare Folie */
  declare index: number;

  constructor() {
    super();
    this.stats = null;
    this.groups = [];
    this.harbors = [];
    this.index = 0;
  }

  static styles = [
    base,
    coverBannerStyles,
    css`
      :host {
        display: block;
      }
      section {
        position: relative;
        border-radius: var(--radius-l);
        background: var(--overlay);
        backdrop-filter: blur(10px) saturate(1.2);
        border: 1px solid var(--border);
        box-shadow: var(--shadow-1);
        overflow: hidden;
      }
      .close {
        position: absolute;
        top: var(--s-1);
        right: var(--s-1);
        z-index: 1;
      }
      /* Folien nebeneinander, eine je Breite; nur waagerecht scrollbar – senkrecht scrollt die Seite */
      .track {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        scroll-snap-type: x mandatory;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
      }
      .track::-webkit-scrollbar {
        display: none;
      }
      @media (prefers-reduced-motion: no-preference) {
        .track {
          scroll-behavior: smooth;
        }
      }
      .slide {
        scroll-snap-align: start;
        scroll-snap-stop: always;
        min-width: 0;
        padding: var(--s-4) var(--s-4) var(--s-2);
        display: flex;
        flex-direction: column;
        gap: var(--s-2);
      }
      .art {
        height: clamp(84px, 16svh, 132px);
        margin: 0 calc(-1 * var(--s-1));
        border-radius: var(--radius);
        background: var(--accent-soft);
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .art svg {
        width: 100%;
        height: 100%;
      }
      .art .water {
        fill: var(--accent-soft);
      }
      .art .land {
        fill: var(--surface-2);
        stroke: var(--border);
      }
      .art .ink {
        fill: var(--text);
      }
      .art .accent {
        fill: var(--accent);
      }
      .art .speed {
        stroke: var(--c-speed);
      }
      .art .muted {
        stroke: var(--border);
      }
      .art text {
        fill: var(--text-2);
        font: 600 11px var(--font);
      }
      h2 {
        margin: var(--s-1) 0 0;
        font-size: var(--fs-l);
        line-height: 1.25;
        letter-spacing: -0.01em;
      }
      p {
        margin: 0;
        font-size: var(--fs-s);
        color: var(--text-2);
      }
      .slide .btn.primary {
        margin-top: auto;
        align-self: flex-start;
        min-height: max(44px, var(--control-h));
        text-decoration: none;
      }
      /* Kennzahlen der Saison statt Bild */
      .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--s-2);
        width: 100%;
        padding: var(--s-3);
        text-align: center;
      }
      .stats b {
        display: block;
        font-size: var(--fs-num-l);
        color: var(--text);
        font-variant-numeric: tabular-nums;
      }
      .stats span {
        font-size: var(--fs-xs);
        color: var(--text-2);
      }
      /* Vereine mit Titelbild */
      .covers {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        gap: var(--s-1);
        width: 100%;
        height: 100%;
        padding: var(--s-2);
      }
      .covers figure {
        margin: 0;
        position: relative;
        border-radius: var(--radius-s);
        overflow: hidden;
        min-width: 0;
      }
      .covers .cover-banner {
        height: 100%;
        aspect-ratio: auto;
      }
      .covers figcaption {
        position: absolute;
        inset: auto 0 0;
        padding: 2px var(--s-1);
        font-size: var(--fs-xs);
        font-weight: 600;
        color: var(--text);
        background: var(--overlay);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .levels {
        list-style: none;
        margin: 0;
        padding: var(--s-2);
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--s-1);
        width: 100%;
        text-align: center;
      }
      .levels li {
        display: grid;
        justify-items: center;
        gap: 4px;
        font-size: var(--fs-xs);
        color: var(--text-2);
      }
      .levels svg {
        width: 28px;
        height: 28px;
        color: var(--accent);
      }
      .nav {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--s-1);
        padding: 0 var(--s-2) var(--s-2);
      }
      .dots {
        display: flex;
      }
      .dot {
        width: 28px;
        height: 28px;
        border: 0;
        padding: 0;
        background: none;
        cursor: pointer;
        display: grid;
        place-items: center;
        border-radius: 999px;
      }
      .dot::before {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--border);
      }
      .dot[aria-current='true']::before {
        width: 20px;
        background: var(--accent);
      }
      @media (pointer: coarse) {
        .dot {
          width: 40px;
          height: 40px;
        }
      }
      /* Pfeile nur mit Maus – auf Touch-Geräten wird gewischt */
      .arrow {
        display: none;
      }
      @media (hover: hover) and (pointer: fine) {
        .arrow {
          display: inline-flex;
        }
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `,
  ];

  // ---------------------------------------------------------------- Bilder (schlicht, im Stil des Logos)

  /** Folie 1: Kartenausschnitt mit Track im Geschwindigkeitsband und Boot. */
  private artTrack() {
    return svg`<svg viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect class="water" width="320" height="120"/>
      <path class="land" d="M0 0h120c-8 22 10 34 -6 52S60 70 40 96 0 120 0 120z"/>
      <path class="land" d="M320 0v70c-26-6-40 10-62 4s-30-34-14-50S270 0 250 0z"/>
      <g fill="none" stroke-linecap="round">
        <path class="speed" stroke-width="5" stroke-opacity=".35" d="M58 104c20-10 34-26 56-28"/>
        <path class="speed" stroke-width="5" stroke-opacity=".6" d="M114 76c26-2 40 18 66 14"/>
        <path class="speed" stroke-width="5" stroke-opacity=".85" d="M180 90c22-4 30-24 50-36"/>
        <path class="speed" stroke-width="5" d="M230 54c12-8 22-12 34-12"/>
      </g>
      <g transform="translate(258 18) scale(1.1)">
        <path class="accent" d="M17 3Q23.5 11 26.5 21H17z"/>
        <path class="accent" opacity=".6" d="M15.4 6V21H6.5Q9.6 12.6 15.4 6z"/>
        <path class="ink" d="M4.5 23H28Q26 27.6 21.8 27.6H9.6Q5.8 27.2 4.5 23z"/>
      </g>
    </svg>`;
  }

  /** Folie 2 ohne Zahlen: mehrere Segel auf dem Wasser. */
  private artFleet() {
    const boat = (x: number, y: number, s: number, o: number) => svg`<g transform="translate(${x} ${y}) scale(${s})" opacity=${o}>
      <path class="accent" d="M17 3Q23.5 11 26.5 21H17z"/><path class="accent" opacity=".6" d="M15.4 6V21H6.5Q9.6 12.6 15.4 6z"/>
      <path class="ink" d="M4.5 23H28Q26 27.6 21.8 27.6H9.6Q5.8 27.2 4.5 23z"/></g>`;
    return svg`<svg viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect class="water" width="320" height="120"/>
      ${boat(40, 52, 1.4, 1)} ${boat(130, 26, 1.1, 0.8)} ${boat(206, 58, 1.6, 1)} ${boat(268, 20, 0.9, 0.6)}
    </svg>`;
  }

  /** Folie 3: Meilensteine der Saison auf einer Linie. */
  private artMilestones() {
    const max = MILESTONES_NM[MILESTONES_NM.length - 1];
    const x = (nm: number) => 24 + (nm / max) * 272;
    return svg`<svg viewBox="0 0 320 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path class="muted" stroke-width="8" stroke-linecap="round" d="M24 70H296"/>
      <path class="speed" stroke-width="8" stroke-linecap="round" d=${`M24 70H${x(MILESTONES_NM[1]) + 30}`}/>
      ${MILESTONES_NM.map(
        (nm, i) => svg`<g transform="translate(${x(nm)} 0)">
          <path class="ink" d="M0 70V34" stroke="var(--text)" stroke-width="2"/>
          <path class=${i < 2 ? 'accent' : 'land'} d="M1 34h18l-5 6 5 6H1z"/>
          <text x="0" y="98" text-anchor="middle">${fmtNum(nm, 0)} sm</text></g>`,
      )}
    </svg>`;
  }

  /** Folie 4: die Stufen „Wer sieht es“ mit ihren Symbolen (wie im Schreib-Dialog). */
  private artLevels() {
    return html`<ul class="levels">
      ${LEVELS.map(([v, label]) => html`<li>${icon(POST_VISIBILITY_ICON[v])}<span>${label}</span></li>`)}
    </ul>`;
  }

  // ---------------------------------------------------------------- Folien
  // Reihenfolge und Texte folgen den Alleinstellungsmerkmalen (Konzept 22.1); je Folie genau ein Knopf.

  /** Folie 2: Saison-Zahlen, wenn sie nicht leer wirken – sonst Titelbilder der Vereine, sonst Segel. */
  private revierArt() {
    const s = this.stats;
    if (seasonStatsShown(s)) {
      return html`<div class="stats" aria-label="Saison ${s.season}">
        <div><b>${fmtNum(s.voyages, 0)}</b><span>Törns ${s.season}</span></div>
        <div><b>${fmtNum(s.nm, 0)}</b><span>Seemeilen</span></div>
        <div><b>${fmtNum(s.boats, 0)}</b><span>aktive Boote</span></div>
      </div>`;
    }
    const withCover = this.groups.filter((g) => g.cover).slice(0, 3);
    if (withCover.length) return html`<div class="covers">${withCover.map((g) => html`<figure>${coverBanner(g.cover!)}<figcaption>${g.name}</figcaption></figure>`)}</div>`;
    return this.artFleet();
  }

  private slides() {
    const names = [...this.groups.map((g) => g.name), ...this.harbors.map((h) => h.name)].slice(0, 3);
    const example = names.length ? ` Zum Beispiel ${names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}` : names[0]}.` : '';
    return [
      {
        title: 'Sofort ausprobieren – ohne App und ohne Konto',
        art: this.artTrack(),
        text: 'Zieh deine GPX-Datei rein – Strecke, Tempo, Wind und Wellen in Sekunden. Im Browser, ohne App, ohne Anmeldung.',
        action: html`<button class="btn primary" @click=${() => emit(this, 'sx-compose-open', { kind: 'gpx' })}>${icon('upload')} GPX ausprobieren</button>`,
      },
      {
        title: 'Dein Revier, deine Leute',
        art: this.revierArt(),
        text: `Vereine, Teams und Häfen deines Reviers – sieh, was auf Havel und Seen los ist.${example}`,
        action: html`<a class="btn primary" href="/entdecken">${icon('compass')} Vereine &amp; Häfen entdecken</a>`,
      },
      {
        title: 'Dein Fahrtenbuch',
        art: this.artMilestones(),
        text: 'Dein Fahrtenbuch führt sich fast von selbst – Seemeilen je Saison und Jahr, mit oder ohne GPX.',
        action: html`<button class="btn primary" @click=${() => emit(this, 'sx-login')}>${icon('user')} Kostenlos anmelden</button>`,
      },
      {
        title: 'Du bestimmst, wer was sieht',
        art: this.artLevels(),
        text: 'Privat, bis du teilst – dann öffentlich, nur für deinen Verein oder per Link. Was nur für Mitglieder ist, sehen nur Mitglieder.',
        action: html`<button class="btn primary" @click=${() => emit(this, 'sx-guest-stream')}>${icon('community')} Community ansehen</button>`,
      },
    ];
  }

  private get track(): HTMLElement | null {
    return this.renderRoot.querySelector('.track');
  }

  /** Zur Folie `i` blättern (Punkte, Pfeile, Tastatur). */
  go(i: number): void {
    const n = 4;
    const to = Math.max(0, Math.min(n - 1, i));
    this.index = to;
    this.target = to;
    const t = this.track;
    t?.scrollTo?.({ left: to * t.clientWidth });
  }

  /** Ziel eines Blätterns per Knopf – bis es erreicht ist, ändern Zwischenstände den Index nicht. */
  private target: number | null = null;

  /** Wischen: die Folie, die gerade einrastet, gilt als sichtbar. */
  private onScroll = () => {
    const t = this.track;
    if (!t || !t.clientWidth) return;
    const i = Math.round(t.scrollLeft / t.clientWidth);
    if (this.target !== null) {
      if (Math.abs(t.scrollLeft - this.target * t.clientWidth) > 1) return;
      this.target = null;
    }
    if (i !== this.index) this.index = i;
  };

  /** Gewischt statt zu Ende geblättert: am Ende zählt, wo die Folie eingerastet ist. */
  private onScrollEnd = () => {
    this.target = null;
    this.onScroll();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      this.go(this.index + (e.key === 'ArrowRight' ? 1 : -1));
    }
  };

  render() {
    const slides = this.slides();
    const n = slides.length;
    return html`<section aria-roledescription="carousel" aria-label="Willkommen bei Sail Explorer" @keydown=${this.onKey}>
      <button class="btn small ghost icon close" aria-label="Einführung ausblenden" title="Ausblenden" @click=${() => emit(this, 'sx-guest-dismiss')}>${icon('x')}</button>
      <div class="track" aria-live="polite" @scroll=${this.onScroll} @scrollend=${this.onScrollEnd}>
        ${slides.map(
          (s, i) => html`<div class="slide" role="group" aria-roledescription="Folie" aria-label="${i + 1} von ${n}: ${s.title}">
            <div class="art">${s.art}</div>
            <h2>${s.title}</h2>
            <p>${s.text}</p>
            ${s.action}
          </div>`,
        )}
      </div>
      <div class="nav">
        <button class="btn small ghost icon arrow" aria-label="Vorherige Folie" ?disabled=${this.index === 0} @click=${() => this.go(this.index - 1)}>${icon('left')}</button>
        <div class="dots" role="group" aria-label="Folie wählen">
          ${slides.map((s, i) => html`<button class="dot" aria-label="Folie ${i + 1}: ${s.title}" aria-current=${i === this.index ? 'true' : 'false'} @click=${() => this.go(i)}></button>`)}
        </div>
        <button class="btn small ghost icon arrow" aria-label="Nächste Folie" ?disabled=${this.index === n - 1} @click=${() => this.go(this.index + 1)}>${icon('right')}</button>
      </div>
    </section>`;
  }
}
customElements.define('sx-guest-slider', SxGuestSlider);
