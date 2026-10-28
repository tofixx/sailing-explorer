// Verifizierte Vertretung (Konzept 20): lädt den Stand des eigenen Antrags, stellt und zieht Anträge zurück. Die
// Knöpfe (`sx-claim`) auf Vereins- und Hafenseite melden nur Absichten und reichen sich selbst mit (`el`).
import { claimApi, type ClaimRequest } from '../services/api';
import type { SxClaim } from '../components/sx-claim';
import type { ClaimKind } from '../domain/claims';
import { errorText } from './session';

export class ClaimController {
  constructor(private toast: (msg: string, ms?: number) => void) {}

  async load(d: { kind: ClaimKind; id: string; el: SxClaim }): Promise<void> {
    d.el.state = null;
    try {
      d.el.state = await claimApi.state(d.kind, d.id);
    } catch (e) {
      d.el.error = errorText(e);
    }
  }

  async submit(d: { req: ClaimRequest; el: SxClaim }): Promise<void> {
    await this.run(d.el, async () => {
      d.el.state = await claimApi.create(d.req);
      this.toast('Antrag gestellt – die Moderation prüft ihn und meldet sich.');
    });
  }

  async withdraw(d: { claimId: string; kind: ClaimKind; id: string; el: SxClaim }): Promise<void> {
    await this.run(d.el, async () => {
      await claimApi.withdraw(d.claimId);
      d.el.state = await claimApi.state(d.kind, d.id);
      this.toast('Antrag zurückgezogen.');
    });
  }

  private async run(el: SxClaim, fn: () => Promise<void>): Promise<void> {
    Object.assign(el, { busy: true, error: '' });
    try {
      await fn();
    } catch (e) {
      el.error = errorText(e);
    } finally {
      el.busy = false;
    }
  }
}
