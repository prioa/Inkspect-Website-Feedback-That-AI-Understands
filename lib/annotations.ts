/**
 * Korrektur-Markierungen pro Device-Frame. Koordinaten liegen im
 * *Dokumentraum* des Frames (CSS-Pixel inkl. Scroll-Offset zum Zeitpunkt des
 * Zeichnens) — so bleiben die Markierungen beim Scrollen am Inhalt kleben.
 */

export type Tool =
  | 'element'
  | 'pin'
  | 'pen'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'hline'
  | 'vline'
  | 'text';

/** Die Palette kennt zusaetzlich den Interaktionsmodus (kein Zeichnen). */
export type PaletteTool = Tool | 'interact';

export interface Point {
  x: number;
  y: number;
}

/**
 * DOM-Bezug einer Markierung: CSS-Pfad (Shadow-Segmente mit ' >>> ' verbunden)
 * und Kurz-Label des Elements unter bzw. hinter der Markierung. Macht Exporte
 * (Text-Export) im Quellcode verortbar.
 */
export interface ElementRef {
  anchor?: string;
  anchorLabel?: string;
  /** Alle gekreuzten Elemente (Freihand), Selektoren in Relevanz-Reihenfolge. */
  anchors?: string[];
  /**
   * Doc-Koordinaten der linken oberen Ecke des Anker-Elements zum Zeichen-
   * Zeitpunkt. Nach einem Reload wird der Anker neu aufgeloest; die Differenz
   * zu dieser Ur-Position verschiebt die Markierung, sodass sie am Element
   * klebt statt an einer absoluten Stelle (Accordion auf/zu, Menue offen).
   * Fehlt bei Alt-Daten — dann bleibt die Markierung an ihrer Position.
   */
  anchorX?: number;
  anchorY?: number;
}

/**
 * Per Element-Picker markiertes DOM-Element: Bounding-Box zum Zeitpunkt des
 * Klicks plus lesbares Label (`button#menuBtn`) fuers Panel.
 */
export interface ElementShape {
  id: string;
  tool: 'element';
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** CSS-Pfad des markierten Elements (fehlt bei Alt-Daten). */
  selector?: string;
  /** Optionaler Freitext zum Marker. */
  note?: string;
  /**
   * Gemeinsame Id der auf alle Devices replizierten Element-Marker — Notiz-
   * Aenderungen laufen ueber sie auf alle Kopien.
   */
  syncId?: string;
}

export interface PinShape extends ElementRef {
  id: string;
  tool: 'pin';
  color: string;
  x: number;
  y: number;
  text: string;
}

/**
 * Freihand-Korrektur. Mehrere Zuege, die sich kreuzen oder ueberlappen,
 * verschmelzen zu einer Shape — ein Durchstreichen aus drei Strichen ist
 * *eine* Korrektur, nicht drei.
 */
export interface PenShape extends ElementRef {
  id: string;
  tool: 'pen';
  color: string;
  strokes: Point[][];
  /** Optionaler Freitext zum Marker. */
  note?: string;
}

export interface BoxShape extends ElementRef {
  id: string;
  tool: 'rect' | 'ellipse' | 'arrow';
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Optionaler Freitext zum Marker. */
  note?: string;
}

/**
 * Hilfslinie ueber die gesamte Breite (`hline`, waagerecht bei `y`) bzw.
 * Hoehe (`vline`, senkrecht bei `x`) des Frames. Nur die relevante Achse
 * traegt Information, die andere wird beim Rendern bis ueber den Rand
 * hinaus verlaengert.
 *
 * Zieht man nach dem Klick weiter, entsteht eine *zweite* Linie bei `to`
 * (y-Wert bei `hline`, x-Wert bei `vline`) — das Paar misst den Abstand
 * dazwischen, etwa fuer Abstaende zwischen zwei Kanten.
 */
export interface LineShape extends ElementRef {
  id: string;
  tool: 'hline' | 'vline';
  color: string;
  x: number;
  y: number;
  /** Zweite Linie auf der relevanten Achse — fehlt bei einer einzelnen Linie. */
  to?: number;
  /** Optionaler Freitext zum Marker. */
  note?: string;
}

/** Abstand zwischen den beiden Linien eines Paars (Dokument-Pixel), sonst null. */
export function lineGap(shape: LineShape): number | null {
  if (shape.to == null) return null;
  return Math.abs(shape.to - (shape.tool === 'hline' ? shape.y : shape.x));
}

/**
 * Masse einer Markierung als Kurztext fuers Panel (`320 × 48 px`, `24 px`) —
 * dieselbe Zahl, die das Overlay am Marker zeigt. Punktfoermige Markierungen
 * (Pin, Text, Freihand) haben keine Angabe.
 */
