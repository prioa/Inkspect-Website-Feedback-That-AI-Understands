/**
 * Correction markings, per device frame. Coordinates live in the frame's
 * *document space* (CSS pixels including the scroll offset at the time of
 * drawing) — that way the markings stay stuck to the content while scrolling.
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

/** The palette additionally knows the interaction mode (no drawing). */
export type PaletteTool = Tool | 'interact';

export interface Point {
  x: number;
  y: number;
}

/**
 * One click on the way to a hidden element (burger, accordion header, "Next"
 * in a form). Several steps make up the path that unfolded the element.
 */
export interface RevealStep {
  /** Shadow path of the opener, joined by ' >>> ' — like `anchor`/`selector`. */
  sel: string;
  /** Short label for the panel and the export (`button#menuBtn`). */
  label?: string;
}

/**
 * A marking's DOM reference: CSS path (shadow segments joined by ' >>> ') and
 * short label of the element under or behind the marking. Makes exports
 * locatable in the source.
 */
export interface ElementRef {
  anchor?: string;
  anchorLabel?: string;
  /** Every element crossed (freehand), selectors in order of relevance. */
  anchors?: string[];
  /**
   * Document coordinates of the anchor element's top-left corner at drawing
   * time. After a reload the anchor is resolved again; the difference from
   * this original position moves the marking, so that it sticks to the element
   * rather than to an absolute spot (accordion open/closed, menu open).
   * Missing in old data — the marking then stays where it is.
   */
  anchorX?: number;
  anchorY?: number;
  /**
   * The click path that made the anchor element visible (burger → submenu),
   * oldest step first. It is only replayed when the element is invisible at
   * fly-to or capture time — for a visible element not a single step runs.
   * That is precisely why the path may be recorded unfiltered. Missing in old
   * data and for anything that was visible without an interaction.
   */
  reveal?: RevealStep[];
}

/** A style change proposed by the element picker (target value for the feedback). */
export interface StyleChange {
  /** CSS property, e.g. `padding-top` or the shorthand `margin`. */
  prop: string;
  /** Starting value (`8px`). */
  from: string;
  /** Target value (`12px`). */
  to: string;
}

/**
 * Text of the marked element as changed in the element picker (target value
 * for the feedback). Only affects the direct text node — child elements are
 * left untouched.
 */
export interface TextChange {
  /** Original text on the page. */
  from: string;
  /** Proposed text. */
  to: string;
}

/** The four sides of a box (top/right/bottom/left) — values in CSS pixels. */
export interface BoxEdges<T = number> {
  t: T;
  r: T;
  b: T;
  l: T;
}

/** Bounding box, label, CSS path and box model of the element under the cursor (document space). */
export interface ElementTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  selector: string;
  margin: BoxEdges;
  padding: BoxEdges;
}

/**
 * The picker's pinned element: like `ElementTarget`, plus the live DOM
 * reference (for live edits via `element.style`) and the font state. Font only
 * becomes editable when the element contains direct text.
 */
export interface SelectedTarget extends ElementTarget {
  el: HTMLElement;
  /** Tag name in lower case (`h1`, `p`, `span`) — shown next to the text field. */
  tag: string;
  /**
   * Sides whose margin is `auto` in the CSS. Measuring only yields the
   * *computed* value there (with `margin: 0 auto`, half the remaining width) —
   * writing that back as a number replaces the centring with a fixed value.
   */
  autoMargin: BoxEdges<boolean>;
  /** The `max-width` in effect, in px — null when there is none or it is not px. */
  maxWidth: number | null;
  /** Raw `max-width` value (`80%`, `60ch`) — null when unconstrained. */
  maxWidthRaw: string | null;
  fontWeight: number;
  fontSize: number;
  /** Has a direct text child — then font sliders and the text field make sense. */
  hasText: boolean;
  /** The element's current text (trimmed) — editable in the popup. */
  text: string;
}

/**
 * A DOM element marked via the element picker: its bounding box at the time of
 * the click, plus a readable label (`button#menuBtn`) for the panel.
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
  /** CSS path of the marked element (missing in old data). */
  selector?: string;
  /**
   * Like `ElementRef.reveal` — repeated here because `ElementShape`
   * deliberately does not inherit from `ElementRef`: an element marker carries
   * `selector`, not `anchor`, and with both the export would have to guess
   * which one applies.
   */
  reveal?: RevealStep[];
  /** Optional free text for the marker. */
  note?: string;
  /** Style changes made in the picker — listed as target values in the feedback. */
  styleChanges?: StyleChange[];
  /** Text of the element as changed in the picker — also a target value. */
  textChange?: TextChange;
  /** What the changes refer to: a class selector (`.card`) or the element. */
  styleTarget?: string;
  styleScope?: 'class' | 'element';
  /**
   * Scope of the *text* change. Kept separate from `styleScope`, because old
   * data has none — and its text always affected this one element only. When
   * the value is missing, that is what it stays.
   */
  textScope?: 'class' | 'element';
  /**
   * Shared id of the element markers replicated across all devices — note
   * changes travel through it to every copy.
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
 * Freehand correction. Several strokes that cross or overlap merge into one
 * shape — a strike-through made of three strokes is *one* correction, not
 * three.
 */
