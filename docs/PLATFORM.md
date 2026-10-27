# Plattform-Bewertung: vom Track-Viewer zur sozialen Segel-Plattform

Stand: Oktober 2026. Grundlage: `docs/PRINCIPLES.md`, `docs/REQUIREMENTS.md`,
`migrations/0001_init.sql`, `worker/*.ts`, `src/app.ts`. Ziel-Domain:
`segeln-potsdam.de` (früher `sailing.wollow.ski`). Preisangaben zu Cloudflare und Zahlungsanbietern sind
Richtwerte – vor der Umsetzung gegen die aktuellen Preisseiten prüfen.

## 1. Kurzbewertung

Die heutige App ist eine solide Basis. Sie ist aber als **Freigabe-Werkzeug für
eine Person** gebaut, nicht als Plattform. Das meiste davon lässt sich
weiterverwenden, das Datenmodell muss aber vor den ersten sozialen Funktionen
erweitert werden.

| Bereich | Was schon trägt | Lücke |
|---|---|---|
| Auth | Magic Link mit Hash-Tokens, Peek gegen Login-CSRF, Turnstile, Rate-Limits, 180-Tage-Session (`worker/auth.ts`) | Kein Profil, kein Handle, keine Altersangabe; Konto = E-Mail. Einladungen brauchen einen zweiten Token-Typ |
| Freigaben | `shares` + R2 `shares/<id>`, unratbare IDs, 404 statt 403 (F-35), Kontingent pro Konto (`LIMITS` in `worker/validate.ts`) | Eine Freigabe hat genau einen Besitzer, keine Teilnehmer, kein Boot, keine Etappen |
| Rechte | `visibleShare`/`ownedShare` in `worker/shares.ts`, sauber und einfach | Rechte stecken in zwei Hilfsfunktionen in einem Modul. Für Crew, Boot und Team braucht es eine zentrale Policy |
| Sichtbarkeit | `unlisted`, `private` | Es fehlen `crew`, `followers` und `public`. Der `CHECK`-Constraint in SQLite lässt sich nur mit Tabellen-Neubau ändern |
| Statistiken | Werden komplett im Browser berechnet (`src/domain/stats.ts`, `summary.ts`) | Der Server kennt weder Seemeilen noch Zeitraum noch Revier. Profile, Logbuch und Bestenlisten brauchen diese Werte in D1 |
| Kosten | Rechenarbeit im Client, Worker validiert nur Präfixe (CPU < 10 ms), R2 ohne Egress | Mailversand (Resend Free: ca. 3.000/Monat, 100/Tag) wird durch Einladungen und Benachrichtigungen zum ersten Engpass |
| Frontend | Saubere Schichten, Lit-Komponenten, Store | `src/app.ts` (ca. 640 Zeilen) verdrahtet alles und kennt nur die Modi „lokal“ und „Freigabe“. Für Profile und Feed fehlt ein Router |

**Fazit:** Auth, Speicherpfad, Sicherheitsniveau und das Kostenmodell lassen
sich übernehmen. Neu zu bauen sind das Objektmodell (Törn statt Freigabe), eine
zentrale Rechteprüfung, serverseitige Kennzahlen und clientseitiges Routing.

## 2. Domänenmodell

