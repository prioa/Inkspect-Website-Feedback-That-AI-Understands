import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { placeBox, placeBoxToward, spotlightPanes, useAnchorRect, type Rect } from '@/lib/anchor';
import type { HintDef } from '@/lib/hints';
import { IconClose } from './icons';

/** Must match the width of .nudge in styles.ts. */
const NUDGE_W = 280;
/** A little air around the anchor, so the ring does not clip it. */
const PAD = 6;

/** Do the two boxes share any area at all? */
function overlaps(a: Rect | null, b: Rect): boolean {
  if (!a) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * A hint in the moment: a speech bubble at the button it belongs to, with a
 * ring around that button and the rest of the interface blurred behind it.
 *
 * The veil is necessary because the hint appears exactly where the work is
 * happening: in the middle of a card full of buttons, fields and previews.
 * Ring and bubble alone would drown in that — they are two small elements
 * among twenty equally loud ones. Blurred, the other nineteen fall back, and
 * the eye lands in one jump where it belongs.
 *
 * None of this makes the hint modal: the veil catches no pointers, and the
 * hole above the anchor keeps it sharp and usable. Anyone who wants to carry
 * on simply clicks through — which preserves the difference from the tour,
 * which does stop and demand an acknowledgement.
 *
 * Without an anchor (its reference point has just disappeared) the bubble goes
 * to the centre of the window and drops ring, arrow and veil — without a hole,
 * the veil would be a dimming that points at nothing.
 *
 * `quiet` hints keep ring and bubble but drop the veil — see `quiet` in
 * hints.ts: either they are about the page itself, which the blur would hide,
 * or their anchor stands out on its own and needs no crowd pushed back.
 */
export function Nudge({
  root,
  def,
  onClose,
}: {
  /** Shadow root of the shell — the anchor elements live there. */
  root: ParentNode;
  def: HintDef;
  onClose: () => void;
}) {
  // The preferred anchor as long as it is on screen, otherwise the fallback —
  // see `anchorPrefer` in hints.ts. Both measured continuously: the list can
  // close while the bubble stands, and the ring then moves over to the button
  // rather than being left pointing at nothing.
  const preferred = useAnchorRect(root, def.anchorPrefer, PAD);
  const fallback = useAnchorRect(root, def.anchor, PAD);
  const anchor = preferred ?? fallback;
  const [height, setHeight] = useState(96);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const h = boxRef.current?.offsetHeight;
    if (h) setHeight(h);
  }, [def]);

  const place = useMemo(() => {
    const p = def.prefer
      ? placeBoxToward(anchor, NUDGE_W, height, def.prefer)
      : placeBox(anchor, NUDGE_W, height);
    // Without an anchor the bubble is a message, not a pointing finger.
    // `placeBox` then puts it in the centre of the window — exactly where the
    // work is. Up top it stays out of the way and still in view.
    return anchor ? p : { ...p, top: 24 };
  }, [anchor, height, def.prefer]);

  // The arrow sits on the centre of the anchor, not on the centre of the bubble
  // — at the window edge the bubble is shifted, the button is not. Beside the
  // anchor it runs the other way: the offset is vertical then, and the CSS pins
  // the arrow to the bubble's near edge.
  const arrow = useMemo(() => {
    if (!anchor || place.side === 'none') return null;
    const clamp = (v: number, max: number) => Math.max(14, Math.min(v, max - 14));
    return place.side === 'left' || place.side === 'right'
      ? { top: clamp(anchor.y + anchor.h / 2 - place.top, height) }
      : { left: clamp(anchor.x + anchor.w / 2 - place.left, NUDGE_W) };
  }, [anchor, place, height]);

  // Same condition as the ring: both belong to the pointing finger, and there
  // is no such thing as half of one (a veil without a ring).
  const spotlight = Boolean(anchor) && place.side !== 'none';
  /** The container a `veilWithin` hint keeps its veil inside. */
  const bounds = useAnchorRect(root, def.veilWithin, 0);
  // A quiet hint keeps the ring and drops the veil — see `quiet` in hints.ts.
  // `veilWithin` narrows it to one container instead; is that container not on
  // screen (the list closed, the hint fell back to the button), there is
  // nothing to push back and the veil stays away rather than growing to the
  // window it was explicitly kept out of.
  const shades = useMemo(() => {
    if (!spotlight || def.quiet) return [];
    if (def.veilWithin) {
      // And only while the hole really lies in that container. Fall back to the
      // outer anchor (the row is gone, the ring sits on the button again) and
      // the hole would be clipped away to nothing: the veil would cover the
      // whole card evenly, with the thing it points at outside it. A veil with
      // no hole says "not here" about everything it lies on — the opposite of
      // what it is for.
      return bounds && overlaps(anchor, bounds) ? spotlightPanes(anchor, bounds) : [];
    }
    return spotlightPanes(anchor);
  }, [spotlight, anchor, def.quiet, def.veilWithin, bounds]);

  return (
    <div className="nudge-layer">
      {shades.map((r, i) => (
        <div
          key={i}
          className={`nudge__shade${def.veilWithin ? ' nudge__shade--soft' : ''}`}
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        />
      ))}

      {anchor && spotlight && (
        <div
          className="nudge__ring"
          style={{ left: anchor.x, top: anchor.y, width: anchor.w, height: anchor.h }}
        />
      )}

      <div
        ref={boxRef}
        className={`nudge nudge--${place.side}`}
        style={{ left: place.left, top: place.top }}
        // `status` rather than `dialog`: the hint does not interrupt, it reports.
        role="status"
        aria-live="polite"
      >
        {arrow && <span className="nudge__arrow" style={arrow} />}
        <div className="nudge__text">
          <strong className="nudge__title">{def.title}</strong>
          <p className="nudge__body">{def.body}</p>
        </div>
        <button className="nudge__close" aria-label="Dismiss" onClick={onClose}>
          <IconClose size={12} />
        </button>
      </div>
    </div>
  );
}
