import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { PaletteTool, Tool } from '@/lib/annotations';
import { TOOL_LABELS } from '@/lib/annotations';
import type { ToolbarDock, ToolbarPlacement } from '@/lib/settings';
import { useFireHint } from '@/lib/hints';
import { useHideTip, useTip, type TipSide } from './Tooltip';
import {
  IconArrow,
  IconCollapse,
  IconEllipse,
  IconExpand,
  IconEye,
  IconEyeOff,
  IconGrip,
  IconHLine,
  IconInspect,
  IconMessage,
  IconPen,
  IconPhone,
  IconPin,
  IconPointer,
  IconRect,
  IconText,
  IconTrash,
  IconUndo,
  IconVLine,
} from './icons';

interface Props {
  /** Desired position (mouse position of the right-click, shell coordinates). */
  at: { x: number; y: number };
  tool: PaletteTool;
  color: string;
  /** Colours on offer — the count comes from the settings. */
  colors: readonly string[];
  /** Order of the tools (sorted by drag and drop in the bar). */
  order: readonly Tool[];
  canUndo: boolean;
  onTool: (tool: PaletteTool) => void;
  onColor: (color: string) => void;
  onUndo: () => void;
  onClear: () => void;
  /** A click on the backdrop or Escape closes the palette. */
  onDismiss: () => void;
  /** Another right-click (on the backdrop) moves it there. */
  onMove: (x: number, y: number) => void;
}

export const TOOL_ICONS: Record<Tool, () => JSX.Element> = {
  element: () => <IconInspect />,
  pin: () => <IconPin />,
  pen: () => <IconPen />,
  rect: () => <IconRect />,
  ellipse: () => <IconEllipse />,
  arrow: () => <IconArrow />,
  hline: () => <IconHLine />,
  vline: () => <IconVLine />,
  text: () => <IconText />,
};

/**
 * Tools that stand directly in the bar. The element picker and the pin are the
 * two ways in; everything for drawing sits below them in the "Draw" group —
 * which keeps the bar short and the choice manageable.
 */
const PRIMARY_TOOLS: readonly Tool[] = ['element', 'pin'];

/** Split the bar's tools into primary buttons and the drawing group. */
function splitTools(order: readonly Tool[]): { primary: Tool[]; draw: Tool[] } {
  return {
    primary: order.filter((t) => PRIMARY_TOOLS.includes(t)),
    draw: order.filter((t) => !PRIMARY_TOOLS.includes(t)),
  };
}

/**
 * Tool buttons of both bars: first the primary tools, then a "Draw" button
 * that bundles the rest into a flyout. The button carries the icon of the
 * drawing tool last used and stays active for as long as one of them is
 * selected.
 */