| Objekt | Bedeutung | Gehört |
|---|---|---|
| **Person** (`users` + `profiles`) | Konto mit öffentlichem Handle `/u/<handle>` | sich selbst |
| **Boot** (`boats`) | Schiff mit Profil `/b/<slug>`; Mitglieder mit Rolle Eigner, Miteigner, Skipper oder Crew | einer Person oder einem Team |
| **Team** (`orgs`) | Crew, Verein, Charter oder Schule, Profil `/t/<slug>` | Owner und Admins |
| **Törn** (`trips`) | Eine Reise, Kennzahlen in D1. Ersetzt `shares`, `/s/<id>` bleibt gültig | dem Ersteller (meist Skipper), optional Boot/Team zugeordnet |
| **Etappe** (`trip_legs`) | Ein R2-Blob (heutiger Share-Payload) mit Zeitraum und Kennzahlen | dem Törn |
| **Teilnahme** (`trip_participants`) | Person auf einem Törn: Rolle `skipper`, `co_skipper`, `crew`, `guest`; Status `invited`, `confirmed`, `declined`, `hidden`, `removed` | Rolle vergibt der Skipper, den Status bestimmt die Person selbst |
| **Sichtbarkeit** | Pro Objekt: `private`, `crew`, `followers`, `unlisted`, `public` | dem Objekt-Besitzer |

### Schema-Entwurf `0002_platform.sql`

Die Enum-Werte werden **bewusst nicht** per `CHECK` festgelegt, sondern in
`worker/validate.ts` geprüft. Sonst müsste jede neue Rolle oder Sichtbarkeit
die Tabelle neu bauen. Alle IDs sind `randomId()`, Zeiten sind ms-Epoch wie in
`0001`.

```sql
-- 0002_platform.sql
ALTER TABLE users ADD COLUMN age_confirmed_at INTEGER;   -- „Ich bin mindestens 16“
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';

CREATE TABLE profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  avatar_key    TEXT,                       -- R2 media/<id>.webp
  home_region   TEXT NOT NULL DEFAULT '',   -- grob, z. B. „Kieler Bucht“
  visibility    TEXT NOT NULL DEFAULT 'private',   -- private|followers|public
  show_stats    INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE orgs (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'crew',   -- crew|club|charter|school
  visibility  TEXT NOT NULL DEFAULT 'private',
  plan        TEXT NOT NULL DEFAULT 'free',
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE TABLE org_members (
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',  -- owner|admin|member
  status     TEXT NOT NULL DEFAULT 'invited', -- invited|active
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE boats (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  boat_type      TEXT NOT NULL DEFAULT '',   -- z. B. „Bavaria 34“, „J/70“
  length_m       REAL,
  sail_number    TEXT NOT NULL DEFAULT '',
  home_port      TEXT NOT NULL DEFAULT '',
  home_port_vis  TEXT NOT NULL DEFAULT 'private',  -- private|crew|region|public
  photo_key      TEXT,
  owner_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  org_id         TEXT REFERENCES orgs(id) ON DELETE SET NULL,
  visibility     TEXT NOT NULL DEFAULT 'private',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE TABLE boat_members (
  boat_id    TEXT NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'crew',    -- owner|co_owner|skipper|crew
  status     TEXT NOT NULL DEFAULT 'invited',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (boat_id, user_id)
);

CREATE TABLE trips (
  id            TEXT PRIMARY KEY,             -- = alte Share-ID, /s/<id> bleibt
  created_by    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  boat_id       TEXT REFERENCES boats(id) ON DELETE SET NULL,
  org_id        TEXT REFERENCES orgs(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  region        TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'unlisted', -- private|crew|followers|unlisted|public
  view          TEXT NOT NULL DEFAULT '',
  started_at    INTEGER,
  ended_at      INTEGER,
  distance_nm   REAL,
  duration_s    INTEGER,
  max_speed_kn  REAL,
  bbox          TEXT,                         -- grob gerundet, für Revier-Zuordnung
  stats_version INTEGER NOT NULL DEFAULT 1,   -- welche Client-Statistik gerechnet hat
  publish_after INTEGER,                      -- verzögerte Veröffentlichung
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX trips_creator ON trips(created_by, started_at DESC);
CREATE INDEX trips_boat    ON trips(boat_id, started_at DESC);
CREATE INDEX trips_public  ON trips(visibility, started_at DESC);

CREATE TABLE trip_legs (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  blob_key     TEXT NOT NULL,                 -- R2: shares/<id> (Altbestand) bzw. legs/<id>
  size_bytes   INTEGER NOT NULL,
  track_count  INTEGER NOT NULL,
  started_at   INTEGER,
  ended_at     INTEGER,
  distance_nm  REAL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX trip_legs_trip ON trip_legs(trip_id, seq);

CREATE TABLE trip_participants (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL, -- NULL: Gast ohne Konto / offene Einladung
  display_name TEXT NOT NULL DEFAULT '',      -- nur für Gäste ohne Konto
  role         TEXT NOT NULL DEFAULT 'crew',  -- skipper|co_skipper|crew|guest
  status       TEXT NOT NULL DEFAULT 'invited', -- invited|confirmed|declined|hidden|removed
  legs         TEXT NOT NULL DEFAULT '',      -- leer = alle Etappen, sonst Leg-IDs
  invited_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Logbuch-Snapshot: bleibt erhalten, auch wenn der Törn gelöscht wird
  log_date     INTEGER, log_nm REAL, log_boat TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (trip_id, user_id)
);
CREATE INDEX trip_participants_user ON trip_participants(user_id, status);

CREATE TABLE invitations (
  token_hash     TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,               -- trip|boat|org
  target_id      TEXT NOT NULL,
  participant_id TEXT,                        -- bei kind=trip
  email_hash     TEXT NOT NULL,               -- SHA-256(normalisierte Mail), keine Klartext-Mail
  role           TEXT NOT NULL,
  invited_by     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,            -- 14 Tage
  used_at        INTEGER
);

CREATE TABLE follows (
  follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind  TEXT NOT NULL,                 -- user|boat|org
  target_id    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',-- active|pending (private Profile)
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, target_kind, target_id)
);
CREATE INDEX follows_target ON follows(target_kind, target_id);

CREATE TABLE privacy_zones (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat       REAL NOT NULL, lon REAL NOT NULL, radius_m INTEGER NOT NULL DEFAULT 800,
  label     TEXT NOT NULL DEFAULT ''
);

-- Altbestand übernehmen: jede Freigabe wird ein Törn mit einer Etappe.
INSERT INTO trips (id, created_by, title, summary, visibility, view, size_bytes, created_at, updated_at)
  SELECT id, user_id, title, summary, visibility, view, size_bytes, created_at, updated_at FROM shares;
INSERT INTO trip_legs (id, trip_id, seq, blob_key, size_bytes, track_count, created_at)
  SELECT id, id, 0, 'shares/' || id, size_bytes, track_count, created_at FROM shares;
INSERT INTO trip_participants (id, trip_id, user_id, role, status, created_at, updated_at)
  SELECT id, id, user_id, 'skipper', 'confirmed', created_at, updated_at FROM shares;
-- shares bleibt bis 0003 als Fallback stehen und wird dann gelöscht.
```

