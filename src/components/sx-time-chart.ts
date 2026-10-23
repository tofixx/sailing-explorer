import { LitElement, css, html, type PropertyValues } from 'lit';
import { layoutSegments, nearestByTime, segmentByGaps, type Layout, type TimedPoint } from '../domain/timeline';
import { cssVar, fmtNum, fmtShort } from '../util/html';
import { base, emit } from './shared';

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

export interface RefLine {
  value: number;
  label: string;
  colorVar: string;
  axis: 'left' | 'right';
}

const H = 156;
const PAD = { t: 18, b: 20 };

/**
 * Generisches Zeitreihen-Diagramm mit Pausen-Segmentierung, zwei Y-Achsen und
 * synchronisiertem Fadenkreuz. Statischer Inhalt und Hover liegen auf getrennten Canvas.
 */
export class SxTimeChart extends LitElement {
  static properties = {
    points: { attribute: false },
    series: { attribute: false },
    left: { attribute: false },
    right: { attribute: false },
    refLine: { attribute: false },
    hoverTime: { attribute: false },
    label: { type: String },
  };
  declare points: TimedPoint[];
  declare series: ChartSeries[];
  declare left: ChartAxis;
  declare right: ChartAxis | null;
  declare refLine: RefLine | null;
  declare hoverTime: number | null;
  declare label: string;

  private width = 320;
  private layout: Layout | null = null;
  private scales: Record<'left' | 'right', number> = { left: 1, right: 1 };
  private ro?: ResizeObserver;
  private mq = matchMedia('(prefers-color-scheme: dark)');
  private onScheme = () => this.drawBase();

