# 36. Moderation: Titelbilder absichern, Melde-Gewicht und Gründe (F-560 … F-569)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 36). Setzt die Punkte 1 und 4 aus Konzept 35.3 um (Roadmap
„Moderation 1“ und „Moderation 4“). Grundlage: Konzept 13.2 (Titelbilder), 4.4 (Melden, F-114), 18 (Admin-Bereich),
35.1 (Abgleich). Branch `feature/moderation-titelbilder`, Migration `0044_moderation_covers.sql`.

## 36.1 Architektur-Skizze

| Punkt | Entscheidung |
| --- | --- |
| **Datenmodell** | Kein neues Objekt. `covers.held_until` (ms, NULL = öffentlich): neue Konten bis Tag 7 ihres Kontos, offene Bild-Meldung unbefristet (`REPORT_HOLD`), von neuen Konten 72 h. `covers.kept_ver` und `photos.kept_at`: von der Moderation behalten (F-568). Neue Tabelle `cover_log (user_id, created_at)` für das Tageslimit (wie `photo_log`). `reports.weight` (0/1) für die Schwelle. Alles additiv, Altbestand: Titelbilder öffentlich, Meldungen Gewicht 1 |
| **Neues Konto** | Eine reine Regel `isNewAccount` (`src/domain/moderation.ts`): Konto jünger als 7 Tage und kein laufender Unterstützer; Admins (`ADMIN_USER_IDS`) nie. Der Worker liest Alter und Status in `newAccountUntil` (`worker/moderation.ts`) und nutzt es an genau zwei Stellen: Titelbild-Upload und Melde-Gewicht |
| **Sichtbarkeit** | Öffentlich ist ein Titelbild nur, wenn `held_until` leer oder vorbei ist: SQL-Baustein `coverShownSql` (`worker/visible-sql.ts`) im `JOIN` aller Listen (Entdecken, Neuigkeiten/Stream, Gruppenliste), reine Regel `coverShown` (`src/domain/cover.ts`) in `pageCover` und `getCover`. Verwalter des Objekts und Admins sehen es trotzdem (Seite, Bilddatei), mit `coverHeldUntil` für den Hinweis |
| **Caches** | Bilddatei eines zurückgehaltenen Titelbilds: nur Verwalter/Admins, `private, no-cache`, für andere 404 (nie `public`). Öffentliche Titelbilder nur 5 min cachebar (`public, max-age=300`), damit ein gemeldetes oder entferntes Bild bald aus Browser- und Edge-Caches verschwindet. Seiten-Antworten sind `no-store`. Die öffentlich gecachten Listen (Entdecken 60 s, Community-Stream 60 s) enthalten zurückgehaltene Bilder nie, weil der `JOIN` sie für alle ausfiltert – auch für Verwalter |
| **Zähler/Kontingente** | 5 neue Titelbilder je Konto in 24 h über alle Objekte (`COVER_LIMITS.perDay`, 429 `cover_quota`); Prüfen und Eintragen atomar (`INSERT … SELECT … WHERE COUNT < n`) vor dem Speichern. Ausschnitt ändern und Entfernen zählen nicht. Speicherzähler unverändert |
| **Melden** | Gewicht 0 für neue Konten: sie zählen nicht zu den 3 Konten der Schwelle (F-114). Bild-Gründe `depicted` („Ich bin abgebildet“) und neu `minors` („Kinder abgebildet“) gibt es nur für Fotos und für Profil, Boot, Gruppe mit sichtbarem Titelbild; sie blenden sofort **nur das Bild** aus (Foto: `hidden_at`, Titelbild: `held_until`), das Objekt erst über die Schwelle. Neue Konten: höchstens 3 Bild-Meldungen am Tag, beim Titelbild hält ihre Meldung nur 72 h (F-569). Ein von der Moderation behaltenes Bild wird durch neue Bild-Meldungen nicht erneut ausgeblendet (F-568) |
| **Admin** | Meldungs-Liste zeigt bei Profil, Boot, Gruppe das Titelbild als Vorschau; Hinweis „Meldende:r ist neues Konto“; neue Entscheidung „Nur Titelbild entfernen“ mit Bestätigung (`action: 'cover'`, Protokoll `report_cover`; erst das Bild löschen, dann die Meldungen schließen). „Behalten“ gibt das Bild frei und merkt die Version als geprüft; „Ausblenden“ und Sperren (K 18) heben die unbefristete Melde-Sperre auf (das Objekt ist dann ohnehin weg) |
| **Benachrichtigungen, Einbettungen, Zusammenführen** | keine neuen Benachrichtigungen; Link-Vorschau nutzt keine Titelbilder; Konten zusammenführen hängt `cover_log` um |
| **Komponenten** | `sx-cover` (Hinweiszeile für Verwalter, `heldUntil`), `sx-report-dialog` (Gründe je Ziel aus `reportReasonsFor`), `ReportTarget.image`, `sx-admin-reports` (Vorschau, Knopf), `controllers/community.ts`. Keine neuen Seiten; 375 px geprüft |
| **Parallele Arbeit** | `feature/moderation-admin` (Moderation 3, 6, 8) ändert ebenfalls die Admin-Meldungsansicht (`sx-admin-reports`, `reports.ts`). Hier nur ein zusätzlicher Knopf und die Vorschau – beim Merge nachrangig zusammenführen |

