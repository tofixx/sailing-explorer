import { LitElement, css, html, type PropertyValues } from 'lit';
import { layoutSegments, nearestByTime, segmentByGaps, type Layout, type Segment, type TimedPoint } from '../domain/timeline';
import { clampView, initialView, isZoomed, maxZoom, panBy, pinch, tickLabel, tickStep, ticks, zoomAt, type ChartView } from '../domain/chart-view';
import { cssVar, fmtDateTime, fmtNum, fmtShort } from '../util/html';
import { base, dialogStyles, emit } from './shared';
import { icon } from './icons';

export interface ChartSeries {
  key: string;
  label: string;
  unit: string;
  colorVar: string;
  axis: 'left' | 'right';
  decimals: number;
  value: (p: TimedPoint) => number | null;
  width?: number;
  fill?: boolean;
}

export interface ChartAxis {
  unit: string;
  colorVar: string;
  /** Mindest-Maximum und Rundungsschritt */
  minMax: number;
  step: number;
}

/** Markierung auf der Zeitachse, z. B. ein Foto (Konzept 3.3: Foto-Ticks). */
export interface ChartMark {
  id: string;
  time: number;
}

export interface RefLine {
  value: number;
  label: string;
  colorVar: string;
  axis: 'left' | 'right';
}

const H = 156;
/** Großansicht (F-430): höher, und je Stunde anfangs mindestens so viele Pixel – längere Zeiträume sind seitlich scrollbar */
const H_LARGE = 340;
const PX_PER_HOUR_LARGE = 28;
const PAD = { t: 18, b: 20 };
/** Zoomstufe je Doppeltipp bzw. Taste */
const ZOOM_STEP = 2;
const KEY_ZOOM = 1.5;
/** Ab so vielen Pixeln Bewegung ist ein Tipp ein Ziehen */
const DRAG_PX = 6;
const DOUBLE_TAP_MS = 350;

const ZOOM_HINT =
  'Mausrad oder zwei Finger zoomen, Ziehen verschiebt, Doppelklick zoomt hinein; Tasten Plus und Minus zoomen, Pfeiltasten verschieben, 0 zeigt den ganzen Zeitraum.';

/**
 * Generisches Zeitreihen-Diagramm mit Pausen-Segmentierung, zwei Y-Achsen und
 * synchronisiertem Fadenkreuz. Statischer Inhalt und Hover liegen auf getrennten Canvas.
 *
 * Großansicht (`large`, F-430): Zoom und Verschieben über EINEN Mechanismus – das native seitliche Scrollen von
 * `.scroll`. Zoom ändert nur die Breite des Scrollinhalts (`.wrap`); die Canvas sind so breit wie der sichtbare
 * Bereich (`position: sticky`) und zeichnen nur den Ausschnitt ab `scrollLeft`. Die Regeln stehen in
 * `src/domain/chart-view.ts`.
 */
export class SxTimeChart extends LitElement {
  static properties = {
    points: { attribute: false },
    series: { attribute: false },
    left: { attribute: false },
    right: { attribute: false },
    refLine: { attribute: false },
    hoverTime: { attribute: false },
    marks: { attribute: false },
    activeMark: { attribute: false },
    label: { type: String },
    large: { type: Boolean, reflect: true },
    zoomed: { state: true },
    bigZoomed: { state: true },
  };
  declare points: TimedPoint[];
  declare series: ChartSeries[];
  declare left: ChartAxis;
  declare right: ChartAxis | null;
  declare refLine: RefLine | null;
  declare hoverTime: number | null;
  /** Foto-Ticks in --c-photo am unteren Rand; Klick darauf meldet `sx-photo-open` */
  declare marks: ChartMark[];
  declare activeMark: string | null;
  declare label: string;
  /** Großansicht im Dialog: höher, Zeitachse zoom- und verschiebbar (F-430) */
  declare large: boolean;
  /** Großansicht offen */
  declare zoomed: boolean;
  /** Großansicht weiter als „ganzer Zeitraum“ gezoomt – zeigt den Knopf „Ganzer Zeitraum“ */
  declare bigZoomed: boolean;

