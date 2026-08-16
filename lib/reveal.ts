/**
 * Unfolding hidden elements: a slideout menu, a collapsed accordion, a later
 * form step. After a reload, a marking on such an element points at nothing —
 * this is where it is written down how the element becomes visible again.
 *
 * Two routes, in this order:
 *
 * 1. **The recorded path.** `InteractionSync` takes note of what the user
 *    clicked; the marking takes that path with it when it is created.
 *    Replaying is more reliable than any pattern matching, because it repeats
 *    exactly the interaction that did the job the first time.
 * 2. **Heuristics** for old data, imported feedback and paths that grasp at
 *    nothing: `details`, popovers, `aria-controls`, `[hidden]`.
 *
 * The load-bearing idea: replaying happens **only when the target is
 * invisible**, and it stops as soon as the target is visible. That makes an
 * unfiltered recorded path harmless — for a visible element not a single step
 * runs.
 *
 * `collapseShapeIn` is the mirror image and undoes what was unfolded: run
 * **only when the target is visible**, stops as soon as it is hidden. Without
 * it the menu opened for one entry stays standing when the next entry is
 * jumped to.
 */

import type { Shape } from './annotations';
import { elementLabel, shapeSelector } from './annotations';
import { anchorUrl, dispatchPointerSequence } from './interactionSync';
import { findByShadowPath } from './selector';
import { createLogger } from './log';

const log = createLogger('reveal');

/** Wait after a step, for when the page is not frozen. */
const SETTLE_MS = 120;

/** Box in the frame's document space (like all shape coordinates). */
export interface RevealRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One step back. Collected while unfolding, carried out by `collapseShapeIn` in
 * reverse order — nested cases (menu open, then submenu open) only close in
 * that direction.
 *
 * `exact` separates the two qualities: attribute and property changes are the
 * precise counter-move, a second click on the opener is an assumption. It
 * holds for a toggle (burger, accordion) and not for a "next" button in a
 * wizard. Hence the rule in `collapseShapeIn`: after every inexact step it is
 * measured whether the target really did disappear, and the moment it did not,
 * the run stops instead of clicking blindly onwards.
 */
export interface RevealUndo {
  /** Same wording as `RevealResult.steps` — for the log. */
  label: string;
  /** Precise counter-move (attribute, property) or a guessed second click? */
  exact: boolean;
  /** `false` when the element is gone: the page has rebuilt it. */
  run: () => boolean;
}

export interface RevealResult {
  /** Was the element resolved at all? */
  found: boolean;
  /** Was it invisible before we touched anything? */
  wasHidden: boolean;
  /** Is it visible now? */
  revealed: boolean;
  /** Steps actually carried out — for the log, the export and the caption. */
  steps: string[];
  /** Fresh box, as soon as the element is visible. */
  rect: RevealRect | null;
  /** Route back, in the order it was carried out. Empty when nothing changed. */
  undo: RevealUndo[];
}

/**
 * Bracket under which the triggered events are neither mirrored nor recorded —
 * in practice `InteractionSync.runIsolated`.
 */
export type Isolator = <T>(fn: () => T) => T;

export interface RevealOptions {
  isolate: Isolator;
  /**
   * Wait after each step. The capture path freezes the page beforehand
   * (`freezeAnimations`) and gets by with `0`; otherwise the usual CSS
   * transition needs its time.
   */
  settleMs?: number;
}

/**
 * Visible in the sense of "has something to show".
 *
 * Explicitly **not** meant: in the viewport. Only the size is checked, never
 * the position — otherwise every marking below the fold would trigger an
 * unfold.
 */
export function isRevealed(el: Element): boolean {
  if (!el.isConnected) return false;

  const box = el.getBoundingClientRect();
  if (box.width <= 0 && box.height <= 0) return false;

  // `checkVisibility` walks the entire ancestor chain, `content-visibility`
  // included — which is exactly the part a hand-rolled version misses. The
  // fallback below it is the old rule of thumb.
  const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === 'function') {
    return check.call(el, { checkOpacity: true, checkVisibilityCSS: true });
  }

  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  // Foreign realm: always take getComputedStyle from the element's own window.
  if (win.getComputedStyle(el).visibility === 'hidden') return false;
  const html = el as HTMLElement;
  return html.offsetParent != null || win.getComputedStyle(el).position === 'fixed';
}

/** The element the marking hangs on — provided the page still has it. */
export function resolveShapeEl(doc: Document, shape: Shape): Element | null {
  const sel = shapeSelector(shape);
  if (!sel) return null;
  try {
    return findByShadowPath(doc, sel.split(' >>> '));
  } catch {
    return null;
  }
}

/**
 * Touch an element the way a real user would. The same sequence as when
 * mirroring between frames: first the pointer events (many frameworks listen
 * for `pointerdown`), then `click()` — only that carries activation semantics.
 */
