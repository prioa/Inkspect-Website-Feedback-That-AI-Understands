import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type {
  BoxEdges,
  BoxShape,
  ElementRef,
  ElementShape,
  ElementTarget,
  Point,
  SelectedTarget,
  Shape,
  StyleChange,
  TextChange,
  Tool,
} from '@/lib/annotations';
import {
  LINE_REACH,
  elementLabel,
  hitsShape,
  isMovableShape,
  lineGap,
  pinNumbers,
  TOOL_LABELS,
  shapeBounds,
  shapeFocusPoint,
  shapeId,
  translateShape,
} from '@/lib/annotations';
import { findByShadowPath, shadowPath } from '@/lib/selector';
import { IconClose, IconEditPen } from './icons';
import { InspectPanel } from './InspectPanel';
import type { Edge, LinkedSides, SpacingKind } from './InspectPanel';

interface Props {
  /** Logical viewport size of the frame (unscaled). */
  width: number;
  height: number;
  zoom: number;
  /** Only in mark-up mode does the overlay catch pointer events. */
  active: boolean;
  shapes: Shape[];
  /**
   * Element markers whose saved CSS changes stay applied — regardless of
   * whether the markers (the red frames) are visible. That way you can *see*
   * the correction in dev mode without showing the markings. Falls back to
   * `shapes` when not set.
   */
  styleShapes?: Shape[];
  /**
   * Whether the "My edits" switch is currently on. When saving, that
   * decides whether the values dialled in the popup may stay on the page (the
   * marker takes them over) or disappear along with the popup — otherwise a
   * change would stick to the page that the switch does not even show.
   */
  stylesApplied?: boolean;
  /** Shape ids of completed entries — rendered dimmed, without a note bubble. */
  dimmedIds?: Set<string>;
  /**
   * Shape ids of foreign (imported) markings — those cannot be moved, only your
   * own can.
   */
  lockedIds?: Set<string>;
  tool: Tool;
  color: string;
  frameEl: HTMLIFrameElement | null;
  /** Counts frame loads — the scroll listener has to reattach then. */
  loadCount: number;
  /**
   * Counts every unfold of a hidden element. Otherwise remeasuring the element
   * markers hangs off scrolling alone — a slideout that opens without a scroll
   * would leave the markers standing on their old boxes.
   */
  revealNonce?: number;
  /**
   * Render notes as speech bubbles directly in the overlay — on during the
   * screenshot export, so that the text stands at the right point in the image.
   * Independently of this, the note appears on hovering the marker.
   */
  showNotes?: boolean;
  /** The marker just flown to by a panel click — pulses briefly. */
  flashShapeId?: string | null;
  /** Changes per flash — restarts the CSS animation. */
  flashNonce?: number;
  /**
   * A marking just finished while markers are hidden — it stays briefly and
   * then fades out softly, rather than disappearing abruptly.
   */
  fadingShapeId?: string | null;
  /** The marker whose panel entry is being hovered — highlight it quietly. */
  hoverShapeId?: string | null;
  /** Double-click on a marker (App): open the note editor with its text. */
  editRequest?: NoteEditRequest | null;
  /** Right-click in the frame (app): pin the element under the cursor + popup. */
  pickRequest?: ElementPickRequest | null;
  onAdd: (shape: Shape) => void;
  onSetNote: (shapeId: string, note: string) => void;
  /**
   * Take over later changes to an element marker — the popup can be reopened by
   * clicking the marked element.
   */
  onUpdateShape?: (shapeId: string, patch: ElementShapePatch) => void;
  /** Delete a marking (the app takes care of the confirmation). */
  onDeleteShape?: (shapeId: string) => void;
  /** Take on a marking that was moved (offset in document space). */
  onMoveShape?: (shapeId: string, dx: number, dy: number) => void;
  /** Take over the new corner points of a resized box. */
  onResizeShape?: (
    shapeId: string,
    box: { x1: number; y1: number; x2: number; y2: number },
  ) => void;
  /**
   * Set the gap of a line pair (null = a single line). This only goes into the
   * UI state; saving happens through `onCommitShape` when the field loses
   * focus — otherwise every keystroke would write into the store.
   */
  onSetLineGap?: (shapeId: string, gap: number | null) => void;
  /** Save a marking as it currently stands. */
  onCommitShape?: (shapeId: string) => void;
}

/** Fields that may change when an element marker is saved again. */
export type ElementShapePatch = Partial<
  Pick<
    ElementShape,
    | 'x'
    | 'y'
    | 'w'
    | 'h'
    | 'note'
    | 'styleChanges'
    | 'styleTarget'
    | 'styleScope'
    | 'textChange'
    | 'textScope'
  >
>;

/** A pick requested by the app (a right-click in the frame). */
export interface ElementPickRequest {
  /** Click point in the frame viewport coordinates (unscaled). */
  x: number;
  y: number;
  /** Counts per right-click — picks the same spot again too. */
  nonce: number;
}

/** An edit requested by the app (a double-click in the frame). */
export interface NoteEditRequest {
  shapeId: string;
  /** Click point in document coordinates — the editor appears there. */
  x: number;
  y: number;
  /** Counts per double-click — reopens the editor as well. */
  nonce: number;
}

interface TextDraft {
  x: number;
  y: number;
  value: string;
}

/** Open note editor for the marker last placed or double-clicked. */
interface NoteDraft {
  shapeId: string;
  /** Anchor point in document coordinates. */
  x: number;
  y: number;
  value: string;
  /**
   * The text at opening time (an edit session via double-click). Once set, the
   * commit may also empty it; when creating, "empty" simply means "no note".
   */
  initial?: string;
}

/** Bounding box in document space (live measurement of an element marker). */
interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_DRAG = 3;
/** Tolerance around the marker box for the note hover (document pixels). */
const HOVER_PAD = 8;

/**
 * Hand-drawn frames ("comic style") rather than clean rectangles. Ports the CSS
 * original to SVG: per corner a *pair* of radii (horizontal/vertical) that
 * differ strongly — one corner runs almost the whole edge, the opposite one
 * stays sharp. Plus uneven stroke weights (heavier on the left and at the
 * bottom, as if drawn with a brush) and a slight rotation.
 *
 * Percentages as in CSS: horizontal radii refer to the width, vertical ones to
 * the height — clockwise from the top left in each case.
 */
interface SketchVariant {
  /** [TL, TR, BR, BL] — fraction of the width. */
  rx: [number, number, number, number];
  /** [TL, TR, BR, BL] — fraction of the height. */
  ry: [number, number, number, number];
  /** The sides drawn more strongly. */
  heavy: ReadonlyArray<'top' | 'right' | 'bottom' | 'left'>;
  /** Leichte Schieflage in Grad. */
  tilt: number;
}

const SKETCH_VARIANTS: readonly SketchVariant[] = [
  { rx: [0.95, 0.04, 0.92, 0.05], ry: [0.04, 0.95, 0.06, 0.95], heavy: ['left'], tilt: 1.2 },
  { rx: [0.04, 0.95, 0.06, 0.95], ry: [0.95, 0.04, 0.92, 0.05], heavy: ['bottom', 'left'], tilt: -1.2 },
  { rx: [0.95, 0.04, 0.97, 0.05], ry: [0.04, 0.94, 0.03, 0.95], heavy: ['top', 'left'], tilt: 1.2 },
];

/**
 * Below this edge length (document pixels) the large rounding would no longer
 * be legible — there a discreetly skewed box remains.
 */
const SKETCH_MIN = 26;

/** A stable variant per marking: the same id always yields the same shape. */
function sketchVariantOf(id: string): SketchVariant {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return SKETCH_VARIANTS[Math.abs(hash) % SKETCH_VARIANTS.length]!;
}

interface SketchPaths {
  /** Geschlossene Kontur. */
  outline: string;
  /** Only the strong sides — a second, thicker stroke on top. */
  heavy: string;
  /** Rotation in degrees about the centre of the box. */
  tilt: number;
}

/**
 * Builds the paths of a hand-drawn frame. Overlapping radii are scaled down
 * proportionally as in CSS, or the arcs of neighbouring corners would intersect
 * on a short edge.
 */
function sketchRect(
  x: number,
  y: number,
  w: number,
  h: number,
  variant: SketchVariant,
): SketchPaths {
  const tiny = w < SKETCH_MIN || h < SKETCH_MIN;
  // Boxes that are too small: pull the rounding back sharply, the skew stays.
  const damp = tiny ? 0.12 : 1;
  /**
   * A deliberate departure from the CSS original: there the boxes are square,
   * so a radius of 95% of the width looks good. A marking around a 900x44
   * element would become a lens that way — the element's corners would lie
   * outside it. The shorter edge therefore caps every radius; the handwriting
   * (one sweeping corner, the opposite one sharp) is preserved.
   */
  const cap = Math.min(w, h) * 0.9;
  const rx = variant.rx.map((v) => Math.min(v * damp * w, cap));
  const ry = variant.ry.map((v) => Math.min(v * damp * h, cap));

  // CSS rule: if two radii do not fit on their shared edge, *all* of them are
  // scaled down by the same factor.
  const ratio = (extent: number, a: number, b: number) => (a + b <= 0 ? 1 : extent / (a + b));
  const f = Math.min(
    1,
    ratio(w, rx[0]!, rx[1]!),
    ratio(h, ry[1]!, ry[2]!),
    ratio(w, rx[2]!, rx[3]!),
    ratio(h, ry[3]!, ry[0]!),
  );
  const [tlx, trx, brx, blx] = rx.map((v) => v * f) as [number, number, number, number];
  const [tly, try_, bry, bly] = ry.map((v) => v * f) as [number, number, number, number];

  const r = x + w;
  const b = y + h;
  const p = (px: number, py: number) => `${px.toFixed(2)},${py.toFixed(2)}`;
  const topStart = p(x + tlx, y);
  const topEnd = p(r - trx, y);
  const rightStart = p(r, y + try_);
  const rightEnd = p(r, b - bry);
  const bottomStart = p(r - brx, b);
  const bottomEnd = p(x + blx, b);
  const leftStart = p(x, b - bly);
  const leftEnd = p(x, y + tly);
  const arc = (ax: number, ay: number, to: string) =>
    `A${ax.toFixed(2)},${ay.toFixed(2)} 0 0 1 ${to}`;

  const sides = {
    top: `M${topStart}L${topEnd}${arc(trx, try_, rightStart)}`,
    right: `M${rightStart}L${rightEnd}${arc(brx, bry, bottomStart)}`,
    bottom: `M${bottomStart}L${bottomEnd}${arc(blx, bly, leftStart)}`,
    left: `M${leftStart}L${leftEnd}${arc(tlx, tly, topStart)}`,
  } as const;

  return {
    outline:
      `M${topStart}L${topEnd}${arc(trx, try_, rightStart)}` +
      `L${rightEnd}${arc(brx, bry, bottomStart)}` +
      `L${bottomEnd}${arc(blx, bly, leftStart)}` +
      `L${leftEnd}${arc(tlx, tly, topStart)}Z`,
    heavy: variant.heavy.map((side) => sides[side]).join(''),
    tilt: variant.tilt,
  };
}

/** How strongly a marking is currently highlighted. */
type Emphasis = 'none' | 'hover' | 'drag';

/**
 * Markings that show hover and dragging in their own frame — the box markings.
 * They need no second box around them, whether their frame is hand-drawn
 * (rectangle) or plain (element).
 */
function drawsOwnEmphasis(shape: Shape): boolean {
  return shape.tool === 'rect' || shape.tool === 'element';
}

/**
 * Keep the action buttons inside the visible frame (screen pixels). `margin` is
 * half the extent of the bar — it is centred on its point.
 */
function clampAct(value: number, extent: number, margin: number): number {
  const max = Math.max(margin, extent - margin);
  return Math.max(Math.min(value, max), Math.min(margin, max));
}

function actionAnchor(shape: Shape): Point {
  if (shape.tool === 'hline' || shape.tool === 'vline') return shapeFocusPoint(shape);
  const b = shapeBounds(shape);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : shapeFocusPoint(shape);
}

/**
 * Outline weight of the markings in screen pixels. Deliberately thin: the
 * frames should enclose the content, not cover it — the colour carries the
 * message, not the thickness.
 */
const STROKE_PX = 1.6;
/** Freehand stays heavier — a hair-thin scribble looks shaky. */
const PEN_STROKE_PX = 2.4;
/** Corner radius of the frames, in screen pixels. */
const CORNER_PX = 5;

/**
 * Handles on a rectangle or ellipse. The shorthand names the edges the
 * handle drags (`nw` = top left, `e` = right edge).
 */
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Catch radius of a handle, in screen pixels. */
const HANDLE_HIT = 9;

/** Cursor modifier of the overlay, per handle. */
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

/** Only boxes that were drawn out can be resized (not the arrow). */
function isResizable(shape: Shape): shape is BoxShape & { tool: 'rect' | 'ellipse' } {
  return shape.tool === 'rect' || shape.tool === 'ellipse';
}

