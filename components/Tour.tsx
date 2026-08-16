import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { placeBox, spotlightPanes, useAnchorRect } from '@/lib/anchor';
import { IconClose } from './icons';

/**
 * The live shell state the tour needs: action steps advance on it (first note
 * placed) and steps whose precondition disappears jump back.
 */
export interface TourState {
  /** At least one note on the current page. */
  hasFeedback: boolean;
  /** A marking tool is armed (any of them except "Interact"). */
  toolPicked: boolean;
}

interface Step {
  /** Which element is pointed at — the first match wins. Several selectors
   *  produce the bounding box (both line tools, for instance). */
  anchor?: string[];
  title: string;
  body: string;
  /** Extra margin around the hole. */
  pad?: number;
  /** Action step: advances by itself as soon as this holds. */
  advanceWhen?: (s: TourState) => boolean;
  /** Precondition — if it disappears, the tour jumps back to the last step
   *  whose precondition still holds. */
  needs?: (s: TourState) => boolean;
}

/**
 * The nudge has landed as soon as *either* half is in place: a tool is picked,
 * or a note already exists.
 *
 * Waiting for the finished note alone was too late. Anyone reaching for the
 * tool has read and followed the sentence "Pick a tool, then click the page" —
 * from that point the card has nothing left to say, yet it still sits in the
 * picture while you aim at the spot you want to mark. And for as long as it
 * stands, the hints stay quiet too (`tourActive` in `lib/hints.ts`), including
 * the one about the element picker.
 */
const started = (s: TourState) => s.hasFeedback || s.toolPicked;

/**
 * Exactly one coachmark — the nudge the interface cannot give on its own: in
 * full window mode a bar with two buttons sits there, and the feedback button
 * does not even exist before the first note. Without this pointing finger,
 * nobody knows where to start.
 *
 * Everything else is explained by the hints (`lib/hints.ts`) the moment a
 * feature is actually used or closed — and permanently by the hover tooltips.
 * The cheat sheet (?) remains for the overview.
 */
const STEPS: Step[] = [
  {
    title: 'Leave your first note',
    body: 'Pick a tool, then click the page. Right-click grabs any element directly.',
    anchor: ['.fsbar [data-tool="pin"]', '.fsbar [data-tool="element"]'],
    pad: 6,
    advanceWhen: started,
  },
];

/** Must match the width of `.tour__card` in `styles.ts`. */
const CARD_W = 340;

/**
 * Guided first-run tour with a spotlight: dims everything except the element
 * being explained and puts a card next to it. The hole is a real hole — the
 * four dimming areas leave it out, so the highlighted element stays clickable
 * and action steps ("right-click now") advance by themselves.
 */
export function Tour({
  root,
  state,
  index,
  onIndex,
  onClose,
}: {
  /** Shadow root of the shell — the anchor elements live there. */
  root: ParentNode;
  state: TourState;
  index: number;
  onIndex: (next: number) => void;
  /** `persist` = actively completed; merely dismissing it (X/Esc) brings the
   *  tips back on the next start. */
  onClose: (persist: boolean) => void;
}) {
  const steps = STEPS;

  // The index is set from outside (menu restart, jumping back) — clamp it hard
  // rather than rendering nothing on an outlier.
  const safeIndex = Math.max(0, Math.min(index, steps.length - 1));
  const step = steps[safeIndex] as Step;
  const pad = step.pad ?? 8;
  const hole = useAnchorRect(root, step.anchor, pad);
  const [cardH, setCardH] = useState(190);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Precondition gone (palette clicked away) — back to the last step that
  // works without it.
  useEffect(() => {
    if (step.needs && !step.needs(state)) {
      let back = safeIndex - 1;
      while (back > 0 && (steps[back] as Step).needs?.(state) === false) back--;
      onIndex(back);
    }
  }, [step, state, safeIndex, onIndex]);

  // Action step: the gesture landed, so move on — and on the last step "on"
  // means closed. Without this branch `onIndex(steps.length)` ran into
  // nothing: the index is clamped hard above, so the card just stood there
  // unchanged after the user had done exactly what it asked. It could then
  // only be got rid of via "Got it" — and until then it blocked the hints
  // (`tourActive` in `lib/hints.ts`), including the one about that very first
  // note.
  useEffect(() => {
    if (!step.advanceWhen?.(state)) return;
    if (safeIndex >= steps.length - 1) onClose(true);
    else onIndex(safeIndex + 1);
  }, [step, state, safeIndex, steps.length, onIndex, onClose]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h) setCardH(h);
  }, [step, safeIndex]);

  const next = useCallback(() => {
    if (safeIndex >= steps.length - 1) onClose(true);
    else onIndex(safeIndex + 1);
  }, [safeIndex, steps, onIndex, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose(false);
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation();
        next();
      } else if (e.key === 'ArrowLeft' && safeIndex > 0) {
        e.stopPropagation();
        onIndex(safeIndex - 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, onClose, onIndex, safeIndex]);

  const card = useMemo(() => placeBox(hole, CARD_W, cardH), [hole, cardH]);

  const shades = useMemo(() => spotlightPanes(hole), [hole]);

  const waiting = Boolean(step.advanceWhen);

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-label={step.title}>
      {shades.map((r, i) => (
        <div
          key={i}
          className="tour__shade"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        />
      ))}

      {hole && (
        <div
          className="tour__ring"
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
        />
      )}

      <div ref={cardRef} className="tour__card" style={{ left: card.left, top: card.top }}>
        <div className="tour__head">
          <span className="tour__title">{step.title}</span>
          <button
            className="icon-btn icon-btn--small"
            title="Skip tour"
            onClick={() => onClose(false)}
          >
            <IconClose size={14} />
          </button>
        </div>

        <p className="tour__body">{step.body}</p>

        <div className="tour__foot">
          {/* With a single step there are no dots — and no empty placeholder
              either: its `gap` to the action group would indent the button by
              12px instead of aligning it with the text. */}
          {steps.length > 1 && (
            <span className="tour__dots" aria-label={`Step ${safeIndex + 1} of ${steps.length}`}>
              {steps.map((s, i) => (
                <span
                  // The title is the list key, so step titles have to differ.
                  // That used to be guaranteed by the typed key union; now it
                  // rests on the prose.
                  key={s.title}
                  className={`tour__dot${i === safeIndex ? ' tour__dot--on' : ''}`}
                />
              ))}
            </span>
          )}
          <span className="tour__actions">
            {safeIndex > 0 && (
              <button className="tour__btn" onClick={() => onIndex(safeIndex - 1)}>
                {'Back'}
              </button>
            )}
            {waiting ? (
              // Action steps advance by themselves once the gesture landed —
              // "Got it" closes actively instead of waiting passively.
              <button className="tour__btn tour__btn--primary" onClick={() => onClose(true)}>
                {'Got it'}
              </button>
            ) : (
              <button className="tour__btn tour__btn--primary" onClick={next}>
                {safeIndex < steps.length - 1
                  ? 'Next'
                  : steps.length === 1
                    ? 'Got it'
                    : 'Done'}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