export function activate(el: Element): void {
  const win = el.ownerDocument.defaultView;
  if (!win) return;
  dispatchPointerSequence(el, win as Window & typeof globalThis);
  if (typeof (el as HTMLElement).click === 'function') {
    (el as HTMLElement).click();
  } else {
    el.dispatchEvent(
      new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );
  }
}

/**
 * Resolves the marking in the frame and unfolds its element if it is hidden.
 * A visible element costs nothing — the function returns immediately.
 */
export async function revealShapeIn(
  iframe: HTMLIFrameElement,
  shape: Shape,
  opts: RevealOptions,
): Promise<RevealResult> {
  const miss: RevealResult = {
    found: false,
    wasHidden: false,
    revealed: false,
    steps: [],
    rect: null,
    undo: [],
  };

  let win: Window;
  let doc: Document;
  try {
    const w = iframe.contentWindow;
    if (!w?.document) return miss;
    win = w;
    doc = w.document;
  } catch {
    return miss; // frame not readable
  }

  const settleMs = opts.settleMs ?? SETTLE_MS;
  const steps: string[] = [];
  const undo: RevealUndo[] = [];

  try {
    let el = resolveShapeEl(doc, shape);
    if (!el) return miss;
    if (isRevealed(el)) {
      return {
        found: true,
        wasHidden: false,
        revealed: true,
        steps,
        rect: docRect(el, win),
        undo,
      };
    }

    // 1. The route the user took themselves.
    for (const step of shape.reveal ?? []) {
      const opener = findByShadowPath(doc, step.sel.split(' >>> '));
      // If the opener is missing (page rebuilt), the step is worthless — the
      // next one may still work.
      if (!opener) continue;
      // A step that navigates unfolds nothing: it throws the state away.
      if (anchorUrl(opener)) continue;

      opts.isolate(() => activate(opener));
      const label = `click:${step.label ?? step.sel}`;
      steps.push(label);
      // A second click on the same opener — an assumption, see `RevealUndo`.
      undo.push({ label, exact: false, run: () => reclick(opener) });
      await settle(settleMs);

      // After the click the page may have rebuilt the element — the old
      // reference then points at a detached node.
      el = resolveShapeEl(doc, shape) ?? el;
      if (isRevealed(el)) break;
    }

    // 2. Fallback for everything without a (usable) path.
    if (!isRevealed(el)) {
      for (const ancestor of hiddenAncestors(el)) {
        const done = openOne(ancestor, opts.isolate);
        if (!done) continue;
        steps.push(done.label);
        undo.push(done.undo);
        await settle(settleMs);
        el = resolveShapeEl(doc, shape) ?? el;
        if (isRevealed(el)) break;
      }
    }

    const revealed = isRevealed(el);
    if (!revealed && steps.length > 0) {
      log.info('Unfolding did not succeed', { selector: shapeSelector(shape), steps });
    }
    return {
      found: true,
      wasHidden: true,
      revealed,
      steps,
      rect: revealed ? docRect(el, win) : null,
      undo,
    };
  } catch (e) {
    log.warn('Unfolding failed', e);
    return { ...miss, steps, undo };
  }
}

/**
 * Folds shut again what `revealShapeIn` opened — the counterpart to it, and
 * built on the same footing: run **only while the target is visible**, stop the
 * moment it is hidden. A menu that the user has meanwhile closed themselves
 * therefore costs not a single click.
 *
 * Reloading the frame would be the reliable route (that is what the export
 * does), but it is out of the question here: scroll position, form entries and
 * every other state of the page would go with it, on every click in the panel.
 *
 * The guessed step — a second click on the opener — is therefore only ever
 * carried out one at a time and measured immediately afterwards. Whatever does
 * not fold shut ends the run: a "next" button in a wizard gets clicked once
 * more in the worst case, not through to the end of the form.
 *
 * Returns whether the element is hidden again.
 */
export async function collapseShapeIn(
  iframe: HTMLIFrameElement,
  shape: Shape,
  undo: RevealUndo[],
  opts: RevealOptions,
): Promise<boolean> {
  if (undo.length === 0) return true;

  let doc: Document;
  try {
    const w = iframe.contentWindow;
    if (!w?.document) return false;
    doc = w.document;
  } catch {
    return false; // frame not readable
  }

  const settleMs = opts.settleMs ?? SETTLE_MS;

  try {
    // No target, no measurement — and without measurement the guessed steps
    // must not run. That is the case after a navigation, where the undo
    // references point into a document that no longer exists.
    let el = resolveShapeEl(doc, shape);
    if (!el) return false;
    if (!isRevealed(el)) return true;

    const steps: string[] = [];
    // Outermost last: unfolding ran from the outside in, closing runs the other
    // way round — a submenu inside a menu already shut cannot be reached.
    for (const step of [...undo].reverse()) {
      if (!opts.isolate(() => step.run())) continue;
      steps.push(step.label);
      await settle(settleMs);

      el = resolveShapeEl(doc, shape) ?? el;
      if (!isRevealed(el)) return true;

      // Reached only when the step had no effect: an exact one may have been
      // one layer of several, a guessed one has just done something other than
      // what was intended. Stop there.
      if (!step.exact) {
        log.info('Folding shut had no effect — stopping', {
          selector: shapeSelector(shape),
          steps,
        });
        return false;
      }
    }
    return !isRevealed(el);
  } catch (e) {
    log.warn('Folding shut failed', e);
    return false;
  }
}

