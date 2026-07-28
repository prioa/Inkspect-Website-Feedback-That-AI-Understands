/**
 * Minimales i18n fuer die UI-Texte, die dem Nutzer etwas erklaeren (Tour,
 * Cheatsheet). Bewusst nicht `browser.i18n`: das laedt aus `_locales/` und
 * liefert nur Strings — hier sollen die Texte typisiert und im Bundle sein,
 * damit die Tour auch im Content-Script ohne Extension-Kontext rendert.
 *
 * Deutsch, sobald der Browser irgendein `de`-Locale meldet; sonst Englisch.
 */

export type Locale = 'de' | 'en';

export function detectLocale(): Locale {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith('de')) ? 'de' : 'en';
}

/** Einmal beim Laden bestimmt — die Sprache wechselt zur Laufzeit nicht. */
export const LOCALE: Locale = detectLocale();

/** Ein Textbaustein pro Sprache. */
type Msg = Record<Locale, string>;

function m(en: string, de: string): Msg {
  return { en, de };
}

export const MESSAGES = {
  tourSkip: m('Skip tour', 'Tour überspringen'),
  tourBack: m('Back', 'Zurück'),
  tourNext: m('Next', 'Weiter'),
  tourDone: m('Done', 'Fertig'),
  tourStepOf: m('Step {0} of {1}', 'Schritt {0} von {1}'),
  tourRestart: m('Restart tour', 'Tour neu starten'),
  /** Hinweis an Aktions-Schritten, die auf eine echte Geste warten. */
  tourWaiting: m('Try it — the tour continues on its own', 'Probier es — die Tour geht von selbst weiter'),

  tour1Title: m('Welcome to Inkspect', 'Willkommen bei Inkspect'),
  tour1Body: m(
    'Your page runs live in several viewports at once — scrolling, clicks and hover stay in sync. This short tour shows the gestures that are easy to miss. Two minutes, and you can leave any time.',
    'Deine Seite läuft live in mehreren Viewports gleichzeitig — Scrollen, Klicks und Hover bleiben synchron. Diese kurze Tour zeigt die Gesten, die man leicht übersieht. Zwei Minuten, und du kannst jederzeit aussteigen.',
  ),

  tour2Title: m('The card title bar', 'Die Karten-Titelleiste'),
  tour2Body: m(
    'Drag a card by its title bar to reorder the grid. The buttons on the right rotate the viewport, hide it, or switch touch mode — where dragging scrolls instead of hovering.',
    'Zieh eine Karte an ihrer Titelleiste, um das Grid umzusortieren. Die Buttons rechts drehen den Viewport, blenden ihn aus oder schalten den Touch-Modus um — dort scrollt Ziehen, statt zu hovern.',
  ),

  tour3Title: m('Right-click to open the tools', 'Rechtsklick öffnet die Werkzeuge'),
  tour3Body: m(
    'The whole feedback palette lives behind a right-click on any preview. Try it now.',
    'Die komplette Feedback-Palette steckt hinter einem Rechtsklick auf eine Vorschau. Probier es jetzt.',
  ),

  tour4Title: m('Pick a tool', 'Werkzeug wählen'),
  tour4Body: m(
    'Element picker and comment pin sit right in the bar; everything you draw with — freehand, shapes, arrows, guide lines, text — lives under “Draw”. Keys 1–9 pick a tool directly, Esc goes back to interacting with the page.',
    'Element-Picker und Kommentar-Pin stehen direkt in der Leiste; alles zum Zeichnen — Freihand, Formen, Pfeile, Hilfslinien, Text — liegt unter „Draw“. Die Tasten 1–9 wählen direkt ein Werkzeug, Esc bringt dich zurück zum Interagieren mit der Seite.',
  ),

  tour5Title: m('Guide lines mark a region', 'Hilfslinien stecken einen Bereich ab'),
  tour5Body: m(
    'Open “Draw” for the line tools: they lay full-width or full-height guides across the page — drag one out to pin a baseline, a fold or a column edge. Stack two and you have a region.',
    'Öffne „Draw“ für die Linien-Werkzeuge: Sie ziehen Hilfslinien über die volle Breite oder Höhe der Seite — zieh eine auf, um eine Grundlinie, den Fold oder eine Spaltenkante festzuhalten. Zwei davon ergeben einen Bereich.',
  ),

  tour6Title: m('Markings stay editable', 'Markierungen bleiben editierbar'),
  tour6Body: m(
    'Drag a marking of your own by its outline to move it. Double-click it to write or change its note. Cmd/Ctrl+Z undoes while you draw.',
    'Zieh eine eigene Markierung an ihrem Umriss, um sie zu verschieben. Ein Doppelklick schreibt oder ändert ihre Notiz. Cmd/Strg+Z macht beim Zeichnen rückgängig.',
  ),

  tour7Title: m('The feedback list', 'Die Feedback-Liste'),
  tour7Body: m(
    'Every marking lands here, grouped per page and device. Check entries off as you fix them, share the whole set as a link — no server involved — or export annotated full-page screenshots.',
    'Jede Markierung landet hier, gruppiert nach Seite und Gerät. Hak Einträge ab, während du sie abarbeitest, teile den ganzen Satz als Link — ganz ohne Server — oder exportiere annotierte Vollbild-Screenshots.',
  ),

  tour8Title: m("That's it", 'Das war’s'),
  tour8Body: m(
    'Full window mode shows the page at full size with a floating feedback bar you can drag anywhere. And ? opens the full list of shortcuts and gestures whenever you need it.',
    'Der Vollbild-Modus zeigt die Seite in voller Größe mit einer frei verschiebbaren Feedback-Leiste. Und ? öffnet jederzeit die komplette Liste aller Shortcuts und Gesten.',
  ),
} satisfies Record<string, Msg>;

export type MessageKey = keyof typeof MESSAGES;

/** Uebersetzt einen Baustein; `{0}`, `{1}` … werden der Reihe nach ersetzt. */
export function t(key: MessageKey, ...args: (string | number)[]): string {
  const text = MESSAGES[key][LOCALE];
  return args.length ? text.replace(/\{(\d+)\}/g, (all, i) => String(args[Number(i)] ?? all)) : text;
}
