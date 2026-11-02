// Anpinnen (Konzept 21.13, B1, F-403): Pins des offenen Verlaufs (Gruppe, Hafen, Boot) laden – getrennt vom gecachten
// Stream, nie aus einem Cache – und anpinnen bzw. lösen (auch im eigenen Profil aus „Mein Verlauf“). Die Seiten zeigen
// sie über dem Stream; der persönliche Stream kennt keine Pins. Die Komponenten melden nur Absichten.
import { postApi, type StreamItem } from '../services/api';
import type { ChannelKind } from '../domain/posts';
import { errorText } from './session';

export type PinChannel = { kind: Exclude<ChannelKind, 'user'>; id: string };

export class PinsController {
  private channel: PinChannel | null = null;

  constructor(
    private ui: {
      /** Pins und Verwaltungsrecht an die offene Seite geben */
      show: (pins: StreamItem[], manage: boolean) => void;
      toast: (msg: string, ms?: number) => void;
      /** nach einer Änderung im Profil: „Mein Verlauf“ neu laden */
      refreshOwn: () => Promise<void>;
    },
  ) {}

  /** Seite mit Verlauf geöffnet (bzw. verlassen: null) – ihre Pins laden. */
  async open(channel: PinChannel | null): Promise<void> {
    this.channel = channel;
    if (!channel) return this.ui.show([], false);
    try {
      const r = await postApi.pins(`${channel.kind}:${channel.id}`);
      if (this.channel === channel) this.ui.show(r.items, r.canManage);
    } catch {
      if (this.channel === channel) this.ui.show([], false);
    }
  }

  /** Anpinnen bzw. lösen – im Verlauf der offenen Seite oder (`own`) im eigenen Profil. */
  async toggle(postId: string, pinned: boolean, own = false): Promise<void> {
    const channel = own ? { kind: 'user' as const, id: '' } : this.channel;
    if (!channel) return;
    try {
      await postApi.pin(postId, channel, pinned);
      this.ui.toast(pinned ? 'Angepinnt' : 'Gelöst');
      if (own) await this.ui.refreshOwn();
      else await this.open(this.channel);
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    }
  }
}
