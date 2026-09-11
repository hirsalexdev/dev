# SnapGrab

Selbst gehosteter Instagram-Downloader im Stil von snapinsta.to. Link einfügen,
Reels, Fotos und Karussells in Originalqualität herunterladen. Läuft komplett auf
eigener Infrastruktur, speichert nichts und braucht keinen bezahlten API-Anbieter.

```
Browser  ->  /api/resolve  ->  Resolver-Kette (embed -> graphql -> apiv1 -> ytdlp)
                                       |
Browser  <-  /api/download  <-  signierter Streaming-Proxy  <-  Instagram CDN
```

## Schnellstart

```bash
cp .env.example .env
echo "SIGNING_SECRET=$(openssl rand -hex 32)" >> .env
npm install
npm start
# http://localhost:8080
```

Mit Docker:

```bash
docker compose up --build
```

Diagnose, wenn etwas nicht geht:

```bash
node scripts/probe.js https://www.instagram.com/reel/XXXXXXXXXXX/
```

Das Skript fährt alle vier Resolver einzeln gegen einen Post und sagt dir, welcher
noch funktioniert. Damit trennst du "Instagram hat etwas geändert" von "diese IP
ist gesperrt", und das sind zwei völlig verschiedene Probleme.

## Wie so ein Dienst wirklich funktioniert

Das Ergebnis der Recherche, weil es die Architektur oben erklärt. Dienste wie
snapinsta bauen keine Magie, sie kombinieren drei Dinge:

**1. Eine Kette von Instagram-Endpunkten, nicht einen einzigen.**
Instagram hat keine offene API für fremde Posts, aber mehrere halböffentliche
Oberflächen, die unterschiedlich schnell dicht gemacht werden:

| Resolver | Endpunkt | Braucht | Haltbarkeit |
|---|---|---|---|
| `embed` | `instagram.com/p/<code>/embed/captioned/` | nichts | am stabilsten, liefert aber nicht immer alles |
| `graphql` | `POST instagram.com/graphql/query` mit `doc_id` | `x-ig-app-id` | bricht alle 2 bis 4 Wochen |
| `apiv1` | `instagram.com/api/v1/media/<media_id>/info/` | `x-ig-app-id`, meist Cookie | anonym oft schon dicht |
| `ytdlp` | yt-dlp Extractor | yt-dlp Binary | am langlebigsten, weil fremdgepflegt |

Der `x-ig-app-id: 936619743392459` ist die App-ID des Web-Clients und nicht
optional: ohne oder mit falschem Wert kommt sofort ein 403 zurück.

Die `media_id` für `apiv1` steht in keiner URL. Sie wird aus dem Shortcode
berechnet: der Shortcode ist Base64 über das Alphabet `A-Za-z0-9-_`, und die
ersten elf Zeichen sind der Primärschlüssel des Posts als Zahl. Das steckt in
`server/lib/shortcode.js`.

**2. Einen eigenen Download-Proxy.**
Das ist der Teil, den man beim Nachbauen unterschätzt. Die CDN-URLs von Instagram
sind signiert, laufen nach einigen Stunden ab und tragen keinen
`Content-Disposition`-Header. Ein `<a download>` auf eine fremde Domain wird vom
Browser deshalb ignoriert: das Video öffnet sich einfach im Tab. Darum zeigt auch
bei snapinsta jeder Download-Button auf deren eigene Domain und nicht auf das
CDN. Genau das macht hier `/api/download`: es streamt die Datei durch und setzt
`Content-Disposition: attachment`. Range-Requests werden durchgereicht, damit
Fortsetzen und Springen funktionieren.

**3. Wohnadressen statt Rechenzentrum.**
Der eigentliche Kostenfaktor. Anonyme Abrufe sind bei ungefähr 200 Anfragen pro
Stunde und IP zu Ende, danach kommt 429. Schlimmer: Anfragen aus bekannten
Cloud-Netzen (AWS, GCP, DigitalOcean, Hetzner) werden teilweise ab der ersten
Anfrage geblockt. Deshalb ist der Betrieb auf einem billigen VPS der Punkt, an
dem die meisten Eigenbauten scheitern, und deshalb kaufen die kommerziellen
Dienste Residential-Proxies. Wer das gratis will, hostet zu Hause.

