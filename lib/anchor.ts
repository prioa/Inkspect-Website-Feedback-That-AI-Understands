/**
 * Anchor measurement for everything that attaches itself to an element of the
 * shell: the tour spotlight, the hints and the hover tooltips.
 *
 * Shared, because all three have the same hard part — the anchors move out
 * from under the overlay (grid rewrap, a bar that was dragged, window
 * resizing), and they do it without firing any event you could catch. Rather
 * than chasing each case separately, this remeasures once per frame and only
 * re-renders on a real change.
 */

import { useEffect, useState } from 'react';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Bounding box of all matches — `null` when none is visible.
 *
 * The search runs in the shell's shadow root, not the document: the entire UI
 * lives in there and would be invisible via `document`. The rects are still
 * viewport coordinates, because the host is `position: fixed; inset: 0`.
 */
export function measureAnchor(
  root: ParentNode,
  selectors: string[] | undefined,
  pad = 0,
): Rect | null {
  if (!selectors) return null;
  let box: Rect | null = null;
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    box = box
      ? {
          x: Math.min(box.x, r.left),
          y: Math.min(box.y, r.top),
          w: Math.max(box.x + box.w, r.right) - Math.min(box.x, r.left),
          h: Math.max(box.y + box.h, r.bottom) - Math.min(box.y, r.top),
        }
      : { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  if (!box) return null;
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

export function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  );
}

/**
 * Anchor box, remeasured continuously. `selectors` should be stable (a
 * constant or memoised) — a fresh array per render restarts the loop.
 */
export function useAnchorRect(
  root: ParentNode,
  selectors: string[] | undefined,
  pad = 0,
): Rect | null {
  const [rect, setRect] = useState<Rect | null>(() => measureAnchor(root, selectors, pad));

  useEffect(() => {
    let raf = 0;
    let last: Rect | null = null;
    const tick = () => {
      const next = measureAnchor(root, selectors, pad);
      if (!sameRect(next, last)) {
        last = next;
        setRect(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [root, selectors, pad]);

  return rect;
}

/**
 * The four areas around a hole — the tour spotlight and the hints build their
 * veil out of them.
 *
 * Four rectangles rather than one area with a mask: that makes the hole a real
 * hole. Nothing lies over the highlighted element — it stays perfectly sharp
 * even while the areas blur the background, and (where the areas catch no
 * pointers) it stays clickable.
 *
 * Without a hole, a single area covers everything. Edge cases — a hole partly
 * or entirely outside the area — fall out of the clipping by themselves: empty
 * strips are dropped.
 *
 * `bounds` limits the whole thing to one element instead of the window: a hint
 * about a row in the feedback list pushes back the *rest of that list* and
 * leaves the page alone. Everything outside stays untouched, which is the
 * point — the veil should say "this row of the ones here", not stop the window.
 */
export function spotlightPanes(hole: Rect | null, bounds?: Rect | null): Rect[] {
  const area = bounds ?? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const ax = area.x;
  const ay = area.y;
  const ax1 = area.x + area.w;
  const ay1 = area.y + area.h;
  if (!hole) return [area];
  const x0 = Math.max(ax, Math.min(hole.x, ax1));
  const x1 = Math.max(ax, Math.min(hole.x + hole.w, ax1));
  const y0 = Math.max(ay, Math.min(hole.y, ay1));
  const y1 = Math.max(ay, Math.min(hole.y + hole.h, ay1));
  return [
    { x: ax, y: ay, w: area.w, h: y0 - ay },
    { x: ax, y: y1, w: area.w, h: ay1 - y1 },
    { x: ax, y: y0, w: x0 - ax, h: y1 - y0 },
    { x: x1, y: y0, w: ax1 - x1, h: y1 - y0 },
  ].filter((r) => r.w > 0 && r.h > 0);
}

/** Which side of the anchor the box ended up on — for the arrow. */
export type Side = 'below' | 'above' | 'right' | 'left' | 'none';

export interface Placement {
  left: number;
  top: number;
  side: Side;
}

const EDGE = 8;

/**
 * Box below the anchor, otherwise above it, otherwise centred — always inside
 * the window.
 *
 * Without an anchor it lands in the centre of the window; that is the case of
 * a tour step that points at nothing in particular.
 */
export function placeBox(anchor: Rect | null, w: number, h: number): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!anchor) {
    return {
      left: Math.round((vw - w) / 2),
      top: Math.round((vh - h) / 2),
      side: 'none',
    };
  }
  const gap = 14;
  const below = anchor.y + anchor.h + gap;
  const above = anchor.y - gap - h;
  const fitsBelow = below + h <= vh - EDGE;
  const top = fitsBelow ? below : above >= EDGE ? above : Math.max(EDGE, (vh - h) / 2);
  const wanted = anchor.x + anchor.w / 2 - w / 2;
  const left = Math.max(EDGE, Math.min(wanted, vw - w - EDGE));
  return {
    left: Math.round(left),
    top: Math.round(top),
    side: fitsBelow ? 'below' : above >= EDGE ? 'above' : 'none',
  };
}

/**
 * Like `placeBox`, but with a preferred direction — the hover tooltips of a
 * docked tool bar point outwards, away from the bar, or the bubble would cover
 * the neighbouring buttons. If that direction does not fit in the window, it
 * falls back to the opposite side.
 */
export function placeBoxToward(
  anchor: Rect | null,
  w: number,
  h: number,
  prefer: Side,
): Placement {
  if (!anchor || prefer === 'none') return placeBox(anchor, w, h);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 10;
  const cx = anchor.x + anchor.w / 2;
  const cy = anchor.y + anchor.h / 2;

  const clampX = (v: number) => Math.max(EDGE, Math.min(v, vw - w - EDGE));
  const clampY = (v: number) => Math.max(EDGE, Math.min(v, vh - h - EDGE));

  const tries: Side[] =
    prefer === 'above'
      ? ['above', 'below']
      : prefer === 'below'
        ? ['below', 'above']
        : prefer === 'right'
          ? ['right', 'left']
          : ['left', 'right'];

  for (const side of tries) {
    if (side === 'above' && anchor.y - gap - h >= EDGE)
      return { left: clampX(cx - w / 2), top: Math.round(anchor.y - gap - h), side };
    if (side === 'below' && anchor.y + anchor.h + gap + h <= vh - EDGE)
      return { left: clampX(cx - w / 2), top: Math.round(anchor.y + anchor.h + gap), side };
    if (side === 'right' && anchor.x + anchor.w + gap + w <= vw - EDGE)
      return { left: Math.round(anchor.x + anchor.w + gap), top: clampY(cy - h / 2), side };
    if (side === 'left' && anchor.x - gap - w >= EDGE)
      return { left: Math.round(anchor.x - gap - w), top: clampY(cy - h / 2), side };
  }
  return placeBox(anchor, w, h);
}
