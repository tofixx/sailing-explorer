-- Kartenstil als Profil-Standard (Farbverlauf und Wind-/Wellen-Symbole, src/domain/map-style.ts).
-- NULL = kein Standard gewählt („Klassisch“). Gültige Werte prüft worker/comments.ts (patchSettings), kein CHECK.
-- Liegt in der users-Zeile und verschwindet mit dem Konto.
ALTER TABLE users ADD COLUMN map_style TEXT;
