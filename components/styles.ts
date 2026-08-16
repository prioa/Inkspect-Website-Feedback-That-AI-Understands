/**
 * Styles for the shadow tree. Deliberately a string rather than a .css import:
 * that way the content script needs no web_accessible_resources and no CSS
 * injection pipeline from WXT.
 *
 * Design tokens live on .root — :host is reset via `all: initial`.
 */
/**
 * Light theme tokens. Only the design variables are overridden — every rule
 * refers to `var(--…)`, so a single block is enough. Used below for
 * `[data-theme="light"]` and (via a media query) `[data-theme="system"]`.
 */
const LIGHT_VARS = `
  color-scheme: light;
  /* The same arithmetic as in the dark theme, only the other way round: 100 /
     96 / 93 / 89 L*, and the border colours lie *below* every surface. Before,
     --border was lighter than --bg-3 — so the line disappeared on the very
     raised surface it was meant to delimit. */
  --bg-0: #ffffff;
  --bg-1: #f4f5f7;
  --bg-2: #eceef1;
  --bg-3: #e0e4ea;
  --border: #d7dce4;
  --border-strong: #bcc5d2;
  --text-0: #1b1f27;
  --text-1: #4a515e;
  --text-2: #6b7280;
  --accent: #3b6fe0;
  --accent-hover: #2f5fce;
  --accent-dim: rgba(59, 111, 224, .13);
  --accent-fade: rgba(59, 111, 224, 0);
  --accent-glow: rgba(59, 111, 224, .35);
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
  --shadow-drag: 0 22px 60px rgba(20, 28, 45, .28);
  --shadow-tail: 0 2px 6px rgba(20, 28, 45, .18);
  --error-btn-bg: #f7d7d7;
  --error-btn-border: #e39c9c;
  --error-btn-hover: #f0c6c6;
`;

