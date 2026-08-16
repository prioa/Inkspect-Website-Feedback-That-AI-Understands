import { findByShadowPath, shadowPath } from './selector';

/**
 * The page's own scroll position at the moment the extension is switched on —
 * measured in the tab, carried into the preview frames.
 *
 * A plain offset would be useless: the frames are narrower, the layout wraps
 * differently and the document is a different height in each of them. So what
 * is recorded is the *element* that stood at the top edge, plus where within it
 * and where in the visible area the reading point sat. In the frame the same
 * element is looked up again and put back under the same point — that way the
 * preview opens on the section that was actually being looked at, not at some
 * percentage of a differently long page.
 *
 * The relative position travels along as a fallback, for when the element
 * cannot be found again (mobile layouts do drop whole blocks).
 */
export interface ScrollAnchor {
  /** The page it was measured on — a frame showing something else must not use it. */
  url: string;
  /**
   * Path to the scroll container, empty for the document itself. App shells
   * ("`height: 100vh; overflow: auto`") scroll a div, and its position says
   * nothing about the document's.
   */
  scroller: string[];
  /** Path to the element at the top edge, across shadow roots; empty without one. */
  path: string[];
  /** Where in that element the reading point sat, 0…1 of its height. */
  within: number;
  /** Where in the visible area the reading point sat, 0…1 of its height. */
  viewportY: number;
  /** Fallback without an element: position in the scrolled content, 0…1. */
  ratioY: number;
  ratioX: number;
}

/**
 * Below this the page counts as unscrolled — a frame starts at the top anyway,
 * and a few pixels of leftover scroll are not worth an anchor.
 */
const MIN_OFFSET = 4;

/** The visible area of a scroll container, in viewport coordinates. */
interface Viewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

function ratio(offset: number, max: number): number {
  return max > 0 ? Math.min(1, Math.max(0, offset / max)) : 0;
}

function viewportOf(win: Window, el: Element): Viewport {
  // The document scrolls the window, and its scrolling element's box is the
  // whole document — not the visible area.
  if (el === win.document.scrollingElement) {
    return { top: 0, left: 0, width: win.innerWidth, height: win.innerHeight };
  }
  const box = el.getBoundingClientRect();
  return { top: box.top, left: box.left, width: el.clientWidth, height: el.clientHeight };
}

/**
 * The scrolled element: the document, or — when that stands at the top — the
 * largest inner container that is scrolled. Sites that keep their scrolling in
 * a div (app shells, docs layouts) would otherwise carry nothing over at all.
 */
function scrolledElement(win: Window): Element | null {
  const doc = win.document;
  const root = doc.scrollingElement;
  if (root && (root.scrollTop >= MIN_OFFSET || root.scrollLeft >= MIN_OFFSET)) return root;

  let best: Element | null = null;
  let bestArea = 0;
  for (const el of doc.querySelectorAll('*')) {
    if (el.scrollTop < MIN_OFFSET && el.scrollLeft < MIN_OFFSET) continue;
    if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) continue;
    const area = el.clientWidth * el.clientHeight;
    // The main scroller, not some scrolled-along carousel inside it.
    if (area <= bestArea) continue;
    best = el;
    bestArea = area;
  }
  return best;
}

/**
 * Does the element hang in the visible area rather than in the content? Anything
 * fixed or sticky keeps its position while scrolling — its box says nothing
 * about where in the page you are, and as an anchor it would send every frame
 * back to the top.
 */
