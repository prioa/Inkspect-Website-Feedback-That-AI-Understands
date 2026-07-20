/**
 * Styles fuer den Shadow Tree. Bewusst als String statt als .css-Import:
 * so braucht das Content-Script keine web_accessible_resources und keine
 * CSS-Injection-Pipeline von WXT.
 *
 * Design-Tokens liegen auf .root — :host ist durch `all: initial` resettet.
 */
/**
 * Light-Theme-Tokens. Nur die Design-Variablen werden ueberschrieben — alle
 * Regeln beziehen sich auf `var(--…)`, sodass ein einziger Block reicht. Wird
 * unten fuer `[data-theme="light"]` und (per Media-Query) `[data-theme="system"]`
 * eingesetzt.
 */
const LIGHT_VARS = `
  --bg-0: #ffffff;
  --bg-1: #f4f5f7;
  --bg-2: #eceef1;
  --bg-3: #e2e5ea;
  --border: #e4e7ec;
  --border-strong: #cdd2da;
  --text-0: #1b1f27;
  --text-1: #4a515e;
  --text-2: #6b7280;
  --accent: #3b6fe0;
  --accent-hover: #2f5fce;
  --accent-dim: rgba(59, 111, 224, .13);
  --danger: #dc4444;
  --danger-dim: rgba(220, 68, 68, .11);
  --warn-bg: #fef6e6;
  --warn-border: #f3dca8;
  --warn-text: #8a5d12;
  --error-bg: #fdecec;
  --error-border: #f4c4c4;
  --error-text: #b23b3b;
  --error-strong: #8f2626;
  --ok-text: #1c8a44;
  --shadow-l: 0 12px 40px rgba(20, 28, 45, .16), 0 2px 8px rgba(20, 28, 45, .1);
`;

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
  --text-2: #838b9b;
  --accent: #5b8cff;
  --accent-hover: #6f9aff;
  --accent-dim: rgba(91, 140, 255, .16);
  --danger: #ff5d5d;
  --danger-dim: rgba(255, 93, 93, .14);
  /* Semantische Banner (Warnung/Fehler/„geaendert") — im Light-Theme ueberschrieben. */
  --warn-bg: #33270f;
  --warn-border: #54401c;
  --warn-text: #f0c987;
  --error-bg: #351c1c;
  --error-border: #582b2b;
  --error-text: #f0a9a9;
  --error-strong: #ffd7d7;
  --ok-text: #7fd88f;
  --canvas-bg: #fff;
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

/* Beschriftete Kernaktion (Feedback) — auf einen Blick verstaendlich. */
.toolbar__btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  color: var(--text-1);
  font-weight: 600;
  font-size: 12.5px;
  white-space: nowrap;
}
.toolbar__btn:hover:not(:disabled) { background: var(--bg-3); color: var(--text-0); }
.toolbar__btn svg { display: block; flex: 0 0 auto; }
.toolbar__btn.icon-btn--active { background: var(--accent-dim); color: var(--accent); }
/* Zaehler direkt im Feedback-Knopf statt als schwebendes Badge. */
.toolbar__count {
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}
.toolbar__btn.icon-btn--active .toolbar__count { background: var(--accent); }
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
.menu__custom-add:hover:not(:disabled) { background: var(--accent-hover); }

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
  background: var(--warn-bg);
  border-bottom: 1px solid var(--warn-border);
  color: var(--warn-text);
  flex: 0 0 auto;
}

.banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--error-bg);
  border-bottom: 1px solid var(--error-border);
  color: var(--error-text);
  flex: 0 0 auto;
}
.banner strong { color: var(--error-strong); }
.banner button { border-color: #7a3b3b; background: #522929; }
.banner button:hover:not(:disabled) { background: #653232; }

/* Laufender Header-Eingriff — warnfarben, damit er nicht uebersehen wird. */
.toolbar__flag {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  flex: 0 0 auto;
  border: 1px solid var(--warn-border);
  border-radius: 999px;
  background: var(--warn-bg);
  color: var(--warn-text);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
.toolbar__flag:hover:not(:disabled) { background: var(--warn-bg); filter: brightness(1.12); }
/* Blockiert, aber ohne Eingriff — ein Angebot, keine Warnung. */
.toolbar__flag--muted {
  border-color: var(--border-strong);
  background: var(--bg-2);
  color: var(--text-2);
  font-weight: 500;
}
.toolbar__flag--muted:hover:not(:disabled) { background: var(--bg-3); color: var(--text-0); filter: none; }

/* ---------- Framing-Sperre (Vollbild statt Previews) ---------- */

.gate {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  overflow: auto;
  background: var(--bg-0);
}
.gate__card {
  width: 100%;
  max-width: 620px;
  padding: 30px 34px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  background: var(--bg-1);
  box-shadow: var(--shadow-l);
}
.gate__card--quiet {
  display: flex;
  align-items: center;
  gap: 10px;
  width: auto;
  color: var(--text-2);
  box-shadow: none;
}
/* Ruhiges Bild-Zeichen statt Warndreieck — es ist eine Weggabelung, kein Fehler. */
.gate__badge {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--accent-dim);
  color: var(--accent);
}
.gate__title {
  margin: 16px 0 8px;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-0);
}
.gate__title strong { font-weight: 600; color: var(--accent); overflow-wrap: anywhere; }
.gate__lead {
  margin: 0 0 22px;
  color: var(--text-1);
  line-height: 1.6;
}
.gate__lead code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

/* Zwei gleichwertige Wege, jeder mit seinem Preis daneben. */
.gate__options { display: flex; flex-direction: column; gap: 10px; }
.gate__option {
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--bg-0);
}
.gate__option--primary { border-color: var(--accent); }
.gate__option-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.gate__option-title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-0);
}
.gate__option-text {
  margin: 0;
  color: var(--text-1);
  line-height: 1.55;
}
.gate__option-text strong { font-weight: 600; color: var(--text-0); overflow-wrap: anywhere; }
/* Der Preis der Option — sichtbar, aber nicht als Alarm. */
.gate__option-cost {
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.5;
}
.gate__btn { flex: 0 0 auto; padding: 7px 14px; }
.gate__btn--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.gate__btn--primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

.gate__foot {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin-top: 20px;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.5;
}
.gate__link {
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-2);
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.gate__link:hover:not(:disabled) { background: none; color: var(--text-0); }
.gate__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: ink-gate-spin .8s linear infinite;
}
@keyframes ink-gate-spin {
  to { transform: rotate(360deg); }
}

/* Hinweis im leeren Device-Frame, wenn ohne Header-Eingriff weitergemacht wurde. */
.device__blocked {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  text-align: center;
  background: var(--bg-1);
  color: var(--text-2);
}
.device__blocked strong { color: var(--text-1); font-weight: 600; }
.device__blocked p { margin: 0; max-width: 300px; line-height: 1.5; font-size: 12px; }

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
.editor__status--error { color: var(--error-text); }
.editor__dirty { color: var(--ok-text); }
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

/* Feedback zu einer Seite oder Groesse, die gerade nicht offen ist: gedimmt.
   Beim Ueberfahren wieder voll lesbar — der Klick fuehrt ja dorthin. */
.fb-group--off { opacity: .45; transition: opacity .14s ease; }
.fb-group--off:hover { opacity: 1; }

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
  /* Notiztext umbrechen statt abschneiden — lange Kommentare bleiben lesbar. */
  white-space: normal;
  overflow-wrap: anywhere;
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
/* Masse der Markierung — eigene Pille, damit sie neben dem Werkzeugnamen
   nicht mit weggekuerzt wird. */