  /** Breite der Canvas = sichtbare Breite (nie die ganze Zeitreihe) */
  private width = 320;
  /** Ausschnitt der Großansicht; null bis zur ersten Messung */
  private view: ChartView | null = null;
  private segs: Segment[] = [];
  private gesture: { x0: number; off0: number; moved: boolean } | null = null;
  private pinchStart: { view: ChartView; dist: number; mid: number } | null = null;
  /** aktive Zeiger der Großansicht: id → clientX */
  private ptrs = new Map<number, number>();
  private lastTap = { t: 0, x: 0 };
  private suppressClick = false;
  private frame = 0;
  private onWheel = { handleEvent: (e: WheelEvent) => this.wheel(e), passive: false };
  private layout: Layout | null = null;
  private scales: Record<'left' | 'right', number> = { left: 1, right: 1 };
  private ro?: ResizeObserver;
  private mq = matchMedia('(prefers-color-scheme: dark)');
  private onScheme = () => this.drawBase();

  private get h(): number {
    return this.large ? H_LARGE : H;
  }

  /** Breite der Datenfläche zwischen den Y-Achsen */
  private get dataW(): number {
    const { l, r } = this.pad;
    return Math.max(1, this.width - l - r);
  }

  /** Datenzeit ohne Pausen (ms) */
  private get dataMs(): number {
    return this.segs.reduce((sum, seg) => sum + seg.dur, 0);
  }

  private get maxZ(): number {
    return maxZoom(this.dataMs, this.dataW);
  }

  /** Breite des Scrollinhalts der Großansicht (px): höchstens MAX_CONTENT_PX plus Ränder – keine Canvas-Größe. */
  contentWidth(): number {
    const { l, r } = this.pad;
    return Math.round(l + this.dataW * (this.view?.zoom ?? 1) + r);
  }

  constructor() {
    super();
    this.points = [];
    this.series = [];
    this.left = { unit: '', colorVar: '--text-2', minMax: 1, step: 1 };
    this.right = null;
    this.refLine = null;
    this.hoverTime = null;
    this.marks = [];
    this.activeMark = null;
    this.label = '';
    this.large = false;
    this.zoomed = false;
    this.bigZoomed = false;
  }