Kommentare, Reaktionen, Meldungen und Abos (`comments`, `reactions`,
`reports`, `subscriptions`) kommen erst in den Phasen 3 und 4. Sie hängen nur an
`trips.id` bzw. `users.id` und erzwingen keinen Umbau.

Die alten Freigaben haben keine Kennzahlen (`distance_nm` ist `NULL`). Der
Client rechnet sie nach, wenn der Besitzer „Meine Törns“ öffnet, und schickt
sie per `PATCH`.

### Rechte-Matrix (Törn)

„Crew“ heißt: Teilnahme mit Status `confirmed`. Unsichtbare Objekte antworten
weiter mit 404 (F-35).

| Aktion | Ersteller/Skipper | Co-Skipper | Crew (bestätigt) | Eingeladen | Boots-Eigner | Follower | Jeder mit Link | Öffentlich |
|---|---|---|---|---|---|---|---|---|
| Törn sehen (`private`) | ja | ja | – | – | – | – | – | – |
| Törn sehen (`crew`) | ja | ja | ja | Vorschau | ja | – | – | – |
| Törn sehen (`followers`) | ja | ja | ja | Vorschau | ja | ja | – | – |
| Törn sehen (`unlisted`) | ja | ja | ja | ja | ja | ja | ja | – |
| Törn sehen (`public`) | ja | ja | ja | ja | ja | ja | ja | ja, auch Feed und Profil |
| Titel/Etappen bearbeiten | ja | ja | – | – | – | – | – | – |
| Sichtbarkeit ändern | ja | – | – | – | – | – | – | – |
| Crew einladen/entfernen | ja | einladen | – | – | – | – | – | – |
| Sich selbst ausblenden/austreten | – | ja | ja | ablehnen | – | – | – | – |
| Boot zuordnen | ja, wenn Boots-Mitglied | – | – | – | Zuordnung lösen | – | – | – |
| Törn löschen | ja | – | – | – | – | – | – | – |
| Kommentieren/Reagieren | ja | ja | ja | – | ja | ja, wenn sichtbar | – | angemeldet |