function ToolButtons({
  order,
  tool,
  onTool,
  tipSide,
  placement = 'down',
}: {
  order: readonly Tool[];
  tool: PaletteTool;
  onTool: (tool: PaletteTool) => void;
  /** Where the tooltips point — away from the bar. */
  tipSide?: TipSide;
  /** Which way the flyout opens — the vertical bar needs 'right'. */
  placement?: 'up' | 'down' | 'right';
}) {
  const { primary, draw } = splitTools(order);
  const tip = useTip();

  /**
   * The flyout opens on hover and closes with a short delay: there is a gap
   * between button and menu, and without the delay it would be gone before the
   * pointer got across.
   */
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(0);
  const openMenu = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 220);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  /**
   * The flyout is portalled out of the bar: the floating bar scrolls when space
   * is short (`overflow: auto`) and would simply cut off an absolutely
   * positioned child. So it hangs free in the shell root and is positioned next
   * to the button by hand.
   */
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const root = btnRef.current?.closest('.root');
    if (root) setHost(root);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const b = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const gap = 8;
    let left: number;
    let top: number;
    if (placement === 'right') {
      left = b.right + gap;
      top = b.top + b.height / 2 - h / 2;
    } else {
      left = b.left + b.width / 2 - w / 2;
      top = placement === 'down' ? b.bottom + gap : b.top - gap - h;
      // No room on the preferred side? Flip to the other one.
      if (top < 8) top = b.bottom + gap;
      else if (top + h > window.innerHeight - 8) top = b.top - gap - h;
    }
    setAt({
      left: Math.max(8, Math.min(left, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - h - 8)),
    });
  }, [open, placement, draw.length]);

  // The drawing tool last chosen stays the face of the group.
  const faceRef = useRef<Tool>(draw[0] ?? 'pen');
  if (draw.includes(tool as Tool)) faceRef.current = tool as Tool;
  const face = draw.includes(faceRef.current) ? faceRef.current : (draw[0] ?? 'pen');
  const drawActive = draw.includes(tool as Tool);

  /** The digit shortcuts still follow the full order. */
  const keyOf = (t: Tool) => String(order.indexOf(t) + 1);

  const toolButton = (id: Tool) => (
    <button
      key={id}
      className={`icon-btn${tool === id ? ' icon-btn--active' : ''}`}
      // Anchor for the onboarding tour — it points at individual tools without
      // having to rely on their order.
      data-tool={id}
      {...tip(TOOL_LABELS[id], { keys: keyOf(id), prefer: tipSide })}
      aria-pressed={tool === id}
      onClick={() => {
        setOpen(false);
        onTool(id);
      }}
    >
      {TOOL_ICONS[id]()}
    </button>
  );

  return (
    <>
      {primary.map(toolButton)}

      {draw.length > 0 && (
        <span className="tool-group" onPointerEnter={openMenu} onPointerLeave={closeSoon}>
          <button
            ref={btnRef}
            className={`icon-btn tool-group__btn${drawActive ? ' icon-btn--active' : ''}${
              open ? ' tool-group__btn--open' : ''
            }`}
            data-tool="draw"
            aria-haspopup="true"
            aria-expanded={open}
            // Deliberately without a hover tooltip: the same pointer opens the
            // flyout, and that unfolds to the same side the bubble points to —
            // they would lie on top of each other. It would be redundant anyway,
            // since the flyout *is* the list of drawing tools.
            aria-label="Draw"
            // A click takes the drawing tool last used directly; choosing among
            // the rest goes through the hover flyout.
            onClick={() => {
              setOpen(false);
              onTool(face);
            }}
            // Keyboard operation: otherwise the flyout hangs off the pointer.
            onFocus={openMenu}
            onBlur={closeSoon}
          >
            {TOOL_ICONS[face]()}
            <span className="tool-group__caret" aria-hidden="true" />
          </button>

          {open &&
            host &&
            createPortal(
              <div
                ref={menuRef}
                className={`tool-group__menu${placement === 'right' ? ' tool-group__menu--col' : ''}`}
                role="menu"
                aria-label="Draw tools"
                // Keep it out of the picture before measuring, rather than jumping visibly.
                style={at ?? { left: -9999, top: -9999 }}
                onPointerEnter={openMenu}
                onPointerLeave={closeSoon}
              >
                {draw.map(toolButton)}
              </div>,
              host,
            )}
        </span>
      )}
    </>
  );
}

/**
 * Tool palette as a context menu: a right-click opens it next to the mouse,
 * picking a tool closes it again. Colour and undo keep it open, so you do not
 * have to right-click again for every setting. The cursor on the far left lets
 * you operate the previews normally; with any other tool you draw on whichever
 * frame the mouse is currently over.
 */
