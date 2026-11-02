# 26. Diagramm-Großansicht: Zoomen und Verschieben (F-430, 02.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 26).

Wunsch des Betreibers: in der Großansicht der Verlaufs-Diagramme per Scrollen zoomen und verschieben. Das kleine
Diagramm bleibt unverändert.

| Punkt | Entscheidung |
| --- | --- |
| Ein Mechanismus | Verschieben ist das native seitliche Scrollen von `.scroll` (Scrollleiste, Trackpad-Wischen, Umschalt + Rad bleiben). Zoom ändert nur die Breite des Scrollinhalts; Ziehen, Pfeiltasten und Pinch setzen `scrollLeft`. Kein zweites Scrollsystem. |
| Canvas-Grenze | Die Canvas sind so breit wie der sichtbare Bereich (`position: sticky`) und zeichnen nur den Ausschnitt ab `scrollLeft` (nur die sichtbaren Punkte). Die Scrollbreite ist auf 4 Mio. px gedeckelt (Browser kappen Elementbreiten bei etwa 17–33 Mio. px). |
| Mausrad | Senkrechtes Rad zoomt um den Zeiger – der Betreiber wünscht „Scrollen für Zoom“, der Dialog braucht am Desktop kaum senkrechtes Scrollen, und waagerechtes Scrollen bleibt fürs Verschieben frei. Strg/⌘ + Rad und Trackpad-Pinch (wheel + ctrlKey) zoomen ebenso, ohne dass der Browser die Seite zoomt. An der Zoomgrenze geht das Rad ohne Strg an den Dialog weiter. |
| Touch | `touch-action: none` nur auf der Zeichenfläche: kurzer Tipp = Fadenkreuz, Ziehen = verschieben, zwei Finger = zoomen um die Fingermitte, Doppeltipp = Zoom ×2 – auf einem Foto-Tick öffnet er nur das Foto. Außerhalb scrollt die Seite normal. |
| Zeitpunkt von außen | Kommt der Hover-Zeitpunkt von Karte oder Liste und liegt außerhalb des Ausschnitts, scrollt die Großansicht sanft dorthin (`scrollTo` mit `smooth`, mittig), der Zoom bleibt. Eigene Tipps liegen immer im Ausschnitt. |
| Grenzen | Untergrenze „ganzer Zeitraum passt“, Obergrenze etwa 5 Minuten im Bild. Anfangsansicht wie bisher mindestens 28 px je Stunde (auf den gewählten Zeitpunkt zentriert); „Ganzer Zeitraum“ in der Titelzeile, sobald weiter hineingezoomt ist. |
| Schnitt | Reine Regeln in `src/domain/chart-view.ts` (Ausschnitt, Grenzen, Zoom um Punkt, Pinch, Achsenschritt, Ticks); `sx-time-chart` setzt nur Ereignisse um und meldet `sx-chart-zoom` an die Titelzeile. Achsenschritt Tage/Stunden/30/15/5 Minuten auf runden Ortszeiten – jeder Strich neu auf die Ortszeit gerundet, damit die Zeitumstellung keine schiefen Uhrzeiten erzeugt –, Pausen ausgespart. Die Textalternative wird nur bei Datenänderung neu berechnet. |
| Mobil | 375 px: Zeitpunkt in der Titelzeile in eigener Zeile, nichts ragt heraus (`scripts/mobile-overflow.js`), Scrollbereich mit `data-scroll-x`. Höhe `min(340px, 55dvh)`, damit der Dialog auch im Querformat bedienbar bleibt; gezeichnet wird mit der gemessenen Höhe. |
