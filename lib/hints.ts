/**
 * Hints in the moment: small speech bubbles that explain a feature exactly
 * when it is used or closed.
 *
 * The counter-design to a tour up front — instead of eight cards beforehand
 * that you click away and are none the wiser for, the explanation arrives
 * where the question comes up: "where does the mobile preview come back
 * from?" at the moment it disappears.
 *
 * So that this does not become annoying, the brakes live here in the
 * conductor and not at the call sites. A call site only says
 * `fire('phone-hidden')` and may do so on every hide without a second
 * thought — whether that turns into a visible hint is this module's decision.
 *
 * The precondition that makes the quiet possible at all: **every hint text can
 * be read again permanently via the hover tooltip in the same place**. Miss a
 * bubble and you lose nothing — which is why it may disappear without an
 * acknowledgement, and why swallowing one beats piling them up.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { measureAnchor, type Side } from './anchor';
import { loadSettings, saveSettings } from './settings';

export type HintId =
  // On closing or hiding — "where does it come back from"
  | 'phone-hidden'
  | 'phone-dimmed'
  | 'panel-closed'
  | 'edits-hidden'
  | 'fullscreen-left'
  | 'device-removed'
  | 'editor-closed'
  | 'inspect-discarded'
  // On first use — "what just happened"
  | 'first-marker'
  | 'first-element-pick'
  | 'first-style-change'
  | 'first-class-scope'
  | 'first-draw-tool'
  | 'first-shape-done'
  | 'second-guide'
  | 'first-panel-open'
  | 'first-share-armed'
  | 'first-markdown'
  | 'first-bar-snap'
  | 'first-grid-zoom'
  | 'first-touch-device'
  | 'first-workspace'
  // Dead ends — "you are stuck"
  | 'no-palette-fullscreen';

/**
 * The live shell state, as far as it decides about showing. Like `TourState`, a
 * memoised object from `App.tsx` — a fresh literal per render would
 * needlessly reattach the effects here.
 */
export interface HintContext {
  /** A screenshot capture is running — nothing may get into the picture. */
  capturing: boolean;
  /** Cheat sheet open. */
  helpOpen: boolean;
  /** Confirmation dialog open. */
  dialogOpen: boolean;
  /** Past the frame gate — before that, half the UI does not exist yet. */
  gateOpen: boolean;
  /** The first coachmark is running; two explanations at once would be none. */
  tourActive: boolean;
  fullscreen: boolean;
  /** The mobile mockup is on screen — see `stale` on `phone-hidden`. */
  phoneVisible: boolean;
}

