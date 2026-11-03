# 34. Bootsklasse und Filter in Entdecken (F-535 … F-539, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 34). Roadmap „Als Nächstes“ #8: Gleichgesinnte finden (Jollen,
Folkeboot, Fahrtenyachten). `boats.boat_type` ist Freitext („Bavaria 34“, „Folke“, „20er JK“) und taugt so nicht als
Filter. Leitlinie „weniger ist mehr“: eine kurze, kuratierte Klassenliste, die Klasse wird aus dem Typ abgeleitet,
der Eigner kann sie überschreiben; der freie Typ bleibt als Angabe stehen.

## 34.1 Architektur-Skizze (CLAUDE.md „Vor dem ersten Code“)

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Erweiterung von `boats` (keine neue Art, keine neue Tabelle): Migration `0042_boat_class.sql` (additiv) mit `boats.boat_class TEXT NOT NULL DEFAULT ''` (ID aus `BOAT_CLASSES`, leer = nicht zugeordnet) und Teilindex `boats_class`. Die Migration befüllt den Altbestand aus `boat_type`; das SQL ist aus denselben Regeln erzeugt (`boatTypeFoldSql`, `boatClassSql` in `src/domain/boat-class.ts`), ein Test mit Altbestand hält Migration und `classifyBoatType` gleich. |
| Querschnitte | Sichtbarkeit: Filter nur über öffentliche, nicht ausgeblendete Boote (`publicSql`), Eigner nicht gesperrt (`notSuspendedSql`); Vereine nur mit für alle sichtbarer Bootsliste (`membersVisibleSql('g', "''")`, ohne Betrachter). Cache: `/api/discover` bleibt `public, max-age=60`; die Klasse steht in der Adresse (`?klasse=`), nichts hängt vom Betrachter ab. Stream, Zähler, Kontingente, Benachrichtigungen, Einbettungen, Zusammenführen: unberührt (die Spalte wandert mit der Bootszeile). Lösch-Register: kein Eintrag nötig – keine neue Tabelle, keine `*_kind`-Spalte, kein R2. |
| Lösch- und Sichtbarkeitspfade | 34.4 |
| Komponentenschnitt | Reine Regeln `src/domain/boat-class.ts` (Liste, Gruppen, `classifyBoatType`, `resolveBoatClass`, `boatClassesOf`, SQL-Erzeugung). Worker: `worker/boats.ts` (Speichern), `worker/discover.ts` (Bausteine `CLASS`, Platz `?4`), `worker/groups.ts` (`publicGroups` mit optionalem Klassen-Filter). Oberfläche: geteilte Optionen `src/components/boat-class-options.ts` für Bootsformular (`sx-account-dialog`) und Filter (`sx-discover`, Event `sx-discover-class`), Ablauf und Adresse im `DiscoverController`, eine Zeile Verdrahtung in `app.ts`. Mobil: die Auswahl ist ein natives `<select>` – neben dem Suchfeld, unter 560 px darunter in voller Breite, 44 px hoch; keine neue seitlich scrollende Leiste. |
| Parallele Arbeit | `feature/web-url` ändert `worker/groups.ts` (Spalte `web_url`) und exportiert `LISTED` in `worker/discover.ts`; `feature/kleinkram-navigation` ändert Icons in `sx-discover.ts` (`ENTITY_ICON`). Dieser Branch fasst dort nur `publicGroups` bzw. die Zeile `facts` der Bootskarte und die Werkzeuge an – kleine, getrennte Stellen. |

## 34.2 Klassenliste (F-535)

Kuratiert für Binnen- und Küstenreviere (K 22.1), bewusst kurz – keine vollständige Klassenvereinigung:

| Gruppe | Klassen |
| --- | --- |
| Jollen | Optimist, ILCA / Laser, 420er, 470er, Pirat, Korsar, Conger, Jollenkreuzer |
| Kielboote | Folkeboot, H-Boot, J/24, Drachen |
| Yachten und Mehrrumpf | Fahrtenyacht / Kielboot, Katamaran |
| – | Sonstige |

Entscheidungen:
- **IDs statt Namen** (`ilca`, `h-boot`, `j24` …): Anzeigenamen dürfen sich ändern, gespeicherte Werte nicht.
- **„Sonstige“ wählt nur der Eigner.** Ein nicht erkannter Typ bleibt leer („nicht zugeordnet“) und erscheint unter
  keiner Klasse – so landet kein Boot falsch in „Sonstige“, und eine spätere Regel kann es noch zuordnen.
- **Gruppen sind Sammel-Filter** („Alle Jollen“, `?klasse=jollen`), keine eigene Spalte.
- Erweitern: eine Klasse ist eine Zeile in `BOAT_CLASSES` (und optional Muster in `BOAT_CLASS_RULES`). Neue Muster
  wirken beim nächsten Speichern; für den Altbestand bräuchte es eine neue Rückbefüllung (neue Migration, erzeugt wie 0042).