export function AnnotationPalette({
  at,
  tool,
  color,
  colors,
  order,
  canUndo,
  onTool,
  onColor,
  onUndo,
  onClear,
  onDismiss,
  onMove,
}: Props) {
  // Position it next to the mouse, but never let it stick out of the window:
  // measure after the first layout and clamp it before the paint.
  const ref = useRef<HTMLDivElement | null>(null);
  const tip = useTip();
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    setPos({
      x: Math.max(8, Math.min(at.x + 6, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(at.y + 10, window.innerHeight - h - 8)),
    });
  }, [at]);

  return (
    <>
      <div
        className="palette-backdrop"
        onClick={onDismiss}
        onContextMenu={(e) => {
          e.preventDefault();
          onMove(e.clientX, e.clientY);
        }}
      />
      <div
        ref={ref}
        className="palette"
        style={{ left: pos.x, top: pos.y }}
        role="toolbar"
        aria-label="Feedback tools"
      >
        <button
          className={`icon-btn${tool === 'interact' ? ' icon-btn--active' : ''}`}
          {...tip('Interact — clicks go to the page', { keys: 'Esc' })}
          aria-pressed={tool === 'interact'}
          onClick={() => onTool('interact')}
        >
          <IconPointer />
        </button>

        <span className="palette__sep" />

        <ToolButtons order={order} tool={tool} onTool={onTool} />

        <span className="palette__sep" />

        {colors.map((c) => (
          <button
            key={c}
            className={`swatch${color === c ? ' swatch--active' : ''}`}
            style={{ background: c }}
            {...tip('Colour')}
            aria-pressed={color === c}
            onClick={() => onColor(c)}
          />
        ))}

        <span className="palette__sep" />

        <button
          className="icon-btn"
          {...tip('Undo last marking', { keys: 'Cmd/Ctrl+Z' })}
          onClick={onUndo}
          disabled={!canUndo}
        >
          <IconUndo />
        </button>
        <button
          className="icon-btn icon-btn--danger"
          {...tip('Delete all markings on this page')}
          onClick={onClear}
          disabled={!canUndo}
        >
          <IconTrash />
        </button>
      </div>
    </>
  );
}

/** Distance from the edge at which the bar snaps to it (window pixels). */
const SNAP_ZONE = 90;

/** How long the bar announces itself once at startup. */
const INTRO_MS = 2400;
/** Pulse of the feedback button — class and keyframe name from styles.ts. */
const PULSE_CLASS = 'fsbar__feedback--pulse';
const PULSE_NAME = 'fs-feedback-pulse';

/**
 * Does the bar snap in at this pointer position? The nearest edge wins — if
 * none is close enough, the bar stays free where it was let go.
 */
function snapAt(x: number, y: number): ToolbarDock {
  const edges = [
    { dock: 'left', d: x },
    { dock: 'right', d: window.innerWidth - x },
    { dock: 'top', d: y },
    { dock: 'bottom', d: window.innerHeight - y },
  ] as const satisfies readonly { dock: ToolbarDock; d: number }[];
  const nearest = edges.reduce((a, b) => (b.d < a.d ? b : a));
  return nearest.d <= SNAP_ZONE ? nearest.dock : 'free';
}

/**
 * Floating tool bar. In full window mode it is the only piece of interface on
 * the page and therefore carries everything the mode needs: tools, phone
 * preview, feedback list and the way out. It can be dragged anywhere by its
 * grip; near the left edge or the bottom it snaps into the Photoshop-toolbox
 * or bar shape. Docked (grid mode) it sits fixed at the bottom and shows the
 * full tool set. Hovering a button puts its name next to it, over the page.
 */