function handlePos(b: { x: number; y: number; w: number; h: number }, id: HandleId): Point {
  return {
    x: id.includes('w') ? b.x : id.includes('e') ? b.x + b.w : b.x + b.w / 2,
    y: id.startsWith('n') ? b.y : id.startsWith('s') ? b.y + b.h : b.y + b.h / 2,
  };
}

/** The handle under the point (document space), or null. */
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

/** New corner points when `handle` is dragged to `p`. Crossing over is allowed. */
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
 * An invisible hit area along a marking's outline. Outside correction mode the
 * overlay as a whole catches no events (or the page could no longer be used) —
 * only these outlines do, so that markings can still be grabbed and scaled.
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
      // Point-sized: the whole area is the handle.
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

/** The visible section of the frame, in document coordinates. */
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Labels sit in document space but are screen elements: labels drawn at the
 * edge would otherwise lie outside the visible crop. Clamps the top-left corner
 * of a label box into `view`.
 */
function clampLabel(x: number, y: number, w: number, h: number, zoom: number, view?: View) {
  if (!view) return { x, y };
  const edge = 4 / zoom;
  return {
    x: Math.max(view.x + edge, Math.min(x, view.x + view.w - w - edge)),
    y: Math.max(view.y + edge, Math.min(y, view.y + view.h - h - edge)),
  };
}

/** elementFromPoint that descends into open shadow roots (web components). */
function deepElementFromPoint(doc: Document, x: number, y: number): Element | null {
  let el = doc.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

const numOf = (v: string) => Number.parseFloat(v) || 0;

/** Bounding box, label and box model of an element (document space). */
function measureTarget(el: Element, win: Window): ElementTarget {
  const r = el.getBoundingClientRect();
  const cs = win.getComputedStyle(el);
  return {
    x: r.left + win.scrollX,
    y: r.top + win.scrollY,
    w: r.width,
    h: r.height,
    label: elementLabel(el),
    selector: shadowPath(el).join(' >>> '),
    margin: { t: numOf(cs.marginTop), r: numOf(cs.marginRight), b: numOf(cs.marginBottom), l: numOf(cs.marginLeft) },
    padding: { t: numOf(cs.paddingTop), r: numOf(cs.paddingRight), b: numOf(cs.paddingBottom), l: numOf(cs.paddingLeft) },
  };
}

/**
 * The longest direct text node with content. Only that gets edited: simply
 * setting `textContent` would throw away child elements (icons, <span>) along
 * with it.
 */
function directTextNode(el: Element): Text | null {
  let best: Text | null = null;
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const len = n.textContent?.trim().length ?? 0;
    if (len === 0) continue;
    if (!best || len > (best.textContent?.trim().length ?? 0)) best = n as Text;
  }
  return best;
}

/** A direct, non-empty text child? Only then do font controls and a text field make sense. */
function hasDirectText(el: Element): boolean {
  return directTextNode(el) != null;
}

/** Visible text of the element, without the indentation from the source. */
function directTextOf(el: Element): string {
  return directTextNode(el)?.textContent?.trim() ?? '';
}

/**
 * Replace the element's text. The node's surrounding spaces stay — otherwise
 * the text sticks to neighbouring inline elements.
 */
function writeDirectText(el: Element, value: string): void {
  const node = directTextNode(el);
  if (!node) return;
  const raw = node.textContent ?? '';
  const lead = /^\s*/.exec(raw)![0];
  const tail = /\s*$/.exec(raw)![0];
  node.textContent = `${lead}${value}${tail}`;
}

/** Properties editable from the popup — for the reset in both scopes. */
const EDITABLE_PROPS = [
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-weight', 'font-size', 'max-width',
];

/** Class selector of the element (`.a.b`), escaped Tailwind-safely. */
function classSelectorOf(el: Element): string | null {
  const parts = Array.from(el.classList);
  if (parts.length === 0) return null;
  try {
    return parts.map((c) => `.${CSS.escape(c)}`).join('');
  } catch {
    return null;
  }
}

/**
 * Every element a change in the chosen scope hits. Element scope is exactly
 * one; class scope everything the selector finds in the document — the same set
 * the match count in the popup names.
 */
function scopeTargets(el: HTMLElement, doc: Document, useClass: boolean): HTMLElement[] {
  if (!useClass) return [el];
  const classSel = classSelectorOf(el);
  if (!classSel) return [el];
  try {
    const found = Array.from(doc.querySelectorAll<HTMLElement>(classSel));
    return found.length > 0 ? found : [el];
  } catch {
    return [el];
  }
}

/** A single CSS property plus its shorthand (`padding` → all four sides). */
function propsOf(prop: string): string[] {
  return prop === 'margin' || prop === 'padding'
    ? ALL_EDGES.map((e) => `${prop}-${e}`)
    : [prop];
}

/**
 * The original text per element, before the picker overwrote it.
 *
 * A style can be taken back by deleting the property — the page's CSS then
 * applies again. Text knows no such "nothing": whoever wants to take it back
 * has to know the old one. Under class scope every element hit has its *own*
 * old text; the marker only holds the one of the element clicked. Hence here,
 * per element and only at runtime — after a reload the original text is back in
 * the page anyway.
 */
const TEXT_ORIGINALS = new WeakMap<HTMLElement, string>();

/** Set the text across the whole scope, saving each original along the way. */
function writeScopedText(targets: HTMLElement[], value: string): void {
  for (const t of targets) {
    if (!TEXT_ORIGINALS.has(t)) TEXT_ORIGINALS.set(t, directTextOf(t));
    writeDirectText(t, value);
  }
}

/** The counterpart: every element gets its own original text back. */
function restoreScopedText(targets: HTMLElement[], fallback: string): void {
  for (const t of targets) {
    writeDirectText(t, TEXT_ORIGINALS.get(t) ?? fallback);
    TEXT_ORIGINALS.delete(t);
  }
}

const PICKER_STYLE_ID = '__dv-picker-css__';

/**
 * Returns the CSSStyleDeclaration of a rule managed by the picker in the frame
 * (class scope). A <style> of its own holds the rules; that way changes act
 * live on every element with that class, until reset or reload.
 */
function pickerRuleStyle(doc: Document, selector: string): CSSStyleDeclaration | null {
  let styleEl = doc.getElementById(PICKER_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = PICKER_STYLE_ID;
    doc.head?.append(styleEl);
  }
  const sheet = styleEl.sheet;
  if (!sheet) return null;
  for (let i = 0; i < sheet.cssRules.length; i++) {
    const rule = sheet.cssRules[i] as CSSStyleRule;
    if (rule.selectorText === selector) return rule.style;
  }
  try {
    const idx = sheet.insertRule(`${selector} {}`, sheet.cssRules.length);
    return (sheet.cssRules[idx] as CSSStyleRule).style;
  } catch {
    return null; // ungueltiger Selektor
  }
}

const MARGIN_PROPS = {
  t: 'margin-top',
  r: 'margin-right',
  b: 'margin-bottom',
  l: 'margin-left',
} as const;

/**
 * Which margin sides are set to `auto` in the CSS? `getComputedStyle` does not
 * give that away — for margins it returns the *used* value, so `margin: 0 auto`
 * becomes `448px` there. The Typed OM variant, by contrast, returns the
 * computed value and therefore `auto`. Where it does not exist (Firefox), the
 * fallback at least recognises horizontal centring from the geometry.
 */
function autoMarginSides(el: HTMLElement, win: Window): BoxEdges<boolean> {
  const out: BoxEdges<boolean> = { t: false, r: false, b: false, l: false };
  const map = (el as HTMLElement & { computedStyleMap?: () => StylePropertyMapReadOnly })
    .computedStyleMap?.();
  if (map) {
    for (const [side, prop] of Object.entries(MARGIN_PROPS) as [keyof BoxEdges, string][]) {
      try {
        out[side] = String(map.get(prop)) === 'auto';
      } catch {
        /* property not readable */
      }
    }
    return out;
  }
  const cs = win.getComputedStyle(el);
  const ml = numOf(cs.marginLeft);
  const mr = numOf(cs.marginRight);
  const parent = el.parentElement;
  if (!parent || ml <= 0 || Math.abs(ml - mr) > 1) return out;
  const pcs = win.getComputedStyle(parent);
  const inner = parent.clientWidth - numOf(pcs.paddingLeft) - numOf(pcs.paddingRight);
  // The element plus both margins fills the parent exactly -> auto-centred.
  if (Math.abs(inner - (el.offsetWidth + ml + mr)) < 2) {
    out.l = true;
    out.r = true;
  }
  return out;
}

/** The complete picker state, including the live DOM reference and font values. */
function buildSelected(el: HTMLElement, win: Window): SelectedTarget {
  const cs = win.getComputedStyle(el);
  const maxWidthRaw = cs.maxWidth && cs.maxWidth !== 'none' ? cs.maxWidth : null;
  return {
    ...measureTarget(el, win),
    el,
    tag: el.tagName.toLowerCase(),
    autoMargin: autoMarginSides(el, win),
    maxWidthRaw,
    // Only px are usable as a number; `80%` or `60ch` stay display only.
    maxWidth: maxWidthRaw?.endsWith('px') ? numOf(maxWidthRaw) : null,
    fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
    fontSize: numOf(cs.fontSize),
    hasText: hasDirectText(el),
    text: directTextOf(el),
  };
}

const ALL_EDGES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * Apply a marker's saved changes to the page again — on reopening the popup
 * (after a reload too) the preview then shows the target values again and can
 * be edited on from there.
 */
function applyStoredChanges(shape: ElementShape, el: HTMLElement, doc: Document): void {
  const useClass = (shape.styleScope ?? 'class') === 'class' && classSelectorOf(el) != null;
  // Text knows no rule — it is written into every element of the scope.
  // `textScope` is missing in old data: that only ever affected this element.
  if (shape.textChange) {
    writeScopedText(scopeTargets(el, doc, shape.textScope === 'class'), shape.textChange.to);
  }
  const changes = shape.styleChanges ?? [];
  if (changes.length === 0) return;
  const classSel = classSelectorOf(el);
  const target = useClass && classSel ? pickerRuleStyle(doc, classSel) : el.style;
  for (const c of changes) {
    for (const p of propsOf(c.prop)) target?.setProperty(p, c.to, 'important');
  }
}

/**
 * The counterpart to `applyStoredChanges` — takes the properties back again.
 * Clearing happens in *both* possible targets (inline style and class rule),
 * not only in the saved scope: anyone who switched while editing would
 * otherwise leave a value behind that nothing clears afterwards — the change
 * would then stick to the page even though the "My edits" switch was off.
 */
function removeStoredChanges(shape: ElementShape, el: HTMLElement, doc: Document): void {
  if (shape.textChange) {
    restoreScopedText(
      scopeTargets(el, doc, shape.textScope === 'class'),
      shape.textChange.from,
    );
  }
  const changes = shape.styleChanges ?? [];
  if (changes.length === 0) return;
  const classSel = classSelectorOf(el);
  const targets = [el.style, classSel ? pickerRuleStyle(doc, classSel) : null];
  for (const c of changes) {
    for (const p of propsOf(c.prop)) for (const t of targets) t?.removeProperty(p);
  }
}

/**
 * Take only the pending changes out of both targets — and no further property.
 * The coarse version (`clearPickerProps`) would also hit values the page itself
 * set inline; merely closing the popup must not break anything nobody touched.
 */
function clearPendingProps(el: HTMLElement, doc: Document, pending: StyleChange[]): void {
  if (pending.length === 0) return;
  const classSel = classSelectorOf(el);
  const rule = classSel ? pickerRuleStyle(doc, classSel) : null;
  for (const c of pending) {
    for (const p of propsOf(c.prop)) {
      el.style.removeProperty(p);
      rule?.removeProperty(p);
    }
  }
}

/**
 * Take away everything the popup itself may have written — in both targets. The
 * coarse broom behind "Reset": there, clearing out is the intention.
 */
function clearPickerProps(el: HTMLElement, doc: Document): void {
  const classSel = classSelectorOf(el);
  const rule = classSel ? pickerRuleStyle(doc, classSel) : null;
  for (const p of EDITABLE_PROPS) {
    el.style.removeProperty(p);
    rule?.removeProperty(p);
  }
}

/**
 * Starting values for the change list on reopening: the current measurement,
 * overwritten with the marker's saved before-values — the diff therefore keeps
 * running against the unchanged original, not against intermediate states.
 */