## 34.3 Zuordnung des freien Typs (F-535, F-536, F-538)

`classifyBoatType`: Text in Vergleichsform (`foldBoatType`: nur A–Z klein wie SQLite `lower()`, Trennzeichen
`-/.,()_+'` zu Leerzeichen, mit Leerzeichen umrahmt), dann Muster der Reihe nach, erster Treffer gewinnt. Ein
Leerzeichen am Musterrand ist eine Wortgrenze („ kat “ trifft „Kat“, nicht „Katharina“). Reihenfolge: Klassennamen,
dann Werften/Wörter der Fahrtenyachten (Bavaria, Hanse, Dehler, Hallberg, „yacht“, „kielboot“ …), zuletzt die bloßen
Zahlen 420/470 – sonst würde „Hanse 470“ zum 470er.

Speichern (`resolveBoatClass`): Kommt `boatType` oder `boatClass` mit, wird die Klasse neu bestimmt – eine gültige
gewählte Klasse gilt, sonst (leer oder unbekannt) die aus dem Typ abgeleitete. Ändern nur anderer Felder lässt sie
stehen. Unbekannte Werte werden nie gespeichert (kein 400: das Formular schickt nur Werte der Liste, ältere Clients
schicken gar keinen).

Formular: Auswahl „Bootsklasse“ neben „Typ“. Erste Option „Automatisch: <abgeleitete Klasse>“ (bzw. „Automatisch aus
dem Typ“). Eine gespeicherte Klasse, die der Ableitung aus dem Typ entspricht, steht auf „Automatisch“ – sie folgt so
einem später geänderten Typ. Nur eine abweichende Klasse erscheint als feste Wahl.

## 34.4 Lösch- und Sichtbarkeitspfade

| Gespeichert | Entfernt auf welchem Weg |
| --- | --- |
| `boats.boat_class` | mit der Bootszeile: `removeBoat` (Eigner, Moderation), Konto (`purgeUser`, Cascade über `users`); Eigner-Wechsel und Zusammenführen ändern nur `owner_id`, die Klasse bleibt am Boot |

| Wer sieht es wo | Regel |
| --- | --- |
| Bootsseite, Formular | `boatClass` in `boatShape` – so sichtbar wie das Boot selbst (`canView`) |
| `/entdecken`, Boote | nur öffentliche Boote mit öffentlichem Eigner-Profil (F-72) dieser Klasse |
| `/entdecken`, Törns | nur über ihr öffentliches, nicht ausgeblendetes Boot dieser Klasse; Törns ohne Boot oder mit privatem Boot fallen beim Filter heraus |
| `/entdecken`, Segler | öffentliches Profil (F-72) mit einem eigenen öffentlichen Boot dieser Klasse |
| `/entdecken`, Häfen | mit einem öffentlichen Boot dieser Klasse (Eigner nicht gesperrt) |
| `/entdecken`, Vereine und Teams | öffentlich, mit einem zugeordneten öffentlichen Boot dieser Klasse und **für alle sichtbarer** Bootsliste (`members_visible = 'public'`) – sonst würde der Filter eine nur für Mitglieder sichtbare Bootsliste verraten |

## 34.5 Filter in Entdecken (F-537, F-539)

`GET /api/discover?klasse=<Klasse oder Gruppe>` – kombinierbar mit Suche (`q`, ?2) und Umgebung (`harbor`/`lat`,
?3); die Klassen gehen als JSON in ?4 (`json_each`). Unbekannte Werte filtern nicht (`boatClass: null` in der
Antwort), weil es öffentliche Daten sind und ein Tippfehler in der Adresse keine leere Seite zeigen soll. Die Antwort
nennt den wirksamen Filter (`boatClass`).

Oberfläche: nur auf der Seite `/entdecken` (Auswahl neben dem Suchfeld, „Alle Bootsklassen“, je Gruppe „Alle …“ und
die Klassen), Wahl wirkt sofort und steht in der Adresse (`/entdecken?klasse=folkeboot`, ohne neuen
Verlaufseintrag). Die Startseiten-Leiste bleibt ohne Filter (ein Einstieg, UX N1: „Alle entdecken“ führt zur Seite).
Ohne Treffer: „Keine öffentlichen Boote dieser Klasse.“ Die Bootskarte nennt den freien Typ, ohne ihn die Klasse.

## 34.6 Offen

- Klassen auf Bootsseite und Profil anzeigen bzw. verlinken (`/entdecken?klasse=…`) – erst, wenn der Filter genutzt wird.
- Liste nach dem Pilot mit echten Vereinen prüfen (fehlen z. B. Finn, O-Jolle, Zugvogel, Kielzugvogel?).
