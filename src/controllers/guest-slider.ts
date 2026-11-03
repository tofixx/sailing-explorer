// Gäste-Slider der Startseite (F-431, Konzept 22): zeigt ihn nur Gästen mit Backend, lädt einmal die Saison-Zahlen und
// öffentliche Vereine und Häfen (in der Nähe, falls ein Ort gemerkt ist), merkt „Ausblenden“ auf dem Gerät und
// scrollt auf Wunsch zum Stream. „GPX ausprobieren“ und „Kostenlos anmelden“ laufen über die vorhandenen Events
// `sx-compose-open` und `sx-login`. app.ts erzeugt den Controller nur und reicht den mit der Community-Leiste geteilten
// Entdecken-Abruf herein (F-530).
import { api, type DiscoverData } from '../services/api';
import type { Store } from '../services/store';
import { nearCenter, readNearPrefs } from '../services/near-prefs';
import type { SxGuestSlider } from '../components/sx-guest-slider';
import type { Sample } from '../components/sx-empty-state';

export const GUEST_SLIDER_KEY = 'sx-guest-slider-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(GUEST_SLIDER_KEY) === '1';
  } catch {
    return false;
  }
}

export class GuestSliderController {
  private loaded = false;
  private dismissed = readDismissed();

  constructor(
    private store: Store,
    private ui: {
      slider: SxGuestSlider;
      /** Stream der Startseite (Ziel von „Community ansehen“; sichtbar = Startseite mit Community) */
      feed: HTMLElement;
      /** Beispiel-Törns (Folie 1, „Beispiel ansehen“) */
      samples: Sample[];
      /** Anmeldestatus bekannt – sonst blitzt der Slider bei Angemeldeten kurz auf */
      ready: () => Promise<void>;
      /** Entdecken-Auszug ohne Ort – derselbe Abruf wie die Community-Leiste (F-530) */
      discover: () => Promise<DiscoverData>;
    },
  ) {
    store.subscribe((s, prev) => {
      if (s.user !== prev?.user || s.backend !== prev?.backend) void this.sync();
    });
    // Daten erst, wenn der Stream der Startseite steht – auf anderen Seiten (z. B. /entdecken) nichts laden
    new MutationObserver(() => void this.sync()).observe(ui.feed, { attributes: true, attributeFilter: ['hidden'] });
    ui.slider.samples = ui.samples;
    ui.slider.addEventListener('sx-guest-dismiss', () => this.dismiss());
    ui.slider.addEventListener('sx-guest-stream', () => this.toStream());
  }

  private async sync(): Promise<void> {
    await this.ui.ready();
    const s = this.store.get();
    const show = !!s.backend && !s.user && !this.dismissed;
    this.ui.slider.hidden = !show;
    if (show && !this.loaded && !this.ui.feed.hidden) {
      this.loaded = true;
      await this.load();
    }
  }

  private async load(): Promise<void> {
    const near = nearCenter(null);
    const [stats, discover] = await Promise.all([
      api.discoverStats().catch(() => null),
      (near ? api.discover(6, '', { center: near.center, r: readNearPrefs().radius }) : this.ui.discover()).catch(() => null),
    ]);
    Object.assign(this.ui.slider, { stats, groups: discover?.groups ?? [], harbors: discover?.harbors ?? [] });
  }

  /** × – auf diesem Gerät nicht mehr zeigen; der Stream bleibt. */
  private dismiss(): void {
    this.dismissed = true;
    this.ui.slider.hidden = true;
    try {
      localStorage.setItem(GUEST_SLIDER_KEY, '1');
    } catch {
      // ohne Speicher bleibt er für diese Sitzung ausgeblendet
    }
  }

  private toStream(): void {
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.ui.feed.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }
}