export interface HintDef {
  id: HintId;
  /**
   * 1 = moments of loss and dead ends. They wait when something else is up.
   * 2 = going deeper; in that case they are dropped rather than arriving late —
   * a hint about something you did two minutes ago is no hint.
   */
  tier: 1 | 2;
  /**
   * Anchor in the shadow root. Without one, the bubble lands in the centre of
   * the window — which is right for hints whose reference point has just
   * disappeared (discarded changes, a shape just finished).
   *
   * Several selectors produce the bounding box. The pairs here (full-window bar
   * and header) are mutually exclusive, so at most one is ever in the DOM.
   */
  anchor?: string[];
  /**
   * Beats `anchor` whenever it is on screen — otherwise `anchor` holds.
   *
   * "Your first note is saved" would rather point at the note than at the
   * button that collects it: the row is what has just come into existence, and
   * the list opens by itself for exactly that reason. But the list can be shut
   * (a parked hint arriving later, the user closing it while the bubble
   * stands), and then only the button is left to point at.
   *
   * A second list rather than another entry in `anchor`: the selectors there
   * are *unioned* into one box — that is how the tour spotlights two tools at
   * once. A fallback is the opposite of that, and mixing the two would put a
   * ring around the row and the button and the whole page between them.
   */
  anchorPrefer?: string[];
  title: string;
  body: string;
  /**
   * Drop the veil — ring and bubble stay.
   *
   * The blur exists so that a hint is not lost among twenty equally loud
   * buttons. It earns that only where the anchor really is one small control
   * among many — and two kinds of hint are not:
   *
   * Those that say what the *page* looks like right now ("You are looking at
   * the original", "The change is live on the page"). Veiled, they point at the
   * one thing they have just made unreadable — you see a ring, a sentence, and
   * a smear where the evidence should be.
   *
   * And those whose anchor is already the loudest thing on screen: a row in the
   * freshly opened list, the mockup that has just faded. Nothing there needs
   * fetching out of a crowd, and the blur turns a small remark into an event
   * that stops the whole window.
   */
  quiet?: boolean;
  /**
   * Veil only inside this element, and lighter — instead of over the whole
   * window or not at all.
   *
   * The middle way between the two settings above, for an anchor that sits in a
   * container of its own: one row among ten in the feedback list. Blurring the
   * window for it is far too big a gesture (the page has nothing to do with
   * it), but with no veil at all the ring has to hold against nine identical
   * rows right next to it. Pushing back exactly those nine says what is meant
   * without touching anything outside.
   */
  veilWithin?: string[];
  /**
   * Preferred side of the anchor. Without it the bubble goes below, or above
   * where that does not fit.
   *
   * For an anchor inside a container it matters which way the bubble opens: a
   * hint about a row in the list would otherwise lie *on* the list and cover
   * the very thing it just pointed at.
   */
  prefer?: Side;
  /**
   * Own limit for the wait, instead of the general `PARK_MAX_MS` — see
   * `LOSS_PARK_MS`.
   */
  parkMax?: number;
  /** Extra condition on the live state. */
  when?: (c: HintContext) => boolean;
  /**
   * The statement has gone false — throw the hint away instead of showing it.
   *
   * Hints about a moment of loss ("Mobile preview is off") can wait: parked for
   * up to `PARK_MAX_MS`, retried once a second. In that time the user can
   * undo the very thing the hint is about, and the bubble then arrives claiming
   * something the screen plainly contradicts — the preview is back, the button
   * next to the ring is lit, and the sentence says it is off. That was
   * reproducible: hide the preview while a bubble is still up, switch it back
   * on, and the parked hint appears seconds later out of nowhere.
   *
   * Deliberately separate from `when`. That one is checked at the moment of
   * firing and describes the situation the trigger belongs to; the state it
   * reads is one render behind at that point (`togglePhone` sets the state and
   * fires in the same breath), so it cannot see the change it was itself
   * caused by. `stale` is only ever asked *later* — in the retry loop and
   * against a standing bubble — where the state has long arrived.
   */
  stale?: (c: HintContext) => boolean;
}

const inFullscreen = (c: HintContext) => c.fullscreen;

/** The feedback button — in the bar in full window mode, in the header on the grid. */
const FEEDBACK_BTN = ['.fsbar__feedback', '.toolbar__feedback'];
/**
 * The two containers that button sits in — the veil for a hint pointing at it.
 *
 * Mutually exclusive like `FEEDBACK_BTN` itself (`App.tsx` renders the header
 * only outside full window mode), so the union is always just the one that is
 * really there.
 */
const FEEDBACK_BAR = ['.fsbar', '.toolbar'];

/**
 * How long a "where did it go" hint may wait before it is dropped.
 *
 * Much shorter than the general `PARK_MAX_MS`, and that is the whole point.
 * Those hints answer a question the user asks in the second after their click
 * — the preview is gone, where is it? Twenty seconds later they have long since
 * found the button or moved on, and the bubble arrives as an interruption
 * about nothing: it points at a control that has not been touched since, in the
 * middle of quite different work.
 *
 * Five seconds is measured against how long the question stays open. And being
 * dropped is not a loss: the same sentence is on the hover tooltip of the same
 * button, permanently.
 */
const LOSS_PARK_MS = 5_000;