**Teilnehmernamen** sehen nur Personen, die den Törn sehen dürfen. Zusätzlich
gilt: Bei Törns, die nicht `public` sind, sehen nur Crew-Mitglieder die Namen
der anderen. Boot und Team regeln ihre Mitgliederlisten genauso über
`role`/`status`.

## 3. Einladungs-Flow und Datenschutz

**Flow.** Er nutzt dieselbe Technik wie der Magic Link: Token als Hash in D1,
Einlösen per POST aus der App, damit Mail-Scanner nichts verbrauchen.

1. Der Skipper öffnet den Törn, wählt „Crew einladen“ und gibt E-Mail und Rolle
   ein. Daraus entsteht eine `trip_participants`-Zeile mit `status='invited'`
   und `user_id=NULL` sowie eine `invitations`-Zeile mit `email_hash`. Die Mail
   geht an `/i#token=…`. Die Klartext-Mail wird nicht gespeichert.
2. Der Empfänger öffnet den Link. `POST /api/invites/peek` liefert eine
   Vorschau: Törn-Titel, Zeitraum, Boot und Name des Einladenden. Keine Karte,
   keine Namen anderer Crew-Mitglieder.
3. Der Empfänger wählt „Annehmen“. Ohne Konto wird es **im selben Schritt**
   angelegt, denn der Besitz der Mailadresse ist durch den Token belegt (wie bei
   `verifyLink`). Dazu kommen Session, Altersbestätigung (ab 16) und ein
   Handle-Vorschlag. Danach steht `user_id` fest und der Status auf
   `confirmed`, außerdem wird der Logbuch-Snapshot geschrieben.
4. „Ablehnen“ setzt den Status auf `declined`. Der Skipper sieht nur
   „abgelehnt“, nie die Mailadresse einer anderen Person.
5. Jederzeit möglich: **Ausblenden** (`hidden`): Der Törn bleibt im eigenen
   Logbuch, der Name verschwindet vom Törn. **Austreten** (`removed`): Der
   Eintrag wird gelöscht.

**Gäste ohne Konto** (z. B. Kinder oder Freunde ohne Mail) trägt der Skipper nur
als Vornamen oder Kürzel ein. Sie erscheinen nur für die Crew und nie
öffentlich.

**Datenschutz und DSGVO**

