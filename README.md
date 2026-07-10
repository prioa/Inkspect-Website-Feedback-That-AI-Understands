# Inkspect

Browser-Extension (Chrome & Firefox, Manifest V3): Responsive-Preview mit synchronen Device-Frames, Live-CSS-Editor und Feedback-Werkzeugen — direkt auf der laufenden Seite, ohne externe Tools.

## Features

- **Synchrone Device-Previews** — die aktuelle Seite in mehreren Viewports nebeneinander; Scrollen, Klicks, Eingaben, Hover (JS und CSS `:hover`, auch in Shadow DOM) und Link-Navigation laufen auf allen Frames gleichzeitig. Ein URL-Watchdog gleicht Frames an, deren Navigation ausschert (auch SPA-Routing per `pushState`).
- **Feedback-Werkzeuge** — Element-Picker (highlightet DOM-Elemente beim Hovern, Klick übernimmt sie samt Label), Kommentar-Pins, Freihand, Formen, Pfeile und Text; jede Markierung mit optionaler Notiz. Markierungen kleben am Inhalt (Dokumentkoordinaten) und sind an Seite + Device gebunden.
- **Feedback teilen** — alle Markierungen einer Seite deflate-komprimiert und base64url-codiert im URL-Hash (`#ink-feedback=…`); kein Server. Empfänger mit installierter Extension bekommen das Feedback automatisch importiert und angezeigt. Alternativ Export als Text.
- **Live-CSS-Editor** — Stylesheets der Seite (inkl. Cross-Origin via Background-Fetch) im CodeMirror-Editor bearbeiten, Änderungen greifen debounced auf allen Frames und überleben Frame-Reloads.
- **Frame-Blockade-Umgehung** — Seiten mit `X-Frame-Options`/`frame-ancestors` lassen sich per Opt-in trotzdem einbetten (DNR-Session-Rule, nur für den eigenen Tab und nur für Sub-Frames).

## Entwicklung

```sh
pnpm install
pnpm dev            # Chrome mit Live-Reload
pnpm dev:firefox
pnpm build          # Produktions-Build nach .output/
pnpm compile        # Typecheck
pnpm icons          # PNG-Icons aus assets/icon.svg rendern
pnpm test:e2e       # E2E-Suite (braucht Google Chrome unter /Applications)
```

Gebaut mit [WXT](https://wxt.dev), React 19 und CodeMirror 6. Die E2E-Suite (`scripts/e2e-sync.mjs`) startet einen lokalen Testserver, installiert die Extension in echtem Chrome (headless, via CDP) und verifiziert Sync, Werkzeuge, Share-Roundtrip und Navigation.