export const HINTS: Record<HintId, HintDef> = {
  // ---------- On closing: "where does it come back from" ----------
  'phone-hidden': {
    id: 'phone-hidden',
    tier: 1,
    parkMax: LOSS_PARK_MS,
    anchor: ['.fsbar__phone'],
    // The bar, not the window. This is the case the veil was built for — one
    // button among eight identical round ones — but the crowd it has to push
    // back *is* those eight, and they are all in the same strip. The page
    // behind them never competed for the eye and does not need blurring.
    veilWithin: ['.fsbar'],
    stale: (c) => c.phoneVisible,
    title: 'Mobile preview is off',
    body: 'This button brings it back whenever you need it.',
  },
  /**
   * The mockup has faded by itself for the first time — after a good half
   * minute of work (`FIRST_DIM_MS` in `PhonePreview`). A half-transparent
   * window looks like a fault; the hint points at the switch that keeps it
   * permanently bright.
   */
  'phone-dimmed': {
    id: 'phone-dimmed',
    tier: 1,
    parkMax: LOSS_PARK_MS,
    // The whole mockup, not the switch: what is being explained is what
    // happened to the window. A ring around the switch alone would leave the
    // user guessing what is being talked about. Which switch is meant is said
    // by the text — and shown by the switch itself, which lights up while the
    // hint stands (`phone-prev--explained` in styles.ts).
    anchor: ['.phone-prev'],
    // Same reason as `edits-hidden`: the statement is about what the *page*
    // looks like now — the mockup has just stepped out of the way so you can
    // read it. A blur over exactly that page would take back the evidence in
    // the same breath, and the fade the hint explains would drown in it.
    quiet: true,
    title: 'The mobile preview goes transparent',
    body: "So it doesn't cover the page. The switch on its frame keeps it bright.",
    when: inFullscreen,
  },
  'panel-closed': {
    id: 'panel-closed',
    tier: 1,
    parkMax: LOSS_PARK_MS,
    anchor: FEEDBACK_BTN,
    // Same reason as `phone-hidden`: one small button among the others in the
    // same strip, and that strip is the whole crowd the ring has to hold
    // against. In full window mode the rest of the window *is* the page — the
    // customer's own site, which never competed for the eye here. Blurring it
    // for a remark about a list of notes turns a small reassurance into an
    // event that stops everything, and it smears the one thing the user came to
    // look at.
    veilWithin: FEEDBACK_BAR,
    // No `stale` on the open list: in full window mode `panelOpen` stays true
    // for the 160 ms of the slide-out, so the hint would kill itself in the
    // moment it was fired for.
    title: 'Your notes are safe',
    body: 'Nothing was deleted — this button opens the list again.',
  },
  'edits-hidden': {
    id: 'edits-hidden',
    tier: 1,
    parkMax: LOSS_PARK_MS,
    anchor: ['[data-hint="edits"]'],
    // The point of this hint is the page behind it — veiled, there would be
    // nothing to see but the ring and this sentence.
    quiet: true,
    title: 'This is the untouched page',
    body: 'Your markings and changes are still saved. The switch puts them back.',
  },
  'fullscreen-left': {
    id: 'fullscreen-left',
    tier: 2,
    parkMax: LOSS_PARK_MS,
    anchor: ['[data-hint="fullscreen"]'],
    stale: (c) => c.fullscreen,
    title: 'Back in the device grid',
    body: 'This button returns to full window mode.',
  },
  'device-removed': {
    id: 'device-removed',
    tier: 2,
    parkMax: LOSS_PARK_MS,
    anchor: ['[data-hint="devices"]'],
    title: 'Viewport removed',
    body: 'Add it back any time from the Devices menu.',
  },
  'editor-closed': {
    id: 'editor-closed',
    tier: 2,
    parkMax: LOSS_PARK_MS,
    anchor: ['.toolbar__menu'],
    title: 'CSS editor closed',
    body: 'Your edits stay in place. The editor lives under ⋯ → Tools.',
  },
  'inspect-discarded': {
    id: 'inspect-discarded',
    tier: 1,
    parkMax: LOSS_PARK_MS,
    // Without an anchor: the popup it refers to has just closed.
    title: 'Changes discarded',
    body: 'Esc closes without saving — “Add marker” would have kept them.',
  },

  // ---------- First use: "what just happened" ----------
  'first-marker': {
    id: 'first-marker',
    tier: 1,
    anchor: FEEDBACK_BTN,
    // The entry itself, as long as the list is open — and with the first note
    // it is, because the list unfolds for it. The class is set by the panel for
    // exactly as long as this hint stands (`explainId` in FeedbackPanel), which
    // is what makes it usable as an anchor: `.fb-item--fresh` is gone again
    // after 1.2 s and the ring would jump to the button in the middle of the
    // bubble's ten seconds, and a bare `.fb-item` would take whichever row
    // happens to come first once a second note is marked while the bubble
    // stands.
    anchorPrefer: ['.fb-item--explained'],
    // Not the page — the rest of the list. The card is already the brightest
    // thing on screen, so blurring the window for it is a gesture far too big,
    // and it veils the marking the row is about. What the ring does have to
    // hold against is the rows around it.
    veilWithin: ['.panel'],
    // Beside it, not over it. Above and below both mean the bubble lies on the
    // list — 280 px of it, over a card that is barely wider — and the row it
    // has just ringed disappears underneath. To the left there is the page,
    // and the page is not what this hint is about.
    prefer: 'left',
    title: 'Your first note is saved',
    body: 'Everything you mark collects here.',
  },
  'first-element-pick': {
    id: 'first-element-pick',
    tier: 1,
    anchor: ['.anno__tabs'],
    title: 'Two tabs, two jobs',
    body: 'Content rewrites the text on the page, Style changes how it looks. Enter saves.',
  },
  'first-style-change': {
    id: 'first-style-change',
    tier: 1,
    anchor: ['[data-hint="edits"]'],
    // Same reason as `edits-hidden`: it points at the changed page.
    quiet: true,
    title: 'The change is live on the page',
    body: '“My edits” switches back to the original — and back again.',
  },
  'first-class-scope': {
    id: 'first-class-scope',
    tier: 2,
    anchor: ['.anno__scope'],
    title: 'This edits a class',
    body: 'Every element with it changes along — switch to “This element” to affect only one.',
  },
  'first-draw-tool': {
    id: 'first-draw-tool',
    tier: 1,
    // Deliberately the whole bar rather than the colour swatches: those do not
    // exist in full window mode, but the text has to hold in both.
    anchor: ['.fsbar'],
    title: 'You are drawing now',
    body: 'Cmd/Ctrl+Z takes the last one back, Esc gives the page back to clicking.',
  },
  'first-shape-done': {
    id: 'first-shape-done',
    tier: 1,
    // Without an anchor: the fresh shape has no stable selector.
    title: 'Markings stay editable',
    body: 'Drag the outline to move it, double-click to write a note.',
  },
  'second-guide': {
    id: 'second-guide',
    tier: 2,
    title: 'Two guides measure a gap',
    body: 'The distance between them goes into the export.',
  },
  'first-panel-open': {
    id: 'first-panel-open',
    tier: 2,
    anchor: ['.panel__head'],
    title: 'Grouped by page and device',
    body: 'Tick entries off as you fix them.',
  },
  'first-share-armed': {
    id: 'first-share-armed',
    tier: 1,
    anchor: ['.panel__share'],
    title: 'Pick the pages first',
    body: 'The second click runs the export.',
  },
  'first-markdown': {
    id: 'first-markdown',
    tier: 1,
    anchor: ['.panel__share'],
    title: 'Copied to the clipboard',
    body: 'Paste it into Claude Code or Cursor — selectors and values included.',
  },
  'first-bar-snap': {
    id: 'first-bar-snap',
    tier: 2,
    anchor: ['.fsbar__grip'],
    title: 'The bar snaps to edges',
    body: 'All four — left and right turn it into a vertical toolbox. The grip frees it again.',
  },
  'first-grid-zoom': {
    id: 'first-grid-zoom',
    tier: 2,
    anchor: ['.toolbar__menu'],
    title: 'Auto zoom is off now',
    body: 'Zooming by hand takes over. Switch it back on under ⋯.',
  },
  'first-touch-device': {
    id: 'first-touch-device',
    tier: 2,
    anchor: ['.device__touch'],
    title: 'Touch mode is on',
    body: 'Dragging scrolls instead of hovering — like on a real phone.',
  },
  'first-workspace': {
    id: 'first-workspace',
    tier: 2,
    anchor: ['[data-hint="devices"]'],
    title: 'Workspace saved',
    body: 'It sits in the Devices menu now.',
  },

  // ---------- Dead ends: "you are stuck" ----------
  //
  // The case "the page does not react because a tool is active" deliberately
  // does not appear here: `first-draw-tool` already names Esc on entering draw
  // mode, so earlier and without anything having to go wrong first. A second
  // hint with the same message would only have needed a trigger that honestly
  // does not exist — a click in draw mode draws, it does not fail.
  'no-palette-fullscreen': {
    id: 'no-palette-fullscreen',
    tier: 1,
    anchor: ['.fsbar'],
    when: inFullscreen,
    title: 'Tools live on the number keys',
    body: '1–9 pick pin, freehand, shapes and guides. Esc goes back to interacting.',
  },
};