| Thema | Umsetzung |
|---|---|
| Rechtsgrundlage | Eigenes Konto: Vertrag (Art. 6 Abs. 1 lit. b). Namentliche Nennung auf fremden Törns: Einwilligung (lit. a), die durch das Annehmen erteilt und durch Ausblenden widerrufen wird |
| Heimathafen/Liegeplatz | `home_port_vis` ist standardmäßig `private`, öffentlich höchstens als Revier. Privatzonen (Standard 800 m) schneiden Trackpunkte **im Browser vor dem Upload** ab. Das neue Modul `src/domain/privacy.ts` muss Start und Ziel im Hafen sicher entfernen |
| Abwesenheit | Öffentliche Törns erscheinen erst nach `publish_after` (Standard: Törnende + 24 h). Live-Tracking ist bewusst kein Ziel |
| Fotos | Im Browser auf WebP neu kodieren. Das entfernt EXIF, also auch GPS-Daten und Kameradaten |
| Löschung | R2 und D1 sofort. Die Time-Travel-Backups von D1 laufen nach 30 Tagen aus, das gehört in die Datenschutzerklärung. Offene Einladungen werden nach 14 Tagen gelöscht |
| Export (Art. 20) | „Alle meine Daten“ als ZIP: GPX pro Etappe plus JSON mit Profil und Logbuch, im Browser aus den API-Daten zusammengesetzt |
| Minderjährige | Eigenes Konto ab 16 (Art. 8 DSGVO, Deutschland). Darunter nur Gast-Eintrag ohne Konto, nie öffentlich, kein Profil |
| Auftragsverarbeiter | Cloudflare, Resend, später Stripe: Auftragsverarbeitungsverträge, Datenschutzerklärung, Impressum (§ 5 DDG), sobald die Plattform öffentlich ist |
| Öffentliche Inhalte | Kommentare und öffentliche Profile machen die Plattform zum Hosting-Dienst im Sinne des DSA. Sie braucht dann einen Melde-Weg und eine Kontaktstelle |

## 4. Profile

| Inhalt | Öffentlich | Follower | Crew/Mitglieder | Nur Inhaber |
|---|---|---|---|---|
| **Person:** Handle, Anzeigename, Avatar, Bio | wenn `public` | ja | ja | ja |
| Seemeilen-Summe, Anzahl Törns, Reviere | wenn `show_stats` | ja | ja | ja |
| Törn-Liste | nur `public`-Törns | plus `followers` | plus gemeinsame Törns | alle |
| Rollen und Boote | Boote mit `public` | ja | ja | ja |
| Logbuch (Datum, sm, Rolle, Boot, Nachttörn) | – | – | – | ja, als PDF exportierbar |
| **Boot:** Name, Typ, Länge, Segelnummer, Foto | wenn `public` | ja | ja | ja |
| Heimathafen | höchstens Revier | höchstens Revier | laut `home_port_vis` | ja |
| Statistik: sm gesamt, Törns, Reviere, Saison | ja | ja | ja | ja |
| Crew-Liste | nur Personen mit öffentlichem Profil | wie öffentlich | alle bestätigten | alle inkl. Einladungen |
| **Team:** Name, Art, Boote, Saison-sm | wenn `public` | ja | ja | ja |
| Mitgliederliste, Team-Törns | – | – | ja | ja |

Statistiken werden **beim Schreiben** berechnet, nicht beim Lesen: Ein Profil
summiert `trips` über einen Index, gecacht wird nicht. Das reicht bis zu
mehreren tausend Törns pro Profil und hält D1-Reads niedrig. Reviere entstehen
aus dem gerundeten `bbox`-Mittelpunkt und einer kleinen statischen Liste
(`src/domain/regions.ts`). Eine Geo-Datenbank braucht es dafür nicht.

## 5. Soziale Funktionen nach Wert und Aufwand

