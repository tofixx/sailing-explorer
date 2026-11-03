// Anleitung „So zeichnest du deinen Törn auf“ (Konzept 25, F-450) – Texte als Daten, gerendert von sx-guide-page.
// Rein, ohne DOM und Netz. App-Angaben (Preis, Export-Weg) sind mit Quellen in docs/CONCEPT.md (25.2) belegt –
// wer hier etwas ändert, prüft die Quelle und den Stand dort mit.

import { APP_NAME } from '../domain/brand';

/** Pfad der Anleitung – auch Ziel der Hinweise in „+ Neu“, auf der Startseite und im Gäste-Slider. */
export const RECORDING_GUIDE_PATH = '/anleitung/aufzeichnen';

export interface GuideLink {
  text: string;
  href: string;
}

/** Ein Weg zur GPX-Datei: Name, kurze Einordnung, wenige nummerierte Schritte, optional die offizielle Seite. */
export interface GuideWay {
  title: string;
  /** Plattform, Preis o. Ä. – eine Zeile */
  meta?: string;
  steps: string[];
  /** Hinweis unter den Schritten (z. B. Zeitstempel) */
  note?: string;
  link?: GuideLink;
}

export interface GuideSection {
  id: string;
  title: string;
  /** Eine Zeile unter dem Titel, auch im zugeklappten Zustand sichtbar */
  summary: string;
  /** Beim Öffnen der Seite aufgeklappt */
  open?: boolean;
  intro?: string;
  ways?: GuideWay[];
  /** Tipps als kurze Liste */
  tips?: string[];
}

export interface Guide {
  title: string;
  lead: string;
  /** Stand der App-Angaben */
  updated: string;
  sections: GuideSection[];
}