### 36.1.1 Gespeichert → entfernt

| Gespeichert | entfernt durch |
| --- | --- |
| `covers.held_until` | mit der Zeile (`removeCoverOf`: Löschen von Profil, Boot, Gruppe, Konto, Entscheidung „Nur Titelbild entfernen“); NULL bei Admin-„Behalten“, „Ausblenden“ und Sperren; läuft von selbst ab (Zeitpunkt) |
| `covers.kept_ver`, `photos.kept_at` | mit der Zeile; `kept_ver` beim Austausch des Bilds (neue Version, Spalte geleert) |
| `cover_log` | nachts nach 2 Tagen (`coverLogCleanup`); Konto löschen (`purgeUser`, Cascade); Zusammenführen (`mergeUsers`: umhängen) |
| `reports.weight` | mit der Meldung (unverändert: Entscheidung, 180 Tage, Ziel gelöscht) |

### 36.1.2 Wer sieht ein zurückgehaltenes Titelbild

| Wo | Gäste, andere Konten | Verwalter des Objekts | Admins |
| --- | --- | --- | --- |
| Seite (Profil, Boot, Gruppe) | nein (`cover: null`) | ja, mit Hinweis | ja, mit Hinweis |
| Bilddatei `/api/covers/…` | 404 | ja, `private, no-cache` | ja, `private, no-cache` |
| Entdecken, Neuigkeiten, Gruppenliste | nein | nein | nein |
| Meldungs-Liste | – | – | ja (Vorschau) |

## 36.2 Entscheidungen (ohne Rückfrage getroffen, 03.11.2026)

1. **Zurückhalten auf Zeit statt Freigabe-Liste.** Konzept 35 empfahl eine Admin-Liste „Zur Prüfung“. Gebaut ist die
   einfachere, robuste Variante aus dem Auftrag: Das Titelbild eines neuen Kontos wird öffentlich, sobald das Konto 7
   Tage alt ist (Frage 35.4 Nr. 2: 7 Tage, Unterstützer ausgenommen). Kein Admin muss etwas tun, kein Bild bleibt
   hängen, wenn niemand moderiert (35.4 Nr. 3). Wegwerfkonten müssen eine Woche überleben; wer in der Zeit auffällt,
   wird gesperrt (K 18). Der Zeitpunkt wird beim Upload festgeschrieben (`held_until` = Kontoanlage + 7 Tage), damit
   Listen ohne Konto-Abfrage filtern können. Wird jemand während der Frist Unterstützer, gilt die Frist für bereits
   hochgeladene Bilder weiter; ein neues Bild ist sofort öffentlich.
