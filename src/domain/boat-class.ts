// Bootsklassen (Konzept 34, F-535 … F-539): kurze, kuratierte Liste gängiger Binnen- und Küstenklassen, die Zuordnung
// des freien Bootstyps (`boats.boat_type`) zu einer Klasse und der Filter auf /entdecken. Reine Regeln ohne DOM und
// Netz – genutzt von Worker, Oberfläche und (als erzeugtes SQL) von der Migration 0042.

/** Gruppen der Auswahl (optgroup) und zugleich Sammel-Filter („alle Jollen“). */
export const BOAT_CLASS_GROUPS = [
  ['jollen', 'Jollen'],
  ['kielboote', 'Kielboote'],
  ['yachten', 'Yachten und Mehrrumpf'],
] as const;
export type BoatClassGroup = (typeof BOAT_CLASS_GROUPS)[number][0];

/** Die Klassen in Anzeigereihenfolge; `group` leer = steht für sich („Sonstige“). */
export const BOAT_CLASSES = [
  { id: 'optimist', label: 'Optimist', group: 'jollen' },
  { id: 'ilca', label: 'ILCA / Laser', group: 'jollen' },
  { id: '420', label: '420er', group: 'jollen' },
  { id: '470', label: '470er', group: 'jollen' },
  { id: 'pirat', label: 'Pirat', group: 'jollen' },
  { id: 'korsar', label: 'Korsar', group: 'jollen' },
  { id: 'conger', label: 'Conger', group: 'jollen' },
  { id: 'jollenkreuzer', label: 'Jollenkreuzer', group: 'jollen' },
  { id: 'folkeboot', label: 'Folkeboot', group: 'kielboote' },
  { id: 'h-boot', label: 'H-Boot', group: 'kielboote' },
  { id: 'j24', label: 'J/24', group: 'kielboote' },
  { id: 'drachen', label: 'Drachen', group: 'kielboote' },
  { id: 'fahrtenyacht', label: 'Fahrtenyacht / Kielboot', group: 'yachten' },
  { id: 'katamaran', label: 'Katamaran', group: 'yachten' },
  { id: 'sonstige', label: 'Sonstige', group: '' },
] as const satisfies readonly { id: string; label: string; group: BoatClassGroup | '' }[];
export type BoatClass = (typeof BOAT_CLASSES)[number]['id'];

const CLASS_IDS: readonly string[] = BOAT_CLASSES.map((c) => c.id);
export const isBoatClass = (v: unknown): v is BoatClass => typeof v === 'string' && CLASS_IDS.includes(v);

/** Anzeigename einer Klasse; leer bzw. unbekannt: ''. */
export const boatClassLabel = (id: string | null | undefined): string => BOAT_CLASSES.find((c) => c.id === id)?.label ?? '';

/**
 * Zuordnung des freien Typs: Muster werden in dieser Reihenfolge geprüft, der erste Treffer gewinnt. Klassennamen
 * zuerst, dann Werften/Wörter der Fahrtenyachten, zuletzt die bloßen Zahlen 420/470 (sonst würde „Hanse 470“ zum
 * 470er). Muster sind ASCII-Kleinbuchstaben; ein Leerzeichen am Rand steht für eine Wortgrenze (der Text wird mit
 * Leerzeichen umrahmt, Trennzeichen werden zu Leerzeichen, siehe `foldBoatType`).
 */
export const BOAT_CLASS_RULES: readonly (readonly [BoatClass, readonly string[]])[] = [
  ['optimist', ['optimist', ' opti ']],
  ['ilca', [' ilca', ' laser ']],
  ['pirat', [' pirat ', 'piratenjolle']],
  ['korsar', ['korsar']],
  ['conger', ['conger']],
  ['jollenkreuzer', ['jollenkreuzer', ' jk ']],
  ['folkeboot', ['folkeboot', 'folkboot', 'folkboat', ' folke ']],
  ['h-boot', [' h boot ']],
  ['j24', [' j 24 ', ' j24 ']],
  ['drachen', [' drachen ', ' dragon ']],
  ['katamaran', ['katamaran', 'catamaran', 'trimaran', ' kat ', ' hobie', ' nacra', ' tornado ', ' lagoon ']],
  [
    'fahrtenyacht',
    ['yacht', 'kielboot', ' bavaria', ' hanse ', ' dehler', ' jeanneau', ' beneteau', ' hallberg', ' dufour', ' elan ', ' etap ', ' sunbeam', ' najad', ' oceanis', ' sun odyssey', ' varianta', ' moody ', ' contest '],
  ],
  ['420', [' 420 ', ' 420er ']],
  ['470', [' 470 ', ' 470er ']],
];

