# Roadmap

Geplante Arbeiten, die bewusst noch nicht umgesetzt sind. Kurz halten:
was, warum, und was beim Bauen zu beachten ist.

## Share-Archiv: empfangenes Feedback getrennt ablegen und wieder abrufen

**Heute** landet geteiltes Feedback beim Import im selben lokalen Store wie
eigenes (`addItems` in `lib/feedbackStore.ts`, ausgeloest aus dem Hash-Handler
in `entrypoints/inkspect.content.ts`). Einziges Unterscheidungsmerkmal ist
`mine: false` aus `sanitizeItems` — es sperrt die Marker gegen Verschieben und
Groessenaenderung. Es gibt weder Herkunft noch Datum, und eine einmal
importierte Sendung laesst sich nur Eintrag fuer Eintrag wieder loswerden.

**Ziel:** jeder Import wird als benannte *Sendung* in einem eigenen Store
abgelegt (Quelle, Datum, Anzahl), statt anonym im Feedback aufzugehen. Im
Panel ein eigener Bereich „Received":

```
▾ Received                  3
  ▸ von Link · 28.07. · 12 Einträge
      [einblenden] [übernehmen] [verwerfen]
  ▸ von Link · 26.07. · 4 Einträge
▾ localhost:8973/            7
  • eigenes Feedback …
```

Eine Sendung laesst sich ein-/ausblenden, ins eigene Feedback uebernehmen
(dann wird `mine` gesetzt und die Marker sind wieder beweglich) oder komplett
verwerfen.

**Bleibt lokal** — kein Server, kein Account. Die Zusage „der Payload
verlaesst den Browser nie" (siehe `lib/share.ts`) gilt weiter. Als Vorbild
taugen die gespeicherten Workspaces in `lib/devices.ts`: eigener Storage-Key,
benannte Eintraege, Liste im UI.

**Beim Bauen beachten**

- Der Import dedupliziert ueber die Eintrags-Id. Schickt jemand einen
  *aktualisierten* Link, werden bereits bekannte Ids uebersprungen — seine
  Aenderung an einem schon importierten Eintrag kommt nicht an. Mit Sendungen
  als eigener Einheit laesst sich das sauber loesen (neue Sendung neben der
  alten, statt still zu verschlucken).
- Ein Share-Link enthaelt nur das Feedback der *aktuell geoeffneten Seite*
  (`buildShareLink` in `components/App.tsx`).
- Verworfen wurde bewusst: echtes Backend (Hosting, Auth, Datenschutz, und
  die Lokal-Zusage faellt) und `chrome.storage.sync` (nur eigene Geraete,
  ~100 KB Gesamtlimit — fuer groessere Feedback-Staende zu knapp).
- Datei-Export/-Import (.json) waere die sinnvolle Ergaenzung, wenn Staende
  ausserhalb des Browser-Profils ueberleben sollen (Repo, Ticket, Drive).

## Screenshot-Auswahl: Viewport je Zeile anzeigen

**Heute** listet die Auswahl „Also capture…" am Screenshot-Knopf nur Pfad,
Anzahl und Alter (`otherPages` in `components/FeedbackPanel.tsx`, gerendert
ab der `shotpick__list`):

```
▾ Also capture…
  ☑ /                     3 · 2 h
  ☐ /marketing/websites/  7 · gestern
```

Was dabei fehlt: der Export macht **ein Bild pro Device mit Feedback**. Eine
Zeile mit 7 Eintraegen kann also ein PDF ergeben oder vier. Vor dem Klick ist
weder erkennbar, wie viele Dateien herauskommen, noch fuer welche Viewports —
und genau danach sucht man, wenn man ein bestimmtes Geraet dokumentieren will.

**Ziel:** je Zeile die Viewports dazuschreiben, auf denen die Seite Feedback
hat:

```
▾ Also capture…
  ☑ /                     Desktop HD · iPhone SE      3 · 2 h
  ☐ /marketing/websites/  Desktop HD                  7 · gestern
```

Bei vielen Geraeten kuerzen (`Desktop HD +2`), vollstaendig im `title`. Der
Knopf selbst zaehlt heute Seiten (`Screenshot (3)`) — sinnvoller waere die
Zahl der tatsaechlich entstehenden Dateien, weil die im Downloads-Ordner
landet.

**Beim Bauen beachten**

- Die Daten liegen schon da: `items` tragen `deviceId`, `presets` ist bereits
  Prop des Panels. `otherPages` sammelt bisher nur `count` und `updatedAt` —
  dort zusaetzlich die eindeutigen `deviceId`s je Seite einsammeln.
- Fuer die Zuordnung id → Name/Groesse gibt es im selben File schon das
  Muster mit den *unbekannten* Geraeten (geloeschtes Custom-Preset, Fallback
  auf die rohe Id mit `width: 0`). Das muss hier genauso greifen, sonst steht
  in der Zeile eine nackte Id.
- Erledigte Eintraege zaehlen nicht mit (`item.done` wird in `otherPages`
  bereits uebersprungen) — die Viewport-Liste muss demselben Filter folgen,
  sonst verspricht sie ein Bild, das der Export gar nicht macht.
- Die Zeile ist schmal und der Pfad darf nicht abgeschnitten werden (dafuer
  haengt die Auswahl bewusst an der ganzen Zeile statt am Knopf). Der
  Viewport-Text braucht eine eigene Ellipse statt zusaetzlicher Breite.