2. **Bezug ist das hochladende Konto**, nicht das Objekt: Ein neues Admin-Konto einer alten Gruppe wartet ebenso.
3. **Häfen haben keine Titelbilder** (`CoverKind` = `u`, `b`, `g`); nichts zu tun.
4. **Melde-Sperre bleibt beim Austausch:** Liegt eine offene Bild-Meldung zum Objekt vor, wird auch ein neues
   Titelbild zurückgehalten, bis ein Admin entscheidet – sonst ließe sich die Sperre durch Löschen und neu Hochladen
   umgehen.
5. **Bild-Gründe wirken sofort, auch von neuen Konten – aber begrenzt (nach Review).** Das Gewicht 0 gilt nur für die
   Schwelle (Konzept 35.1). Wer sich auf einem Bild erkennt oder Kinder sieht, legt oft erst dafür ein Konto an;
   ausgeblendet wird nur das Bild, nicht das Objekt. Damit Wegwerfkonten nichts dauerhaft blockieren: höchstens 3
   Bild-Meldungen am Tag je neuem Konto (429 `report_quota`), und beim Titelbild endet ihre Zurückhaltung nach 72 h
   ohne Entscheidung von selbst (F-569); meldet ein älteres Konto, gilt unbefristet. Fotos bleiben bis zur
   Entscheidung ausgeblendet (wie vor diesem Abschnitt bei „Ich bin abgebildet“) – sie hätten sonst einen nächtlichen
   Rückweg gebraucht. Admins sehen „Meldende:r ist neues Konto“.
6. **„Ich bin abgebildet“ heißt nicht mehr „… bzw. genannt“.** Für Texte gibt es den Grund nicht mehr (Auftrag: nur
   Bilder); wer in einem Text genannt wird, wählt „Beleidigend“, „Rechtswidrig“ oder „Sonstiges“, ausgeblendet wird
   dann über die Schwelle. Alte offene Meldungen mit `depicted` auf Texten bleiben in der Admin-Liste lesbar.
7. **Admin-Vorschau nicht unscharf.** Die Liste zeigt das gemeldete Titelbild klein wie bei Fotos; eine unscharfe
   Vorschau gehört zur Freigabe-Liste, die nicht gebaut ist.
8. **Tageslimit 5 je Konto** (Konzept 35.1), gleitend 24 h, für alle Konten gleich; Admins eingeschlossen.
9. **Geprüft ist geprüft (nach Review, F-568).** „Behalten“ merkt die Titelbild-Version (`kept_ver`) bzw. das Foto
   (`kept_at`); neue Bild-Meldungen darauf landen nur in der Liste. Ein neues Titelbild hat eine neue Version und ist
   wieder ungeprüft. „Behalten“ beendet auch die 7-Tage-Frist eines neuen Kontos – ein Admin hat das Bild gesehen.
10. **Kurzer Cache für Titelbilder (nach Review):** 5 min statt 1 Tag, weil Melden und Entfernen sonst bis zu einem
    Tag in Caches nachwirken; die Adresse wechselt ohnehin bei jedem Austausch.
11. **Alte offene Meldungen** mit „Ich bin abgebildet“ aus der Zeit vor Migration 0044 (Gewicht 1) halten ein neu
    hochgeladenes Titelbild desselben Objekts ebenfalls zurück, bis ein Admin entscheidet – gewollt, sie betreffen
    dasselbe Objekt; die Admin-Liste zeigt sie.
12. **Gleichzeitiges Hochladen und Melden:** Steht beim Speichern schon eine unbefristete Melde-Sperre in der Zeile,
    bleibt sie (`CASE` im Upsert); die übrige Zurückhaltung berechnet `holdFor` aus den offenen Meldungen.