export function FeedbackBar({
  tool,
  color,
  colors,
  order,
  placement,
  movable = true,
  minimal = false,
  canUndo,
  phoneVisible = false,
  feedbackCount = 0,
  feedbackOpen = false,
  feedbackPulse = 0,
  editsShown = true,
  editsHint = 0,
  hasEdits = false,
  onToggleEdits,
  onTool,
  onColor,
  onUndo,
  onClear,
  onFullscreen,
  onTogglePhone,
  onToggleFeedback,
  onExitFullscreen,
  onPlace,
}: {
  tool: PaletteTool;
  color: string;
  colors: readonly string[];
  order: readonly Tool[];
  /** Current placement (an edge or a free position). */
  placement: ToolbarPlacement;
  /** Movable? In grid mode the bar sits fixed at the bottom. */
  movable?: boolean;
  /** Full window: only Interact + the element picker as tools — everything
   *  else lives in the right-click palette. In exchange, the phone preview,
   *  feedback and the way out are added. Without hover the bar fades after a
   *  while; re-entering brings it straight back. */
  minimal?: boolean;
  canUndo: boolean;
  /** Phone mockup visible? (full window) */
  phoneVisible?: boolean;
  /** Open feedback entries — as a number on the feedback button. (full window) */
  feedbackCount?: number;
  /** Feedback list open? (full window) */
  feedbackOpen?: boolean;
  /** Counter: every increment restarts the pulse on the feedback button. */
  feedbackPulse?: number;
  /**
   * View switch (full window): is your own work on the preview — markings drawn
   * and saved changes applied? The state is global and therefore belongs in the
   * bar: in the feedback panel it sat behind something collapsible, and hidden
   * markers look like deleted ones.
   */
  editsShown?: boolean;
  /** Counter: every increment restarts the hint pulse on the eye. */
  editsHint?: number;
  /** There is anything on this page at all — otherwise no switch. */
  hasEdits?: boolean;
  onToggleEdits?: () => void;
  onTool: (tool: PaletteTool) => void;
  onColor: (color: string) => void;
  onUndo: () => void;
  onClear: () => void;
  /** Switch to full window mode — only offered in the device view. */
  onFullscreen?: () => void;
  /** Phone mockup on/off. (full window) */
  onTogglePhone?: () => void;
  /** Feedback list open/closed. (full window) */
  onToggleFeedback?: () => void;
  /** Leave full window mode. (full window) */
  onExitFullscreen?: () => void;
  /** New placement after moving. */
  onPlace: (placement: ToolbarPlacement) => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  /** Drag in progress: position of the bar and the edge it will fall into. */
  const [drag, setDrag] = useState<{ x: number; y: number; snap: ToolbarDock } | null>(null);
  const fire = useFireHint();
  const tip = useTip();
  const hideTip = useHideTip();

  /**
   * Entrance at startup: the bar grows out of the edge it is docked against
   * and then announces itself once more with a ring, so that it is noticed at
   * all. It is visible throughout.
   */
  const [intro, setIntro] = useState(minimal);
  useEffect(() => {
    if (!minimal) return;
    setIntro(true);
    const id = window.setTimeout(() => setIntro(false), INTRO_MS);
    return () => window.clearTimeout(id);
  }, [minimal]);

  /**
   * Restart the pulse even while it is still running — the running animation is
   * rewound rather than the button being swapped out.
   *
   * The counter used to sit as a `key` on the button: React then tore it down
   * and rebuilt it, which has the same effect. Except that the feedback card in
   * full window mode hangs off this very node (Floating UI keeps remeasuring
   * it) — after the swap it was observing a corpse, stopped remeasuring and
   * stayed where the button happened to be during the rebuild: a good 50 px
   * away from the icon its tail was pointing at.
   */
  const feedbackBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = feedbackBtnRef.current;
    if (!feedbackPulse || !el?.classList.contains(PULSE_CLASS)) return;

    // If it is still running, it gets rewound.
    const running = el
      .getAnimations()
      .find((a) => 'animationName' in a && a.animationName === PULSE_NAME);
    if (running) {
      running.cancel();
      running.play();
      return;
    }

    // Otherwise the previous round is through — and therefore gone from
    // `getAnimations()`, because an expired CSS animation without `fill` is no
    // longer in effect. Then only the detour via the class helps: take it off,
    // force a layout, put it back on. The intermediate step really has to be
    // measured, or the browser folds both into nothing. React sees none of it —
    // at the end the same class stands there as in its last render.
    el.classList.remove(PULSE_CLASS);
    void el.offsetWidth;
    el.classList.add(PULSE_CLASS);
  }, [feedbackPulse]);
  /**
   * Move the bar by its grip; on release it snaps in where applicable.
   *
   * The drag runs over pointer capture on the grip *and* a click shield across
   * the whole window: without both, the page's iframe swallows the movements as
   * soon as the cursor is over it — the bar would then get stuck at the edge.
   */
  const startBarDrag = (e: ReactPointerEvent) => {
    if (!movable || e.button !== 0) return;
    e.preventDefault();
    hideTip();
    // Hold on to the offset between pointer and the bar's corner — otherwise it
    // jumps under the cursor when grabbed.
    const rect = barRef.current!.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    const at = (ev: PointerEvent) => ({
      x: ev.clientX - offX,
      y: ev.clientY - offY,
      snap: snapAt(ev.clientX, ev.clientY),
    });
    const move = (ev: PointerEvent) => setDrag(at(ev));
    const finish = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', cancel);
      try {
        grip.releasePointerCapture(e.pointerId);
      } catch {
        /* capture already gone */
      }
    };
    const cancel = () => {
      finish();
      setDrag(null);
    };
    const up = (ev: PointerEvent) => {
      finish();
      const end = at(ev);
      setDrag(null);
      onPlace({
        dock: end.snap,
        // Keep it standing free in the window, even when dragged too far.
        x: Math.max(8, Math.min(end.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(end.y, window.innerHeight - rect.height - 8)),
      });
      // At an edge the bar changes shape — at the sides it becomes a vertical
      // toolbox. That surprises you if you only meant to push it.
      if (end.snap !== 'free') fire('first-bar-snap');
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancel);
    setDrag({ x: rect.left, y: rect.top, snap: placement.dock });
  };

  // During the drag the bar already shows the shape it will land in.
  const dock = drag ? drag.snap : placement.dock;
  const vertical = dock === 'left' || dock === 'right';

  /**
   * Tooltips move towards the inside of the window, away from the edge the bar
   * clings to — otherwise the bubble covers the neighbouring buttons.
   */
  const tipSide: TipSide =
    dock === 'left' ? 'right' : dock === 'right' ? 'left' : dock === 'top' ? 'below' : 'above';
  const style =
    dock === 'free' || drag
      ? { left: drag ? drag.x : placement.x, top: drag ? drag.y : placement.y }
      : undefined;

  /**
   * Is the view switch in the bar? Derived once, because the separator in front
   * of it hangs off the same answer — written out twice the two would drift,
   * and that is exactly how the old separator came to ignore the changes
   * switch and leave a bar with a line and nothing behind it.
   */
  const editsSwitch = Boolean(onToggleEdits) && (hasEdits || !editsShown);

  return (
    <>
      {/* Snap points only during the drag — left and bottom. The shield in
          front of them keeps the page in the iframe out of the drag. */}
      {drag && (
        <>
          <div className="fsbar-shield" />
          {(['left', 'right', 'top', 'bottom'] as const).map((edge) => (
            <div
              key={edge}
              className={`fsbar-snap fsbar-snap--${edge}${
                drag.snap === edge ? ' fsbar-snap--on' : ''
              }`}
            />
          ))}
        </>
      )}

      <div
        ref={barRef}
        className={`palette fsbar fsbar--${dock}${drag ? ' fsbar--dragging' : ''}${
          intro && !drag ? ' fsbar--intro' : ''
        }`}
        style={style}
        role="toolbar"
        aria-label="Feedback tools"
      >
        {/* The grip first: the handle leads the bar, as on any movable
            window. */}
        {movable && (
          <span
            className="fsbar__grip"
            {...tip('Drag to move — snaps to any edge')}
            onPointerDown={startBarDrag}
          >
            <IconGrip />
          </span>
        )}

        {minimal ? (
          /* Full window: the bar is the only interface and therefore carries
             everything — the two modes as a segment, then preview, feedback
             and the way out. The remaining tools (pin, drawing, colours, undo)
             live in the right-click palette. */
          <>
            {/* The two modes are mutually exclusive — as a shared trough you
                see at a glance which one you are in. */}
            <div className="fsbar__modes" role="group" aria-label="Mode">
              <button
                className={`icon-btn${tool === 'interact' ? ' icon-btn--active' : ''}`}
                {...tip('Interact — clicks go to the page', { keys: 'Esc', prefer: tipSide })}
                aria-pressed={tool === 'interact'}
                onClick={() => onTool('interact')}
              >
                <IconPointer />
              </button>
              <button
                className={`icon-btn${tool === 'element' ? ' icon-btn--active' : ''}`}
                data-tool="element"
                {...tip(TOOL_LABELS.element, {
                  keys: String(order.indexOf('element') + 1),
                  prefer: tipSide,
                })}
                aria-pressed={tool === 'element'}
                onClick={() => onTool('element')}
              >
                {TOOL_ICONS.element()}
              </button>
            </div>

            {(onTogglePhone || editsSwitch || onToggleFeedback) && (
              <span className="palette__sep" />
            )}

            {onTogglePhone && (
              <button
                className={`icon-btn fsbar__phone${phoneVisible ? ' icon-btn--active' : ''}`}
                {...tip('Mobile preview', { prefer: tipSide })}
                aria-pressed={phoneVisible}
                onClick={onTogglePhone}
              >
                <IconPhone />
              </button>
            )}

            {/* What is on screen right now: preview, and next to it the one
                switch for your own work — markings and applied changes were two
                buttons for one question, and four combinations of which only
                two were ever meant.

                It appears once there is something to switch; turned off it
                stays even after the last entry is gone, or there would be no
                way back to your own view. */}
            {editsSwitch && (
              <button
                // The counter as the key restarts the hint pulse even while it
                // is still running.
                key={editsHint}
                className={`icon-btn fsbar__toggle${editsShown ? ' icon-btn--active' : ''}${
                  editsHint > 0 ? ' fsbar__toggle--hint' : ''
                }`}
                // Anchor for the `edits-hidden` and `first-style-change` hints.
                data-hint="edits"
                {...tip(
                  editsShown
                    ? 'Your markings and changes are shown — click for the original'
                    : 'Showing the original — click to bring your edits back',
                  { prefer: tipSide },
                )}
                aria-pressed={editsShown}
                onClick={onToggleEdits}
              >
                {editsShown ? <IconEye /> : <IconEyeOff />}
              </button>
            )}

            {onToggleFeedback && (
              <button
                // Deliberately without a `key`: this node has to stay stable,
                // see the effect above. The pulse is restarted by that, not by React.
                ref={feedbackBtnRef}
                className={`icon-btn fsbar__feedback${feedbackOpen ? ' icon-btn--active' : ''}${
                  feedbackPulse > 0 && !feedbackOpen ? ` ${PULSE_CLASS}` : ''
                }`}
                {...tip(feedbackOpen ? 'Hide feedback list' : 'Show feedback list', {
                  prefer: tipSide,
                })}
                aria-pressed={feedbackOpen}
                onClick={onToggleFeedback}
              >
                <IconMessage />
                {feedbackCount > 0 && <span className="fsbar__count">{feedbackCount}</span>}
              </button>
            )}

            {onExitFullscreen && (
              <>
                <span className="palette__sep" />
                <button
                  className="icon-btn fsbar__exit"
                  {...tip('Exit full window mode', { prefer: tipSide })}
                  onClick={onExitFullscreen}
                >
                  <IconCollapse />
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <button
              className={`icon-btn${tool === 'interact' ? ' icon-btn--active' : ''}`}
              {...tip('Interact — clicks go to the page', { keys: 'Esc', prefer: tipSide })}
              aria-pressed={tool === 'interact'}
              onClick={() => onTool('interact')}
            >
              <IconPointer />
            </button>

            <span className="palette__sep" />

            <ToolButtons
              order={order}
              tool={tool}
              onTool={onTool}
              tipSide={tipSide}
              placement={vertical ? 'right' : 'up'}
            />

            <span className="palette__sep" />

            <div className="fsbar__swatches">
              {colors.map((c) => (
                <button
                  key={c}
                  className={`swatch${color === c ? ' swatch--active' : ''}`}
                  {...tip('Colour', { prefer: tipSide })}
                  aria-pressed={color === c}
                  style={{ background: c }}
                  onClick={() => onColor(c)}
                />
              ))}
            </div>

            <span className="palette__sep" />

            <button
              className="icon-btn"
              {...tip('Undo last marking', { keys: 'Cmd/Ctrl+Z', prefer: tipSide })}
              onClick={onUndo}
              disabled={!canUndo}
            >
              <IconUndo />
            </button>
            <button
              className="icon-btn icon-btn--danger"
              {...tip('Delete all markings on this page', { prefer: tipSide })}
              onClick={onClear}
              disabled={!canUndo}
            >
              <IconTrash />
            </button>

            {onFullscreen && (
              <>
                <span className="palette__sep" />
                <button
                  className="icon-btn fsbar__fullscreen"
                  {...tip('Full window mode', { prefer: tipSide })}
                  onClick={onFullscreen}
                >
                  <IconExpand />
                </button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
