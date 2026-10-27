// Passkeys im Browser (Konzept 14.7): Unterstützung erkennen, Bibliothek und Optionen vorab laden.
// Safari verlangt, dass der WebAuthn-Aufruf unmittelbar aus dem Klick kommt – ein Import oder Netzaufruf dazwischen
// kann die Nutzergeste kosten. Deshalb werden beide schon beim Öffnen des Dialogs geholt.

type Lib = typeof import('@simplewebauthn/browser');
let lib: Promise<Lib> | null = null;

/** Die Browser-Bibliothek (eigenes Chunk, erst bei Bedarf geladen). */
export const passkeyLib = (): Promise<Lib> => (lib ??= import('@simplewebauthn/browser'));

/** Passkeys möglich? Nicht in Einbettungen (iframe ohne publickey-credentials-Freigabe scheitert still). */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && window.top === window;
}

/** Der Nutzer hat den Passkey-Dialog abgebrochen (bzw. der Browser hat ihn abgelehnt) – kein Fehler zum Anzeigen. */
export const isPasskeyCancel = (e: unknown): boolean => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');

/** Fehler: auf diesem Gerät gibt es schon einen Passkey für das Konto. */
export class PasskeyExistsError extends Error {
  constructor() {
    super('Auf diesem Gerät gibt es schon einen Passkey für dein Konto.');
  }
}

/** Auf diesem Gerät gibt es schon einen Passkey für das Konto (excludeCredentials). */
export const isPasskeyDuplicate = (e: unknown): boolean =>
  e instanceof Error && (e.name === 'InvalidStateError' || (e as { code?: string }).code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED');

/**
 * Vorab geholte Optionen samt Challenge (gültig 5 min, genutzt höchstens 4 min). `take()` gibt sie einmal heraus –
 * eine Challenge gilt nur einmal – und lädt bei Bedarf neu.
 */
export class PreparedOptions<T> {
  private pending: { p: Promise<T>; at: number } | null = null;

  constructor(private readonly load: () => Promise<T>) {}

  prefetch(): void {
    if (this.pending && Date.now() - this.pending.at < 240_000) return;
    const p = this.load();
    p.catch(() => {
      if (this.pending?.p === p) this.pending = null;
    });
    this.pending = { p, at: Date.now() };
  }

  /** Vorgeladenes verwerfen (Konto gewechselt: Optionen und Challenge gehören zum alten Konto). */
  reset(): void {
    this.pending = null;
  }

  /** Vorladen und warten: true, sobald die Optionen da sind; false, wenn das Laden scheitert (z. B. gesperrt, Höchstzahl). */
  ready(): Promise<boolean> {
    this.prefetch();
    return this.pending!.p.then(
      () => true,
      () => false,
    );
  }

  take(): Promise<T> {
    this.prefetch();
    const p = this.pending!.p;
    this.pending = null;
    return p;
  }
}
