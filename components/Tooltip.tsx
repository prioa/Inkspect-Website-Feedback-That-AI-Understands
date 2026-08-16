import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * One hover tooltip for the whole interface.
 *
 * It replaces two systems that ran side by side: the full-window bar's own
 * one (which could show shortcuts, but stopped at the bar) and ~80 native
 * `title` attributes in the panels and header (everywhere, but without
 * shortcuts and with the browser's sluggish delay).
 *
 * The tooltip is also what makes the hints safe (`lib/hints.ts`): because
 * every statement can be read here permanently, a bubble may disappear on its
 * own without anything being lost.
 *
 * Rather than threading props through — the buttons sit five levels deep —
 * this runs over a context. A call site only writes:
 *
 *     const tip = useTip();
 *     <button {...tip('Undo last marking', { keys: 'Cmd/Ctrl+Z' })}>
 */

/** Which side of the button the bubble should appear on. */
export type TipSide = 'above' | 'below' | 'left' | 'right';

export interface TipOpts {
  /** Shortcut, rendered as a `kbd` after the text. */
  keys?: string;
  /**
   * Preferred direction. A docked tool bar points outwards, otherwise the
   * bubble covers the neighbouring buttons.
   */
  prefer?: TipSide;
  /** Longer explanation: the bubble wraps instead of being forced into one line. */
  wide?: boolean;
}

interface TipState {
  label: string;
  keys?: string;
  wide?: boolean;
  side: TipSide;
  x: number;
  y: number;
  /**
   * The `.root` element the bubble is portalled into.
   *
   * Mandatory: the design tokens (colours, font sizes) hang off `.root`, and
   * `:host` is reset via `all: initial`. A bubble *next to* `.root` — that is,
   * where this host sits in the tree — would resolve not a single variable and
   * would end up in the browser's default serif with no background.
   */
  host: Element;
  /** The button being hovered — see the liveness check in the host. */
  anchor: Element;
}

interface TipApi {
  show: (el: Element, label: string, opts: TipOpts | undefined) => void;
  hide: () => void;
}

const TipContext = createContext<TipApi | null>(null);

/** Gap between the button and the bubble. */
const GAP = 10;
/**
 * Rough size of the bubble, for the flip decision. Measuring exactly would
 * mean rendering first and jumping afterwards — for "does the bubble still fit
 * in the window" a generous estimate is enough.
 */
const EST_W = 240;
const EST_H = 64;

function fits(side: TipSide, r: DOMRect): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (side === 'above') return r.top - GAP - EST_H >= 0;
  if (side === 'below') return r.bottom + GAP + EST_H <= vh;
  if (side === 'left') return r.left - GAP - EST_W >= 0;
  return r.right + GAP + EST_W <= vw;
}

const OPPOSITE: Record<TipSide, TipSide> = {
  above: 'below',
  below: 'above',
  left: 'right',
  right: 'left',
};

/** Anchor point of the chosen side; CSS does the offset via transform. */
function pointFor(side: TipSide, r: DOMRect): { x: number; y: number } {
  if (side === 'above') return { x: r.left + r.width / 2, y: r.top - GAP };
  if (side === 'below') return { x: r.left + r.width / 2, y: r.bottom + GAP };
  if (side === 'left') return { x: r.left - GAP, y: r.top + r.height / 2 };
  return { x: r.right + GAP, y: r.top + r.height / 2 };
}

/**
 * Hangs the tooltip into the shell. Belongs around the entire UI once — the
 * bubble itself renders last, so it sits above everything.
 */
export function TooltipHost({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);

  const show = useCallback((el: Element, label: string, opts: TipOpts | undefined) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    // The hovered button sits inside `.root` itself — from there the portal
    // target is safe to find without threading a ref through.
    const host = el.closest('.root');
    if (!host) return;
    const wanted = opts?.prefer ?? 'above';
    const side = fits(wanted, r) ? wanted : fits(OPPOSITE[wanted], r) ? OPPOSITE[wanted] : wanted;
    const { x, y } = pointFor(side, r);
    setTip({
      label,
      keys: opts?.keys,
      wide: opts?.wide,
      side,
      x,
      y,
      host,
      anchor: el,
    });
  }, []);

  const hide = useCallback(() => setTip(null), []);

  /**
   * Take the bubble away as soon as its button disappears.
   *
   * Without this it hangs around: if the hovered element vanishes while the
   * pointer is on it — a mode change, or the feedback button that only appears
   * with the first marker — no `pointerleave` ever fires, and the bubble then
   * labels a button that no longer exists.
   */
  useEffect(() => {
    if (!tip) return;
    let raf = 0;
    const tick = () => {
      const r = tip.anchor.getBoundingClientRect();
      if (!tip.anchor.isConnected || r.width <= 0 || r.height <= 0) setTip(null);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tip]);
  const api = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <TipContext.Provider value={api}>
      {children}
      {tip &&
        createPortal(
          <div
            className={`tip tip--${tip.side}${tip.wide ? ' tip--wide' : ''}`}
            style={{ left: tip.x, top: tip.y }}
            role="tooltip"
          >
            <span className="tip__label">{tip.label}</span>
            {tip.keys && <kbd className="kbd">{tip.keys}</kbd>}
          </div>,
          tip.host,
        )}
    </TipContext.Provider>
  );
}

/**
 * Take the bubble away immediately, without the pointer leaving the button —
 * needed when something else starts under the pointer (dragging the bar by its
 * grip).
 */
export function useHideTip(): () => void {
  const api = useContext(TipContext);
  return useCallback(() => api?.hide(), [api]);
}

/** Props a button takes on in order to get a tooltip. */
export interface TipProps {
  'aria-label': string;
  onPointerEnter: (e: ReactPointerEvent) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
}

/**
 * Returns the props for a button. The text doubles as the `aria-label` — one
 * source instead of two that can drift apart.
 *
 * Outside the host (tests, a panel rendered in isolation) it falls back
 * quietly to the bare `aria-label` instead of throwing.
 */
export function useTip(): (label: string, opts?: TipOpts) => TipProps {
  const api = useContext(TipContext);
  return useCallback(
    (label: string, opts?: TipOpts) => ({
      'aria-label': label,
      onPointerEnter: (e: ReactPointerEvent) => api?.show(e.currentTarget, label, opts),
      onPointerLeave: () => api?.hide(),
      // Gone on click: the bubble often describes the state from a moment ago
      // ("Hide feedback list"), and after the click that no longer holds.
      onPointerDown: () => api?.hide(),
    }),
    [api],
  );
}