/** The element's box in the frame's document space. */
function docRect(el: Element, win: Window): RevealRect {
  const r = el.getBoundingClientRect();
  return { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height };
}

/**
 * Wait until what was unfolded has actually been painted. The double
 * `requestAnimationFrame` is mandatory — a single one still runs *before* the
 * paint. Deliberately the shell's rAF, not the frame's: for a cross-origin
 * blocked frame, merely accessing it throws.
 */
async function settle(ms: number): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/**
 * Invisible ancestors of the target, outermost first — unfolding from the
 * outside in is the only order that works. Runs across shadow boundaries like
 * `shadowPath`. The target itself is included: it may well be the `details` or
 * the `[hidden]` element in question.
 */
function hiddenAncestors(el: Element): Element[] {
  const out: Element[] = [];
  let node: Element | null = el;
  while (node) {
    if (!isRevealed(node)) out.push(node);
    const parent: Element | null = node.parentElement;
    if (parent) {
      node = parent;
      continue;
    }
    // Duck typing instead of `instanceof ShadowRoot` — foreign realm.
    const root = node.getRootNode();
    node =
      root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? ((root as ShadowRoot).host ?? null) : null;
  }
  return out.reverse();
}

/**
 * Unfold an invisible ancestor when its markup gives away how. Returns the
 * description of the step together with its counter-move, otherwise `null`.
 *
 * `dialog` is deliberately left out: whether `show()` or `showModal()` is
 * meant cannot be guessed, and a dialog opened the wrong way covers half the
 * page.
 */
function openOne(el: Element, isolate: Isolator): { label: string; undo: RevealUndo } | null {
  const label = elementLabel(el);
  const html = el as HTMLElement & {
    open?: boolean;
    showPopover?: () => void;
    hidePopover?: () => void;
  };

  // Clicking a `details` toggles nothing — only a click on its `summary` does.
  // Setting the attribute is the exact route.
  if (el.localName === 'details' && html.open === false) {
    isolate(() => {
      html.open = true;
    });
    return {
      label: `open:${label}`,
      undo: {
        label: `close:${label}`,
        exact: true,
        run: () => {
          if (!el.isConnected) return false;
          html.open = false;
          return true;
        },
      },
    };
  }

  if (el.hasAttribute('popover') && typeof html.showPopover === 'function') {
    try {
      isolate(() => html.showPopover!());
      return {
        label: `popover:${label}`,
        undo: {
          label: `hide:${label}`,
          exact: true,
          run: () => {
            if (!el.isConnected || typeof html.hidePopover !== 'function') return false;
            try {
              html.hidePopover();
            } catch {
              return false; // already shut
            }
            return true;
          },
        },
      };
    } catch {
      /* already open, or not in the tree */
    }
  }

  const control = findControl(el);
  if (control) {
    isolate(() => activate(control));
    const controlLabel = `click:${elementLabel(control)}`;
    // `aria-expanded` says the control is a toggle — but the click stays a
    // click, and what it does the second time is not written down anywhere.
    return {
      label: controlLabel,
      undo: { label: controlLabel, exact: false, run: () => reclick(control) },
    };
  }

  // Last resort, and only for `[hidden]`: the attribute says "hidden"
  // unambiguously and can be removed without side effects. Beating something
  // into visibility with inline CSS in general would be guesswork and could
  // leave a half-built state behind.
  if (el.hasAttribute('hidden')) {
    isolate(() => el.removeAttribute('hidden'));
    return {
      label: `force:${label}`,
      undo: {
        label: `hide:${label}`,
        exact: true,
        run: () => {
          if (!el.isConnected) return false;
          el.setAttribute('hidden', '');
          return true;
        },
      },
    };
  }

  return null;
}

/**
 * Click the opener a second time. Detached means the page has rebuilt it — the
 * click would go nowhere, and the caller has to know that so it does not count
 * a step that never happened.
 */
function reclick(el: Element): boolean {
  if (!el.isConnected) return false;
  activate(el);
  return true;
}

/**
 * The control that folds this element open and shut (`aria-controls`). The
 * search runs in the same tree as the element — inside a shadow root the
 * control sits in there too, and a document-wide match would be wrong there.
 * If the control already reads as "open", it is not the cause and a click
 * would fold it shut rather than open.
 */
function findControl(el: Element): Element | null {
  if (!el.id) return null;
  const root = el.getRootNode() as ParentNode;
  try {
    const control = root.querySelector(`[aria-controls="${CSS.escape(el.id)}"]`);
    if (!control) return null;
    if (control.getAttribute('aria-expanded') === 'true') return null;
    return anchorUrl(control) ? null : control;
  } catch {
    return null;
  }
}