.fb-item__size {
  flex: 0 0 auto;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  white-space: nowrap;
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

/* Veralteter Marker: Anker im aktuellen Layout nicht auffindbar/verborgen —
   Position stimmt gerade nicht, daher deutlich als Warnung markiert. */
.fb-item__meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

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
.share-btn:hover:not(:disabled) { background: var(--accent-hover); }
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
.share-hint--error { color: var(--error-text); }
.share-hint--ok { color: var(--ok-text); }

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
  /* Container fuer die Titelleisten-Queries unten. */
  container-type: inline-size;
}
.device--annotating { border-color: var(--accent); }
.device__bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 2px 8px;
  color: var(--text-1);
  /* Nichts darf ueber die Kartenbreite hinausragen (schmale Karten). */
  overflow: hidden;
  /* Griff fuer die Drag&Drop-Sortierung der Karten. */
  cursor: grab;
  user-select: none;
}
/* Schmale Karten (niedriger Zoom / kleine Viewports): sekundaere Titel-
   Elemente weichen der Reihe nach, damit Name + Schliessen immer passen und
   der Name nicht auf Null kollabiert. */
@container (max-width: 280px) {
  .device__size { display: none; }
}
@container (max-width: 210px) {
  .device__touch,
  .device__eye,
  .device__rotate { display: none; }
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
.device__anno-count:hover:not(:disabled) { background: var(--accent-hover); }

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
  background: var(--canvas-bg);
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
/* Ausserhalb des Korrekturmodus faengt nur die Kontur einer Markierung (plus
   ihre Griffe) Maus-Events — alles daneben gehoert weiter der Seite. */
.anno__hit {
  pointer-events: stroke;
  cursor: grab;
}
.anno__hit--area { pointer-events: all; }
.anno__handles rect { pointer-events: all; }
/* Waehrend des Zugs faengt das ganze Overlay, damit er nicht abreisst,
   sobald der Zeiger die Kontur verlaesst. */
.anno--dragging .anno__svg { pointer-events: auto; }
/* Eigene Markierung unterm Cursor: sie laesst sich an ihrer Kontur ziehen. */
.anno--grab .anno__svg,
.anno--grab .anno__hit { cursor: grab; }
.anno--grabbing .anno__svg,
.anno--grabbing .anno__hit { cursor: grabbing; }
/* Groessenaenderung an den Griffen einer Box. */
.anno--resize-nwse .anno__svg,
.anno--resize-nwse .anno__hit,
.anno--resize-nwse .anno__handles rect { cursor: nwse-resize; }
.anno--resize-nesw .anno__svg,
.anno--resize-nesw .anno__hit,
.anno--resize-nesw .anno__handles rect { cursor: nesw-resize; }
.anno--resize-ns .anno__svg,
.anno--resize-ns .anno__hit,
.anno--resize-ns .anno__handles rect { cursor: ns-resize; }
.anno--resize-ew .anno__svg,
.anno--resize-ew .anno__hit,
.anno--resize-ew .anno__handles rect { cursor: ew-resize; }
/* Greifbar (Hover) und am Zug: gestrichelter bzw. voller Rahmen um den
   Marker — der Cursor allein verraet nicht, *welche* Markierung gemeint ist. */
.anno__mark-grab { animation: ink-anno-fade 120ms ease-out; }
.anno__mark-drag { animation: ink-anno-fade 90ms ease-out; }
@keyframes ink-anno-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* Der gezogene Marker haengt sichtbar an der Maus. */
.anno__moving { opacity: .85; filter: drop-shadow(0 3px 6px rgba(0, 0, 0, .45)); }
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
/* Zusatzfeld im Notiz-Editor (Abstand eines Linienpaars). */
.anno__note-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 6px;
  color: var(--text-1);
  font-size: 12px;
}
.anno__note-num {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 6px;
  font: inherit;
}
.anno__note-unit { color: var(--text-2); }

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
  background: var(--canvas-bg);
}

