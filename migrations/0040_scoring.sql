-- Wertung und Jahresbericht (Konzept 32, Phase 9, F-413, F-414, F-500 … F-509): Wertungsvorlagen als geprüfter Baukasten
-- (Regeln als JSON, geprüft von `parseRules` in src/domain/scoring.ts – nie ein Formeltext). `group_id` leer = Vorschlag
-- der Plattform (pflegen Plattform-Admins), sonst Vorlage eines Vereins (fällt mit dem Verein per Cascade). `source_id`
-- nennt die übernommene Vorlage ohne Fremdschlüssel: die Kopie bleibt, wenn das Original gelöscht wird.
-- `list_weight`: nur Vereinsvorlagen – leer = zählt nicht für die Vereinsliste, sonst der Faktor (Gewichtung, 32.4).
-- Keine Konto-ID: Vorlagen gehören dem Verein bzw. der Plattform, nicht einer Person.
CREATE TABLE scoring_templates (
  id          TEXT PRIMARY KEY,
  group_id    TEXT REFERENCES groups(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  rules       TEXT NOT NULL,
  source_id   TEXT,
  list_weight REAL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX scoring_templates_group ON scoring_templates(group_id);

-- Opt-in je Mitgliedschaft (F-414): Zeitpunkt der Zustimmung zur Vereinsliste, leer = nimmt nicht teil. Fällt mit der
-- Mitgliedschaft (Austritt, Entfernen, Konto, Verein gelöscht).
ALTER TABLE group_members ADD COLUMN scoring_opt_in_at INTEGER;

-- Zwei Vorschläge der Plattform zum Start (Admins können sie ändern oder löschen; Vereinskopien bleiben).
INSERT INTO scoring_templates (id, group_id, name, rules, source_id, list_weight, created_at, updated_at) VALUES
  ('fahrtenpreis', NULL, 'Fahrtenpreis klassisch',
   '{"nmSail":1,"nmMotor":0.3,"inland":1,"coastal":1.2,"offshore":1.5,"tidal":0.2,"skipper":1.2,"co":1.1,"crew":1,"guest":0.5,"nightH":2,"day":5,"lock":0,"bridge":0,"mast":0,"regatta":10,"regattaPlace":1,"cap":500,"items":[]}',
   NULL, NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('binnen', NULL, 'Binnen-Wanderfahrt',
   '{"nmSail":1,"nmMotor":0.5,"inland":1,"coastal":1,"offshore":1,"tidal":0,"skipper":1,"co":1,"crew":1,"guest":1,"nightH":0,"day":5,"lock":1,"bridge":0,"mast":5,"regatta":0,"regattaPlace":0,"cap":0,"items":[{"name":"Training","points":5,"cap":0},{"name":"Arbeitsdienst","points":10,"cap":0}]}',
   NULL, NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