export function shapeSize(shape: Shape): string | null {
  switch (shape.tool) {
    case 'element':
      return `${Math.round(shape.w)} × ${Math.round(shape.h)} px`;
    case 'rect':
    case 'ellipse':
      return `${Math.round(Math.abs(shape.x2 - shape.x1))} × ${Math.round(
        Math.abs(shape.y2 - shape.y1),
      )} px`;
    case 'arrow':
      return `${Math.round(Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1))} px`;
    case 'hline':
    case 'vline': {
      const gap = lineGap(shape);
      return gap == null ? null : `${Math.round(gap)} px`;
    }
    default:
      return null;
  }
}

/**
 * Halbe Laenge, mit der Hilfslinien ueber ihren Ankerpunkt hinaus gezeichnet
 * werden — gross genug, dass sie jeden Frame in jeder Scroll-Position
 * ueberspannen; der SVG-Viewport schneidet den Ueberstand ab.
 */
export const LINE_REACH = 100000;

export interface TextShape extends ElementRef {
  id: string;
  tool: 'text';
  color: string;
  x: number;
  y: number;
  text: string;
}

export type Shape = ElementShape | PinShape | PenShape | BoxShape | LineShape | TextShape;

/** Werkzeug-Reihenfolge in der Leiste, bevor der Nutzer sie umsortiert. */
export const DEFAULT_TOOL_ORDER: Tool[] = [
  'element',
  'pin',
  'pen',
  'rect',
  'ellipse',
  'arrow',
  'hline',
  'vline',
  'text',
];

export const ANNOTATION_COLORS = ['#ff5d5d', '#ffb340', '#3ecf6e', '#5b8cff'] as const;

export const TOOL_LABELS: Record<Tool, string> = {
  element: 'Mark element',
  pin: 'Comment pin',
  pen: 'Freehand',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  hline: 'Horizontal line',
  vline: 'Vertical line',
  text: 'Text',
};

/**
 * Gelten zwei Freihand-Zuege als eine Korrektur? Ja, wenn sich Segmente
 * kreuzen oder die Zuege naeher als `threshold` Dokument-Pixel beieinander
 * verlaufen.
 */
export function penOverlaps(a: Point[][], b: Point[][], threshold = 12): boolean {
  for (const strokeA of a) {
    for (const strokeB of b) {
      if (strokesTouch(strokeA, strokeB, threshold)) return true;
    }
  }
  return false;
}

function strokesTouch(a: Point[], b: Point[], threshold: number): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
    }
  }
  for (const p of a) if (minDistToStroke(p, b) < threshold) return true;
  for (const p of b) if (minDistToStroke(p, a) < threshold) return true;
  return false;
}

function minDistToStroke(p: Point, stroke: Point[]): number {
  if (stroke.length === 1) return Math.hypot(p.x - stroke[0]!.x, p.y - stroke[0]!.y);
  let min = Infinity;
  for (let i = 0; i < stroke.length - 1; i++) {
    min = Math.min(min, distToSegment(p, stroke[i]!, stroke[i + 1]!));
  }
  return min;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const cross = (a: Point, b: Point, c: Point) =>
    (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Kurzes, lesbares Label eines DOM-Elements: tag#id bzw. tag.klasse. */
export function elementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const classes = [...el.classList].slice(0, 2).join('.');
  return classes ? `${tag}.${classes}` : tag;
}

/** Laufende Nummern der Pins eines Frames, in Zeichen-Reihenfolge. */
export function pinNumbers(shapes: Shape[]): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const s of shapes) {
    if (s.tool === 'pin') map.set(s.id, ++n);
  }
  return map;
}

/** Punkt, den man ansteuern sollte, um die Markierung zu sehen (Dokumentraum). */
export function shapeFocusPoint(shape: Shape): Point {
  switch (shape.tool) {
    case 'element':
      return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
    case 'pin':
    case 'text':
    case 'hline':
    case 'vline':
      return { x: shape.x, y: shape.y };
    case 'arrow':
      return { x: shape.x2, y: shape.y2 };
    case 'rect':
    case 'ellipse':
      return { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };
    case 'pen': {
      const first = shape.strokes?.[0]?.[0];
      return first ?? { x: 0, y: 0 };
    }
  }
}

