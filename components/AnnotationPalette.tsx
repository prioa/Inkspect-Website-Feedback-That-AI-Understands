import {
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
import {
  IconArrow,
  IconCollapse,
  IconEllipse,
  IconExpand,
  IconGrip,
  IconHLine,
  IconInspect,
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
 * Werkzeuge, die direkt in der Leiste stehen. Element-Picker und Pin sind die
 * beiden Einstiege; alles zum Zeichnen liegt darunter in der „Draw"-Gruppe —
 * die Leiste bleibt so kurz und die Wahl ueberschaubar.
 */
const PRIMARY_TOOLS: readonly Tool[] = ['element', 'pin'];

/** Werkzeuge der Leiste in Primaerknoepfe und Zeichen-Gruppe aufteilen. */
function splitTools(order: readonly Tool[]): { primary: Tool[]; draw: Tool[] } {
  return {
    primary: order.filter((t) => PRIMARY_TOOLS.includes(t)),
    draw: order.filter((t) => !PRIMARY_TOOLS.includes(t)),
  };
}

/** Hover-Label der schwebenden Leiste; die Palette nutzt stattdessen `title`. */
interface HintApi {
  show: (e: ReactPointerEvent, label: string, key?: string) => void;
  hide: () => void;
}

/**
 * Werkzeugknoepfe beider Leisten: erst die Primaerwerkzeuge, dann ein
 * „Draw"-Knopf, der die uebrigen in einem Flyout buendelt. Der Knopf traegt
 * das Symbol des zuletzt benutzten Zeichen-Werkzeugs und ist aktiv, solange
 * eines davon gewaehlt ist.
 */
function ToolButtons({
  order,
  tool,
  onTool,
  hint,
  placement = 'down',
}: {
  order: readonly Tool[];
  tool: PaletteTool;
  onTool: (tool: PaletteTool) => void;
  hint?: HintApi;
  /** Wohin das Flyout aufklappt — die senkrechte Leiste braucht 'right'. */
  placement?: 'up' | 'down' | 'right';
}) {
  const { primary, draw } = splitTools(order);

  /**
   * Das Flyout oeffnet beim Ueberfahren und schliesst mit kurzem Nachlauf:
   * zwischen Knopf und Menue liegt eine Luecke, ohne Verzoegerung waere es
   * weg, bevor der Zeiger drueben ankommt.
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
   * Das Flyout wird aus der Leiste heraus geportalt: die schwebende Leiste
   * scrollt bei wenig Platz (`overflow: auto`) und wuerde ein absolut
   * positioniertes Kind schlicht abschneiden. Es haengt deshalb frei im
   * Shell-Root und wird von Hand neben den Knopf gerechnet.
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
      // Kein Platz auf der Wunschseite? Auf die andere klappen.
      if (top < 8) top = b.bottom + gap;
      else if (top + h > window.innerHeight - 8) top = b.top - gap - h;
    }
    setAt({
      left: Math.max(8, Math.min(left, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - h - 8)),
    });
  }, [open, placement, draw.length]);

  // Das zuletzt gewaehlte Zeichen-Werkzeug bleibt das Gesicht der Gruppe.
  const faceRef = useRef<Tool>(draw[0] ?? 'pen');
  if (draw.includes(tool as Tool)) faceRef.current = tool as Tool;
  const face = draw.includes(faceRef.current) ? faceRef.current : (draw[0] ?? 'pen');
  const drawActive = draw.includes(tool as Tool);

  /** Ziffern-Kuerzel folgen weiterhin der vollen Reihenfolge. */
  const keyOf = (t: Tool) => String(order.indexOf(t) + 1);

  const toolButton = (id: Tool) => (
    <button
      key={id}
      className={`icon-btn${tool === id ? ' icon-btn--active' : ''}`}
      // Anker fuer die Onboarding-Tour — die zeigt gezielt auf einzelne
      // Werkzeuge, ohne sich auf die Reihenfolge verlassen zu muessen.
      data-tool={id}
      {...(hint
        ? {
            'aria-label': TOOL_LABELS[id],
            onPointerEnter: (e: ReactPointerEvent) => hint.show(e, TOOL_LABELS[id], keyOf(id)),
            onPointerLeave: hint.hide,
          }
        : { title: `${TOOL_LABELS[id]} (${keyOf(id)})` })}
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
            {...(hint
              ? {
                  'aria-label': `Draw — ${TOOL_LABELS[face]}`,
                  onPointerEnter: (e: ReactPointerEvent) => hint.show(e, 'Draw', keyOf(face)),
                  onPointerLeave: hint.hide,
                }
              : { title: `Draw — hover for freehand, shapes, arrows, guides & text` })}
            // Klick nimmt direkt das zuletzt benutzte Zeichen-Werkzeug; die
            // Auswahl der uebrigen laeuft ueber das Hover-Flyout.
            onClick={() => {
              setOpen(false);
              onTool(face);
            }}
            // Tastaturbedienung: das Flyout haengt sonst am Zeiger.
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
                // Vor der Messung aus dem Bild halten statt sichtbar springen.
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

        <ToolButtons order={order} tool={tool} onTool={onTool} />

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
  /** Zusatzzeilen (Bullets) — z. B. was der Bereichs-Toggle umschaltet. */
  rows?: string[];
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
  phoneVisible = false,
  onTogglePhone,
  onFullscreen,
  onExit,
  onPlace,
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
  /** Smartphone-Mockup sichtbar? Nur im Feedback-Vollbild angeboten. */
  phoneVisible?: boolean;
  /** Blendet das Smartphone-Mockup ein/aus. */
  onTogglePhone?: () => void;
  /** Ins Vollbild wechseln — nur in der Device-Ansicht angeboten. */
  onFullscreen?: () => void;
  /** Letzter Knopf: zurueck aus dem Vollbild. Fehlt er (Device-Ansicht),
   *  entfaellt der Knopf — dort wohnt das Umschalten in der Grid-Toolbar. */
  onExit?: () => void;
  /** Neue Platzierung nach dem Verschieben. */
  onPlace: (placement: ToolbarPlacement) => void;
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
  const showHint = (e: ReactPointerEvent, label: string, key?: string, rows?: string[]) => {
    if (drag) return;
    const r = e.currentTarget.getBoundingClientRect();
    setHint(
      vertical
        ? { label, key, rows, x: r.right + 10, y: r.top + r.height / 2 }
        : { label, key, rows, x: r.left + r.width / 2, y: r.top - 10 },
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

        <ToolButtons
          order={order}
          tool={tool}
          onTool={onTool}
          hint={{ show: showHint, hide: hideHint }}
          placement={vertical ? 'right' : 'up'}
        />

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

        {(onTogglePhone || onFullscreen || onExit) && <span className="palette__sep" />}

        {onFullscreen && (
          <button
            className="icon-btn fsbar__fullscreen"
            aria-label="Full window mode"
            onPointerEnter={(e) => showHint(e, 'Full window')}
            onPointerLeave={hideHint}
            onClick={onFullscreen}
          >
            <IconExpand />
          </button>
        )}

        {onTogglePhone && (
          <button
            className={`icon-btn fsbar__phone${phoneVisible ? ' icon-btn--active' : ''}`}
            aria-label="Mobile preview"
            aria-pressed={phoneVisible}
            onPointerEnter={(e) => showHint(e, 'Mobile preview')}
            onPointerLeave={hideHint}
            onClick={onTogglePhone}
          >
            <IconPhone />
          </button>
        )}

        {onExit && (
          <button
            className="icon-btn"
            aria-label="Exit full window mode"
            onPointerEnter={(e) => showHint(e, 'Exit full window')}
            onPointerLeave={hideHint}
            onClick={onExit}
          >
            <IconCollapse />
          </button>
        )}
      </div>

      {hint && (
        <div
          className={`fsbar__hint fsbar__hint--${vertical ? 'side' : 'above'}${
            hint.rows ? ' fsbar__hint--rows' : ''
          }`}
          style={{ left: hint.x, top: hint.y }}
        >
          {hint.label}
          {hint.key && <kbd className="kbd">{hint.key}</kbd>}
          {hint.rows && (
            <ul className="fsbar__hint-rows">
              {hint.rows.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