function pinned(win: Window, el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const pos = win.getComputedStyle(node).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

/**
 * The deepest element at a point, shadow roots included. `elementFromPoint`
 * stops at the host — cookie banners, consent bars and web components would
 * otherwise all deliver the same useless anchor.
 */
function deepElementFromPoint(doc: Document, x: number, y: number): Element | null {
  let el = doc.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/**
 * The deepest element that the reading line runs through. Catches what a point
 * cannot: a narrow column in a wide window, the gap between two blocks, a page
 * whose content sits on the left. Descends as long as a child still crosses the
 * line — that way it lands on a block instead of the wrapper around everything.
 */
function elementAcross(win: Window, scroller: Element, y: number): Element | null {
  let found: Element | null = null;
  let scope: Element | null = scroller;

  while (scope) {
    let next: Element | null = null;
    for (const child of scope.children) {
      const box = child.getBoundingClientRect();
      if (box.height <= 0 || box.top > y || box.bottom <= y) continue;
      if (pinned(win, child)) continue;
      next = child;
      break;
    }
    if (!next) break;
    found = next;
    scope = next;
  }

  return found;
}

/**
 * Reading points, top edge first: the section at the top of the visible area is
 * what the position is about. Three heights, because the very top edge often
 * catches a gap between two blocks, and three x positions per height, because
 * the middle can be a wide margin.
 */
function readingLines(view: Viewport): { y: number; xs: number[] }[] {
  const xs = [0.5, 0.25, 0.75].map((f) => Math.round(view.left + view.width * f));
  return [4, Math.round(view.height * 0.12), Math.round(view.height * 0.3)].map((offset) => ({
    y: Math.round(view.top + offset),
    xs,
  }));
}

/**
 * Measures the position of a scrolled page. `null` when nothing is scrolled —
 * then there is nothing to carry over.
 */
export function captureScrollAnchor(win: Window): ScrollAnchor | null {
  const doc = win.document;
  const scroller = scrolledElement(win);
  if (!scroller) return null;

  const view = viewportOf(win, scroller);
  const anchor: ScrollAnchor = {
    url: win.location.href,
    scroller: scroller === doc.scrollingElement ? [] : shadowPath(scroller),
    path: [],
    within: 0,
    viewportY: 0,
    ratioY: ratio(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight),
    ratioX: ratio(scroller.scrollLeft, scroller.scrollWidth - scroller.clientWidth),
  };

  const height = view.height || 1;

  /** Note the element as the anchor — `false` when it is of no use as one. */
  const take = (hit: Element | null, y: number): boolean => {
    if (!hit || hit === doc.documentElement || hit === doc.body || hit === scroller) return false;
    if (pinned(win, hit)) return false;

    const box = hit.getBoundingClientRect();
    if (box.height <= 0) return false;

    const path = shadowPath(hit);
    if (path.length === 0 || path.some((segment) => !segment)) return false;

    anchor.path = path;
    anchor.within = Math.min(1, Math.max(0, (y - box.top) / box.height));
    anchor.viewportY = (y - view.top) / height;
    return true;
  };

  for (const line of readingLines(view)) {
    // What is *at* the point — and if every point on the line lands in empty
    // space (a wide margin, a gap between blocks), what the line runs through.
    const found =
      line.xs.some((x) => take(deepElementFromPoint(doc, x, line.y), line.y)) ||
      take(elementAcross(win, scroller, line.y), line.y);
    if (found) break;
  }

  return anchor;
}

/**
 * Where the frame has to stand for the anchor to sit under the same point
 * again. Falls back to the relative position when the element is missing from
 * this frame (a block dropped at mobile width) — better a roughly matching
 * position than the top of the page.
 *
 * `null` when not even the scroll container exists here — then there is nothing
 * to set, and the frame stays where it is.
 *
 * Two flags say how much the result is worth while the page is still loading.
 * `matched` — was the anchor element hit? The fallback divides by a document
 * height that is only growing then, and would land near the top, precisely the
 * position that is supposed to be spared. `clamped` — is the document still too
 * short for the position at all? Then the frame is standing somewhere it will
 * not stay.
 */
export function resolveScrollAnchor(
  doc: Document,
  anchor: ScrollAnchor,
): { el: Element; top: number; left: number; matched: boolean; clamped: boolean } | null {
  const win = doc.defaultView;
  if (!win) return null;

  const el =
    anchor.scroller.length > 0 ? findByShadowPath(doc, anchor.scroller) : doc.scrollingElement;
  if (!el) return null;

  const view = viewportOf(win, el);
  const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
  const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
  const left = Math.min(maxLeft, anchor.ratioX * maxLeft);

  const target = anchor.path.length > 0 ? findByShadowPath(doc, anchor.path) : null;
  const box = target?.getBoundingClientRect();
  // Found but not laid out (display: none at this width) — the box would sit at
  // 0/0 and send the frame to the top of the page.
  if (box && box.height > 0) {
    // Position of the reading point in the scrolled content …
    const point = el.scrollTop + (box.top - view.top) + anchor.within * box.height;
    // … minus where in the visible area it is supposed to sit again.
    const want = point - anchor.viewportY * view.height;
    return {
      el,
      top: Math.min(maxTop, Math.max(0, want)),
      left,
      matched: true,
      // Above the top edge is a legitimate result (the anchor sits right at the
      // start); only a document too short for it counts as cut off.
      clamped: want > maxTop + 1,
    };
  }

  return { el, top: Math.min(maxTop, anchor.ratioY * maxTop), left, matched: false, clamped: false };
}
