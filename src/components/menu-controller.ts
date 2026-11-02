import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** Ein Aufklapp-Menü (Kopfzeile, Seiten-Zahnrad): `open` als Property, `.toggle` und `.item` im Shadow DOM. */
type MenuHost = ReactiveControllerHost & HTMLElement & { open: boolean; shadowRoot: ShadowRoot | null; renderRoot: HTMLElement | DocumentFragment };

/**
 * Gemeinsames Verhalten der Aufklapp-Menüs (sx-compose, sx-account-menu, sx-page-menu): Klick daneben, Fokus verlässt
 * das Menü und Escape schließen; beim Öffnen springt der Fokus auf den ersten Eintrag, beim Schließen zurück auf den
 * Knopf. Die Komponente hängt `onKey` und `onFocusOut` an ihren äußeren Container.
 */
export class MenuController implements ReactiveController {
  private last: boolean | undefined;

  constructor(private host: MenuHost) {
    host.addController(this);
  }

  hostConnected(): void {
    document.addEventListener('pointerdown', this.onOutside);
  }

  hostDisconnected(): void {
    document.removeEventListener('pointerdown', this.onOutside);
  }

  hostUpdated(): void {
    const open = this.host.open;
    if (this.last !== undefined && this.last !== open) {
      if (open) this.host.renderRoot.querySelector<HTMLElement>('.item')?.focus();
      else if (this.host.shadowRoot?.activeElement) this.host.renderRoot.querySelector<HTMLElement>('.toggle')?.focus();
    }
    this.last = open;
  }

  private onOutside = (e: PointerEvent) => {
    if (this.host.open && !e.composedPath().includes(this.host)) this.host.open = false;
  };

  readonly onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (this.host.open && next && !this.host.shadowRoot!.contains(next)) this.host.open = false;
  };

  readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.host.open) return;
    e.preventDefault();
    this.host.open = false;
  };
}
