// Textsuche in Listen (Entdecken, Auswahllisten): Vergleichsform ohne Groß-/Kleinschreibung und Akzente.
// Rein, von Worker und Oberfläche genutzt. SQLite kennt weder Unicode-Kleinschreibung noch Akzent-Faltung – deshalb
// faltet `sqlSearchFold` dieselben Zeichen per REPLACE, die `searchKey` im Browser bzw. Worker faltet (F-331).

/** Vergleichsform: klein, ohne Akzente (ö → o), Leerraum zusammengefasst. */
export const filterKey = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Länge des Suchtexts auf /entdecken – kürzere Eingaben suchen nicht. */
export const SEARCH_LIMITS = { min: 2, max: 80 };

/**
 * Zeichen, die auch die Datenbank faltet (Groß- und Kleinbuchstaben, da SQLite `lower()` nur ASCII kennt). Andere
 * Akzente faltet nur `filterKey` – eine Suche danach findet in der Datenbank dann nur die exakte Schreibweise.
 */
const FOLD: ReadonlyArray<readonly [string, string]> = [
  ['ä', 'a'], ['Ä', 'a'], ['ö', 'o'], ['Ö', 'o'], ['ü', 'u'], ['Ü', 'u'], ['ß', 'ss'],
  ['é', 'e'], ['É', 'e'], ['è', 'e'], ['ê', 'e'], ['á', 'a'], ['à', 'a'], ['â', 'a'],
  ['å', 'a'], ['Å', 'a'], ['ø', 'o'], ['Ø', 'o'], ['æ', 'ae'], ['Æ', 'ae'], ['ç', 'c'], ['ñ', 'n'],
];

/** Suchschlüssel für die Datenbank-Suche: wie `filterKey`, dazu ß → ss, ø → o, æ → ae (wie `sqlSearchFold`). */
export function searchKey(s: string): string {
  let out = s.slice(0, SEARCH_LIMITS.max);
  for (const [from, to] of FOLD) out = out.split(from).join(to);
  return filterKey(out);
}

/** SQL-Ausdruck: Spalte in derselben Vergleichsform wie `searchKey` (ohne Leerraum-Zusammenfassung). */
export function sqlSearchFold(col: string): string {
  return FOLD.reduce((expr, [from, to]) => `REPLACE(${expr}, '${from}', '${to}')`, `lower(${col})`);
}

/** LIKE-Muster „enthält“ zu einem Suchschlüssel (mit `ESCAPE '\'`). */
export const searchLike = (key: string): string => `%${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