| Prio | Funktion | Wert | Aufwand | Anmerkung |
|---|---|---|---|---|
| 1 | Crew auf Törns, Logbuch pro Person | hoch | mittel | Kern des Alleinstellungsmerkmals: Viele haben ihren eigenen Track nicht, der Skipper schon |
| 2 | Boot-Profile mit Törn-Liste | hoch | gering | Folgt direkt aus dem Schema |
| 3 | Logbuch-Export als PDF | hoch | gering | Im Browser erzeugen (z. B. `pdf-lib`, gebündelt, CSP-konform), kostet keine Worker-CPU |
| 4 | Folgen und Feed | mittel | mittel | Pull-Feed: `trips` der gefolgten Ziele per `IN`-Abfrage. Bei kleiner Nutzerzahl reicht D1 |
| 5 | Reaktionen („Mast- und Schotbruch“) | mittel | gering | Eine Tabelle, ein Zähler |
| 6 | Meilennachweis | mittel | mittel | PDF mit Skipper-Bestätigung (Klick, Zeitstempel, Prüf-URL). **Kein amtlicher Nachweis**, nur ergänzend zum unterschriebenen Formular |
| 7 | Kommentare | mittel | mittel | Erst wenn Melden und Löschen da sind (DSA) |
| 8 | Revier- und Hafen-Seiten | mittel | hoch | Brauchen Hafen-Daten (OpenStreetMap). Nur öffentliche Törns, aggregiert, verzögert |
| 9 | Bestenlisten | gering | mittel | Vorsicht: Sie belohnen Risiko und GPS-Ausreißer, außerdem gibt es Betrugsanreize. Wenn überhaupt: opt-in, nur Distanz pro Saison, nur innerhalb eines Teams oder Vereins, keine Top-Speed-Liste |

## 6. Monetarisierung

Grundsatz: **Keine Datenverkäufe, keine Werbe-Tracker.** Das passt zu den
Prinzipien und ist bei Positionsdaten auch ein Vertrauensargument. Speicher
eignet sich schlecht als Bezahlgrenze: R2 kostet ca. 0,015 $/GB-Monat, ein Törn
mit 300 KB kostet also praktisch nichts. Bezahlt werden sollten **Mehrwert und
Organisation**, nicht Bytes.

| Option | Preis (grob) | Zielgruppe | Bewertung |
|---|---|---|---|
| **Plus** (Person): Langzeit-Statistik, Saisonvergleich, Logbuch-PDF ohne Wasserzeichen, Meilennachweis, Privatzonen ohne Limit, hochauflösende Fotos | 3 €/Monat oder 29 €/Jahr | aktive Fahrtensegler | **gut**, einfach, passt zum Kern |
| **Team privat** (Crew, Eignergemeinschaft) | im Plus des Owners enthalten, bis 10 Personen | Eignergemeinschaften | gut als Plus-Argument |
| **Verein/Schule** | 79–199 €/Jahr | Vereine, Segelschulen | **gut**: Saison-Statistik, Mitglieder-Logbücher, Ausbildungsmeilen |
| **Charter-Flotte** | 15–30 €/Boot/Jahr | Charterfirmen | mittel: Vertrieb aufwendig, Flotten-Tracks bringen Mehrwert |
| **Regatta-Auswertung** | 49–199 €/Event | Ausrichter | mittel: braucht Startlinie, Bahnmarken und Zeitabgleich, also eigenes Feature-Set |
| **Print-Logbuch** | 25–45 €/Buch | Geschenk, Saison-Ende | nett, Print-on-Demand-Partner, kleine Marge |
| **Affiliate** (Charter, Ausrüstung) | Provision | alle | nur dezent und kontextbezogen, sonst Vertrauensverlust |
| Meilenbestätigung als Einzelkauf | 4,90 € | Scheinanwärter | ok, rechtlich klar als „ergänzend“ kennzeichnen |

**Technisch nötig**

- `worker/billing.ts`: Stripe Checkout und Kundenportal (gehostet, kein
  Kartenformular im eigenen Code) sowie einen Webhook mit
  Signaturprüfung über Web Crypto. Dazu eine Tabelle `subscriptions` (Konto
  oder Team, Plan, Status, `current_period_end`, Stripe-IDs). Alternative:
  Merchant of Record (Paddle, Lemon Squeezy). Höhere Gebühr (ca. 5 % + 0,50 $),
  dafür übernimmt der Anbieter EU-Umsatzsteuer und OSS. Für einen
  Einzelbetreiber oft die einfachere Wahl.
