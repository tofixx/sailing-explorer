-- Beiträge als Grundtyp, Phase 3 (Konzept 21.13, B1, F-403): Anpinnen in jedem Verlauf, in dem ein Beitrag erscheint;
-- wirkt nur dort, ohne Obergrenze und ohne Ablauf. Fällt per ON DELETE CASCADE mit dem Beitrag; Verlauf gelöscht →
-- Anweisung je Art (worker/activity.ts, kein Fremdschlüssel auf channel_id). Ohne Konto-ID (nichts Persönliches).
CREATE TABLE channel_pins (
  channel_kind TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_kind, channel_id, post_id)
);
CREATE INDEX channel_pins_post ON channel_pins(post_id);
