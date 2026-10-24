// Sichtbarkeit von Törns, Booten und Profilen: reine Regeln (ohne DOM, ohne Netz) – genutzt von Worker und Oberfläche.
// Konzept: docs/CONCEPT.md, Entscheidungen E1–E5 und Abschnitt 1.

export type Visibility = 'public' | 'unlisted' | 'private';

export const VISIBILITIES: readonly Visibility[] = ['public', 'unlisted', 'private'];

/** Neue Objekte sind öffentlich (E1). */
export const DEFAULT_VISIBILITY: Visibility = 'public';

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: 'Öffentlich',
  unlisted: 'Nur mit Link',
  private: 'Nur ich',
};

export const VISIBILITY_HINT: Record<Visibility, string> = {
  public: 'Für alle sichtbar, auf Profil, Boot und unter Entdecken gelistet und von Suchmaschinen auffindbar.',
  unlisted: 'Nur wer den geheimen Link hat, sieht es. Nirgends gelistet, Link jederzeit erneuerbar.',
  private: 'Nur du siehst es.',
};

/** Ordnung für „nie sichtbarer als das Elternobjekt“: private < unlisted < public. */
const RANK: Record<Visibility, number> = { private: 0, unlisted: 1, public: 2 };

export const isVisibility = (v: unknown): v is Visibility => typeof v === 'string' && (VISIBILITIES as readonly string[]).includes(v);

/** Die weniger sichtbare von zwei Stufen (Kind erbt höchstens die Sichtbarkeit seines Elternobjekts). */
export const minVisibility = (a: Visibility, b: Visibility): Visibility => (RANK[a] <= RANK[b] ? a : b);

/**
 * Darf das Konto diese Stufe setzen? Kostenlos nur „Öffentlich“, nicht öffentliche Stufen nur mit laufendem
 * Unterstützer-Status (E1). Eine bereits gesetzte Stufe darf bleiben (E4: Ende der Unterstützung macht nichts öffentlich).
 */
export function canChooseVisibility(next: Visibility, supporter: boolean, current?: Visibility): boolean {
  return next === 'public' || supporter || next === current;
}

/** Pfad zum Teilen: öffentlich ohne Schlüssel, „Nur mit Link“ mit Schlüssel (Altbestand ohne Schlüssel: ohne). */
export function sharePath(kind: 's' | 'b' | 'u', idOrHandle: string, visibility: Visibility, key: string | null): string {
  return visibility === 'unlisted' && key ? `/${kind}/${idOrHandle}/${key}` : `/${kind}/${idOrHandle}`;
}

/** Länge neuer Teilen-Schlüssel: 22 Zeichen aus 56 Symbolen ≈ 128 Bit (Konzept 2.4). */
export const SHARE_KEY_LENGTH = 22;

/** Form eines Teilen-Schlüssels in Pfaden, Headern (`X-Share-Key`) und `?k=` – nur Buchstaben und Ziffern. */
export const SHARE_KEY_RE = /^[A-Za-z0-9]{16,64}$/;

export const isShareKey = (v: unknown): v is string => typeof v === 'string' && SHARE_KEY_RE.test(v);
