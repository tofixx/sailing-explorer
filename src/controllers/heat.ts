import { api } from '../services/api';
import type { Store } from '../services/store';
import { voyageCells, type HeatData, type HeatPoint } from '../domain/heat';
import type { HeatLayer } from '../map/heat-layer';

export interface HeatUi {
  layer: Pick<HeatLayer, 'set' | 'fitHotspot'>;
  /** Kartenstil-Menü mit dem Schalter „Revier“ */
  picker: { heat: boolean };
}

/** Was die gerade sichtbare Ansicht braucht: Pins (Community-Hintergrund), einmal einpassen (Startseite ohne Tracks). */
export interface HeatView {
  pins: boolean;
  fit: boolean;
}

/**
 * Revier-Wärmekarte (Konzept 37, F-584 … F-586): lädt `GET /api/discover/heat` einmal je Seitenleben – erst, wenn die
 * Ebene an ist und ein Backend da ist –, schaltet die Ebene (Schalter im Kartenstil-Menü, Standard an, gilt bis zum
 * Neuladen) und sagt ihr je Ansicht, ob Pins gezeigt werden und ob die Startseite einmal eingepasst wird.
 */
export class HeatController {
  private on = true;
  private request: Promise<HeatData | null> | null = null;
  private view: HeatView = { pins: false, fit: false };
  private fitted = false;

  constructor(
    private store: Store,
    private ui: HeatUi,
  ) {
    this.ui.picker.heat = this.on;
    this.store.subscribe((s, prev) => {
      if (s.backend !== prev.backend) void this.sync();
    });
  }

  setView(view: HeatView): void {
    if (view.pins === this.view.pins && view.fit === this.view.fit) return;
    this.view = view;
    void this.sync();
  }

  toggle(on: boolean): void {
    this.on = on;
    this.ui.picker.heat = on;
    void this.sync();
  }

  /** Einmal je Seitenleben; nach einem Fehler beim nächsten Mal erneut. */
  private load(): Promise<HeatData | null> {
    this.request ??= api.discoverHeat().catch(() => {
      this.request = null;
      return null;
    });
    return this.request;
  }

  private async sync(): Promise<void> {
    if (!this.on || !this.store.get().backend) return this.ui.layer.set(null, false);
    const data = await this.load();
    if (!this.on) return; // inzwischen ausgeschaltet
    this.ui.layer.set(data, this.view.pins);
    // aufgeschoben (Karte ohne Größe): nur, wenn die Ansicht es dann noch will
    if (data && this.view.fit && !this.fitted) this.fitted = this.ui.layer.fitHotspot(() => this.view.fit);
  }
}

const sent = new Set<string>();

/**
 * Raster des Törns senden (F-581): beim Speichern eines GPX-Törns und – für den Altbestand – beim Öffnen eines eigenen
 * öffentlichen GPX-Törns, je Törn einmal je Sitzung. Fahrtenbuch-Einträge ohne GPX nie. Fehler sind nicht kritisch.
 */
export function sendHeat(id: string, tracks: ReadonlyArray<{ points: ReadonlyArray<HeatPoint>; estimated?: boolean }>): void {
  if (sent.has(id) || !tracks.length || tracks.some((t) => t.estimated)) return;
  const cells = voyageCells(tracks.map((t) => t.points));
  if (!cells.length) return;
  sent.add(id);
  api.putShareHeat(id, cells).catch(() => sent.delete(id));
}
