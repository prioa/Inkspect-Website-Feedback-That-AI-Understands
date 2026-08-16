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

## Aufklappen versteckter Elemente greift nicht ueberall

**Symptom** — eine Markierung sitzt auf einem Element, das nur nach einer
Interaktion sichtbar ist (Slideout-Menue, Accordion, spaeterer
Formular-Schritt). Beim Klick im Feedback-Panel bleibt das Element in manchen
Faellen zu, und der Marker zeigt weiter ins Leere.

**Ursache** — `revealShapeIn` (`lib/reveal.ts`) kennt zwei Wege, und beide
haben eine Grenze:

- **Der aufgezeichnete Klick-Pfad** (`shape.reveal`) entsteht erst beim
  *Anlegen* der Markierung. Alt-Daten aus der Zeit davor und Feedback, das
  ueber einen Share-Link hereinkommt, haben keinen — dort bleibt nur die
  Heuristik.
- **Die Heuristik** oeffnet, was ihr Markup verraet: `details`, Popover,
  `aria-controls` mit `aria-expanded="false"` und `[hidden]`. Ein
  selbstgebautes Slideout ohne all das — nur eine CSS-Klasse am `body`, wie
  sie die Testseite in `scripts/e2e-sync.mjs` verwendet — ist damit nicht zu
  oeffnen.

**Behoben: das Zuklappen beim Wechsel** — bis 0.8.95 kannte der Panel-Klick
nur den Hinweg. Wer von einem Eintrag im aufgeklappten Menue auf einen
normalen wechselte, sass danach vor einem Seitenzustand, den er nie erzeugt
hatte. `collapseShapeIn` (`lib/reveal.ts`) ist das Gegenstueck und laeuft nach
derselben Regel wie der Hinweg, nur spiegelverkehrt: **nur solange das Ziel
sichtbar ist**, Abbruch sobald es weg ist. `revealItemEverywhere`
(`components/App.tsx`) fuehrt dazu pro Frame Buch (`openReveals`) und klappt
erst zu, dann auf.

Zwei Qualitaeten von Rueckschritt, unterschieden durch `RevealUndo.exact`:

- **Exakt** — `details.open = false`, `hidePopover()`, `hidden` wieder dran.
  Das ist der praezise Gegenzug, ohne Annahme.
- **Geraten** — ein zweiter Klick auf denselben Oeffner. Fuer einen Toggle
  (Burger, Accordion) stimmt das, fuer einen „Weiter"-Knopf im Formular nicht.
  Deshalb wird nach *jedem* geratenen Schritt gemessen: klappt nichts zu,
  bricht der Lauf ab statt blind weiterzuklicken. Ein solcher Knopf faengt
  sich damit einen Klick ein, nicht das ganze Formular.

**Was dabei offen bleibt**

- Zurueckgenommen wird nur, was ein Panel-Klick geoeffnet hat, und erst beim
  naechsten Panel-Klick. Schliesst der Nutzer stattdessen das Panel oder
  arbeitet auf der Seite weiter, bleibt der letzte Eintrag aufgeklappt stehen.
- Was der Nutzer selbst aufgeklappt hat, fasst niemand an — richtig so, aber
  es heisst auch: die Buchfuehrung stimmt nur fuer den eigenen Anteil.

**Beim Beheben beachten**

- Ein generischer Sichtbar-Zwang per Inline-CSS (`display`, `visibility`,
  `height`) waere der naechste Schritt, aber nur fuer die Screenshot-Aufnahme
  vertretbar: dort wird ohnehin zurueckgesetzt. Beim Panel-Klick bliebe ein
  halb aufgebauter Zustand stehen. Das Muster zum restaurierbaren Setzen steht
  in `suppressFixedElements` (`lib/screenshot.ts`) — und der Rueckweg gehoert
  dann als `RevealUndo` mit `exact: true` dazu.
- Der Export klappt weiter per `reloadFrames` zu, nicht ueber `collapseShapeIn`
  — ein Reload stellt den Anfangszustand zuverlaessig her, und nach dem Export
  stoert er niemanden. Beim Panel-Klick waere er untragbar: Scrollstand und
  Formulareingaben waeren bei jedem Sprung weg.
- **Reine Hover-Menues** (CSS `:hover`, kein Klick) erfasst der Mitschnitt
  gar nicht — er haengt am `click`-Listener. `applyHoverSim`
  (`lib/hoverStyles.ts`) koennte das, kostet aber eine zweite Ereignisart in
  Aufzeichnung *und* Replay.
- `dialog` bleibt bewusst aussen vor: ob `show()` oder `showModal()` gemeint
  ist, laesst sich nicht erraten, und ein falsch geoeffneter Dialog verdeckt
  die halbe Seite.
- Nachgespielt wird nur bei unsichtbarem Ziel, und der Replay bricht ab,
  sobald das Ziel sichtbar ist. Diese beiden Abbruchbedingungen sind der
  Grund, warum der Pfad ungefiltert mitgeschrieben werden darf — wer daran
  etwas aendert, muss den Pfad vorher filtern.

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