**4. Was garantiert kaputt geht.**
Instagram rotiert die GraphQL-`doc_id` bewusst alle zwei bis vier Wochen. Ein
fest verdrahteter Scraper ist damit ein Wartungsabo. Zwei Konsequenzen stecken im
Design: die `doc_id`s sind Konfiguration (`IG_DOC_IDS`) und kein Konstantenblock,
und yt-dlp sitzt als letztes Glied in der Kette. yt-dlps Instagram-Extractor wird
von vielen Leuten gepflegt, das heißt eine Änderung bei Instagram wird hier oft zu
`pip install -U yt-dlp` statt zu Reverse Engineering.

Quellen der Recherche stehen unten.

## Wie man es wirklich gratis betreibt

Ehrliche Reihenfolge, beste Option zuerst:

1. **Zu Hause auf einem Raspberry Pi oder alten Rechner, per Cloudflare Tunnel
   nach außen.** Kostet nichts, und die ausgehenden Anfragen kommen von einer
   normalen Wohn-IP. Das löst das Blocking-Problem, das sonst Geld kostet.
   Cloudflare Tunnel ist im Free-Tier enthalten und braucht keine offene
   Portweiterleitung.
2. **Free-Tier-PaaS (Fly.io, Railway, Render, Koyeb).** Deployment ist einfach,
   aber die IPs sind Datacenter-IPs. Rechne damit, dass `embed` manchmal noch
   geht und der Rest 429 liefert. Ohne Proxy ist das eine Wette.
3. **Serverless (Vercel, Cloudflare Workers).** Reizvoll wegen des Free-Tiers,
   aber die Ausgangs-IPs sind bei Instagram besonders gut bekannt, und der
   Streaming-Proxy passt schlecht zu kurzen Function-Timeouts. Eher nicht.
4. **Residential-Proxy dazukaufen.** Ab etwa 2 bis 5 Euro pro GB. Erst nötig,
   wenn der Dienst tatsächlich Last hat. `PROXY_URL` setzen, fertig.

Was in jedem Fall Geld spart: der eingebaute Cache. Jeder Treffer ist eine
Anfrage, die Instagram nie sieht. Bei mehreren Nutzern auf denselben viralen Reel
ist das der größte Hebel überhaupt.

## Konfiguration

Alles über Umgebungsvariablen, vollständig dokumentiert in `.env.example`. Die
vier, die wirklich zählen:

| Variable | Warum sie zählt |
|---|---|
| `SIGNING_SECRET` | Ohne festen Wert sind alle Download-Links nach einem Neustart tot. In Produktion Pflicht. |
| `PROXY_URL` | Der Unterschied zwischen "funktioniert im Rechenzentrum" und "429". |
| `IG_DOC_IDS` | Hier ziehst du nach, wenn Instagram die GraphQL-IDs rotiert. |
| `IG_SESSIONID` | Hebt die Trefferquote deutlich, riskiert aber die Sperrung des Kontos. Niemals das Hauptkonto. |

## API

**`POST /api/resolve`**

```bash
curl -s localhost:8080/api/resolve \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.instagram.com/reel/XXXXXXXXXXX/"}'
```

```jsonc
{
  "ok": true,
  "source": "embed:contextJSON",
  "shortcode": "XXXXXXXXXXX",
  "kind": "video",
  "caption": "...",
  "author": { "username": "...", "fullName": "...", "avatar": "https://..." },
  "cached": false,
  "media": [
    {
      "type": "video",
      "width": 1080,
      "height": 1920,
      "duration": 14.2,
      "ext": "mp4",
      "filename": "user_XXXXXXXXXXX.mp4",
      "downloadUrl": "/api/download?u=...&fn=...&e=...&s=...",
      "directUrl": "https://scontent.cdninstagram.com/..."
    }
  ]
}
```

Fehler kommen mit `ok: false`, einer lesbaren Meldung und bei `502` zusätzlich
mit `attempts`: pro Resolver steht dort, woran er gescheitert ist.

**`GET /api/download?u=&fn=&e=&s=`** streamt eine Datei als Attachment. Die
Parameter kommen aus `/api/resolve` und sind HMAC-signiert.

**`GET /api/health`** zeigt Resolver-Kette, ob Proxy und Session gesetzt sind,
und den Cache-Füllstand.

## Sicherheit

