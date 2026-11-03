// Umfragen (Konzept 29, F-471 … F-474): abstimmen, ändern, zurücknehmen, beenden und „Wer hat was gewählt?“. Die Karte
// (`sx-poll`) meldet nur Absichten mit sich selbst als `el`; hier laufen Anmeldung, Netz und `busy` gegen Doppelklick,
// die Antwort geht als `poll` bzw. `people` an genau diese Karte zurück.
import { postApi } from '../services/api';
import type { PollEventDetail } from '../components/sx-poll';
import { errorText } from './session';

export class PollController {
  constructor(
    private ui: {
      toast: (msg: string, ms?: number) => void;
      requireLogin: (reason: string, then: () => void) => void;
    },
  ) {}

  /** Ablauf mit `busy` an der Karte; Fehler als Hinweis. */
  private async run(d: PollEventDetail, fn: () => Promise<void>): Promise<void> {
    if (d.el.busy) return;
    d.el.busy = true;
    try {
      await fn();
    } catch (e) {
      this.ui.toast(errorText(e), 6000);
    } finally {
      d.el.busy = false;
    }
  }

  vote(d: PollEventDetail): void {
    this.ui.requireLogin('Zum Abstimmen bitte anmelden. Danach geht es direkt weiter.', () =>
      void this.run(d, async () => {
        d.el.poll = (await postApi.vote(d.postId, d.choices ?? [], d.key)).poll;
        d.el.people = null;
      }),
    );
  }

  close(d: PollEventDetail): void {
    void this.run(d, async () => {
      d.el.poll = (await postApi.closePoll(d.postId)).poll;
      this.ui.toast('Umfrage beendet');
    });
  }

  who(d: PollEventDetail): void {
    void this.run(d, async () => {
      const r = await postApi.poll(d.postId, d.key);
      d.el.poll = r.poll;
      d.el.people = r.people;
    });
  }
}
