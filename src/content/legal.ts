// Impressum und Datenschutzerklärung (Konzept 12.7, F-183) – Texte als Daten, gerendert von sx-legal-page.
// VORLAGE, KEINE RECHTSBERATUNG: vor dem Livegang von einer fachkundigen Person prüfen lassen (siehe README).
// Beschrieben ist, was der Code tatsächlich tut (Stand Oktober 2026). Wer Dienste oder Fristen ändert, ändert hier mit.
// Rein, ohne DOM und Netz – funktioniert ohne Backend.

/**
 * Betreiberangaben – genau hier einmal pflegen. Werte in eckigen Klammern sind PLATZHALTER: Solange einer übrig ist,
 * zeigen beide Seiten einen deutlichen Warnhinweis. `phone` ist optional (leer = wird nicht angezeigt).
 */
export const OPERATOR = {
  /** Name der verantwortlichen Person bzw. des Vereins */
  name: 'Tobias Wollowski',
  /** Straße und Hausnummer (ladungsfähige Anschrift, kein Postfach) */
  street: 'Baldurstraße 8A',
  /** Postleitzahl und Ort */
  city: '14482 Potsdam',
  country: 'Deutschland',
  /** Kontakt-E-Mail */
  email: 'tobias@wollow.ski',
  /** optional, z. B. '+49 331 …'; leer lassen, wenn keine Telefonnummer angegeben werden soll */
  phone: '0176 91318836',
  /** Verantwortlich für redaktionelle Inhalte (§ 18 Abs. 2 MStV) – meist dieselbe Person */
  editor: 'Tobias Wollowski',
  /** Kontakt für Meldungen rechtswidriger Inhalte (Art. 11/12/16 DSA) – sollte REPORT_CONTACT im Worker entsprechen */
  reportEmail: 'tobias@wollow.ski',
} as const;

export type Operator = { [K in keyof typeof OPERATOR]: string };

/** Platzhalter erkennt man an eckigen Klammern mit Großbuchstaben, z. B. „[NAME DES BETREIBERS]“. */
export const PLACEHOLDER_RE = /\[[A-ZÄÖÜ][A-ZÄÖÜ0-9 \-/.]*\]/;

/** Felder, die noch Platzhalter enthalten (leer = alles ausgefüllt). */
export function operatorPlaceholders(op: Operator = OPERATOR): Array<keyof Operator> {
  return (Object.keys(op) as Array<keyof Operator>).filter((k) => PLACEHOLDER_RE.test(op[k]));
}

/** Absatz, Liste oder Zwischenüberschrift. Texte sind reiner Text (Lit escaped), Links nur über `href`. */
export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'h3'; text: string }
  | { kind: 'link'; text: string; href: string };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalPage {
  slug: 'impressum' | 'datenschutz';
  title: string;
  /** Stand */
  updated: string;
  sections: LegalSection[];
}

export const LEGAL_UPDATED = 'Oktober 2026';

const p = (text: string): LegalBlock => ({ kind: 'p', text });
const ul = (...items: string[]): LegalBlock => ({ kind: 'ul', items });
const h3 = (text: string): LegalBlock => ({ kind: 'h3', text });

const address = (op: Operator) => [op.name, op.street, op.city, op.country].filter(Boolean);
const contact = (op: Operator) => [`E-Mail: ${op.email}`, ...(op.phone ? [`Telefon: ${op.phone}`] : [])];

