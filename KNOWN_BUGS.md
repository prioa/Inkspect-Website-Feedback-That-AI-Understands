# Known Bugs

Bekannte Schwaechen im ausgelieferten Stand. Gegenstueck zu `ROADMAP.md`:
dort steht, was noch *nicht gebaut* ist — hier, was gebaut ist und nicht
sauber genug funktioniert.

Pro Eintrag: **Symptom** (was der Nutzer sieht), **Ursache** (soweit bekannt),
**Beim Beheben beachten**. Wenn die Ursache noch nicht feststeht, gehoert das
so hingeschrieben statt geraten.

---

## Screenshot-Export: Artefakte im gestitchten Bild

**Symptom** — im Full-Page-Export tauchen Bildfehler auf: doppelte oder
fehlende Inhalte an den Slice-Kanten, halb eingeblendete Bloecke, unscharfe
Bereiche.

**Bereits gefunden und behoben** (0.8.9x) — drei Ursachen mit demselben
Erscheinungsbild, jeweils am erzeugten Bild nachgemessen statt geraten:

- **Rahmen der Karte im Zuschnitt.** `getBoundingClientRect` liefert die
  Border-Box; durch `box-sizing: border-box` ragte sie in den 1px-Rahmen von
  `.device__viewport`. Ergebnis: ein Band in `--border-strong` (`#37404f`) an
  jeder Slice-Kante, gemessen im exakten Slice-Raster. Zugeschnitten wird
  jetzt auf die Padding-Box (`frameClientRect` in `components/App.tsx`).
- **Eckenradius.** `.device__viewport` hat `overflow: hidden` *und*
  `border-radius`. Der Radius stanzt aus jedem Slice vier Ecken aus, durch
  die der Kartenhintergrund scheint — gestitcht ergibt das gerundete Kerben
  an jeder Naht. Waehrend der Aufnahme erzwingt `.root--capturing` deshalb
  `border-radius: 0`.
- **Scroll-Animationen der Seite.** Halb eingeblendete Bloecke und falsche
  Zaehlerstaende („77 %" statt „100 %") kamen daher, dass beim Ausloesen die
  Reveal-Animationen noch liefen. `freezeAnimations` setzt sie jetzt auf
  Dauer 0 — inklusive `scroll-behavior: auto`, ohne das ein `smooth`
  scrollender Frame die zurueckgelesene Scroll-Position verfaelscht.

**Was weiterhin stoeren kann** — der Export scrollt das Frame-Dokument in
Viewport-Schritten, fotografiert jeden Schritt per `captureVisibleTab` und
stitcht die Streifen (`captureFullFrameShot` in `lib/screenshot.ts`):

- **JS-getriebene Animationen laufen weiter.** `freezeAnimations`
  setzt nur CSS-Animationen und `transition-duration` auf 0. Ein per
  `requestAnimationFrame` hochzaehlender Zaehler oder eine JS-Slideshow zeigt
  in jedem Slice einen anderen Zwischenstand. Dagegen hilft aktuell nur die
  Wartezeit pro Slice.
- **Lazy-loading.** Bilder, die erst beim Scrollen laden, sind im Slice
  darueber noch leer und im naechsten schon da — je nachdem, wann der
  Intersection Observer feuert.
- **Sticky/Fixed.** `suppressFixedElements` macht `fixed`
  unsichtbar und `sticky` zu `static`. Elemente, die ihre Position per JS
  statt per CSS halten (Scroll-Listener, `transform: translateY`), erwischt
  das nicht und sie wiederholen sich in jedem Streifen.
- **Subpixel-Kanten.** `captureCropped` schneidet unten zusaetzlich
  `Math.ceil(scale)` Pixel weg. Bei gebrochenem `devicePixelRatio`
  (125-%-Windows-Skalierung, externer Monitor) kann diese Rundung zu knapp
  oder zu grosszuegig sein.
- **Runterskalierung.** Ueber `MAX_AREA` (40 MP) rechnet `fitToBudget` das
  fertige Bild proportional herunter — lange Seiten werden dadurch weich.
- **Deckel bei `MAX_SLICES = 12`.** Laengere Seiten brechen ab; das Bild ist
  dann nicht kaputt, aber unvollstaendig.

**Beim Beheben beachten**

- Erst reproduzieren und den Fall notieren (Seite, Zoom, Geraet,
  `devicePixelRatio`) — die Restliste oben sind Kandidaten, keine Diagnose.
  Ohne konkreten Fall wird daraus Herumraten an mehreren Stellen zugleich.
- Am schnellsten kommt man ueber das *erzeugte Bild* zur Ursache: Zeilen-
  mittelwerte gegen den lokalen Median laufen lassen und schauen, ob die
  Auffaelligkeiten im Slice-Raster liegen und welche Farbe sie haben. Genau
  so liessen sich die drei Punkte oben eindeutig zuordnen.
- `captureVisibleTab` ist auf 2 Aufrufe/s limitiert; die 600 ms Abstand sind
  kein Komfort, sondern Pflicht. Eine laengere Wartezeit pro Slice ist die
  billigste Verbesserung gegen JS-Animationen und Lazy-Loading.
- Das Overlay (Marker, Notiz-Sprechblasen) ist in jedem Slice mit drin — ein
  Artefakt kann auch aus dem Overlay statt aus der Seite kommen.

---

## Markdown-Export ist nicht konfigurierbar

**Symptom** — `feedbackToMarkdown` (`lib/exportMarkdown.ts`) gibt genau ein
Format aus, ohne jede Einstellung: Ueberschrift je Seite, Unterueberschrift je
Device, ein GFM-Checkbox-Eintrag je Marker, darunter fest `selector`, `text`,
`change`, `also crosses`, `spacing` und `position`. Wer das Feedback in ein
Ticket-Tool kippt, das kein GFM kann, oder wer nur die Notizen will, muss von
Hand nacharbeiten.

**Ursache** — Funktionsentwurf ohne Optionen. `lineOf` und `refLinesOf` bauen
die Zeilen fest verdrahtet zusammen; der einzige Parameter ist der optionale
`shareHash`.

**Beim Beheben beachten**

- Naheliegende Schalter: Checkboxen an/aus, Gruppierung (Seite → Device vs.
  flach), welche Ref-Zeilen mitkommen, erledigte Eintraege einschliessen,
  Share-Block anhaengen.
- Das Modul haengt bewusst **nicht** am Store — `shareHash` kommt fertig vom
  Aufrufer. Eine Optionen-Struktur sollte genauso hereingereicht werden
  (Parameter-Objekt), nicht aus den Settings gelesen.
- `position` ist die einzige Angabe, die auch ohne aufloesbaren Selektor noch
  verortet. Sie darf abschaltbar sein, aber nicht stillschweigend wegfallen.
- Der Export ist ausdruecklich auch fuer KI-Verarbeitung gedacht (siehe
  Kommentar an `feedbackToMarkdown`). Ein knapperes Format darf den Selektor
  nicht verlieren, sonst ist der Zweck weg.