function originalsFromStored(
  sel: SelectedTarget,
  changes: StyleChange[],
  textChange?: TextChange,
) {
  const orig = {
    margin: { ...sel.margin },
    padding: { ...sel.padding },
    fontWeight: sel.fontWeight,
    fontSize: sel.fontSize,
    maxWidth: sel.maxWidth,
    text: textChange?.from ?? sel.text,
  };
  for (const c of changes) {
    const v = Number.parseFloat(c.from) || 0;
    if (c.prop === 'margin' || c.prop === 'padding') {
      orig[c.prop] = { t: v, r: v, b: v, l: v };
    } else if (c.prop.startsWith('margin-') || c.prop.startsWith('padding-')) {
      const [kind, edge] = c.prop.split('-') as ['margin' | 'padding', string];
      orig[kind][edge[0] as 't' | 'r' | 'b' | 'l'] = v;
    } else if (c.prop === 'font-weight') {
      orig.fontWeight = Number.parseInt(c.from, 10) || 400;
    } else if (c.prop === 'font-size') {
      orig.fontSize = v;
    } else if (c.prop === 'max-width') {
      orig.maxWidth = c.from === 'none' ? null : v;
    }
  }
  return orig;
}

export function AnnotationOverlay({
  width,
  height,
  zoom,
  active,
  shapes,
  styleShapes,
  stylesApplied = true,
  dimmedIds,
  lockedIds,
  tool,
  color,
  frameEl,
  loadCount,
  revealNonce = 0,
  showNotes = false,
  flashShapeId = null,
  flashNonce = 0,
  fadingShapeId,
  hoverShapeId = null,
  editRequest = null,
  pickRequest = null,
  onAdd,
  onSetNote,
  onUpdateShape,
  onDeleteShape,
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
   * The element pinned by a click — it stays put, so that its box model
   * (margin/padding) and possibly the font can be edited live in the popup.
   */
  const [selected, setSelected] = useState<SelectedTarget | null>(null);
  /**
   * Does a change target the whole class (the default, acting on every element
   * with that class) or only the single element?
   */
  const [scope, setScope] = useState<'class' | 'element'>('class');
  /**
   * Edit all four sides together — separately for margin and padding, because
   * usually only one of the two is kept even.
   */
  const [linked, setLinked] = useState<LinkedSides>({ margin: false, padding: false });
  /** Note draft in the popup — saved with the marker when taking it over. */
  const [popupNote, setPopupNote] = useState('');
  /**
   * Text field of the popup. Its own state rather than read straight from the
   * DOM: when writing back, the measurement trims, and a typed space would
   * otherwise disappear in the middle of a word. Null = no text on the element.
   */
  const [textEdit, setTextEdit] = useState<string | null>(null);
  /** A reopened element marker — saving updates it instead of creating a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Popup position chosen by the user by dragging (viewport pixels) — null = automatic. */
  const [popupPos, setPopupPos] = useState<Point | null>(null);
  const [popupDragging, setPopupDragging] = useState(false);
  /** A drag under way on the popup header (grip relative to the popup corner). */
  const popupDragRef = useRef<{ dx: number; dy: number; pointerId: number } | null>(null);
  /**
   * The measured popup size — so that placement clamps against the *real* edge
   * and not against estimated constants. The initial value corresponds to the
   * panel with a text, font and note field.
   */
  // The initial estimate matches the Content tab — the ResizeObserver below
  // corrects to the real size immediately.
  const [popupSize, setPopupSize] = useState({ w: 300, h: 340 });
  const popupObsRef = useRef<ResizeObserver | null>(null);
  /** Starting values when pinning — the basis for the change list in the feedback. */
  const originalRef = useRef<{
    margin: BoxEdges;
    padding: BoxEdges;
    fontWeight: number;
    fontSize: number;
    maxWidth: number | null;
    text: string;
  } | null>(null);
  /**
   * Cursor position (document space) for the line preview: as soon as the tool
   * is chosen, the line travels along semi-transparently, and the click then
   * places it exactly there.
   */
  const [lineGhost, setLineGhost] = useState<Point | null>(null);
  /**
   * The marking currently hanging off the mouse. It is only moved in the store
   * on release — during the drag the overlay shows the offset.
   */
  /** Your own marking under the cursor — the cursor becomes a grabber and the
   *  marker gets a grab frame. */
  const [grabId, setGrabId] = useState<string | null>(null);
  const [movingShape, setMovingShape] = useState<{
    id: string;
    dx: number;
    dy: number;
    from: Point;
  } | null>(null);
  /** The handle under the cursor (marking + corner) — shows the resize cursor. */
  const [hoverHandle, setHoverHandle] = useState<{ id: string; handle: HandleId } | null>(null);
  /**
   * A resize in progress. As with moving, only the UI state travels along
   * during the drag; saving happens on release.
   */
  const [resizing, setResizing] = useState<{
    id: string;
    handle: HandleId;
    box: { x1: number; y1: number; x2: number; y2: number };
  } | null>(null);

  /**
   * Live geometry of the element markers (document coordinates), remeasured
   * when the layout changes — above all when the saved CSS changes are switched
   * on or off: the page reflows then, and the red frame should stay stuck to
   * the element rather than to its original spot.
   */
  const [elemRects, setElemRects] = useState<Record<string, BoxRect>>({});

  /**
   * The follow-up for everything except element markers: the distance their
   * anchor element has travelled since being drawn. A pin on a menu item would
   * otherwise hang off fixed document coordinates and sit beside it as soon as
   * the menu opens differently at another frame width.
   *
   * Display only — the stored shape is untouched. The offset is formed fresh in
   * every measuring pass from (current anchor position − stored original
   * position) and never accumulated; it therefore cannot be applied twice.
   */
  const [anchorShift, setAnchorShift] = useState<Record<string, Point>>({});

  const displayShapes: Shape[] = shapes.map((s) => {
    if (s.tool === 'element') return elemRects[s.id] ? { ...s, ...elemRects[s.id] } : s;
    const shift = anchorShift[s.id];
    return shift ? translateShape(s, shift.x, shift.y) : s;
  });
  const dimmed = dimmedIds;

  /** Our own marking — imported ones stay where their author put them. */
  const mine = (s: Shape) => isMovableShape(s) && !lockedIds?.has(s.id);

  // No stale hover frame when the tool or mode changes. Release the pinned
  // element too — the DOM reference only applies in the element tool.
  useEffect(() => {
    setPicked(null);
    setSelected(null);
    setEditingId(null);
    setPopupNote('');
    setTextEdit(null);
    setLineGhost(null);
  }, [tool, active]);

  // A frame reload invalidates the pinned element's DOM reference.
  useEffect(() => {
    setSelected(null);
    setEditingId(null);
  }, [loadCount]);

  /**
   * Saved style changes behave like the markers themselves: reapplied after
   * every frame load (no reset on a page reload) and taken back as soon as the
   * feedback is hidden or the entry deleted — `shapes` is already the device's
   * visibility-filtered list.
   */
  const styledShapes = (styleShapes ?? shapes).filter(
    (s): s is ElementShape =>
      s.tool === 'element' && ((s.styleChanges?.length ?? 0) > 0 || s.textChange != null),
  );
  const styleSig = JSON.stringify(
    styledShapes.map((s) => [s.id, s.selector, s.styleScope, s.styleChanges, s.textChange]),
  );
  useEffect(() => {
    const win = frameEl?.contentWindow;
    if (!win) return;
    const applied: Array<[ElementShape, HTMLElement]> = [];
    try {
      for (const s of styledShapes) {
        if (!s.selector) continue;
        const el = findByShadowPath(win.document, s.selector.split(' >>> ')) as HTMLElement | null;
        if (!el) continue;
        applyStoredChanges(s, el, win.document);
        applied.push([s, el]);
      }
    } catch {
      /* frame not readable */
    }
    return () => {
      try {
        for (const [s, el] of applied) removeStoredChanges(s, el, win.document);
      } catch {
        /* frame already unloaded */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleSig, frameEl, loadCount]);

  // Measure element markers at their *current* element position. Runs via rAF,
  // so after applying or reverting the CSS changes (the reflow is finished by
  // then) — that way the red frame jumps along with the element.
  // Covers both references: the `selector` of the element markers and the
  // `anchor` of every other tool — both are measured in the same pass.
  const elemSig = shapes
    .map((s) => `${s.id}:${s.tool === 'element' ? (s.selector ?? '') : (s.anchor ?? '')}`)
    .join('|');
  useEffect(() => {
    const win = frameEl?.contentWindow;
    if (!win) return;
    // Our own rAF (not the frame's!): a cross-origin blocked frame throws a
    // SecurityError on merely accessing window.cancelAnimationFrame. The frame
    // reads themselves are inside try/catch.
    const raf = requestAnimationFrame(() => {
      const next: Record<string, BoxRect> = {};
      const shifts: Record<string, Point> = {};
      try {
        const doc = win.document;
        const sx = win.scrollX;
        const sy = win.scrollY;
        for (const s of shapes) {
          if (s.tool !== 'element') {
            // The follow-up for the other tools: only possible when an original
            // position was recorded at drawing time (missing in old data — those
            // simply stay where they are).
            if (!s.anchor || s.anchorX == null || s.anchorY == null) continue;
            const el = findByShadowPath(doc, s.anchor.split(' >>> '));
            if (!el) continue;
            const r = (el as HTMLElement).getBoundingClientRect();
            if (r.width <= 0 && r.height <= 0) continue;
            const dx = r.left + sx - s.anchorX;
            const dy = r.top + sy - s.anchorY;
            // Below half a pixel, moving is not worth it — and an empty entry
            // keeps `displayShapes` cheap.
            if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) shifts[s.id] = { x: dx, y: dy };
            continue;
          }
          if (!s.selector) continue;
          const el = findByShadowPath(doc, s.selector.split(' >>> '));
          if (!el) continue;
          const r = (el as HTMLElement).getBoundingClientRect();
          // An invisible element (a folded menu, an accordion) returns nothing
          // but zeros. Taking those over would squash the marker to 0x0 at the
          // scroll origin — the stored box is the better information then.
          if (r.width <= 0 && r.height <= 0) continue;
          next[s.id] = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
        }
      } catch {
        return; // frame not readable — the stored coordinates then stand
      }
      setElemRects(next);
      setAnchorShift(shifts);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elemSig, styleSig, scroll.x, scroll.y, loadCount, revealNonce, frameEl]);

  // After a scroll, remeasure the pinned element's geometry, so that the box
  // model overlay and the popup stay stuck to the element.
  useEffect(() => {
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    if (!el || !win) return;
    if (!el.isConnected) {
      setSelected(null);
      return;
    }
    setSelected(buildSelected(el, win));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroll.x, scroll.y]);

  // Ref mirrors of the drafts: commit is called by pointerdown *and* blur —
  // going through the ref keeps the commits idempotent.
  const [textDraft, setTextDraftState] = useState<TextDraft | null>(null);
  const textDraftRef = useRef<TextDraft | null>(null);
  const setTextDraft = (value: TextDraft | null) => {
    textDraftRef.current = value;
    setTextDraftState(value);
  };

  /** Frame of the note editor — a focus change *inside* it does not close it. */
  const noteBoxRef = useRef<HTMLDivElement | null>(null);
  const [noteDraft, setNoteDraftState] = useState<NoteDraft | null>(null);
  const noteDraftRef = useRef<NoteDraft | null>(null);
  const setNoteDraft = (value: NoteDraft | null) => {
    noteDraftRef.current = value;
    setNoteDraftState(value);
  };

  // The cursor belongs in the note field as soon as the editor opens.
  // `autoFocus` alone is not enough: the pointer-up of the drawing lands
  // afterwards and pulls the focus back into the overlay — hence set it
  // explicitly after the layout.
  const noteFieldRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!noteDraft) return;
    const id = requestAnimationFrame(() => {
      const field = noteFieldRef.current;
      if (!field) return;
      field.focus();
      // Do not overwrite existing text, let it be appended instead.
      field.setSelectionRange(field.value.length, field.value.length);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteDraft?.shapeId]);

  // Double-click on a marker (reported by the app, because in interaction mode
  // the events land in the frame) or an edit from the feedback panel: element
  // markers reopen their edit popup, everything else the note editor with the
  // existing text at the click point.
  useEffect(() => {
    if (!editRequest) return;
    const shape = shapes.find((s) => s.id === editRequest.shapeId);
    if (!shape) return;
    if (
      shape.tool === 'element' &&
      !lockedIds?.has(shape.id) &&
      onUpdateShape &&
      reopenShape(shape)
    ) {
      return;
    }
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

  // Right-click in the frame (reported by the app — in interaction mode the
  // events land in the frame document): pin the element under the cursor and
  // open the edit popup. The coordinates are frame viewport pixels, and the hit
  // test runs directly in the frame — no zoom conversion needed.
  useEffect(() => {
    if (!pickRequest) return;
    const win = frameEl?.contentWindow;
    if (!win) return;
    try {
      const el = deepElementFromPoint(win.document, pickRequest.x, pickRequest.y);
      if (!el || el.tagName === 'HTML') return;
      pickTarget(buildSelected(el as HTMLElement, win));
    } catch {
      /* frame not readable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickRequest?.nonce]);

  // Show a marker's note on hover. Hits are worked out with bounding-box maths
  // rather than the hit element in the SVG — that way the overlay swallows no
  // clicks in interaction mode that belong to the page. The bubble hangs off the
  // mouse position (document space) and travels along.
  const [hoverNote, setHoverNote] = useState<{ id: string; x: number; y: number } | null>(null);
  const notedShapes = displayShapes.filter((s) => !dimmed?.has(s.id) && noteOf(s) != null);
  const notedRef = useRef(notedShapes);
  notedRef.current = notedShapes;

  /**
   * The marking under the cursor — it gets the action buttons (edit, delete)
   * shown; element markers additionally a heavier frame as a hint at the edit
   * popup.
   */
  const [hoverElemId, setHoverElemId] = useState<string | null>(null);
  /** The pointer sits on the action buttons (edit/delete) — hold the hover. */
  const actionHoverRef = useRef(false);
  /**
   * Delayed clearing of the element hover: the way from the marker up to the
   * action buttons briefly leads through "empty" space — without a delay the
   * buttons would disappear before the pointer reached them.
   */
  const hoverClearTimer = useRef(0);
  const setHoverElem = (id: string | null) => {
    window.clearTimeout(hoverClearTimer.current);
    setHoverElemId(id);
  };
  /**
   * Clear the hover with a delay. The action bar lies as an element of its own
   * over the frame: as soon as the pointer reaches it, mouse movement in the
   * frame stops firing and the overlay reports "left". Without the delay that
   * would clear the hover while the pointer is still on its way to the buttons —
   * they would flash once and then be unreachable.
   */
  const clearHoverSoon = () => {
    window.clearTimeout(hoverClearTimer.current);
    hoverClearTimer.current = window.setTimeout(() => {
      if (!actionHoverRef.current) setHoverElemId(null);
    }, 260);
  };
  useEffect(() => () => window.clearTimeout(hoverClearTimer.current), []);
  /**
   * Markings that can be edited here: ticked (greyed out) and foreign (locked)
   * ones stay out — for those there is neither a pen nor a delete.
   */
  const hoverableShapes = displayShapes.filter(
    (s) => !dimmed?.has(s.id) && !lockedIds?.has(s.id),
  );
  const hoverableRef = useRef(hoverableShapes);
  hoverableRef.current = hoverableShapes;

  const updateHover = (x: number, y: number) => {
    const id = hitNote(x, y);
    setHoverNote(id ? { id, x, y } : null);
    // While the pointer sits on the action buttons, hold the hover.
    if (actionHoverRef.current) return;
    // Nested markings: choose the *smallest* one hit (the most specific), so
    // that a marker inside a marker can be hovered too — not just the one drawn
    // last. Guide lines span the whole frame and therefore end up at the back by
    // themselves.
    let best: Shape | null = null;
    let bestArea = Infinity;
    for (const s of hoverableRef.current) {
      const b = shapeBounds(s);
      if (!b) continue;
      if (
        x < b.x - HOVER_PAD ||
        x > b.x + b.w + HOVER_PAD ||
        y < b.y - HOVER_PAD ||
        y > b.y + b.h + HOVER_PAD
      ) {
        continue;
      }
      const area = Math.max(1, b.w) * Math.max(1, b.h);
      if (area < bestArea) {
        best = s;
        bestArea = area;
      }
    }
    if (best) {
      setHoverElem(best.id);
    } else if (hoverElemId) {
      // Do not clear immediately — give the pointer time to reach the buttons.
      window.clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = window.setTimeout(() => {
        if (!actionHoverRef.current) setHoverElemId(null);
      }, 260);
    }
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

  // In interaction mode the mouse movements run in the frame itself — listen
  // there and hit-test in document coordinates (pageX/pageY).
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
      // `relatedTarget == null` means: the pointer has left the frame document.
      // That also happens on the way to the action bar, since that lies as an
      // element of the overlay *above* the frame — hence clear with a delay, or
      // the buttons disappear exactly when you want to touch them.
      if (e.relatedTarget == null) {
        setHoverNote(null);
        clearHoverSoon();
      }
    };

    try {
      win.addEventListener('mousemove', onMove, { passive: true });
      win.document.addEventListener('mouseout', onOut, true);
    } catch {
      return; // frame not readable
    }

    return () => {
      cancelAnimationFrame(raf);
      try {
        win.removeEventListener('mousemove', onMove);
        win.document.removeEventListener('mouseout', onOut, true);
      } catch {
        /* frame already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameEl, loadCount]);

  // Track the frame's scroll position, so that the markings stay stuck to the
  // content. try/catch: the frame may be blocked (cross-origin).
  useEffect(() => {
    const win = frameEl?.contentWindow;
    if (!win) return;

    let raf = 0;
    const read = () => {
      try {
        const el = win.document.scrollingElement;
        setScroll({ x: el?.scrollLeft ?? 0, y: el?.scrollTop ?? 0 });
      } catch {
        /* frame not readable */
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
        /* frame already gone */
      }
    };
  }, [frameEl, loadCount]);

  // In draw mode the overlay lies over the frame and would swallow wheel events
  // — pass them on to the frame for scrolling. A native listener with
  // passive:false, because React's onWheel hangs passively off the root and
  // preventDefault (against the grid behind scrolling along) would be useless there.
  useEffect(() => {
    const svg = svgRef.current;
    if (!active || !svg) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      // Divide by `zoom`: the frame is displayed scaled, so the scroll distance
      // in frame space has to be larger for the content to move at the same
      // speed on screen as with native scrolling (otherwise the page crawls at
      // a fit-to-width zoom < 1).
      const k = factor / (zoom || 1);
      try {
        frameEl?.contentWindow?.scrollBy(e.deltaX * k, e.deltaY * k);
      } catch {
        /* frame not readable */
      }
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [active, frameEl, zoom]);

  /**
   * A callback ref on the panel: keeps `popupSize` current, so that the clamping
   * follows reality (the text and font rows are missing depending on the
   * element, and the change list grows while editing).
   *
   * Must stand *before* the `return null` further down: hooks must not be
   * skipped past an exit, or an empty overlay renders fewer hooks than a full
   * one (React error #300).
   */
  const measurePopup = useCallback((node: HTMLDivElement | null) => {
    popupObsRef.current?.disconnect();
    popupObsRef.current = null;
    if (!node) return;
    const read = () => {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      if (!w || !h) return;
      setPopupSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    const obs = new ResizeObserver(read);
    obs.observe(node);
    popupObsRef.current = obs;
  }, []);

  // Hide only when there really is nothing to do. With markers hidden but saved
  // CSS changes present, the overlay stays mounted, or the cleanup would take
  // the changes back off the page — the effect (fonts/padding) should stay
  // visible in dev mode. A right-click pick (pickRequest/selected) needs the
  // overlay too, even without a marking: its popup hangs off it — and the pick
  // effect may only run when the body below this guard has been executed
  // (otherwise pickTarget and friends would never be initialised).
  if (!active && shapes.length === 0 && styledShapes.length === 0 && !selected && !pickRequest) {
    return null;
  }

  /**
   * Double-click outside correction mode: open the note editor.
   *
   * The app additionally listens in the frame document for this, but the hit
   * areas (`.anno__hit--area`) lie over the iframe and swallow the double-click
   * before it arrives there — exactly as with the wheel forwarding next to it.
   * Whoever hits the marker is therefore served here; everything else passes
   * through to the page unchanged.
   */
  const handleDoubleClick = (e: ReactMouseEvent) => {
    if (active) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom + scroll.x;
    const y = (e.clientY - rect.top) / zoom + scroll.y;
    // Backmost first — those lie on top in the overlay.
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
        // Element marker: reopen the edit popup rather than the note editor.
        if (
          shape.tool === 'element' &&
          !lockedIds?.has(shape.id) &&
          onUpdateShape &&
          reopenShape(shape)
        ) {
          return;
        }
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

  /** Determine the element under the cursor in the frame document. */
  const elementAt = (
    e: { clientX: number; clientY: number },
    win: Window,
  ): HTMLElement | null => {
    const rect = svgRef.current!.getBoundingClientRect();
    const el = deepElementFromPoint(
      win.document,
      (e.clientX - rect.left) / zoom,
      (e.clientY - rect.top) / zoom,
    );
    if (!el || el.tagName === 'HTML') return null;
    return el as HTMLElement;
  };

  const pickAt = (e: { clientX: number; clientY: number }): ElementTarget | null => {
    const win = frameEl?.contentWindow;
    if (!win) return null;
    try {
      const el = elementAt(e, win);
      return el ? measureTarget(el, win) : null;
    } catch {
      return null; // frame not readable
    }
  };

  /** Pin an element by clicking — including the live DOM reference and font values. */
  const selectAt = (e: { clientX: number; clientY: number }): SelectedTarget | null => {
    const win = frameEl?.contentWindow;
    if (!win) return null;
    try {
      const el = elementAt(e, win);
      return el ? buildSelected(el, win) : null;
    } catch {
      return null;
    }
  };

  /**
   * Pin an element and open the edit popup — the shared core of an element-tool
   * click and a right-click. Picking the same element again closes it (toggle);
   * if the element already carries a marker, its values open rather than a
   * second marker.
   */
  const pickTarget = (target: SelectedTarget | null) => {
    setPicked(null);
    if (target && selected?.el === target.el) {
      closeInspect(); // Toggle: erneut geklickt -> schliessen
    } else if (target) {
      const existing = onUpdateShape
        ? [...displayShapes]
            .reverse()
            .find(
              (s): s is ElementShape =>
                s.tool === 'element' && !lockedIds?.has(s.id) && s.selector === target.selector,
            )
        : undefined;
      if (existing) {
        openForShape(existing, target);
        return;
      }
      // Remember the starting values, to diff the changes for the feedback later.
      originalRef.current = {
        margin: { ...target.margin },
        padding: { ...target.padding },
        fontWeight: target.fontWeight,
        fontSize: target.fontSize,
        maxWidth: target.maxWidth,
        text: target.text,
      };
      setSelected(target);
      setEditingId(null);
      setPopupNote(''); // the note belongs to whichever element is pinned
      setTextEdit(target.hasText ? target.text : null);
    } else {
      closeInspect();
    }
  };

  /**
   * Set several properties live and remeasure — so that the overlay and the
   * popup values follow immediately. Class scope writes into a managed rule
   * (acting on every element of the class), element scope inline. Both with
   * `important`, so that the change becomes visible and element scope beats the
   * class rule. Not persistent across a reload (like DevTools).
   */
  const writeStyles = (entries: Array<[string, string]>) => {
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    if (!el || !win) return;
    try {
      const classSel = scope === 'class' ? classSelectorOf(el) : null;
      const target = classSel ? pickerRuleStyle(win.document, classSel) : el.style;
      for (const [prop, value] of entries) target?.setProperty(prop, value, 'important');
      setSelected(buildSelected(el, win));
    } catch {
      /* frame no longer readable */
    }
  };

  const setStyle = (prop: string, value: string) => writeStyles([[prop, value]]);

  /**
   * Switch the scope — and take the values already set along.
   *
   * Without that move they would stay where they were written: anyone who first
   * dials the padding under "Class" and then switches to "This element" would
   * still have changed every element of the class, while the popup claims "only
   * this one". So clear both targets first, then rewrite the diff against the
   * starting values in the new target.
   */
  const changeScope = (next: 'class' | 'element') => {
    if (next === scope) return;
    setScope(next);
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    if (!el || !win) return;
    try {
      const doc = win.document;
      const pending = buildChanges(selected!);
      const text = buildTextChange(selected!);
      clearPendingProps(el, doc, pending);
      const classSel = next === 'class' ? classSelectorOf(el) : null;
      const target = classSel ? pickerRuleStyle(doc, classSel) : el.style;
      for (const c of pending) {
        for (const p of propsOf(c.prop)) target?.setProperty(p, c.to, 'important');
      }
      // The text moves along: the old scope gets its original text back, the new
      // one the draft.
      if (text) {
        restoreScopedText(scopeTargets(el, doc, scope === 'class'), text.from);
        writeScopedText(scopeTargets(el, doc, next === 'class'), text.to);
      }
      setSelected(buildSelected(el, win));
    } catch {
      /* frame no longer readable */
    }
  };

  /**
   * Replace the text live in the page — under class scope in every element the
   * selector hits (the number stands on the switch). The layout reflows in the
   * process, so remeasure afterwards, keeping the frame and the box model on
   * the element.
   */
  const writeText = (value: string) => {
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    setTextEdit(value);
    if (!el || !win) return;
    try {
      writeScopedText(scopeTargets(el, win.document, scope === 'class'), value);
      setSelected(buildSelected(el, win));
    } catch {
      /* frame no longer writable */
    }
  };

  /** Set margin or padding — with the link active, all four sides at once. */
  const editSpacing = (kind: SpacingKind, edge: Edge, v: number) => {
    const value = `${kind === 'padding' ? Math.max(0, v) : v}px`;
    const edges = linked[kind] ? ALL_EDGES : [edge];
    writeStyles(edges.map((e) => [`${kind}-${e}`, value]));
  };

  /**
   * Revert a single change: the property is removed from both possible targets
   * (inline style and the managed class rule), so that the page's CSS applies
   * again rather than an override that says the same thing. The shorthand
   * `margin`/`padding` affects all four sides in the process.
   */
  const revertChange = (change: StyleChange) => {
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    if (!el || !win) return;
    const props = propsOf(change.prop);
    try {
      for (const p of props) el.style.removeProperty(p);
      const classSel = classSelectorOf(el);
      const style = classSel ? pickerRuleStyle(win.document, classSel) : null;
      if (style) for (const p of props) style.removeProperty(p);
      setSelected(buildSelected(el, win));
    } catch {
      /* frame no longer readable */
    }
  };

  /**
   * Revert only the text change — the rest stays. Every element hit gets its
   * *own* original text back, not that of the one clicked (under class scope
   * those are different).
   */
  const revertText = () => {
    const original = originalRef.current?.text;
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    if (original == null) return;
    setTextEdit(original);
    if (!el || !win) return;
    try {
      restoreScopedText(scopeTargets(el, win.document, scope === 'class'), original);
      setSelected(buildSelected(el, win));
    } catch {
      /* frame no longer writable */
    }
  };

  /** Remove every value set by the popup — inline, class rule and text. */
  const resetStyles = () => {
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    if (!el || !win) return;
    try {
      clearPickerProps(el, win.document);
      const original = originalRef.current?.text;
      if (original != null && selected?.hasText) {
        restoreScopedText(scopeTargets(el, win.document, scope === 'class'), original);
        setTextEdit(original);
      }
      setSelected(buildSelected(el, win));
    } catch {
      /* frame no longer readable */
    }
  };

  /**
   * Diff of the current values against the starting values at pinning time.
   * Sides changed evenly are folded into the shorthand (`margin: 8px → 12px`).
   */
  const buildChanges = (sel: SelectedTarget): StyleChange[] => {
    const o = originalRef.current;
    if (!o) return [];
    const out: StyleChange[] = [];
    const names = { t: 'top', r: 'right', b: 'bottom', l: 'left' } as const;
    for (const kind of ['margin', 'padding'] as const) {
      const sides = ['t', 'r', 'b', 'l'] as const;
      const from = sides.map((s) => Math.round(o[kind][s]));
      const to = sides.map((s) => Math.round(sel[kind][s]));
      const changed = sides.filter((_, i) => from[i] !== to[i]);
      if (changed.length === 0) continue;
      const uniform = to.every((v) => v === to[0]) && from.every((v) => v === from[0]);
      if (changed.length === 4 && uniform) {
        out.push({ prop: kind, from: `${from[0]}px`, to: `${to[0]}px` });
      } else {
        for (const s of changed) {
          const i = sides.indexOf(s);
          out.push({ prop: `${kind}-${names[s]}`, from: `${from[i]}px`, to: `${to[i]}px` });
        }
      }
    }
    if (o.maxWidth !== sel.maxWidth) {
      out.push({
        prop: 'max-width',
        from: o.maxWidth == null ? 'none' : `${Math.round(o.maxWidth)}px`,
        to: sel.maxWidth == null ? 'none' : `${Math.round(sel.maxWidth)}px`,
      });
    }
    if (sel.hasText) {
      if (o.fontWeight !== sel.fontWeight) {
        out.push({ prop: 'font-weight', from: `${o.fontWeight}`, to: `${sel.fontWeight}` });
      }
      if (Math.round(o.fontSize) !== Math.round(sel.fontSize)) {
        out.push({
          prop: 'font-size',
          from: `${Math.round(o.fontSize)}px`,
          to: `${Math.round(sel.fontSize)}px`,
        });
      }
    }
    return out;
  };

  /** Changed text against the starting text at pinning time — null without a change. */
  const buildTextChange = (sel: SelectedTarget): TextChange | null => {
    const from = originalRef.current?.text;
    if (from == null || !sel.hasText) return null;
    const to = textEdit ?? sel.text;
    return to.trim() === from.trim() ? null : { from, to: to.trim() };
  };

  /** Clear the editing state only — the page stays as it currently is. */
  const resetInspectState = () => {
    setSelected(null);
    setEditingId(null);
    setPopupNote('');
    setTextEdit(null);
  };

  /**
   * Close the popup without saving. Whatever was dialled on the page in the
   * popup then belongs to nobody — so it goes. It used to stay behind: visibly
   * changed, noted in no marker and therefore no longer reachable by the
   * "My edits" switch either. A marker reopened afterwards gets its saved values
   * back.
   */
  const closeInspect = () => {
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    if (el && win && selected) {
      try {
        const doc = win.document;
        const pending = buildChanges(selected);
        const text = buildTextChange(selected);
        // Without pending changes the page stays untouched — merely looking and
        // closing again must not touch anything.
        if (pending.length > 0 || text) {
          clearPendingProps(el, doc, pending);
          if (text) restoreScopedText(scopeTargets(el, doc, scope === 'class'), text.from);
          const saved = editingId ? styledShapes.find((s) => s.id === editingId) : undefined;
          if (saved) applyStoredChanges(saved, el, doc);
        }
      } catch {
        /* frame no longer readable */
      }
    }
    resetInspectState();
  };

  /**
   * Reopen the popup for an existing element marker: reapply the saved changes
   * (after a reload they would otherwise be gone) and let the diff run against
   * the original values again.
   */
  const openForShape = (shape: ElementShape, target: SelectedTarget) => {
    const win = frameEl?.contentWindow;
    if (!win) return;
    originalRef.current = originalsFromStored(target, shape.styleChanges ?? [], shape.textChange);
    try {
      applyStoredChanges(shape, target.el, win.document);
      const next = buildSelected(target.el, win);
      setSelected(next);
      setTextEdit(next.hasText ? next.text : null);
    } catch {
      setSelected(target); // frame no longer writable — only display the values
      setTextEdit(target.hasText ? target.text : null);
    }
    // A marker without style changes has no `styleScope` — the text scope then
    // says what it referred to.
    setScope(shape.styleScope ?? shape.textScope ?? 'class');
    setPopupNote(shape.note ?? '');
    setEditingId(shape.id);
  };

  /**
   * Open the popup for a saved marker whose element still has to be resolved
   * through the selector (double-click, panel edit). `false` when the element
   * can no longer be found on the page — the caller then falls back to the note
   * editor.
   */
  const reopenShape = (shape: ElementShape): boolean => {
    const win = frameEl?.contentWindow;
    if (!win || !shape.selector) return false;
    try {
      const el = findByShadowPath(
        win.document,
        shape.selector.split(' >>> '),
      ) as HTMLElement | null;
      if (!el) return false;
      openForShape(shape, buildSelected(el, win));
      return true;
    } catch {
      return false; // frame not readable
    }
  };

  /**
   * Pen button on the hovered marker. Element markers open their popup (values
   * *and* note); every other marking the note editor — exactly what the
   * double-click does too.
   */
  const editShapeById = (id: string) => {
    const shape = hoverableRef.current.find((s) => s.id === id);
    if (!shape) return;
    actionHoverRef.current = false;
    setHoverElemId(null);
    // Element no longer findable (the page was rebuilt) — then at least the note.
    if (shape.tool === 'element' && onUpdateShape && reopenShape(shape)) return;
    const at = actionAnchor(shape);
    const value = editableTextOf(shape);
    setNoteDraft({ shapeId: shape.id, x: at.x, y: at.y, value, initial: value });
  };

  /** Take the pinned element on as a feedback marking — changes and note included. */
  const commitSelectedAsMarker = () => {
    if (!selected) return;
    const { x, y, w, h, label, selector } = selected;
    const changes = buildChanges(selected);
    const textChange = buildTextChange(selected);
    const note = popupNote.trim();
    const classSel = classSelectorOf(selected.el);
    const styleScope: 'class' | 'element' = scope === 'class' && classSel ? 'class' : 'element';
    // The scope hangs off the marker as soon as *anything* was changed — a pure
    // text change included. Otherwise the feedback would say "this element
    // only" while the text reads differently in twelve elements.
    const scopeFields =
      changes.length > 0 || textChange
        ? { styleScope, styleTarget: styleScope === 'class' ? classSel! : label }
        : {};
    const styleFields = changes.length > 0 ? { styleChanges: changes } : {};
    // Text carries its own scope: old markers have none and therefore still
    // mean their own element alone.
    const textFields = textChange ? { textChange, textScope: styleScope } : {};
    if (editingId && onUpdateShape) {
      // A marker opened again: update the values on the existing entry.
      onUpdateShape(editingId, {
        x,
        y,
        w,
        h,
        note: note || undefined,
        styleChanges: undefined,
        styleTarget: undefined,
        styleScope: undefined,
        textChange: undefined,
        textScope: undefined,
        ...scopeFields,
        ...styleFields,
        ...textFields,
      });
    } else {
      onAdd({
        id: shapeId(),
        tool: 'element',
        color,
        x,
        y,
        w,
        h,
        label,
        selector,
        ...(note ? { note } : {}),
        ...scopeFields,
        ...styleFields,
        ...textFields,
      });
    }
    // If the "My edits" switch is on, the fresh marker takes over the values
    // already standing on the page — they stay put and are reconciled by the
    // store effect straight after. If it is off, the page belongs to the
    // original again; the marker holds the values but does not show them.
    if (stylesApplied) resetInspectState();
    else closeInspect();
    setPicked(null);
  };

  /**
   * Popup position in viewport pixels: by default next to the element, freely
   * placeable by the user by dragging — always clamped to the viewport, so that
   * nothing disappears under the floating tool bar or the like. The clamping
   * goes against the measured panel size, not against estimates.
   */
  const popupPlacement = (sel: SelectedTarget) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const raw = popupPos ?? {
      x: (rect?.left ?? 0) + (sel.x - scroll.x) * zoom + 14,
      y: (rect?.top ?? 0) + (sel.y - scroll.y) * zoom + 10,
    };
    return {
      left: Math.max(8, Math.min(raw.x, window.innerWidth - popupSize.w - 8)),
      top: Math.max(8, Math.min(raw.y, window.innerHeight - popupSize.h - 8)),
    };
  };

  /** The header is the drag grip — buttons inside it stay clickable. */
  const popupHeadProps = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      const box = e.currentTarget.closest('.anno__inspect')!.getBoundingClientRect();
      popupDragRef.current = {
        dx: e.clientX - box.left,
        dy: e.clientY - box.top,
        pointerId: e.pointerId,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault(); // no text selection while dragging
      setPopupDragging(true);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = popupDragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      setPopupPos({ x: e.clientX - d.dx, y: e.clientY - d.dy });
    },
    onPointerUp: () => {
      popupDragRef.current = null;
      setPopupDragging(false);
    },
    onLostPointerCapture: () => {
      popupDragRef.current = null;
      setPopupDragging(false);
    },
  };

  /** How many elements the class scope actually hits. */
  const classMatchCount = (classSel: string | null) => {
    const doc = frameEl?.contentWindow?.document;
    if (!classSel || !doc) return 0;
    try {
      return doc.querySelectorAll(classSel).length;
    } catch {
      return 0;
    }
  };

  /**
   * A DOM reference for a marking at document coordinates — makes exports (the
   * text export) locatable in the source.
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
        // Original position for repositioning after layout changes (reload).
        anchorX: r.left + win.scrollX,
        anchorY: r.top + win.scrollY,
      };
    } catch {
      return {}; // frame not readable
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
    // Save real changes only — while editing (initially set) the text may also
    // be emptied, whereas when creating, empty = no note.
    if (value !== (current.initial ?? '')) onSetNote(current.shapeId, value);
  };

  const handleDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;

    // Prevents the default focus change of the mousedown that follows — that
    // would immediately blur the freshly opened note field (and thereby close
    // it) before it becomes visible.
    e.preventDefault();

    // Commit open editors first (the note is optional — empty = without).
    commitText();
    commitNote();

    const p = toDoc(e);

    // Grabbed the handle of one of your own boxes? Then resize — checked before
    // moving, because the handles sit on the outline.
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

    // Grabbed the outline of one of your own markings? Then move rather than
    // draw — rearmost first, those lie on top in the overlay.
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

    // From here on we draw — which only exists in correction mode. Otherwise the
    // click belongs to the page (the overlay does not even catch it there).
    if (!active) return;

    if (tool === 'element') {
      // The click pins the element and opens the edit popup (margin/padding,
      // and for text the font too). Taking it over as a marking happens from
      // inside the popup.
      pickTarget(selectAt(e));
      return;
    }

    if (tool === 'text') {
      setTextDraft({ x: p.x, y: p.y, value: '' });
      return;
    }

    if (tool === 'pin') {
      // Save the pin immediately, then capture the (optional) free text.
      const id = shapeId();
      onAdd({ id, tool: 'pin', color, x: p.x, y: p.y, text: '', ...anchorAt(p.x, p.y) });
      setNoteDraft({ shapeId: id, x: p.x, y: p.y, value: '' });
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pen') {
      setDraft({ id: shapeId(), tool: 'pen', color, strokes: [[p]] });
    } else if (tool === 'hline' || tool === 'vline') {
      // Guide line: visible on press already, dragging still moves it.
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
    // In draw mode too: show the note on hovering a marker.
    if (!draft) {
      const p = toDoc(e);
      updateHover(p.x, p.y);
      // Rearmost first — those lie on top in the overlay, as when grabbing.
      const grabbed =
        onMoveShape
          ? [...displayShapes].reverse().find((s) => mine(s) && hitsShape(s, p, 8 / zoom))
          : undefined;
      setGrabId(grabbed?.id ?? null);
      // A handle beats the outline: if the cursor sits on a corner or edge, the
      // drag means the size, not the position.
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
    // Line tools: a preview of the line under the cursor.
    if (active && (tool === 'hline' || tool === 'vline') && !draft) {
      setLineGhost(toDoc(e));
    }
    // Element picker: live highlight of the element under the cursor.
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
      // The first line stays at the starting point; dragging spans the second
      // and thereby measures the gap. Below the minimum distance it remains a
      // single line following the cursor.
      const axis = draft.tool === 'hline' ? p.y : p.x;
      const start = draft.tool === 'hline' ? draft.y : draft.x;
      const spread = Math.abs(axis - start) >= MIN_DRAG / zoom;
      setDraft(spread ? { ...draft, to: axis } : { ...draft, x: p.x, y: p.y, to: undefined });
    }
  };

  /**
   * DOM reference of a freehand stroke: sample along the drag and count the
   * elements actually crossed — body/html are only the last resort when nothing
   * more concrete was hit.
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

  // Freehand saves without the note editor; rectangle/ellipse/arrow open the
  // note field directly, like the pin and the element picker (optional, empty =
  // without). The DOM reference is the crossed elements, and for the arrow the
  // element under its tip.
  const handleUp = () => {
    if (resizing) {
      const { id, box } = resizing;
      setResizing(null);
      // Do not save boxes pushed together — that would leave an invisible marker
      // behind.
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
      // Without a minimum distance — a click already places the line.
      onAdd({ ...draft, ...anchorAt(draft.x, draft.y) });
      setNoteDraft({ shapeId: draft.id, x: draft.x, y: draft.y, value: '' });
    }
  };

  const strokeWidth = STROKE_PX / zoom;
  const fontSize = 15 / zoom;
  const numbers = pinNumbers(shapes);

  /** Flash frame around the marker jumped to from the panel (at its moved position). */
  const flashShape = flashShapeId ? displayShapes.find((s) => s.id === flashShapeId) : null;
  const flashBox = flashShape ? shapeBounds(flashShape) : null;

  /** A quiet highlight while the panel entry is hovered. */
  const hoverShape = hoverShapeId ? displayShapes.find((s) => s.id === hoverShapeId) : null;
  const hoverBox = hoverShape ? shapeBounds(hoverShape) : null;

  /** The marking under the cursor — it carries the action buttons. */
  const markHoverShape =
    hoverElemId && !movingShape && !resizing
      ? (hoverableShapes.find((s) => s.id === hoverElemId) ?? null)
      : null;
  /**
   * Element markers in the element tool: a heavier frame as a hint at the popup.
   * Outside it, the drawn frame carries the hover itself.
   */
  const hoverElemShape =
    markHoverShape?.tool === 'element' && active ? markHoverShape : null;

  /**
   * Centre of the hovered marking in screen pixels — that is where the action
   * bar sits (offset by CSS around its own centre point).
   *
   * If the centre lies outside the visible frame crop, there is no bar: buttons
   * clamped to the edge would no longer have a recognisable relation to their
   * marking.
   */
  const actAt = (() => {
    if (!markHoverShape) return null;
    const p = actionAnchor(markHoverShape);
    const left = (p.x - scroll.x) * zoom;
    let top = (p.y - scroll.y) * zoom;
    if (left < 0 || top < 0 || left > width * zoom || top > height * zoom) return null;
    // If the capsule does not fit inside the marking (pin, text, guide line) it
    // would cover it completely — then it sits just above it.
    const b = shapeBounds(markHoverShape);
    if (b && (b.w * zoom < 78 || b.h * zoom < 42)) {
      top = (b.y - scroll.y) * zoom - 22;
    }
    return {
      left: clampAct(left, width * zoom, 36),
      top: clampAct(top, height * zoom, 20),
    };
  })();

  /**
   * Large buttons inside the element marker's rectangle — there is room there
   * and the frame visibly encloses them. For small markings the compact capsule
   * remains, or it would spill out past the marking.
   */
  const actLarge =
    markHoverShape?.tool === 'element' &&
    markHoverShape.w * zoom >= 132 &&
    markHoverShape.h * zoom >= 64;

  /**
   * Is the bar standing at all? If it disappears while the pointer sits on it
   * (a popup opens, the marking falls away), it would never get a
   * `pointerleave` — `actionHoverRef` would stay stuck on `true` and
   * `updateHover` would swallow every hover from then on.
   *
   * The reconciliation deliberately runs without an effect: there is a `return
   * null` above for empty overlays, so a hook at this point would not run in
   * every render (React error #310). The assignment is idempotent and derives
   * solely from this render — no effect is needed for it.
   */
  const actsOpen = !!markHoverShape && !!actAt && !selected && !noteDraft;
  if (!actsOpen) actionHoverRef.current = false;

  /**
   * Make moving visible: the marker under the cursor gets a grab frame, the one
   * being dragged a heavier one at its new position.
   */
  const grabShape = grabId && !movingShape ? displayShapes.find((s) => s.id === grabId) : null;
  const dragShape = movingShape ? displayShapes.find((s) => s.id === movingShape.id) : null;
  // Box markings show hover and dragging in the drawn frame itself — a second
  // blue box around it would be belt and braces.
  const grabBox = grabShape && !drawsOwnEmphasis(grabShape) ? shapeBounds(grabShape) : null;
  const dragBox =
    dragShape && !drawsOwnEmphasis(dragShape)
      ? shapeBounds(translateShape(dragShape, movingShape!.dx, movingShape!.dy))
      : null;

  /** The marking with handles: the one under the cursor, or the one being dragged. */
  const handleShape = (() => {
    // On a panel hover too — that way the handles can be found without hitting
    // the outline exactly.
    const id = resizing?.id ?? hoverHandle?.id ?? grabId ?? hoverShapeId;
    const shape = id ? displayShapes.find((s) => s.id === id) : null;
    // Only where the drag actually does something.
    if (!onResizeShape || movingShape) return null;
    if (!shape || !isResizable(shape) || !mine(shape)) return null;
    return resizing ? { ...shape, ...resizing.box } : shape;
  })();
  const handleBounds = handleShape ? shapeBounds(handleShape) : null;

  /** The visible section in document space — labels stay inside it. */
  const view: View = { x: scroll.x, y: scroll.y, w: width, h: height };

  /** Editor position in overlay pixels, clamped at the edges. */
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
        onContextMenu={(e) => {
          // A right-click picks the element under the cursor directly — in
          // correction mode the overlay catches the click, otherwise the frame
          // (see pickRequest). Do not pass it on to the grid palette.
          e.preventDefault();
          e.stopPropagation();
          pickTarget(selectAt(e));
        }}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={() => {
          setDraft(null);
          setMovingShape(null);
          setResizing(null);
        }}
        onWheel={(e) => {
          // The hit areas lie over the frame — a guide line even spans the full
          // width. Without forwarding, the page could no longer be scrolled
          // over it.
          if (active) return;
          const win = frameEl?.contentWindow;
          if (!win) return;
          // deltaMode 1 = lines, 2 = pages.
          const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
          try {
            win.scrollBy(e.deltaX * unit, e.deltaY * unit);
          } catch {
            /* frame not readable */
          }
        }}
        onPointerOut={() => {
          // Outside correction mode, events come only from the outlines: if the
          // pointer leaves them, the grab frame would otherwise stay stuck.
          if (active || movingShape || resizing) return;
          setGrabId(null);
          setHoverHandle(null);
          setHoverNote(null);
          clearHoverSoon();
        }}
        onPointerLeave={() => {
          setPicked(null);
          setLineGhost(null);
          setGrabId(null);
          setHoverHandle(null);
          setHoverNote(null);
          clearHoverSoon();
        }}
      >
        <defs>
          {/* A soft shadow for note bubbles; values /zoom, so that the screen
              size stays constant. The same definition in every overlay —
              url(#…) picks up the first one in the shadow root. */}
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
            // Freshly drawn while the markers are off: let it stand briefly,
            // then fade out softly.
            if (s.id === fadingShapeId) {
              return (
                <g key={`fade-${s.id}`} className="anno__fade" pointerEvents="none">
                  {renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id), view)}
                </g>
              );
            }
            // The dragged marker visibly stands out for as long as it hangs off
            // the mouse.
            if (movingShape?.id === s.id) {
              return (
                <g key={`drag-${s.id}`} className="anno__moving">
                  {renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id), view, 'drag')}
                </g>
              );
            }
            // Pointer on the marking: the frame is retraced (see
            // renderSketchBox). The panel hover keeps the blue box — it is meant
            // to make the marking *findable* on the page, and a delicate double
            // stroke is too quiet for that.
            const emphasis: Emphasis =
              grabId === s.id || markHoverShape?.id === s.id ? 'hover' : 'none';
            return renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id), view, emphasis);
          })}
          {/* Hit areas of your own markings — outside correction mode the only
              way still to be able to grab them. */}
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
          {/* Screenshot: every explanation collects at the right edge, rather
              than covering the content it is about. */}
          {showNotes &&
            renderExportCards(
              displayShapes.filter((s) => !dimmed?.has(s.id)),
              zoom,
              width,
            )}
          {/* Notes stand permanently at the marker — shortened, so that they do
              not cover the content; the hover shows the full text. Element
              markers excepted: they carry their note in the flag above the frame
              (see `renderElementTag`) and would otherwise need two boxes for one
              statement. */}
          {!showNotes &&
            notedShapes
              .filter((s) => s.tool !== 'element' && s.id !== hoverNote?.id)
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
              // Right next to the cursor, clamped into the visible frame crop
              // (document space: scroll..scroll+viewport).
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
          {/* Grabbable: a light frame with a dark outline beneath it, so that it
              stands on any page background. */}
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
          {/* Handles at the corners and edge midpoints — here the drag changes the size. */}
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
          {hoverElemShape && (
            <rect
              className="anno__elem-hover"
              x={hoverElemShape.x - 2 / zoom}
              y={hoverElemShape.y - 2 / zoom}
              width={hoverElemShape.w + 4 / zoom}
              height={hoverElemShape.h + 4 / zoom}
              rx={(CORNER_PX + 2) / zoom}
              fill="none"
              stroke={hoverElemShape.color}
              strokeWidth={strokeWidth * 1.5}
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
          {active &&
            tool === 'element' &&
            picked &&
            !noteDraft &&
            (!selected || picked.selector !== selected.selector) && (
              <g pointerEvents="none">
                {renderBoxModel(picked, zoom, view)}
                <rect
                  x={picked.x}
                  y={picked.y}
                  width={picked.w}
                  height={picked.h}
                  rx={CORNER_PX / zoom}
                  fill={color}
                  fillOpacity={0.06}
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
                )}
              </g>
            )}
          {/* Not tied to mode and tool: a right-click lets the popup be opened
              from interaction mode too. Without the frame it then stood over the
              page without showing what it referred to — you were dialling values
              without seeing the target. */}
          {selected && (
            <g pointerEvents="none">
              {renderBoxModel(selected, zoom, view)}
              <rect
                x={selected.x}
                y={selected.y}
                width={selected.w}
                height={selected.h}
                rx={CORNER_PX / zoom}
                fill={color}
                fillOpacity={0.05}
                stroke={color}
                strokeWidth={strokeWidth * 1.4}
              />
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
            // stopPropagation: Esc/Enter should only affect the draft, not the
            // global shortcuts (ending the mode and so on).
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
            // For guide lines the gap can also be typed here — dragged values
            // are rarely exact, whereas a target value ("24 px") is.
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
                    // As in the note field: the keys belong to the editor.
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
                setNoteDraft(null); // The marker stays, the note is dropped
              }
            }}
            onBlur={(e) => {
              // Jumping into the gap field next to it is not leaving the editor —
              // otherwise it would close on the first click there.
              if (noteBoxRef.current?.contains(e.relatedTarget as Node | null)) return;
              commitNote();
            }}
          />
          <div className="anno__note-hint">Enter saves · Esc skips the note</div>
        </div>
      )}

      {/* Action buttons on the hovered marking — whatever kind it is: edit (pen)
          and delete (X, with a prompt). They make it visible that markings can
          be edited — a double-click alone is not discoverable. Not while the
          popup or the note editor is open. */}
      {actsOpen && markHoverShape && actAt && (
        <div
          className={`anno__acts${actLarge ? ' anno__acts--lg' : ''}`}
          style={actAt}
          onPointerEnter={() => {
            actionHoverRef.current = true;
            window.clearTimeout(hoverClearTimer.current);
          }}
          onPointerLeave={() => {
            // Do not close immediately: the bar sits *inside* the marking, so on
            // leaving, the pointer is usually still on it. Hiding it hard would
            // make the buttons flicker, because the mouse movement in the frame
            // shows them again straight away.
            actionHoverRef.current = false;
            clearHoverSoon();
          }}
        >
          <button
            type="button"
            className="anno__act"
            title="Edit marking"
            aria-label="Edit marking"
            onClick={() => editShapeById(markHoverShape.id)}
          >
            <IconEditPen size={actLarge ? 18 : 13} />
          </button>
          {onDeleteShape && (
            <button
              type="button"
              className="anno__act anno__act--danger"
              title="Delete marking"
              aria-label="Delete marking"
              onClick={() => {
                const id = markHoverShape.id;
                actionHoverRef.current = false;
                setHoverElemId(null);
                onDeleteShape(id);
              }}
            >
              <IconClose size={actLarge ? 18 : 13} />
            </button>
          )}
        </div>
      )}

      {selected &&
        (() => {
          // Portal into the app root: there the popup lies above the floating
          // tool bar and is not caught by the device container (whose
          // container-type would cut off position:fixed).
          const host = svgRef.current?.closest('.root');
          const classSel = classSelectorOf(selected.el);
          const popup = (
            <InspectPanel
              sel={selected}
              color={color}
              placement={popupPlacement(selected)}
              dragging={popupDragging}
              scope={scope}
              classSel={classSel}
              classMatches={classMatchCount(classSel)}
              linked={linked}
              changes={buildChanges(selected)}
              textChange={buildTextChange(selected)}
              textValue={textEdit ?? selected.text}
              note={popupNote}
              isEditing={editingId != null}
              panelRef={measurePopup}
              headProps={popupHeadProps}
              onScope={changeScope}
              onToggleLink={(kind) => setLinked((v) => ({ ...v, [kind]: !v[kind] }))}
              onSpacing={editSpacing}
              onStyle={setStyle}
              onText={writeText}
              onNote={setPopupNote}
              onRevertChange={revertChange}
              onRevertText={revertText}
              onReset={resetStyles}
              onCommit={commitSelectedAsMarker}
              onClose={closeInspect}
            />
          );
          return host ? createPortal(popup, host) : popup;
        })()}
    </div>
  );
}

