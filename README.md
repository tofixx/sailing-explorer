<p align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="" />
</p>

<h1 align="center">Sail Explorer</h1>

<p align="center">
  Segeltörns aus GPX-Dateien auf der Seekarte – mit Fahrt, Wind, Böen und Wellen für genau diese Zeit.<br />
  Teilen per Link, Profile für Segler und Boote.<br />
  <a href="https://sailing.wollow.ski"><b>sailing.wollow.ski</b></a>
</p>

---

## Was es kann

| | |
|---|---|
| **Track auswerten** | GPX per Dateiauswahl oder Drag & Drop. Distanz, Fahrzeit, Ø/Max-Fahrt; GPS-Ausreißer werden robust (Median + MAD) erkannt und markiert. |
| **Wetter zur Fahrt** | Wind, Böen (Open-Meteo Forecast/Archiv) und Seegang (Marine-Modell) stündlich für Zeitraum und Gebiet – an jeden Trackpunkt gehängt. |
| **Karte** | Seekarte (Esri Ocean) bei Tag, Nachtkarte im Dark Mode, OpenSeaMap-Seezeichen, EMODnet-Wassertiefe. Track eingefärbt nach Fahrt, Wind, Böen oder Wellen. Eigene Symbole: Wind-Badges mit Knotenzahl, Wellen-Chevrons, Start-/Ziel-Pins. |
| **Alles verknüpft** | Hover (oder Tippen) auf Karte, Diagramm oder Max-Kennzahl zeigt denselben Moment überall. |
| **Gast-Sitzung** | Ohne Anmeldung bleibt alles im Browser (IndexedDB) und ist beim nächsten Besuch wieder da. |
| **Teilen** | Anmeldung per Magic Link, dann Upload. Links `/s/<id>` öffnen eine vollständig interaktive Ansicht; Einfärbung und Ebenen stehen in der URL. Sichtbarkeit: öffentlich (auf Profil), mit Link, nur ich. |
| **Als Bild teilen** | Übersichtsbild im Quer- oder Quadratformat mit wählbaren Angaben (Start/Ziel, Dauer, Fahrt, Wind, Wellen …) am Rand – herunterladen oder über das Teilen-Menü des Geräts; dient auch als Link-Vorschau. |
| **Profile & Boote** | Profilseite `/u/<name>` und Bootsseiten `/b/<id>` mit Seemeilen und Törns. Boote haben einen Eigner (weitere Admins vorgesehen). |
| **Unterstützen** | 3 gespeicherte Törns pro Konto sind kostenlos. Wer mehr speichern will, gibt einmal einen Kaffee oder ein Bier aus (Stripe) – und hilft so, Server und Karten zu bezahlen. |
| **Läuft überall** | Hell/Dunkel, Tastatur, Screenreader-Texte, mobil als Bottom-Sheet. |

## Schnellstart

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

Die App läuft dann auf <http://localhost:5173> **und im LAN** (die Netzwerk-Adresse steht in der Konsole, z. B. `http://192.168.1.20:5173`) – so lässt sie sich während der Entwicklung direkt auf dem Handy testen, inklusive Login. Lokal werden keine Mails verschickt: der Magic Link erscheint im Anmeldedialog und im Terminal.

> Windows: Falls das Handy die Seite nicht erreicht, Port 5173 in der Windows-Firewall für private Netzwerke freigeben.

Lokale Einstellungen stehen in `.dev.vars` (Vorlage: `.dev.vars.example`).

## Prüfen

```bash
npm run check
```

Übersichtsbild ohne Browser rendern (zum Prüfen des Layouts):

```bash
npx tsx scripts/render-share-image.ts square share.png
```

führt Typprüfung (App + Worker), alle Tests und den Build aus. Die Tests sind nach den funktionalen Anforderungen benannt (`[F-33] …`, siehe [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)); Worker-Tests laufen gegen echte lokale D1/R2-Bindings.

## Architektur