/** Impressum (§ 5 DDG, § 18 Abs. 2 MStV, Kontaktstelle nach DSA). */
export function impressum(op: Operator = OPERATOR): LegalPage {
  return {
    slug: 'impressum',
    title: 'Impressum',
    updated: LEGAL_UPDATED,
    sections: [
      { id: 'anbieter', title: 'Angaben gemäß § 5 DDG', blocks: [ul(...address(op))] },
      { id: 'kontakt', title: 'Kontakt', blocks: [ul(...contact(op))] },
      { id: 'redaktion', title: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV', blocks: [p(`${op.editor}, Anschrift wie oben.`)] },
      {
        id: 'melden',
        title: 'Rechtswidrige Inhalte melden (Digital Services Act)',
        blocks: [
          p('Inhalte lassen sich direkt am Inhalt über „Melden“ melden (Anmeldung nötig). Ohne Konto, als Behörde oder für alle anderen Anliegen nach Art. 11, 12 und 16 DSA erreichst du uns hier – auf Deutsch oder Englisch:'),
          ul(`E-Mail: ${op.reportEmail}`),
        ],
      },
      {
        id: 'inhalte',
        title: 'Inhalte der Nutzer:innen',
        blocks: [
          p('Törns, Profile, Boote, Häfen, Vereine, Teams, Beiträge, Kommentare, Reaktionen und Fotos stellen die Nutzer:innen selbst ein. Wir prüfen sie nicht vorab, gehen Meldungen aber unverzüglich nach und entfernen rechtswidrige Inhalte.'),
        ],
      },
      {
        id: 'streit',
        title: 'Verbraucherstreitbeilegung',
        blocks: [p('Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.')],
      },
    ],
  };
}

/** Datenschutzerklärung – beschreibt die tatsächliche Verarbeitung dieser App. */
export function datenschutz(op: Operator = OPERATOR): LegalPage {
  return {
    slug: 'datenschutz',
    title: 'Datenschutzerklärung',
    updated: LEGAL_UPDATED,
    sections: [
      {
        id: 'verantwortlich',
        title: '1. Verantwortlich',
        blocks: [ul(...address(op), ...contact(op)), p('Eine Datenschutzbeauftragte bzw. einen Datenschutzbeauftragten haben wir nicht benannt, weil keine gesetzliche Pflicht besteht.')],
      },
      {
        id: 'ueberblick',
        title: '2. Das Wichtigste in Kürze',
        blocks: [
          ul(
            'GPX-Dateien wertet dein Browser aus. Sie verlassen dein Gerät erst, wenn du einen Törn ausdrücklich teilst bzw. speicherst.',
            'Für Konto, Speichern und Community verarbeiten wir deine E-Mail-Adresse und das, was du selbst einstellst.',
            'Öffentliche Inhalte – auch die Positionen und Zeiten öffentlicher Törns – kann jede:r sehen; sie erscheinen in der Community und können von Suchmaschinen gefunden werden.',
            'Kein Tracking, keine Werbung, keine Analyse-Dienste. Es gibt genau ein Cookie: das Anmelde-Cookie.',
            'Kostenlose Törns werden nach 3 Monaten automatisch gelöscht, dein Konto kannst du jederzeit selbst löschen.',
          ),
        ],
      },
      {
        id: 'hosting',
        title: '3. Hosting, Server-Logs, Schutz vor Missbrauch (Cloudflare)',
        blocks: [
          p('Die App läuft bei Cloudflare (Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA): Cloudflare Workers führt den Server-Code aus, Cloudflare D1 speichert die Datenbank (Konten, Profile, Boote, Häfen, Gruppen, Beiträge, Kommentare, Reaktionen, Metadaten der Törns und Fotos), Cloudflare R2 speichert Dateien (Track-Daten, Übersichtsbilder, Fotos). Cloudflare verarbeitet dabei als Auftragsverarbeiter auch Daten außerhalb der EU; Grundlage für die Übermittlung in die USA sind der EU-US Data Privacy Framework (Cloudflare ist zertifiziert) und die EU-Standardvertragsklauseln.'),
          p('Bei jedem Aufruf fallen technisch Verbindungsdaten an (IP-Adresse, Zeitpunkt, aufgerufene Adresse, Browser-Kennung). Wir nutzen sie für den Betrieb, zur Fehlersuche (Logs der Worker, „Observability“) und zum Schutz vor Missbrauch: Ratenbegrenzungen zählen Anfragen je IP-Adresse für jeweils 60 Sekunden (Hochladen, Anmelden, Fehlversuche mit Teilen-Links). Logs löscht Cloudflare nach wenigen Tagen automatisch. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (sicherer, stabiler Betrieb).'),
          p('Beim Anfordern eines Anmeldelinks prüft Cloudflare Turnstile, ob ein Mensch anfragt. Dazu lädt dein Browser ein Skript von challenges.cloudflare.com, das Merkmale von Browser und Gerät sowie die IP-Adresse auswertet – ohne Cookies für Werbung. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (Schutz vor automatisierten Anmeldungen und Mail-Missbrauch).'),
        ],
      },
      {
        id: 'konto',
        title: '4. Konto, Anmeldung und E-Mails (Resend)',
        blocks: [
          p('Für ein Konto brauchen wir nur deine E-Mail-Adresse. Angemeldet wird per Link („Magic Link“): Wir schicken ihn über den Mail-Dienst Resend (Resend, Inc., San Francisco, USA; Übermittlung auf Grundlage der EU-Standardvertragsklauseln). Der Link gilt 15 Minuten und einmal; bei uns liegt er nur als Prüfsumme (Hash).'),
          p('Nach der Anmeldung setzt der Server ein Sitzungs-Cookie (HttpOnly, SameSite=Lax, 180 Tage). Es ist für die Anmeldung technisch nötig (§ 25 Abs. 2 Nr. 2 TDDDG) und enthält nur ein zufälliges Kennzeichen, das wir ebenfalls nur als Hash speichern. Abmelden löscht es.'),
          p('Über Resend verschicken wir außerdem: Einladungen (an Adressen, die andere Nutzer:innen für Crew, Boots-Admins oder Gruppen angeben), eine Erinnerung 14 Tage bevor Törns gelöscht werden und – nur wenn du sie einschaltest – die tägliche Sammelmail zu Kommentaren und die wöchentliche Sammelmail aus deinen Vereinen und Teams. Die Sammelmails kannst du jederzeit im Konto abschalten.'),
          p('Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag: Konto, Anmeldung, Erinnerungen), lit. a (Einwilligung: Sammelmails), lit. f (Einladungen im Interesse der Einladenden; Eingeladene können sie ignorieren, die Adresse wird nach Ablauf der Einladung nach höchstens 14 Tagen gelöscht).'),
        ],
      },
      {
        id: 'inhalte',
        title: '5. Was du teilst und wer es sieht',
        blocks: [
          p('Wenn du einen Törn teilst, speichern wir die Track-Daten (GPS-Positionen mit Zeitstempeln, daraus berechnete Geschwindigkeiten), Titel, Kurzbeschreibung, die beim Einstellen geladenen Wetterdaten und optional ein Übersichtsbild. Dazu kommen, was du selbst anlegst: Profil (Anzeigename, Profiladresse, Text), Boote, gewählter Heimathafen und Verein, Häfen, Vereine und Teams, Beiträge, Kommentare, Reaktionen, Folgen, Titelbilder und – als Unterstützer:in – Fotos. Fotos und Titelbilder werden vor dem Hochladen in deinem Browser verkleinert und ohne Metadaten (EXIF) gespeichert; eine Position aus dem Foto übernehmen wir nur, wenn sie zum Track passt.'),
          h3('Sichtbarkeit'),
          ul(
            '„Öffentlich“: für alle sichtbar, in der Community („Entdecken“, Startseite, Hafen- und Vereinsseiten) gelistet und von Suchmaschinen auffindbar – bei Törns einschließlich aller Positionen und Zeitpunkte.',
            '„Nur mit Link“: nur wer den geheimen Link kennt. „Nur ich“: nur du. Beide Stufen gibt es mit einer laufenden Unterstützung; kostenlos ist alles, was du teilst, öffentlich.',
            'Profil-, Boots- und Gruppenseiten zeigen nur öffentliche Törns. Mitgliedschaften in Gruppen machen nichts sichtbar, was nicht ohnehin öffentlich ist; geschlossene Gruppen sehen nur ihre Mitglieder.',
            'In den Neuigkeiten erscheinen nur öffentliche Inhalte; dein Name nur, wenn dein Profil öffentlich ist. Bei Reaktionen sehen andere deinen Namen nur mit öffentlichem Profil, sonst nur die Anzahl.',
            'Deine E-Mail-Adresse ist nie öffentlich.',
          ),
          p('Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (du nutzt die App, um genau das zu teilen). Zeige keine Daten anderer Personen ohne deren Einverständnis (z. B. Personen auf Fotos).'),
        ],
      },
      {
        id: 'browser',
        title: '6. Was dein Browser direkt lädt',
        blocks: [
          p('Diese Abrufe macht dein Browser selbst; die Anbieter sehen dabei deine IP-Adresse und was angefragt wird. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (Darstellung von Karte und Wetter).'),
          ul(
            'Wetter: Beim Einstellen eines Törns fragt dein Browser Wind und Seegang bei Open-Meteo (open-meteo.com) ab – mit einigen Positionen entlang des Tracks und den Tagen des Törns. Die Ergebnisse werden mit dem Törn gespeichert und später nicht erneut abgerufen.',
            'Kartenkacheln: Esri (server.arcgisonline.com, Seekarte/Satellit), OpenStreetMap (tile.openstreetmap.org, tile.openstreetmap.de, wenn gewählt), OpenSeaMap (tiles.openseamap.org, Seezeichen) und EMODnet Bathymetry (ows.emodnet-bathymetry.eu, Wassertiefen). Übertragen wird der angezeigte Kartenausschnitt.',
            'Bot-Schutz bei der Anmeldung: Cloudflare Turnstile (siehe Abschnitt 3).',
          ),
          h3('Lokal in deinem Browser'),
          ul(
            'Gast-Sitzung: Geladene GPX-Dateien und Wetterdaten speichert die App in der IndexedDB deines Browsers, damit sie beim nächsten Besuch wieder da sind. Sie verlassen dein Gerät nicht, solange du nicht teilst. Löschen: „Alle entfernen“ oder Website-Daten im Browser löschen.',
            'Einstellungen für das Teilen-Bild (Format, Inhalt) liegen im localStorage.',
          ),
        ],
      },
      {
        id: 'zahlung',
        title: '7. Unterstützen und Zahlungen (Stripe)',
        blocks: [
          p('Wer die App unterstützt, bezahlt über Stripe Checkout (Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Dublin 2, Irland). Wir übergeben Betrag, deine E-Mail-Adresse und eine Konto-Kennung; Zahlungsdaten gibst du nur bei Stripe ein. Stripe bestätigt die Zahlung an unseren Server (signierter Webhook). Wir speichern Betrag, Währung, Zeitpunkt, die Stripe-Referenz und bis wann die Unterstützung gilt.'),
          p('Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO (Zahlung), lit. c (Aufbewahrungspflichten nach Handels- und Steuerrecht, bis zu 10 Jahre). Löschst du dein Konto, bleiben die Buchungen ohne Bezug zu deinem Konto erhalten.'),
        ],
      },
      {
        id: 'moderation',
        title: '8. Meldungen und Moderation',
        blocks: [
          p('Meldest du einen Inhalt, speichern wir Grund, optionale Anmerkung, Zeitpunkt und dein Konto (gegen Missbrauch, höchstens 20 Meldungen pro Tag). Der Inhalt kann bis zur Prüfung ausgeblendet werden. Nach der Entscheidung entfernen wir den Bezug zu deinem Konto und löschen die Meldung nach 180 Tagen. Konten, die wiederholt gegen Regeln verstoßen, können gesperrt werden. Rechtsgrundlage: Art. 6 Abs. 1 lit. c DSGVO (Pflichten nach dem DSA) und lit. f (sichere Community).'),
          p(`Kontakt für Meldungen ohne Konto: ${op.reportEmail}`),
        ],
      },
      {
        id: 'fristen',
        title: '9. Wie lange wir Daten speichern',
        blocks: [
          ul(
            'Törns kostenloser Konten: 3 Monate nach dem Hochladen. Mit Unterstützung: für die Dauer der Unterstützung und 3 Monate darüber hinaus. 14 Tage vorher erinnern wir per Mail.',
            'Konten ohne Törns, die 12 Monate nicht angemeldet waren (und keine laufende Unterstützung haben), löschen wir automatisch.',
            'Neuigkeiten (Aktivitäts-Log): 12 Monate. Anmeldelinks: 15 Minuten. Sitzungen: 180 Tage. Einladungen: 14 Tage. Beitrittsanfragen: 90 Tage.',
            'Zähler gegen Spam (Kommentare, Beiträge, Reaktionen): 24 Stunden. Entschiedene Meldungen: 180 Tage, ohne Bezug zur meldenden Person.',
            'Server-Logs bei Cloudflare: wenige Tage. Zahlungsbelege: gesetzliche Fristen (siehe Abschnitt 7).',
          ),
        ],
      },
      {
        id: 'loeschen',
        title: '10. Konto löschen',
        blocks: [
          p('Im Konto („Konto & Freigaben“ → „Konto löschen“) löschst du sofort und endgültig: Konto, Profil, Boote, alle Törns mit Dateien und Fotos, Kommentare (auch fremde auf deinen Törns), Reaktionen (auch fremde auf deinen Inhalten), Beiträge, Mitgliedschaften, Folgen und Neuigkeiten. Gruppen, deren Eigner:in du bist, gehen an die dienstälteste Admin-Person über, sonst werden sie gelöscht. Häfen, die du angelegt hast, bleiben ohne Bezug zu dir bestehen. Einzelne Inhalte löschst du jederzeit selbst.'),
        ],
      },
      {
        id: 'rechte',
        title: '11. Deine Rechte',
        blocks: [
          p('Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21). Eine Einwilligung kannst du jederzeit für die Zukunft widerrufen (Art. 7 Abs. 3). Schreib uns dazu an die oben genannte Adresse.'),
          p('Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), zum Beispiel bei der für uns zuständigen: Die Landesbeauftragte für den Datenschutz und für das Recht auf Akteneinsicht Brandenburg (LDA), Stahnsdorfer Damm 77, 14532 Kleinmachnow, www.lda.brandenburg.de.'),
        ],
      },
      {
        id: 'aenderungen',
        title: '12. Änderungen',
        blocks: [p('Ändert sich die App, passen wir diese Erklärung an. Es gilt die jeweils hier veröffentlichte Fassung.')],
      },
    ],
  };
}

export const LEGAL_PAGES = { impressum, datenschutz } as const;
export type LegalSlug = keyof typeof LEGAL_PAGES;
export const isLegalSlug = (s: unknown): s is LegalSlug => s === 'impressum' || s === 'datenschutz';