/**
 * Trigger for components deep in the interface (panel, inspect popup, device
 * card). As with the tooltip, a context rather than props threaded through:
 * the buttons sit several levels deep, and a hint is not state an intermediate
 * level would need to know about.
 *
 * Without a provider it is a no-op — panels rendered in isolation (tests)
 * should not fail on it.
 */
export const HintFireContext = createContext<(id: HintId) => void>(() => {});

export function useFireHint(): (id: HintId) => void {
  return useContext(HintFireContext);
}

/** At most this many bubbles per session — after that, silence. */
const SESSION_BUDGET = 4;
/** Minimum gap between two bubbles. */
const MIN_GAP_MS = 20_000;
/** How long a bubble stands before it leaves by itself. */
const DWELL_MS: Record<1 | 2, number> = { 1: 10_000, 2: 8_000 };
/** Dismissed faster than this means: not read — the hint may come back. */
const MIN_DWELL_MS = 1_500;
/** When you carry on working, less is enough to count as seen. */
const AWAY_DWELL_MS = 1_200;
/** This many hastily dismissed bubbles in a row mute the session. */
const IGNORE_STREAK = 3;
/**
 * Grace period before a click elsewhere closes it — otherwise the very click
 * that triggered the hint clears it again immediately.
 */
const GRACE_MS = 400;
/** The beat at which a parked tier-1 hint tries again. */
const RETRY_MS = 1_000;
/**
 * The longest a hint may wait. After that it is dropped rather than arriving
 * late.
 *
 * Without this limit a parked hint waited indefinitely: the mockup fades after
 * five seconds, but the user is reading the coachmark right then — and got the
 * explanation for it at the very moment they clicked that away, no matter how
 * long it had taken. The same number as `MIN_GAP_MS`: no wait should be longer
 * than the gap between two bubbles.
 */