export const UI_CSS = `
:host { all: initial; }

* { box-sizing: border-box; }

.root {
  /* Tells the browser which scheme to render the things *it* draws in, rather
     than us: scrollbars in containers without rules of their own, open select
     lists, native controls. Without this line it takes its light default — a
     light grey scrollbar in the middle of the dark panel, and the font picker
     opening in white. */
  color-scheme: dark;

  /* Surface ramp. The steps are measured in perceived lightness (L*), not in
     hex distance: 5 / 9 / 13 / 23. It used to end at 18 and was therefore only
     ~4 L* apart at the upper end — too little in dark interfaces to tell two
     levels apart. Anyone moving a step checks the distances too, not just the
     value.

     bg-0 to bg-2 stay as they were: they carry the basic mood, and every text
     colour is tuned to them. What gets pulled apart is the upper end, where
     "sits on top" and "is selected" have to be read. */
  --bg-0: #0e1014;
  --bg-1: #151820;
  --bg-2: #1d222c;
  --bg-3: #303845;
  /* No longer identical to --bg-3. Before, the border colour was byte for byte
     the same as the raised surface — a line between a surface and its own
     border colour cannot become visible. */
  --border: #272f3c;
  --border-strong: #434e60;
  --text-0: #e8eaf0;
  --text-1: #a9b0bf;
  --text-2: #838b9b;
  --accent: #5b8cff;
  --accent-hover: #6f9aff;
  --accent-dim: rgba(91, 140, 255, .16);
  /* The same accent with alpha 0, and as a glow. Both have to carry the
     theme's colour: transparent would be rgba(0,0,0,0) and would fade through
     grey, and a fixed blue would stay put in the light theme while the accent
     next to it had long since become another. */
  --accent-fade: rgba(91, 140, 255, 0);
  --accent-glow: rgba(91, 140, 255, .35);
  --danger: #ff5d5d;
  --danger-dim: rgba(255, 93, 93, .14);
  /* Semantic banners (warning/error/"changed") — overridden in the light theme. */
  --warn-bg: #33270f;
  --warn-border: #54401c;
  --warn-text: #f0c987;
  --error-bg: #351c1c;
  --error-border: #582b2b;
  --error-text: #f0a9a9;
  --error-strong: #ffd7d7;
  --ok-text: #7fd88f;
  --radius-s: 6px;
  --radius-m: 10px;
  --radius-l: 14px;
  --shadow-l: 0 12px 40px rgba(0, 0, 0, .5), 0 2px 8px rgba(0, 0, 0, .35);
  /* An element raised under the pointer (bar, mockup). In the light theme the
     shadow follows the same blue-tinted family as --shadow-l, rather than the
     hard black it used to be. */
  --shadow-drag: 0 22px 60px rgba(0, 0, 0, .55);
  /* The tail of the feedback card. It is an element of its own and therefore
     lay without a shadow in the card's shadow zone — nearly black on nearly
     black, held only by its outline. Matches the tight setting of --shadow-l,
     so that card and tail come from the same light source. */
  --shadow-tail: 0 2px 6px rgba(0, 0, 0, .4);
  /* Button in the error banner. It used to be a fixed dark wine red and stayed
     dark in the light theme too — on a pale pink banner. */
  --error-btn-bg: #522929;
  --error-btn-border: #7a3b3b;
  --error-btn-hover: #653232;

  /* ----- Not theme-dependent: applies to light and dark alike ----- */

  /* Empty page behind a frame. White in both themes — a document without a
     background of its own is white, even when the tool is dark. It stands here
     and not in LIGHT_VARS precisely because it is *not* a theme colour: being
     overridden in LIGHT_VARS would be wrong, and not being defined at all
     would be a trap for the next person to change the value. */
  --canvas-bg: #fff;
  /* Text and symbols on filled colour surfaces: accent, danger, a pin's marker
     colour, the dark capture badge. All of them are saturated enough for white
     in both themes. A token of its own, so that a new accent does not have to
     be threaded through two dozen places — and so that it stands out when
     someone adds a light surface on which white no longer carries. */
  --on-solid: #fff;
  /* Device chrome of the phone mockup — a phone is black, whatever theme the
     tool happens to wear. */
  --phone-chrome: #2b323d;
  --phone-body: #101318;
  /* Semi-transparent white on the same surfaces — spinner track, inactive
     symbols. Belongs with --on-solid and changes along with it. */
  --on-solid-dim: rgba(255, 255, 255, .35);
  /* Done tick. A filled surface, not text — hence not --ok-text. Deliberately
     the same in both themes; for the light theme a darker green would have
     more contrast, but that would be a visible change and belongs in a pass of
     its own. */
  --ok-solid: #3ecf6e;
  /* Dimming behind dialogs, the tour and the capture crop. Before, three
     minimally different blacks (8,10,15 / 6,8,12) for the same job. Dark in the
     light theme too — a veil is supposed to darken. */
  --scrim: rgba(6, 8, 12, .62);
  --scrim-soft: rgba(6, 8, 12, .55);
  /* Hints. Lighter than the two above, because a blur is added here and
     because the veil stands for up to ten seconds while work may continue — it
     should make things recede, not shut them off. */
  --scrim-hint: rgba(6, 8, 12, .42);
  /* And once more halved, for a veil that only reaches to the edge of one card
     instead of over the window — see .nudge__shade--soft. */
  --scrim-hint-soft: rgba(6, 8, 12, .22);

  /* ----- On someone else's page, not in the tool -----
     The marking overlay lies over the user's page. Its colours therefore do
     not follow the tool's theme but have to carry on light and dark pages
     alike. */
  --anno-field-bg: rgba(14, 16, 20, .92);
  --shadow-mark: 0 3px 6px rgba(0, 0, 0, .45);
  /* Box model dots in the element view — outer and inner spacing, in the usual
     devtools colours (orange/green). */
  --boxmodel-margin: rgba(246, 178, 107, .95);
  --boxmodel-padding: rgba(147, 196, 125, .95);

  /* ----- Font sizes -----
     Eight steps rather than eleven values that grew over time. The odd
     in-between sizes (12.5, 11.5, 10.5) are rounded to the full step: less
     than half a pixel of difference, but no more half-pixel rendering. The
     scale stays tight because the interface is tight — between a meta line and
     a button there really is only one pixel here. */
  --fs-2xs: 9px;    /* Only the counter on the floating bar */
  --fs-xs: 10px;    /* Counters, badges, micro labels */
  --fs-s: 11px;     /* Meta lines, secondary text */
  --fs-m: 12px;     /* Grundmass: Knoepfe, Listen, Menues */
  --fs-body: 13px;  /* Fliesstext in Dialogen */
  --fs-l: 14px;     /* Abschnitts-Ueberschriften */
  --fs-title: 15px; /* Dialog and sheet titles */
  --fs-hero: 19px;  /* Largest title (welcome) */

  /* ----- Motion -----
     Three durations rather than twelve. The in-between values (.14s, .18s)
     were below the perceptual threshold against their neighbours anyway. */
  --dur-1: .12s;    /* Hover, Fokus — unmittelbare Rueckmeldung */
  --dur-2: .16s;    /* State changes with visible movement */
  --dur-3: .28s;    /* Whole elements fading in and out */
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease-in-out: cubic-bezier(.4, 0, .2, 1);

  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-0);
  color: var(--text-0);
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  /* Opening: the overlay lies down over the page rather than replacing it in a
     single frame. Short on purpose — long enough to be read as a movement, too
     short to hold anyone up. Everything else about the entrance (the bar
     sliding in) happens on top of this. */
  animation: ink-fade-in .14s ease-out;
}

button {
  font: inherit;
  color: var(--text-0);
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  padding: 5px 10px;
  cursor: pointer;
  transition: background var(--dur-1) ease, border-color var(--dur-1) ease, color var(--dur-1) ease;
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

/* ---------- Icon buttons (ghost) ---------- */

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
/* Armed: the button has been clicked once and is now waiting for the second.
   Filled rather than merely tinted — this is the state in which the next click
   destroys something, and it has to be unmistakable at 26 px. The pulsing ring
   makes it visible even out of the corner of the eye, and says that the state
   is a passing one. */
.icon-btn--armed,
.icon-btn--armed:hover:not(:disabled) {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
  animation: ink-arm .9s ease-out infinite;
}
@keyframes ink-arm {
  0% { box-shadow: 0 0 0 0 var(--danger-dim); }
  70% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.icon-btn--small { width: 26px; height: 26px; }

/* ---------- Toolbar ---------- */

/* Above the feedback panel (35): with position+z-index the toolbar forms a
   stacking context of its own, in which its ⋯ menu stays trapped. At equal
   z-index the panel, standing later in the DOM, wins — the menu would then
   vanish behind it as soon as the panel is open. */
.toolbar {
  position: relative;
  z-index: 38;
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
  font-size: var(--fs-l);
  letter-spacing: .01em;
  margin-right: 6px;
  white-space: nowrap;
}
.toolbar__brand em { font-style: normal; color: var(--accent); }
.toolbar__group { display: flex; align-items: center; gap: 2px; }

/* Entrance when the tool opens. The bar comes in from the window edge it sits
   against — the direction says where it came from, instead of it merely being
   there from one frame to the next. Its contents follow a beat later and from
   left to right, in the order one reads them: brand, address, tools. That
   short delay is what makes the bar read as one object arriving rather than a
   dozen buttons appearing at once.

   The class falls away after the run (INTRO_MS in Toolbar.tsx) — otherwise
   every later swap inside the bar (the path turning into an input, the framing
   flag appearing) would fly in again. */
.toolbar--intro { animation: ink-toolbar-in .34s var(--ease-out) backwards; }
@keyframes ink-toolbar-in {
  from { transform: translateY(-100%); opacity: 0; }
  70% { opacity: 1; }
  to { transform: translateY(0); }
}
.toolbar--intro > * { animation: ink-toolbar-item-in .28s var(--ease-out) backwards; }
@keyframes ink-toolbar-item-in {
  from { opacity: 0; transform: translateY(-5px); }
}
/* 30 ms apart, and from the ninth on all at once: further out the steps stop
   being legible as a sequence, and the last button would only arrive after the
   eye has long been there. */
.toolbar--intro > * { animation-delay: .34s; }
.toolbar--intro > *:nth-child(1) { animation-delay: .1s; }
.toolbar--intro > *:nth-child(2) { animation-delay: .13s; }
.toolbar--intro > *:nth-child(3) { animation-delay: .16s; }
.toolbar--intro > *:nth-child(4) { animation-delay: .19s; }
.toolbar--intro > *:nth-child(5) { animation-delay: .22s; }
.toolbar--intro > *:nth-child(6) { animation-delay: .25s; }
.toolbar--intro > *:nth-child(7) { animation-delay: .28s; }
.toolbar--intro > *:nth-child(8) { animation-delay: .31s; }


/* On hiding, the phone mockup flies to the phone button in the bar. An
   accelerating curve: the mockup is pulled into the button rather than rolling
   out in front of it. The opacity lags behind, so that the distance stays
   visible instead of fizzling out halfway. The duration pairs with FLIGHT_MS. */
.phone-prev--flight {
  transition: transform .5s cubic-bezier(.5, 0, .78, .27), opacity .3s ease .16s;
  pointer-events: none;
}

/* The counterpart: the mockup grows out of the same button. The overshoot at
   the end of the curve makes it snap in rather than merely stop. The duration
   pairs with LAUNCH_MS; backwards covers the first frame, and nothing is held —
   the class falls away after the run, or the animation would override the idle
   dimming. */
@keyframes ink-phone-launch {
  from {
    transform: translate(var(--fly-x, 0px), var(--fly-y, 0px)) scale(.08);
    opacity: 0;
  }
  55% { opacity: 1; }
  to {
    transform: translate(0, 0) scale(1);
    opacity: 1;
  }
}
.phone-prev--launch {
  animation: ink-phone-launch .46s cubic-bezier(.16, .84, .34, 1.04) backwards;
  will-change: transform;
}
/* ---------- Phone mockup (mobile view in the feedback full window) ---------- */

/* In front of the feedback panel (44); a dock change glides. The idle dimming
   is driven by timers in the component (the first time 40 s after the first
   scroll, after that 2 s after hover ends) — only the two transitions stand
   here: fade in .25 s, dim .7 s. Anyone changing the .7 s changes DIM_FADE_MS
   in PhonePreview too: the hint that only comes after the transition hangs off
   it. */
.phone-prev {
  position: fixed;
  z-index: 45;
  opacity: 1;
  transition:
    left .55s var(--ease-in-out),
    top .55s var(--ease-in-out),
    /* Only for the way back: switch it on again during the fly-out and the
       mockup glides back rather than jumping. */
    transform .3s cubic-bezier(.16, .84, .34, 1),
    opacity .25s ease;
}
.phone-prev--dim {
  opacity: .3;
  transition:
    left .55s var(--ease-in-out),
    top .55s var(--ease-in-out),
    opacity .7s ease;
}
/* While the hint about it is up: brought halfway back. The window is the
   subject of the explanation, but at .3 you can hardly see what is meant — and
   fully bright, the statement ("goes transparent") would no longer be true. */
.phone-prev--dim.phone-prev--explained { opacity: .75; }
.phone-prev--dragging {
  opacity: 1;
  transition: none;
}
.phone-prev__frame {
  position: relative;
  padding: 26px 10px 24px;
  background: var(--phone-body);
  border: 1px solid var(--phone-chrome);
  border-radius: 30px;
  box-shadow: var(--shadow-l);
  cursor: grab;
  touch-action: none;
}
.phone-prev--dragging .phone-prev__frame { cursor: grabbing; box-shadow: var(--shadow-drag), 0 0 0 2px var(--accent); }
.phone-prev__notch {
  position: absolute;
  top: 9px;
  left: 50%;
  transform: translateX(-50%);
  width: 56px;
  height: 8px;
  border-radius: 999px;
  background: var(--phone-chrome);
}
.phone-prev__home {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 64px;
  height: 4px;
  border-radius: 999px;
  background: var(--phone-chrome);
}
/* The two frame buttons (dim, hide) sit as a row in the corner — half over the
   frame, like the single button before them. */
.phone-prev__actions {
  position: absolute;
  top: -9px;
  right: -9px;
  display: flex;
  gap: 4px;
}
.phone-prev__btn {
  display: grid;
  place-items: center;
  /* Without this reset, the button padding from the base rule pushes the icon
     out of the centre of the round button. */
  padding: 0;
  line-height: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: var(--bg-2);
  color: var(--text-1);
  cursor: pointer;
  box-shadow: var(--shadow-l);
}
.phone-prev__btn:hover { color: var(--text-0); background: var(--bg-3); }
/* Switched on here means "stays bright": the button carries the state, or you
   are left guessing why the preview no longer recedes. */
.phone-prev__dim-toggle.is-on {
  border-color: var(--accent);
  background: var(--accent-dim);
  color: var(--accent);
}
.phone-prev__dim-toggle.is-on:hover { background: var(--accent-dim); color: var(--accent); }
/* While the hint about the fading stands, the switch it names lights up.

   The ring of the hint lies around the whole mockup — that is what changed, and
   a ring around a 22 px button would leave the user guessing what is being
   talked about. But then "the switch on its frame" points into a corner with
   two identical little buttons in it. This pulse says which of them, without
   the hint having to give up the window as its subject. Three beats like the
   hint's own ring, then it stands still. */
.phone-prev--explained .phone-prev__dim-toggle {
  border-color: var(--accent);
  color: var(--accent);
  animation: ink-phone-switch 1.5s ease-out 3;
}
@keyframes ink-phone-switch {
  0% { box-shadow: var(--shadow-l), 0 0 0 0 var(--accent-dim); }
  45% { box-shadow: var(--shadow-l), 0 0 0 9px transparent; }
  100% { box-shadow: var(--shadow-l), 0 0 0 3px var(--accent-dim); }
}
/* Background as in the large frame: until the page stands, the screen is dark
   rather than white. A white ground traces every rounding remnant at the edge
   as a bright rim — in a dark tool that shows immediately. */
.phone-prev__screen {
  overflow: hidden;
  border-radius: 16px;
  background: var(--canvas-bg);
}
.phone-prev__screen iframe {
  display: block;
  border: 0;
  transform-origin: top left;
}
.toolbar__sep {
  width: 1px;
  height: 22px;
  background: var(--border-strong);
  flex: 0 0 auto;
  margin: 0 2px;
}
.toolbar__feedback { position: relative; }

/* Labelled core action (feedback) — understandable at a glance. */
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
  font-size: var(--fs-m);
  white-space: nowrap;
}
.toolbar__btn:hover:not(:disabled) { background: var(--bg-3); color: var(--text-0); }
.toolbar__btn svg { display: block; flex: 0 0 auto; }
.toolbar__btn.icon-btn--active { background: var(--accent-dim); color: var(--accent); }
/* The counter sits inside the feedback button rather than as a floating badge. */
.toolbar__count {
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-solid);
  font-size: var(--fs-xs);
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}
.toolbar__btn.icon-btn--active .toolbar__count { background: var(--accent); }

/* The view switch ("My edits"): labelled like the core actions, but with a
   clear on/off pill — a merely darker button does not read as "off", and this
   one decides whether the whole preview shows your work or the original. */
.toolbar__toggle { gap: 6px; }
.toolbar__toggle.is-on { background: var(--accent-dim); color: var(--accent); }
.toolbar__state {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: .03em;
  background: var(--bg-3);
  color: var(--text-2);
}
.toolbar__toggle.is-on .toolbar__state { background: var(--accent); color: var(--on-solid); }
.toolbar__toggle--hint { animation: ink-mark-hint 1.7s var(--ease-out); }
.toolbar__toggle--hint svg { animation: ink-mark-hint-eye 1.7s var(--ease-out); }
/* Anchor for the sync menu — otherwise the dropdown positions itself against
   .root (position: fixed) and lands below the viewport. */
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
  color: var(--on-solid);
  font-size: var(--fs-xs);
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
  transition: border-color var(--dur-1) ease;
}
.omnibox:focus-within { border-color: var(--accent); }
.omnibox__icon { display: grid; place-items: center; color: var(--text-2); flex: 0 0 auto; }
/* Fixed domain in front of the editable path — cross-origin is blocked anyway. */
.omnibox__origin {
  flex: 0 0 auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
  font-size: var(--fs-m);
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

/* Collapsed omnibox: the path is display only, a click makes it editable. */
.toolbar__path {
  flex: 1 1 auto;
  min-width: 160px;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  background: none;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--text-0);
  font: inherit;
  text-align: left;
  cursor: text;
  transition: border-color var(--dur-1) ease, background var(--dur-1) ease;
}
.toolbar__path:hover { background: var(--bg-0); border-color: var(--border-strong); }
.toolbar__path-value {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
}

/* Zoom row in the "More" menu. */
.menu__zoom { padding: 4px 10px 2px; gap: 4px; }
.menu__zoom .icon-btn { border-radius: 999px; }
.zoomer__value {
  min-width: 42px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
  font-size: var(--fs-m);
}

/* ---------- Device menu ---------- */

.add-device { position: relative; }
/* Catches the click that closes the menu. The cursor is set explicitly rather
   than inherited: in the feedback card this sheet hangs inside the header, and
   the header is the card's drag handle — so the grab hand spread across the
   entire window for as long as the menu stood open. */
.menu-backdrop { position: fixed; inset: 0; z-index: 40; cursor: default; }
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
  font-size: var(--fs-s);
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
.menu__item-size { color: var(--text-2); font-variant-numeric: tabular-nums; font-size: var(--fs-m); }
.menu__item:disabled { opacity: .4; cursor: default; }
.menu__item--danger:hover:not(:disabled) { background: var(--danger-dim); color: var(--danger); }
.menu__divider { height: 1px; margin: 5px 4px; background: var(--border-strong); }

/* Preset row with a delete button (custom presets only) */
.menu__row { display: flex; align-items: center; gap: 2px; }
.menu__row .menu__item { flex: 1 1 auto; min-width: 0; }
.menu__delete { flex: 0 0 auto; visibility: hidden; }
.menu__row:hover .menu__delete { visibility: visible; }

/* Inline form: create a custom viewport size */
.menu__title--sep { margin-top: 6px; border-top: 1px solid var(--border-strong); padding-top: 10px; }
.menu__custom { display: flex; flex-direction: column; gap: 6px; padding: 0 10px 8px; }
.menu__custom input {
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  font-size: var(--fs-m);
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
  color: var(--on-solid);
  border: none;
  border-radius: var(--radius-s);
}
.menu__custom-add:disabled { opacity: .4; }
.menu__custom-add:hover:not(:disabled) { background: var(--accent-hover); }

/* ---------- Loading bar (under the toolbar) ---------- */

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

/* ---------- Notices / banners ---------- */

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
.banner button { border-color: var(--error-btn-border); background: var(--error-btn-bg); }
.banner button:hover:not(:disabled) { background: var(--error-btn-hover); }

/* Header change in progress — in warning colours, so that it is not missed. */
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
  font-size: var(--fs-s);
  font-weight: 600;
  white-space: nowrap;
}
.toolbar__flag:hover:not(:disabled) { background: var(--warn-bg); filter: brightness(1.12); }
/* Blocked, but without the change — an offer, not a warning. */
.toolbar__flag--muted {
  border-color: var(--border-strong);
  background: var(--bg-2);
  color: var(--text-2);
  font-weight: 500;
}
.toolbar__flag--muted:hover:not(:disabled) { background: var(--bg-3); color: var(--text-0); filter: none; }

/* ---------- Framing block (full window instead of previews) ---------- */

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
/* A calm picture sign rather than a warning triangle — it is a fork in the road, not a fault. */
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
  font-size: var(--fs-hero);
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
  font-size: var(--fs-m);
}

/* Two equal routes, each with its price beside it. */
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
  font-size: var(--fs-l);
  font-weight: 600;
  color: var(--text-0);
}
.gate__option-text {
  margin: 0;
  color: var(--text-1);
  line-height: 1.55;
}
.gate__option-text strong { font-weight: 600; color: var(--text-0); overflow-wrap: anywhere; }
/* The price of the option — visible, but not as an alarm. */
.gate__option-cost {
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  color: var(--text-2);
  font-size: var(--fs-m);
  line-height: 1.5;
}
.gate__btn { flex: 0 0 auto; padding: 7px 14px; }
.gate__btn--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-solid);
}
.gate__btn--primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

.gate__foot {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin-top: 20px;
  color: var(--text-2);
  font-size: var(--fs-m);
  line-height: 1.5;
}
.gate__link {
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-2);
  font-size: var(--fs-m);
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

/* Notice in the empty device frame when work continued without the header change. */
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
.device__blocked p { margin: 0; max-width: 300px; line-height: 1.5; font-size: var(--fs-m); }

/* ---------- Layout ---------- */

.body { display: flex; flex: 1 1 auto; min-height: 0; }

/* ---------- CSS editor (left panel) ---------- */

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

/* ---------- Feedback panel (right panel) ---------- */

.panel {
  position: relative;
  z-index: 35;
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
  gap: 6px;
  padding: 10px 10px 10px 12px;
  border-bottom: 1px solid var(--border);
}
/* In full window mode the header is the grip the card hangs from. */
.panel__head--grab { cursor: grab; user-select: none; touch-action: none; }
.panel--dragging .panel__head--grab { cursor: grabbing; }
.panel__grip {
  flex: none;
  display: grid;
  place-items: center;
  color: var(--text-2);
}
.panel__head--grab:hover .panel__grip { color: var(--text-1); }

/* Tail towards the feedback button: a rotated square whose upper half lies
   inside the card (same ground, same colour) and whose lower half sticks out
   as a point. Only the two visible edges carry a line. */
.panel-tail {
  position: fixed;
  z-index: 44;
  width: 14px;
  height: 14px;
  transform: rotate(45deg);
  background: var(--bg-1);
  border-bottom-right-radius: 3px;
  pointer-events: none;
  /* drop-shadow rather than box-shadow: the tail is a rotated box, and
     box-shadow would follow the unrotated square and stand behind the point as
     a skewed block. drop-shadow follows the shape actually visible. */
  filter: drop-shadow(var(--shadow-tail));
  animation: ink-fade-in .2s ease-out .04s both;
}
/* Only the two edges facing outwards carry a line — which ones those are
   depends on which side of the button the card lands. */
.panel-tail[data-side='top'] {
  border-right: 1px solid var(--border-strong);
  border-bottom: 1px solid var(--border-strong);
}
.panel-tail[data-side='bottom'] {
  border-left: 1px solid var(--border-strong);
  border-top: 1px solid var(--border-strong);
}
.panel-tail[data-side='right'] {
  border-left: 1px solid var(--border-strong);
  border-bottom: 1px solid var(--border-strong);
}
.panel-tail[data-side='left'] {
  border-right: 1px solid var(--border-strong);
  border-top: 1px solid var(--border-strong);
}
.root--fs.root--panel-closing .panel-tail { animation: ink-fade-out var(--dur-2) ease-in forwards; }
@keyframes ink-fade-out { to { opacity: 0; } }

/* Preview of the resting place while the card hangs off the pointer. */
.panel-ghost {
  position: fixed;
  z-index: 43;
  border-radius: var(--radius-l);
  border: 1px dashed var(--accent);
  background: var(--accent-dim);
  pointer-events: none;
  animation: ink-fade-in var(--dur-2) ease-out;
}
/* On the pointer: raised, and without a position transition that would lag. */
.panel--dragging {
  z-index: 60;
  animation: none !important;
  box-shadow: var(--shadow-l), 0 0 0 2px var(--accent);
}
.panel__title { font-weight: 600; }
.panel__count {
  min-width: 20px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: var(--fs-s);
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
  font-size: var(--fs-s);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* After a freshly drawn marking has faded out: two calm rings run out of the
   switch and the eye nods briefly — that shows where the marking reappears
   without yanking the gaze. The switch itself stands in the bar (toolbar or
   fsbar); the motion lives here, because both bars share it. */
@keyframes ink-mark-hint {
  0% { box-shadow: 0 0 0 0 var(--accent-dim); border-color: var(--accent); }
  35% { box-shadow: 0 0 0 8px var(--accent-fade); border-color: var(--accent); }
  45% { box-shadow: 0 0 0 0 var(--accent-dim); border-color: var(--accent); }
  80% { box-shadow: 0 0 0 8px var(--accent-fade); }
  100% { box-shadow: 0 0 0 0 var(--accent-fade); border-color: transparent; }
}
@keyframes ink-mark-hint-eye {
  0%, 30%, 60%, 100% { transform: none; }
  14% { transform: scale(1.22); }
  46% { transform: scale(1.14); }
}
/* overflow-x explicitly hidden: with only overflow-y set, the computed value
   for the other axis is auto as well — and the entries that slide in and out
   (ink-item-fresh/ink-item-remove translate sideways) then briefly push a
   horizontal scrollbar into the list. */
.panel__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
}
/* The empty state has to hold at every height the card can have: a fresh,
   never-filled card is as tall as this block, while one whose last entry was
   just deleted keeps the height it had — which may be the full 560 px or the
   two hundred of a single entry. Hence: centred but shrinkable, and scrollable
   as a last resort.

   "safe center" is what makes the last resort work. Plain centring pushes
   content that does not fit out over *both* edges, and what leaves at the top
   cannot be scrolled back — the heading would be gone for good. */
.panel__empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  gap: 12px;
  padding: 24px;
  overflow-y: auto;
  color: var(--text-2);
  text-align: center;
  /* Fading in rather than appearing: with the card's height held, the last row
     collapses into a space that then stands empty for a moment — the text
     should move into it, not be switched on in it. */
  animation: ink-fade-in var(--dur-3) ease-out;
}
.panel__empty p { margin: 0; line-height: 1.6; }
/* The illustration is the part that may go: it carries no information the two
   lines below it do not carry as well. It therefore shrinks first, keeping its
   proportions, and is gone entirely before a word is cut off. */
.panel__empty-art {
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  margin-bottom: 4px;
  color: var(--text-2);
}
.panel__empty-art svg {
  width: 112px;
  max-width: 100%;
  height: auto;
  max-height: 100%;
}

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
  font-size: var(--fs-m);
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
  font-size: var(--fs-xs);
  font-weight: 700;
  line-height: 16px;
}
.fb-page--other .fb-group__head { cursor: pointer; }

/* Feedback for a page or size that is not open right now: dimmed. Fully
   readable again on hover — the click does lead there, after all. */
.fb-group--off { opacity: .45; transition: opacity var(--dur-2) ease; }
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
.fb-group__size { color: var(--text-2); font-size: var(--fs-m); font-variant-numeric: tabular-nums; }
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
  color: var(--on-solid);
  font-size: var(--fs-xs);
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
  /* Wrap the note text rather than cutting it — long comments stay readable. */
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
  font-size: var(--fs-s);
}
/* The marking's dimensions — a pill of its own, so that it is not truncated
   along with the tool name next to it. */
.fb-item__size {
  flex: 0 0 auto;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-xs);
  white-space: nowrap;
}
/* Style changes proposed by the element picker. */
.fb-item__changes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}
.fb-chg-target {
  color: var(--text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-xs);
}
.fb-chg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.fb-chg-prop { color: var(--text-1); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.fb-chg-from { color: var(--text-2); text-decoration: line-through; }
.fb-chg-arr { color: var(--text-2); }
.fb-chg-to { color: var(--accent); font-weight: 600; }
/* A rewritten text is not a value pair — it is two paragraphs. Side by side in
   a 320 px panel they were squeezed into two columns a few characters wide,
   and with overflow-wrap: anywhere even the word "text" broke down into a
   vertical stack of single letters. So the parts go under one another: the
   label, the old wording struck through, the new one behind the arrow.

   And clamped: old to one line, new to two. A paragraph made one entry taller
   than the whole list; this much is enough to recognise it by, and the full
   text stands in the marker's own popup. */
.fb-chg--text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 5px;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
.fb-chg--text .fb-chg-prop,
.fb-chg--text .fb-chg-from { flex: 0 0 100%; }
.fb-chg--text .fb-chg-arr { flex: none; }
.fb-chg--text .fb-chg-to { flex: 1 1 0; min-width: 0; }
.fb-chg--text .fb-chg-from,
.fb-chg--text .fb-chg-to {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fb-chg--text .fb-chg-from { -webkit-line-clamp: 1; line-clamp: 1; }
.fb-chg--text .fb-chg-to { -webkit-line-clamp: 2; line-clamp: 2; }

/* Unfolds the rest of the changes. Deliberately a quiet link rather than a
   button with a frame: it stands among the change chips, and a second bordered
   box in that row would read as one more change. */
.fb-chg-more {
  padding: 1px 4px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-2);
  font: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
}
.fb-chg-more:hover { background: var(--bg-3); color: var(--text-0); }
.fb-chg-more:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

.fb-item__actions {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  visibility: hidden;
}
/* Deliberately no :hover — the state comes from React, because Chrome leaves
   :hover stuck when the pointer leaves the page or the panel unnoticed (the
   buttons would then stay put). */
.fb-item--hover .fb-item__actions,
.fb-item--editing .fb-item__actions { visibility: visible; }
/* Armed delete: the question lies over the row like a tooltip, hung off the
   button it belongs to.

   Out of the flow on purpose. In it, the words took their own width and every
   entry re-wrapped its text at the moment you armed the button — the row you
   were aiming at rearranged itself under the cursor. Its own ground, because it
   now covers the entry's text; but not red — the red is the button's, and that
   is the thing you press. It takes no clicks: the one target is the bin. */
.fb-del-wrap { position: relative; display: flex; }
.fb-item__confirm {
  position: absolute;
  right: 100%;
  top: 50%;
  margin-right: 6px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-l);
  color: var(--danger);
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  animation: ink-confirm-in .18s var(--ease-out) both;
}
@keyframes ink-confirm-in {
  from { opacity: 0; transform: translate(10px, -50%); }
  to { opacity: 1; transform: translate(0, -50%); }
}
/* Not display:none — the button has to keep its width (see FeedbackPanel). */
.fb-item__edit-hidden { visibility: hidden; }
.fb-item--editing { cursor: default; }
.fb-item__edit {
  width: 100%;
  resize: none;
  font: inherit;
  font-size: var(--fs-m);
  color: var(--text-0);
  background: var(--bg-0);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  padding: 4px 6px;
}
.fb-item__edit:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

/* Freshly added: the entry pushes in from the side and lights up once in the
   process — that way you see which row has just appeared and where it sorts
   itself in. Deliberately without a fill mode: afterwards hover and done state
   apply again. */
.fb-item--fresh { animation: ink-item-fresh .5s var(--ease-out); }
@keyframes ink-item-fresh {
  0% { opacity: 0; transform: translateX(-22px) scale(.97); background: var(--accent-dim); }
  60% { background: var(--accent-dim); }
  100% { opacity: 1; transform: none; }
}

/* The row the first-note hint is talking about, for as long as it stands.

   The hint cuts a hole over this row and blurs the rest of the card
   (veilWithin in hints.ts), but a hole is only an absence of blur — with a
   single note there is nothing around it yet that the sharpness could tell it
   apart from, and with ten there are nine sharp-edged neighbours a ring alone
   has to win against. The wash makes the row the brightest thing in the card,
   so the sentence has something to point at.

   Static, unlike ink-item-fresh: the hint's own ring already pulses around
   exactly this row, and a second beat inside it would be one movement too
   many. Hover keeps the wash — the neutral hover grey would take the marking
   off the row at the very moment the user reaches for it. */
.fb-item--explained,
.fb-item--explained:hover { background: var(--accent-dim); }

/* Deleted: the counterpart to ink-item-fresh. The entry slides to the side —
   to the right, towards the delete button the order came from — and the list
   then contracts over its measured height (--fb-h). Slide first, then
   contract: both at once looks like a rendering fault. The forwards keeps the
   row flat until React really tears it down; the duration pairs with
   REMOVE_MS. */
/* Each of the two halves carries its own curve.

   One shared cubic-bezier(.4, 0, .7, .2) governed both before, and that curve
   stays near zero for most of an interval and then shoots up. On the sideways
   slide that is exactly right; on the collapse it meant the row stood at full
   height for 240 of its 280 ms and then dropped in about fifty — a snap, not a
   movement, and the whole list under it jerked along. The collapse now eases
   out across its full share of the time. */
.fb-item--removing {
  overflow: hidden;
  pointer-events: none;
  animation: ink-item-remove .28s linear forwards;
}
@keyframes ink-item-remove {
  0% {
    max-height: var(--fb-h, 64px);
    opacity: 1;
    animation-timing-function: cubic-bezier(.4, 0, .7, .2);
  }
  45% {
    max-height: var(--fb-h, 64px);
    opacity: 0;
    transform: translateX(24px) scale(.98);
    animation-timing-function: cubic-bezier(.33, 0, .2, 1);
  }
  100% {
    max-height: 0;
    opacity: 0;
    transform: translateX(24px) scale(.98);
    padding-top: 0;
    padding-bottom: 0;
  }
}

/* Device badge clicked: the panel group concerned flashes briefly */
.fb-group--flash .fb-item { animation: ink-item-flash 1.6s ease-out; }
.fb-group--flash .fb-group__head { animation: ink-item-flash 1.6s ease-out; }
@keyframes ink-item-flash {
  0%, 100% { background: transparent; }
  20%, 60% { background: var(--accent-dim); }
}

/* Done state: check circle at the front, ticked entries dimmed */
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
  color: var(--on-solid);
}
.fb-check:hover { border-color: var(--text-1); }
.fb-check--done { background: var(--ok-solid); border-color: var(--ok-solid); }
.fb-item--done { opacity: .45; }
.fb-item--done .fb-item__label { text-decoration: line-through; }

/* Stale marker: the anchor cannot be found or is hidden in the current layout
   — the position is currently wrong, hence marked clearly as a warning. */
.fb-item__meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* A hint that the element only becomes visible after an interaction.
   Deliberately only a symbol in the meta colour: the row is narrow, and the
   explanation is in the tooltip. */
.fb-item__reveal {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  color: var(--text-2);
}

/* ---------- Sending feedback (panel footer) ---------- */

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
  color: var(--on-solid);
  font-weight: 600;
  font-size: var(--fs-m);
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
  font-size: var(--fs-s);
  color: var(--text-1);
}
.share-hint { color: var(--text-2); font-size: var(--fs-s); line-height: 1.45; }
.share-hint--error { color: var(--error-text); }
.share-hint--ok { color: var(--ok-text); }

/* ---------- Other domains (panel section) ---------- */

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
  font-size: var(--fs-m);
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
  transition: transform var(--dur-1) ease;
}
.fb-other__chev--open { transform: rotate(90deg); }
.fb-other__domain { cursor: default; }
.fb-other__domain:hover:not(:disabled) { background: var(--bg-2); color: var(--text-1); }
.fb-item--static { cursor: default; }

/* ---------- Device grid ---------- */

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
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  padding: 10px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  transition: border-color var(--dur-1) ease;
  /* Container for the title bar queries below. */
  container-type: inline-size;
}
.device--annotating { border-color: var(--accent); }

/* Focus: only the chosen card stands in the row, centred. The rest are hidden
   rather than unmounted — an unmount would reload every frame on leaving
   focus. The card itself glides to its new place via FLIP (Web Animations API
   in App.tsx). */
.grid--focus { justify-content: center; }
.grid--focus .device:not(.device--focused) { display: none; }
.device--focused { border-color: var(--accent); }
.device__bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 2px 8px;
  color: var(--text-1);
  /* Nothing may stick out past the card width (narrow cards). */
  overflow: hidden;
  /* Grip for the drag-and-drop ordering of the cards. */
  cursor: grab;
  user-select: none;
}
/* The secondary actions (touch, hide, focus, full page, rotate) always live in
   the ⋯ menu — only the counter, ⋯ and close stay visible. The button row stays
   in the DOM (invisibly), so that shortcuts and tests can still address it. */
.device__acts { display: none; }
.device__more { display: inline-grid; }
/* Narrow cards (low zoom / phone viewports): the size gives way too, so that
   name and close always fit. */
@container (max-width: 300px) {
  .device__size { display: none; }
}
.device__bar:active { cursor: grabbing; }

/* Menu of the secondary actions. It sits in the card, not in the title bar:
   that keeps overflow:hidden and would cut it off. */
.device__menu.menu {
  top: 34px;
  right: 8px;
  min-width: 0;
  width: max-content;
  max-width: calc(100% - 16px);
  z-index: 12;
}

/* The card is being dragged: leave it transparent, the target layout forms live. */
.device--dragging { opacity: .4; }
/* During the drag the iframes would otherwise swallow the dragover events. */
.grid--dragging .device__viewport iframe { pointer-events: none; }
.device__icon { display: grid; place-items: center; color: var(--text-2); }
/* The name may shrink — the card width is decided by the viewport alone. */
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
  font-size: var(--fs-m);
  padding: 1px 7px;
  background: var(--bg-2);
  border-radius: 999px;
}
.device__bar-spacer { flex: 1 1 auto; }
/* The counter is a button: a click opens the panel and highlights the group. */
.device__anno-count {
  min-width: 18px;
  padding: 1px 6px;
  border: none;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-solid);
  font-size: var(--fs-s);
  font-weight: 700;
  line-height: 1.4;
  text-align: center;
  cursor: pointer;
}
.device__anno-count:hover:not(:disabled) { background: var(--accent-hover); }

/* A short frame pulse when a panel entry jumps to this device. */
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
.device__viewport iframe {
  border: 0;
  display: block;
  transform-origin: top left;
}
/* The frame while it is still finding the position taken over from the page: a
   quiet sheet with one line on it, which then fades away and lets the frame
   through. It stands in for the page, so it takes the page's white
   (--canvas-bg, white in both themes) — and for the same reason its text
   colour is a fixed grey rather than --text-2: that one follows the tool's
   theme and would go pale on white in the dark one.

   The fade duration appears twice: here and as SETTLE_FADE_MS in
   DeviceFrame.tsx, which keeps the element around for it. Change one and you
   have to change the other. */
.device__settle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  background: var(--canvas-bg);
  color: #6b7280;
  font-size: 12px;
  letter-spacing: .01em;
  text-align: center;
  pointer-events: none;
  opacity: 1;
  transition: opacity .42s ease-out;
}
.device__settle span { animation: ink-settle-in .25s ease-out both; }
.device__settle--gone { opacity: 0; }
@keyframes ink-settle-in {
  from { opacity: 0; }
  to { opacity: .85; }
}

/* ---------- Full-page mode: the fold and the real viewport ---------- */

/* The box over the upper part of the page is the viewport that would really
   apply on the device. Purely decorative: drawing, clicking and hovering pass
   straight through. */
/* Deliberately without a z-index: being positioned is enough to lie above the
   frame, and the DOM order keeps the annotation overlay above it — otherwise
   the veil would dim the markings below the fold along with it. */
.fold,
.fold-rest {
  position: absolute;
  left: 0;
  right: 0;
  pointer-events: none;
}
.fold {
  top: 0;
  box-shadow: inset 0 0 0 1px var(--accent);
  border-bottom: 2px dashed var(--accent);
}
/* Below the fold: set apart slightly, so that it is clear at a glance what
   only comes after scrolling. Deliberately faint — the page underneath should
   still be judgeable. */
.fold-rest {
  bottom: 0;
  background: color-mix(in srgb, var(--bg-0) 10%, transparent);
}
.fold__tag {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-solid);
  font-size: var(--fs-xs);
  font-weight: 700;
  line-height: 15px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* The two edge labels sit at the fold — just above it and just below. */
.fold__tag--line {
  top: auto;
  bottom: 4px;
  left: auto;
  right: 4px;
  background: color-mix(in srgb, var(--accent) 88%, black);
}
.fold__tag--rest {
  top: 4px;
  left: auto;
  right: 4px;
  background: var(--border-strong);
  color: var(--text-1);
}
/* Very low zoom: the labels would plaster the box over. */
.device__viewport--full .fold__tag { max-width: calc(100% - 8px); overflow: hidden; }

/* ---------- Annotation overlay ---------- */

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
/* Outside correction mode, only a marking's outline (plus its handles) catches
   mouse events — everything beside it still belongs to the page. */
.anno__hit {
  pointer-events: stroke;
  cursor: grab;
}
.anno__hit--area { pointer-events: all; }
.anno__handles rect { pointer-events: all; }
/* During a drag the whole overlay catches, so that it does not tear off as
   soon as the pointer leaves the outline. */
.anno--dragging .anno__svg { pointer-events: auto; }
/* Your own marking under the cursor: it can be dragged by its outline. */
.anno--grab .anno__svg,
.anno--grab .anno__hit { cursor: grab; }
.anno--grabbing .anno__svg,
.anno--grabbing .anno__hit { cursor: grabbing; }
/* Resizing at a box's handles. */
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
/* Grabbable (hover) and being dragged: a dashed or solid frame around the
   marker — the cursor alone does not give away *which* marking is meant. */
.anno__mark-grab { animation: ink-anno-fade 120ms ease-out; }
.anno__mark-drag { animation: ink-anno-fade 90ms ease-out; }
@keyframes ink-anno-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* The dragged marker visibly hangs off the mouse. */
.anno__moving { opacity: .85; filter: drop-shadow(var(--shadow-mark)); }
/* A double pulse around the marker jumped to from the panel. */
/* Freshly drawn while "Show markings" is off: the marking stays briefly, so
   that you still see it, and then fades out softly rather than disappearing
   abruptly. The duration matches FADE_MS in App.tsx. */
.anno__fade { animation: ink-mark-fade 1.2s var(--ease-in-out) forwards; }
@keyframes ink-mark-fade {
  0% { opacity: 1; }
  45% { opacity: 1; }
  100% { opacity: 0; }
}

.anno__flash { animation: ink-anno-flash 1.8s ease-out forwards; }
@keyframes ink-anno-flash {
  0% { opacity: 0; }
  12% { opacity: 1; }
  35% { opacity: .25; }
  55% { opacity: 1; }
  100% { opacity: 0; }
}
/* The note bubble fades in briefly on hover. */
.anno__bubble { animation: ink-bubble-in var(--dur-2) ease-out; }
@keyframes ink-bubble-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.anno__input {
  position: absolute;
  pointer-events: auto;
  min-width: 150px;
  max-width: calc(100% - 16px);
  background: var(--anno-field-bg);
  border-width: 1.5px;
  border-radius: var(--radius-s);
  font-weight: 600;
  box-shadow: var(--shadow-l);
}
/* Action buttons on the hovered element marker (edit / delete). */
/* Action bar of the hovered marking: sits centred *inside* it — that is where
   the eye looks, and it does not cover the outline. A round capsule with a soft
   glass background, so that the marking underneath shows through. */
.anno__acts {
  position: absolute;
  z-index: 8;
  transform: translate(-50%, -50%);
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  /* An opaque fallback first — older engines discard color-mix and would
     otherwise stand there with no background. */
  background: var(--bg-2);
  background: color-mix(in srgb, var(--bg-2) 88%, transparent);
  backdrop-filter: blur(6px);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  box-shadow: var(--shadow-l);
  pointer-events: auto;
  animation: ink-acts-in var(--dur-2) var(--ease-out);
}
@keyframes ink-acts-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(.88); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
.anno__act {
  display: grid;
  place-items: center;
  /* Reset the base button padding, or the icon sits off centre. */
  padding: 0;
  line-height: 0;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  transition: background var(--dur-1) ease, color var(--dur-1) ease, transform var(--dur-1) ease;
}
.anno__act:hover { background: var(--bg-3); color: var(--text-0); transform: scale(1.08); }
.anno__act--danger:hover { background: var(--danger-dim); color: var(--danger); }

/* Large variant: there is room for it inside the element marker's rectangle,
   and the buttons are then easy to hit even at low zoom. */
.anno__acts--lg { gap: 6px; padding: 5px; }
.anno__acts--lg .anno__act { width: 40px; height: 40px; }

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
/* Extra field in the note editor (the gap of a line pair). */
.anno__note-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 6px;
  color: var(--text-1);
  font-size: var(--fs-m);
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
  font-size: var(--fs-s);
}

/* ---------- Element picker: edit popup (box model/font) ---------- */

/* Fixed in the viewport (portalled into the app root) and above the floating
   tool bar (z 45) — the popup must never be covered. The inner spacing sits
   left, right and bottom; at the top the sticky header takes it over. */
.anno__inspect {
  /* One column width for every row label. Before, each kind of row had its own
     (46px fixed, auto for "Apply to", auto for the spacings), which is why the
     select, the switch and the number fields all started at three different
     edges. The value goes by the longest label with a dot in front of it —
     PADDING. */
  --insp-label-w: 56px;
  position: fixed;
  z-index: 56;
  pointer-events: auto;
  width: 300px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-l);
  padding: 0 10px 10px;
  font-size: var(--fs-m);
  color: var(--text-1);
  animation: ink-bubble-in var(--dur-1) ease-out;
}
.anno__inspect.is-dragging {
  animation: none;
  box-shadow: var(--shadow-drag), 0 0 0 2px var(--accent);
}

/* The header (identity + scope) stays put in case the content is ever longer
   than the screen — otherwise the close button scrolls away. */
.anno__inspect-top {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0 -10px 12px;
  padding: 10px 10px 10px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--border);
}
/* The header is the drag grip. */
.anno__inspect-head {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.anno__inspect.is-dragging .anno__inspect-head { cursor: grabbing; }
/* Grip dots: a quiet invitation to drag the header. */
.anno__inspect-grip {
  flex: none;
  display: grid;
  place-items: center;
  color: var(--text-2);
}
.anno__inspect-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
/* The element's tag as a chip — identity at a glance, with the id/class
   remainder next to it in the title. */
.anno__tagchip {
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-dim);
  color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-s);
  font-weight: 600;
}
.anno__inspect-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  color: var(--text-0);
}
.anno__inspect-dims {
  flex: none;
  white-space: nowrap;
  color: var(--text-2);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}
.anno__ibtn {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  display: grid;
  place-items: center;
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}
.anno__ibtn:hover:not(:disabled) {
  background: var(--bg-3);
  color: var(--text-0);
}

/* Tab content: the gap sets the rhythm, the rows themselves no longer carry
   outer spacing of their own. */
/* 12px separates groups, 4–6px holds together what belongs together. Before,
   the same value (8px) was everywhere: the distance between a label and its
   field was therefore the same as the one between two sections, and the popup
   read as one long row of equally important lines instead of three blocks. */
.anno__inspect-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* Key hint under the fields — the same language as the note popup. */
/* Keyboard help for the fields above. Since the fields span the full width it
   needs no indent any more — it begins at the same edge as the fields it
   explains. One step smaller than the labels: you read it once and never
   again. */
.anno__inspect-keys {
  /* Belongs to the fields above, not to the next section — which is why it
     pulls the section gap back to group spacing. */
  margin-top: -6px;
  color: var(--text-2);
  font-size: var(--fs-xs);
}

/* Scope switch: the whole class (default) vs. this element only. */
.anno__scope {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.anno__scope-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.anno__scope-row .anno__inspect-row-label { padding-top: 0; }
.anno__seg {
  flex: 1 1 auto;
  display: flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  overflow: hidden;
}
.anno__seg button {
  flex: 1 1 0;
  padding: 4px 10px;
  font-size: var(--fs-s);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-1);
}
.anno__seg button + button { border-left: 1px solid var(--border-strong); }
/* The ring has to go inwards: the rail has overflow: hidden, and a focus ring
   offset outwards is clipped at its edge and not visible at all on the two
   outer sides. Same weight, only inside. */
.anno__seg button:focus-visible { outline-offset: -2px; }
.anno__seg button:hover:not(:disabled):not(.is-active) { background: var(--bg-3); }
/* Selected, but quieter than the main action. This switch used to be filled
   solidly with the accent — the same treatment as "Add marker" below it, even
   though it only sets the scope and triggers nothing. The switch was therefore
   in front and the button behind. The accent stays as meaning (this is what
   applies) but disappears as a surface. */
.anno__seg button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.anno__seg button.is-active {
  background: var(--accent-dim);
  color: var(--text-0);
  font-weight: 600;
}
/* The match count directly on the "Class" button: the reach therefore stands
   on the switch that causes it, and not only in the sentence below. */
.anno__seg-count {
  font-style: normal;
  font-size: var(--fs-xs);
  line-height: 1;
  padding: 2px 5px;
  border-radius: 999px;
  background: var(--bg-3);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.anno__seg button.is-active .anno__seg-count {
  background: var(--accent);
  color: var(--on-solid);
}
/* Says in plain words what a change hits — full width under the switch, so
   that long class names have room too. */
/* An explanatory sentence, not code — hence running text and not a
   typewriter. It may also wrap: "No class — changes apply to this element
   only" does not fit on one line in 300px and used to be cut off behind "…",
   at exactly the point where the actual statement stands. */
.anno__scope-note {
  min-width: 0;
  font-size: var(--fs-s);
  line-height: 1.4;
  color: var(--text-1);
}
/* Only the selector itself is code. */
.anno__scope-sel {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text-0);
  overflow-wrap: anywhere;
}
/* Match count of the class rule — says how far a change reaches. */
.anno__scope-count { font-style: normal; color: var(--text-2); }

/* Tab bar in the header: "Content" (text + note) as the default, "Style" for
   everything technical — scope, font, box model, change list. */
/* Switch between the two views. As a pair in one rail, not as two loose
   buttons: before, the active tab carried a surface and a border and the other
   nothing at all — which read like a button next to a link, even though the two
   are equals. The rail makes it visible that these are two states of the same
   thing. */
.anno__tabs {
  display: flex;
  gap: 2px;
  margin-top: 10px;
  padding: 2px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
}
.anno__tab {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 8px;
  font-size: var(--fs-s);
  font-weight: 600;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--text-2);
}
.anno__tab:hover:not(.is-active) { background: var(--bg-3); color: var(--text-1); }
/* Inwards as well — in the 2px-narrow rail an outward ring presses against the
   neighbouring tab and looks heavier than it is. */
.anno__tab:focus-visible { outline-offset: -2px; }
/* Selected here means: lifted out of the rail. The first attempt used --bg-0
   for that — but that is only one step below the rail itself (--bg-1), and both
   are nearly black. The result was one continuous dark bar in which you could
   no longer tell which tab was open. Lighter rather than darker solves it: the
   selection lies on top. */
.anno__tab.is-active {
  background: var(--bg-3);
  border-color: transparent;
  color: var(--text-0);
}
/* Counter on the Style tab — gives away pending changes without opening the tab. */
.anno__tab-count {
  font-style: normal;
  font-size: var(--fs-xs);
  line-height: 1;
  padding: 2px 5px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-solid);
  font-variant-numeric: tabular-nums;
}

/* Spacing as a narrow table: a header row (unit + sides), and below it one row
   each for margin and padding with a link button of its own. */
.anno__spacing {
  display: grid;
  grid-template-columns: var(--insp-label-w) repeat(4, 1fr) auto;
  align-items: center;
  /* Rows a little airier than columns: the four number fields of a row belong
     together, margin and padding are two different things. */
  gap: 7px 5px;
}
.anno__sp-unit,
.anno__sp-h {
  font-size: var(--fs-xs);
  letter-spacing: .04em;
  color: var(--text-2);
}
.anno__sp-unit { text-transform: uppercase; }
.anno__sp-h { text-align: center; }
/* The same label idiom as Font/Width/Apply to: small, uppercased, held back.
   Before, two sorts of label stood under each other in the same column — "PX"
   small and uppercase, "Padding" mixed case and larger. */
.anno__sp-lab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 4px;
  font-size: var(--fs-xs);
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--text-2);
}
/* The spacing now comes from the row's gap — otherwise it would be there twice. */
.anno__sp-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
/* The same tones as the bands in the overlay — row and frame belong together. */
.anno__sp-dot--m { background: var(--boxmodel-margin); }
.anno__sp-dot--p { background: var(--boxmodel-padding); }
.anno__link {
  justify-self: center;
  width: 20px;
  height: 18px;
  padding: 0;
  display: grid;
  place-items: center;
  color: var(--text-2);
  background: transparent;
  border-color: transparent;
}
.anno__link:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
.anno__link.is-active {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
.anno__sp-in {
  width: 100%;
  min-width: 0;
  padding: 4px 2px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  cursor: ew-resize; /* Dragging changes the value */
  appearance: textfield;
  -moz-appearance: textfield;
}
.anno__sp-in::-webkit-inner-spin-button,
.anno__sp-in::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.anno__sp-in.is-zero { color: var(--text-2); }
.anno__sp-in:focus,
.anno__sp-in:focus-visible { border-color: var(--accent); outline: none; cursor: text; }

/* Auto margin: no number field, because the measurement there is only the
   result of the centring. A click deliberately releases the side as a number. */
.anno__sp-auto {
  display: grid;
  place-items: center;
  width: 100%;
  min-width: 0;
  padding: 4px 2px;
  border-radius: var(--radius-s);
  background: var(--warn-bg);
  border: 1px dashed var(--warn-border);
  color: var(--warn-text);
  font-size: var(--fs-s);
  font-style: italic;
  cursor: not-allowed;
}
.anno__sp-warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 6px 8px;
  border-radius: var(--radius-s);
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  color: var(--warn-text);
  font-size: var(--fs-xs);
  line-height: 1.4;
}
.anno__sp-warn svg { flex: none; margin-top: 1px; }
.anno__sp-warn b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }

/* Property name in a value row (max-width, for instance). */
.anno__inspect-prop {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-s);
  color: var(--text-1);
}
/* A value that cannot be edited here (percent, ch, vw …). */
.anno__inspect-static {
  flex: none;
  padding: 4px 7px;
  border-radius: var(--radius-s);
  background: var(--bg-0);
  border: 1px dashed var(--border-strong);
  color: var(--text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-s);
}

/* Text and note field — the same build, so that the two dark boxes can be told
   apart even with content in them. */
/* Long inputs stand under their label, not next to it. In the 300px-narrow
   popup the label column costs 56px — a fifth of the width — and does so
   exactly where writing actually happens. Short properties (font, spacing,
   scope) keep the column: there, name and value belong on one line, and the
   values are narrow. Two idioms, then, but by a clear rule — running text
   stacked, settings side by side. */
.anno__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.anno__field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.anno__field-label {
  font-size: var(--fs-xs);
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--text-2);
}
/* Says in three words where what you type goes. Lower case separates the hint
   from the uppercased label without needing a second colour. */
.anno__field-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--text-2);
}
.anno__field .anno__text-in {
  flex: none;
  width: 100%;
}
.anno__text-in {
  flex: 1 1 auto;
  min-width: 0;
  /* The height comes from the content (fitToText in InspectPanel), so the grab
     handle would only fight it — and past the ceiling the box scrolls. */
  resize: none;
  font: inherit;
  font-size: var(--fs-m);
  line-height: 1.4;
  color: var(--text-0);
  background: var(--bg-0);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  padding: 5px 7px;
}
.anno__text-in:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

/* Font row — only appears where there is direct text. */
.anno__inspect-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
/* A fixed width, so that element/font/note line up under each other. */
.anno__inspect-row-label {
  flex: none;
  width: var(--insp-label-w);
  padding-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--text-2);
}
.anno__inspect-row .anno__inspect-row-label { padding-top: 0; }
.anno__inspect-weight {
  flex: 1 1 auto;
  min-width: 0;
  padding: 5px 6px;
}
.anno__inspect-size {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}
.anno__font-in {
  width: 52px;
  padding: 5px 6px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  cursor: ew-resize;
  appearance: textfield;
  -moz-appearance: textfield;
}
.anno__font-in::-webkit-inner-spin-button,
.anno__font-in::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.anno__font-in:focus,
.anno__font-in:focus-visible { border-color: var(--accent); outline: none; cursor: text; }
.anno__inspect-unit { color: var(--text-2); font-size: var(--fs-s); }

/* Pending changes — a preview of what goes into the feedback. */
.anno__changes {
  padding-top: 10px; /* + 12px body gap = a section break with a rule */
  border-top: 1px solid var(--border-strong);
}
.anno__changes-cap {
  display: block;
  margin-bottom: 6px;
  font-size: var(--fs-xs);
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--text-2);
}
/* One change per row across the full width — which puts the revert always in
   the same place on the far right. */
.anno__changes-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* The same diff language as in the feedback panel (old struck through → new in
   accent) rather than chip boxes — calmer and recognisable. */
.anno__chg {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0 2px 2px;
  font-size: var(--fs-s);
  font-variant-numeric: tabular-nums;
}
.anno__chg-prop {
  flex: none;
  color: var(--text-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.anno__chg-from { color: var(--text-2); text-decoration: line-through; }
.anno__chg-arr { flex: none; color: var(--text-2); }
.anno__chg-to { color: var(--accent); font-weight: 600; }
/* Text changes are longer than numeric values — they may wrap. */
.anno__chg--text { align-items: flex-start; overflow-wrap: anywhere; }
.anno__chg--text .anno__chg-prop,
.anno__chg--text .anno__chg-arr { padding-top: 1px; }
/* Revert a single change without touching the rest. */
.anno__chg-x {
  flex: none;
  width: 16px;
  height: 16px;
  margin-left: auto; /* always flush right, however long the values are */
  padding: 0;
  display: grid;
  place-items: center;
  background: transparent;
  border: 0;
  border-radius: 3px;
  color: var(--text-2);
}
.anno__chg-x:hover:not(:disabled) { background: var(--danger-dim); color: var(--danger); }
.anno__chg-more {
  margin-top: 5px;
  padding: 2px 7px;
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text-1);
  font-size: var(--fs-s);
}
.anno__chg-more:hover:not(:disabled) { background: var(--bg-3); color: var(--text-0); }

/* The actions stay at the bottom, even when the content scrolls. */
.anno__inspect-foot {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px -10px -10px;
  padding: 8px 10px 10px;
  background: var(--bg-2);
  border-top: 1px solid var(--border);
}
.anno__inspect-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
}
/* Reset as a quiet secondary action — it only appears once edits are pending. */
.anno__inspect-ghost {
  flex: none;
  background: transparent;
  border-color: transparent;
  color: var(--text-1);
}
.anno__inspect-ghost:hover:not(:disabled) { background: var(--bg-3); color: var(--text-0); }
/* The one main action: saves element + edits as a feedback marker. */
.anno__inspect-cta {
  flex: 1 1 auto;
  justify-content: center;
  background: var(--accent);
  border-color: transparent;
  color: var(--on-solid);
  font-weight: 600;
}
.anno__inspect-cta:hover:not(:disabled) { background: var(--accent-hover); }

/* ---------- Tool palette (context menu on right-click) ---------- */

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
  animation: ink-palette-in var(--dur-1) ease-out;
}
@keyframes ink-palette-in {
  from { opacity: 0; transform: scale(.95); }
  to { opacity: 1; transform: none; }
}
.palette__sep { width: 1px; height: 20px; background: var(--border-strong); margin: 0 3px; flex: 0 0 auto; }

/* The "Draw" group: the button carries the drawing tool last used, the flyout
   the rest. Keeps the bar short — only the element picker and the pin stand
   there directly now. */
.tool-group { position: relative; display: inline-flex; }
/* A small corner at the bottom right — makes the button recognisable as a group. */
.tool-group__caret {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 0;
  height: 0;
  border-left: 3.5px solid transparent;
  border-bottom: 3.5px solid currentColor;
  opacity: .5;
}
.tool-group__btn--open .tool-group__caret,
.tool-group__btn.icon-btn--active .tool-group__caret { opacity: 1; }

/* The flyout hangs in the shell root, not in the bar: the floating bar scrolls
   when space is short and would otherwise cut it off. The component
   (ToolButtons) works out the position next to the button. */
.tool-group__menu {
  position: fixed;
  z-index: 52;
  display: flex;
  gap: 3px;
  padding: 6px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-l);
  animation: ink-hint-in var(--dur-1) ease-out;
}
.tool-group__menu--col { flex-direction: column; }

.swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  margin: 0 2px;
  border-radius: 50%;
  border: 2px solid transparent;
  flex: 0 0 auto;
  transition: transform var(--dur-1) ease, box-shadow var(--dur-1) ease;
}
.swatch:hover { transform: scale(1.12); }
.swatch--active { border-color: var(--bg-2); box-shadow: 0 0 0 2px var(--text-0); }

/* ---------- Full window mode ---------- */

/* Without a toolbar the loading bar sits right at the top. */
.root--fs .loadbar { top: 0; }

.fs-stage {
  flex: 1 1 auto;
  min-width: 0;
  position: relative;
  overflow: hidden;
  background: var(--canvas-bg);
}

/* Bare device (full window): no card chrome, frame without a border. */
.device--bare { padding: 0; border: none; border-radius: 0; background: transparent; }
.device--bare .device__viewport { border: none; border-radius: 0; }
.device--annotating.device--bare .device__viewport {
  box-shadow: inset 0 0 0 2px var(--accent);
}

/* Feedback panel in full window mode: a floating card at the feedback button
   in the bar. Position and origin are supplied inline by dockPanelAnchor — it
   therefore visibly grows out of the button and sits directly above it. The
   values here only apply for as long as nothing has been measured yet. */
.root--fs .panel--right {
  position: fixed;
  top: auto;
  left: auto;
  right: 14px;
  bottom: 92px;
  max-width: calc(100vw - 28px);
  max-height: min(62vh, 560px);
  z-index: 44;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  overflow: hidden;
  box-shadow: var(--shadow-l);
  transform-origin: 100% calc(100% + 30px);
  animation: fs-sheet-in .24s var(--ease-out);
}
@keyframes fs-sheet-in {
  from { opacity: 0; transform: scale(.82); }
  to { opacity: 1; transform: scale(1); }
}
/* Clicked away, the sheet pushes back to the edge it came from. */
.root--fs.root--panel-closing .panel--right {
  animation: fs-sheet-out var(--dur-2) ease-in forwards;
  pointer-events: none;
}
@keyframes fs-sheet-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(.86); }
}

/* Tool bar: free in the window ('free'), at the left edge as a Photoshop
   toolbox ('left') or horizontally at the bottom ('bottom'). The change is
   animated — shape and position morph into one another. */
.fsbar {
  animation: none;
  z-index: 45;
  scrollbar-width: none;
  transition:
    left .22s var(--ease-out),
    top .22s var(--ease-out),
    transform .22s var(--ease-out),
    box-shadow var(--dur-2) ease,
    border-radius var(--dur-2) ease,
    padding var(--dur-2) ease;
}
.fsbar::-webkit-scrollbar { display: none; }
.fsbar .icon-btn { transition: background var(--dur-1) ease, color var(--dur-1) ease, transform var(--dur-2) ease; }

.fsbar--free {
  top: auto;
  bottom: auto;
  right: auto;
  transform: none;
  flex-direction: column;
  max-height: calc(100vh - 28px);
  overflow-y: auto;
}
.fsbar--left,
.fsbar--right {
  top: 50%;
  bottom: auto;
  transform: translateY(-50%);
  flex-direction: column;
  max-height: calc(100vh - 28px);
  overflow-y: auto;
}
.fsbar--left { left: 14px; right: auto; transform-origin: left center; }
.fsbar--right { right: 14px; left: auto; transform-origin: right center; }
.fsbar--top {
  top: 18px;
  bottom: auto;
  left: 50%;
  right: auto;
  transform: translateX(-50%);
  transform-origin: center top;
  flex-direction: row;
  max-width: calc(100vw - 28px);
  overflow-x: auto;
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
/* On the pointer: raised, without a position transition (which would lag). */
.fsbar--dragging {
  transform: scale(1.04);
  transition: box-shadow var(--dur-2) ease, transform var(--dur-2) ease;
  cursor: grabbing;
  box-shadow: var(--shadow-drag), 0 0 0 2px var(--accent);
}

/* Separators lie across the bar's axis and run the full button width — shorter
   ones looked like a fault in the grid. */
.fsbar .palette__sep { align-self: stretch; }
.fsbar--left .palette__sep,
.fsbar--right .palette__sep,
.fsbar--free .palette__sep { width: auto; height: 1px; margin: 6px 2px; }
.fsbar--top .palette__sep,
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
.fsbar--top .fsbar__grip svg,
.fsbar--bottom .fsbar__grip svg { transform: rotate(90deg); }

/* The colours follow the bar's axis — stacked vertically they save width. More
   air than between the buttons: the dots are smaller and would otherwise run
   together into a chain. */
.fsbar__swatches {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 0 0 auto;
}
.fsbar--left .fsbar__swatches,
.fsbar--right .fsbar__swatches,
.fsbar--free .fsbar__swatches { flex-direction: column; padding: 5px 0; }
.fsbar--top .fsbar__swatches,
.fsbar--bottom .fsbar__swatches { flex-direction: row; padding: 0 5px; }
.fsbar .swatch { margin: 0; }

/* ---------- The full-window bar as the only interface ----------
   In full window mode the bar carries everything: modes, preview, feedback,
   the way out. It is therefore the only add-on element on the page — before,
   four separate buttons lay scattered across three corners. Slightly
   translucent with a blur, so that it floats over the page rather than looking
   glued on (the same make as the marker actions). */
.root--fs .fsbar {
  gap: 6px;
  padding: 7px;
  border-radius: 18px;
  background: var(--bg-2); /* Fallback, falls color-mix fehlt */
  background: color-mix(in srgb, var(--bg-2) 94%, transparent);
  backdrop-filter: blur(14px) saturate(1.3);
}
.root--fs .fsbar .icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 11px;
}
.root--fs .fsbar .icon-btn svg { width: 20px; height: 20px; }
/* The buttons respond noticeably: a slight lift on hover, sinking in on press.
   Without that, a floating bar feels dead. */
.root--fs .fsbar .icon-btn {
  transition: background var(--dur-2) ease, color var(--dur-2) ease, transform var(--dur-2) var(--ease-out);
}
.root--fs .fsbar .icon-btn:hover:not(:disabled) { transform: translateY(-1px); }
.root--fs .fsbar .icon-btn:active:not(:disabled) { transform: scale(.93); }
.root--fs .fsbar--left .icon-btn:hover:not(:disabled),
.root--fs .fsbar--right .icon-btn:hover:not(:disabled),
.root--fs .fsbar--free .icon-btn:hover:not(:disabled) { transform: translateX(1px); }

/* Entrance at startup — this is the bar one meets first, since a first start
   opens in full window mode. It grows out of the edge it is docked against
   (transform-origin per dock, set above) and then announces itself once more
   with a calm ring, so it is not only seen arriving but found again a second
   later.

   The growing runs on the scale property rather than on transform: the
   docks position themselves with transform (translateX(-50%) at top and
   bottom), and a transform keyframe would tear the bar out of the middle of
   the window for the length of the animation. */
.fsbar--intro {
  animation:
    fs-dock-in .3s var(--ease-out),
    fs-dock-notice 1s ease-out .35s 2;
}
@keyframes fs-dock-in {
  from { opacity: 0; scale: .86; }
}
@keyframes fs-dock-notice {
  0% { box-shadow: var(--shadow-l), 0 0 0 0 var(--accent-dim); }
  45% { box-shadow: var(--shadow-l), 0 0 0 12px var(--accent-dim); }
  100% { box-shadow: var(--shadow-l), 0 0 0 20px transparent; }
}

/* The two modes are mutually exclusive and therefore sit in a shared trough —
   you see immediately that this is an either/or choice and which mode you are
   in. */
.fsbar__modes {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 14px;
  background: var(--bg-0);
  flex: 0 0 auto;
}
.fsbar--left .fsbar__modes,
.fsbar--right .fsbar__modes,
.fsbar--free .fsbar__modes { flex-direction: column; }

/* The view switch in full window mode: symbol only, the state sits in the
   trough (icon-btn--active) and in the tooltip. Labelled, the bar would be
   wider than what it covers. */
.fsbar__toggle--hint { animation: ink-mark-hint 1.7s var(--ease-out); }
.fsbar__toggle--hint svg { animation: ink-mark-hint-eye 1.7s var(--ease-out); }

/* The feedback button carries the number of open entries right next to the
   symbol — as an applied bubble it used to be a second, foreign element. */
.root--fs .fsbar .fsbar__feedback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: auto;
  min-width: 38px;
  padding: 0 9px;
}
.fsbar__count {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-solid);
  font-size: var(--fs-xs);
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
/* Vertically there is no width to give away: there the number sits as a corner
   mark on the button, so that the column stays a column. */
.fsbar--left .fsbar__feedback,
.fsbar--right .fsbar__feedback,
.fsbar--free .fsbar__feedback { position: relative; }
.root--fs .fsbar--left .fsbar__feedback,
.root--fs .fsbar--right .fsbar__feedback,
.root--fs .fsbar--free .fsbar__feedback { width: 38px; padding: 0; }
.fsbar--left .fsbar__count,
.fsbar--right .fsbar__count,
.fsbar--free .fsbar__count {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 15px;
  padding: 0 3px;
  font-size: var(--fs-2xs);
  line-height: 15px;
  box-shadow: 0 0 0 2px var(--bg-2);
}

/* New feedback while the list is shut: the button knocks briefly. */
.fsbar__feedback--pulse { animation: fs-feedback-pulse .6s ease-out 2; }
@keyframes fs-feedback-pulse {
  0% { box-shadow: 0 0 0 0 var(--accent-dim); }
  35% { box-shadow: 0 0 0 6px var(--accent-dim); }
  100% { box-shadow: 0 0 0 12px transparent; }
}

/* Click shield during the drag: catches everything that would otherwise land
   in the page's iframe (where the pointermove events would never arrive). */
.fsbar-shield {
  position: fixed;
  inset: 0;
  /* Above all floating chrome (panel 44, bar/FAB/phone 45–47): during a drag,
     release clicks must not hit foreign buttons — or the panel or the mockup
     would close as you drag over them. */
  z-index: 59;
  cursor: grabbing;
}

/* Snap points, visible only during the drag. */
.fsbar-snap {
  position: fixed;
  z-index: 44;
  border-radius: 999px;
  background: var(--accent-dim);
  border: 1px dashed var(--accent);
  opacity: .45;
  pointer-events: none;
  transition: opacity var(--dur-2) ease, transform var(--dur-2) ease, background var(--dur-2) ease;
  animation: ink-fade-in var(--dur-2) ease-out;
}
.fsbar-snap--left { left: 14px; top: 50%; width: 46px; height: 210px; transform: translateY(-50%); }
.fsbar-snap--right { right: 14px; top: 50%; width: 46px; height: 210px; transform: translateY(-50%); }
.fsbar-snap--top { top: 18px; left: 50%; width: 320px; height: 46px; transform: translateX(-50%); }
.fsbar-snap--bottom { bottom: 18px; left: 50%; width: 320px; height: 46px; transform: translateX(-50%); }
.fsbar-snap--on { opacity: 1; background: var(--accent-dim); }
.fsbar-snap--left.fsbar-snap--on,
.fsbar-snap--right.fsbar-snap--on { transform: translateY(-50%) scale(1.06); }
.fsbar-snap--top.fsbar-snap--on,
.fsbar-snap--bottom.fsbar-snap--on { transform: translateX(-50%) scale(1.06); }

/* ---------- Hover tooltip (components/Tooltip.tsx) ----------

   Name of the hovered button. It applies to the whole interface, not just to
   the tool bar — the class used to be called fsbar__hint and therefore sat in
   this section; it stays here so that the diff remains readable.

   The bubble hangs off an anchor point and moves to its place via transform.
   That saves the measuring pass: otherwise it would have to render first and
   then jump. */
.tip {
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
  font-size: var(--fs-m);
  white-space: nowrap;
  pointer-events: none;
  animation: ink-hint-in var(--dur-1) ease-out;
}
.tip--above { transform: translate(-50%, -100%); }
.tip--below { transform: translateX(-50%); }
.tip--right { transform: translateY(-50%); }
.tip--left { transform: translate(-100%, -50%); }
@keyframes ink-hint-in { from { opacity: 0; } to { opacity: 1; } }

/* Wrapping variant for longer explanations (the CSP indicator). */
.tip--wide {
  display: block;
  white-space: normal;
  width: 250px;
  padding: 8px 11px;
  line-height: 1.45;
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

/* ---------- Light theme ---------- */

.root[data-theme="light"] {${LIGHT_VARS}}
@media (prefers-color-scheme: light) {
  .root[data-theme="system"] {${LIGHT_VARS}}
}

/* Colour preview in the settings row. */
.menu__swatches { display: flex; gap: 2px; }
.menu__swatches i { width: 6px; height: 12px; border-radius: 2px; }

/* ---------- Screenshot export ---------- */

/* captureVisibleTab photographs the visible tab, and therefore everything the
   add-on lays over the page too. During the export this chrome keeps out of the
   way — in full window mode the tool bar would otherwise lie on every single
   slice. The frame itself is left untouched, so that the crop does not shift. */
.root--capturing .fsbar,
.root--capturing .phone-prev,
.root--capturing .tool-group__menu,
.root--capturing .anno__acts,
.root--capturing .tip,
.root--capturing .nudge-layer { display: none !important; }
/* In full window mode the panel floats over the page. On the grid it stands
   beside it — and there it has to stay, or the width of the cards changes in the
   middle of the export and the crop no longer fits. */
.root--capturing.root--fs .panel { display: none !important; }
/* During the capture the frame scrolls through the page itself — a user's mouse
   wheel would shift the slices against each other. The page therefore accepts
   no more pointer events. */
.root--capturing .device__viewport iframe { pointer-events: none; }
/* Straighten the corners for the capture. Together with overflow:hidden the
   radius clips the frame content at all four corners; every slice carries the
   dark card background there. Stitched, that produces a rounded notch across
   the image at *every* seam. */
.root--capturing .device__viewport { border-radius: 0 !important; }

/* Overlay above the frame currently being scanned. It gives way for the moment
   of each capture (is-away), or it would be in the picture. */
/* ---------- Page selection (link and screenshot buttons) ---------- */

/* The list slides out of the button rather than appearing as a dialog in the
   middle: the same button then triggers, and the mouse stays where it is. Both
   rows of the footer carry the positioning — only one list is ever open, and it
   sits in the row of its button. */
.share-row--pick { position: relative; }
.shotpick {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 20;
  padding: 8px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-l);
  transform-origin: bottom center;
  animation: ink-shotpick-in var(--dur-2) var(--ease-out);
}
@keyframes ink-shotpick-in {
  from { opacity: 0; transform: translateY(6px) scale(.96); }
  to { opacity: 1; transform: none; }
}
.shotpick__head {
  display: flex;
  white-space: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 2px 6px;
  font-size: var(--fs-s);
  font-weight: 600;
  letter-spacing: .03em;
  text-transform: uppercase;
  color: var(--text-2);
}
/* The entries now carry four lines — correspondingly more height, so that more
   than two pages stay visible without scrolling. */
.shotpick__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 280px;
  overflow-y: auto;
}
/* Staggered entry: the path, below it the total as the anchor point, below that
   devices and age in small type. The box stays top-aligned — it belongs to the
   path and should not float in the middle beside the block. */
.shotpick__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 6px;
  border-radius: var(--radius-s);
  cursor: pointer;
  font-size: var(--fs-m);
  color: var(--text-0);
}
.shotpick__info {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}
.shotpick__top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  /* A little air to the total below, without pulling the meta lines apart. */
  margin-bottom: 2px;
}
/* The total carries the decision — bold and in the text colour. */
.shotpick__count {
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-m);
  font-weight: 600;
  color: var(--text-0);
  white-space: nowrap;
}
.shotpick__row:hover { background: var(--bg-3); }
.shotpick__row--fixed { cursor: default; }
.shotpick__row--fixed:hover { background: transparent; }
/* The real field carries the interaction, what is visible is the styled box. */
.shotpick__input { position: absolute; opacity: 0; width: 0; height: 0; }
.shotpick__box {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  /* At the height of the first line, not centred between the two. */
  margin-top: 1px;
  width: 15px;
  height: 15px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--on-solid);
}
.shotpick__box.is-on { background: var(--accent); border-color: var(--accent); }
.shotpick__path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Explanatory lines (devices, age). Anything longer than the width is cut off
   rather than wrapped — otherwise the entry grows to different heights
   depending on the number of devices and the list becomes restless. */
.shotpick__meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-s);
  color: var(--text-2);
}
.shotpick__tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: var(--fs-xs);
  font-weight: 600;
}
/* "Armed" state: the next click triggers. */
.share-btn--armed {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-solid);
}
.share-btn--armed:hover:not(:disabled) { background: var(--accent-hover); }

/* Dimming *around* the frame being scanned: the four areas beside it lie
   outside the photographed crop and therefore stay put for the whole capture —
   nothing blinks. */
.shot-spot { position: fixed; inset: 0; z-index: 58; pointer-events: auto; }
.shot-spot__pane { position: fixed; background: var(--scrim); }
.shot-spot__ring {
  position: fixed;
  pointer-events: none;
  /* The shadow is drawn *outside* the box, so it lies beside the crop and not
     inside it. */
  box-shadow: 0 0 0 3px var(--accent), 0 0 26px 6px var(--accent-glow);
}

/* Take it out of the rendering for the capture (only the indicator in full
   window mode, which inevitably lies in the picture). A mere opacity:0 is not
   reliable enough — backdrop-filter runs over the compositor. */
.shot-badge--inside.is-away { display: none !important; }

/* Progress indicator. Outside the frame (device view) it stays put. */
.shot-badge {
  position: fixed;
  transform: translateX(-50%);
  z-index: 59;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: calc(100% - 20px);
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-solid);
  font-size: var(--fs-s);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: var(--shadow-l);
}
/* Full window: there is no outside, so it goes in the middle of the area —
   where it blinks along with the veil. */
/* Full window: the frame is the whole window, there is no outside. The
   indicator then sits absolutely in the frame and gives way for every capture. */
.shot-badge--inside {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 7px 14px;
  font-size: var(--fs-body);
}
.shot-badge__spinner {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--on-solid-dim);
  border-top-color: var(--on-solid);
  animation: ink-shot-spin .8s linear infinite;
}
@keyframes ink-shot-spin { to { transform: rotate(360deg); } }

/* ---------- Reduced motion ---------- */

@media (prefers-reduced-motion: reduce) {
  .loadbar--active::after,
  .fb-group--flash .fb-item,
  .fb-item--fresh,
  .icon-btn--armed,
  .fb-item__confirm,
  .panel__empty,
  .panel-ghost,
  .panel-tail,
  .root--fs.root--panel-closing .panel-tail,
  .fb-group--flash .fb-group__head,
  .device--flash,
  .anno__flash,
  .anno__bubble,
  .anno__inspect,
  .palette,
  .fsbar__feedback--pulse,
  .fsbar--intro,
  .fsbar,
  .fsbar-snap,
  .tip,
  .nudge,
  .nudge__ring,
  .nudge__shade,
  .root--fs .panel--right,
  .root--fs.root--panel-closing .panel--right,
  .tour__card,
  .tour__shade,
  .root,
  .toolbar--intro,
  .toolbar--intro > *,
  .toolbar__toggle--hint,
  .toolbar__toggle--hint svg,
  /* The switch keeps its accent colour, it just does not pulse. */
  .phone-prev--explained .phone-prev__dim-toggle,
  .fsbar__toggle--hint,
  .fsbar__toggle--hint svg,
  .overlay-backdrop { animation: none !important; }
  /* Fading out stays — only without a transition, or the marking would stand
     in the picture permanently while it is supposed to be hidden. */
  .anno__fade { animation-duration: .01ms !important; }
  .fsbar { transition: none !important; }
  .tour__ring { transition: none !important; }
  .nudge__ring { transition: none !important; }
  /* The mobile preview appears and disappears without a flight — the component
     then skips the wait before tearing down too. */
  .phone-prev--launch { animation: none !important; }
  .phone-prev--flight { transition: none !important; }
  /* Deleted entries disappear immediately — the row then skips the wait too,
     rather than standing there motionless. */
  .fb-item--removing { animation: none !important; }
  /* The cover over a frame still finding its position goes without a fade —
     the card skips its wait for it too (see SETTLE_FADE_MS). */
  .device__settle { transition: none !important; }
  .device__settle span { animation: none !important; }
}

/* ---------- Panel splitter (drag to resize) ---------- */

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
  transition: background var(--dur-1) ease, box-shadow var(--dur-1) ease;
}
.splitter:hover::after,
.splitter--active::after {
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
/* During the drag the iframes would otherwise swallow the pointermove events. */
.body--resizing { cursor: col-resize; user-select: none; }
.body--resizing iframe { pointer-events: none; }

/* ---------- Menu: check column, device sets ---------- */

.menu__check {
  display: grid;
  place-items: center;
  width: 16px;
  flex: 0 0 auto;
  color: var(--accent);
}
.menu--wide { min-width: 250px; max-height: calc(100vh - 72px); overflow-y: auto; }
.menu__empty { padding: 2px 10px 8px; color: var(--text-2); font-size: var(--fs-s); }

/* Inline row "save the grid as a set" — classes of its own, so that it does not
   collide with the custom-size form (.menu__custom-add). */
.menu__inline { display: flex; align-items: center; gap: 6px; }
.menu__inline input { flex: 1 1 auto; min-width: 0; }
.menu__inline-add {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  background: var(--accent);
  color: var(--on-solid);
  border: none;
  border-radius: var(--radius-s);
}
.menu__inline-add:disabled { opacity: .4; }
.menu__inline-add:hover:not(:disabled) { background: var(--accent-hover); }

/* Live preview of the custom size (aspect ratio) */
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
.menu__preview-meta { color: var(--text-2); font-size: var(--fs-s); font-variant-numeric: tabular-nums; line-height: 1.5; }
.menu__preview-meta strong { color: var(--text-1); font-weight: 600; }

/* ---------- Guided tour (spotlight onboarding) ---------- */

/* The coachmarks catch no pointers — the dimming areas do not either. The first
   step asks for a click on the preview, which lies under the shade; blocking
   areas would prevent exactly that. Only the card itself is clickable. */
.tour { position: fixed; inset: 0; z-index: 70; pointer-events: none; }

.tour__shade {
  position: fixed;
  background: var(--scrim);
  pointer-events: none;
  animation: ink-fade-in var(--dur-2) ease-out;
}

.tour__ring {
  position: fixed;
  border-radius: var(--radius-m);
  box-shadow: 0 0 0 2px var(--accent), 0 0 0 6px var(--accent-dim);
  pointer-events: none;
  transition: left var(--dur-2) ease, top var(--dur-2) ease, width var(--dur-2) ease, height var(--dur-2) ease;
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
  animation: ink-coach-in var(--dur-2) ease-out;
}
@keyframes ink-coach-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}

.tour__head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.tour__title { flex: 1 1 auto; font-size: var(--fs-l); font-weight: 700; }
.tour__body { margin: 0; font-size: var(--fs-m); line-height: 1.55; color: var(--text-1); }

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
  transition: background var(--dur-2) ease;
}
.tour__dot--on { background: var(--accent); }

.tour__actions { display: flex; gap: 8px; flex: 0 0 auto; }
.tour__btn {
  padding: 5px 12px;
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  color: var(--text-1);
  font-size: var(--fs-m);
  font-weight: 600;
}
.tour__btn:hover:not(:disabled) { color: var(--text-0); border-color: var(--border-strong); }
.tour__btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-solid);
}
.tour__btn--primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

/* ---------- Hints (components/Nudge.tsx) ----------

   The quiet counterpart to the tour. The hint arrives while you work and may be
   passed over — hence no modality and no acknowledgement, and hence nothing
   here catches pointers except the close button: click on and you click through
   veil and bubble alike.

   Sits below the tour (70), but above the bar and the panel. */
.nudge-layer { position: fixed; inset: 0; z-index: 64; pointer-events: none; }

/* The four areas around the anchor. Blur *and* a slight dimming: the blur alone
   takes the detail out of a dense interface but hardly any brightness — set side
   by side, the bubble would remain the darker patch. Together, everything else
   falls back.

   5px is measured against the dense surroundings the hints appear in: below
   that (3px was tried) card texts stay readable and keep pulling at the eye,
   above it even the large shapes blur and the interface looks broken rather
   than held back. Anyone touching the value should look at the element popup —
   there the hint stands amid tabs, fields and buttons, which is the hard case. */
.nudge__shade {
  position: fixed;
  background: var(--scrim-hint);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  pointer-events: none;
  animation: ink-fade-in var(--dur-2) ease-out;
}
/* The version that stays inside one container (veilWithin in hints.ts). Half
   the blur and half the dimming: this one separates ten rows of the same list
   from one another, not an interface from a hint. It also has something the big
   veil does not — a hard edge at the container border, right in the middle of
   the picture — and every bit of strength makes that edge more visible. */
.nudge__shade--soft {
  background: var(--scrim-hint-soft);
  backdrop-filter: blur(2.5px);
  -webkit-backdrop-filter: blur(2.5px);
}

/* The ring closes off the hole in the veil and connects bubble and button.

   It pulses three times and then stands still: a static ring is lost next to a
   card full of controls, one that pulses permanently fidgets for the whole
   stand time. Three beats are enough to fetch the eye. */
.nudge__ring {
  position: fixed;
  border-radius: var(--radius-m);
  box-shadow: 0 0 0 2px var(--accent), 0 0 0 5px var(--accent-dim);
  pointer-events: none;
  animation: ink-nudge-ring 1.5s ease-out 3;
  transition: left var(--dur-2) ease, top var(--dur-2) ease, width var(--dur-2) ease, height var(--dur-2) ease;
}
@keyframes ink-nudge-ring {
  0% { box-shadow: 0 0 0 2px var(--accent), 0 0 0 4px var(--accent-dim); }
  45% { box-shadow: 0 0 0 2px var(--accent), 0 0 0 13px transparent; }
  100% { box-shadow: 0 0 0 2px var(--accent), 0 0 0 5px var(--accent-dim); }
}

.nudge {
  position: fixed;
  width: 280px;
  max-width: calc(100vw - 16px);
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 10px 10px 13px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-l);
  color: var(--text-0);
  pointer-events: none;
  animation: ink-nudge-in var(--dur-2) ease-out;
}
@keyframes ink-nudge-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.nudge__text { flex: 1 1 auto; min-width: 0; }
.nudge__title { display: block; font-size: var(--fs-m); font-weight: 700; }
.nudge__body {
  margin: 3px 0 0;
  font-size: var(--fs-m);
  line-height: 1.5;
  color: var(--text-1);
}

/* The only clickable part. */
.nudge__close {
  flex: 0 0 auto;
  pointer-events: auto;
  padding: 2px;
  border-radius: var(--radius-s);
  color: var(--text-2);
}
.nudge__close:hover { color: var(--text-0); background: var(--bg-3); }

/* Tail towards the button. Two squares on top of each other: the lower one
   carries the border, the upper covers it again towards the bubble. */
.nudge__arrow {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  transform: translateX(-50%) rotate(45deg);
}
.nudge--below .nudge__arrow { top: -6px; border-right: 0; border-bottom: 0; }
.nudge--above .nudge__arrow { bottom: -6px; border-left: 0; border-top: 0; }
/* Beside the anchor the tip points sideways: the component then sets top
   instead of left, and which two borders survive follows from the rotation —
   the corner that ends up pointing outwards is the one whose two edges stay. */
.nudge--left .nudge__arrow {
  right: -6px;
  border-left: 0;
  border-bottom: 0;
  transform: translateY(-50%) rotate(45deg);
}
.nudge--right .nudge__arrow {
  left: -6px;
  border-top: 0;
  border-right: 0;
  transform: translateY(-50%) rotate(45deg);
}
/* Without an anchor there is no tail — the bubble stands centred in the window. */
.nudge--none .nudge__arrow { display: none; }

/* ---------- Shortcuts/help overlay ---------- */

.overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: var(--scrim-soft);
  display: grid;
  place-items: center;
  padding: 24px;
  animation: ink-fade-in var(--dur-1) ease-out;
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
.sheet__title { flex: 1 1 auto; font-size: var(--fs-title); font-weight: 700; }
.sheet__body { padding: 6px 18px 18px; overflow-y: auto; }
.sheet--confirm { width: min(420px, 100%); }
.confirm__text { margin: 10px 0 18px; color: var(--text-1); }
.confirm__actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn--danger {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--on-solid);
  font-weight: 600;
}
.btn--danger:hover:not(:disabled) { background: var(--danger); filter: brightness(1.08); }
.sheet__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
@media (max-width: 520px) { .sheet__cols { grid-template-columns: 1fr; } }
.sheet__section-title {
  margin: 14px 0 6px;
  color: var(--text-2);
  font-size: var(--fs-s);
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
  font-size: var(--fs-s);
  color: var(--text-1);
}

/* ---------- Confirmation dialog (replace the grid) ---------- */

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
  font-size: var(--fs-title);
  font-weight: 700;
  color: var(--text-0);
}
.confirm__title svg { color: var(--warn-text); flex: 0 0 auto; }
.confirm__text { margin: 10px 0 18px; color: var(--text-1); font-size: var(--fs-body); line-height: 1.55; }
.confirm__actions { display: flex; justify-content: flex-end; gap: 8px; }
.confirm__btn { padding: 7px 14px; border-radius: var(--radius-s); font-weight: 600; font-size: var(--fs-m); }
.confirm__btn--primary { background: var(--accent); border-color: transparent; color: var(--on-solid); }
.confirm__btn--primary:hover:not(:disabled) { background: var(--accent-hover); }

/* ---------- Text button (empty-state action) ---------- */

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

/* Empty-state text in the feedback panel (the illustration sits with .panel__empty) */
.panel__empty-tip { font-size: var(--fs-s); color: var(--text-2); }

/* ---------- Font inspector (hover tooltip) ---------- */

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
  font-size: var(--fs-m);
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
  font-size: var(--fs-m);
  font-variant-numeric: tabular-nums;
}
.inspect-tip__row strong { color: var(--accent); font-weight: 700; }
.inspect-tip__sep { color: var(--text-2); }
.inspect-tip__meta { margin-top: 2px; color: var(--text-2); font-size: var(--fs-s); }
`;
