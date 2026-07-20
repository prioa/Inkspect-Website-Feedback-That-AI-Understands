import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { BoxShape, ElementRef, Point, Shape, Tool } from '@/lib/annotations';
import {
  LINE_REACH,
  elementLabel,
  hitsShape,
  isMovableShape,
  lineGap,
  pinNumbers,
  shapeBounds,
  shapeId,
  translateShape,
} from '@/lib/annotations';
import { shadowPath } from '@/lib/selector';

interface Props {
  /** Logische Viewport-Groesse des Frames (unskaliert). */
  width: number;
  height: number;
  zoom: number;
  /** Nur im Korrekturmodus faengt das Overlay Pointer-Events ab. */
  active: boolean;
  shapes: Shape[];
  /** Shape-Ids erledigter Eintraege — gedimmt gerendert, ohne Notiz-Bubble. */
  dimmedIds?: Set<string>;
  /**
   * Shape-Ids fremder (importierter) Markierungen — die lassen sich nicht
   * verschieben, nur eigene.
   */
  lockedIds?: Set<string>;
  tool: Tool;
  color: string;
  frameEl: HTMLIFrameElement | null;
  /** Zaehlt Frame-Loads hoch — der Scroll-Listener muss dann neu haengen. */
  loadCount: number;
  /**
   * Notizen als Sprechblasen direkt im Overlay rendern — an waehrend des
   * Screenshot-Exports, damit der Text am richtigen Punkt im Bild steht.
   * Unabhaengig davon erscheint die Notiz beim Hover ueber dem Marker.
   */
  showNotes?: boolean;
  /** Marker, der gerade per Panel-Klick angeflogen wurde — pulsiert kurz. */
  flashShapeId?: string | null;
  /** Aendert sich pro Flash — startet die CSS-Animation neu. */
  flashNonce?: number;
  /** Marker, dessen Panel-Eintrag gerade gehovert wird — ruhig hervorheben. */
  hoverShapeId?: string | null;
  /** Doppelklick auf einen Marker (App): Notiz-Editor mit dem Text oeffnen. */
  editRequest?: NoteEditRequest | null;
  onAdd: (shape: Shape) => void;
  onSetNote: (shapeId: string, note: string) => void;
  /** Verschobene Markierung uebernehmen (Dokumentraum-Versatz). */
  onMoveShape?: (shapeId: string, dx: number, dy: number) => void;
  /** Neue Eckpunkte einer in der Groesse geaenderten Box uebernehmen. */
  onResizeShape?: (
    shapeId: string,
    box: { x1: number; y1: number; x2: number; y2: number },
  ) => void;
  /**
   * Abstand eines Linienpaars setzen (null = einzelne Linie). Laeuft nur in
   * den UI-State; gespeichert wird ueber `onCommitShape`, wenn das Feld den
   * Fokus verliert — sonst schriebe jeder Tastendruck in den Store.
   */
  onSetLineGap?: (shapeId: string, gap: number | null) => void;
  /** Aktuellen Stand einer Markierung speichern. */
  onCommitShape?: (shapeId: string) => void;
}

/** Von der App gemeldeter Editier-Wunsch (Doppelklick im Frame). */
export interface NoteEditRequest {
  shapeId: string;
  /** Klickpunkt in Dokument-Koordinaten — dort erscheint der Editor. */
  x: number;
  y: number;
  /** Zaehlt pro Doppelklick hoch — oeffnet den Editor auch erneut. */
  nonce: number;
}

interface TextDraft {
  x: number;
  y: number;
  value: string;
}

/** Offener Notiz-Editor zum zuletzt gesetzten oder doppelt geklickten Marker. */
interface NoteDraft {
  shapeId: string;
  /** Ankerpunkt in Dokument-Koordinaten. */
  x: number;
  y: number;
  value: string;
  /**
   * Text beim Oeffnen (Editier-Session per Doppelklick). Gesetzt darf der
   * Commit auch leeren; beim Anlegen bleibt "leer" schlicht "keine Notiz".
   */
  initial?: string;
}

interface BoxEdges {
  t: number;
  r: number;
  b: number;
  l: number;
}

/** Bounding-Box, Label, CSS-Pfad und Box-Model des Elements unterm Cursor (Dokumentraum). */
interface ElementTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  selector: string;
  margin: BoxEdges;
  padding: BoxEdges;
}

const MIN_DRAG = 3;
/** Toleranz um die Marker-Box fuer den Notiz-Hover (Dokument-Pixel). */
const HOVER_PAD = 8;

/**
 * Griffe an Rechteck/Ellipse. Das Kuerzel nennt die Kanten, die der Griff
 * zieht (`nw` = oben links, `e` = rechte Kante).
 */
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Fangradius eines Griffs in Bildschirm-Pixeln. */
const HANDLE_HIT = 9;

/** Cursor-Modifier des Overlays pro Griff. */
const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse',
  se: 'nwse',
  ne: 'nesw',
  sw: 'nesw',
  n: 'ns',
  s: 'ns',
  e: 'ew',
  w: 'ew',
};

/** Nur aufgezogene Boxen lassen sich in der Groesse aendern (Pfeil nicht). */
function isResizable(shape: Shape): shape is BoxShape & { tool: 'rect' | 'ellipse' } {
  return shape.tool === 'rect' || shape.tool === 'ellipse';
}

function handlePos(b: { x: number; y: number; w: number; h: number }, id: HandleId): Point {
  return {
    x: id.includes('w') ? b.x : id.includes('e') ? b.x + b.w : b.x + b.w / 2,
    y: id.startsWith('n') ? b.y : id.startsWith('s') ? b.y + b.h : b.y + b.h / 2,
  };
}

/** Griff unter dem Punkt (Dokumentraum) oder null. */
function handleAt(shape: Shape, p: Point, tol: number): HandleId | null {
  const b = shapeBounds(shape);
  if (!b) return null;
  return (
    HANDLE_IDS.find((id) => {
      const h = handlePos(b, id);
      return Math.abs(p.x - h.x) <= tol && Math.abs(p.y - h.y) <= tol;
    }) ?? null
  );
}

/** Neue Eckpunkte, wenn `handle` auf `p` gezogen wird. Ueberkreuzen ist erlaubt. */
function resizeBox(shape: BoxShape, handle: HandleId, p: Point) {
  const box = {
    x1: Math.min(shape.x1, shape.x2),
    y1: Math.min(shape.y1, shape.y2),
    x2: Math.max(shape.x1, shape.x2),
    y2: Math.max(shape.y1, shape.y2),
  };
  if (handle.includes('w')) box.x1 = p.x;
  if (handle.includes('e')) box.x2 = p.x;
  if (handle.startsWith('n')) box.y1 = p.y;
  if (handle.startsWith('s')) box.y2 = p.y;
  return box;
}

/**
 * Unsichtbare Trefferflaeche entlang der Kontur einer Markierung. Ausserhalb
 * des Korrekturmodus faengt das Overlay als Ganzes keine Events (sonst waere
 * die Seite nicht mehr bedienbar) — nur diese Konturen tun es, damit sich
 * Markierungen trotzdem greifen und skalieren lassen.
 */
function renderHitShape(shape: Shape, tol: number) {
  const hit = {
    className: 'anno__hit',
    fill: 'none',
    stroke: 'transparent',
    strokeWidth: tol * 2,
  };
  switch (shape.tool) {
    case 'element':
    case 'rect': {
      const b = shapeBounds(shape);
      return b ? <rect key={shape.id} x={b.x} y={b.y} width={b.w} height={b.h} {...hit} /> : null;
    }
    case 'ellipse': {
      const b = shapeBounds(shape);
      return b ? (
        <ellipse
          key={shape.id}
          cx={b.x + b.w / 2}
          cy={b.y + b.h / 2}
          rx={b.w / 2}
          ry={b.h / 2}
          {...hit}
        />
      ) : null;
    }
    case 'arrow':
      return (
        <path key={shape.id} d={`M${shape.x1},${shape.y1} L${shape.x2},${shape.y2}`} {...hit} />
      );
    case 'pen':
      return (
        <g key={shape.id}>
          {(shape.strokes ?? []).map((points, i) => (
            <polyline key={i} points={points.map((pt) => `${pt.x},${pt.y}`).join(' ')} {...hit} />
          ))}
        </g>
      );
    case 'pin':
    case 'text': {
      // Punktfoermig: die ganze Flaeche ist der Griff.
      const b = shapeBounds(shape);
      return b ? (
        <rect
          key={shape.id}
          className="anno__hit anno__hit--area"
          x={b.x - tol}
          y={b.y - tol}
          width={b.w + tol * 2}
          height={b.h + tol * 2}
          fill="transparent"
          stroke="none"
        />
      ) : null;
    }
    case 'hline':
    case 'vline': {
      const horizontal = shape.tool === 'hline';
      const lineAt = (v: number) =>
        horizontal
          ? `M${shape.x - LINE_REACH},${v} L${shape.x + LINE_REACH},${v}`
          : `M${v},${shape.y - LINE_REACH} L${v},${shape.y + LINE_REACH}`;
      const start = horizontal ? shape.y : shape.x;
      return (
        <g key={shape.id}>
          <path d={lineAt(start)} {...hit} />
          {shape.to != null && <path d={lineAt(shape.to)} {...hit} />}
        </g>
      );
    }
  }
}

