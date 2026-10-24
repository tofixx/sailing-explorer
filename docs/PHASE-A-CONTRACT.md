# Phase A – API-Vertrag (Sichtbarkeit und Teilen-Links)

Arbeitsgrundlage für Worker und Oberfläche. Regeln: `docs/CONCEPT.md` (Entscheidungen E1–E5, Abschnitte 1–2),
gemeinsamer Code: `src/domain/visibility.ts`. Nicht Teil von Phase A: Fotos, Kommentare, Slugs/Weiterleitungen,
Melden, Kontingent-Umbau (`limits.ts`).

## Stufen

`visibility ∈ public | unlisted | private` für Törns, Boote und Profile. Neu: Standard `public`.
Nicht öffentliche Stufen nur mit laufendem Unterstützer-Status (`canChooseVisibility`), sonst
**402 `supporter_required`** mit deutscher Meldung. Eine schon gesetzte Stufe darf bleiben; auf `public` geht immer.

## Daten (Migration `0006_visibility.sql`)

- `shares` ohne SQL-`CHECK` neu bauen (Konzept 6.1, ohne Foto-/Kommentarspalten), `share_key TEXT` (NULL = Altbestand).
  Übernahme: `private` → `private`; `unlisted` + `listed=1` → `public`; `unlisted` + `listed=0` → `unlisted` (Schlüssel NULL).
  `listed` bleibt als veraltete Spalte, wird nicht mehr gelesen; beim Schreiben `listed = (visibility = 'public')`.
  Alle Indizes neu anlegen (auch die aus 0003–0005).
- `boats.share_key`, `profiles.share_key` (TEXT, NULL). Bestehende Boote und Profile behalten ihre Stufe (E5).

## Antworten

`shareShape` (und analog Boot/Profil für Eigentümer bzw. Boots-Admins):

```ts
visibility: 'public' | 'unlisted' | 'private'
shareKey: string | null   // nur für Eigentümer, sonst immer null
link: string | null       // nur für Eigentümer: sharePath(...) z. B. "/s/<id>" oder "/s/<id>/<key>"
```

`listed` entfällt aus den Antworten.

## Schlüssel

- 128 Bit (`randomId(22)` o. ä.), Klartext in D1, Vergleich mit `timingSafeEqual`.
- Wird beim ersten Wechsel auf `unlisted` erzeugt bzw. bei neuen `unlisted`-Objekten. Altbestand mit `share_key = NULL`
  ist weiter über `/s/<id>` erreichbar, bis der Schlüssel erneuert wird.
- `rotateKey: true` (PATCH/PUT) erzeugt einen neuen Schlüssel; alte Schlüssel-Links sind sofort 404.
- Öffentliche Objekte akzeptieren jeden Schlüssel (auch falschen) und ignorieren ihn.

## Zugriff

- Lesen eines `unlisted`-Objekts verlangt den Schlüssel: Header `X-Share-Key` (API), bei Bildern Query `?k=`.
  Eigentümer (bzw. Boots-Admins) brauchen keinen.
- Alles Unberechtigte (privat, falscher/fehlender Schlüssel, unbekannt): **identische 404**.
- Fehlversuche mit Schlüssel: neues Rate-Limit `LINK_LIMITER` (30 pro 60 s und IP), nur auf dem Fehlerpfad.

## Endpunkte (Änderungen)

| Methode | Pfad | Änderung |
|---|---|---|
| POST | `/api/shares` | Feld `visibility` (Standard `public`), E1-Prüfung |
| PATCH | `/api/shares/:id` | `visibility`, `rotateKey`; E1-Prüfung; Antwort `shareShape` |
| GET | `/api/shares/:id`, `/data`, `/image` | Schlüsselprüfung wie oben |
| POST/PATCH | `/api/boats`, `/api/boats/:id` | `visibility` (3 Stufen, Standard `public`), `rotateKey`, E1-Prüfung |
| GET | `/api/boats/:id` | Schlüsselprüfung; listet nur öffentliche Törns |
| PUT | `/api/me/profile` | `visibility` (3 Stufen, Standard `public`), `rotateKey`, E1-Prüfung |
| GET | `/api/profiles/:h` | Schlüsselprüfung; listet nur öffentliche Törns und öffentliche Boote |
| GET | `/api/discover` | nur `visibility = 'public'`; Törn unabhängig vom Profil; Autor nur mit öffentlichem Profil (sonst `sailor: null`), Boot nur wenn öffentlich |

## Seiten

`/s/:id/:key`, `/b/:id/:key`, `/u/:handle/:key` liefern die App (SPA) mit Meta wie die Varianten ohne Schlüssel,
aber nur bei gültigem Schlüssel; sonst neutrale Meta. `robots`: öffentliche Törns, Boote, Profile und `/entdecken`
`index`; alles andere `noindex`. `/api/*` sendet `X-Robots-Tag: noindex`.

## Oberfläche

- Gemeinsame Komponente `sx-visibility-picker` (3 Optionen mit `VISIBILITY_LABEL`/`VISIBILITY_HINT`). Für kostenlose
  Konten sind „Nur mit Link“ und „Nur ich“ gesperrt mit Hinweis „Für Unterstützer“ und Klick öffnet das Unterstützen-Angebot;
  eine bereits gesetzte Stufe bleibt wählbar.
- Teilen-Dialog: Standard „Öffentlich“, Ergebnis zeigt `link`. Konto/„Meine Törns“: Stufe ändern, Link kopieren,
  „Link erneuern“ (nur bei `unlisted`). Boot- und Profilseiten: Stufe und Link analog.
- Router: Schlüssel aus `/s/:id/:key` usw. lesen und als `X-Share-Key` (bzw. `?k=` für Bilder) mitsenden.