/* Nacktes Device (Vollbild): kein Karten-Chrom, Frame randlos. */
.device--bare { padding: 0; border: none; border-radius: 0; background: transparent; }
.device--bare .device__viewport { border: none; border-radius: 0; }
.device--annotating.device--bare .device__viewport {
  box-shadow: inset 0 0 0 2px var(--accent);
}

/* Feedback-Panel im Vollbild: schwebende Karte ueber dem Feedback-Knopf —
   nicht ueber die volle Hoehe, damit die Seite sichtbar bleibt. Sie waechst
   aus dem Knopf heraus (transform-origin = dessen Ecke). */
.root--fs .panel--right {
  position: fixed;
  top: auto;
  right: 18px;
  bottom: 78px;
  max-width: calc(100vw - 36px);
  max-height: min(60vh, 560px);
  z-index: 44;
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow-l);
  /* Mitte des 48px-Knopfs: 24px links der rechten Kante, 36px unter der
     Unterkante der Karte (18px Abstand + 24px halbe Knopfhoehe - 6px). */
  transform-origin: calc(100% - 24px) calc(100% + 36px);
  animation: fs-panel-in .16s ease-out;
}
@keyframes fs-panel-in {
  from { opacity: 0; transform: scale(.2); }
  to { opacity: 1; transform: scale(1); }
}
/* Weggeklickt legt sich das Panel sichtbar zurueck hinter den Knopf. */
.root--fs.root--panel-closing .panel--right {
  animation: fs-panel-out .16s ease-in forwards;
  pointer-events: none;
}
@keyframes fs-panel-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(.2); }
}

/* Werkzeugleiste: frei im Fenster ('free'), an der linken Kante als
   Photoshop-Toolbox ('left') oder waagerecht unten ('bottom'). Der Wechsel
   wird animiert — Form und Position fahren ineinander. */
.fsbar {
  animation: none;
  z-index: 45;
  scrollbar-width: none;
  transition:
    left .22s cubic-bezier(.2, .8, .25, 1),
    top .22s cubic-bezier(.2, .8, .25, 1),
    transform .22s cubic-bezier(.2, .8, .25, 1),
    box-shadow .18s ease,
    border-radius .18s ease,
    padding .18s ease;
}
.fsbar::-webkit-scrollbar { display: none; }
.fsbar .icon-btn { transition: background .12s ease, color .12s ease, transform .18s ease; }

.fsbar--free {
  top: auto;
  bottom: auto;
  right: auto;
  transform: none;
  flex-direction: column;
  max-height: calc(100vh - 28px);
  overflow-y: auto;
}
.fsbar--left {
  top: 50%;
  bottom: auto;
  left: 14px;
  right: auto;
  transform: translateY(-50%);
  transform-origin: left center;
  flex-direction: column;
  max-height: calc(100vh - 28px);
  overflow-y: auto;
}
.fsbar--bottom {
  top: auto;
  bottom: 18px;
  left: 50%;
  right: auto;
  transform: translateX(-50%);
  transform-origin: center bottom;
  flex-direction: row;
  max-width: calc(100vw - 28px);
  overflow-x: auto;
}
/* Am Zeiger: angehoben, ohne Positions-Transition (die wuerde nachlaufen). */
.fsbar--dragging {
  transform: scale(1.04);
  transition: box-shadow .18s ease, transform .18s ease;
  cursor: grabbing;
  box-shadow: 0 22px 60px rgba(0, 0, 0, .55), 0 0 0 2px var(--accent);
}

/* Trenner liegen quer zur Leisten-Achse und laufen ueber die volle
   Knopfbreite — kuerzer wirkten sie wie ein Fehler im Raster. */
.fsbar .palette__sep { align-self: stretch; }
.fsbar--left .palette__sep,
.fsbar--free .palette__sep { width: auto; height: 1px; margin: 6px 2px; }
.fsbar--bottom .palette__sep { width: 1px; height: auto; margin: 2px 6px; }