/** Sichtbarer Frame-Ausschnitt in Dokument-Koordinaten. */
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Beschriftungen sitzen im Dokumentraum, sind aber Bildschirm-Elemente: am
 * Rand gezeichnete Labels laegen sonst ausserhalb des sichtbaren Ausschnitts.
 * Klemmt die linke obere Ecke einer Label-Box in `view` ein.
 */
function clampLabel(x: number, y: number, w: number, h: number, zoom: number, view?: View) {
  if (!view) return { x, y };
  const edge = 4 / zoom;
  return {
    x: Math.max(view.x + edge, Math.min(x, view.x + view.w - w - edge)),
    y: Math.max(view.y + edge, Math.min(y, view.y + view.h - h - edge)),
  };
}

/** elementFromPoint, das in offene Shadow Roots absteigt (Web Components). */
function deepElementFromPoint(doc: Document, x: number, y: number): Element | null {
  let el = doc.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

export function AnnotationOverlay({
  width,
  height,
  zoom,
  active,
  shapes,
  dimmedIds,
  lockedIds,
  tool,
  color,
  frameEl,
  loadCount,
  showNotes = false,
  flashShapeId = null,
  flashNonce = 0,
  hoverShapeId = null,
  editRequest = null,
  onAdd,
  onSetNote,
  onMoveShape,
  onResizeShape,
  onSetLineGap,
  onCommitShape,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [scroll, setScroll] = useState<Point>({ x: 0, y: 0 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [picked, setPicked] = useState<ElementTarget | null>(null);
  /**
   * Cursorposition (Dokumentraum) fuer die Linien-Vorschau: sobald das
   * Werkzeug gewaehlt ist, laeuft die Linie halbtransparent mit, der Klick
   * setzt sie dann genau dort ab.
   */
  const [lineGhost, setLineGhost] = useState<Point | null>(null);
  /**
   * Markierung, die gerade an der Maus haengt. Verschoben wird sie erst beim
   * Loslassen im Store — waehrend des Zugs zeigt das Overlay den Versatz.
   */
  /** Eigene Markierung unterm Cursor — Cursor wird zum Greifer, der Marker
   *  bekommt einen Greif-Rahmen. */
  const [grabId, setGrabId] = useState<string | null>(null);
  const [movingShape, setMovingShape] = useState<{
    id: string;
    dx: number;
    dy: number;
    from: Point;
  } | null>(null);
  /** Griff unterm Cursor (Markierung + Ecke) — zeigt den Resize-Cursor an. */
  const [hoverHandle, setHoverHandle] = useState<{ id: string; handle: HandleId } | null>(null);
  /**
   * Laufende Groessenaenderung. Wie beim Verschieben wandert waehrend des Zugs
   * nur der UI-State mit; gespeichert wird beim Loslassen.
   */
  const [resizing, setResizing] = useState<{
    id: string;
    handle: HandleId;
    box: { x1: number; y1: number; x2: number; y2: number };
  } | null>(null);

  const displayShapes = shapes;
  const dimmed = dimmedIds;

  /** Eigene Markierung — fremde (importierte) bleiben, wo der Ersteller sie setzte. */
  const mine = (s: Shape) => isMovableShape(s) && !lockedIds?.has(s.id);

  // Kein veralteter Hover-Rahmen, wenn Werkzeug/Modus wechseln.
  useEffect(() => {
    setPicked(null);
    setLineGhost(null);
  }, [tool, active]);

  // Ref-Spiegel der Drafts: Commit wird von pointerdown *und* blur aufgerufen —
  // ueber die Ref bleiben die Commits idempotent.
  const [textDraft, setTextDraftState] = useState<TextDraft | null>(null);
  const textDraftRef = useRef<TextDraft | null>(null);
  const setTextDraft = (value: TextDraft | null) => {
    textDraftRef.current = value;
    setTextDraftState(value);
  };

  /** Rahmen des Notiz-Editors — Fokuswechsel *innerhalb* schliessen ihn nicht. */
  const noteBoxRef = useRef<HTMLDivElement | null>(null);
  const [noteDraft, setNoteDraftState] = useState<NoteDraft | null>(null);
  const noteDraftRef = useRef<NoteDraft | null>(null);
  const setNoteDraft = (value: NoteDraft | null) => {
    noteDraftRef.current = value;
    setNoteDraftState(value);
  };

  // Der Cursor gehoert ins Notizfeld, sobald der Editor aufgeht. `autoFocus`
  // allein reicht nicht: der Pointer-Up des Aufziehens landet danach und holt
  // den Fokus zurueck ins Overlay — deshalb explizit nach dem Layout setzen.
  const noteFieldRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!noteDraft) return;
    const id = requestAnimationFrame(() => {
      const field = noteFieldRef.current;
      if (!field) return;
      field.focus();
      // Bestehenden Text nicht ueberschreiben, sondern anhaengen lassen.
      field.setSelectionRange(field.value.length, field.value.length);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteDraft?.shapeId]);

  // Doppelklick auf einen Marker (von der App gemeldet, weil die Events im
  // Interaktionsmodus im Frame landen): Notiz-Editor mit dem vorhandenen
  // Text am Klickpunkt oeffnen.
  useEffect(() => {
    if (!editRequest) return;
    const shape = shapes.find((s) => s.id === editRequest.shapeId);
    if (!shape) return;
    const value = editableTextOf(shape);
    setNoteDraft({
      shapeId: shape.id,
      x: editRequest.x,
      y: editRequest.y,
      value,
      initial: value,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest?.nonce]);

  // Notiz eines Markers beim Ueberfahren einblenden. Getroffen wird per
  // Bounding-Box-Mathe statt per Hit-Element im SVG — so schluckt das Overlay
  // im Interaktionsmodus keine Klicks, die zur Seite gehoeren. Die Blase
  // haengt an der Mausposition (Dokumentraum) und laeuft mit.
  const [hoverNote, setHoverNote] = useState<{ id: string; x: number; y: number } | null>(null);
  const notedShapes = displayShapes.filter((s) => !dimmed?.has(s.id) && noteOf(s) != null);
  const notedRef = useRef(notedShapes);
  notedRef.current = notedShapes;

  const updateHover = (x: number, y: number) => {
    const id = hitNote(x, y);
    setHoverNote(id ? { id, x, y } : null);
  };

  const hitNote = (x: number, y: number): string | null => {
    for (const s of notedRef.current) {
      const b = shapeBounds(s);
      if (
        b &&
        x >= b.x - HOVER_PAD &&
        x <= b.x + b.w + HOVER_PAD &&
        y >= b.y - HOVER_PAD &&
        y <= b.y + b.h + HOVER_PAD
      ) {
        return s.id;
      }
    }
    return null;
  };

  // Im Interaktionsmodus laufen die Mausbewegungen im Frame selbst — dort
  // lauschen und in Dokument-Koordinaten (pageX/pageY) hit-testen.
  useEffect(() => {
    const win = frameEl?.contentWindow;
    if (!win) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      const { pageX, pageY } = e;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => updateHover(pageX, pageY));
    };
    const onOut = (e: MouseEvent) => {
      if (e.relatedTarget == null) setHoverNote(null);
    };

    try {
      win.addEventListener('mousemove', onMove, { passive: true });
      win.document.addEventListener('mouseout', onOut, true);
    } catch {
      return; // Frame nicht lesbar
    }

    return () => {
      cancelAnimationFrame(raf);
      try {
        win.removeEventListener('mousemove', onMove);
        win.document.removeEventListener('mouseout', onOut, true);
      } catch {
        /* Frame schon weg */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameEl, loadCount]);

  // Scroll-Position des Frames verfolgen, damit die Markierungen am Inhalt
  // kleben bleiben. try/catch: der Frame kann blockiert (cross-origin) sein.
  useEffect(() => {
    const win = frameEl?.contentWindow;
    if (!win) return;

    let raf = 0;
    const read = () => {
      try {
        const el = win.document.scrollingElement;
        setScroll({ x: el?.scrollLeft ?? 0, y: el?.scrollTop ?? 0 });
      } catch {
        /* Frame nicht lesbar */
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };

    try {
      win.addEventListener('scroll', onScroll, { passive: true });
    } catch {
      return;
    }
    read();

    return () => {
      cancelAnimationFrame(raf);
      try {
        win.removeEventListener('scroll', onScroll);
      } catch {
        /* Frame schon weg */
      }
    };
  }, [frameEl, loadCount]);

  // Im Zeichenmodus liegt das Overlay ueber dem Frame und wuerde Wheel-Events
  // schlucken — zum Scrollen an den Frame weiterreichen. Nativer Listener mit
  // passive:false, weil Reacts onWheel passiv am Root haengt und preventDefault
  // (gegen das Mitscrollen des Grids dahinter) dort wirkungslos waere.
  useEffect(() => {
    const svg = svgRef.current;
    if (!active || !svg) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      try {
        frameEl?.contentWindow?.scrollBy(e.deltaX * factor, e.deltaY * factor);
      } catch {
        /* Frame nicht lesbar */
      }
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [active, frameEl]);

  if (!active && shapes.length === 0) return null;

  /**
   * Doppelklick ausserhalb des Korrekturmodus: Notiz-Editor oeffnen.
   *
   * Die App lauscht dafuer zusaetzlich im Frame-Dokument, doch die
   * Trefferflaechen (`.anno__hit--area`) liegen ueber dem iframe und
   * verschlucken den Doppelklick, bevor er dort ankommt — genau wie beim
   * Wheel-Weiterreichen daneben. Wer den Marker trifft, wird deshalb hier
   * bedient; alles andere laeuft unveraendert an die Seite durch.
   */
  const handleDoubleClick = (e: ReactMouseEvent) => {
    if (active) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom + scroll.x;
    const y = (e.clientY - rect.top) / zoom + scroll.y;
    // Hinterste zuerst — die liegen im Overlay obenauf.
    for (let i = displayShapes.length - 1; i >= 0; i--) {
      const shape = displayShapes[i];
      if (!shape || dimmed?.has(shape.id)) continue;
      const b = shapeBounds(shape);
      if (
        b &&
        x >= b.x - HOVER_PAD &&
        x <= b.x + b.w + HOVER_PAD &&
        y >= b.y - HOVER_PAD &&
        y <= b.y + b.h + HOVER_PAD
      ) {
        e.preventDefault();
        const value = editableTextOf(shape);
        setNoteDraft({ shapeId: shape.id, x, y, value, initial: value });
        return;
      }
    }
  };

  const toDoc = (e: ReactPointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom + scroll.x,
      y: (e.clientY - rect.top) / zoom + scroll.y,
    };
  };

  /** Element unter dem Cursor im Frame-Dokument bestimmen. */
  const pickAt = (e: ReactPointerEvent): ElementTarget | null => {
    const rect = svgRef.current!.getBoundingClientRect();
    const win = frameEl?.contentWindow;
    if (!win) return null;
    try {
      const el = deepElementFromPoint(
        win.document,
        (e.clientX - rect.left) / zoom,
        (e.clientY - rect.top) / zoom,
      );
      if (!el || el.tagName === 'HTML') return null;
      const r = el.getBoundingClientRect();
      const cs = win.getComputedStyle(el);
      const nv = (v: string) => Number.parseFloat(v) || 0;
      return {
        x: r.left + win.scrollX,
        y: r.top + win.scrollY,
        w: r.width,
        h: r.height,
        label: elementLabel(el),
        selector: shadowPath(el).join(' >>> '),
        margin: { t: nv(cs.marginTop), r: nv(cs.marginRight), b: nv(cs.marginBottom), l: nv(cs.marginLeft) },
        padding: { t: nv(cs.paddingTop), r: nv(cs.paddingRight), b: nv(cs.paddingBottom), l: nv(cs.paddingLeft) },
      };
    } catch {
      return null; // Frame nicht lesbar
    }
  };

  /**
   * DOM-Bezug fuer eine Markierung an Dokument-Koordinaten — macht Exporte
   * (Text-Export) im Quellcode verortbar.
   */
  const anchorAt = (x: number, y: number): ElementRef => {
    const win = frameEl?.contentWindow;
    if (!win) return {};
    try {
      const el = deepElementFromPoint(win.document, x - win.scrollX, y - win.scrollY);
      if (!el || el.tagName === 'HTML') return {};
      const r = el.getBoundingClientRect();
      return {
        anchor: shadowPath(el).join(' >>> '),
        anchorLabel: elementLabel(el),
        // Ur-Position fuer die Reposition nach Layout-Aenderungen (Reload).
        anchorX: r.left + win.scrollX,
        anchorY: r.top + win.scrollY,
      };
    } catch {
      return {}; // Frame nicht lesbar
    }
  };

  const commitText = () => {
    const current = textDraftRef.current;
    if (!current) return;
    setTextDraft(null);
    const value = current.value.trim();
    if (value) {
      onAdd({
        id: shapeId(),
        tool: 'text',
        color,
        x: current.x,
        y: current.y,
        text: value,
        ...anchorAt(current.x, current.y),
      });
    }
  };

  const commitNote = () => {
    const current = noteDraftRef.current;
    if (!current) return;
    setNoteDraft(null);
    const value = current.value.trim();
    // Nur echte Aenderungen speichern — beim Bearbeiten (initial gesetzt)
    // darf der Text auch geleert werden, beim Anlegen ist leer = keine Notiz.
    if (value !== (current.initial ?? '')) onSetNote(current.shapeId, value);
  };

  const handleDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;

    // Verhindert die Default-Fokusaenderung des nachfolgenden mousedown —
    // die wuerde das frisch geoeffnete Notiz-Feld sofort wieder blurren
    // (und damit schliessen), bevor es sichtbar wird.
    e.preventDefault();

    // Offene Editoren zuerst bestaetigen (Notiz ist optional — leer = ohne).
    commitText();
    commitNote();

    const p = toDoc(e);

    // Griff einer eigenen Box angefasst? Dann Groesse aendern — vor dem
    // Verschieben geprueft, denn die Griffe sitzen auf der Kontur.
    if (onResizeShape) {
      const grabbedHandle = [...displayShapes]
        .reverse()
        .map((s) => ({ shape: s, handle: mine(s) ? handleAt(s, p, HANDLE_HIT / zoom) : null }))
        .find((hit) => isResizable(hit.shape) && hit.handle != null);
      if (grabbedHandle?.handle && isResizable(grabbedHandle.shape)) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setResizing({
          id: grabbedHandle.shape.id,
          handle: grabbedHandle.handle,
          box: resizeBox(grabbedHandle.shape, grabbedHandle.handle, p),
        });
        setHoverNote(null);
        return;
      }
    }

    // Kontur einer eigenen Markierung angefasst? Dann wird verschoben statt
    // gezeichnet — hinterste zuerst, die liegen im Overlay obenauf.
    if (onMoveShape) {
      const grabbed = [...displayShapes]
        .reverse()
        .find((s) => isMovableShape(s) && !lockedIds?.has(s.id) && hitsShape(s, p, 8 / zoom));
      if (grabbed) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setMovingShape({ id: grabbed.id, dx: 0, dy: 0, from: p });
        setHoverNote(null);
        return;
      }
    }

    // Ab hier wird gezeichnet — das gibt es nur im Korrekturmodus. Der Klick
    // gehoert sonst der Seite (das Overlay faengt ihn dort gar nicht erst ab).
    if (!active) return;

    if (tool === 'element') {
      // Uebernimmt das gerade gehighlightete Element als Markierung.
      const target = pickAt(e);
      if (!target) return;
      const id = shapeId();
      const { x, y, w, h, label, selector } = target;
      onAdd({ id, tool: 'element', color, x, y, w, h, label, selector });
      setPicked(null);
      setNoteDraft({ shapeId: id, x: p.x, y: p.y, value: '' });
      return;
    }

    if (tool === 'text') {
      setTextDraft({ x: p.x, y: p.y, value: '' });
      return;
    }

    if (tool === 'pin') {
      // Pin sofort speichern, dann Freitext (optional) dazu erfassen.
      const id = shapeId();
      onAdd({ id, tool: 'pin', color, x: p.x, y: p.y, text: '', ...anchorAt(p.x, p.y) });
      setNoteDraft({ shapeId: id, x: p.x, y: p.y, value: '' });
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pen') {
      setDraft({ id: shapeId(), tool: 'pen', color, strokes: [[p]] });
    } else if (tool === 'hline' || tool === 'vline') {
      // Hilfslinie: beim Druecken schon sichtbar, Ziehen schiebt sie noch.
      setDraft({ id: shapeId(), tool, color, x: p.x, y: p.y });
    } else {
      setDraft({ id: shapeId(), tool, color, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
  };

  const handleMove = (e: ReactPointerEvent) => {
    if (resizing) {
      const p = toDoc(e);
      const shape = displayShapes.find((s) => s.id === resizing.id);
      if (shape && isResizable(shape)) {
        setResizing({ ...resizing, box: resizeBox(shape, resizing.handle, p) });
      }
      return;
    }
    if (movingShape) {
      const p = toDoc(e);
      setMovingShape({ ...movingShape, dx: p.x - movingShape.from.x, dy: p.y - movingShape.from.y });
      return;
    }
    // Auch im Zeichenmodus: Notiz beim Ueberfahren eines Markers zeigen.
    if (!draft) {
      const p = toDoc(e);
      updateHover(p.x, p.y);
      // Hinterste zuerst — die liegen im Overlay obenauf, wie beim Anfassen.
      const grabbed =
        onMoveShape
          ? [...displayShapes].reverse().find((s) => mine(s) && hitsShape(s, p, 8 / zoom))
          : undefined;
      setGrabId(grabbed?.id ?? null);
      // Griff schlaegt Kontur: sitzt der Cursor auf einer Ecke/Kante, meint
      // der Zug die Groesse, nicht die Position.
      const overHandle =
        onResizeShape
          ? [...displayShapes]
              .reverse()
              .filter((s) => isResizable(s) && mine(s))
              .map((s) => ({ id: s.id, handle: handleAt(s, p, HANDLE_HIT / zoom) }))
              .find((hit) => hit.handle != null)
          : null;
      setHoverHandle(
        overHandle?.handle ? { id: overHandle.id, handle: overHandle.handle } : null,
      );
    }
    // Linien-Werkzeuge: Vorschau der Linie unterm Cursor.
    if (active && (tool === 'hline' || tool === 'vline') && !draft) {
      setLineGhost(toDoc(e));
    }
    // Element-Picker: Live-Highlight des Elements unterm Cursor.
    if (active && tool === 'element' && !draft) {
      setPicked(pickAt(e));
      return;
    }
    if (!draft) return;
    const p = toDoc(e);
    if (draft.tool === 'pen') {
      const stroke = draft.strokes[draft.strokes.length - 1] ?? [];
      const last = stroke[stroke.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2 / zoom) return;
      setDraft({ ...draft, strokes: [...draft.strokes.slice(0, -1), [...stroke, p]] });
    } else if (draft.tool === 'rect' || draft.tool === 'ellipse' || draft.tool === 'arrow') {
      setDraft({ ...draft, x2: p.x, y2: p.y });
    } else if (draft.tool === 'hline' || draft.tool === 'vline') {
      // Erste Linie bleibt am Startpunkt; das Ziehen spannt die zweite auf
      // und misst damit den Abstand. Unterhalb der Mindeststrecke bleibt es
      // eine einzelne Linie, die dem Cursor folgt.
      const axis = draft.tool === 'hline' ? p.y : p.x;
      const start = draft.tool === 'hline' ? draft.y : draft.x;
      const spread = Math.abs(axis - start) >= MIN_DRAG / zoom;
      setDraft(spread ? { ...draft, to: axis } : { ...draft, x: p.x, y: p.y, to: undefined });
    }
  };

  /**
   * DOM-Bezug eines Freihand-Strichs: entlang des Zugs sampeln und die
   * tatsaechlich gekreuzten Elemente zaehlen — body/html sind nur der
   * Notnagel, wenn nichts Konkreteres getroffen wurde.
   */
  const penAnchors = (points: Point[]): ElementRef => {
    const step = Math.max(1, Math.floor(points.length / 12));
    const tally = new Map<string, { count: number; label: string; x?: number; y?: number }>();
    for (let i = 0; i < points.length; i += step) {
      const ref = anchorAt(points[i]!.x, points[i]!.y);
      if (!ref.anchor) continue;
      const entry = tally.get(ref.anchor) ?? {
        count: 0,
        label: ref.anchorLabel ?? '',
        x: ref.anchorX,
        y: ref.anchorY,
      };
      entry.count += 1;
      tally.set(ref.anchor, entry);
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1].count - a[1].count);
    const concrete = ranked.filter(([selector]) => selector !== 'body');
    const best = concrete[0] ?? ranked[0];
    if (!best) return {};
    return {
      anchor: best[0],
      anchorLabel: best[1].label || undefined,
      anchors: concrete.length > 0 ? concrete.slice(0, 4).map(([selector]) => selector) : undefined,
      anchorX: best[1].x,
      anchorY: best[1].y,
    };
  };

  // Freihand speichert ohne Notiz-Editor; Rechteck/Ellipse/Pfeil oeffnen wie
  // Pin und Element-Picker direkt das Notizfeld (optional, leer = ohne).
  // Als DOM-Bezug dienen die gekreuzten Elemente, beim Pfeil das Element
  // unter der Spitze.
  const handleUp = () => {
    if (resizing) {
      const { id, box } = resizing;
      setResizing(null);
      // Zusammengeschobene Boxen nicht speichern — sonst bliebe ein
      // unsichtbarer Marker zurueck.
      if (Math.abs(box.x2 - box.x1) >= MIN_DRAG / zoom && Math.abs(box.y2 - box.y1) >= MIN_DRAG / zoom) {
        onResizeShape?.(id, box);
      }
      return;
    }
    if (movingShape) {
      const { id, dx, dy } = movingShape;
      setMovingShape(null);
      if (Math.hypot(dx, dy) >= MIN_DRAG / zoom) onMoveShape?.(id, dx, dy);
      return;
    }
    if (!draft) return;
    setDraft(null);

    if (draft.tool === 'pen') {
      const points = draft.strokes[0] ?? [];
      if (points.length > 1) {
        onAdd({ ...draft, ...penAnchors(points) });
      }
    } else if (draft.tool === 'rect' || draft.tool === 'ellipse' || draft.tool === 'arrow') {
      if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) >= MIN_DRAG / zoom) {
        const ref =
          draft.tool === 'arrow'
            ? anchorAt(draft.x2, draft.y2)
            : anchorAt((draft.x1 + draft.x2) / 2, (draft.y1 + draft.y2) / 2);
        onAdd({ ...draft, ...ref });
        setNoteDraft({ shapeId: draft.id, x: draft.x2, y: draft.y2, value: '' });
      }
    } else if (draft.tool === 'hline' || draft.tool === 'vline') {
      // Ohne Mindeststrecke — ein Klick setzt die Linie bereits.
      onAdd({ ...draft, ...anchorAt(draft.x, draft.y) });
      setNoteDraft({ shapeId: draft.id, x: draft.x, y: draft.y, value: '' });
    }
  };

  const strokeWidth = 2.5 / zoom;
  const fontSize = 15 / zoom;
  const numbers = pinNumbers(shapes);

  /** Flash-Rahmen um den per Panel angesprungenen Marker (an verschobener Position). */
  const flashShape = flashShapeId ? displayShapes.find((s) => s.id === flashShapeId) : null;
  const flashBox = flashShape ? shapeBounds(flashShape) : null;

  /** Ruhige Hervorhebung, solange der Panel-Eintrag gehovert wird. */
  const hoverShape = hoverShapeId ? displayShapes.find((s) => s.id === hoverShapeId) : null;
  const hoverBox = hoverShape ? shapeBounds(hoverShape) : null;

  /**
   * Verschieben sichtbar machen: der Marker unterm Cursor bekommt einen
   * Greif-Rahmen, der gezogene einen kraeftigeren an seiner neuen Position.
   */
  const grabShape = grabId && !movingShape ? displayShapes.find((s) => s.id === grabId) : null;
  const grabBox = grabShape ? shapeBounds(grabShape) : null;
  const dragShape = movingShape ? displayShapes.find((s) => s.id === movingShape.id) : null;
  const dragBox = dragShape
    ? shapeBounds(translateShape(dragShape, movingShape!.dx, movingShape!.dy))
    : null;

  /** Markierung mit Griffen: die unterm Cursor bzw. die gerade gezogene. */
  const handleShape = (() => {
    // Auch beim Hover im Panel — so sind die Griffe auffindbar, ohne die
    // Kontur genau zu treffen.
    const id = resizing?.id ?? hoverHandle?.id ?? grabId ?? hoverShapeId;
    const shape = id ? displayShapes.find((s) => s.id === id) : null;
    // Nur wo der Zug auch etwas bewirkt.
    if (!onResizeShape || movingShape) return null;
    if (!shape || !isResizable(shape) || !mine(shape)) return null;
    return resizing ? { ...shape, ...resizing.box } : shape;
  })();
  const handleBounds = handleShape ? shapeBounds(handleShape) : null;

  /** Sichtbarer Ausschnitt im Dokumentraum — Beschriftungen bleiben darin. */
  const view: View = { x: scroll.x, y: scroll.y, w: width, h: height };

  /** Editor-Position in Overlay-Pixeln, an den Raendern eingeklemmt. */
  const clampEditor = (x: number, y: number, w: number, h: number) => ({
    left: Math.max(4, Math.min((x - scroll.x) * zoom + 14, width * zoom - w - 4)),
    top: Math.max(4, Math.min((y - scroll.y) * zoom + 10, height * zoom - h - 4)),
  });

  return (
    <div
      className={`anno${active ? ' anno--active' : ''}${
        active && tool === 'element' ? ' anno--pick' : ''
      }${movingShape || resizing ? ' anno--dragging' : ''}${
        grabId && !movingShape && !hoverHandle ? ' anno--grab' : ''
      }${
        movingShape ? ' anno--grabbing' : ''
      }${
        resizing || hoverHandle
          ? ` anno--resize-${HANDLE_CURSOR[resizing?.handle ?? hoverHandle!.handle]}`
          : ''
      }`}
    >
      <svg
        ref={svgRef}
        className="anno__svg"
        viewBox={`0 0 ${width} ${height}`}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={() => {
          setDraft(null);
          setMovingShape(null);
          setResizing(null);
        }}
        onWheel={(e) => {
          // Die Trefferflaechen liegen ueber dem Frame — eine Hilfslinie
          // spannt sogar ueber die volle Breite. Ohne Weiterreichen liesse
          // sich die Seite ueber ihr nicht mehr scrollen.
          if (active) return;
          const win = frameEl?.contentWindow;
          if (!win) return;
          // deltaMode 1 = Zeilen, 2 = Seiten.
          const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
          try {
            win.scrollBy(e.deltaX * unit, e.deltaY * unit);
          } catch {
            /* Frame nicht lesbar */
          }
        }}
        onPointerOut={() => {
          // Ausserhalb des Korrekturmodus kommen Events nur von den Konturen:
          // verlaesst der Zeiger sie, bleibt sonst der Greif-Rahmen kleben.
          if (active || movingShape || resizing) return;
          setGrabId(null);
          setHoverHandle(null);
          setHoverNote(null);
        }}
        onPointerLeave={() => {
          setPicked(null);
          setLineGhost(null);
          setGrabId(null);
          setHoverHandle(null);
          setHoverNote(null);
        }}
      >
        <defs>
          {/* Weicher Schatten fuer Notiz-Sprechblasen; Werte /zoom, damit die
              Bildschirmgroesse konstant bleibt. Gleiche Definition in jedem
              Overlay — url(#…) greift die erste im Shadow-Root. */}
          <filter id="ink-note-shadow" x="-40%" y="-40%" width="180%" height="200%">
            <feDropShadow
              dx="0"
              dy={2.5 / zoom}
              stdDeviation={4.5 / zoom}
              floodColor="#000"
              floodOpacity="0.45"
            />
          </filter>
        </defs>
        <g transform={`translate(${-scroll.x}, ${-scroll.y})`}>
          {displayShapes.map((sh) => {
            const s =
              movingShape?.id === sh.id
                ? translateShape(sh, movingShape.dx, movingShape.dy)
                : resizing?.id === sh.id && isResizable(sh)
                  ? { ...sh, ...resizing.box }
                  : sh;
            if (dimmed?.has(s.id)) {
              return (
                <g key={`dim-${s.id}`} opacity={0.35}>
                  {renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id), view)}
                </g>
              );
            }
            // Der gezogene Marker hebt sich sichtbar ab, solange er an der
            // Maus haengt.
            if (movingShape?.id === s.id) {
              return (
                <g key={`drag-${s.id}`} className="anno__moving">
                  {renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id), view)}
                </g>
              );
            }
            return renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id), view);
          })}
          {/* Trefferflaechen der eigenen Markierungen — ausserhalb des
              Korrekturmodus der einzige Weg, sie noch anfassen zu koennen. */}
          {!active && !showNotes && (onMoveShape || onResizeShape) && (
            <g className="anno__hits">
              {displayShapes
                .filter((s) => mine(s) && !dimmed?.has(s.id))
                .map((sh) =>
                  movingShape?.id === sh.id
                    ? translateShape(sh, movingShape.dx, movingShape.dy)
                    : resizing?.id === sh.id && isResizable(sh)
                      ? { ...sh, ...resizing.box }
                      : sh,
                )
                .map((s) => renderHitShape(s, 8 / zoom))}
            </g>
          )}
          {showNotes &&
            displayShapes
              .filter((s) => !dimmed?.has(s.id))
              .map((s) => renderNoteBubble(s, zoom, { clampWidth: width }))}
          {/* Notizen stehen dauerhaft am Marker — gekuerzt, damit sie den
              Inhalt nicht zudecken; der Hover zeigt den vollen Text. */}
          {!showNotes &&
            notedShapes
              .filter((s) => s.id !== hoverNote?.id)
              .map((s) =>
                movingShape?.id === s.id
                  ? translateShape(s, movingShape.dx, movingShape.dy)
                  : s,
              )
              .filter((s) => {
                const anchor = noteOf(s);
                return (
                  anchor != null &&
                  anchor.x <= view.x + view.w &&
                  anchor.y <= view.y + view.h &&
                  anchor.x >= view.x - view.w &&
                  anchor.y >= view.y - view.h
                );
              })
              .map((s) => renderNoteBubble(s, zoom, { view, compact: true }))}
          {!showNotes &&
            hoverNote &&
            (() => {
              const shape = notedShapes.find((s) => s.id === hoverNote.id);
              if (!shape) return null;
              // Direkt neben dem Cursor, eingeklemmt in den sichtbaren
              // Frame-Ausschnitt (Dokumentraum: scroll..scroll+viewport).
              return renderNoteBubble(shape, zoom, {
                at: { x: hoverNote.x + 14 / zoom, y: hoverNote.y + 18 / zoom },
                view,
              });
            })()}
          {active && !draft && lineGhost && (tool === 'hline' || tool === 'vline') && (
            <g opacity={0.55}>
              {renderShape(
                { id: 'line-ghost', tool, color, x: lineGhost.x, y: lineGhost.y },
                strokeWidth,
                fontSize,
                zoom,
                undefined,
                view,
              )}
            </g>
          )}
          {draft && renderShape(draft, strokeWidth, fontSize, zoom, undefined, view)}
          {/* Greifbar: heller Rahmen mit dunkler Kontur darunter, damit er auf
              jedem Seitenhintergrund steht. */}
          {grabBox && (
            <g className="anno__mark-grab" pointerEvents="none">
              <rect
                x={grabBox.x - 5 / zoom}
                y={grabBox.y - 5 / zoom}
                width={grabBox.w + 10 / zoom}
                height={grabBox.h + 10 / zoom}
                rx={7 / zoom}
                fill="none"
                stroke="rgba(14, 16, 20, .55)"
                strokeWidth={4 / zoom}
              />
              <rect
                x={grabBox.x - 5 / zoom}
                y={grabBox.y - 5 / zoom}
                width={grabBox.w + 10 / zoom}
                height={grabBox.h + 10 / zoom}
                rx={7 / zoom}
                fill="none"
                stroke="#5b8cff"
                strokeWidth={2 / zoom}
                strokeDasharray={`${5 / zoom} ${4 / zoom}`}
              />
            </g>
          )}
          {dragBox && (
            <g className="anno__mark-drag" pointerEvents="none">
              <rect
                x={dragBox.x - 5 / zoom}
                y={dragBox.y - 5 / zoom}
                width={dragBox.w + 10 / zoom}
                height={dragBox.h + 10 / zoom}
                rx={7 / zoom}
                fill="rgba(91, 140, 255, .16)"
                stroke="rgba(14, 16, 20, .55)"
                strokeWidth={4.5 / zoom}
              />
              <rect
                x={dragBox.x - 5 / zoom}
                y={dragBox.y - 5 / zoom}
                width={dragBox.w + 10 / zoom}
                height={dragBox.h + 10 / zoom}
                rx={7 / zoom}
                fill="none"
                stroke="#5b8cff"
                strokeWidth={2.5 / zoom}
              />
            </g>
          )}
          {/* Griffe an Ecken und Kantenmitten — hier aendert der Zug die Groesse. */}
          {handleBounds && (
            <g className="anno__handles">
              {HANDLE_IDS.map((id) => {
                const pt = handlePos(handleBounds, id);
                const size = 9 / zoom;
                const activeHandle = (resizing?.handle ?? hoverHandle?.handle) === id;
                return (
                  <rect
                    key={id}
                    x={pt.x - size / 2}
                    y={pt.y - size / 2}
                    width={size}
                    height={size}
                    rx={2 / zoom}
                    fill={activeHandle ? '#5b8cff' : '#fff'}
                    stroke="rgba(14, 16, 20, .75)"
                    strokeWidth={1.5 / zoom}
                    pointerEvents="all"
                  />
                );
              })}
            </g>
          )}
          {hoverBox && (
            <rect
              className="anno__mark-hover"
              x={hoverBox.x - 6 / zoom}
              y={hoverBox.y - 6 / zoom}
              width={hoverBox.w + 12 / zoom}
              height={hoverBox.h + 12 / zoom}
              rx={8 / zoom}
              fill="rgba(91, 140, 255, 0.14)"
              stroke="var(--accent)"
              strokeWidth={2 / zoom}
              pointerEvents="none"
            />
          )}
          {flashBox && (
            <rect
              key={`flash-${flashNonce}`}
              className="anno__flash"
              x={flashBox.x - 8 / zoom}
              y={flashBox.y - 8 / zoom}
              width={flashBox.w + 16 / zoom}
              height={flashBox.h + 16 / zoom}
              rx={10 / zoom}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={3 / zoom}
              pointerEvents="none"
            />
          )}
          {active && tool === 'element' && picked && !noteDraft && (
            <g pointerEvents="none">
              {renderBoxModel(picked, zoom, view)}
              <rect
                x={picked.x}
                y={picked.y}
                width={picked.w}
                height={picked.h}
                fill={color}
                fillOpacity={0.08}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${5 / zoom} ${4 / zoom}`}
              />
              {renderLabelPill(
                picked.x,
                picked.y,
                `${picked.label} · ${Math.round(picked.w)}×${Math.round(picked.h)}`,
                color,
                zoom,
                view,
              )}
            </g>
          )}
        </g>
      </svg>

      {textDraft && (
        <input
          className="anno__input"
          style={{
            ...clampEditor(textDraft.x, textDraft.y, 180, 34),
            borderColor: color,
            color,
          }}
          value={textDraft.value}
          autoFocus
          spellCheck={false}
          placeholder="Text…"
          aria-label="Text annotation"
          onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
          onKeyDown={(e) => {
            // stopPropagation: Esc/Enter sollen nur den Draft betreffen,
            // nicht die globalen Shortcuts (Modus beenden etc.).
            if (e.key === 'Enter') {
              e.stopPropagation();
              commitText();
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setTextDraft(null);
            }
          }}
          onBlur={commitText}
        />
      )}

      {noteDraft && (
        <div
          ref={noteBoxRef}
          className="anno__note"
          style={clampEditor(noteDraft.x, noteDraft.y, 230, 92)}
        >
          {(() => {
            // Bei Hilfslinien laesst sich der Abstand hier auch tippen —
            // gezogene Werte sind selten exakt, ein Sollwert („24 px") schon.
            const shape = shapes.find((s) => s.id === noteDraft.shapeId);
            if (!shape || (shape.tool !== 'hline' && shape.tool !== 'vline')) return null;
            if (!onSetLineGap) return null;
            const gap = lineGap(shape);
            return (
              <label className="anno__note-row">
                <span>{shape.tool === 'hline' ? 'Height' : 'Width'}</span>
                <input
                  className="anno__note-num"
                  type="number"
                  min={0}
                  step={1}
                  value={gap == null ? '' : Math.round(gap)}
                  placeholder="—"
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    onSetLineGap(
                      shape.id,
                      e.target.value === '' || !Number.isFinite(value) || value <= 0 ? null : value,
                    );
                  }}
                  onKeyDown={(e) => {
                    // Wie im Notizfeld: die Tasten gehoeren dem Editor.
                    e.stopPropagation();
                    if (e.key === 'Enter') commitNote();
                  }}
                  onBlur={(e) => {
                    onCommitShape?.(shape.id);
                    if (noteBoxRef.current?.contains(e.relatedTarget as Node | null)) return;
                    commitNote();
                  }}
                />
                <span className="anno__note-unit">px</span>
              </label>
            );
          })()}
          <textarea
            ref={noteFieldRef}
            className="anno__note-field"
            value={noteDraft.value}
            autoFocus
            spellCheck={false}
            rows={3}
            placeholder="Note (optional)…"
            onChange={(e) => setNoteDraft({ ...noteDraft, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.stopPropagation();
                e.preventDefault();
                commitNote();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setNoteDraft(null); // Marker bleibt, Notiz verworfen
              }
            }}
            onBlur={(e) => {
              // Sprung ins Abstandsfeld daneben ist kein Verlassen des
              // Editors — sonst schliesst er sich beim ersten Klick dorthin.
              if (noteBoxRef.current?.contains(e.relatedTarget as Node | null)) return;
              commitNote();
            }}
          />
          <div className="anno__note-hint">Enter saves · Esc skips the note</div>
        </div>
      )}
    </div>
  );
}

/** Zeilenumbruch fuer Notiz-Sprechblasen — SVG-<text> bricht nicht selbst um. */
function wrapNote(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, maxChars - 1)}…`;
  }
  return lines;
}