export interface PenShape extends ElementRef {
  id: string;
  tool: 'pen';
  color: string;
  strokes: Point[][];
  /** Optional free text for the marker. */
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
  /** Optional free text for the marker. */
  note?: string;
}

/**
 * A guide line across the frame's entire width (`hline`, horizontal at `y`) or
 * height (`vline`, vertical at `x`). Only the relevant axis carries
 * information; the other is extended past the edge when rendering.
 *
 * Dragging on after the click produces a *second* line at `to` (a y value for
 * `hline`, an x value for `vline`) — the pair measures the distance between
 * them, for gaps between two edges, say.
 */
export interface LineShape extends ElementRef {
  id: string;
  tool: 'hline' | 'vline';
  color: string;
  x: number;
  y: number;
  /** Second line on the relevant axis — missing for a single line. */
  to?: number;
  /** Optional free text for the marker. */
  note?: string;
}

/** Distance between the two lines of a pair (document pixels), otherwise null. */
export function lineGap(shape: LineShape): number | null {
  if (shape.to == null) return null;
  return Math.abs(shape.to - (shape.tool === 'hline' ? shape.y : shape.x));
}

/**
 * A marking's dimensions as short text for the panel (`320 × 48 px`, `24 px`)
 * — the same number the overlay shows at the marker. Point-like markings (pin,
 * text, freehand) have no dimensions.
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
 * Half the length by which guide lines are drawn past their anchor point —
 * large enough to span any frame at any scroll position; the SVG viewport
 * clips the overhang.
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

/**
 * Order of the tools in the bar and the palette — and at the same time the
 * assignment of the number keys. Every tool is available to everyone.
 */
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

/**
 * The default colour is a muted pencil blue, not a warning red: the markings
 * should read like a note on a printout rather than shouting the page down.
 * Deliberately mid-brightness — so it stands out on light and dark pages
 * alike. The remaining colours are there for sorting things into groups.
 */
export const ANNOTATION_COLORS = ['#6d8cc0', '#ffb340', '#3ecf6e', '#5b8cff'] as const;

/** The former default colour (warning red) — existing markings follow along. */
export const LEGACY_DEFAULT_COLOR = '#ff5d5d';

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
 * Do two freehand strokes count as one correction? Yes, when segments cross or
 * the strokes run closer than `threshold` document pixels to each other.
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

/** Short, readable label of a DOM element: tag#id or tag.class. */
export function elementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const classes = [...el.classList].slice(0, 2).join('.');
  return classes ? `${tag}.${classes}` : tag;
}

/** Sequence numbers of a frame's pins, in drawing order. */
export function pinNumbers(shapes: Shape[]): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const s of shapes) {
    if (s.tool === 'pin') map.set(s.id, ++n);
  }
  return map;
}

/**
 * Shadow path of the element the marking hangs on. Element markers carry it as
 * `selector`, every other tool as `anchor` — the distinction belongs in *one*
 * place, not in every caller.
 */
export function shapeSelector(shape: Shape): string | undefined {
  return shape.tool === 'element' ? shape.selector : shape.anchor;
}

/** The marking's unfold path, independent of the tool. */
export function shapeReveal(shape: Shape): RevealStep[] | undefined {
  const steps = shape.reveal;
  return steps && steps.length > 0 ? steps : undefined;
}

/** The point to head for in order to see the marking (document space). */
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

/** Bounding rectangle of a marking in document space (hover/flash). */
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
    // A narrow band along the line — hover and double-click hit it along its
    // whole length.
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
      // Text width roughly estimated — enough for hover hits and the flash.
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
 * Move a marking by (dx, dy) in document space. The DOM anchor is left
 * unchanged — it describes the original position of the anchor element, not
 * that of the marking.
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
      // The second line of a pair travels along on its axis.
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
 * Can the marking be moved? Element markers cannot: their box is the measured
 * bounding box of the marked DOM element — moved, it would outline something
 * other than what the label and the selector claim.
 */
export function isMovableShape(shape: Shape): boolean {
  return shape.tool !== 'element';
}

/**
 * Is the point on the marking (document space)? What is hit is the *outline*,
 * not the area — otherwise nothing new could be drawn inside a frame without
 * moving it.
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
      // Normalised distance to the ellipse outline — rough, but enough to grab it.
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

/** Point near the frame of a box (not in its area)? */
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
/** Globally unique — the ids end up persisted in the feedback store. */
export function shapeId(): string {
  shapeCounter += 1;
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${shapeCounter}`;
}