.fsbar__grip {
  display: grid;
  place-items: center;
  color: var(--text-2);
  cursor: grab;
  padding: 2px;
  border-radius: 6px;
  flex: 0 0 auto;
  touch-action: none;
}
.fsbar__grip:hover { color: var(--text-0); background: var(--bg-3); }
.fsbar--bottom .fsbar__grip svg { transform: rotate(90deg); }

/* Farben folgen der Leisten-Achse — senkrecht untereinander spart Breite.
   Mehr Luft als zwischen den Knoepfen: die Punkte sind kleiner und liefen
   sonst zu einer Kette zusammen. */
.fsbar__swatches {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 0 0 auto;
}
.fsbar--left .fsbar__swatches,
.fsbar--free .fsbar__swatches { flex-direction: column; padding: 5px 0; }
.fsbar--bottom .fsbar__swatches { flex-direction: row; padding: 0 5px; }
.fsbar .swatch { margin: 0; }

/* Klick-Schild waehrend des Zugs: faengt alles ab, was sonst im iframe der
   Seite landen wuerde (dort kaemen die pointermove-Events nie an). */
.fsbar-shield {
  position: fixed;
  inset: 0;
  z-index: 43;
  cursor: grabbing;
}

/* Snap-Punkte, nur waehrend des Zugs sichtbar. */
.fsbar-snap {
  position: fixed;
  z-index: 44;
  border-radius: 999px;
  background: var(--accent-dim);
  border: 1px dashed var(--accent);
  opacity: .45;
  pointer-events: none;
  transition: opacity .16s ease, transform .16s ease, background .16s ease;
  animation: ink-fade-in .16s ease-out;
}
.fsbar-snap--left { left: 14px; top: 50%; width: 46px; height: 210px; transform: translateY(-50%); }
.fsbar-snap--bottom { bottom: 18px; left: 50%; width: 320px; height: 46px; transform: translateX(-50%); }
.fsbar-snap--on { opacity: 1; background: var(--accent-dim); }
.fsbar-snap--left.fsbar-snap--on { transform: translateY(-50%) scale(1.06); }
.fsbar-snap--bottom.fsbar-snap--on { transform: translateX(-50%) scale(1.06); }

/* Name des ueberfahrenen Knopfs — schwebt neben der Leiste ueber der Seite. */
.fsbar__hint {
  position: fixed;
  z-index: 46;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-radius: 8px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-l);
  color: var(--text-0);
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  animation: ink-hint-in .12s ease-out;
}
.fsbar__hint--side { transform: translateY(-50%); }
.fsbar__hint--above { transform: translate(-50%, -100%); }
@keyframes ink-hint-in { from { opacity: 0; } to { opacity: 1; } }

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
.fs-fab:hover:not(:disabled) { background: var(--accent-hover); }
/* Statt das Panel aufzudraengen: der Knopf meldet sich kurz. */
.fs-fab--pulse { animation: fs-fab-pulse .6s ease-out 2; }
@keyframes fs-fab-pulse {
  0% { transform: scale(1); box-shadow: var(--shadow-l); }
  35% { transform: scale(1.14); box-shadow: var(--shadow-l), 0 0 0 8px rgba(91, 140, 255, .28); }
  100% { transform: scale(1); box-shadow: var(--shadow-l), 0 0 0 16px rgba(91, 140, 255, 0); }
}
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
.panel__scroll::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
.grid::-webkit-scrollbar-corner { background: transparent; }

/* ---------- Light-Theme ---------- */

.root[data-theme="light"] {${LIGHT_VARS}}
@media (prefers-color-scheme: light) {
  .root[data-theme="system"] {${LIGHT_VARS}}
}

/* Farbvorschau in der Einstellungszeile. */
.menu__swatches { display: flex; gap: 2px; }
.menu__swatches i { width: 6px; height: 12px; border-radius: 2px; }

/* ---------- Reduzierte Bewegung ---------- */