/** Editierbarer Inhalt einer Markierung: Pins/Texte tragen ihn in `text`, alle anderen in `note`. */
function editableTextOf(shape: Shape): string {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text;
  return shape.note ?? '';
}

/** Notiztext und Ankerpunkt (Dokumentraum) einer Markierung — null ohne Notiz. */
function noteOf(shape: Shape): { text: string; x: number; y: number } | null {
  switch (shape.tool) {
    case 'pin':
      return shape.text ? { text: shape.text, x: shape.x + 14, y: shape.y + 6 } : null;
    case 'element':
      return shape.note ? { text: shape.note, x: shape.x, y: shape.y + shape.h + 6 } : null;
    case 'rect':
    case 'ellipse':
      return shape.note
        ? { text: shape.note, x: Math.min(shape.x1, shape.x2), y: Math.max(shape.y1, shape.y2) + 6 }
        : null;
    case 'arrow':
      return shape.note ? { text: shape.note, x: shape.x2 + 8, y: shape.y2 + 6 } : null;
    case 'hline':
      return shape.note ? { text: shape.note, x: shape.x + 8, y: shape.y + 8 } : null;
    case 'vline':
      return shape.note ? { text: shape.note, x: shape.x + 8, y: shape.y + 8 } : null;
    case 'pen': {
      if (!shape.note) return null;
      const b = shapeBounds(shape);
      return b ? { text: shape.note, x: b.x, y: b.y + b.h + 6 } : null;
    }
    default:
      return null; // Text rendert sich selbst
  }
}

