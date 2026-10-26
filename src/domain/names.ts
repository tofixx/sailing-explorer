// Anzeigenamen für Konten ohne selbst gewählten Namen: zufällig wirkend, aber stabil (aus der Konto-ID abgeleitet).
// Rein, ohne DOM und Netz – genutzt von Worker und Oberfläche. E-Mail-Adressen erscheinen nie als Name (Konzept 10.6).

type Gender = 'm' | 'f' | 'n';

const ADJECTIVES = [
  'Fröhlich', 'Mutig', 'Flink', 'Tapfer', 'Gemütlich', 'Wacker', 'Schlau', 'Verwegen', 'Neugierig', 'Munter',
  'Kühn', 'Heiter', 'Listig', 'Stolz', 'Seefest', 'Salzig', 'Sonnig', 'Pfiffig', 'Verträumt', 'Unerschrocken',
];

const NOUNS: Array<[string, Gender]> = [
  ['Möwe', 'f'], ['Seebär', 'm'], ['Kormoran', 'm'], ['Robbe', 'f'], ['Albatros', 'm'], ['Klabautermann', 'm'],
  ['Krabbe', 'f'], ['Qualle', 'f'], ['Delfin', 'm'], ['Seestern', 'm'], ['Leuchtturm', 'm'], ['Papageitaucher', 'm'],
  ['Hering', 'm'], ['Pinguin', 'm'], ['Seepferdchen', 'n'], ['Walross', 'n'], ['Muschel', 'f'], ['Schildkröte', 'f'],
  ['Tümmler', 'm'], ['Seelöwe', 'm'], ['Beiboot', 'n'], ['Fischbrötchen', 'n'],
];

/** Starke Adjektivendung ohne Artikel: Mutiger Seebär, Flinke Möwe, Munteres Seepferdchen. */
const ENDING: Record<Gender, string> = { m: 'er', f: 'e', n: 'es' };

/** FNV-1a (32 Bit) – nur zur gleichmäßigen Auswahl, keine Sicherheitsfunktion. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Spaßname für ein Konto ohne eigenen Namen, z. B. „Verwegener Klabautermann“ – für dieselbe ID immer derselbe. */
export function funnyName(id: string): string {
  const h = hash(id);
  const [noun, gender] = NOUNS[(h >>> 8) % NOUNS.length];
  return `${ADJECTIVES[h % ADJECTIVES.length]}${ENDING[gender]} ${noun}`;
}