@media (prefers-reduced-motion: reduce) {
  .loadbar--active::after,
  .fb-group--flash .fb-item,
  .fb-group--flash .fb-group__head,
  .device--flash,
  .anno__flash,
  .anno__bubble,
  .palette,
  .fs-fab--pulse,
  .fsbar,
  .fsbar-snap,
  .fsbar__hint,
  .root--fs .panel--right,
  .root--fs.root--panel-closing .panel--right,
  .tour__card,
  .tour__shade,
  .overlay-backdrop { animation: none !important; }
  .fsbar { transition: none !important; }
  .tour__ring { transition: none !important; }
}

/* ---------- Panel-Splitter (Groesse ziehen) ---------- */

.splitter {
  flex: 0 0 auto;
  width: 7px;
  margin: 0 -3px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  z-index: 6;
  touch-action: none;
}
.splitter::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: transparent;
  transition: background .12s ease, box-shadow .12s ease;
}
.splitter:hover::after,
.splitter--active::after {
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
/* Waehrend des Ziehens schlucken die iframes sonst die pointermove-Events. */
.body--resizing { cursor: col-resize; user-select: none; }
.body--resizing iframe { pointer-events: none; }

/* ---------- Menue: Check-Spalte, Device-Sets ---------- */

.menu__check {
  display: grid;
  place-items: center;
  width: 16px;
  flex: 0 0 auto;
  color: var(--accent);
}
.menu--wide { min-width: 250px; max-height: calc(100vh - 72px); overflow-y: auto; }
.menu__empty { padding: 2px 10px 8px; color: var(--text-2); font-size: 11.5px; }

/* Inline-Zeile „Grid als Set speichern" — eigene Klassen, damit sie nicht mit
   dem Custom-Groessen-Formular (.menu__custom-add) kollidiert. */
.menu__inline { display: flex; align-items: center; gap: 6px; }
.menu__inline input { flex: 1 1 auto; min-width: 0; }
.menu__inline-add {
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
.menu__inline-add:disabled { opacity: .4; }
.menu__inline-add:hover:not(:disabled) { background: var(--accent-hover); }

/* Live-Vorschau der Custom-Groesse (Seitenverhaeltnis) */
.menu__preview { display: flex; align-items: center; gap: 12px; padding: 2px 10px 4px; }
.menu__preview-frame {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
}
.menu__preview-box {
  border: 1.5px solid var(--accent);
  border-radius: 2px;
  background: var(--accent-dim);
}
.menu__preview-meta { color: var(--text-2); font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1.5; }
.menu__preview-meta strong { color: var(--text-1); font-weight: 600; }

/* ---------- Gefuehrte Tour (Spotlight-Onboarding) ---------- */

/* Die Tour selbst faengt keine Zeiger — nur ihre Dimm-Flaechen tun das.
   Das Loch dazwischen bleibt dadurch bedienbar, was die Aktions-Schritte
   ("rechtsklick jetzt") ueberhaupt erst moeglich macht. */
.tour { position: fixed; inset: 0; z-index: 70; pointer-events: none; }

.tour__shade {
  position: fixed;
  background: rgba(6, 8, 12, .62);
  pointer-events: auto;
  animation: ink-fade-in .16s ease-out;
}

.tour__ring {
  position: fixed;
  border-radius: var(--radius-m);
  box-shadow: 0 0 0 2px var(--accent), 0 0 0 6px var(--accent-dim);
  pointer-events: none;
  transition: left .16s ease, top .16s ease, width .16s ease, height .16s ease;
}

.tour__card {
  position: fixed;
  width: 340px;
  max-width: calc(100vw - 16px);
  padding: 14px 16px 12px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-l);
  color: var(--text-0);
  pointer-events: auto;
  animation: ink-coach-in .18s ease-out;
}
@keyframes ink-coach-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}

.tour__head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.tour__title { flex: 1 1 auto; font-size: 14px; font-weight: 700; }
.tour__body { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--text-1); }

