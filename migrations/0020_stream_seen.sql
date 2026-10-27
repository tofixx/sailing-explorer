-- Community-Badge (Konzept 12.10, F-220 … F-222): bis wann (ms) der persönliche Stream gelesen ist. Ein Wert je Konto,
-- geräteübergreifend; NULL = noch nie geöffnet (wird beim ersten Zählen auf „jetzt“ gesetzt). Liegt in der Konto-Zeile
-- und verschwindet mit ihr (ein Löschpfad, Konto löschen).
ALTER TABLE users ADD COLUMN stream_seen_at INTEGER;