/**
 * Notiz als Sprechblase — dauerhaft am Marker (gekuerzt), beim Hover in
 * voller Laenge direkt neben dem Cursor (`at`). Konstante Bildschirmgroesse,
 * deshalb /zoom.
 */
interface NoteBubbleOptions {
  /** Abweichender Ankerpunkt (Hover: Mausposition). */
  at?: Point;
  /** Sichtbarer Ausschnitt — die Blase bleibt vollstaendig darin. */
  view?: View;
  /** Nur-horizontales Einklemmen (Screenshot): Blase nicht ueber den rechten
   *  Frame-Rand hinaus rendern, sonst schneidet der Capture sie ab. */
  clampWidth?: number;
  /** Dauerhafte Blase am Marker: kurz halten, langer Text wird abgeschnitten. */
  compact?: boolean;
}

function renderNoteBubble(shape: Shape, zoom: number, opts: NoteBubbleOptions = {}) {
  const { at, view, clampWidth, compact } = opts;
  const source = noteOf(shape);
  if (!source) return null;

  const size = 12 / zoom;
  const lineH = size * 1.45;
  const padY = 9 / zoom;
  const padRight = 12 / zoom;
  // Farbiger Akzentbalken links statt vollfarbigem Rahmen — der Text rueckt
  // entsprechend ein.
  const barX = 8 / zoom;
  const barW = 3 / zoom;
  const textX = barX + barW + 9 / zoom;
  const lines = compact ? wrapNote(source.text, 26, 2) : wrapNote(source.text, 32, 5);
  const longest = lines.reduce((max, l) => Math.max(max, l.length), 0);
  const w = textX + longest * size * 0.6 + padRight;
  const h = lines.length * lineH + padY * 2;

  const note = { ...source, ...(at ?? {}) };
  const edge = 4 / zoom;
  if (view) {
    // Die Notiz gehoert zum Marker und muss lesbar bleiben: in den sichtbaren
    // Frame-Ausschnitt einklemmen statt am Rand abzuschneiden.
    note.x = Math.max(view.x + edge, Math.min(note.x, view.x + view.w - w - edge));
    note.y = Math.max(view.y + edge, Math.min(note.y, view.y + view.h - h - edge));
  } else if (clampWidth != null) {
    // Screenshot: nur horizontal einklemmen (Dokument scrollt vertikal weiter,
    // horizontal ist die Frame-Breite fest) — verhindert den rechten Abschnitt.
    note.x = Math.max(edge, Math.min(note.x, clampWidth - w - edge));
    note.y = Math.max(edge, note.y);
  }

  return (
    <g key={`note-${shape.id}`} className="anno__bubble" pointerEvents="none">
      <rect
        x={note.x}
        y={note.y}
        width={w}
        height={h}
        rx={9 / zoom}
        fill="rgba(14, 16, 20, 0.92)"
        stroke="rgba(255, 255, 255, 0.12)"
        strokeWidth={1 / zoom}
        filter="url(#ink-note-shadow)"
      />
      <rect
        x={note.x + barX}
        y={note.y + padY}
        width={barW}
        height={h - padY * 2}
        rx={barW / 2}
        fill={shape.color}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={note.x + textX}
          y={note.y + padY + i * lineH + size * 0.88}
          fill="#f2f4f8"
          fontSize={size}
          fontFamily='ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/**
 * Beschriftungs-Pill: dunkle Kapsel mit farbigem Rand und weissem Text —
 * ersetzt den frueheren Text mit Kontur-Stroke, der auf bunten Seiten
 * unruhig wirkte. Sitzt oberhalb des Ankers; rutscht nach innen, wenn oben
 * kein Platz ist. Konstante Bildschirmgroesse, deshalb /zoom.
 */
function renderLabelPill(
  x: number,
  y: number,
  text: string,
  color: string,
  zoom: number,
  view?: View,
) {
  const size = 11 / zoom;
  const padX = 6 / zoom;
  const padY = 3.5 / zoom;
  const w = text.length * size * 0.62 + padX * 2;
  const h = size + padY * 2;
  const above = y - h - 4 / zoom;
  const raw = above >= (view?.y ?? 0) ? above : y + 4 / zoom;
  const box = clampLabel(x, raw, w, h, zoom, view);
  return (
    <g pointerEvents="none">
      <rect
        x={box.x}
        y={box.y}
        width={w}
        height={h}
        rx={h / 2}
        fill="rgba(14, 16, 20, 0.92)"
        stroke={color}
        strokeWidth={1 / zoom}
      />
      <text
        x={box.x + padX}
        y={box.y + padY + size * 0.82}
        fill="#fff"
        fontSize={size}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {text}
      </text>
    </g>
  );
}

/**
 * Box-Model-Visualisierung fuer den Element-Picker (Figma-Dev-Mode-Metapher):
 * Margin-Streifen orange, Padding-Streifen gruen, Werte als Mini-Pills, wenn
 * der Streifen genug Platz bietet. Negative Margins werden nicht gezeichnet.
 */
function renderBoxModel(t: ElementTarget, zoom: number, view?: View) {
  const { margin: m, padding: p } = t;
  const ml = Math.max(0, m.l);
  const mr = Math.max(0, m.r);
  const strips: { x: number; y: number; w: number; h: number; v: number; kind: 'm' | 'p' }[] = [];

  if (m.t > 0) strips.push({ x: t.x - ml, y: t.y - m.t, w: t.w + ml + mr, h: m.t, v: m.t, kind: 'm' });
  if (m.b > 0) strips.push({ x: t.x - ml, y: t.y + t.h, w: t.w + ml + mr, h: m.b, v: m.b, kind: 'm' });
  if (ml > 0) strips.push({ x: t.x - ml, y: t.y, w: ml, h: t.h, v: ml, kind: 'm' });
  if (mr > 0) strips.push({ x: t.x + t.w, y: t.y, w: mr, h: t.h, v: mr, kind: 'm' });

  if (p.t > 0) strips.push({ x: t.x, y: t.y, w: t.w, h: p.t, v: p.t, kind: 'p' });
  if (p.b > 0) strips.push({ x: t.x, y: t.y + t.h - p.b, w: t.w, h: p.b, v: p.b, kind: 'p' });
  if (p.l > 0) strips.push({ x: t.x, y: t.y + p.t, w: p.l, h: t.h - p.t - p.b, v: p.l, kind: 'p' });
  if (p.r > 0) strips.push({ x: t.x + t.w - p.r, y: t.y + p.t, w: p.r, h: t.h - p.t - p.b, v: p.r, kind: 'p' });

  const labelSize = 9.5 / zoom;
  return (
    <g pointerEvents="none">
      {strips.map((s, i) => (
        <rect
          key={i}
          x={s.x}
          y={s.y}
          width={Math.max(0, s.w)}
          height={Math.max(0, s.h)}
          fill={s.kind === 'm' ? 'rgba(246, 178, 107, .32)' : 'rgba(147, 196, 125, .38)'}
        />
      ))}
      {strips
        .filter((s) => s.v >= 2 && Math.min(s.w, s.h) * zoom >= 11)
        .map((s, i) => {
          const label = String(Math.round(s.v));
          const w = label.length * labelSize * 0.65 + 8 / zoom;
          const h = labelSize + 5 / zoom;
          // Mitte des sichtbaren Streifenteils — bei teils ausgescrolltem
          // Element bleibt die Pille am Streifen statt aus dem Bild zu laufen.
          const vis = view
            ? {
                x0: Math.max(s.x, view.x),
                x1: Math.min(s.x + s.w, view.x + view.w),
                y0: Math.max(s.y, view.y),
                y1: Math.min(s.y + s.h, view.y + view.h),
              }
            : { x0: s.x, x1: s.x + s.w, y0: s.y, y1: s.y + s.h };
          if (vis.x1 <= vis.x0 || vis.y1 <= vis.y0) return null;
          const cx = (vis.x0 + vis.x1) / 2;
          const cy = (vis.y0 + vis.y1) / 2;
          return (
            <g key={`v${i}`}>
              <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={h / 2} fill="rgba(14, 16, 20, .85)" />
              <text
                x={cx}
                y={cy}
                fill="#fff"
                fontSize={labelSize}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {label}
              </text>
            </g>
          );
        })}
    </g>
  );
}

/**
 * Massband zwischen den beiden Linien eines Paars: eine Strecke mit Endkappen
 * quer zu den Linien, daneben der Abstand in Dokument-Pixeln. Konstante
 * Bildschirmgroesse, deshalb /zoom.
 */
function renderLineGap(
  shape: Shape & { tool: 'hline' | 'vline' },
  from: number,
  to: number,
  gap: number,
  strokeWidth: number,
  zoom: number,
  view?: View,
) {
  const horizontal = shape.tool === 'hline';
  const cross = horizontal ? shape.x : shape.y;
  const cap = 6 / zoom;
  const size = 11 / zoom;
  const label = `${Math.round(gap)} px`;
  const mid = (from + to) / 2;
  // Waagerechtes Paar: Beschriftung rechts neben dem Massband, senkrechtes
  // Paar: darueber — so verdeckt sie die gemessene Strecke nie.
  const labelX = horizontal ? cross + 9 / zoom : mid;
  const labelY = horizontal ? mid : cross - 14 / zoom;
  const padX = 5 / zoom;
  const padY = 3 / zoom;
  const boxW = label.length * size * 0.62 + padX * 2;
  const boxH = size + padY * 2;
  // Am Rand gezogene Linien: die Beschriftung rutscht in den sichtbaren
  // Ausschnitt, statt neben dem Frame zu verschwinden.
  const box = clampLabel(
    horizontal ? labelX - padX : labelX - boxW / 2,
    labelY - boxH / 2,
    boxW,
    boxH,
    zoom,
    view,
  );
  const line = { stroke: shape.color, strokeWidth: strokeWidth * 0.8, fill: 'none' } as const;
  return (
    <g>
      {horizontal ? (
        <>
          <path d={`M${cross},${from} L${cross},${to}`} {...line} />
          <path d={`M${cross - cap},${from} L${cross + cap},${from}`} {...line} />
          <path d={`M${cross - cap},${to} L${cross + cap},${to}`} {...line} />
        </>
      ) : (
        <>
          <path d={`M${from},${cross} L${to},${cross}`} {...line} />
          <path d={`M${from},${cross - cap} L${from},${cross + cap}`} {...line} />
          <path d={`M${to},${cross - cap} L${to},${cross + cap}`} {...line} />
        </>
      )}
      <rect
        x={box.x}
        y={box.y}
        width={boxW}
        height={boxH}
        rx={5 / zoom}
        fill="rgba(14, 16, 20, 0.92)"
        stroke={shape.color}
        strokeWidth={1.2 / zoom}
      />
      <text
        x={box.x + boxW / 2}
        y={box.y + boxH / 2}
        fill="#fff"
        fontSize={size}
        fontWeight={600}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {label}
      </text>
    </g>
  );
}

function renderShape(
  shape: Shape,
  strokeWidth: number,
  fontSize: number,
  zoom: number,
  pinNumber?: number,
  view?: View,
) {
  const stroke ={ stroke: shape.color, strokeWidth, fill: 'none' } as const;

  switch (shape.tool) {
    case 'element':
      return (
        <g key={shape.id}>
          <rect
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            fill={shape.color}
            fillOpacity={0.14}
            stroke={shape.color}
            strokeWidth={strokeWidth}
          />
          {renderLabelPill(shape.x, shape.y, shape.label, shape.color, zoom, view)}
        </g>
      );
    case 'pin': {
      // Pins behalten konstante Bildschirmgroesse, deshalb /zoom.
      const r = 11 / zoom;
      return (
        <g key={shape.id}>
          <circle
            cx={shape.x}
            cy={shape.y}
            r={r}
            fill={shape.color}
            stroke="#fff"
            strokeWidth={1.5 / zoom}
          />
          <text
            x={shape.x}
            y={shape.y}
            fill="#fff"
            fontSize={12 / zoom}
            fontWeight={700}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily='ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
          >
            {pinNumber ?? ''}
          </text>
        </g>
      );
    }
    case 'pen':
      return (
        <g key={shape.id} strokeLinecap="round" strokeLinejoin="round" {...stroke}>
          {(shape.strokes ?? []).map((points, i) => (
            <polyline key={i} points={points.map((p) => `${p.x},${p.y}`).join(' ')} />
          ))}
        </g>
      );
    case 'rect':
      return (
        <rect
          key={shape.id}
          x={Math.min(shape.x1, shape.x2)}
          y={Math.min(shape.y1, shape.y2)}
          width={Math.abs(shape.x2 - shape.x1)}
          height={Math.abs(shape.y2 - shape.y1)}
          rx={2}
          {...stroke}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          key={shape.id}
          cx={(shape.x1 + shape.x2) / 2}
          cy={(shape.y1 + shape.y2) / 2}
          rx={Math.abs(shape.x2 - shape.x1) / 2}
          ry={Math.abs(shape.y2 - shape.y1) / 2}
          {...stroke}
        />
      );
    case 'arrow': {
      const { x1, y1, x2, y2 } = shape;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = strokeWidth * 5;
      const p1 = `${x2 - head * Math.cos(angle - 0.45)},${y2 - head * Math.sin(angle - 0.45)}`;
      const p2 = `${x2 - head * Math.cos(angle + 0.45)},${y2 - head * Math.sin(angle + 0.45)}`;
      return (
        <g key={shape.id} strokeLinecap="round" strokeLinejoin="round" {...stroke}>
          <path d={`M${x1},${y1} L${x2},${y2}`} />
          <path d={`M${p1} L${x2},${y2} L${p2}`} />
        </g>
      );
    }
    case 'hline':
    case 'vline': {
      // Ueber den Frame hinaus verlaengert — der Viewport schneidet ab, die
      // Linie spannt so in jeder Scroll-Position ueber die volle Breite/Hoehe.
      const horizontal = shape.tool === 'hline';
      const lineAt = (v: number) =>
        horizontal
          ? `M${shape.x - LINE_REACH},${v} L${shape.x + LINE_REACH},${v}`
          : `M${v},${shape.y - LINE_REACH} L${v},${shape.y + LINE_REACH}`;
      const start = horizontal ? shape.y : shape.x;
      const gap = lineGap(shape);
      // Der gemessene Streifen bekommt ein Rautenmuster — dezent genug, um
      // den Inhalt darunter lesbar zu lassen, aber deutlich als Flaeche.
      const patternId = `ink-diamonds-${shape.id}`;
      const cell = 9 / zoom;
      return (
        <g key={shape.id}>
          {shape.to != null && (
            <>
              <defs>
                <pattern
                  id={patternId}
                  width={cell}
                  height={cell}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M0,${cell / 2} L${cell / 2},0 L${cell},${cell / 2} L${cell / 2},${cell} Z`}
                    fill="none"
                    stroke={shape.color}
                    strokeWidth={1.2 / zoom}
                  />
                </pattern>
              </defs>
              <rect
                x={horizontal ? shape.x - LINE_REACH : Math.min(start, shape.to)}
                y={horizontal ? Math.min(start, shape.to) : shape.y - LINE_REACH}
                width={horizontal ? LINE_REACH * 2 : Math.abs(shape.to - start)}
                height={horizontal ? Math.abs(shape.to - start) : LINE_REACH * 2}
                fill={`url(#${patternId})`}
                fillOpacity={0.1}
                stroke="none"
              />
            </>
          )}
          <path d={lineAt(start)} {...stroke} />
          {shape.to != null && <path d={lineAt(shape.to)} {...stroke} />}
          {shape.to != null &&
            gap != null &&
            renderLineGap(shape, start, shape.to, gap, strokeWidth, zoom, view)}
        </g>
      );
    }
    case 'text': {
      // Dunkle Kapsel mit farbigem Rand statt Text mit Kontur-Stroke.
      const padX = 7 / zoom;
      const padY = 4 / zoom;
      const w = shape.text.length * fontSize * 0.58 + padX * 2;
      const h = fontSize + padY * 2;
      return (
        <g key={shape.id}>
          <rect
            x={shape.x - padX}
            y={shape.y}
            width={w}
            height={h}
            rx={6 / zoom}
            fill="rgba(14, 16, 20, 0.92)"
            stroke={shape.color}
            strokeWidth={1.2 / zoom}
          />
          <text
            x={shape.x}
            y={shape.y + padY + fontSize * 0.82}
            fill="#fff"
            fontSize={fontSize}
            fontWeight={600}
            fontFamily='ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
          >
            {shape.text}
          </text>
        </g>
      );
    }
  }
}