const PARK_MAX_MS = 20_000;
/**
 * While the tour is up, a much shorter limit applies.
 *
 * It is not a block of seconds like a dialog: it stands until the user makes
 * the gesture it asks for — they are reading, not working. Anything triggered
 * during that time (the mockup fades by itself after five seconds) is no
 * longer a moment by the time it is clicked away, and the bubble would appear
 * in the same tenth of a second in which the coachmark leaves: exactly the two
 * explanations at once that `tourActive` in `blocked` is meant to prevent.
 *
 * Not zero, so that the handover works: the first note closes the tour *and*
 * triggers `first-marker`, both in the same round — so the tour is still up at
 * trigger time. That hint is a few hundred milliseconds old and should get
 * through.
 */
const TOUR_PARK_MAX_MS = 3_000;

/** Why a bubble disappears — decides whether it "counts as seen". */
type DismissReason = 'x' | 'timeout' | 'away';

function blocked(c: HintContext): boolean {
  return c.capturing || c.helpOpen || c.dialogOpen || !c.gateOpen || c.tourActive;
}

export interface HintsApi {
  /** The bubble currently visible. */
  current: HintDef | null;
  /**
   * Set a hint off. May be called at every occurrence without a second thought
   * — whether it appears is the conductor's decision.
   */
  fire: (id: HintId) => void;
  dismiss: (reason: DismissReason) => void;
  /** For the menu switch. */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** "Show tips again" — everything back to the start. */
  reset: () => void;
}

