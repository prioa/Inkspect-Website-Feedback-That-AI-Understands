import { useLayoutEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { PaletteTool, Tool } from '@/lib/annotations';
import { TOOL_LABELS } from '@/lib/annotations';
import type { ToolbarDock, ToolbarPlacement } from '@/lib/settings';
import {
  IconArrow,
  IconCollapse,
  IconEllipse,
  IconGrip,
  IconHLine,
  IconInspect,
  IconPen,
  IconPin,
  IconPointer,
  IconRect,
  IconText,
  IconTrash,
  IconUndo,
  IconVLine,
} from './icons';

interface Props {
  /** Wunschposition (Mausposition des Rechtsklicks, Shell-Koordinaten). */
  at: { x: number; y: number };
  tool: PaletteTool;
  color: string;
  /** Angebotene Farben — Anzahl kommt aus den Einstellungen. */
  colors: readonly string[];
  /** Reihenfolge der Werkzeuge (in der Leiste per Drag&Drop sortiert). */
  order: readonly Tool[];
  canUndo: boolean;
  onTool: (tool: PaletteTool) => void;
  onColor: (color: string) => void;
  onUndo: () => void;
  onClear: () => void;
  /** Klick auf den Backdrop oder Escape schliesst die Palette. */
  onDismiss: () => void;
  /** Erneuter Rechtsklick (auf dem Backdrop) verschiebt sie dorthin. */
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
 * Werkzeug-Palette als Kontextmenue: Rechtsklick oeffnet sie neben der Maus,
 * Werkzeugwahl schliesst sie wieder. Farbe/Undo halten sie offen, damit man
 * nicht fuer jede Einstellung neu rechtsklicken muss. Der Cursor ganz links
 * laesst die Previews normal bedienen; mit jedem anderen Werkzeug wird auf
 * dem Frame gezeichnet, ueber dem die Maus gerade steht.
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
  // Neben der Maus positionieren, aber nie aus dem Fenster ragen: nach dem
  // ersten Layout messen und vor dem Paint einklemmen.
  const ref = useRef<HTMLDivElement | null>(null);
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
          title="Interact — clicks & inputs go to the page (Esc)"
          aria-pressed={tool === 'interact'}
          onClick={() => onTool('interact')}
        >
          <IconPointer />
        </button>

        <span className="palette__sep" />

        {order.map((id, i) => (
          <button
            key={id}
            className={`icon-btn${tool === id ? ' icon-btn--active' : ''}`}
            title={`${TOOL_LABELS[id]} (${i + 1})`}
            aria-pressed={tool === id}
            onClick={() => onTool(id)}
          >
            {TOOL_ICONS[id]()}
          </button>
        ))}

        <span className="palette__sep" />

        {colors.map((c) => (
          <button
            key={c}
            className={`swatch${color === c ? ' swatch--active' : ''}`}
            style={{ background: c }}
            title="Color"
            aria-pressed={color === c}
            onClick={() => onColor(c)}
          />
        ))}

        <span className="palette__sep" />

        <button
          className="icon-btn"
          title="Undo last marking (Cmd/Ctrl+Z)"
          onClick={onUndo}
          disabled={!canUndo}
        >
          <IconUndo />
        </button>
        <button
          className="icon-btn icon-btn--danger"
          title="Delete all markings on this page"
          onClick={onClear}
          disabled={!canUndo}
        >
          <IconTrash />
        </button>
      </div>
    </>
  );
}

/** Position des Hover-Labels neben der Leiste (Fenster-Koordinaten). */
interface Hint {
  label: string;
  /** Kuerzel, falls die Aktion eins hat. */
  key?: string;
  x: number;
  y: number;
}

/** Abstand zur Kante, ab dem die Leiste dort einrastet (Fenster-Pixel). */
const SNAP_ZONE = 90;

