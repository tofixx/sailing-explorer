-- Vorschlag der Plattform „Fahrtensegeln – Brandenburger Seglerverband e. V.“ (Konzept 39, F-625 … F-632): nach der
-- Ausschreibung des BSV, keine offizielle Wertung (`SCORING_NOTE`). Rechnet in km (`unit`), Optimist doppelt
-- (`boatClass`, `classFactor`), gegen den Strom 3 statt 1 je km (`upstream` = Zuschlag 2), unter Motor 0,2 je km,
-- Langtörn über 200 km 20 Punkte und je weitere 100 km 10, Schleuse 4, Mast legen und stellen 2; Trailertransport,
-- Gemeinschaftsfahrt, Jugendtraining und Regatta-Funktion als Posten. Nur ein Datensatz, kein Schema: feste ID,
-- `OR IGNORE` (wiederholbar). Admins können ihn wie jeden Vorschlag ändern oder löschen; Vereine übernehmen ihn.
INSERT OR IGNORE INTO scoring_templates (id, group_id, name, rules, source_id, list_weight, created_at, updated_at) VALUES
  ('bsvfahrten', NULL, 'Fahrtensegeln – Brandenburger Seglerverband e. V.',
   '{"unit":"km","nmSail":1,"nmMotor":0.2,"upstream":2,"inland":1,"coastal":1,"offshore":1,"tidal":0,"boatClass":"optimist","classFactor":2,"skipper":1,"co":1,"crew":1,"guest":1,"nightH":0,"day":0,"lock":4,"bridge":0,"mast":2,"regatta":0,"regattaPlace":0,"longFrom":200,"longBonus":20,"longStep":100,"longStepBonus":10,"cap":0,"items":[{"name":"Trailertransport (ab 150 km)","points":50,"cap":0},{"name":"Gemeinschaftsfahrt je Tag (ab 5 Booten)","points":20,"cap":0},{"name":"Kinder-/Jugendtraining (ab 2 h)","points":25,"cap":0},{"name":"Regatta-Funktion je Tag (ab 5 h)","points":25,"cap":0}]}',
   NULL, NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
