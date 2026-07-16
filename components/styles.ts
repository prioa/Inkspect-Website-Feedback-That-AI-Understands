/**
 * Styles fuer den Shadow Tree. Bewusst als String statt als .css-Import:
 * so braucht das Content-Script keine web_accessible_resources und keine
 * CSS-Injection-Pipeline von WXT.
 *
 * Design-Tokens liegen auf .root — :host ist durch `all: initial` resettet.
 */
export const UI_CSS = `
:host { all: initial; }

* { box-sizing: border-box; }

.root {
  --bg-0: #0e1014;
  --bg-1: #151820;
  --bg-2: #1d222c;
  --bg-3: #262c38;
  --border: #262c38;
  --border-strong: #37404f;
  --text-0: #e8eaf0;
  --text-1: #a9b0bf;
  --text-2: #6f7686;
  --accent: #5b8cff;
  --accent-dim: rgba(91, 140, 255, .16);
  --danger: #ff5d5d;
  --danger-dim: rgba(255, 93, 93, .14);
  --radius-s: 6px;
  --radius-m: 10px;
  --radius-l: 14px;
  --shadow-l: 0 12px 40px rgba(0, 0, 0, .5), 0 2px 8px rgba(0, 0, 0, .35);

  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-0);
  color: var(--text-0);
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

button {
  font: inherit;
  color: var(--text-0);
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  padding: 5px 10px;
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease, color .12s ease;
}
button:hover:not(:disabled) { background: var(--bg-3); }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

input, select {
  font: inherit;
  color: var(--text-0);
  background: var(--bg-0);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  padding: 5px 8px;
}
input::placeholder { color: var(--text-2); }

/* ---------- Icon-Buttons (Ghost) ---------- */

.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  color: var(--text-1);
}
.icon-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--text-0); }
.icon-btn svg { display: block; }
.icon-btn--active {
  background: var(--accent-dim);
  border-color: transparent;
  color: var(--accent);
}
.icon-btn--active:hover:not(:disabled) { background: var(--accent-dim); color: var(--accent); }
.icon-btn--danger:hover:not(:disabled) { background: var(--danger-dim); color: var(--danger); }
.icon-btn--small { width: 26px; height: 26px; }

/* ---------- Toolbar ---------- */

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-1);
  flex: 0 0 auto;
}
.toolbar__brand {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: .01em;
  margin-right: 6px;
  white-space: nowrap;
}
.toolbar__brand em { font-style: normal; color: var(--accent); }
.toolbar__group { display: flex; align-items: center; gap: 2px; }
.toolbar__sep {
  width: 1px;
  height: 22px;
  background: var(--border-strong);
  flex: 0 0 auto;
  margin: 0 2px;
}
.toolbar__feedback { position: relative; }
/* Anker fuer das Sync-Menue — sonst positioniert sich das Dropdown am
   .root (position: fixed) und landet unterhalb des Viewports. */
.toolbar__menu { position: relative; display: inline-flex; }
.toolbar__badge {
  position: absolute;
  top: 2px;
  right: 1px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}

/* ---------- Omnibox ---------- */

.omnibox {
  flex: 1 1 auto;
  min-width: 160px;
  max-width: 720px;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 10px;
  background: var(--bg-0);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  transition: border-color .12s ease;
}
.omnibox:focus-within { border-color: var(--accent); }
.omnibox__icon { display: grid; place-items: center; color: var(--text-2); flex: 0 0 auto; }
/* Feste Domain vor dem editierbaren Pfad — Cross-Origin ist ohnehin gesperrt. */
.omnibox__origin {
  flex: 0 0 auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
  font-size: 12.5px;
  padding-left: 2px;
}
.omnibox__input {
  flex: 1 1 auto;
  min-width: 0;
  background: none;
  border: none;
  padding: 0 4px;
  color: var(--text-0);
}
.omnibox__input:focus-visible { outline: none; }
.omnibox__reload { border-radius: 999px; }

/* ---------- Zoom-Stepper ---------- */

.zoomer {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--bg-0);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
}
.zoomer .icon-btn { border-radius: 999px; }
.zoomer__value {
  min-width: 42px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
  font-size: 12px;
}

/* ---------- Device-Menue ---------- */

.add-device { position: relative; }
.menu-backdrop { position: fixed; inset: 0; z-index: 40; }
.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 41;
  min-width: 230px;
  padding: 6px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-l);
}
.menu__title {
  padding: 6px 10px 8px;
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  border: none;
  border-radius: var(--radius-s);
  text-align: left;
  color: var(--text-0);
}
.menu__item:hover { background: var(--bg-3); }
.menu__item-icon { display: grid; place-items: center; color: var(--text-1); flex: 0 0 auto; }
.menu__item-name { flex: 1 1 auto; }
.menu__item-size { color: var(--text-2); font-variant-numeric: tabular-nums; font-size: 12px; }
.menu__item:disabled { opacity: .4; cursor: default; }
.menu__item--danger:hover:not(:disabled) { background: var(--danger-dim); color: var(--danger); }
.menu__divider { height: 1px; margin: 5px 4px; background: var(--border-strong); }

/* Preset-Zeile mit Loesch-Knopf (nur Custom-Presets) */
.menu__row { display: flex; align-items: center; gap: 2px; }
.menu__row .menu__item { flex: 1 1 auto; min-width: 0; }
.menu__delete { flex: 0 0 auto; visibility: hidden; }
.menu__row:hover .menu__delete { visibility: visible; }

/* Inline-Form: eigene Viewport-Groesse anlegen */
.menu__title--sep { margin-top: 6px; border-top: 1px solid var(--border-strong); padding-top: 10px; }
.menu__custom { display: flex; flex-direction: column; gap: 6px; padding: 0 10px 8px; }
.menu__custom input {
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  font-size: 12.5px;
  color: var(--text-0);
  background: var(--bg-0);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
}
.menu__custom-size { display: flex; align-items: center; gap: 6px; }
.menu__custom-size span { color: var(--text-2); }
.menu__custom-size input { width: 64px; font-variant-numeric: tabular-nums; }
.menu__custom-add {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-s);
}
.menu__custom-add:disabled { opacity: .4; }
.menu__custom-add:hover:not(:disabled) { background: #6f9aff; }

/* ---------- Ladebalken (unter der Toolbar) ---------- */

.loadbar {
  position: absolute;
  top: 52px;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 60;
  overflow: hidden;
  pointer-events: none;
}
.loadbar--active::after {
  content: '';
  position: absolute;
  top: 0;
  left: -40%;
  width: 40%;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  animation: dv-loadbar 1.1s ease-in-out infinite;
}
@keyframes dv-loadbar { to { left: 100%; } }

/* ---------- Hinweise / Banner ---------- */

.hint {
  padding: 8px 14px;
  background: #33270f;
  border-bottom: 1px solid #54401c;
  color: #f0c987;
  flex: 0 0 auto;
}

.banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #351c1c;
  border-bottom: 1px solid #582b2b;
  color: #f0a9a9;
  flex: 0 0 auto;
}
.banner strong { color: #ffd7d7; }
.banner button { border-color: #7a3b3b; background: #522929; }
.banner button:hover:not(:disabled) { background: #653232; }

/* ---------- Layout ---------- */

.body { display: flex; flex: 1 1 auto; min-height: 0; }

/* ---------- CSS-Editor (linkes Panel) ---------- */

.editor {
  width: 380px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-1);
}
.editor__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}
.editor__head select { flex: 1 1 auto; min-width: 0; background: var(--bg-0); }
.editor__status {
  padding: 6px 12px;
  color: var(--text-2);
  border-bottom: 1px solid var(--border);
}
.editor__status--error { color: #f0a9a9; }
.editor__dirty { color: #7fd88f; }
.editor__cm { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.editor__cm .cm-editor { height: 100%; }
.editor__cm .cm-scroller { overflow: auto; }

/* ---------- Feedback-Panel (rechtes Panel) ---------- */

.panel {
  width: 320px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-1);
}
.panel--right { border-left: 1px solid var(--border); }
.panel__head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 10px 10px 14px;
  border-bottom: 1px solid var(--border);
}
.panel__title { font-weight: 600; }
.panel__count {
  min-width: 20px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}
.panel__spacer { flex: 1 1 auto; }
.panel__menu { position: relative; }
.panel__menu .menu { right: -34px; }
.panel__url {
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text-2);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; }
.panel__empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: var(--text-2);
  text-align: center;
}
.panel__empty p { margin: 0; line-height: 1.6; }

.fb-page { margin-bottom: 14px; }
.fb-page__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  margin-bottom: 4px;
  background: var(--bg-2);
  border: none;
  border-radius: var(--radius-s);
  text-align: left;
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
}
.fb-page__head:disabled { opacity: 1; cursor: default; }
.fb-page__head:hover:not(:disabled) { background: var(--bg-3); color: var(--accent); }
.fb-page__path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fb-page__badge {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
}
.fb-page--other .fb-group__head { cursor: pointer; }

.fb-group { margin-bottom: 12px; }
.fb-group__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius-s);
  text-align: left;
}
.fb-group__head:hover { background: var(--bg-3); }
.fb-group__name { font-weight: 600; }
.fb-group__size { color: var(--text-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.fb-group__add { display: grid; place-items: center; color: var(--accent); margin-left: auto; }

.fb-list { list-style: none; margin: 2px 0 0; padding: 0; }
.fb-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-s);
  cursor: pointer;
}
.fb-item:hover { background: var(--bg-2); }
.fb-item__pin {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 999px;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.fb-item__dot { flex: 0 0 auto; width: 10px; height: 10px; margin: 5px 4px 0; border-radius: 999px; }
.fb-check { margin-top: 2px; }
.fb-item__body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.fb-item__label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-0);
  line-height: 1.4;
}
.fb-item__label--empty { color: var(--text-2); font-style: italic; }
.fb-item__label--empty:hover { color: var(--accent); }
.fb-item__meta {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
  font-size: 11px;
}
.fb-item__actions {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  visibility: hidden;
}
.fb-item:hover .fb-item__actions,
.fb-item--editing .fb-item__actions { visibility: visible; }
.fb-item--editing { cursor: default; }
.fb-item__edit {
  width: 100%;
  resize: none;
  font: inherit;
  font-size: 12.5px;
  color: var(--text-0);
  background: var(--bg-0);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  padding: 4px 6px;
}
.fb-item__edit:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

/* Device-Badge geklickt: betroffene Panel-Gruppe blitzt kurz auf */
.fb-group--flash .fb-item { animation: ink-item-flash 1.6s ease-out; }
.fb-group--flash .fb-group__head { animation: ink-item-flash 1.6s ease-out; }
@keyframes ink-item-flash {
  0%, 100% { background: transparent; }
  20%, 60% { background: var(--accent-dim); }
}

/* Erledigt-Status: Check-Kreis vorn, abgehakte Eintraege gedimmt */
.fb-check {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  background: transparent;
  border: 1.5px solid var(--border-strong);
  border-radius: 999px;
  color: #fff;
}
.fb-check:hover { border-color: var(--text-1); }
.fb-check--done { background: #3ecf6e; border-color: #3ecf6e; }
.fb-item--done { opacity: .45; }
.fb-item--done .fb-item__label { text-decoration: line-through; }

/* ---------- Feedback versenden (Panel-Footer) ---------- */

.panel__share {
  flex: 0 0 auto;
  padding: 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.share-row { display: flex; gap: 6px; }
.share-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  flex: 1 1 0;
  min-width: 0;
  padding: 8px 6px;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-s);
  color: #fff;
  font-weight: 600;
  font-size: 12px;
  white-space: nowrap;
}
.share-btn:hover:not(:disabled) { background: #6f9aff; }
.share-btn--alt {
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  color: var(--text-0);
}
.share-btn--alt:hover:not(:disabled) { background: var(--bg-3); }
.share-box {
  display: flex;
  align-items: center;
  gap: 4px;
}
.share-box__url {
  flex: 1 1 auto;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-1);
}
.share-hint { color: var(--text-2); font-size: 11px; line-height: 1.45; }
.share-hint--error { color: #f0a9a9; }
.share-hint--ok { color: #7fd88f; }

/* ---------- Fremde Domains (Panel-Abschnitt) ---------- */

.fb-other { margin-top: 4px; border-top: 1px solid var(--border); padding-top: 8px; }
.fb-other__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  margin-bottom: 4px;
  background: transparent;
  border: none;
  border-radius: var(--radius-s);
  text-align: left;
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
}
.fb-other__head:hover { background: var(--bg-3); color: var(--text-0); }
.fb-other__title { flex: 1 1 auto; }
.fb-other__chev {
  flex: 0 0 auto;
  width: 0;
  height: 0;
  border-left: 5px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform .12s ease;
}
.fb-other__chev--open { transform: rotate(90deg); }
.fb-other__domain { cursor: default; }
.fb-other__domain:hover:not(:disabled) { background: var(--bg-2); color: var(--text-1); }
.fb-item--static { cursor: default; }

/* ---------- Device-Grid ---------- */

.grid {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  padding: 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
  gap: 20px;
}

.device {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  padding: 10px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  transition: border-color .12s ease;
}
.device--annotating { border-color: var(--accent); }
.device__bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 2px 8px;
  color: var(--text-1);
  /* Griff fuer die Drag&Drop-Sortierung der Karten. */
  cursor: grab;
  user-select: none;
}
.device__bar:active { cursor: grabbing; }

/* Karte wird gezogen: transparent lassen, Ziel-Layout entsteht live. */
.device--dragging { opacity: .4; }
/* Waehrend des Drags schlucken die iframes sonst die dragover-Events. */
.grid--dragging .device__viewport iframe { pointer-events: none; }
.device__icon { display: grid; place-items: center; color: var(--text-2); }
/* Name darf schrumpfen — die Kartenbreite bestimmt allein der Viewport. */
.device__name {
  font-weight: 600;
  color: var(--text-0);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.device__size {
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
  font-size: 12px;
  padding: 1px 7px;
  background: var(--bg-2);
  border-radius: 999px;
}
.device__bar-spacer { flex: 1 1 auto; }
/* Der Zaehler ist ein Button: Klick oeffnet das Panel und hebt die Gruppe hervor. */
.device__anno-count {
  min-width: 18px;
  padding: 1px 6px;
  border: none;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
  text-align: center;
  cursor: pointer;
}
.device__anno-count:hover:not(:disabled) { background: #6f9aff; }

/* Kurzer Rahmen-Puls, wenn ein Panel-Eintrag dieses Device anspringt. */
.device--flash { animation: ink-device-flash 1.6s ease-out; }
@keyframes ink-device-flash {
  0%, 100% { box-shadow: none; }
  15%, 55% { box-shadow: 0 0 0 3px var(--accent); }
  35%, 75% { box-shadow: 0 0 0 1px var(--accent); }
}

.device__viewport {
  position: relative;
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
}
.device--annotating .device__viewport { box-shadow: 0 0 0 2px var(--accent); }
.device__viewport iframe {
  border: 0;
  display: block;
  transform-origin: top left;
}

/* ---------- Annotations-Overlay ---------- */

.anno {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.anno__svg {
  display: block;
  width: 100%;
  height: 100%;
}
.anno--active .anno__svg {
  pointer-events: auto;
  cursor: crosshair;
  touch-action: none;
}
.anno--pick .anno__svg { cursor: pointer; }
/* Doppelter Puls um den per Panel-Klick angesprungenen Marker. */
.anno__flash { animation: ink-anno-flash 1.8s ease-out forwards; }
@keyframes ink-anno-flash {
  0% { opacity: 0; }
  12% { opacity: 1; }
  35% { opacity: .25; }
  55% { opacity: 1; }
  100% { opacity: 0; }
}
/* Notiz-Sprechblase blendet beim Hover kurz ein. */
.anno__bubble { animation: ink-bubble-in .14s ease-out; }
@keyframes ink-bubble-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.anno__input {
  position: absolute;
  pointer-events: auto;
  min-width: 150px;
  max-width: calc(100% - 16px);
  background: rgba(14, 16, 20, .92);
  border-width: 1.5px;
  border-radius: var(--radius-s);
  font-weight: 600;
  box-shadow: var(--shadow-l);
}
.anno__note {
  position: absolute;
  pointer-events: auto;
  width: 230px;
  max-width: calc(100% - 16px);
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-l);
  padding: 6px;
}
.anno__note-field {
  display: block;
  width: 100%;
  resize: none;
  font: inherit;
  color: var(--text-0);
  background: var(--bg-0);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  padding: 6px 8px;
}
.anno__note-field:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
.anno__note-hint {
  padding: 5px 2px 1px;
  color: var(--text-2);
  font-size: 11px;
}

/* ---------- Werkzeug-Palette (Kontextmenue per Rechtsklick) ---------- */

.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 49;
}
.palette {
  position: fixed;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 6px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-l);
  transform-origin: 12px 12px;
  animation: ink-palette-in .12s ease-out;
}
@keyframes ink-palette-in {
  from { opacity: 0; transform: scale(.95); }
  to { opacity: 1; transform: none; }
}
.palette__sep { width: 1px; height: 20px; background: var(--border-strong); margin: 0 3px; flex: 0 0 auto; }

.swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  margin: 0 2px;
  border-radius: 50%;
  border: 2px solid transparent;
  flex: 0 0 auto;
  transition: transform .12s ease, box-shadow .12s ease;
}
.swatch:hover { transform: scale(1.12); }
.swatch--active { border-color: var(--bg-2); box-shadow: 0 0 0 2px var(--text-0); }

/* ---------- Vollbild-Modus ---------- */

/* Ohne Toolbar sitzt der Ladebalken ganz oben. */
.root--fs .loadbar { top: 0; }

.fs-stage {
  flex: 1 1 auto;
  min-width: 0;
  position: relative;
  overflow: hidden;
  background: #fff;
}

/* Nacktes Device (Vollbild): kein Karten-Chrom, Frame randlos. */
.device--bare { padding: 0; border: none; border-radius: 0; background: transparent; }
.device--bare .device__viewport { border: none; border-radius: 0; }
.device--annotating.device--bare .device__viewport {
  box-shadow: inset 0 0 0 2px var(--accent);
}

/* Feedback-Panel schwebt im Vollbild ueber der Seite statt sie zu stauchen. */
.root--fs .panel--right {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 44;
  box-shadow: var(--shadow-l);
}

/* Fixe Werkzeugleiste unten mittig. */
.fsbar {
  top: auto;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  transform-origin: center bottom;
  animation: none;
  z-index: 45;
}

/* Feedback-Knopf unten rechts. */
.fs-fab {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 45;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  box-shadow: var(--shadow-l);
}
.fs-fab:hover:not(:disabled) { background: #6f9aff; }
.fs-fab__badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}

/* ---------- Scrollbars ---------- */

.grid::-webkit-scrollbar,
.panel__scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.grid::-webkit-scrollbar-thumb,
.panel__scroll::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 999px;
  border: 2px solid var(--bg-0);
}
.grid::-webkit-scrollbar-thumb:hover,
.panel__scroll::-webkit-scrollbar-thumb:hover { background: #46516395; }
.grid::-webkit-scrollbar-corner { background: transparent; }
`;
