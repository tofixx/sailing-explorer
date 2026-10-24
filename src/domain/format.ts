// Zahlen- und Zeitformate – überall gleich (deutsches Komma, feste Nachkommastellen).

export const fmtNum = (v: number, decimals: number) =>
  v.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Stunden als „h:mm“, z. B. 5,3 h → „5:18“. */
export function fmtDuration(hours: number): string {
  const totalMin = Math.round(hours * 60);
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`;
}

export const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export const fmtShort = (t: number) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const fmtDate = (t: number) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Speicher in MB (binär), ganzzahlig ab 10 MB, sonst mit einer Nachkommastelle. */
export const fmtMB = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('de-DE', { maximumFractionDigits: mb >= 10 || mb === 0 ? 0 : 1 })} MB`;
};

export const plural =(n: number, one: string, many: string) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