/**
 * Rastet die Leiste an dieser Zeigerposition ein? Nur zwei Punkte: linke
 * Kante und unterer Rand — sonst bleibt sie frei stehen, wo sie losgelassen
 * wurde.
 */
function snapAt(x: number, y: number): ToolbarDock {
  const toLeft = x;
  const toBottom = window.innerHeight - y;
  if (toLeft > SNAP_ZONE && toBottom > SNAP_ZONE) return 'free';
  return toLeft <= toBottom ? 'left' : 'bottom';
}

/**
 * Schwebende Werkzeugleiste. Im Vollbild haengt sie frei im Fenster und
 * laesst sich am Griff ueberall hinziehen; nahe der linken Kante oder des
 * unteren Rands rastet sie in die Photoshop-Toolbox- bzw. Leisten-Form ein.
 * Angedockt (Grid-Modus) sitzt sie fest unten. Beim Ueberfahren eines Knopfs
 * steht sein Name daneben ueber der Seite.
 */
export function FeedbackBar({
  tool,
  color,
  colors,
  order,
  placement,
  movable = true,
  canUndo,
  onTool,
  onColor,
  onUndo,
  onClear,
  onExit,
  onPlace,
  exitIcon,
  exitTitle = 'Exit full window mode',
}: {
  tool: PaletteTool;
  color: string;
  colors: readonly string[];
  order: readonly Tool[];
  /** Aktuelle Platzierung (Kante oder freie Position). */
  placement: ToolbarPlacement;
  /** Verschiebbar? Im Grid-Modus sitzt die Leiste fest unten. */
  movable?: boolean;
  canUndo: boolean;
  onTool: (tool: PaletteTool) => void;
  onColor: (color: string) => void;
  onUndo: () => void;
  onClear: () => void;
  /** Letzter Knopf: Vollbild verlassen bzw. — angedockt — die Leiste schliessen. */
  onExit: () => void;
  /** Neue Platzierung nach dem Verschieben. */
  onPlace: (placement: ToolbarPlacement) => void;
  /** Icon des letzten Knopfs (Default: Vollbild-Collapse). */
  exitIcon?: JSX.Element;
  exitTitle?: string;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  /** Laufender Zug: Position der Leiste und die Kante, in die sie faellt. */
  const [drag, setDrag] = useState<{ x: number; y: number; snap: ToolbarDock } | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);

  /**
   * Leiste am Griff verschieben; beim Loslassen rastet sie ggf. ein.
   *
   * Der Zug laeuft ueber Pointer-Capture auf dem Griff *und* einen
   * Klick-Schild ueber dem ganzen Fenster: ohne beides verschluckt der
   * iframe der Seite die Bewegungen, sobald der Cursor ueber ihr steht —
   * die Leiste bliebe dann am Rand haengen.
   */
  const startBarDrag = (e: ReactPointerEvent) => {
    if (!movable || e.button !== 0) return;
    e.preventDefault();
    setHint(null);
    // Versatz zwischen Zeiger und Leisten-Ecke festhalten — sonst springt sie
    // beim Anfassen unter den Cursor.
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
        /* Capture schon weg */
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
        // Frei stehend im Fenster halten, auch wenn zu weit gezogen wurde.
        x: Math.max(8, Math.min(end.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(end.y, window.innerHeight - rect.height - 8)),
      });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancel);
    setDrag({ x: rect.left, y: rect.top, snap: placement.dock });
  };

  /** Label neben dem gerade ueberfahrenen Knopf einblenden. */
  const showHint = (e: ReactPointerEvent, label: string, key?: string) => {
    if (drag) return;
    const r = e.currentTarget.getBoundingClientRect();
    setHint(
      vertical
        ? { label, key, x: r.right + 10, y: r.top + r.height / 2 }
        : { label, key, x: r.left + r.width / 2, y: r.top - 10 },
    );
  };
  const hideHint = () => setHint(null);

  // Waehrend des Zugs zeigt die Leiste schon die Form, in der sie landet.
  const dock = drag ? drag.snap : placement.dock;
  const vertical = dock === 'left';
  const style =
    dock === 'free' || drag
      ? { left: drag ? drag.x : placement.x, top: drag ? drag.y : placement.y }
      : undefined;

  return (
    <>
      {/* Snap-Punkte nur waehrend des Zugs — links und unten. Der Schild
          davor haelt die Seite im iframe aus dem Zug heraus. */}
      {drag && (
        <>
          <div className="fsbar-shield" />
          <div className={`fsbar-snap fsbar-snap--left${drag.snap === 'left' ? ' fsbar-snap--on' : ''}`} />
          <div
            className={`fsbar-snap fsbar-snap--bottom${drag.snap === 'bottom' ? ' fsbar-snap--on' : ''}`}
          />
        </>
      )}

      <div
        ref={barRef}
        className={`palette fsbar fsbar--${dock}${drag ? ' fsbar--dragging' : ''}`}
        style={style}
        role="toolbar"
        aria-label="Feedback tools"
      >
        {movable && (
          <span
            className="fsbar__grip"
            title="Drag to move — snaps to the left or bottom edge"
            onPointerDown={startBarDrag}
          >
            <IconGrip />
          </span>
        )}

        <button
          className={`icon-btn${tool === 'interact' ? ' icon-btn--active' : ''}`}
          aria-label="Interact — clicks & inputs go to the page"
          aria-pressed={tool === 'interact'}
          onPointerEnter={(e) => showHint(e, 'Interact', 'Esc')}
          onPointerLeave={hideHint}
          onClick={() => onTool('interact')}
        >
          <IconPointer />
        </button>

        <span className="palette__sep" />

        {order.map((id, i) => (
          <button
            key={id}
            className={`icon-btn${tool === id ? ' icon-btn--active' : ''}`}
            aria-label={TOOL_LABELS[id]}
            aria-pressed={tool === id}
            onPointerEnter={(e) => showHint(e, TOOL_LABELS[id], String(i + 1))}
            onPointerLeave={hideHint}
            onClick={() => onTool(id)}
          >
            {TOOL_ICONS[id]()}
          </button>
        ))}

        <span className="palette__sep" />

        <div className="fsbar__swatches">
          {colors.map((c) => (
            <button
              key={c}
              className={`swatch${color === c ? ' swatch--active' : ''}`}
              aria-label="Color"
              aria-pressed={color === c}
              onPointerEnter={(e) => showHint(e, 'Colour')}
              onPointerLeave={hideHint}
              style={{ background: c }}
              onClick={() => onColor(c)}
            />
          ))}
        </div>

        <span className="palette__sep" />

        <button
          className="icon-btn"
          aria-label="Undo last marking"
          onPointerEnter={(e) => showHint(e, 'Undo', 'Cmd/Ctrl+Z')}
          onPointerLeave={hideHint}
          onClick={onUndo}
          disabled={!canUndo}
        >
          <IconUndo />
        </button>
        <button
          className="icon-btn icon-btn--danger"
          aria-label="Delete all markings on this page"
          onPointerEnter={(e) => showHint(e, 'Delete all markings')}
          onPointerLeave={hideHint}
          onClick={onClear}
          disabled={!canUndo}
        >
          <IconTrash />
        </button>

        <span className="palette__sep" />

        <button
          className="icon-btn"
          aria-label={exitTitle}
          onPointerEnter={(e) => showHint(e, exitTitle)}
          onPointerLeave={hideHint}
          onClick={onExit}
        >
          {exitIcon ?? <IconCollapse />}
        </button>
      </div>

      {hint && (
        <div
          className={`fsbar__hint fsbar__hint--${vertical ? 'side' : 'above'}`}
          style={{ left: hint.x, top: hint.y }}
        >
          {hint.label}
          {hint.key && <kbd className="kbd">{hint.key}</kbd>}
        </div>
      )}
    </>
  );
}