.tour__waiting {
  margin: 10px 0 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent);
}

.tour__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}
.tour__dots { display: flex; gap: 5px; flex: 1 1 auto; }
.tour__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-strong);
  transition: background .16s ease;
}
.tour__dot--on { background: var(--accent); }

.tour__actions { display: flex; gap: 8px; flex: 0 0 auto; }
.tour__btn {
  padding: 5px 12px;
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
}
.tour__btn:hover:not(:disabled) { color: var(--text-0); border-color: var(--border-strong); }
.tour__btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.tour__btn--primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

/* ---------- Shortcuts-/Hilfe-Overlay ---------- */

.overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(6, 8, 12, .55);
  display: grid;
  place-items: center;
  padding: 24px;
  animation: ink-fade-in .12s ease-out;
}
@keyframes ink-fade-in { from { opacity: 0; } to { opacity: 1; } }
.sheet {
  width: min(560px, 100%);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--bg-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-l);
}
.sheet__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 15px 18px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.sheet__title { flex: 1 1 auto; font-size: 15px; font-weight: 700; }
.sheet__body { padding: 6px 18px 18px; overflow-y: auto; }
.sheet--confirm { width: min(420px, 100%); }
.confirm__text { margin: 10px 0 18px; color: var(--text-1); }
.confirm__actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn--danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
  font-weight: 600;
}
.btn--danger:hover:not(:disabled) { background: var(--danger); filter: brightness(1.08); }
.sheet__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
@media (max-width: 520px) { .sheet__cols { grid-template-columns: 1fr; } }
.sheet__section-title {
  margin: 14px 0 6px;
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.sheet__row { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
.sheet__row-icon { display: grid; place-items: center; width: 24px; flex: 0 0 auto; color: var(--text-1); }
.sheet__row-label { flex: 1 1 auto; color: var(--text-0); }
.sheet__keys { display: flex; gap: 4px; flex: 0 0 auto; }
.kbd {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: var(--bg-0);
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-1);
}

/* ---------- Bestaetigungs-Dialog (Grid ersetzen) ---------- */

.confirm {
  width: min(420px, 100%);
  background: var(--bg-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-l);
  padding: 20px;
}
.confirm__title {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-0);
}
.confirm__title svg { color: var(--warn-text); flex: 0 0 auto; }
.confirm__text { margin: 10px 0 18px; color: var(--text-1); font-size: 13px; line-height: 1.55; }
.confirm__actions { display: flex; justify-content: flex-end; gap: 8px; }
.confirm__btn { padding: 7px 14px; border-radius: var(--radius-s); font-weight: 600; font-size: 12.5px; }
.confirm__btn--primary { background: var(--accent); border-color: transparent; color: #fff; }
.confirm__btn--primary:hover:not(:disabled) { background: var(--accent-hover); }

/* ---------- Text-Button (Empty-State-Aktion) ---------- */

.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.link-btn:hover:not(:disabled) { color: var(--accent-hover); background: none; text-decoration: underline; }

/* Empty-State-Illustration im Feedback-Panel */
.panel__empty-art { margin-bottom: 4px; color: var(--text-2); }
.panel__empty-tip { font-size: 11.5px; color: var(--text-2); }

/* ---------- Schrift-Inspector (Hover-Tooltip) ---------- */

.inspect-tip {
  position: fixed;
  z-index: 58;
  max-width: 280px;
  padding: 8px 10px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-l);
  pointer-events: none;
  color: var(--text-0);
}
.inspect-tip__family {
  font-weight: 600;
  font-size: 12.5px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inspect-tip__row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 3px;
  color: var(--text-1);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.inspect-tip__row strong { color: var(--accent); font-weight: 700; }
.inspect-tip__sep { color: var(--text-2); }
.inspect-tip__meta { margin-top: 2px; color: var(--text-2); font-size: 11px; }
`;