/** Shorten text to `max` characters — SVG <text> knows no ellipsis. */
function ellipsisAt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** Line wrapping for note bubbles — SVG <text> does not wrap by itself. */
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

/** Editable content of a marking: pins and texts carry it in `text`, everything else in `note`. */
function editableTextOf(shape: Shape): string {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text;
  return shape.note ?? '';
}

/** Note text and anchor point (document space) of a marking — null without a note. */
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
      return null; // text renders itself
  }
}

/**
 * The note as a speech bubble — permanently at the marker (shortened), and on
 * hover at full length right next to the cursor (`at`). A constant screen size,
 * hence /zoom.
 */
interface NoteBubbleOptions {
  /** A different anchor point (on hover: the mouse position). */
  at?: Point;
  /** The visible crop — the bubble stays entirely inside it. */
  view?: View;
  /** Horizontal-only clamping (screenshot): do not render the bubble past the
   *  right frame edge, or the capture cuts it off. */
  clampWidth?: number;
  /** Permanent bubble at the marker: keep it short, long text is cut off. */
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
  // A coloured accent bar on the left rather than a fully coloured frame — the
  // text is indented accordingly.
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
    // The note belongs to the marker and has to stay readable: clamp it into the
    // visible frame crop rather than cutting it off at the edge.
    note.x = Math.max(view.x + edge, Math.min(note.x, view.x + view.w - w - edge));
    note.y = Math.max(view.y + edge, Math.min(note.y, view.y + view.h - h - edge));
  } else if (clampWidth != null) {
    // Screenshot: clamp horizontally only (the document keeps scrolling
    // vertically, horizontally the frame width is fixed) — this prevents the cut
    // on the right.
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
 * What was changed on an element marker, in words: "padding changed", "text +
 * padding changed". `null` when nothing was changed.
 *
 * The pill at the marker used to hold the selector — that is, exactly the piece
 * of information the panel gives anyway and the one you need least when looking
 * at the page. On the page what counts is *what* happened here; where exactly is
 * shown by the frame beneath it.
 */
function changeSummary(shape: ElementShape): string | null {
  const props: string[] = [];
  const add = (name: string) => {
    if (!props.includes(name)) props.push(name);
  };
  if (shape.textChange) add('text');
  // The shorthand rather than the edge: "padding" is enough, "padding-top, padding-left" is not.
  for (const c of shape.styleChanges ?? []) add(c.prop.split('-')[0]!);
  if (props.length === 0) return null;
  // Three names are the limit of readability — beyond that all that counts is
  // that there are more.
  const head = props.slice(0, 3).join(', ');
  const rest = props.length - 3;
  return `${head}${rest > 0 ? ` +${rest}` : ''} changed`;
}

/** One line of an export card. */
interface CardRow {
  text: string;
  /** Monospace (selectors, CSS values) rather than running text. */
  mono?: boolean;
  /** Held back (context rather than statement). */
  dim?: boolean;
}

/**
 * Content of the card for a marking: a header line and detail lines. Element
 * markers carry the scope and every individual change, everything else only its
 * note. `null` when there is nothing to report.
 */
function cardContentOf(shape: Shape): { title: string; rows: CardRow[] } | null {
  const rows: CardRow[] = [];

  if (shape.tool === 'element') {
    const changes = shape.styleChanges ?? [];
    if (changes.length > 0 || shape.textChange) {
      rows.push({
        text:
          (shape.styleScope ?? 'class') === 'class' && shape.styleTarget
            ? `all ${shape.styleTarget}`
            : 'this element only',
        dim: true,
      });
    }
    for (const c of changes) rows.push({ text: `${c.prop}: ${c.from} → ${c.to}`, mono: true });
    if (shape.textChange) {
      rows.push({ text: `text: “${shape.textChange.from}”`, mono: true, dim: true });
      rows.push({ text: `→ “${shape.textChange.to}”`, mono: true });
    }
    if (shape.note) rows.push({ text: shape.note });
    return rows.length > 0 ? { title: shape.label, rows } : null;
  }

  const note = editableTextOf(shape);
  if (!note) return null;
  rows.push({ text: note });
  return { title: TOOL_LABELS[shape.tool], rows };
}

/** Width of the export cards in screen pixels. */
const CARD_W = 232;

/**
 * Column of cards at the right edge of the page for the screenshot export.
 *
 * Each card used to stand right at its marking and therefore covered exactly
 * the content it was about. Now all the cards collect at the edge, each at the
 * height of its marking and without overlapping one another; a thin line with a
 * dot at the target shows what it belongs to, and a number connects card and
 * marking even when the line gets long.
 */
function renderExportCards(shapes: Shape[], zoom: number, frameWidth: number) {
  const entries = shapes
    .map((shape) => ({ shape, content: cardContentOf(shape), bounds: shapeBounds(shape) }))
    .filter(
      (e): e is { shape: Shape; content: { title: string; rows: CardRow[] }; bounds: NonNullable<ReturnType<typeof shapeBounds>> } =>
        e.content != null && e.bounds != null,
    )
    .sort((a, b) => a.bounds.y - b.bounds.y);
  if (entries.length === 0) return null;

  const margin = 12 / zoom;
  // Never wider than the frame: at low zoom, 232 screen pixels would be more
  // than the whole page width and the card would run off to the right.
  const cardW = Math.min(CARD_W / zoom, frameWidth - margin * 2);
  const pad = 9 / zoom;
  const titleSize = 11 / zoom;
  const rowSize = 10 / zoom;
  const lineH = rowSize * 1.45;
  const gap = 10 / zoom;
  const badge = 15 / zoom;
  const x = Math.max(margin, frameWidth - cardW - margin);

  /**
   * Character budget per line, from the *actual* card width. A fixed value was
   * not enough: on narrow frames half of it stood outside. Monospace builds
   * wider than running text, hence two budgets.
   */
  const inner = cardW - (pad + 6 / zoom) - pad;
  const fit = (mono: boolean) => Math.max(8, Math.floor(inner / (rowSize * (mono ? 0.62 : 0.55))));
  /** Wrap lines to the card width — long values stay readable. */
  const wrapped = (rows: CardRow[]): CardRow[] =>
    rows.flatMap((r) =>
      wrapNote(r.text, fit(r.mono === true), 4).map((text) => ({ ...r, text })),
    );

  let cursor = 0;
  return (
    <g className="anno__cards" pointerEvents="none">
      {entries.map((entry, i) => {
        const { shape, content, bounds } = entry;
        const rows = wrapped(content.rows);
        const h = pad * 2 + titleSize * 1.5 + rows.length * lineH;
        // At the height of the marking, but never into the previous card.
        const y = Math.max(cursor, bounds.y);
        cursor = y + h + gap;
        const n = i + 1;

        // Target of the line: the marking's edge nearest the card edge.
        const toX = Math.min(bounds.x + bounds.w, x - 6 / zoom);
        const toY = bounds.y + Math.min(bounds.h / 2, 40 / zoom);
        const fromY = y + h / 2;

        return (
          <g key={`card-${shape.id}`}>
            {/* Leader line: horizontal at the card edge, then to the target. */}
            <path
              d={`M${x},${fromY} L${toX + 10 / zoom},${fromY} L${toX},${toY}`}
              fill="none"
              stroke={shape.color}
              strokeWidth={1.2 / zoom}
              strokeOpacity={0.75}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            />
            <circle cx={toX} cy={toY} r={2.6 / zoom} fill={shape.color} />

            {/* A number at the marking — it stays assignable even when the line
                runs across half a page. */}
            <circle
              cx={bounds.x + badge / 2}
              cy={bounds.y + badge / 2}
              r={badge / 2}
              fill={shape.color}
              stroke="#fff"
              strokeWidth={1.4 / zoom}
            />
            <text
              x={bounds.x + badge / 2}
              y={bounds.y + badge / 2}
              fill="#fff"
              fontSize={badge * 0.62}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily='ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
            >
              {n}
            </text>

            <rect
              x={x}
              y={y}
              width={cardW}
              height={h}
              rx={8 / zoom}
              fill="rgba(14, 16, 20, 0.94)"
              stroke="rgba(255, 255, 255, 0.14)"
              strokeWidth={1 / zoom}
              filter="url(#ink-note-shadow)"
            />
            <rect
              x={x}
              y={y + pad}
              width={3 / zoom}
              height={h - pad * 2}
              rx={1.5 / zoom}
              fill={shape.color}
            />
            <text
              x={x + pad + 6 / zoom}
              y={y + pad + titleSize * 0.9}
              fill="#fff"
              fontSize={titleSize}
              fontWeight={700}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {ellipsisAt(`${n}. ${content.title}`, fit(true))}
            </text>
            {rows.map((row, ri) => (
              <text
                key={ri}
                x={x + pad + 6 / zoom}
                y={y + pad + titleSize * 1.5 + ri * lineH + rowSize * 0.9}
                fill={row.dim ? '#aeb6c6' : '#f2f4f8'}
                fontSize={rowSize}
                fontFamily={
                  row.mono
                    ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
                    : 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
                }
              >
                {row.text}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Label pill: a dark capsule with a coloured border and white text — replaces
 * the earlier text with an outline stroke, which looked restless on colourful
 * pages. A constant screen size, hence /zoom.
 *
 * It sits fixed above its marking (below it at the start of the document) and is
 * *not* clamped into the visible crop: otherwise it would cling to the top frame
 * edge and travel along endlessly while scrolling, long after the marking is
 * gone — and in the screenshot it would reappear at every slice edge.
 */
/**
 * Flag above the element marking: what was changed, and below it the note.
 *
 * The two used to belong to different edges — the change as a pill on top, the
 * note as a speech bubble under the element. Two boxes around the same element
 * that had to be read separately and reassembled in your head; with several
 * markers side by side it was moreover impossible to tell which bubble belonged
 * to which frame. Now everything hangs off one edge. The full note text still
 * comes on hover.
 */
function renderElementTag(shape: ElementShape, zoom: number) {
  const summary = changeSummary(shape);
  // Header line: what happened — and if nothing happened, who it is.
  const head = summary ?? shape.label;
  const headMono = summary == null;
  const noteLines = shape.note ? wrapNote(shape.note, 30, 2) : [];

  const size = 11 / zoom;
  const lineH = size * 1.4;
  const padX = 6 / zoom;
  const padY = 4 / zoom;
  // A typewriter face runs wider than running text — otherwise the box sits
  // either too tight around the selector or too wide around the note.
  const widthOf = (text: string, mono: boolean) => text.length * size * (mono ? 0.62 : 0.55);
  const w =
    Math.max(widthOf(head, headMono), ...noteLines.map((l) => widthOf(l, false))) + padX * 2;
  const h = (1 + noteLines.length) * lineH + padY * 2;
  // If it does not fit above, it goes *below* the element — not on it. The
  // single-line pill used to be allowed to lie against the top edge; with a note
  // the flag is three times as tall and would cover exactly the content it is
  // about.
  const above = shape.y - h - 4 / zoom;
  const box = { x: shape.x, y: above >= 0 ? above : shape.y + shape.h + 4 / zoom };
  const sans = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

  return (
    <g pointerEvents="none">
      <rect
        x={box.x}
        y={box.y}
        width={w}
        height={h}
        rx={Math.min(h / 2, 9 / zoom)}
        fill="rgba(14, 16, 20, 0.92)"
        stroke={shape.color}
        strokeWidth={1 / zoom}
        strokeOpacity={0.6}
      />
      <text
        x={box.x + padX}
        y={box.y + padY + size * 0.82}
        fill="#fff"
        fontSize={size}
        fontWeight={headMono ? 400 : 600}
        fontFamily={headMono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : sans}
      >
        {head}
      </text>
      {/* The note is the sentence about it, not the heading — a shade quieter,
          so that the header line stays the header line. */}
      {noteLines.map((line, i) => (
        <text
          key={i}
          x={box.x + padX}
          y={box.y + padY + size * 0.82 + lineH * (i + 1)}
          fill="rgba(255, 255, 255, 0.82)"
          fontSize={size}
          fontFamily={sans}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function renderLabelPill(
  x: number,
  y: number,
  text: string,
  color: string,
  zoom: number,
  /** Selectors are code, a summary is language. */
  mono = true,
) {
  const size = 11 / zoom;
  const padX = 6 / zoom;
  const padY = 3.5 / zoom;
  const w = text.length * size * (mono ? 0.62 : 0.55) + padX * 2;
  const h = size + padY * 2;
  const above = y - h - 4 / zoom;
  const box = { x, y: above >= 0 ? above : y + 4 / zoom };
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
        strokeOpacity={0.6}
      />
      <text
        x={box.x + padX}
        y={box.y + padY + size * 0.82}
        fill="#fff"
        fontSize={size}
        fontWeight={mono ? 400 : 600}
        fontFamily={
          mono
            ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
            : 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
        }
      >
        {text}
      </text>
    </g>
  );
}

/** Tile size and stroke width of the spacing hatching (screen pixels). */
const HATCH_TILE = 8;
const HATCH_STROKE = 1.7;
/**
 * Two strokes per tile: one strongly saturated, one almost white. A single tone
 * is lost depending on the ground — a pale green on a yellow button is
 * practically invisible, and a light one on a white ground too. That way at
 * least one of the two strokes always carries.
 */
const HATCH_MARGIN = {
  fill: 'rgba(246, 178, 107, .16)',
  stripe: 'rgba(214, 122, 24, .8)',
  // Margin almost always lies on a quiet page background and hardly needs the
  // counter-stroke — it stays faint, so that it does not drown out the padding.
  stripeAlt: 'rgba(255, 246, 232, .28)',
};
const HATCH_PADDING = {
  fill: 'rgba(147, 196, 125, .22)',
  stripe: 'rgba(46, 142, 52, .92)',
  stripeAlt: 'rgba(238, 255, 238, .6)',
};
/** Edge of the content area — bounds the padding area on the inside. */
const PADDING_EDGE = 'rgba(56, 152, 62, .95)';

/**
 * Box model visualisation for the element picker (the Figma dev-mode metaphor):
 * margin areas hatched in orange, padding areas in green, values as mini pills
 * when the strip offers enough room. Negative margins are not drawn.
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
  // Hatching rather than a solid area: on colourful pages a flat tone
  // disappears, whereas the stripes stay readable as "there is spacing here" on
  // any background. Margin and padding run in opposite directions — telling them
  // apart works even without colour.
  const tile = HATCH_TILE / zoom;
  // The id has to carry the zoom: several frames share one shadow tree, and the
  // same id would pull the first frame's pattern onto all the others.
  const patternId = (kind: 'm' | 'p') => `ink-hatch-${kind}-${Math.round(zoom * 1000)}`;
  return (
    <g pointerEvents="none">
      <defs>
        {(['m', 'p'] as const).map((kind) => {
          const c = kind === 'm' ? HATCH_MARGIN : HATCH_PADDING;
          return (
            <pattern
              key={kind}
              id={patternId(kind)}
              patternUnits="userSpaceOnUse"
              width={tile}
              height={tile}
              patternTransform={`rotate(${kind === 'm' ? -45 : 45})`}
            >
              <rect width={tile} height={tile} fill={c.fill} />
              <line
                x1={tile * 0.25}
                y1={0}
                x2={tile * 0.25}
                y2={tile}
                stroke={c.stripe}
                strokeWidth={HATCH_STROKE / zoom}
              />
              <line
                x1={tile * 0.75}
                y1={0}
                x2={tile * 0.75}
                y2={tile}
                stroke={c.stripeAlt}
                strokeWidth={HATCH_STROKE / zoom}
              />
            </pattern>
          );
        })}
      </defs>
      {strips.map((s, i) => (
        <rect
          key={i}
          x={s.x}
          y={s.y}
          width={Math.max(0, s.w)}
          height={Math.max(0, s.h)}
          fill={`url(#${patternId(s.kind)})`}
        />
      ))}
      {/* Inner edge of the padding: the hatching alone is lost on a light
          element, whereas the line reliably shows where the content begins. */}
      {(p.t > 0 || p.r > 0 || p.b > 0 || p.l > 0) && (
        <rect
          x={t.x + p.l}
          y={t.y + p.t}
          width={Math.max(0, t.w - p.l - p.r)}
          height={Math.max(0, t.h - p.t - p.b)}
          fill="none"
          stroke={PADDING_EDGE}
          strokeWidth={1.2 / zoom}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
        />
      )}
      {strips
        .filter((s) => s.v >= 2 && Math.min(s.w, s.h) * zoom >= 11)
        .map((s, i) => {
          const label = String(Math.round(s.v));
          const w = label.length * labelSize * 0.65 + 8 / zoom;
          const h = labelSize + 5 / zoom;
          // Centre of the visible part of the strip — with a partly scrolled-out
          // element the pill stays on the strip instead of running out of view.
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
 * Measuring tape between the two lines of a pair: a run with end caps across
 * the lines, and beside it the gap in document pixels. A constant screen size,
 * hence /zoom.
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
  // Horizontal pair: the label to the right of the tape; vertical pair: above
  // it — that way it never covers the distance being measured.
  const labelX = horizontal ? cross + 9 / zoom : mid;
  const labelY = horizontal ? mid : cross - 14 / zoom;
  const padX = 5 / zoom;
  const padY = 3 / zoom;
  const boxW = label.length * size * 0.62 + padX * 2;
  const boxH = size + padY * 2;
  // Lines drawn at the edge: the label slides into the visible crop rather than
  // disappearing beside the frame.
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

/**
 * A plain frame on the measured edges — the element marking.
 *
 * Deliberately different from the freehand rectangle marking: this one does not
 * sit where somebody dragged, but exactly on the frame of a real DOM element.
 * A skew and a retraced outline would blur precisely the statement it is about
 * — *this* element, *this* extent. Anyone reading the value in the panel has to
 * find it again on the frame.
 *
 * Highlighting therefore runs over stroke weight and area, never over the shape:
 * on hover the edges lie in the same place as at rest.
 */
function renderElementBox(
  shape: Shape,
  box: { x: number; y: number; w: number; h: number },
  strokeWidth: number,
  fillOpacity: number,
  zoom: number,
  emphasis: Emphasis,
) {
  const active = emphasis !== 'none';
  // Radius in screen pixels, but never more than half the edge — otherwise the
  // marking around a flat element turns into a capsule.
  const r = Math.min(CORNER_PX / zoom, box.w / 2, box.h / 2);
  return (
    <rect
      key={shape.id}
      x={box.x}
      y={box.y}
      width={box.w}
      height={box.h}
      rx={r}
      ry={r}
      fill={shape.color}
      fillOpacity={active ? fillOpacity * 1.6 : fillOpacity}
      stroke={shape.color}
      strokeWidth={active ? strokeWidth * 1.25 : strokeWidth}
      strokeOpacity={active ? 1 : 0.8}
      filter={emphasis === 'drag' ? 'url(#ink-note-shadow)' : undefined}
    />
  );
}

/**
 * A hand-drawn frame around a box — the rectangle marking. Here the handwriting
 * is right: the frame was drawn by hand and looks the part.
 *
 * Hover retraces the outline a second time (as if gone over with the pen) and
 * raises the weight; while dragging, the marking additionally lifts slightly and
 * casts a shadow.
 */
function renderSketchBox(
  shape: Shape,
  box: { x: number; y: number; w: number; h: number },
  strokeWidth: number,
  fillOpacity: number,
  emphasis: Emphasis,
) {
  const variant = sketchVariantOf(shape.id);
  const { outline, heavy, tilt } = sketchRect(box.x, box.y, box.w, box.h, variant);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const active = emphasis !== 'none';
  // A second outline on hover: a different variant, slightly rotated — the frame
  // looks as though it had been gone over a second time.
  const retrace = active
    ? sketchRect(box.x, box.y, box.w, box.h, SKETCH_VARIANTS[
        (SKETCH_VARIANTS.indexOf(variant) + 1) % SKETCH_VARIANTS.length
      ]!)
    : null;
  const lift = emphasis === 'drag' ? 1.015 : 1;

  return (
    <g
      key={shape.id}
      transform={
        `rotate(${tilt} ${cx} ${cy})` +
        (lift === 1 ? '' : ` translate(${cx} ${cy}) scale(${lift}) translate(${-cx} ${-cy})`)
      }
      filter={emphasis === 'drag' ? 'url(#ink-note-shadow)' : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={outline} fill={shape.color} fillOpacity={active ? fillOpacity * 1.6 : fillOpacity} />
      {retrace && (
        <path
          d={retrace.outline}
          fill="none"
          stroke={shape.color}
          strokeWidth={strokeWidth * 0.8}
          strokeOpacity={0.4}
        />
      )}
      <path
        d={outline}
        fill="none"
        stroke={shape.color}
        strokeWidth={active ? strokeWidth * 1.25 : strokeWidth}
        strokeOpacity={active ? 1 : 0.8}
      />
      {/* Heavier sides — gives the stroke its brush-like feel. */}
      <path
        d={heavy}
        fill="none"
        stroke={shape.color}
        strokeWidth={(active ? strokeWidth * 1.25 : strokeWidth) * 1.5}
        strokeOpacity={active ? 1 : 0.8}
      />
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
  emphasis: Emphasis = 'none',
) {
  const stroke ={ stroke: shape.color, strokeWidth, fill: 'none' } as const;

  switch (shape.tool) {
    case 'element':
      return (
        <g key={shape.id}>
          {renderElementBox(shape, shape, strokeWidth, 0.08, zoom, emphasis)}
          {renderElementTag(shape, zoom)}
        </g>
      );
    case 'pin': {
      // Pins keep a constant screen size, hence /zoom.
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
        <g
          key={shape.id}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...stroke}
          strokeWidth={PEN_STROKE_PX / zoom}
        >
          {(shape.strokes ?? []).map((points, i) => (
            <polyline key={i} points={points.map((p) => `${p.x},${p.y}`).join(' ')} />
          ))}
        </g>
      );
    case 'rect':
      return renderSketchBox(
        shape,
        {
          x: Math.min(shape.x1, shape.x2),
          y: Math.min(shape.y1, shape.y2),
          w: Math.abs(shape.x2 - shape.x1),
          h: Math.abs(shape.y2 - shape.y1),
        },
        strokeWidth,
        0.05,
        emphasis,
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
          strokeOpacity={0.75}
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
      // Extended past the frame — the viewport clips it, so the line spans the
      // full width/height at any scroll position.
      const horizontal = shape.tool === 'hline';
      const lineAt = (v: number) =>
        horizontal
          ? `M${shape.x - LINE_REACH},${v} L${shape.x + LINE_REACH},${v}`
          : `M${v},${shape.y - LINE_REACH} L${v},${shape.y + LINE_REACH}`;
      const start = horizontal ? shape.y : shape.x;
      const gap = lineGap(shape);
      // The measured strip gets a diamond pattern — discreet enough to leave the
      // content underneath readable, but clearly an area.
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
      // A dark capsule with a coloured border rather than text with an outline stroke.
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