  static styles = [
    base,
    dialogStyles,
    css`
      :host {
        display: block;
      }
      .wrap {
        position: relative;
        height: ${H}px;
        touch-action: pan-y;
      }
      .stage {
        position: absolute;
        inset: 0;
      }
      /* Gitterzelle im Dialog: nie so breit wie der Scrollinhalt werden, sonst misst der ResizeObserver dessen Breite */
      :host([large]) {
        min-width: 0;
      }
      :host([large]) .scroll {
        overflow-x: auto;
        overscroll-behavior-x: contain;
      }
      :host([large]) .scroll:focus-visible {
        outline: none;
        box-shadow: var(--focus);
      }
      /* Großansicht: Gesten im Diagramm gehören ihm (Ziehen, Pinch, Doppeltipp) – außerhalb scrollt die Seite normal */
      :host([large]) .wrap {
        height: ${H_LARGE}px;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      :host([large]) .stage {
        position: sticky;
        left: 0;
        height: 100%;
      }
      .zoom {
        margin-left: auto;
      }
      /* breiter Dialog nur am Desktop – mobil gilt die randlose Vollbild-Regel aus dialogStyles (F-291) */
      @media (min-width: 761px) {
        dialog[open] {
          width: min(1200px, calc(100vw - 32px));
        }
      }
      dialog .body {
        padding-top: 0;
      }
      dialog header h2 {
        min-width: 0;
      }
      dialog header .when {
        margin-left: var(--s-2);
        font-size: var(--fs-m);
        font-weight: 500;
        color: var(--text-3);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      /* Handy: Zeitpunkt in eigener Zeile, damit Titel, „Ganzer Zeitraum“ und „Schließen“ nebeneinander passen */
      @media (max-width: 760px) {
        dialog header .when {
          display: block;
          margin-left: 0;
        }
      }
      dialog header .reset {
        flex: none;
        white-space: nowrap;
      }
      canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      .overlay {
        cursor: crosshair;
      }
      .overlay.dragging {
        cursor: grabbing;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-1) var(--s-3);
        margin-top: var(--s-2);
        font-size: var(--fs-s);
        color: var(--text-2);
        min-height: 20px;
      }
      .legend span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-variant-numeric: tabular-nums;
      }
      .legend i {
        width: 12px;
        height: 3px;
        border-radius: 2px;
      }
      .legend b {
        color: var(--text);
        font-weight: 650;
      }
      .legend .time {
        margin-left: auto;
        color: var(--text-3);
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    this.mq.addEventListener('change', this.onScheme);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.mq.removeEventListener('change', this.onScheme);
    this.ro?.disconnect();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private get scrollBox(): HTMLElement | null {
    return this.renderRoot.querySelector('.scroll');
  }

  firstUpdated() {
    const box = this.renderRoot.querySelector(this.large ? '.scroll' : '.wrap') as HTMLElement;
    if (this.large) this.resize(Math.round(box.clientWidth) || this.width);
    this.ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (!w || w === this.width) return;
      if (this.large) this.resize(w);
      else {
        this.width = w;
        this.drawBase();
        this.drawOverlay();
      }
    });
    this.ro.observe(box);
  }

  /** Großansicht: neue sichtbare Breite – der Zoom bleibt, der Versatz wird mitskaliert. */
  private resize(w: number) {
    const before = this.dataW;
    this.width = w;
    const stage = this.renderRoot.querySelector('.stage') as HTMLElement | null;
    if (stage) stage.style.width = `${w}px`;
    if (!this.view) this.resetView(true);
    else this.setView({ zoom: this.view.zoom, offset: (this.view.offset * this.dataW) / before });
  }

  willUpdate(changed: PropertyValues<this>) {
    if (changed.has('points')) this.segs = this.points.length ? segmentByGaps(this.points) : [];
    if (changed.has('points') || changed.has('series') || changed.has('left') || changed.has('right')) this.computeScales();
    if (changed.has('zoomed') && !this.zoomed) this.bigZoomed = false;
  }

  updated(changed: PropertyValues<this>) {
    // neue Daten (nicht beim ersten Mal – da misst firstUpdated): Anfangsansicht
    if (this.large && changed.has('points') && this.view && changed.get('points') !== undefined) this.resetView(true);
    if (changed.has('zoomed')) {
      const dlg = this.renderRoot.querySelector('dialog');
      if (this.zoomed && dlg && !dlg.open) dlg.showModal();
      else if (!this.zoomed && dlg?.open) dlg.close();
    }
    if (changed.has('points') || changed.has('series') || changed.has('refLine') || changed.has('left') || changed.has('right') || changed.has('marks')) this.drawBase();
    this.drawOverlay();
  }

  // ── Ausschnitt (nur Großansicht) ─────────────────────────────────────────

  /**
   * Setzt den Ausschnitt: Breite des Scrollinhalts, dann scrollLeft (das ist der Versatz – kein zweites
   * Scrollsystem), dann neu zeichnen. Meldet `sx-chart-zoom` (true/false), wenn sich „gezoomt“ ändert.
   */
  private setView(v: ChartView) {
    const next = clampView(v, this.dataW, this.maxZ);
    const was = this.view ? isZoomed(this.view) : false;
    this.view = next;
    const wrap = this.renderRoot.querySelector('.wrap') as HTMLElement | null;
    if (wrap) wrap.style.width = `${this.contentWidth()}px`;
    const box = this.scrollBox;
    if (box) box.scrollLeft = next.offset;
    if (isZoomed(next) !== was) emit(this, 'sx-chart-zoom', isZoomed(next));
    this.scheduleDraw();
  }

  /**
   * „Ganzer Zeitraum“ (zoom 1). Mit `initial` stattdessen die Anfangsansicht (28 px je Stunde), auf den gewählten
   * Zeitpunkt zentriert, falls einer gesetzt ist.
   */
  resetView(initial = false) {
    if (!initial || !this.segs.length) {
      this.setView({ zoom: 1, offset: 0 });
      return;
    }
    const v = initialView(this.dataMs, this.dataW, PX_PER_HOUR_LARGE);
    let offset = 0;
    const i = this.hoverIndex();
    if (i >= 0) offset = layoutSegments(this.points, this.segs, 0, this.dataW * v.zoom).x(i) - this.dataW / 2;
    this.setView({ zoom: v.zoom, offset });
  }

  private onScroll() {
    const box = this.scrollBox;
    if (!box || !this.view) return;
    if (Math.abs(box.scrollLeft - this.view.offset) < 1) return;
    this.view = clampView({ zoom: this.view.zoom, offset: box.scrollLeft }, this.dataW, this.maxZ);
    this.scheduleDraw();
  }

  private scheduleDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.drawBase();
      this.drawOverlay();
    });
  }

  /** Zeigerposition ab linkem Rand der Datenfläche */
  private anchorOf(clientX: number): number {
    const stage = this.renderRoot.querySelector('.stage') as HTMLElement;
    return clientX - stage.getBoundingClientRect().left - this.pad.l;
  }

  private zoomBy(factor: number, anchor = this.dataW / 2): boolean {
    if (!this.view) return false;
    const next = zoomAt(this.view, factor, anchor, this.dataW, this.maxZ);
    if (next.zoom === this.view.zoom && next.offset === this.view.offset) return false;
    this.setView(next);
    return true;
  }

  /**
   * Mausrad: senkrecht (auch mit Strg/⌘ bzw. Trackpad-Pinch, der als wheel + ctrlKey kommt) zoomt um den Zeiger;
   * waagerecht (Trackpad-Wischen, Umschalt + Rad) bleibt natives seitliches Scrollen = Verschieben. Ist die
   * Zoomgrenze erreicht, geht das Rad ohne Strg an die Seite weiter.
   */
  private wheel(e: WheelEvent) {
    if (!this.view) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl && (e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY))) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.dataW : 1;
    const dy = Math.max(-100, Math.min(100, e.deltaY * unit));
    // Trackpad-Pinch liefert kleine Schritte, das Mausrad etwa 100 je Raste
    const factor = Math.exp(-dy * (Math.abs(dy) < 40 ? 0.01 : 0.002));
    const changed = this.zoomBy(factor, this.anchorOf(e.clientX));
    if (changed || ctrl) e.preventDefault();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.view || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = this.dataW * (e.shiftKey ? 1 : 0.25);
    switch (e.key) {
      case '+':
      case '=':
        this.zoomBy(KEY_ZOOM);
        break;
      case '-':
      case '_':
        this.zoomBy(1 / KEY_ZOOM);
        break;
      case 'ArrowLeft':
        this.setView(panBy(this.view, -step, this.dataW, this.maxZ));
        break;
      case 'ArrowRight':
        this.setView(panBy(this.view, step, this.dataW, this.maxZ));
        break;
      case '0':
        this.resetView();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // ── Zeiger: Maus, Stift, Touch ───────────────────────────────────────────

  private onDown(e: PointerEvent) {
    if (!this.large) return this.onPointer(e);
    if (!this.view || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Zeiger schon weg – ohne Capture weiter
    }
    this.ptrs.set(e.pointerId, e.clientX);
    this.suppressClick = false;
    if (this.ptrs.size === 1) {
      this.gesture = { x0: e.clientX, off0: this.view.offset, moved: false };
      if (e.pointerType === 'mouse') this.onPointer(e);
    } else if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinchStart = { view: this.view, dist: Math.max(1, Math.abs(a - b)), mid: this.anchorOf((a + b) / 2) };
      if (this.gesture) this.gesture.moved = true; // kein Tipp mehr
    }
  }

  private onMove(e: PointerEvent) {
    if (!this.large) return this.onPointer(e);
    if (!this.ptrs.has(e.pointerId)) {
      if (e.pointerType === 'mouse') this.onPointer(e);
      return;
    }
    this.ptrs.set(e.pointerId, e.clientX);
    if (this.pinchStart && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const p = this.pinchStart;
      this.setView(pinch(p.view, Math.max(1, Math.abs(a - b)) / p.dist, p.mid, this.anchorOf((a + b) / 2), this.dataW, this.maxZ));
      return;
    }
    const g = this.gesture;
    if (!g || !this.view) return;
    const dx = e.clientX - g.x0;
    if (!g.moved && Math.abs(dx) > DRAG_PX) {
      g.moved = true;
      (e.currentTarget as HTMLElement).classList.add('dragging');
    }
    if (g.moved) this.setView({ zoom: this.view.zoom, offset: g.off0 - dx });
    else if (e.pointerType === 'mouse') this.onPointer(e);
  }

  private onUp(e: PointerEvent, cancelled = false) {
    if (!this.large || !this.ptrs.has(e.pointerId)) return;
    const tap = !cancelled && this.ptrs.size === 1 && !!this.gesture && !this.gesture.moved;
    if (this.gesture?.moved) this.suppressClick = true;
    this.ptrs.delete(e.pointerId);
    (e.currentTarget as HTMLElement).classList.remove('dragging');
    if (this.ptrs.size < 2) this.pinchStart = null;
    // nach dem Pinch verschiebt der verbleibende Finger weiter, ohne zu springen
    if (this.ptrs.size === 1 && this.view) this.gesture = { x0: [...this.ptrs.values()][0], off0: this.view.offset, moved: true };
    if (this.ptrs.size === 0) this.gesture = null;
    if (!tap) return;
    // Tipp: Fadenkreuz setzen; zweiter Tipp kurz danach an derselben Stelle zoomt hinein
    this.onPointer(e);
    const now = e.timeStamp || performance.now();
    if (now - this.lastTap.t < DOUBLE_TAP_MS && Math.abs(e.clientX - this.lastTap.x) < 30) {
      this.zoomBy(ZOOM_STEP, this.anchorOf(e.clientX));
      this.lastTap = { t: 0, x: 0 };
    } else this.lastTap = { t: now, x: e.clientX };
  }

  private canvas(sel: string) {
    const cv = this.renderRoot.querySelector(sel) as HTMLCanvasElement | null;
    if (!cv) return null;
    const dpr = window.devicePixelRatio || 1;
    cv.width = this.width * dpr;
    cv.height = this.h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.h);
    return ctx;
  }

  private get pad() {
    return { l: 34, r: this.right ? 36 : 12 };
  }

  private y(v: number, axis: 'left' | 'right') {
    return this.h - PAD.b - (this.h - PAD.t - PAD.b) * (v / this.scales[axis]);
  }

  /** Y-Skalen über die ganze Zeitreihe – bleiben beim Zoomen und Verschieben stehen. */
  private computeScales() {
    const niceCeil = (v: number, step: number) => Math.max(step, Math.ceil(v / step) * step);
    for (const axis of ['left', 'right'] as const) {
      const def = axis === 'left' ? this.left : this.right;
      if (!def) continue;
      let max = def.minMax;
      for (const s of this.series) {
        if (s.axis !== axis) continue;
        for (const p of this.points) {
          const v = s.value(p);
          if (v != null && v > max) max = v;
        }
      }
      this.scales[axis] = niceCeil(max, def.step);
    }
  }

  private drawBase() {
    const ctx = this.canvas('canvas.base');
    if (!ctx || this.points.length < 2 || !this.segs.length) return;
    const pts = this.points;
    const c = (v: string) => cssVar(this, v);
    const { l, r } = this.pad;
    const W = this.width;
    // Großansicht: die ganze Zeitreihe ist dataW * zoom breit und um offset verschoben; gezeichnet wird nur [l, W - r]
    const view = this.large && this.view ? this.view : { zoom: 1, offset: 0 };
    const x0 = l - view.offset;
    this.layout = layoutSegments(pts, this.segs, x0, x0 + this.dataW * view.zoom);

    // Gitter mit Beschriftung: 0, 50 %, 100 %
    ctx.font = `${c('--fs-xs')} ${c('--font')}`;
    for (const f of [1, 0.5, 0]) {
      const y = this.h - PAD.b - (this.h - PAD.t - PAD.b) * f;
      ctx.beginPath();
      ctx.setLineDash(f === 0.5 ? [4, 3] : []);
      ctx.strokeStyle = f === 0 ? c('--chart-axis') : c('--chart-grid');
      ctx.lineWidth = 1;
      ctx.moveTo(l, y + 0.5);
      ctx.lineTo(W - r, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c(this.left.colorVar);
      ctx.textAlign = 'right';
      ctx.fillText(fmtNum(this.scales.left * f, this.left.step < 1 ? 1 : 0), l - 5, y + 3);
      if (this.right) {
        ctx.fillStyle = c(this.right.colorVar);
        ctx.textAlign = 'left';
        ctx.fillText(fmtNum(this.scales.right * f, this.right.step < 1 ? 1 : 0), W - r + 5, y + 3);
      }
    }
    ctx.fillStyle = c(this.left.colorVar);
    ctx.textAlign = 'right';
    ctx.fillText(this.left.unit, l - 5, PAD.t - 7);
    if (this.right) {
      ctx.fillStyle = c(this.right.colorVar);
      ctx.textAlign = 'left';
      ctx.fillText(this.right.unit, W - r + 5, PAD.t - 7);
    }

    if (this.large) this.drawTimeTicks(ctx);
    ctx.save();
    this.clipData(ctx);

    // Pausen-Trenner
    const segs = this.layout.segs;
    ctx.strokeStyle = c('--chart-axis');
    ctx.setLineDash([2, 3]);
    for (let i = 0; i < segs.length - 1; i++) {
      const xm = (segs[i].x0 + segs[i].w + segs[i + 1].x0) / 2;
      ctx.beginPath();
      ctx.moveTo(xm, PAD.t);
      ctx.lineTo(xm, this.h - PAD.b);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (!this.large) this.drawSegmentLabels(ctx);

    // Reihen – nur der sichtbare Indexbereich (plus je ein Punkt Rand)
    const x = this.layout.x;
    const tA = this.layout.timeAt(l) ?? pts[0].time;
    const tB = this.layout.timeAt(W - r) ?? pts[pts.length - 1].time;
    const iA = Math.max(0, nearestByTime(pts, tA) - 1);
    const iB = Math.min(pts.length - 1, nearestByTime(pts, tB) + 1);
    for (const s of this.series) {
      const color = c(s.colorVar);
      for (const seg of segs) {
        const a = Math.max(seg.a, iA);
        const b = Math.min(seg.b, iB);
        if (a > b) continue;
        if (s.fill) {
          ctx.beginPath();
          let started = false;
          let lx = 0;
          for (let i = a; i <= b; i++) {
            const v = s.value(pts[i]);
            if (v == null) continue;
            const px = x(i);
            if (!started) {
              ctx.moveTo(px, this.h - PAD.b);
              started = true;
            }
            ctx.lineTo(px, this.y(v, s.axis));
            lx = px;
          }
          if (started) {
            ctx.lineTo(lx, this.h - PAD.b);
            ctx.closePath();
            ctx.globalAlpha = 0.14;
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
        ctx.beginPath();
        let on = false;
        for (let i = a; i <= b; i++) {
          const v = s.value(pts[i]);
          if (v == null) {
            on = false;
            continue;
          }
          const px = x(i);
          const py = this.y(v, s.axis);
          if (on) ctx.lineTo(px, py);
          else {
            ctx.moveTo(px, py);
            on = true;
          }
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = s.width ?? 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }

    // Foto-Ticks am unteren Rand
    ctx.strokeStyle = c('--c-photo');
    ctx.lineWidth = 2;
    for (const m of this.marks) {
      const mx = this.markX(m.time);
      if (mx === null) continue;
      ctx.beginPath();
      ctx.moveTo(mx, this.h - PAD.b - 7);
      ctx.lineTo(mx, this.h - PAD.b);
      ctx.stroke();
    }
    ctx.restore();

    // Referenzlinie (z. B. Median)
    if (this.refLine) {
      const y = this.y(this.refLine.value, this.refLine.axis);
      ctx.strokeStyle = c(this.refLine.colorVar);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(l, y);
      ctx.lineTo(W - r, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c(this.refLine.colorVar);
      ctx.textAlign = 'right';
      ctx.font = `600 ${c('--fs-xs')} ${c('--font')}`;
      ctx.fillText(this.refLine.label, W - r - 2, y - 4 < PAD.t + 8 ? y + 12 : y - 4);
    }
  }

  /** Großansicht: nichts über die Y-Achsen hinaus zeichnen */
  private clipData(ctx: CanvasRenderingContext2D) {
    if (!this.large) return;
    const { l, r } = this.pad;
    ctx.beginPath();
    ctx.rect(l, 0, this.width - l - r, this.h);
    ctx.clip();
  }

  /** Kleines Diagramm: Zeitachse mit Beginn jedes Segments und Ende (unverändert) */
  private drawSegmentLabels(ctx: CanvasRenderingContext2D) {
    const segs = this.layout!.segs;
    const fmtT = (t: number) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    ctx.fillStyle = cssVar(this, '--chart-label');
    let lastX = -1e9;
    ctx.textAlign = 'left';
    for (const s of segs) {
      if (s.x0 - lastX < 80) continue;
      ctx.fillText(fmtT(s.t0), s.x0, this.h - 5);
      lastX = s.x0;
    }
    const last = segs[segs.length - 1];
    if (last.x0 + last.w - lastX > 150) {
      ctx.textAlign = 'right';
      ctx.fillText(fmtT(last.t1), last.x0 + last.w, this.h - 5);
    }
  }

  /** Großansicht: Zeitachse mit Schrittweite nach Zoom (Tage, Stunden, 30/15/5 Minuten), Pausen ausgespart */
  private drawTimeTicks(ctx: CanvasRenderingContext2D) {
    const lay = this.layout!;
    const { l, r } = this.pad;
    const W = this.width;
    const msPerPx = this.dataMs / Math.max(1, this.dataW * (this.view?.zoom ?? 1));
    const step = tickStep(msPerPx);
    const t0 = lay.timeAt(l);
    const t1 = lay.timeAt(W - r);
    if (t0 == null || t1 == null) return;
    ctx.fillStyle = cssVar(this, '--chart-label');
    ctx.strokeStyle = cssVar(this, '--chart-axis');
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    let prev: number | null = null;
    let right = -Infinity;
    for (const t of ticks(t0, t1, step)) {
      const x = lay.xAt(t);
      if (x == null || x < l || x > W - r) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, this.h - PAD.b);
      ctx.lineTo(Math.round(x) + 0.5, this.h - PAD.b + 3);
      ctx.stroke();
      const text = tickLabel(t, step, prev);
      const half = ctx.measureText(text).width / 2;
      // nicht über den Rand und nicht über die vorige Beschriftung
      if (x - half < 2 || x + half > W - 2 || x - half < right + 8) continue;
      ctx.fillText(text, x, this.h - 5);
      right = x + half;
      prev = t;
    }
  }

  /** x-Position einer Zeit; null außerhalb der Reihe (mehr als 30 min vom nächsten Punkt). */
  private markX(t: number): number | null {
    if (!this.layout || !this.points.length) return null;
    const i = nearestByTime(this.points, t);
    if (Math.abs(this.points[i].time - t) > 30 * 60_000) return null;
    return this.layout.x(i);
  }

  /** Tick nahe der Pixelposition (Klick öffnet das Foto). */
  private markAt(px: number): ChartMark | null {
    let best: ChartMark | null = null;
    let bd = 8;
    for (const m of this.marks) {
      const mx = this.markX(m.time);
      if (mx === null) continue;
      const d = Math.abs(mx - px);
      if (d <= bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  private hoverIndex(): number {
    if (this.hoverTime == null || !this.points.length) return -1;
    const i = nearestByTime(this.points, this.hoverTime);
    // Außerhalb der Reihe (z. B. Hover auf anderen Track ohne Zeit) nicht anzeigen
    return Math.abs(this.points[i].time - this.hoverTime) > 30 * 60_000 ? -1 : i;
  }

  private drawOverlay() {
    const ctx = this.canvas('canvas.overlay');
    if (!ctx || !this.layout) return;
    ctx.save();
    this.clipData(ctx);
    const active = this.activeMark ? this.marks.find((m) => m.id === this.activeMark) : undefined;
    const ax = active ? this.markX(active.time) : null;
    if (ax !== null) {
      ctx.strokeStyle = cssVar(this, '--c-photo');
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ax, this.h - PAD.b - 12);
      ctx.lineTo(ax, this.h - PAD.b + 2);
      ctx.stroke();
    }
    const i = this.hoverIndex();
    if (i >= 0) {
      const px = this.layout.x(i);
      ctx.strokeStyle = cssVar(this, '--text-2');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, PAD.t - 4);
      ctx.lineTo(px + 0.5, this.h - PAD.b);
      ctx.stroke();
      for (const s of this.series) {
        const v = s.value(this.points[i]);
        if (v == null) continue;
        ctx.beginPath();
        ctx.arc(px, this.y(v, s.axis), 4, 0, Math.PI * 2);
        ctx.fillStyle = cssVar(this, '--surface');
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = cssVar(this, s.colorVar);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Textalternative: Bezeichnung plus Maxima je Reihe. */
  private summary(): string {
    const parts = this.series.map((s) => {
      let max = -Infinity;
      for (const p of this.points) {
        const v = s.value(p);
        if (v != null && v > max) max = v;
      }
      return isFinite(max) ? `${s.label} max. ${fmtNum(max, s.decimals)} ${s.unit}` : '';
    });
    const photos = this.marks.length ? `${this.marks.length} ${this.marks.length === 1 ? 'Foto' : 'Fotos'} markiert` : '';
    return [this.label, ...parts, this.refLine?.label ?? '', photos].filter(Boolean).join(', ');
  }

  /** Fadenkreuz: Zeit unter dem Zeiger melden (`sx-hover-time`) */
  private onPointer(e: PointerEvent) {
    if (!this.layout) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = this.layout.timeAt(e.clientX - rect.left);
    emit(this, 'sx-hover-time', t);
  }

  private onClick(e: MouseEvent) {
    // nach Ziehen kein Klick (Foto-Tick)
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // nur nahe am unteren Rand, wo die Ticks liegen
    if (e.clientY - rect.top < this.h - PAD.b - 24) return;
    const m = this.markAt(e.clientX - rect.left);
    if (m) emit(this, 'sx-photo-open', { id: m.id });
  }

  private bigChart(): SxTimeChart | null {
    return this.renderRoot.querySelector('sx-time-chart[large]');
  }

  render() {
    const i = this.hoverIndex();
    const p = i >= 0 ? this.points[i] : null;
    const canvases = html`<div class="stage" role="img" aria-label=${this.summary()}>
      <canvas class="base"></canvas>
      <canvas
        class="overlay"
        @pointermove=${this.onMove}
        @pointerdown=${this.onDown}
        @pointerup=${this.onUp}
        @pointercancel=${(e: PointerEvent) => this.onUp(e, true)}
        @click=${this.onClick}
        @pointerleave=${(e: PointerEvent) => e.pointerType === 'mouse' && !this.ptrs.size && emit(this, 'sx-hover-time', null)}
      ></canvas>
    </div>`;
    return html`
      ${this.large
        ? html`<div
            class="scroll"
            data-scroll-x
            tabindex="0"
            role="group"
            aria-label="${this.label || 'Diagramm'}: ${ZOOM_HINT}"
            @scroll=${this.onScroll}
            @wheel=${this.onWheel}
            @keydown=${this.onKey}
          ><div class="wrap">${canvases}</div></div>`
        : html`<div class="scroll"><div class="wrap">${canvases}</div></div>`}
      <div class="legend">
        ${this.series.map((s) => {
          const v = p ? s.value(p) : null;
          return html`<span><i style="background:var(${s.colorVar})"></i>${s.label}${v != null ? html` <b>${fmtNum(v, s.decimals)} ${s.unit}</b>` : ''}</span>`;
        })}
        ${p ? html`<span class="time">${fmtShort(p.time)}</span>` : ''}
        ${this.large
          ? ''
          : html`<button class="btn ghost small zoom" type="button" title="Großansicht" aria-label="${this.label || 'Diagramm'} vergrößern" @click=${() => (this.zoomed = true)}>${icon('expand')}</button>`}
      </div>
      ${this.large
        ? ''
        : html`<dialog aria-label=${this.label || 'Diagramm'} @close=${() => (this.zoomed = false)}>
            <header>
              <h2>${this.label || 'Verlauf'}${p ? html`<span class="when">${fmtDateTime(p.time)}</span>` : ''}</h2>
              ${this.bigZoomed
                ? html`<button class="btn ghost small reset" type="button" @click=${() => this.bigChart()?.resetView()}>Ganzer Zeitraum</button>`
                : ''}
              <button class="btn ghost icon" aria-label="Schließen" @click=${() => (this.zoomed = false)}>${icon('x')}</button>
            </header>
            <div class="body" @sx-chart-zoom=${(e: CustomEvent<boolean>) => (this.bigZoomed = e.detail)}>${this.zoomed
              ? html`<sx-time-chart large .points=${this.points} .series=${this.series} .left=${this.left} .right=${this.right} .refLine=${this.refLine}
                  .hoverTime=${this.hoverTime} .marks=${this.marks} .activeMark=${this.activeMark} label=${this.label}></sx-time-chart>`
              : ''}</div>
          </dialog>`}
    `;
  }
}
customElements.define('sx-time-chart', SxTimeChart);