Der Streaming-Proxy ist die einzige wirklich heikle Stelle: ein Endpunkt, der
beliebige URLs abholt, ist ein offener Proxy und ein SSRF-Loch. Zwei Schranken
sitzen davor, und beide müssen bleiben:

- **HMAC-Signatur** über URL, Dateiname und Ablaufzeit. Nur Links, die dieser
  Dienst selbst ausgestellt hat, werden bedient. Der Vergleich läuft über
  `timingSafeEqual`.
- **Host-Allowlist** (`ALLOWED_MEDIA_HOSTS`). Auch eine gültig signierte URL wird
  abgelehnt, wenn sie nicht auf `*.cdninstagram.com`, `*.fbcdn.net` oder
  `*.instagram.com` zeigt. Das ist die Schranke, die auch dann noch hält, wenn
  das Signaturgeheimnis leckt.

Dazu: Rate Limit pro IP, Größenlimit pro Download, `nosniff` und bereinigte
Dateinamen im `Content-Disposition`.

## Verifizierungsstand

Gemessen am 11.09.2026 aus einem Rechenzentrums-Container heraus, also unter
absichtlich schlechten Bedingungen:

| Resolver | Ergebnis |
|---|---|
| `embed` | funktioniert, echter Post in 754 ms aufgelöst |
| `graphql` | 403 |
| `apiv1` | 429 |
| `ytdlp` | scheitert mit "empty media response" |

Bemerkenswert ist die letzte Zeile: yt-dlp scheitert an genau dem Post, den
`embed` problemlos liefert. Genau dafür ist die Kette da, kein einzelner Weg ist
zuverlässig genug.

Ende-zu-Ende geprüft: Auflösen, signierter Link, Download durch den Proxy
(1 MB gültiges MP4 mit `Content-Disposition: attachment`), Range-Request
(206 Partial Content), Cache-Treffer beim zweiten Auflösen, Rate Limit bei 20
Anfragen pro Minute, sowie alle Ablehnungspfade des Download-Proxys.

`npm test` deckt die Parser und die Signaturlogik mit Fixtures ab, unabhängig
vom Netz: 12 Tests.

## Wenn es kaputt geht

1. `node scripts/probe.js <url>` laufen lassen.
2. **Alle vier Resolver scheitern mit 429 oder Timeout** und der Post ist
   öffentlich: die IP ist dran. Proxy setzen oder woanders hosten.
3. **Nur `graphql` scheitert** mit leerer Antwort: die `doc_id`s sind rotiert.
   Neue holen: Instagram-Postseite im Browser öffnen, DevTools, Netzwerk-Tab,
   nach `graphql/query` filtern, das `doc_id`-Feld aus dem Request-Body
   übernehmen und in `IG_DOC_IDS` eintragen.
4. **Nur `embed` scheitert**: der Post ist privat, gelöscht oder
   altersbeschränkt. Dagegen hilft nur `IG_SESSIONID`.
5. **Alles scheitert außer `ytdlp`**: so soll es sein, die Kette tut ihren Job.
   Dann in Ruhe `IG_DOC_IDS` nachziehen.

## Rechtliches

Automatisierter Abruf verstößt gegen die Nutzungsbedingungen von Instagram, und
die heruntergeladenen Inhalte gehören weiterhin ihren Urhebern. Instagram kann
Konten sperren, die es für automatisiert hält, weshalb `IG_SESSIONID` niemals das
Hauptkonto sein sollte. Gedacht ist das hier für eigene Inhalte, für Backups und
für Material, für das eine Erlaubnis vorliegt. Ein öffentlicher Betrieb für
fremde Inhalte ist eine andere Rechtslage als der private Gebrauch.

## Quellen

- [How to Scrape Instagram in 2026, Scrapfly](https://scrapfly.io/blog/posts/how-to-scrape-instagram)
- [yt-dlp Instagram-Extractor (Quellcode)](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py)
- [The 6 Best Open-Source Instagram Scrapers, Scrapfly](https://scrapfly.io/blog/posts/best-open-source-instagram-scrapers)
- [Downcut, selbst gehosteter Downloader auf yt-dlp](https://github.com/sagarjethi/self-hosted-video-downloader)
- [Instac, selbst gehosteter Instagram-Downloader](https://github.com/hwisnu222/instac)
- [Instaloader](https://github.com/instaloader/instaloader)
