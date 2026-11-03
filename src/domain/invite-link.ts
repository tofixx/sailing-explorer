// Einladungslinks erkennen (F-591) – an einer Stelle für Kopieren, Teilen und das Mail-Programm. Rein, ohne DOM.

/** Einladungslink dieser Origin (`<origin>/einladung#token=…`)? Fremde Adressen werden nie kopiert oder geteilt. */
export function isInviteLink(url: string, origin: string): boolean {
  return url.startsWith(`${origin}/einladung#token=`);
}