```mermaid
flowchart LR
  subgraph Browser
    UI[Lit-Komponenten<br/>src/components] --> APP[app.ts + controllers/]
    APP --> STORE[(Store)]
    APP --> MAP[map/ – Leaflet-Adapter]
    APP --> DOMAIN[domain/ – GPX, Statistik,<br/>Ausreißer, Wetter-Zuordnung]
    APP --> IDB[(IndexedDB<br/>Gast-Sitzung)]
  end
  APP -- Wetter --> OM[Open-Meteo]
  APP -- /api --> W[Cloudflare Worker<br/>worker/]
  W --> D1[(D1: Nutzer, Sessions,<br/>Profile, Boote, Freigaben,<br/>Unterstützungen)]
  STRIPE[Stripe Payment Links] -- Webhook --> W
  W --> R2[(R2: GPX gzip)]
  W --> MAIL[Resend / CF Email]
```

- **Schichten:** `domain` (rein, getestet) → `services` (Netz, Store) → `map`/`components` (Darstellung) → `app.ts`/`controllers` (Verdrahtung).
- **Rechnen im Browser:** Der Worker speichert und liefert nur aus – das hält ihn im Free-Tier (10 ms CPU).
- Details: [docs/PRINCIPLES.md](docs/PRINCIPLES.md) (Design-, Architektur- und Security-Prinzipien), [docs/PLATFORM.md](docs/PLATFORM.md) (Weg zur sozialen Plattform).

```
src/
  domain/        GPX-Parser, Statistik, Metriken, Zeitachsen, Wetter-Zuordnung, Formate
  services/      API-Client, Store, URL-Zustand, Wetter-API, Kompression, Arbeitsbereich
  map/           Leaflet-Adapter und eigene Kartensymbole
  components/    Lit Web Components (sx-*)
  controllers/   Konto, Teilen, Profile, Boote
  styles/        Design-Tokens und Layout
worker/          API, Auth (Magic Link), Freigaben, Profile, Boote, Security-Header
migrations/      D1-Schema
test/            Unit- und Funktionstests
```

## Sicherheit in Kürze

Strikte CSP ohne Inline-Skripte und ohne CDNs · HttpOnly-Session-Cookie (`__Host-`), SameSite=Lax + Origin-Prüfung · Tokens nur als SHA-256-Hash gespeichert · Magic Links werden erst nach Bestätigung eingelöst · Rate-Limits, Größen- und Speicherkontingente, Dekompressions-Limit · fremde und private Objekte sind 404 · in Produktion verweigert der Server die Anmeldung, solange Mailversand oder Bot-Schutz fehlen.

## Deployment (Cloudflare)

Einmalig einrichten:

```bash
npx wrangler d1 create sailing-explorer
```

→ `database_id` in `wrangler.jsonc` eintragen.

```bash
npx wrangler r2 bucket create sailing-explorer-tracks
```

```bash
npx wrangler secret put TURNSTILE_SECRET
```

```bash
npx wrangler secret put RESEND_API_KEY
```

- **Turnstile:** Widget im Cloudflare-Dashboard anlegen (Domain `sailing.wollow.ski`), Site-Key in `wrangler.jsonc` → `TURNSTILE_SITE_KEY`.
- **Mail:** Resend-Konto, Domain `sailing.wollow.ski` verifizieren (DNS bei Cloudflare), Absender in `MAIL_FROM`.
- **Domain:** `sailing.wollow.ski` ist als Custom Domain in `wrangler.jsonc` hinterlegt; die Zone `wollow.ski` liegt bereits bei Cloudflare.

Danach deployt die CI bei jedem Push auf den Standardzweig.

### Unterstützen (Stripe)

Pro Konto sind `FREE_SHARES` (Standard 3) gespeicherte Freigaben kostenlos. Ab der nächsten zeigt „Teilen“ eine Karte „Für weitere Törns: einmal unterstützen“; nach einer bezahlten Unterstützung ist das Konto dauerhaft Unterstützer (bis zum Gesamtlimit von 500 Freigaben bzw. 200 MB). Der Status wird aus der Tabelle `supports` abgeleitet; freigeschaltet wird **nur** über den signierten Webhook, nie über eine Angabe des Browsers. Ohne Einrichtung bleibt alles aus (keine Knöpfe, die 4. Freigabe wird mit Hinweis abgelehnt).