export function useHints(ctx: HintContext, root: ParentNode): HintsApi {
  const [current, setCurrent] = useState<HintDef | null>(null);
  const [enabled, setEnabledState] = useState(true);

  const seen = useRef<Set<HintId>>(new Set());
  const ready = useRef(false);
  const enabledRef = useRef(true);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const currentRef = useRef<HintDef | null>(null);
  /**
   * A parked tier-1 hint; exactly one place, no queue.
   *
   * Deliberately state and not a ref: the follow-up loop below hangs off an
   * effect, and that only runs after a render. With a ref, a parked hint would
   * lie there until something else happened to render.
   */
  const [parked, setParked] = useState<HintId | null>(null);
  /** The same value readable synchronously — `attempt` runs out of effects. */
  const parkedRef = useRef<HintId | null>(null);
  /** When the parked hint was triggered — for `PARK_MAX_MS`. */
  const parkedAt = useRef(0);
  const shownAt = useRef(0);
  const lastShownAt = useRef(0);
  const shownCount = useRef(0);
  const quickStreak = useRef(0);
  const muted = useRef(false);

  // Load the seen hints and the switch once. Before that `fire` shows nothing
  // — a hint in the first second would be premature anyway, and without the
  // loaded state it would wrongly count as unseen.
  useEffect(() => {
    let alive = true;
    void loadSettings().then((s) => {
      if (!alive) return;
      seen.current = new Set(s.hintsSeen);
      enabledRef.current = s.hintsEnabled;
      setEnabledState(s.hintsEnabled);
      ready.current = true;
    });
    return () => {
      alive = false;
    };
  }, []);

  const persistSeen = useCallback(() => {
    void saveSettings({ hintsSeen: [...seen.current] });
  }, []);

  /** Park it or clear the place — ref and state stay in step. */
  const stash = useCallback((id: HintId | null) => {
    parkedRef.current = id;
    parkedAt.current = id ? Date.now() : 0;
    setParked(id);
  }, []);

  /** Shows immediately — every check has already run by this point. */
  const show = useCallback(
    (def: HintDef) => {
      const now = Date.now();
      currentRef.current = def;
      shownAt.current = now;
      lastShownAt.current = now;
      shownCount.current += 1;
      stash(null);
      setCurrent(def);
    },
    [stash],
  );

  /**
   * One attempt at showing `id`. `allowPark` distinguishes the fresh trigger
   * (may be parked) from the follow-up out of the loop.
   */
  const attempt = useCallback(
    (id: HintId, allowPark: boolean) => {
      if (!ready.current || !enabledRef.current || muted.current) return;
      const def = HINTS[id];
      if (!def || seen.current.has(id)) return;

      const c = ctxRef.current;
      // Condition missed: do not park. It describes the situation at the moment
      // of the action, and that does not come back.
      if (def.when && !def.when(c)) return;

      // Budget exhausted: drop it without counting as seen — the hint comes
      // back the next time round.
      if (shownCount.current >= SESSION_BUDGET) return;

      // A waiting tier-1 hint takes precedence. One single action often sets
      // off two — saving the first note also means the list opens for the first
      // time — and without this line the order of the effects would decide
      // which of them appears: the parked tier-1 waits for its beat while the
      // tier-2 triggered later would go straight through and take its place.
      // That is exactly what happened: "Your first note is saved" lost against
      // the hint about how the list is grouped.
      if (def.tier === 2 && parkedRef.current && parkedRef.current !== id) return;

      const park = () => {
        if (!allowPark || def.tier !== 1) return;
        stash(id);
      };

      if (blocked(c) || currentRef.current) return park();
      if (lastShownAt.current && Date.now() - lastShownAt.current < MIN_GAP_MS) return park();

      // No visible anchor, no hint: a bubble without a ring stands in the
      // centre of the window and explains a control the user cannot see at all
      // right then (one in a closed tab, say). Tier 1 waits until it appears —
      // tier 2 is dropped.
      //
      // Hints *without* an `anchor` are unaffected: they are deliberately
      // anchorless, because their reference point has just disappeared.
      if (def.anchor && !measureAnchor(root, def.anchor)) return park();

      show(def);
    },
    [show, stash, root],
  );

  const fire = useCallback((id: HintId) => attempt(id, true), [attempt]);

  // Follow up on what was parked. One beat rather than wiring to every single
  // condition (dialog closed, gap elapsed, bubble gone) — those run across four
  // different states, and one of them always gets forgotten.
  useEffect(() => {
    if (!parked) return;
    const timer = window.setInterval(() => {
      // Waited too long: throw it away rather than showing it late. Without
      // this the hint would eventually stand there without anything having just
      // happened that it refers to.
      const own = HINTS[parked].parkMax ?? PARK_MAX_MS;
      const max = ctxRef.current.tourActive ? Math.min(TOUR_PARK_MAX_MS, own) : own;
      if (Date.now() - parkedAt.current > max) {
        stash(null);
        return;
      }
      // Undone in the meantime: the statement is no longer true, so away with
      // it — and without counting as seen, because it never appeared.
      if (HINTS[parked].stale?.(ctxRef.current)) {
        stash(null);
        return;
      }
      attempt(parked, false);
    }, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [attempt, parked, current, stash]);

  const dismiss = useCallback(
    (reason: DismissReason) => {
      const def = currentRef.current;
      if (!def) return;
      const dwell = Date.now() - shownAt.current;

      let markSeen: boolean;
      if (reason === 'timeout') {
        // Had its full stand time — counts as shown, read or not.
        markSeen = true;
        quickStreak.current = 0;
      } else if (reason === 'away') {
        // Carried on working. Not a rejection, so it does not count against the user.
        markSeen = dwell >= AWAY_DWELL_MS;
      } else {
        markSeen = dwell >= MIN_DWELL_MS;
        if (markSeen) quickStreak.current = 0;
        else if (++quickStreak.current >= IGNORE_STREAK) muted.current = true;
      }

      if (markSeen) {
        seen.current.add(def.id);
        persistSeen();
      }
      currentRef.current = null;
      setCurrent(null);
    },
    [persistSeen],
  );

  // Stand time elapsed.
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => dismiss('timeout'), DWELL_MS[current.tier]);
    return () => window.clearTimeout(timer);
  }, [current, dismiss]);

  // A click elsewhere clears it — after a grace period, or the triggering click
  // swallows its own bubble.
  useEffect(() => {
    if (!current) return;
    let off: (() => void) | undefined;
    const arm = window.setTimeout(() => {
      const onDown = (e: PointerEvent) => {
        // Its own close button does not count as "carried on working". Without
        // this exception this listener (capture) would always beat the button's
        // onClick, `dismiss('x')` would run into nothing — and the being-ignored
        // brake could never trip.
        const onClose = e
          .composedPath()
          .some((n) => n instanceof Element && n.classList.contains('nudge__close'));
        if (!onClose) dismiss('away');
      };
      window.addEventListener('pointerdown', onDown, true);
      off = () => window.removeEventListener('pointerdown', onDown, true);
    }, GRACE_MS);
    return () => {
      window.clearTimeout(arm);
      off?.();
    };
  }, [current, dismiss]);

  // The same for a bubble already standing: switch the preview back on while it
  // says "Mobile preview is off" and it contradicts the screen right next to
  // its own ring. Not parked and not counted as seen — the moment it belonged
  // to is over, and the user has just shown they know the way back.
  useEffect(() => {
    if (current?.stale?.(ctx)) {
      currentRef.current = null;
      setCurrent(null);
    }
  }, [ctx, current]);

  // Blocks can appear while a bubble is up (screenshot started, dialog opened)
  // — then away with it immediately, without using it up.
  useEffect(() => {
    if (current && blocked(ctx)) {
      // The standing bubble counts as parked from now on — and ages like any
      // other. "Show tips again" starts the tour, for instance: the bubble that
      // disappears in the process should not reappear three seconds later right
      // behind the coachmark.
      stash(current.tier === 1 ? current.id : null);
      currentRef.current = null;
      setCurrent(null);
    }
  }, [ctx, current, stash]);

  const setEnabled = useCallback((on: boolean) => {
    enabledRef.current = on;
    setEnabledState(on);
    void saveSettings({ hintsEnabled: on });
    if (!on) {
      stash(null);
      currentRef.current = null;
      setCurrent(null);
    }
  }, [stash]);

  const reset = useCallback(() => {
    seen.current = new Set();
    muted.current = false;
    shownCount.current = 0;
    quickStreak.current = 0;
    lastShownAt.current = 0;
    // The waiting one falls too: "Show tips again" starts the tour, and
    // whatever was parked before that belongs to a moment the user has just
    // left.
    stash(null);
    void saveSettings({ hintsSeen: [] });
  }, [stash]);

  return { current, fire, dismiss, enabled, setEnabled, reset };
}
