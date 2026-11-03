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

export const LEGAL_UPDATED = 'November 2026';

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
            'Törns bleiben eine Saison (Kalenderjahr) gespeichert und werden Ende Januar danach automatisch gelöscht – außer du unterstützt die nächste Saison. Dein Konto kannst du jederzeit selbst löschen.',
          ),
        ],
      },
      {
        id: 'hosting',
        title: '3. Hosting, Server-Logs, Schutz vor Missbrauch (Cloudflare)',
        blocks: [
          p('Die App läuft bei Cloudflare (Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA): Cloudflare Workers führt den Server-Code aus, Cloudflare D1 speichert die Datenbank (Konten, Profile, Boote, Häfen, Gruppen, Beiträge, Umfragen und Stimmen, Kommentare, Reaktionen, Metadaten der Törns und Fotos), Cloudflare R2 speichert Dateien (Track-Daten, Übersichtsbilder, Fotos). Cloudflare verarbeitet dabei als Auftragsverarbeiter auch Daten außerhalb der EU; Grundlage für die Übermittlung in die USA sind der EU-US Data Privacy Framework (Cloudflare ist zertifiziert) und die EU-Standardvertragsklauseln.'),
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
          p('Über Resend verschicken wir außerdem: Einladungen (an Adressen, die andere Nutzer:innen für Crew, Boots-Admins oder Gruppen angeben), eine Erinnerung 14 Tage bevor Törns gelöscht werden, einen Hinweis, wenn an deinem Konto ein neuer Passkey angelegt wird, die Begründung, wenn die Moderation einen deiner Inhalte oder dein Konto sperrt, die Entscheidung über deinen Antrag auf Vertretung eines Vereins oder Hafens bzw. den Hinweis, dass die Verwaltung an die verifizierte Vertretung übertragen wurde, und – nur wenn du sie einschaltest – die tägliche Sammelmail zu deinen Benachrichtigungen (Kommentare, Reaktionen, Follower, Beitrittsanfragen, Erinnerungen und Änderungen zu Veranstaltungen mit deiner Zusage; nur Anzahl und eigene oder von dir kommentierte Törns bzw. eigene Gruppen, bei Veranstaltungen nur der Verlauf, keine Namen und keine Titel) und die wöchentliche Sammelmail aus deinen Vereinen und Teams. Die Sammelmails kannst du jederzeit im Konto abschalten; Anmeldung, Sicherheitshinweise und Hinweise vor dem Löschen kommen immer.'),
          p('Push-Benachrichtigungen (nur wenn du sie im Konto für eine Art wählst und im Browser erlaubst): Wir speichern dann die Adresse, die dein Browser vom Push-Dienst seines Herstellers bekommt (Google, Apple, Mozilla oder Microsoft), und schicken dorthin einen leeren Weckruf – ohne Inhalt. Den Text lädt dein Gerät danach direkt von uns. Der Push-Dienst erfährt also nur, dass es etwas gibt. Die Adresse löschen wir, wenn du Push abwählst, dein Konto löschst oder ein Jahr lang nichts zugestellt wurde. Solange die Seite offen ist, hält sie außerdem eine Verbindung (WebSocket) zu uns, über die nur „es gibt Neues“ kommt; dafür speichern wir nichts.'),
          p('Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag: Konto, Anmeldung, Erinnerungen), lit. a (Einwilligung: Sammelmails, Push), lit. f (Einladungen im Interesse der Einladenden; Eingeladene können sie ignorieren oder den Link weitergeben – wer ihn dann öffnet, sieht die Adresse nur gekürzt, z. B. „a…@e….org“; die Adresse wird nach Ablauf der Einladung nach höchstens 14 Tagen gelöscht).'),
        ],
      },
      {
        id: 'inhalte',
        title: '5. Was du teilst und wer es sieht',
        blocks: [
          p('Wenn du einen Törn teilst, speichern wir die Track-Daten (GPS-Positionen mit Zeitstempeln, daraus berechnete Geschwindigkeiten), Titel, Kurzbeschreibung, die beim Einstellen geladenen Wetterdaten und optional ein Übersichtsbild. Für dich speichern wir außerdem Benachrichtigungen (z. B. „Anna hat deinen Törn kommentiert“) mit Art, Bezug und Lesestatus. Damit „Community“ neue Einträge zählen kann, merken wir uns, bis wann du deine Neuigkeiten zuletzt angesehen hast (ein Zeitpunkt in deinem Konto, gelöscht mit dem Konto). Dazu kommen, was du selbst anlegst: Profil (Anzeigename, Profiladresse, Text), Boote, gewählter Heimathafen und Verein, Häfen, Vereine und Teams (auch eine angegebene Webseite), Beiträge, Umfragen und Veranstaltungen (mit Termin, Ort und Plätzen), deine Stimmen in Umfragen (welche Antwort, wann), deine Zusagen zu Veranstaltungen („Nehme teil“, „Vielleicht“, „Nehme nicht teil“ mit Zeitpunkt), Kommentare, Reaktionen, Folgen, Titelbilder, Fotos in Beiträgen und – als Unterstützer:in – Fotos an Törns. Fotos und Titelbilder werden vor dem Hochladen in deinem Browser verkleinert und ohne Metadaten (EXIF) gespeichert; eine Position aus dem Foto übernehmen wir nur bei Törn-Fotos und nur, wenn sie zum Track passt. Fotos in Beiträgen haben keinen Ort und sind so sichtbar wie ihr Beitrag. Für das Monatskontingent der Fotos in Beiträgen zählen wir je hochgeladenem Foto einen Zeitpunkt in deinem Konto.'),
          h3('Sichtbarkeit'),
          ul(
            '„Öffentlich“: für alle sichtbar, in der Community („Entdecken“, Startseite, Hafen- und Vereinsseiten) gelistet und von Suchmaschinen auffindbar (auch über unsere Sitemap) – bei Törns einschließlich aller Positionen und Zeitpunkte.',
            '„Nur mit Link“: nur wer den geheimen Link kennt. „Nur ich“: nur du. Beide Stufen gibt es mit einer laufenden Unterstützung; kostenlos ist alles, was du teilst, öffentlich.',
            'Profil-, Boots- und Gruppenseiten zeigen nur öffentliche Törns. Geschlossene Gruppen sehen nur ihre Mitglieder.',
            'Mitgliedschaften in Vereinen und Teams: Die Mitgliederliste sehen standardmäßig nur die Mitglieder der Gruppe, alle anderen nur die Anzahl; macht die Gruppe sie öffentlich, erscheinen Namen nur bei öffentlichem Profil, sonst ein Spaßname je Gruppe. Dass du beigetreten bist und welcher Verein „deiner“ ist, sehen nur Mitglieder derselben Gruppe. Eigentümer:in und Admins der Gruppe sehen alle Anzeigenamen, nie deine E-Mail-Adresse.',
            'Folgen ist keine Mitgliedschaft: Wer einer Gruppe, einem Hafen, einem Boot oder einer Person folgt, sieht nur Öffentliches. Wie oft du benachrichtigt wirst, stellst du je Gruppe bzw. je Folgen an der Glocke ein; gespeichert wird die Stufe an deiner Mitgliedschaft bzw. deinem Folgen und mit ihr gelöscht.',
            'In den Neuigkeiten erscheinen für andere nur öffentliche Inhalte (Beiträge „Nur Mitglieder“ nur für die Mitglieder der Gruppe); dein Name nur, wenn dein Profil öffentlich ist. Bei Reaktionen sehen andere deinen Namen nur mit öffentlichem Profil, sonst nur die Anzahl.',
            'Zusagen zu Veranstaltungen: Wer die Veranstaltung sehen kann, sieht die Anzahl je Antwort und bei „Nehme teil“ und „Vielleicht“ deinen Namen nur bei öffentlichem Profil. Wer sie angelegt hat sowie Eigentümer:in und Admins der Gruppe sehen alle Anzeigenamen (wie die Mitgliederliste), nie deine E-Mail-Adresse. Bei „Nehme teil“ und „Vielleicht“ bekommst du eine Erinnerung und eine Nachricht bei Änderung oder Absage – in der Glocke und, wenn du es wählst, per Push bzw. in der Sammelmail (dort ohne Titel, nur mit dem Verlauf).',
            'Umfragen sind standardmäßig anonym: alle – auch wer die Umfrage gestellt hat – sehen nur, wie viele Stimmen jede Antwort hat. Ist eine Umfrage als „namentlich“ gekennzeichnet (steht vor dem Abstimmen an der Umfrage und lässt sich nicht umstellen), sehen alle, die das Ergebnis sehen dürfen, bei welcher Antwort du stehst – mit deinem Namen nur bei öffentlichem Profil, sonst nur als Anzahl. Deine Stimme kannst du bis zum Ende ändern und – außer bei Umfragen, deren Ergebnis erst die eigene Stimme zeigt – zurücknehmen; danach bleibt sie, bis die Umfrage oder dein Konto gelöscht wird.',
            'Crew eines Törns: Andere sehen Mitglieder und ihre Rolle an Bord (Skipper:in, Co-Skipper:in, Crew, Gast) nur auf öffentlichen Törns und nur mit öffentlichem Profil. Bestätigt die Skipperin bzw. der Skipper deine Rolle für den Meilennachweis, sehen das nur du, die Eigentümer:in und die Skipper:in; löschst du dein Konto, bleiben deine Bestätigungen ohne Bezug zu deinem Konto stehen. Mit bestätigter Rolle steht der Törn auch dann in deinem Fahrtenbuch, wenn er nicht öffentlich ist – nur mit Eckdaten (Datum, Häfen, Seemeilen und ihre Herkunft, deine Rolle, Boot, Dauer), ohne Titel, Track und Angaben der Eigentümer:in; er fällt weg, wenn du die Crew verlässt, die Bestätigung entfällt, die Eigentümer:in ihn löscht oder aus ihrem Fahrtenbuch ausschließt oder die Moderation Törn bzw. Konto sperrt.',
            'Dein Fahrtenbuch (Konto → „Mein Fahrtenbuch“) und den Meilennachweis als CSV-Datei bzw. zum Drucken siehst nur du; beides wird bei jedem Abruf aus deinen Törns erzeugt und nicht gespeichert. Das Bild „Meine Saison“ mit deinen Saison-Zahlen und Abzeichen entsteht nur in deinem Browser; wir speichern es nicht. Herunterladen legt es auf deinem Gerät ab; dein Gerät verlässt es nur, wenn du es selbst teilst. Zusatzangaben wie Revier, Stunden unter Segel und Motor, Nachtfahrt, Schleusen, Regatta und Posten speichern wir am Törn und löschen sie mit ihm.',
            'Wertung (Seite „Wertung“, verlinkt aus „Mein Fahrtenbuch“): Die gewählte Wertungsvorlage speichern wir am Törn; Punkte, Jahresbericht und Vereinsliste werden bei jedem Abruf gerechnet und nicht gespeichert. An der Vereinsliste eines Vereins nimmst du nur teil, wenn du es dort einschaltest (wir speichern den Zeitpunkt an deiner Mitgliedschaft). Dann sehen die Eigentümer:in und die Admins dieses Vereins deinen Anzeigenamen (mit öffentlichem Profil als Link) und deine Punktesumme – nur aus öffentlichen Törns, die du in diesem Verein zeigst und mit einer Vorlage des Vereins wertest, ohne Einzelangaben der Törns. Andere Mitglieder sehen deine Summe nicht; du selbst siehst nur deine. Die Teilnahme endet sofort, wenn du sie ausschaltest, den Verein verlässt, dein Konto löschst oder der Verein gelöscht wird. Vorlagen der Vereine löschen wir mit dem Verein; sie enthalten keine Personendaten.',
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
            'Kartenkacheln: OpenStreetMap Deutschland (tile.openstreetmap.de, betrieben vom FOSSGIS e.V., Tageskarte und Teilen-Bild), Esri (server.arcgisonline.com, Nachtkarte und Seekarte), OpenStreetMap (tile.openstreetmap.org, wenn gewählt), OpenSeaMap (tiles.openseamap.org, Seezeichen) und EMODnet Bathymetry (ows.emodnet-bathymetry.eu, Wassertiefen). Übertragen wird der angezeigte Kartenausschnitt.',
            'Bot-Schutz bei der Anmeldung: Cloudflare Turnstile (siehe Abschnitt 3).',
          ),
          h3('Lokal in deinem Browser'),
          ul(
            'Entwurf: Die GPX-Dateien und Wetterdaten eines noch nicht gespeicherten Törns speichert die App in der IndexedDB deines Browsers (immer nur ein Entwurf), damit er beim nächsten Besuch wieder da ist. Er verlässt dein Gerät nicht, solange du nicht speicherst oder teilst. Gelöscht wird er beim Speichern, beim Abmelden (angemeldet entstanden oder übernommen gehört er zu deinem Konto und erscheint keinem anderen Konto), beim Verwerfen des Entwurfs oder wenn du die Website-Daten im Browser löschst.',
            'Umgebung in der Community: Erst wenn du „meinen Standort verwenden“ anklickst, fragt dein Browser nach dem Standort. Die App rundet ihn sofort auf etwa 11 km (0,1°) und merkt ihn – ebenso einen auf der Karte gewählten Ort – mit Umkreis und gewählter Ansicht nur im localStorage dieses Geräts („Standort vergessen“ löscht ihn). An unseren Server geht nur der gerundete Wert, um die Neuigkeiten der Häfen und Vereine im Umkreis zu laden; gespeichert wird er dort nicht.',
            'Einstellungen für das Teilen-Bild (Format, Inhalt) liegen im localStorage. Einen als Standard gesetzten Kartenstil speichern wir in deinem Konto; er wird mit dem Konto gelöscht.',
          ),
        ],
      },
      {
        id: 'zahlung',
        title: '7. Unterstützen und Zahlungen (Stripe)',
        blocks: [
          p('Wer die App unterstützt, bezahlt über Stripe Checkout (Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Dublin 2, Irland). Wir übergeben Betrag, deine E-Mail-Adresse und eine Konto-Kennung; Zahlungsdaten gibst du nur bei Stripe ein. Stripe bestätigt die Zahlung an unseren Server (signierter Webhook). Wir speichern Betrag, Währung, Zeitpunkt, die Stripe-Referenz und bis wann die Unterstützung gilt.'),
          p('Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO (Zahlung), lit. c (Aufbewahrungspflichten nach Handels- und Steuerrecht, bis zu 10 Jahre). Löschst du dein Konto, bleiben die Buchungen ohne Bezug zu deinem Konto erhalten; 10 Jahre nach Ablauf der Unterstützung löschen wir sie.'),
        ],
      },
      {
        id: 'moderation',
        title: '8. Meldungen und Moderation',
        blocks: [
          p('Meldest du einen Inhalt, speichern wir Grund, optionale Anmerkung, Zeitpunkt und dein Konto (gegen Missbrauch, höchstens 20 Meldungen pro Tag). Der Inhalt kann bis zur Prüfung ausgeblendet werden. Nach der Entscheidung – spätestens nach 180 Tagen ohne Entscheidung – entfernen wir den Bezug zu deinem Konto und deine Anmerkung; entschiedene Meldungen löschen wir nach weiteren 180 Tagen. Konten, die wiederholt gegen Regeln verstoßen, können gesperrt werden. Sperren wir einen Inhalt oder ein Konto zur Beweissicherung, ist er nur noch für die Moderation sichtbar und von den üblichen Löschfristen ausgenommen; nach 180 Tagen wird er endgültig gelöscht, falls die Sperre nicht begründet verlängert oder vorher aufgehoben wird. Wird ein Inhalt oder Konto von dir gesperrt, bekommst du eine Mail mit der Begründung und kannst widersprechen. Zur Prüfung kann die Moderation gesperrte Inhalte (auch private Törns und Fotos) ansehen; jeder solche Einblick wird protokolliert. Jede Moderationsaktion halten wir in einem Protokoll fest (wer, was, wann, welches Objekt – ohne Mail-Adressen): Einblicke in Übersichten 180 Tage, Entscheidungen und Einblicke in gesperrte Inhalte 2 Jahre, zu noch gesperrten Inhalten bis zum Ende der Sperre. Rechtsgrundlage: Art. 6 Abs. 1 lit. c DSGVO (Pflichten nach dem DSA) und lit. f (sichere Community).'),
          p('Vertretung von Vereinen und Häfen: Stellst du den Antrag „Ich vertrete diesen Verein/Hafen“, speichern wir deine Funktion, Begründung, einen Kontakt für Rückfragen, optional einen Beleg-Link, Zeitpunkt und dein Konto. Nur die Moderation sieht diese Angaben; sie prüft über die öffentlichen Kontaktdaten des Vereins bzw. Hafens (Impressum, Vereinsregister). Bitte schick uns keine Ausweis- oder Vollmachtskopien – Uploads gibt es dafür nicht. Ziehst du den Antrag zurück oder wird er abgelehnt, löschen wir die Angaben sofort und den Rest des Antrags nach 30 Tagen; angenommen löschen wir die Angaben nach 30 Tagen (Widerspruchsfrist) und behalten nur, wer wann übertragen hat, solange der Verein bzw. Hafen besteht. Offene Anträge laufen nach 180 Tagen ab. Wird die Verwaltung übertragen, bekommen du und die bisherige Eigner:in eine Mail. Rechtsgrundlage: Art. 6 Abs. 1 lit. b und f DSGVO (echte Vereine und Häfen schützen).'),
          p(`Kontakt für Meldungen ohne Konto: ${op.reportEmail}`),
        ],
      },
      {
        id: 'fristen',
        title: '9. Wie lange wir Daten speichern',
        blocks: [
          ul(
            'Törns samt Fotos: bis zum 1. Februar nach ihrer Saison (Kalenderjahr; ab November Hochgeladenes zählt zur nächsten Saison). Mit Unterstützung: bis zum 1. Februar nach der letzten unterstützten Saison. Fahrtenbuch-Einträge ohne GPX-Datei (Häfen, Strecke, Angaben wie Wind, Liegeplatz, Notizen und Zusatzangaben) bleiben eine Saison länger. Im Dezember und 14 Tage vor dem Löschen erinnern wir per Mail.',
            'Beiträge mit Fotos: bis du sie löschst, mit deinem Konto bzw. mit dem Verein, Team, Hafen oder Boot, in dem sie stehen – Fotos samt Dateien immer mit ihrem Beitrag. Einzelne Fotos kannst du jederzeit selbst löschen. Einen Beitrag, zu dem kein Foto hochgeladen wurde (z. B. abgebrochenes Hochladen), löschen wir beim nächtlichen Aufräumen, sobald er älter als 24 Stunden ist. Zähler für das Monatskontingent der Fotos: 32 Tage.',
            'Titelbilder von Profil, Boot, Verein oder Team: solange es das jeweilige Profil, Boot bzw. die Gruppe gibt; ein ersetztes Bild löschen wir sofort.',
            'Passkeys (öffentlicher Schlüssel, Gerätename, letzte Nutzung): bis du sie entfernst oder dein Konto löschst.',
            'Konten ohne Törns, die 12 Monate nicht angemeldet waren (und keine laufende Unterstützung haben), löschen wir automatisch.',
            'Neuigkeiten (Aktivitäts-Log): 12 Monate. Benachrichtigungen: gelesene 30 Tage, alle spätestens 90 Tage; Push-Adressen bis zum Abwählen, höchstens ein Jahr ohne Zustellung. Anmeldelinks und -codes: 15 Minuten gültig, gespeichert bis 24 Stunden nach Ablauf (Schutz vor Durchprobieren). Sitzungen: 180 Tage. Einladungen: 14 Tage. Beitrittsanfragen: 90 Tage.',
            'Veranstaltungen samt aller Zusagen: 12 Monate nach ihrem Ende (ins Fahrtenbuch übernommene Einträge bleiben, sie sind eigene Törns); deine Zusagen mit deinem Konto. Stimmen in Umfragen: solange die Umfrage besteht (sie verschwindet wie ein Beitrag: von dir, der Gruppe bzw. dem Hafen oder Boot gelöscht, mit dem Konto der Verfasser:in oder durch die Moderation), deine eigene mit deinem Konto. Zähler gegen Spam (Kommentare, Beiträge, Reaktionen, Stimmen und Zusagen): 24 Stunden. Meldungen: ohne Bezug zur meldenden Person nach der Entscheidung bzw. spätestens nach 180 Tagen, entschiedene gelöscht nach weiteren 180 Tagen. Gesperrte Inhalte und Konten: höchstens 180 Tage je Sperre, dann endgültig gelöscht. Moderationsprotokoll: Einblicke 180 Tage, Entscheidungen und Einblicke in gesperrte Inhalte 2 Jahre. Geschenkter Unterstützer-Status (Gutschein): 2 Jahre nach Ablauf. Anträge auf Vertretung von Vereinen und Häfen: Angaben bis zur Ablehnung bzw. 30 Tage nach der Annahme, der Rest abgelehnter oder zurückgezogener Anträge 30 Tage, offene höchstens 180 Tage.',
            'Server-Logs bei Cloudflare: wenige Tage. Zahlungsbelege: 10 Jahre nach Ablauf der Unterstützung (siehe Abschnitt 7).',
          ),
        ],
      },
      {
        id: 'loeschen',
        title: '10. Konto löschen',
        blocks: [
          p('Im Konto („Konto & Freigaben“ → „Konto löschen“) löschst du sofort und endgültig: Konto, Profil, Boote, alle Törns mit Dateien und Fotos, Beiträge samt Fotos (auch fremde in deinen Booten), Kommentare (auch fremde auf deinen Törns), Reaktionen (auch fremde auf deinen Inhalten), Beiträge, Umfragen und Veranstaltungen (samt aller Stimmen und Zusagen darin), deine Stimmen in Umfragen anderer, deine Zusagen zu Veranstaltungen anderer, Mitgliedschaften, Folgen, Neuigkeiten und Benachrichtigungen (bei anderen erscheinst du danach nur noch als „Jemand“). Gruppen, deren Eigner:in du bist, gehen an die dienstälteste Admin-Person über, ohne Admin an das dienstälteste Mitglied; nur Gruppen ohne weitere Mitglieder werden gelöscht. Passkeys und Titelbilder von Profil und Booten löschen wir mit. Häfen, die du angelegt hast, bleiben ohne Bezug zu dir bestehen. Einzelne Inhalte löschst du jederzeit selbst.'),
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
