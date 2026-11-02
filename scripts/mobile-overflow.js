// Prüft die offene Seite auf seitlichen Überlauf (CLAUDE.md Prüfpunkt 8, Auslieferung Schritt 3).
// Im Browser bei 375 px Breite ausführen: in die Konsole kopieren oder per `javascript_tool` (Inhalt als Ausdruck).
// Meldet sichtbare Elemente, deren rechte Kante über `innerWidth` hinausgeht oder die breiter als der Viewport sind,
// sowie den Überlauf des Dokuments (`scrollWidth > innerWidth`). Durchsucht auch Shadow-DOMs (Lit).
// Übersprungen wird alles in einem gewollten Scroll-Bereich: Vorfahr mit `data-scroll-x`, nur waagerecht scrollend
// (`overflow-x: auto/scroll` ohne `overflow-y: auto/scroll`) oder die Leaflet-Karte (Kacheln liegen absichtlich außerhalb). Abschneidende Container (`overflow-x: hidden/clip`,
// z. B. `.app`) zählen nicht als Ausnahme: abgeschnittener Inhalt ist genau der Fehler, den die Prüfung finden soll.
// Ergebnis: { ok, viewport, documentWidth, findings: [{ selector, width, right, count }] }.
(() => {
  const vw = window.innerWidth;
  const tol = 1; // Rundung von Subpixeln
  const findings = [];

  const scrollsX = (el) => {
    if (el.hasAttribute('data-scroll-x') || el.classList.contains('leaflet-container')) return true;
    // Ein senkrechter Scroll-Bereich (`overflow-y: auto`) hat berechnet auch `overflow-x: auto` – der zählt nicht.
    const { overflowX: ox, overflowY: oy } = getComputedStyle(el);
    return (ox === 'auto' || ox === 'scroll') && oy !== 'auto' && oy !== 'scroll';
  };
  const label = (el) => {
    let s = el.localName;
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (cls.length) s += `.${cls.join('.')}`;
    return s;
  };
  const path = (el) => {
    const parts = [];
    for (let n = el; n; ) {
      parts.unshift(label(n));
      if (n.parentElement) n = n.parentElement;
      else {
        const host = n.getRootNode && n.getRootNode().host;
        if (!host) break;
        parts.unshift('⟨shadow⟩');
        n = host;
      }
    }
    return parts.filter((p) => p !== 'html' && p !== 'body').join(' > ').replace(/ > ⟨shadow⟩ > /g, ' ⟩ ');
  };

  // Tiefensuche über Light- und Shadow-DOM; `inScroll` = Vorfahr ist ein gewollter Scroll-Bereich.
  const walk = (root, inScroll) => {
    for (const el of root.children) visit(el, inScroll);
  };
  const visit = (el, inScroll) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0;
    if (!inScroll && visible && (r.right > vw + tol || r.width > vw + tol)) {
      findings.push({ selector: path(el), width: Math.round(r.width), right: Math.round(r.right) });
    }
    const scroll = inScroll || scrollsX(el);
    if (el.shadowRoot) walk(el.shadowRoot, scroll);
    walk(el, scroll);
  };
  walk(document.body, false);

  // Nur die innersten Verursacher melden: ein Eltern-Element, das nur wegen eines Kindes übersteht, fällt weg.
  // Gleiche Selektoren (z. B. Listeneinträge) zusammenfassen.
  const bySelector = new Map();
  for (const f of findings) {
    if (findings.some((g) => g !== f && g.selector.startsWith(`${f.selector} `))) continue;
    const seen = bySelector.get(f.selector);
    if (seen) seen.count++;
    else bySelector.set(f.selector, { ...f, count: 1 });
  }
  const leaves = [...bySelector.values()];
  const documentWidth = document.documentElement.scrollWidth;
  return { ok: documentWidth <= vw && leaves.length === 0, viewport: vw, documentWidth, findings: leaves };
})();