  constructor() {
    super();
    this.points = [];
    this.series = [];
    this.left = { unit: '', colorVar: '--text-2', minMax: 1, step: 1 };
    this.right = null;
    this.refLine = null;
    this.hoverTime = null;
    this.label = '';
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      .wrap {
        position: relative;
        height: ${H}px;
        touch-action: pan-y;
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
  }

  firstUpdated() {
    const wrap = this.renderRoot.querySelector('.wrap') as HTMLElement;
    this.ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w && w !== this.width) {
        this.width = w;
        this.drawBase();
        this.drawOverlay();
      }
    });
    this.ro.observe(wrap);
  }

  updated(changed: PropertyValues<this>) {
    if (changed.has('points') || changed.has('series') || changed.has('refLine') || changed.has('left') || changed.has('right')) this.drawBase();
    this.drawOverlay();
  }

  private canvas(sel: string) {
    const cv = this.renderRoot.querySelector(sel) as HTMLCanvasElement | null;
    if (!cv) return null;
    const dpr = window.devicePixelRatio || 1;
    cv.width = this.width * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, H);
    return ctx;
  }

  private get pad() {
    return { l: 34, r: this.right ? 36 : 12 };
  }

  private y(v: number, axis: 'left' | 'right') {
    return H - PAD.b - (H - PAD.t - PAD.b) * (v / this.scales[axis]);
  }

  private drawBase() {
    const ctx = this.canvas('canvas.base');
    if (!ctx || this.points.length < 2) return;
    const pts = this.points;
    const c = (v: string) => cssVar(this, v);
    const { l, r } = this.pad;
    const W = this.width;

    this.layout = layoutSegments(pts, segmentByGaps(pts), l, W - r);
    const niceCeil = (v: number, step: number) => Math.max(step, Math.ceil(v / step) * step);
    for (const axis of ['left', 'right'] as const) {
      const def = axis === 'left' ? this.left : this.right;
      if (!def) continue;
      let max = def.minMax;
      for (const s of this.series) {
        if (s.axis !== axis) continue;
        for (const p of pts) {
          const v = s.value(p);
          if (v != null && v > max) max = v;
        }
      }
      this.scales[axis] = niceCeil(max, def.step);
    }

    // Gitter mit Beschriftung: 0, 50 %, 100 %
    ctx.font = `${c('--fs-xs')} ${c('--font')}`;
    for (const f of [1, 0.5, 0]) {
      const y = H - PAD.b - (H - PAD.t - PAD.b) * f;
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

    // Pausen-Trenner
    const segs = this.layout.segs;
    ctx.strokeStyle = c('--chart-axis');
    ctx.setLineDash([2, 3]);
    for (let i = 0; i < segs.length - 1; i++) {
      const xm = (segs[i].x0 + segs[i].w + segs[i + 1].x0) / 2;
      ctx.beginPath();
      ctx.moveTo(xm, PAD.t);
      ctx.lineTo(xm, H - PAD.b);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Zeitachse: Beginn jedes Segments + Ende
    const fmtT = (t: number) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    ctx.fillStyle = c('--chart-label');
    let lastX = -1e9;
    ctx.textAlign = 'left';
    for (const s of segs) {
      if (s.x0 - lastX < 80) continue;
      ctx.fillText(fmtT(s.t0), s.x0, H - 5);
      lastX = s.x0;
    }
    const last = segs[segs.length - 1];
    if (last.x0 + last.w - lastX > 150) {
      ctx.textAlign = 'right';
      ctx.fillText(fmtT(last.t1), last.x0 + last.w, H - 5);
    }

    // Reihen
    const x = this.layout.x;
    for (const s of this.series) {
      const color = c(s.colorVar);
      for (const seg of segs) {
        if (s.fill) {
          ctx.beginPath();
          let started = false;
          let lx = 0;
          for (let i = seg.a; i <= seg.b; i++) {
            const v = s.value(pts[i]);
            if (v == null) continue;
            const px = x(i);
            if (!started) {
              ctx.moveTo(px, H - PAD.b);
              started = true;
            }
            ctx.lineTo(px, this.y(v, s.axis));
            lx = px;
          }
          if (started) {
            ctx.lineTo(lx, H - PAD.b);
            ctx.closePath();
            ctx.globalAlpha = 0.14;
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
        ctx.beginPath();
        let on = false;
        for (let i = seg.a; i <= seg.b; i++) {
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

  private hoverIndex(): number {
    if (this.hoverTime == null || !this.points.length) return -1;
    const i = nearestByTime(this.points, this.hoverTime);
    // Außerhalb der Reihe (z. B. Hover auf anderen Track ohne Zeit) nicht anzeigen
    return Math.abs(this.points[i].time - this.hoverTime) > 30 * 60_000 ? -1 : i;
  }

  private drawOverlay() {
    const ctx = this.canvas('canvas.overlay');
    if (!ctx || !this.layout) return;
    const i = this.hoverIndex();
    if (i < 0) return;
    const px = this.layout.x(i);
    ctx.strokeStyle = cssVar(this, '--text-2');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, PAD.t - 4);
    ctx.lineTo(px + 0.5, H - PAD.b);
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
    return [this.label, ...parts, this.refLine?.label ?? ''].filter(Boolean).join(', ');
  }

  private onPointer(e: PointerEvent) {
    if (!this.layout) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = this.layout.timeAt(e.clientX - rect.left);
    emit(this, 'sx-hover-time', t);
  }

  render() {
    const i = this.hoverIndex();
    const p = i >= 0 ? this.points[i] : null;
    return html`
      <div class="wrap" role="img" aria-label=${this.summary()}>
        <canvas class="base"></canvas>
        <canvas
          class="overlay"
          @pointermove=${this.onPointer}
          @pointerdown=${this.onPointer}
          @pointerleave=${(e: PointerEvent) => e.pointerType === 'mouse' && emit(this, 'sx-hover-time', null)}
        ></canvas>
      </div>
      <div class="legend">
        ${this.series.map((s) => {
          const v = p ? s.value(p) : null;
          return html`<span><i style="background:var(${s.colorVar})"></i>${s.label}${v != null ? html` <b>${fmtNum(v, s.decimals)} ${s.unit}</b>` : ''}</span>`;
        })}
        ${p ? html`<span class="time">${fmtShort(p.time)}</span>` : ''}
      </div>
    `;
  }
}
customElements.define('sx-time-chart', SxTimeChart);
