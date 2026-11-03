// Vertrauensregeln der Moderation (Konzept 35.1, 36): „neues Konto“ als abgeleitete Größe statt Stufen-System.
// Rein, vom Worker (Titelbilder, Melde-Gewicht) und in Tests genutzt.

const DAY = 86_400_000;

/** So lange gilt ein Konto ab seiner Anlage als neu (Konzept 35.4 Frage 2). */
export const NEW_ACCOUNT_DAYS = 7;

export interface AccountTrust {
  /** Anlage des Kontos (users.created_at, ms) */
  createdAt: number;
  /** laufender Unterstützer-Status */
  supporter: boolean;
  /** Plattform-Admin (ADMIN_USER_IDS) */
  admin?: boolean;
}

/** Ende der Neu-Phase eines Kontos (ms). */
export const newAccountEnd = (createdAt: number): number => createdAt + NEW_ACCOUNT_DAYS * DAY;

/**
 * F-560: Konto jünger als 7 Tage und kein laufender Unterstützer (Admins nie). Gilt an zwei Stellen: Titelbilder
 * werden zurückgehalten (F-562), Meldungen zählen nicht zur Ausblend-Schwelle (F-565).
 */
export function isNewAccount(a: AccountTrust, now = Date.now()): boolean {
  return !a.admin && !a.supporter && now < newAccountEnd(a.createdAt);
}
