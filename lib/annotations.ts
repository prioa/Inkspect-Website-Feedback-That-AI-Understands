/**
 * Korrektur-Markierungen pro Device-Frame. Koordinaten liegen im
 * *Dokumentraum* des Frames (CSS-Pixel inkl. Scroll-Offset zum Zeitpunkt des
 * Zeichnens) — so bleiben die Markierungen beim Scrollen am Inhalt kleben.
 */

export type Tool = 'element' | 'pin' | 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text';

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

export interface TextShape extends ElementRef {
  id: string;
  tool: 'text';
  color: string;
  x: number;
  y: number;
  text: string;
}

export type Shape = ElementShape | PinShape | PenShape | BoxShape | TextShape;

export const ANNOTATION_COLORS = ['#ff5d5d', '#ffb340', '#3ecf6e', '#5b8cff'] as const;

export const TOOL_LABELS: Record<Tool, string> = {
  element: 'Mark element',
  pin: 'Comment pin',
  pen: 'Freehand',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
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

let shapeCounter = 0;
/** Global eindeutig — die Ids landen persistent im Feedback-Store. */
export function shapeId(): string {
  shapeCounter += 1;
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${shapeCounter}`;
}