- **Quoten:** `LIMITS` wird `limitsFor(plan)` in `worker/validate.ts`. Die
  bestehende Kontingent-Prüfung in `createShare` bleibt und liest nur den Plan.
- **Feature-Flags:** `entitlements(user)` liefert ein Set wie
  `['stats_pro', 'pdf_clean', 'team_private']`. `/api/config` bzw.
  `/api/auth/me` gibt es an den Client weiter. Geprüft wird immer im Worker.

**Cloudflare-Kosten beim Wachstum** (Richtwerte)

| Ressource | Free | Engpass ab ca. | Lösung |
|---|---|---|---|
| Worker-Requests | 100.000/Tag | ca. 3.000–5.000 aktive Nutzer/Tag mit Feed | Workers Paid (5 $/Monat, 10 Mio./Monat inkl.) |
| Worker-CPU | 10 ms/Request | Stripe-Webhooks, Bild-Prüfung, PDF auf dem Server, serverseitige Statistik-Prüfung | Paid (30 s Standard). Rechenarbeit bleibt im Client |
| Mail | Resend Free ca. 3.000/Monat, 100/Tag | Einladungen und Benachrichtigungen ab ca. 50 aktiven Crews | Resend Pro (ca. 20 $/Monat) oder Cloudflare Email Sending (laut `worker/env.ts` nur mit Paid) |
| R2 | 10 GB, 1 Mio. Class A, 10 Mio. Class B/Monat | ca. 30.000 Törns à 300 KB plus Fotos | 0,015 $/GB, bei 100 GB ca. 1,50 $/Monat |
| D1 | 5 GB gesamt, 5 Mio. Rows read/Tag, 100.000 writes/Tag | Feed-Abfragen ohne Index; Größenlimit pro Datenbank | Indizes wie oben, Paid: 25 Mrd. Reads/Monat inklusive |

**Erwartung:** Bis etwa 1.000 aktive Nutzer reicht Free plus Resend Free.
**Workers Paid wird praktisch mit dem ersten Bezahlfeature nötig**, wegen
Webhooks, Mail-Volumen und Spielraum. 5 $/Monat sind mit zwei Plus-Abos
gedeckt.

## 7. Stufenplan

**Grundsatz:** Erst das Objektmodell, dann die Funktionen. Phase 1 legt alles
an, was später schwer zu ändern ist: IDs, Sichtbarkeitswerte, Törn statt
Freigabe, zentrale Policy und serverseitige Kennzahlen.

### Phase 1: Fundament (keine sichtbaren Social-Features)

1. **Migration `0002_platform.sql`** wie oben, inklusive Übernahme von `shares`
   nach `trips`, `trip_legs` und `trip_participants`. `/s/<id>` und
   `/api/shares/*` bleiben als Aliase in `worker/index.ts`.
2. **`worker/access.ts`:** `canView(viewer, trip)`, `canEdit`, `canInvite`,
   `roleOn(trip)` als reine Funktionen auf vorgeladenen Zeilen, mit Unit-Tests
   wie `validate.ts`. `visibleShare`/`ownedShare` und die OG-Logik in
   `sharePage` nutzen sie.
3. **`worker/trips.ts`** löst `shares.ts` ab: Upload pro Etappe nach
   `legs/<id>`, Kennzahlen als JSON-Header (`X-Trip-Stats`) mit
   Plausibilitätsgrenzen in `validate.ts` (z. B. Speed < 60 kn, Distanz zur
   Dauer passend).
4. **Client:** `src/domain/summary.ts` liefert ein Stats-Objekt für den Upload,
   `src/domain/privacy.ts` schneidet Privatzonen ab, `src/services/router.ts`
   kennt `/`, `/s/:id`, `/u/:handle`, `/b/:slug`, `/me`. `src/app.ts` wird in
   Seiten-Controller zerlegt.
