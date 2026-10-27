-- Ausschnitt von Titelbildern (Konzept 13.2): vertikale Fokus-Position in Prozent (0 = oben, 100 = unten), angezeigt
-- per object-position. Bestehende Titelbilder sind schon 3:1 zugeschnitten – mittig ändert an ihnen nichts.
ALTER TABLE covers ADD COLUMN focus_y INTEGER NOT NULL DEFAULT 50;