/** Umgebendes Rechteck einer Markierung im Dokumentraum (Hover/Flash). */
export function shapeBounds(
  shape: Shape,
): { x: number; y: number; w: number; h: number } | null {
  switch (shape.tool) {
    case 'element':
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'pin':
      return { x: shape.x - 14, y: shape.y - 14, w: 28, h: 28 };
    case 'rect':
    case 'ellipse':
    case 'arrow':
      return {
        x: Math.min(shape.x1, shape.x2),
        y: Math.min(shape.y1, shape.y2),
        w: Math.abs(shape.x2 - shape.x1),
        h: Math.abs(shape.y2 - shape.y1),
      };
    // Schmales Band entlang der Linie — Hover/Doppelklick treffen sie auf
    // ihrer ganzen Laenge.
    case 'hline': {
      const top = Math.min(shape.y, shape.to ?? shape.y);
      const bottom = Math.max(shape.y, shape.to ?? shape.y);
      return { x: shape.x - LINE_REACH, y: top - 5, w: LINE_REACH * 2, h: bottom - top + 10 };
    }
    case 'vline': {
      const left = Math.min(shape.x, shape.to ?? shape.x);
      const right = Math.max(shape.x, shape.to ?? shape.x);
      return { x: left - 5, y: shape.y - LINE_REACH, w: right - left + 10, h: LINE_REACH * 2 };
    }
    case 'text':
      // Textbreite grob geschaetzt — reicht fuer Hover-Treffer und Flash.
      return { x: shape.x - 4, y: shape.y - 4, w: Math.max(60, shape.text.length * 9), h: 30 };
    case 'pen': {
      const points = (shape.strokes ?? []).flat();
      if (points.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
}

/**
 * Markierung um (dx, dy) im Dokumentraum verschieben. Der DOM-Anker bleibt
 * unveraendert — er beschreibt die Ur-Position des Ankerelements, nicht die
 * der Markierung.
 */
export function translateShape<T extends Shape>(shape: T, dx: number, dy: number): T {
  const moved = { ...shape } as Shape;
  switch (moved.tool) {
    case 'element':
    case 'pin':
    case 'text':
      moved.x += dx;
      moved.y += dy;
      break;
    case 'hline':
    case 'vline':
      moved.x += dx;
      moved.y += dy;
      // Die zweite Linie eines Paars laeuft auf ihrer Achse mit.
      if (moved.to != null) moved.to += moved.tool === 'hline' ? dy : dx;
      break;
    case 'rect':
    case 'ellipse':
    case 'arrow':
      moved.x1 += dx;
      moved.y1 += dy;
      moved.x2 += dx;
      moved.y2 += dy;
      break;
    case 'pen':
      moved.strokes = (moved.strokes ?? []).map((stroke) =>
        stroke.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      );
      break;
  }
  return moved as T;
}

/**
 * Laesst sich die Markierung verschieben? Element-Marker nicht: ihre Box ist
 * die gemessene Bounding-Box des markierten DOM-Elements — verschoben wuerde
 * sie etwas anderes umranden, als das Label und der Selektor behaupten.
 */
export function isMovableShape(shape: Shape): boolean {
  return shape.tool !== 'element';
}

/**
 * Liegt der Punkt auf der Markierung (Dokumentraum)? Getroffen wird die
 * *Kontur*, nicht die Flaeche — sonst liesse sich in einem Rahmen nichts
 * Neues mehr zeichnen, ohne ihn zu verschieben.
 */
export function hitsShape(shape: Shape, p: Point, tol = 8): boolean {
  switch (shape.tool) {
    case 'pin':
    case 'text':
      return withinBounds(shape, p, tol);
    case 'element':
    case 'rect':
      return onRectOutline(shapeBounds(shape)!, p, tol);
    case 'ellipse': {
      const b = shapeBounds(shape)!;
      const rx = b.w / 2;
      const ry = b.h / 2;
      if (rx < 1 || ry < 1) return withinBounds(shape, p, tol);
      // Normierter Abstand zur Ellipsenkontur — grob, aber fuer den Griff genug.
      const nx = (p.x - (b.x + rx)) / rx;
      const ny = (p.y - (b.y + ry)) / ry;
      const d = Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
      return d <= tol;
    }
    case 'arrow':
      return (
        distToSegment(p, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <= tol
      );
    case 'hline':
      return (
        Math.abs(p.y - shape.y) <= tol || (shape.to != null && Math.abs(p.y - shape.to) <= tol)
      );
    case 'vline':
      return (
        Math.abs(p.x - shape.x) <= tol || (shape.to != null && Math.abs(p.x - shape.to) <= tol)
      );
    case 'pen':
      return (shape.strokes ?? []).some((stroke) => minDistToStroke(p, stroke) <= tol);
  }
}

function withinBounds(shape: Shape, p: Point, tol: number): boolean {
  const b = shapeBounds(shape);
  return (
    b != null &&
    p.x >= b.x - tol &&
    p.x <= b.x + b.w + tol &&
    p.y >= b.y - tol &&
    p.y <= b.y + b.h + tol
  );
}

/** Punkt nahe am Rahmen (nicht in der Flaeche) einer Box? */
function onRectOutline(
  b: { x: number; y: number; w: number; h: number },
  p: Point,
  tol: number,
): boolean {
  const inOuter =
    p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  if (!inOuter) return false;
  const inInner =
    p.x > b.x + tol && p.x < b.x + b.w - tol && p.y > b.y + tol && p.y < b.y + b.h - tol;
  return !inInner;
}

let shapeCounter = 0;
/** Global eindeutig — die Ids landen persistent im Feedback-Store. */
export function shapeId(): string {
  shapeCounter += 1;
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${shapeCounter}`;
}