/** Zeichen, die wie ein Leerzeichen trennen („H-Boot“, „J/24“, „Laser (Radial)“). */
export const BOAT_TYPE_SEPARATORS = "-/.,()_+'";

/**
 * Vergleichsform des Typs: nur A–Z klein (wie SQLite `lower()`, damit SQL und JS gleich zuordnen), Trennzeichen zu
 * Leerzeichen, mit Leerzeichen umrahmt.
 */
export function foldBoatType(text: string): string {
  let s = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
  for (const ch of BOAT_TYPE_SEPARATORS) s = s.split(ch).join(' ');
  return ` ${s} `;
}

/** Klasse zum freien Typ – ohne Treffer '' (nicht zugeordnet; „Sonstige“ wählt nur der Eigner selbst). */
export function classifyBoatType(text: string): BoatClass | '' {
  const s = foldBoatType(text);
  for (const [id, patterns] of BOAT_CLASS_RULES) if (patterns.some((p) => s.includes(p))) return id;
  return '';
}

/**
 * Klasse beim Speichern (F-536): eine gewählte gültige Klasse gilt, sonst die aus dem Typ abgeleitete. Unbekannte
 * Werte zählen wie „keine Wahl“ – fail closed heißt hier: nie eine Klasse speichern, die es nicht gibt.
 */
export const resolveBoatClass = (chosen: unknown, boatType: string): BoatClass | '' => (isBoatClass(chosen) ? chosen : classifyBoatType(boatType));

/** SQL-Zeichenkette (einfache Anführungszeichen verdoppelt). */
const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** `foldBoatType` als SQL-Ausdruck über die Spalte `col`. */
export function boatTypeFoldSql(col: string): string {
  let folded = `lower(${col})`;
  for (const ch of BOAT_TYPE_SEPARATORS) folded = `replace(${folded}, ${sqlStr(ch)}, ' ')`;
  return `' ' || ${folded} || ' '`;
}

/**
 * `classifyBoatType` als SQL-Ausdruck über die schon gefaltete Spalte `x` (`boatTypeFoldSql`) – für die Rückbefüllung
 * in Migration 0042 (daraus erzeugt; ein Test mit Altbestand hält Migration und Regeln gleich). `instr` statt `LIKE`,
 * damit `_` und `%` keine Platzhalter sind.
 */
export function boatClassSql(x: string): string {
  const whens = BOAT_CLASS_RULES.map(([id, ps]) => `WHEN ${ps.map((p) => `instr(${x}, ${sqlStr(p)}) > 0`).join(' OR ')} THEN ${sqlStr(id)}`);
  return `CASE\n    ${whens.join('\n    ')}\n    ELSE '' END`;
}

/** Filter auf /entdecken (F-537): eine Klasse oder eine Gruppe („alle Jollen“). */
export type BoatClassFilter = BoatClass | BoatClassGroup;
const GROUP_IDS: readonly string[] = BOAT_CLASS_GROUPS.map(([id]) => id);
export const isBoatClassFilter = (v: unknown): v is BoatClassFilter => isBoatClass(v) || (typeof v === 'string' && GROUP_IDS.includes(v));

/** Klassen hinter einem Filterwert; unbekannt oder leer: null (kein Filter). */
export function boatClassesOf(filter: string | null | undefined): BoatClass[] | null {
  if (!isBoatClassFilter(filter)) return null;
  if (isBoatClass(filter)) return [filter];
  return BOAT_CLASSES.filter((c) => c.group === filter).map((c) => c.id);
}

/** Anzeigename eines Filterwerts („Alle Jollen“ bzw. Klassenname). */
export function boatClassFilterLabel(filter: string): string {
  const g = BOAT_CLASS_GROUPS.find(([id]) => id === filter);
  return g ? `Alle ${g[1]}` : boatClassLabel(filter);
}