5. **Profil-Grundlagen:** Handle wählen, Altersbestätigung, Kontoseite
   (`sx-account-dialog.ts` wird zur Seite). In `REQUIREMENTS.md` neue
   Anforderungen F-60 ff. ergänzen.

### Phase 2: Crews und Boote

1. `worker/invites.ts` (create, peek, accept, decline) und `inviteMail()` in
   `worker/mail.ts`. Route `/i` analog zu `/login#token`.
2. `worker/boats.ts` mit Mitgliedern, Foto-Upload nach R2 `media/` (WebP aus
   dem Browser, max. 500 KB).
3. Komponenten `sx-crew-list`, `sx-invite-dialog`, `sx-boat-card`, sowie
   Profilseiten Person und Boot mit Törn-Liste. Server-Metadaten für `/u/` und
   `/b/` nach dem Muster von `sharePage`.
4. Persönliches Logbuch aus `trip_participants` (Snapshots) und Export als PDF
   im Browser.
5. Etappen: mehrere Uploads an einen Törn hängen und Etappen umsortieren.

### Phase 3: Sozial

1. `follows` und Feed (`/api/feed`, Pull mit Cursor auf `started_at`) sowie
   `publish_after`.
2. Reaktionen und danach Kommentare mit `reports`-Tabelle, Melden-Button und
   Admin-Liste.
3. Benachrichtigungen zuerst in der App, Mail nur als Wochen-Digest (opt-in).
   Das schont das Mail-Kontingent.
4. Öffentliche Profile indexierbar (opt-in, `robots` je nach Sichtbarkeit),
   Teams (`orgs`) mit Profilseite.

### Phase 4: Monetarisierung

1. `worker/billing.ts`, `subscriptions`, `limitsFor(plan)`, Entitlements und
   der Wechsel auf Workers Paid.
2. Plus-Funktionen: Saison-Statistik, PDF ohne Wasserzeichen, Meilennachweis
   mit Skipper-Bestätigung.
3. Vereins- und Schul-Accounts (Team-Plan, Mitgliederverwaltung, Saisonbericht).
4. Optional danach: Regatta-Modus, Print-Logbuch, Affiliate.

**Abhängigkeiten, die zuerst stehen müssen:** Trip-ID gleich Share-ID (keine
toten Links), Enums ohne `CHECK`, `access.ts` vor der ersten neuen
Sichtbarkeit, Kennzahlen in D1 vor jedem Profil, Router vor jeder neuen Seite.

## 8. Offene Entscheidungen

1. **Wem gehört ein Törn?** Bleibt er beim Hochladenden (Vorschlag), oder kann
   der Boots-Eigner Törns seines Bootes übernehmen bzw. löschen?
2. **Wie öffentlich soll die Plattform sein?** Ist `unlisted` weiter der
   Standard und `public` ein bewusster Schritt (Vorschlag), oder soll von Anfang
   an ein öffentlicher Feed mit Moderationspflichten entstehen?
3. **Dürfen Crew-Mitglieder den Track ihres Törns herunterladen** (GPX), oder
   nur ansehen? Das berührt Daten des Skippers.
4. **Wer betreibt die Plattform rechtlich?** Privatperson, Kleinunternehmer
   oder GmbH entscheidet über Impressum, Umsatzsteuer und die Wahl zwischen
   Stripe und Merchant of Record.
5. **Ab wann gelten Kennzahlen als „bestätigt“?** Reichen Client-Werte mit
   Plausibilitätsprüfung, oder soll der Meilennachweis serverseitig nachrechnen
   (Workers Paid, Queue)?
6. **Wie stark soll die Plattform Vereine adressieren?** Vereine bringen das
   klarste Geschäftsmodell, verlangen aber Rollenverwaltung, Datenschutz für
   Jugendgruppen und Support. Gehört das in Phase 3 oder erst nach dem
   Plus-Abo?
