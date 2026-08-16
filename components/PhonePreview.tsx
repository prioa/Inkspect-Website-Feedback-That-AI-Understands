import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { motionOk } from '@/lib/motion';
import { useFireHint } from '@/lib/hints';
import { useTip } from './Tooltip';
import { IconClose, IconContrast } from './icons';

/** Logical mobile viewport inside the mockup (iPhone class). */
export const PHONE_VIEW_W = 375;
export const PHONE_VIEW_H = 760;
/** Display scale — small enough to float beside the page. */
export const PHONE_SCALE = 0.55;
/**
 * Screen area inside the mockup — rounded like the DeviceFrame within it,
 * which sizes its viewport with `Math.round(width * zoom)`. Without the same
 * rounding the box is a quarter pixel wider than its content, and the screen
 * background flashes through the gap as a bright edge.
 */
const SCREEN_W = Math.round(PHONE_VIEW_W * PHONE_SCALE);
const SCREEN_H = Math.round(PHONE_VIEW_H * PHONE_SCALE);
/** Outer dimensions of the mockup (screen + bezel padding + frame). */
const FRAME_W = SCREEN_W + 22;
const FRAME_H = SCREEN_H + 52;

/*
  Animation: on appearing, the mockup grows out of the phone button in the bar
  and on hiding flies the same distance back | triggered by the phone button or
  the X on the frame | 460 ms in, 520 ms out until unmount. Without motion
  (prefers-reduced-motion) it appears and disappears abruptly — both
  immediately, so the preview never stands around longer than intended.

  The timings appear twice: here as constants for the timers, in styles.ts as
  CSS durations. Change one and you have to change the other.
*/
/** Fly-in — must match the duration of `ink-phone-launch`. */
const LAUNCH_MS = 460;
/** Fly-out until unmount — duration of `.phone-prev--flight` plus a buffer. */
const FLIGHT_MS = 520;

/**
 * How much work has to have happened before the mockup fades for the first
 * time.
 *
 * Generously measured: the first fade is also where the hint about the switch
 * appears, and that should land in a session where the user already knows what
 * they are looking at — not in the first minute.
 */
const FIRST_DIM_MS = 40_000;
/** After that, a short wait is enough: the mockup is known, it just steps aside. */
const IDLE_DIM_MS = 2_000;
/** Duration of the fade transition — must match `.phone-prev--dim` in styles.ts. */
const DIM_FADE_MS = 700;

/**
 * Floating phone mockup in the feedback full-window mode: the current page
 * runs inside it at mobile width. Freely draggable by its frame (pointer
 * capture plus a click shield, so the iframes do not swallow the drag), hidden
 * via the X — it comes back through the phone button on the feedback FAB. The
 * screen content is supplied by the app as `children` — a full DeviceFrame, so
 * that marking, the element picker and sync work inside the mockup exactly as
 * they do in the large frame.
 */