export const RECORDING_GUIDE: Guide = {
  title: 'So zeichnest du deinen Törn auf',
  lead:
    `${APP_NAME} liest GPX-Dateien – die Spur deines Törns mit Zeitstempeln. Aufzeichnen kann fast jedes Gerät an Bord: ` +
    'Handy, Uhr oder Kartenplotter. Such dir einen Weg aus; am einfachsten ist das Handy.',
  updated: 'November 2026',
  sections: [
    {
      id: 'handy',
      title: 'Mit dem Handy',
      summary: 'Kostenlose App: starten, segeln, als GPX teilen',
      open: true,
      intro: 'Eine App genügt. OsmAnd ist kostenlos, läuft auf iPhone und Android und exportiert GPX.',
      ways: [
        {
          title: 'OsmAnd (iPhone und Android)',
          meta: 'kostenlos · Fahrtenaufzeichnung ist in der Gratis-Version enthalten',
          steps: [
            'App installieren, Standort erlauben und unter Menü → Plugins die „Fahrtenaufzeichnung“ einschalten.',
            'Vor dem Ablegen die Aufzeichnung starten (Menü → Fahrtenaufzeichnung oder das Aufnahme-Symbol auf der Karte), nach dem Anlegen beenden und speichern.',
            'Menü → Meine Orte → Tracks: beim Törn auf ⋮ (Android) bzw. lange antippen (iPhone) → Teilen. Es entsteht eine GPX-Datei.',
          ],
          link: { text: 'OsmAnd-Hilfe: Fahrtenaufzeichnung', href: 'https://osmand.net/docs/user/plugins/trip-recording' },
        },
      ],
      tips: [
        'Hintergrund-Ortung erlauben: Auf dem iPhone unter Einstellungen → Datenschutz & Sicherheit → Ortungsdienste → App „Immer“ und „Genauer Standort“ wählen.',
        'Android: Die Akku-Optimierung für die App ausschalten und die Benachrichtigung der laufenden Aufnahme nicht wegwischen – sonst beendet das System die Aufnahme.',
        'Der Bildschirm darf aus sein. Die App aber nicht aus der App-Übersicht wischen.',
        'Ein Punkt alle 1 bis 5 Sekunden reicht für Geschwindigkeit und Wenden. Seltener spart Akku, macht die Spur aber eckig.',
        'Akku voll laden, bei langen Schlägen eine Powerbank mitnehmen. Vorher einmal kurz an Land ausprobieren.',
        'Lieber eine schlichte App nur zum Aufzeichnen? Open GPX Tracker (iPhone, kostenlos) und OpenTracks (Android, kostenlos) teilen die Aufnahme ebenfalls als GPX – bietet die App mehrere Formate an, GPX wählen.',
      ],
    },
    {
      id: 'uhr',
      title: 'Mit der Uhr',
      summary: 'Garmin oder Apple Watch',
      ways: [
        {
          title: 'Garmin',
          meta: 'z. B. fēnix, quatix, MARQ – je nach Modell',
          steps: [
            'Auf der Uhr die Aktivität „Segeln“ starten (bei vielen Modellen unter Wassersport).',
            'Nach dem Törn speichern; die Uhr überträgt die Aktivität zu Garmin Connect.',
            'Garmin Connect im Browser öffnen (nicht in der Handy-App), Aktivität wählen, oben rechts über das Zahnrad den GPX-Export wählen.',
          ],
          link: { text: 'Garmin-Handbuch: Segeln (fēnix 8)', href: 'https://www8.garmin.com/manuals-apac/webhelp/fenix8series/EN-SG/GUID-D2159A6F-52C8-4545-9B2B-0314697B5A1F-8083.html' },
        },
        {
          title: 'Apple Watch',
          meta: 'über eine App mit GPX-Export',
          steps: [
            'Open GPX Tracker hat eine Watch-App: Aufzeichnung auf der Uhr starten und beenden.',
            'Die Datei landet auf dem gekoppelten iPhone und lässt sich dort wie oben teilen.',
          ],
          note: 'Wer mehr Anzeigen auf der Uhr möchte: WorkOutDoors (kostenpflichtig) zeichnet ohne iPhone auf und exportiert GPX.',
          link: { text: 'Open GPX Tracker auf GitHub', href: 'https://github.com/merlos/iOS-Open-GPX-Tracker' },
        },
      ],
    },
    {
      id: 'garmin-plotter',
      title: 'Garmin-Kartenplotter (GPSMAP)',
      summary: 'Track auf die Speicherkarte, am Rechner in GPX umwandeln',
      ways: [
        {
          title: 'Am Plotter',
          steps: [
            'Speicherkarte einstecken.',
            'Zielführung → Menü → Benutzerdaten verwalten → Datenübertragung → „Alle auf Karte speichern“.',
            'Auf der Karte entsteht eine .ADM-Datei.',
          ],
          note: 'Zeitstempel hat nur das ACTIVE LOG. Am Gerät gespeicherte Tracks verlieren die Zeiten – also immer erst exportieren, dann den Track löschen.',
        },
        {
          title: 'Am Rechner',
          steps: [
            'Die .ADM-Datei in Garmin BaseCamp oder HomePort öffnen.',
            'Den Track (ACTIVE LOG) als GPX exportieren.',
            `Die GPX-Datei in ${APP_NAME} laden (siehe unten).`,
          ],
        },
      ],
    },
    {
      id: 'andere-plotter',
      title: 'Andere Plotter und Navigations-Apps',
      summary: 'Raymarine, B&G, Navionics, Strava, Komoot',
      intro: 'Fast alle Geräte und Apps können Tracks exportieren. Wichtig ist das Format GPX.',
      ways: [
        {
          title: 'Raymarine Axiom (LightHouse 4)',
          steps: [
            'microSD-Karte einstecken.',
            'Startbildschirm → Meine Daten → Import/Export → „Meine Daten speichern“ → Tracks wählen → Kartensteckplatz → Speichern.',
            'Die GPX-Datei liegt auf der Karte im Ordner „Raymarine/My Data“.',
          ],
          note: 'Fehlen in der Datei die Zeitstempel, zeigt die Karte den Weg, aber keine Geschwindigkeit und kein Wetter zur Zeit.',
          link: { text: 'Raymarine-Handbuch: Benutzerdaten speichern', href: 'https://docs.raymarine.com/81406/en-US/latest/SavingUserData-C80AD8A3.html' },
        },
        {
          title: 'B&G, Simrad, Lowrance und andere',
          steps: [
            'Im Track-Menü den Track wählen und auf Speicherkarte oder USB exportieren.',
            'Wenn das Gerät mehrere Formate anbietet, GPX wählen – sonst im Handbuch nachsehen.',
          ],
        },
        {
          title: 'Navionics, Strava, Komoot',
          steps: [
            'Navionics Boating: Menü → Tracks → Track wählen → Teilen → GPX (laut Navionics nur mit Abo).',
            'Strava: auf strava.com die Aktivität öffnen → „…“ → „Export GPX“.',
            'Komoot: auf komoot.com die Tour öffnen → „…“ → GPX herunterladen.',
          ],
        },
      ],
    },
    {
      id: 'ohne',
      title: 'Ohne Aufzeichnung',
      summary: 'Törn trotzdem ins Fahrtenbuch',
      intro:
        'Kein Track? Über „+ Neu → Fahrtenbuch-Eintrag“ trägst du den Törn mit Datum, Häfen und Seemeilen ein – ganz ohne GPX. ' +
        'Eine Aufzeichnung kannst du beim nächsten Mal ergänzen.',
    },
    {
      id: 'danach',
      title: 'Und dann: Törn laden',
      summary: 'GPX auf die Seekarte bringen',
      open: true,
      ways: [
        {
          title: `GPX in ${APP_NAME} laden`,
          steps: [
            'Oben „+ Neu → Törn (GPX)“ wählen und die Datei aussuchen – oder die Datei einfach auf die Karte ziehen.',
            'Der Track erscheint auf der Seekarte mit Geschwindigkeit, Wind und Wellen. Die Datei wird dabei nur in deinem Browser ausgewertet.',
            'Ausprobieren geht ohne Anmeldung. Zum Speichern und Teilen meldest du dich an.',
          ],
        },
      ],
    },
  ],
};