1. **Payment Links anlegen** (Stripe-Dashboard → *Payment Links*), z. B. „Kaffee“ (3 €) und „Bier“ (5 €), gern mit „Kunde wählt den Preis“. Die Links (`https://buy.stripe.com/…`) in `wrangler.jsonc` → `SUPPORT_LINK_COFFEE` / `SUPPORT_LINK_BEER` eintragen. Die App hängt selbst `?client_reference_id=<Konto-ID>&prefilled_email=<E-Mail>` an – darüber ordnet der Webhook die Zahlung dem Konto zu.
2. **Webhook anlegen** (*Entwickler → Webhooks → Endpunkt hinzufügen*):
   - URL: `https://sailing.wollow.ski/api/webhooks/stripe`
   - Ereignisse: `checkout.session.completed` (optional zusätzlich `checkout.session.async_payment_succeeded` für verzögerte Zahlarten wie SEPA)
3. **Signatur-Secret setzen** (`whsec_…` aus dem Webhook-Endpunkt):

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Lokal testen: im Stripe-Testmodus Test-Payment-Links anlegen, in `.dev.vars` eintragen und Ereignisse mit der Stripe-CLI weiterleiten – `stripe listen --forward-to localhost:5173/api/webhooks/stripe` gibt das passende `whsec_…` aus.

> **Hinweis (keine Rechtsberatung):** Ist die „Spende“ an eine Gegenleistung gekoppelt (hier: weitere gespeicherte Törns), gilt sie steuerlich in der Regel nicht als Spende, sondern als Verkauf einer Leistung. Vor dem Livegang Impressum, Umsatzsteuer (ggf. Kleinunternehmerregelung) und Widerrufsbelehrung für digitale Leistungen prüfen; in Stripe nicht „Spende“ als Produktbezeichnung verwenden, sondern z. B. „Unterstützung: weitere Törns speichern“.

### Kosten

| Dienst | Free-Tier | Hinweis |
|---|---|---|
| Workers | 100 000 Anfragen/Tag | Rechenarbeit liegt im Browser |
| D1 | 5 GB, 5 Mio. Lesezugriffe/Tag | |
| R2 | 10 GB, keine Egress-Kosten | Zahlungsmittel muss hinterlegt sein |
| Turnstile, Rate Limiting, Custom Domain | kostenlos | |
| Stripe | keine Grundgebühr | Gebühr pro Zahlung (bei 3 € fällt der Fixanteil spürbar ins Gewicht) |
| Mail | Resend: 3 000/Monat | Cloudflare Email Sending an beliebige Empfänger erst mit Workers Paid (5 $/Monat) |
| Kartenkacheln | OSM, OpenSeaMap, EMODnet, Esri | Nutzungsbedingungen der Anbieter beachten (Esri-Basiskarten: Attribution; bei kommerzieller Nutzung prüfen) |

## CI/CD: Forgejo + Woodpecker → GitHub

Primäres Repository ist Forgejo (`git.office.wollow.ski`), gebaut wird mit Woodpecker (`ci.office.wollow.ski`), GitHub erhält eine Spiegelung.

1. **Woodpecker:** Repo aktivieren, Secret `cloudflare_api_token` anlegen (nur für den Deploy-Schritt / Push-Events).
2. **Pipeline:** [.woodpecker.yaml](.woodpecker.yaml) – `install` → `check` (Typen, Tests, Build) → `deploy` (D1-Migrationen + `wrangler deploy`, nur Standardzweig). Läuft auf dem NUC (`labels: speed: fast`).
   - **Vorschau je Branch:** jeder andere Branch landet als eigener Worker unter `https://sailing-<branch>.wollow.ski` (Präfix `feature/` entfällt) mit Vorschau-Datenbank und -Bucket ([scripts/deploy-preview.mjs](scripts/deploy-preview.mjs)); beim Schließen des Pull Requests wird sie gelöscht. Anmeldung/Teilen sind in Vorschauen gesperrt.
3. **Spiegel zu GitHub:** In Forgejo unter *Einstellungen → Repository → Spiegel-Einstellungen* einen Push-Mirror auf `https://github.com/tofixx/sailing-explorer.git` anlegen (GitHub-Token mit `contents: write`), „bei Push synchronisieren“ aktivieren.

## Lizenz & Quellen

Kartendaten © OpenStreetMap-Mitwirkende, © OpenSeaMap, © EMODnet Bathymetry, Kacheln © Esri. Wetterdaten: [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