export function PhonePreview({
  anchorRight = 24,
  hiding = false,
  dimIdle = true,
  awake = false,
  active = false,
  explaining = false,
  onToggleDimIdle,
  onHide,
  onHidden,
  getHideTarget,
  children,
}: {
  /**
   * Distance of the docked position from the right edge: by default the bottom
   * right corner; with feedback or an open panel the app pushes the mockup to
   * the left of it — the change glides (a CSS transition on left/top).
   */
  anchorRight?: number;
  /**
   * Switched off but still mounted: the app leaves the mockup standing until
   * the fly-out is through — otherwise the animation would exist only via the X
   * and not via the button in the bar.
   */
  hiding?: boolean;
  /**
   * May the mockup fade while idle? The switch on its frame flips this, and the
   * app remembers it. Off means: permanently fully visible.
   */
  dimIdle?: boolean;
  /**
   * Full opacity forced from outside, regardless of the wait: while the
   * feedback list is open or an entry is hovered or jumped to, the user is
   * looking at the mockup — it must not fade away at exactly that moment.
   */
  awake?: boolean;
  /**
   * Work is happening — the user scrolled in one of the previews. Starts the
   * countdown to the first fade (`FIRST_DIM_MS`); without it the mockup stays
   * fully visible.
   */
  active?: boolean;
  /**
   * The hint about fading is currently up. The mockup then lifts a little:
   * *this* window is what is being explained, and at full fade you can hardly
   * see what is meant. Not fully bright — that it *is* faded remains the core
   * of the statement.
   */
  explaining?: boolean;
  /** Fading while idle on/off (the switch on the frame). */
  onToggleDimIdle?: () => void;
  /** Start hiding (the X on the frame) — the app then sets `hiding`. */
  onHide: () => void;
  /** The flight is through, the app may tear down. */
  onHidden?: () => void;
  /** Target of both flight directions — the phone button in the tool bar. */
  getHideTarget?: () => DOMRect | null;
  /** Screen content (a DeviceFrame at the mockup's size and scale). */
  children: ReactNode;
}) {
  /** Position dragged by the user — wins over the docking for good. */
  const [manual, setManual] = useState<{ x: number; y: number } | null>(null);
  // Bottom right (above the feedback FAB) — or to the left of the panel.
  // Whole pixels: on a half-pixel boundary the frame and the screen edge blur
  // together, and the mockup's border looks brightly frayed.
  const pos = manual ?? {
    x: Math.round(Math.max(8, window.innerWidth - FRAME_W - anchorRight)),
    y: Math.round(Math.max(8, window.innerHeight - FRAME_H - 78)),
  };
  const [dragging, setDragging] = useState(false);
  const tip = useTip();

  /**
   * Without hover the mockup visually withdraws (opacity .3). After the mouse
   * leaves, the dimming starts after 2 s — but only once it has faded at least
   * once at all. Explicit timers rather than CSS delays: the timings should be
   * exact and traceable.
   */
  const [dimmed, setDimmed] = useState(false);
  const dimTimer = useRef(0);
  const armDim = (delay: number) => {
    window.clearTimeout(dimTimer.current);
    dimTimer.current = window.setTimeout(() => setDimmed(true), delay);
  };
  const wake = () => {
    window.clearTimeout(dimTimer.current);
    setDimmed(false);
  };

  /** When the first fade is due; 0 for as long as nothing has happened. */
  const firstDimAt = useRef(0);
  /** From here on the short wait applies. */
  const firstDimDone = useRef(false);

  /**
   * Set the wait. Before the first fade, only the `FIRST_DIM_MS` countdown
   * counts — the short 2 s must not cut it short, or the mockup fades away
   * within the first minute after all, just by way of "move over it once and
   * off it goes".
   *
   * It counts against the remainder of the countdown rather than restarting it:
   * a glance at the mockup should stop the clock, not turn it back.
   */
  const armIdleDim = () => {
    if (firstDimDone.current) return armDim(IDLE_DIM_MS);
    if (!firstDimAt.current) return;
    armDim(Math.max(0, firstDimAt.current - Date.now()));
  };

  /**
   * The first fade hangs off real work, not off the clock since it appeared.
   *
   * It used to run a fixed 5 s after appearing — right into the first contact,
   * while the user was still reading the coachmark. A half-transparent window
   * then looks like a fault, and the hint about it (`phone-dimmed`, triggered
   * by the first real fade further down) arrived at a point where nothing had
   * been done yet.
   */
  useEffect(() => {
    if (!active || firstDimAt.current) return;
    firstDimAt.current = Date.now() + FIRST_DIM_MS;
    armIdleDim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => () => window.clearTimeout(dimTimer.current), []);

  /**
   * If one of the two reasons to stay bright falls away (the switch turned off,
   * the feedback list open), the wait restarts — otherwise the mockup dims at
   * exactly the moment the reason disappears, because the timer ran out long
   * ago.
   */
  const brightRef = useRef(!dimIdle || awake);
  useEffect(() => {
    const bright = !dimIdle || awake;
    if (bright === brightRef.current) return;
    brightRef.current = bright;
    if (bright) wake();
    else armIdleDim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awake, dimIdle]);

  /**
   * Dragging by the frame: native listeners plus direct style mutation per move
   * (as with the tool bar) — no React re-render per mouse movement, or the
   * mockup and its iframe lag noticeably. State only takes over the final
   * position on release.
   */
  const startDrag = (e: ReactPointerEvent) => {
    // Only the bezel drags: the screen is for drawing and operating — an
    // overlay stroke must not drag the mockup along.
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, .phone-prev__screen')) return;
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const offX = e.clientX - box.left;
    const offY = e.clientY - box.top;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
    wake();
    setDragging(true);
    const at = (ev: PointerEvent) => ({
      x: Math.round(Math.max(8, Math.min(ev.clientX - offX, window.innerWidth - 80))),
      y: Math.round(Math.max(8, Math.min(ev.clientY - offY, window.innerHeight - 80))),
    });
    const move = (ev: PointerEvent) => {
      const p = at(ev);
      root.style.left = `${p.x}px`;
      root.style.top = `${p.y}px`;
    };
    const up = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* capture already gone */
      }
      setManual(at(ev));
      setDragging(false);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  /**
   * Distance from its own centre to the centre of the phone button. Fly-in and
   * fly-out share it: the mockup comes from exactly where it later flies back
   * to — so the button stays readable as the place it is kept, even if the bar
   * has moved in the meantime.
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const vectorToButton = () => {
    const own = rootRef.current?.getBoundingClientRect();
    const target = getHideTarget?.();
    if (!own || !target) return null;
    return {
      dx: target.left + target.width / 2 - (own.left + own.width / 2),
      dy: target.top + target.height / 2 - (own.top + own.height / 2),
    };
  };

  /**
   * Fly-in: set the starting point before the first frame (layout effect), or
   * the mockup flashes up fully built for one frame's length. Without a
   * measurable button, an expansion out of its own centre remains — still
   * better than a hard cut.
   */
  const [launch, setLaunch] = useState<{ dx: number; dy: number } | null>(null);
  useLayoutEffect(() => {
    if (!motionOk()) return;
    setLaunch(vectorToButton() ?? { dx: 0, dy: 0 });
    // The class has to go again after the run: a running animation beats every
    // normal declaration, so otherwise the idle dimming could no longer get
    // past the held opacity.
    const t = window.setTimeout(() => setLaunch(null), LAUNCH_MS + 60);
    return () => window.clearTimeout(t);
  }, []);

  /**
   * Fly-out: the mockup visibly flies to the phone button in the bar and only
   * disappears there. It is set off from outside via `hiding` — so it also runs
   * when the bar switches it off rather than the X.
   */
  const [flight, setFlight] = useState<{ dx: number; dy: number } | null>(null);
  useEffect(() => {
    if (!hiding) {
      setFlight(null);
      return;
    }
    const v = motionOk() ? vectorToButton() : null;
    if (!v) {
      onHidden?.();
      return;
    }
    setLaunch(null);
    setFlight(v);
    const t = window.setTimeout(() => onHidden?.(), FLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [hiding]);

  /** Actually faded — the wait alone does not decide that. */
  const isDim = dimmed && dimIdle && !awake && !dragging && !flight;

  /**
   * Explain the first real fade. A half-transparent window looks like a fault,
   * and nobody notices the switch against it by themselves. The moment is late
   * on purpose (`FIRST_DIM_MS`): that way the hint reaches someone who is
   * already working, rather than the first contact.
   */
  const fire = useFireHint();
  const wasDim = useRef(false);
  useEffect(() => {
    const first = isDim && !wasDim.current;
    wasDim.current = isDim;
    if (!first) return;
    // Only here does the fade count as having happened — not already when the
    // timer runs out. If it runs out while the mockup stays bright for another
    // reason (an open list), there was nothing for the user to see, and the
    // long countdown still applies.
    firstDimDone.current = true;
    // One after the other, not at the same time: the hint explains something
    // you have to have seen. Started during the transition, it would stand there
    // before it had even become apparent that anything had changed.
    const t = window.setTimeout(() => fire('phone-dimmed'), DIM_FADE_MS);
    return () => window.clearTimeout(t);
  }, [isDim, fire]);

  return (
    <>
      {/* Shield over the window: keeps the page iframes out of the drag. */}
      {dragging && <div className="fsbar-shield" />}
      <div
        ref={rootRef}
        className={`phone-prev${dragging ? ' phone-prev--dragging' : ''}${
          flight ? ' phone-prev--flight' : ''
        }${launch && !flight ? ' phone-prev--launch' : ''}${
          isDim ? ' phone-prev--dim' : ''
        }${isDim && explaining ? ' phone-prev--explained' : ''}`}
        onPointerEnter={wake}
        onPointerLeave={armIdleDim}
        style={
          {
            left: pos.x,
            top: pos.y,
            // Starting point of the fly-in; the keyframes read it out.
            ...(launch ? { '--fly-x': `${launch.dx}px`, '--fly-y': `${launch.dy}px` } : {}),
            ...(flight
              ? { transform: `translate(${flight.dx}px, ${flight.dy}px) scale(.08)`, opacity: 0 }
              : {}),
          } as CSSProperties
        }
        role="complementary"
        aria-label="Mobile preview"
      >
        <div
          className="phone-prev__frame"
          onPointerDown={startDrag}
          title="Drag to move"
        >
          <span className="phone-prev__notch" />
          {/* Both buttons in the corner: fading first, then hiding — the more
              final action sits on the outside. */}
          <div className="phone-prev__actions">
            {onToggleDimIdle && (
              <button
                type="button"
                className={`phone-prev__btn phone-prev__dim-toggle${
                  dimIdle ? '' : ' is-on'
                }`}
                aria-pressed={!dimIdle}
                // Empty title: otherwise the browser shows the frame's "Drag to
                // move" over the buttons too — next to our own bubble.
                title=""
                {...tip(
                  dimIdle
                    ? 'Preview fades when idle — click to keep it fully visible'
                    : 'Preview stays fully visible — click to let it fade when idle',
                  { prefer: 'below', wide: true },
                )}
                onClick={onToggleDimIdle}
              >
                <IconContrast size={12} />
              </button>
            )}
            <button
              type="button"
              className="phone-prev__btn phone-prev__close"
              title=""
              {...tip('Hide the preview — it tucks into the phone button in the bar', {
                prefer: 'below',
                wide: true,
              })}
              onClick={onHide}
            >
              <IconClose size={13} />
            </button>
          </div>
          <div className="phone-prev__screen" style={{ width: SCREEN_W, height: SCREEN_H }}>
            {children}
          </div>
          <span className="phone-prev__home" />
        </div>
      </div>
    </>
  );
}
