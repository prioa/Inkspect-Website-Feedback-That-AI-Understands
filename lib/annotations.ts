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
  /** Optionaler Freitext zum Marker. */
  note?: string;
}

export interface PinShape {
  id: string;
  tool: 'pin';
  color: string;
  x: number;
  y: number;
  text: string;
}

export interface PenShape {
  id: string;
  tool: 'pen';
  color: string;
  points: Point[];
  /** Optionaler Freitext zum Marker. */
  note?: string;
}

export interface BoxShape {
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

export interface TextShape {
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
  element: 'Element markieren',
  pin: 'Kommentar-Pin',
  pen: 'Freihand',
  rect: 'Rechteck',
  ellipse: 'Ellipse',
  arrow: 'Pfeil',
  text: 'Text',
};

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
