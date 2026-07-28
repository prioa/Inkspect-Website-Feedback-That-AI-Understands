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
  /** Logische Viewport-Groesse des Frames (unskaliert). */
  width: number;
  height: number;
  zoom: number;
  /** Nur im Korrekturmodus faengt das Overlay Pointer-Events ab. */
  active: boolean;
  shapes: Shape[];
  /**
   * Element-Marker, deren gespeicherte CSS-Aenderungen angewendet bleiben —
   * unabhaengig davon, ob die Marker (roten Rahmen) sichtbar sind. So kann man
   * im Dev-Modus die Korrektur *sehen*, ohne die Markierungen einzublenden.
   * Faellt zurueck auf `shapes`, wenn nicht gesetzt.
   */
  styleShapes?: Shape[];
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
  /**
   * Gerade fertiggestellte Markierung bei ausgeblendeten Markern — sie bleibt
   * kurz stehen und blendet dann weich aus, statt hart zu verschwinden.
   */
  fadingShapeId?: string | null;
  /** Marker, dessen Panel-Eintrag gerade gehovert wird — ruhig hervorheben. */
  hoverShapeId?: string | null;
  /** Doppelklick auf einen Marker (App): Notiz-Editor mit dem Text oeffnen. */
  editRequest?: NoteEditRequest | null;
  onAdd: (shape: Shape) => void;
  onSetNote: (shapeId: string, note: string) => void;
  /**
   * Nachtraegliche Aenderungen an einem Element-Marker uebernehmen — das
   * Popup laesst sich per Klick auf das markierte Element wieder oeffnen.
   */
  onUpdateShape?: (shapeId: string, patch: ElementShapePatch) => void;
  /** Markierung loeschen (Bestaetigung uebernimmt die App). */
  onDeleteShape?: (shapeId: string) => void;
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

/** Beim erneuten Speichern eines Element-Markers aenderbare Felder. */
export type ElementShapePatch = Partial<
  Pick<
    ElementShape,
    'x' | 'y' | 'w' | 'h' | 'note' | 'styleChanges' | 'styleTarget' | 'styleScope' | 'textChange'
  >
>;

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

/** Bounding-Box im Dokumentraum (Live-Messung eines Element-Markers). */
interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_DRAG = 3;
/** Toleranz um die Marker-Box fuer den Notiz-Hover (Dokument-Pixel). */
const HOVER_PAD = 8;

/**
 * Handgezeichnete Rahmen („comic style") statt sauberer Rechtecke. Portiert
 * die CSS-Vorlage nach SVG: pro Ecke ein *Paar* Radien (waagerecht/senkrecht),
 * die sich stark unterscheiden — eine Ecke laeuft fast ueber die ganze Kante,
 * die gegenueberliegende bleibt spitz. Dazu ungleiche Strichstaerken (links
 * und unten kraeftiger, wie mit dem Pinsel gezogen) und eine leichte Drehung.
 *
 * Prozentwerte wie in CSS: waagerechte Radien beziehen sich auf die Breite,
 * senkrechte auf die Hoehe — jeweils im Uhrzeigersinn ab links oben.
 */
interface SketchVariant {
  /** [TL, TR, BR, BL] — Anteil der Breite. */
  rx: [number, number, number, number];
  /** [TL, TR, BR, BL] — Anteil der Hoehe. */
  ry: [number, number, number, number];
  /** Kraeftiger gezogene Seiten. */
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
 * Unter dieser Kantenlaenge (Dokument-Pixel) waere die grosse Rundung nicht
 * mehr lesbar — dort bleibt es bei einer dezent angeschraegten Box.
 */
const SKETCH_MIN = 26;

/** Stabile Variante je Markierung: dieselbe Id ergibt immer dieselbe Form. */
function sketchVariantOf(id: string): SketchVariant {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return SKETCH_VARIANTS[Math.abs(hash) % SKETCH_VARIANTS.length]!;
}

interface SketchPaths {
  /** Geschlossene Kontur. */
  outline: string;
  /** Nur die kraeftigen Seiten — als zweiter, dickerer Strich obenauf. */
  heavy: string;
  /** Drehung in Grad um die Mitte der Box. */
  tilt: number;
}

/**
 * Baut die Pfade eines handgezeichneten Rahmens. Ueberlappende Radien werden
 * wie in CSS proportional heruntergerechnet, sonst wuerden sich die Boegen
 * benachbarter Ecken auf einer kurzen Kante ueberschneiden.
 */
function sketchRect(
  x: number,
  y: number,
  w: number,
  h: number,
  variant: SketchVariant,
): SketchPaths {
  const tiny = w < SKETCH_MIN || h < SKETCH_MIN;
  // Zu kleine Boxen: Rundung stark zuruecknehmen, Schieflage bleibt.
  const damp = tiny ? 0.12 : 1;
  /**
   * Bewusste Abweichung von der CSS-Vorlage: dort sind die Boxen quadratisch,
   * ein Radius von 95% der Breite sieht deshalb gut aus. Eine Markierung um
   * ein 900x44-Element wuerde damit zur Linse — die Ecken des Elements laegen
   * ausserhalb. Die kuerzere Kante deckelt darum alle Radien; die Handschrift
   * (eine weit ausholende Ecke, die gegenueberliegende spitz) bleibt erhalten.
   */
  const cap = Math.min(w, h) * 0.9;
  const rx = variant.rx.map((v) => Math.min(v * damp * w, cap));
  const ry = variant.ry.map((v) => Math.min(v * damp * h, cap));

  // CSS-Regel: passen zwei Radien nicht auf ihre gemeinsame Kante, werden
  // *alle* mit demselben Faktor verkleinert.
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

/** Wie stark eine Markierung gerade hervorgehoben wird. */
type Emphasis = 'none' | 'hover' | 'drag';

/** Markierungen, die als handgezeichnete Box gerendert werden. */
function isSketchShape(shape: Shape): boolean {
  return shape.tool === 'rect' || shape.tool === 'element';
}

/**
 * Aktions-Knoepfe im sichtbaren Frame halten (Bildschirm-Pixel). `margin`
 * ist die halbe Ausdehnung der Leiste — sie ist um ihren Punkt zentriert.
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
 * Konturstaerke der Markierungen in Bildschirm-Pixeln. Bewusst duenn: die
 * Rahmen sollen den Inhalt einfassen, nicht zudecken — die Farbe traegt die
 * Aussage, nicht die Dicke.
 */
const STROKE_PX = 1.6;
/** Freihand bleibt kraeftiger — ein hauchduenner Kritzelstrich wirkt zittrig. */
const PEN_STROKE_PX = 2.4;
/** Eckenradius der Rahmen in Bildschirm-Pixeln. */
const CORNER_PX = 5;

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

const numOf = (v: string) => Number.parseFloat(v) || 0;

/** Bounding-Box, Label und Box-Model eines Elements (Dokumentraum). */
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
 * Laengster direkter Textknoten mit Inhalt. Nur er wird bearbeitet: einfach
 * `textContent` zu setzen wuerde Kind-Elemente (Icons, <span>) mit wegwerfen.
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

/** Direktes, nicht-leeres Text-Kind? Nur dann sind Font-Regler und Textfeld sinnvoll. */
function hasDirectText(el: Element): boolean {
  return directTextNode(el) != null;
}

/** Sichtbarer Text des Elements, ohne die Einrueckung aus dem Quelltext. */
function directTextOf(el: Element): string {
  return directTextNode(el)?.textContent?.trim() ?? '';
}

/**
 * Text des Elements ersetzen. Die umgebenden Leerzeichen des Knotens bleiben
 * stehen — sonst klebt der Text an benachbarten Inline-Elementen.
 */
function writeDirectText(el: Element, value: string): void {
  const node = directTextNode(el);
  if (!node) return;
  const raw = node.textContent ?? '';
  const lead = /^\s*/.exec(raw)![0];
  const tail = /\s*$/.exec(raw)![0];
  node.textContent = `${lead}${value}${tail}`;
}

/** Vom Popup bearbeitbare Eigenschaften — fuer den Reset in beiden Scopes. */
const EDITABLE_PROPS = [
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-weight', 'font-size', 'max-width',
];

/** Klassen-Selektor des Elements (`.a.b`), Tailwind-sicher escaped. */
function classSelectorOf(el: Element): string | null {
  const parts = Array.from(el.classList);
  if (parts.length === 0) return null;
  try {
    return parts.map((c) => `.${CSS.escape(c)}`).join('');
  } catch {
    return null;
  }
}

const PICKER_STYLE_ID = '__dv-picker-css__';

/**
 * Liefert die CSSStyleDeclaration einer vom Picker verwalteten Regel im Frame
 * (Klassen-Scope). Ein eigenes <style> haelt die Regeln; so wirken Aenderungen
 * live auf alle Elemente mit dieser Klasse, bis Reset oder Reload.
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
 * Welche Margin-Seiten stehen im CSS auf `auto`? `getComputedStyle` verraet das
 * nicht — es liefert fuer Margins den *benutzten* Wert, aus `margin: 0 auto`
 * wird dort z. B. `448px`. Die Typed-OM-Variante gibt dagegen den berechneten
 * Wert und damit `auto` zurueck. Wo es sie nicht gibt (Firefox), erkennt der
 * Rueckfall wenigstens die waagerechte Zentrierung an der Geometrie.
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
        /* Eigenschaft nicht lesbar */
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
  // Element plus beide Margins fuellt den Elternteil genau aus -> auto-zentriert.
  if (Math.abs(inner - (el.offsetWidth + ml + mr)) < 2) {
    out.l = true;
    out.r = true;
  }
  return out;
}

/** Vollstaendiger Picker-Zustand inkl. lebendem DOM-Bezug und Font-Werten. */
function buildSelected(el: HTMLElement, win: Window): SelectedTarget {
  const cs = win.getComputedStyle(el);
  const maxWidthRaw = cs.maxWidth && cs.maxWidth !== 'none' ? cs.maxWidth : null;
  return {
    ...measureTarget(el, win),
    el,
    tag: el.tagName.toLowerCase(),
    autoMargin: autoMarginSides(el, win),
    maxWidthRaw,
    // Nur px sind als Zahl bedienbar; `80%` oder `60ch` bleiben Anzeige.
    maxWidth: maxWidthRaw?.endsWith('px') ? numOf(maxWidthRaw) : null,
    fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
    fontSize: numOf(cs.fontSize),
    hasText: hasDirectText(el),
    text: directTextOf(el),
  };
}

const ALL_EDGES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * Gespeicherte Aenderungen eines Markers wieder auf die Seite anwenden — beim
 * erneuten Oeffnen des Popups (auch nach einem Reload) zeigt die Vorschau dann
 * wieder die Sollwerte und laesst sich von dort weiterbearbeiten.
 */
function applyStoredChanges(shape: ElementShape, el: HTMLElement, doc: Document): void {
  // Text haengt am Element selbst, nie an einer Klassenregel.
  if (shape.textChange) writeDirectText(el, shape.textChange.to);
  const changes = shape.styleChanges ?? [];
  if (changes.length === 0) return;
  const classSel = classSelectorOf(el);
  const target =
    (shape.styleScope ?? 'class') === 'class' && classSel
      ? pickerRuleStyle(doc, classSel)
      : el.style;
  for (const c of changes) {
    if (c.prop === 'margin' || c.prop === 'padding') {
      for (const edge of ALL_EDGES) target?.setProperty(`${c.prop}-${edge}`, c.to, 'important');
    } else {
      target?.setProperty(c.prop, c.to, 'important');
    }
  }
}

/** Gegenstueck zu `applyStoredChanges` — nimmt die Eigenschaften wieder zurueck. */
function removeStoredChanges(shape: ElementShape, el: HTMLElement, doc: Document): void {
  if (shape.textChange) writeDirectText(el, shape.textChange.from);
  const changes = shape.styleChanges ?? [];
  if (changes.length === 0) return;
  const classSel = classSelectorOf(el);
  const target =
    (shape.styleScope ?? 'class') === 'class' && classSel
      ? pickerRuleStyle(doc, classSel)
      : el.style;
  for (const c of changes) {
    if (c.prop === 'margin' || c.prop === 'padding') {
      for (const edge of ALL_EDGES) target?.removeProperty(`${c.prop}-${edge}`);
    } else {
      target?.removeProperty(c.prop);
    }
  }
}

/**
 * Ausgangswerte fuer die Aenderungsliste beim Wieder-Oeffnen: aktuelle Messung,
 * ueberschrieben mit den gespeicherten Vorher-Werten des Markers — der Diff
 * laeuft so weiter gegen das unveraenderte Original, nicht gegen Zwischenstaende.
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
  dimmedIds,
  lockedIds,
  tool,
  color,
  frameEl,
  loadCount,
  showNotes = false,
  flashShapeId = null,
  flashNonce = 0,
  fadingShapeId,
  hoverShapeId = null,
  editRequest = null,
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
   * Per Klick fixiertes Element — bleibt stehen, damit sich sein Box-Model
   * (Margin/Padding) und ggf. der Font live im Popup bearbeiten lassen.
   */
  const [selected, setSelected] = useState<SelectedTarget | null>(null);
  /**
   * Zielt eine Aenderung auf die ganze Klasse (Standard, wirkt auf alle
   * Elemente mit dieser Klasse) oder nur auf das einzelne Element?
   */
  const [scope, setScope] = useState<'class' | 'element'>('class');
  /**
   * Alle vier Seiten gemeinsam bearbeiten — fuer Margin und Padding getrennt,
   * weil man meist nur eines von beiden gleichmaessig haelt.
   */
  const [linked, setLinked] = useState<LinkedSides>({ margin: false, padding: false });
  /** Notiz-Entwurf im Popup — wird beim Uebernehmen mit dem Marker gespeichert. */
  const [popupNote, setPopupNote] = useState('');
  /**
   * Textfeld des Popups. Eigener State statt direkt aus dem DOM gelesen: beim
   * Zurueckschreiben trimmt die Messung, ein getipptes Leerzeichen wuerde sonst
   * mitten im Wort verschwinden. Null = kein Text am Element.
   */
  const [textEdit, setTextEdit] = useState<string | null>(null);
  /** Wieder geoeffneter Element-Marker — Speichern aktualisiert ihn statt neu anzulegen. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Vom Nutzer per Drag gewaehlte Popup-Position (Viewport-Pixel) — null = automatisch. */
  const [popupPos, setPopupPos] = useState<Point | null>(null);
  const [popupDragging, setPopupDragging] = useState(false);
  /** Laufende Drag-Geste am Popup-Kopf (Griffpunkt relativ zur Popup-Ecke). */
  const popupDragRef = useRef<{ dx: number; dy: number; pointerId: number } | null>(null);
  /**
   * Gemessene Popup-Groesse — damit die Platzierung gegen die *echte* Kante
   * klemmt und nicht gegen geschaetzte Konstanten. Startwert entspricht dem
   * Panel mit Text-, Font- und Notizfeld.
   */
  const [popupSize, setPopupSize] = useState({ w: 300, h: 480 });
  const popupObsRef = useRef<ResizeObserver | null>(null);
  /** Ausgangswerte beim Fixieren — Basis fuer die Aenderungsliste im Feedback. */
  const originalRef = useRef<{
    margin: BoxEdges;
    padding: BoxEdges;
    fontWeight: number;
    fontSize: number;
    maxWidth: number | null;
    text: string;
  } | null>(null);
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

  /**
   * Live-Geometrie der Element-Marker (Doc-Koordinaten), neu vermessen wenn
   * sich Layout aendert — vor allem beim An/Aus der gespeicherten CSS-
   * Aenderungen: die Seite fliesst dann um, und der rote Rahmen soll am
   * Element kleben bleiben statt an der urspruenglichen Stelle.
   */
  const [elemRects, setElemRects] = useState<Record<string, BoxRect>>({});
  const displayShapes: Shape[] = shapes.map((s) =>
    s.tool === 'element' && elemRects[s.id] ? { ...s, ...elemRects[s.id] } : s,
  );
  const dimmed = dimmedIds;

  /** Eigene Markierung — fremde (importierte) bleiben, wo der Ersteller sie setzte. */
  const mine = (s: Shape) => isMovableShape(s) && !lockedIds?.has(s.id);

  // Kein veralteter Hover-Rahmen, wenn Werkzeug/Modus wechseln. Auch das
  // fixierte Element loslassen — der DOM-Bezug gilt nur im Element-Werkzeug.
  useEffect(() => {
    setPicked(null);
    setSelected(null);
    setEditingId(null);
    setPopupNote('');
    setTextEdit(null);
    setLineGhost(null);
  }, [tool, active]);

  // Frame-Reload macht den DOM-Bezug des fixierten Elements ungueltig.
  useEffect(() => {
    setSelected(null);
    setEditingId(null);
  }, [loadCount]);

  /**
   * Gespeicherte Stil-Aenderungen verhalten sich wie die Marker selbst:
   * nach jedem Frame-Load wieder anwenden (kein Reset beim Seiten-Reload)
   * und zuruecknehmen, sobald das Feedback ausgeblendet oder der Eintrag
   * geloescht wird — `shapes` ist bereits die sichtbarkeitsgefilterte
   * Liste des Devices.
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
      /* Frame nicht lesbar */
    }
    return () => {
      try {
        for (const [s, el] of applied) removeStoredChanges(s, el, win.document);
      } catch {
        /* Frame schon entladen */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleSig, frameEl, loadCount]);

  // Element-Marker an ihrer *aktuellen* Element-Position vermessen. Laeuft per
  // rAF, also nach dem Anwenden/Zuruecknehmen der CSS-Aenderungen (der Reflow
  // ist dann fertig) — der rote Rahmen springt so mit dem Element mit.
  const elemSig = shapes
    .filter((s): s is ElementShape => s.tool === 'element')
    .map((s) => `${s.id}:${s.selector ?? ''}`)
    .join('|');
  useEffect(() => {
    const win = frameEl?.contentWindow;
    if (!win) return;
    // Eigene rAF (nicht die des Frames!): ein cross-origin-blockierter Frame
    // wirft schon beim Zugriff auf window.cancelAnimationFrame einen
    // SecurityError. Die Frame-Reads selbst stehen im try/catch.
    const raf = requestAnimationFrame(() => {
      const next: Record<string, BoxRect> = {};
      try {
        const doc = win.document;
        const sx = win.scrollX;
        const sy = win.scrollY;
        for (const s of shapes) {
          if (s.tool !== 'element' || !s.selector) continue;
          const el = findByShadowPath(doc, s.selector.split(' >>> '));
          if (!el) continue;
          const r = (el as HTMLElement).getBoundingClientRect();
          next[s.id] = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
        }
      } catch {
        return; // Frame nicht lesbar — dann bleiben die gespeicherten Koordinaten
      }
      setElemRects(next);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elemSig, styleSig, scroll.x, scroll.y, loadCount, frameEl]);

  // Nach Scroll die Geometrie des fixierten Elements neu vermessen, damit
  // Box-Model-Overlay und Popup am Element kleben bleiben.
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
  // Interaktionsmodus im Frame landen) oder Edit aus dem Feedback-Panel:
  // Element-Marker oeffnen ihr Bearbeiten-Popup wieder, alle anderen den
  // Notiz-Editor mit dem vorhandenen Text am Klickpunkt.
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

  // Notiz eines Markers beim Ueberfahren einblenden. Getroffen wird per
  // Bounding-Box-Mathe statt per Hit-Element im SVG — so schluckt das Overlay
  // im Interaktionsmodus keine Klicks, die zur Seite gehoeren. Die Blase
  // haengt an der Mausposition (Dokumentraum) und laeuft mit.
  const [hoverNote, setHoverNote] = useState<{ id: string; x: number; y: number } | null>(null);
  const notedShapes = displayShapes.filter((s) => !dimmed?.has(s.id) && noteOf(s) != null);
  const notedRef = useRef(notedShapes);
  notedRef.current = notedShapes;

  /**
   * Markierung unterm Cursor — sie bekommt die Aktions-Knoepfe (Bearbeiten,
   * Loeschen) eingeblendet; Element-Marker zusaetzlich einen kraeftigeren
   * Rahmen als Hinweis auf das Bearbeiten-Popup.
   */
  const [hoverElemId, setHoverElemId] = useState<string | null>(null);
  /** Zeiger sitzt auf den Aktions-Knoepfen (Bearbeiten/Loeschen) — Hover halten. */
  const actionHoverRef = useRef(false);
  /**
   * Verzoegertes Loeschen des Element-Hovers: der Weg vom Marker hoch zu den
   * Aktions-Knoepfen fuehrt kurz durch „leeren" Raum — ohne Nachlauf wuerden
   * die Knoepfe verschwinden, bevor der Zeiger sie erreicht.
   */
  const hoverClearTimer = useRef(0);
  const setHoverElem = (id: string | null) => {
    window.clearTimeout(hoverClearTimer.current);
    setHoverElemId(id);
  };
  /**
   * Hover mit Nachlauf loeschen. Die Aktions-Leiste liegt als eigenes Element
   * ueber dem Frame: sobald der Zeiger sie erreicht, hoert die Maus-Bewegung
   * im Frame auf zu feuern und das Overlay meldet „verlassen". Ohne Nachlauf
   * raeumte das den Hover ab, waehrend der Zeiger noch unterwegs zu den
   * Knoepfen ist — sie blitzten einmal auf und waeren dann nicht mehr
   * erreichbar.
   */
  const clearHoverSoon = () => {
    window.clearTimeout(hoverClearTimer.current);
    hoverClearTimer.current = window.setTimeout(() => {
      if (!actionHoverRef.current) setHoverElemId(null);
    }, 260);
  };
  useEffect(() => () => window.clearTimeout(hoverClearTimer.current), []);
  /**
   * Markierungen, die sich hier bearbeiten lassen: abgehakte (ausgegraute)
   * und fremde (gesperrte) bleiben aussen vor — fuer sie gibt es weder
   * Stift noch Loeschen.
   */
  const hoverableShapes = displayShapes.filter(
    (s) => !dimmed?.has(s.id) && !lockedIds?.has(s.id),
  );
  const hoverableRef = useRef(hoverableShapes);
  hoverableRef.current = hoverableShapes;

  const updateHover = (x: number, y: number) => {
    const id = hitNote(x, y);
    setHoverNote(id ? { id, x, y } : null);
    // Solange der Zeiger auf den Aktions-Knoepfen sitzt, den Hover halten.
    if (actionHoverRef.current) return;
    // Verschachtelte Markierungen: die *kleinste* treffende waehlen (die
    // spezifischste), damit auch ein Marker in einem Marker hoverbar ist —
    // nicht bloss der zuletzt gezeichnete. Hilfslinien spannen den ganzen
    // Frame und landen dadurch von selbst hinten.
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
      // Nicht sofort loeschen — dem Zeiger Zeit lassen, die Knoepfe zu treffen.
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
      // `relatedTarget == null` heisst: der Zeiger hat das Frame-Dokument
      // verlassen. Das passiert auch auf dem Weg zur Aktions-Leiste, denn die
      // liegt als Element des Overlays *ueber* dem Frame — deshalb mit
      // Nachlauf raeumen, sonst verschwinden die Knoepfe genau dann, wenn man
      // sie anfassen will.
      if (e.relatedTarget == null) {
        setHoverNote(null);
        clearHoverSoon();
      }
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
      // Durch `zoom` teilen: der Frame ist skaliert dargestellt, also muss die
      // Scroll-Strecke im Frame-Raum groesser sein, damit sich der Inhalt am
      // Bildschirm genauso schnell bewegt wie beim nativen Scrollen (sonst
      // kriecht die Seite bei Fit-to-Width-Zoom < 1).
      const k = factor / (zoom || 1);
      try {
        frameEl?.contentWindow?.scrollBy(e.deltaX * k, e.deltaY * k);
      } catch {
        /* Frame nicht lesbar */
      }
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [active, frameEl, zoom]);

  /**
   * Callback-Ref am Panel: haelt `popupSize` aktuell, damit die Klemmung der
   * Wirklichkeit folgt (Text- und Font-Zeile fehlen je nach Element, die
   * Aenderungsliste waechst beim Bearbeiten).
   *
   * Muss *vor* dem `return null` weiter unten stehen: Hooks duerfen nicht an
   * einem Ausstieg vorbeilaufen, sonst rendert ein leeres Overlay weniger
   * Hooks als ein volles (React-Fehler #300).
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

  // Ausblenden nur, wenn wirklich nichts zu tun ist. Bei ausgeblendeten
  // Markern mit gespeicherten CSS-Aenderungen bleibt das Overlay gemountet,
  // sonst wuerde der Cleanup die Aenderungen von der Seite zuruecknehmen —
  // die Wirkung (Fonts/Padding) soll im Dev-Modus sichtbar bleiben.
  if (!active && shapes.length === 0 && styledShapes.length === 0) return null;

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
        // Element-Marker: Bearbeiten-Popup wieder oeffnen statt Notiz-Editor.
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

  /** Element unter dem Cursor im Frame-Dokument bestimmen. */
  const elementAt = (e: ReactPointerEvent, win: Window): HTMLElement | null => {
    const rect = svgRef.current!.getBoundingClientRect();
    const el = deepElementFromPoint(
      win.document,
      (e.clientX - rect.left) / zoom,
      (e.clientY - rect.top) / zoom,
    );
    if (!el || el.tagName === 'HTML') return null;
    return el as HTMLElement;
  };

  const pickAt = (e: ReactPointerEvent): ElementTarget | null => {
    const win = frameEl?.contentWindow;
    if (!win) return null;
    try {
      const el = elementAt(e, win);
      return el ? measureTarget(el, win) : null;
    } catch {
      return null; // Frame nicht lesbar
    }
  };

  /** Element per Klick fixieren — inkl. lebendem DOM-Bezug und Font-Werten. */
  const selectAt = (e: ReactPointerEvent): SelectedTarget | null => {
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
   * Mehrere Eigenschaften live setzen und neu vermessen — so folgen Overlay und
   * Popup-Werte sofort. Klassen-Scope schreibt in eine verwaltete Regel (wirkt
   * auf alle Elemente der Klasse), Element-Scope inline. Beide mit `important`,
   * damit die Aenderung sichtbar wird und Element-Scope die Klassenregel schlaegt.
   * Nicht persistent ueber einen Reload (wie DevTools).
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
      /* Frame nicht mehr lesbar */
    }
  };

  const setStyle = (prop: string, value: string) => writeStyles([[prop, value]]);

  /**
   * Text des fixierten Elements live in der Seite ersetzen. Das Layout fliesst
   * dabei um — deshalb anschliessend neu vermessen, damit Rahmen und Box-Model
   * am Element bleiben.
   */
  const writeText = (value: string) => {
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    setTextEdit(value);
    if (!el || !win) return;
    try {
      writeDirectText(el, value);
      setSelected(buildSelected(el, win));
    } catch {
      /* Frame nicht mehr beschreibbar */
    }
  };

  /** Margin/Padding setzen — bei aktivem Link alle vier Seiten zugleich. */
  const editSpacing = (kind: SpacingKind, edge: Edge, v: number) => {
    const value = `${kind === 'padding' ? Math.max(0, v) : v}px`;
    const edges = linked[kind] ? ALL_EDGES : [edge];
    writeStyles(edges.map((e) => [`${kind}-${e}`, value]));
  };

  /**
   * Eine einzelne Aenderung zuruecknehmen: die Eigenschaft wird aus beiden
   * moeglichen Zielen entfernt (Inline-Stil und verwaltete Klassenregel), damit
   * wieder das CSS der Seite greift statt eines gleich lautenden Overrides.
   * Die Kurzform `margin`/`padding` betrifft dabei alle vier Seiten.
   */
  const revertChange = (change: StyleChange) => {
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    if (!el || !win) return;
    const props =
      change.prop === 'margin' || change.prop === 'padding'
        ? ALL_EDGES.map((e) => `${change.prop}-${e}`)
        : [change.prop];
    try {
      for (const p of props) el.style.removeProperty(p);
      const classSel = classSelectorOf(el);
      const style = classSel ? pickerRuleStyle(win.document, classSel) : null;
      if (style) for (const p of props) style.removeProperty(p);
      setSelected(buildSelected(el, win));
    } catch {
      /* Frame nicht mehr lesbar */
    }
  };

  /** Nur die Textaenderung zuruecknehmen — der Rest bleibt stehen. */
  const revertText = () => {
    const original = originalRef.current?.text;
    if (original != null) writeText(original);
  };

  /** Alle vom Popup gesetzten Werte entfernen — inline, Klassenregel und Text. */
  const resetStyles = () => {
    const el = selected?.el;
    const win = frameEl?.contentWindow;
    if (!el || !win) return;
    try {
      for (const p of EDITABLE_PROPS) el.style.removeProperty(p);
      const classSel = classSelectorOf(el);
      const style = classSel ? pickerRuleStyle(win.document, classSel) : null;
      if (style) for (const p of EDITABLE_PROPS) style.removeProperty(p);
      const original = originalRef.current?.text;
      if (original != null && selected?.hasText) {
        writeDirectText(el, original);
        setTextEdit(original);
      }
      setSelected(buildSelected(el, win));
    } catch {
      /* Frame nicht mehr lesbar */
    }
  };

  /**
   * Diff der aktuellen Werte gegen die Ausgangswerte beim Fixieren. Gleichmaessig
   * geaenderte Seiten fasst die Kurzform zusammen (`margin: 8px → 12px`).
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

  /** Geaenderter Text gegen den Ausgangstext beim Fixieren — null ohne Aenderung. */
  const buildTextChange = (sel: SelectedTarget): TextChange | null => {
    const from = originalRef.current?.text;
    if (from == null || !sel.hasText) return null;
    const to = textEdit ?? sel.text;
    return to.trim() === from.trim() ? null : { from, to: to.trim() };
  };

  /** Popup schliessen und den Editier-Zustand vollstaendig zuruecksetzen. */
  const closeInspect = () => {
    setSelected(null);
    setEditingId(null);
    setPopupNote('');
    setTextEdit(null);
  };

  /**
   * Popup fuer einen bestehenden Element-Marker wieder oeffnen: gespeicherte
   * Aenderungen erneut anwenden (nach einem Reload waeren sie sonst weg) und
   * den Diff wieder gegen die Original-Werte laufen lassen.
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
      setSelected(target); // Frame nicht (mehr) beschreibbar — Werte nur anzeigen
      setTextEdit(target.hasText ? target.text : null);
    }
    setScope(shape.styleScope ?? 'class');
    setPopupNote(shape.note ?? '');
    setEditingId(shape.id);
  };

  /**
   * Popup fuer einen gespeicherten Marker oeffnen, dessen Element erst noch
   * ueber den Selektor aufgeloest werden muss (Doppelklick, Panel-Edit).
   * `false`, wenn das Element auf der Seite nicht mehr auffindbar ist —
   * der Aufrufer faellt dann auf den Notiz-Editor zurueck.
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
      return false; // Frame nicht lesbar
    }
  };

  /**
   * Stift-Knopf am gehoverten Marker. Element-Marker oeffnen ihr Popup
   * (Werte *und* Notiz); alle anderen Markierungen den Notiz-Editor — genau
   * das, was auch der Doppelklick tut.
   */
  const editShapeById = (id: string) => {
    const shape = hoverableRef.current.find((s) => s.id === id);
    if (!shape) return;
    actionHoverRef.current = false;
    setHoverElemId(null);
    // Element nicht mehr auffindbar (Seite umgebaut) — dann wenigstens die Notiz.
    if (shape.tool === 'element' && onUpdateShape && reopenShape(shape)) return;
    const at = actionAnchor(shape);
    const value = editableTextOf(shape);
    setNoteDraft({ shapeId: shape.id, x: at.x, y: at.y, value, initial: value });
  };

  /** Das fixierte Element als Feedback-Markierung uebernehmen — inkl. Aenderungen und Notiz. */
  const commitSelectedAsMarker = () => {
    if (!selected) return;
    const { x, y, w, h, label, selector } = selected;
    const changes = buildChanges(selected);
    const textChange = buildTextChange(selected);
    const note = popupNote.trim();
    const classSel = classSelectorOf(selected.el);
    const styleScope: 'class' | 'element' = scope === 'class' && classSel ? 'class' : 'element';
    const styleFields =
      changes.length > 0
        ? {
            styleChanges: changes,
            styleScope,
            styleTarget: styleScope === 'class' ? classSel! : label,
          }
        : {};
    const textFields = textChange ? { textChange } : {};
    if (editingId && onUpdateShape) {
      // Wieder geoeffneter Marker: Werte am bestehenden Eintrag aktualisieren.
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
        ...styleFields,
        ...textFields,
      });
    }
    closeInspect();
    setPicked(null);
  };

  /**
   * Popup-Position in Viewport-Pixeln: standardmaessig neben dem Element,
   * vom Nutzer per Drag frei platzierbar — immer an den Viewport geklemmt,
   * damit nichts unter der schwebenden Werkzeugleiste o. Ae. verschwindet.
   * Geklemmt wird gegen die gemessene Panel-Groesse, nicht gegen Schaetzwerte.
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

  /** Kopfzeile ist der Drag-Griff — Buttons darin bleiben klickbar. */
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
      e.preventDefault(); // keine Textauswahl waehrend des Ziehens
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

  /** Wie viele Elemente der Klassen-Scope tatsaechlich trifft. */
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
      // Klick fixiert das Element und oeffnet das Bearbeiten-Popup (Margin/
      // Padding, bei Text auch Font). Erneuter Klick auf dasselbe Element
      // schliesst es. Als Markierung uebernehmen erfolgt aus dem Popup heraus.
      const target = selectAt(e);
      setPicked(null);
      if (target && selected?.el === target.el) {
        closeInspect(); // Toggle: erneut geklickt -> schliessen
      } else if (target) {
        // Traegt genau dieses Element schon einen Marker? Dann dessen Werte
        // wieder zum Bearbeiten oeffnen statt einen zweiten Marker anzulegen.
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
        // Ausgangswerte merken, um spaeter die Aenderungen fuers Feedback zu diffen.
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
        setPopupNote(''); // Notiz gehoert zum jeweils fixierten Element
        setTextEdit(target.hasText ? target.text : null);
      } else {
        closeInspect();
      }
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

  const strokeWidth = STROKE_PX / zoom;
  const fontSize = 15 / zoom;
  const numbers = pinNumbers(shapes);

  /** Flash-Rahmen um den per Panel angesprungenen Marker (an verschobener Position). */
  const flashShape = flashShapeId ? displayShapes.find((s) => s.id === flashShapeId) : null;
  const flashBox = flashShape ? shapeBounds(flashShape) : null;

  /** Ruhige Hervorhebung, solange der Panel-Eintrag gehovert wird. */
  const hoverShape = hoverShapeId ? displayShapes.find((s) => s.id === hoverShapeId) : null;
  const hoverBox = hoverShape ? shapeBounds(hoverShape) : null;

  /** Markierung unterm Cursor — traegt die Aktions-Knoepfe. */
  const markHoverShape =
    hoverElemId && !movingShape && !resizing
      ? (hoverableShapes.find((s) => s.id === hoverElemId) ?? null)
      : null;
  /**
   * Element-Marker im Element-Werkzeug: kraeftiger Rahmen als Hinweis auf das
   * Popup. Ausserhalb davon traegt der gezeichnete Rahmen den Hover selbst.
   */
  const hoverElemShape =
    markHoverShape?.tool === 'element' && active ? markHoverShape : null;

  /**
   * Mitte der gehoverten Markierung in Bildschirm-Pixeln — dort sitzt die
   * Aktions-Leiste (per CSS um ihren eigenen Mittelpunkt versetzt).
   *
   * Liegt die Mitte ausserhalb des sichtbaren Frame-Ausschnitts, gibt es
   * keine Leiste: an den Rand geklemmte Knoepfe haetten keinen erkennbaren
   * Bezug mehr zu ihrer Markierung.
   */
  const actAt = (() => {
    if (!markHoverShape) return null;
    const p = actionAnchor(markHoverShape);
    const left = (p.x - scroll.x) * zoom;
    let top = (p.y - scroll.y) * zoom;
    if (left < 0 || top < 0 || left > width * zoom || top > height * zoom) return null;
    // Passt die Kapsel nicht in die Markierung (Pin, Text, Hilfslinie), wuerde
    // sie diese komplett verdecken — dann sitzt sie knapp darueber.
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
   * Grosse Knoepfe im Viereck des Element-Markers — dort ist Platz und der
   * Rahmen umschliesst sie sichtbar. Fuer kleine Markierungen bleibt es bei
   * der kompakten Kapsel, sonst quillt sie ueber die Markierung hinaus.
   */
  const actLarge =
    markHoverShape?.tool === 'element' &&
    markHoverShape.w * zoom >= 132 &&
    markHoverShape.h * zoom >= 64;

  /**
   * Steht die Leiste ueberhaupt? Verschwindet sie, waehrend der Zeiger auf
   * ihr sitzt (Popup geht auf, Markierung faellt weg), bekaeme sie nie ein
   * `pointerleave` — `actionHoverRef` bliebe auf `true` haengen und
   * `updateHover` wuerde ab da jeden Hover verschlucken.
   *
   * Der Abgleich laeuft bewusst ohne Effekt: oben steht ein `return null`
   * fuer leere Overlays, ein Hook an dieser Stelle liefe also nicht in jedem
   * Render (React-Fehler #310). Die Zuweisung ist idempotent und leitet sich
   * allein aus diesem Render ab — ein Effekt braucht es dafuer nicht.
   */
  const actsOpen = !!markHoverShape && !!actAt && !selected && !noteDraft;
  if (!actsOpen) actionHoverRef.current = false;

  /**
   * Verschieben sichtbar machen: der Marker unterm Cursor bekommt einen
   * Greif-Rahmen, der gezogene einen kraeftigeren an seiner neuen Position.
   */
  const grabShape = grabId && !movingShape ? displayShapes.find((s) => s.id === grabId) : null;
  const dragShape = movingShape ? displayShapes.find((s) => s.id === movingShape.id) : null;
  // Box-Markierungen zeigen Hover und Ziehen im gezeichneten Rahmen selbst —
  // ein zweiter blauer Kasten darum waere doppelt gemoppelt.
  const grabBox = grabShape && !isSketchShape(grabShape) ? shapeBounds(grabShape) : null;
  const dragBox =
    dragShape && !isSketchShape(dragShape)
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
            // Frisch gezeichnet, waehrend die Marker aus sind: kurz stehen
            // lassen, dann weich ausblenden.
            if (s.id === fadingShapeId) {
              return (
                <g key={`fade-${s.id}`} className="anno__fade" pointerEvents="none">
                  {renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id), view)}
                </g>
              );
            }
            // Der gezogene Marker hebt sich sichtbar ab, solange er an der
            // Maus haengt.
            if (movingShape?.id === s.id) {
              return (
                <g key={`drag-${s.id}`} className="anno__moving">
                  {renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id), view, 'drag')}
                </g>
              );
            }
            // Zeiger auf der Markierung: der Rahmen wird nachgezogen (siehe
            // renderSketchBox). Der Panel-Hover bleibt beim blauen Kasten —
            // er soll die Markierung auf der Seite *auffindbar* machen, dafuer
            // ist ein zarter Doppelstrich zu leise.
            const emphasis: Emphasis =
              grabId === s.id || markHoverShape?.id === s.id ? 'hover' : 'none';
            return renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id), view, emphasis);
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
          {/* Screenshot: alle Erlaeuterungen sammeln sich am rechten Rand,
              statt den Inhalt zu verdecken, um den es geht. */}
          {showNotes &&
            renderExportCards(
              displayShapes.filter((s) => !dimmed?.has(s.id)),
              zoom,
              width,
            )}
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
          {active && tool === 'element' && selected && (
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

      {/* Aktions-Knoepfe an der gehoverten Markierung — gleich welcher Art:
          Bearbeiten (Stift) und Loeschen (X, mit Rueckfrage). Machen sichtbar,
          dass sich Markierungen bearbeiten lassen — Doppelklick allein ist
          nicht auffindbar. Nicht, solange Popup oder Notiz-Editor offen sind. */}
      {actsOpen && markHoverShape && actAt && (
        <div
          className={`anno__acts${actLarge ? ' anno__acts--lg' : ''}`}
          style={actAt}
          onPointerEnter={() => {
            actionHoverRef.current = true;
            window.clearTimeout(hoverClearTimer.current);
          }}
          onPointerLeave={() => {
            // Nicht sofort schliessen: die Leiste sitzt *in* der Markierung,
            // der Zeiger steht beim Verlassen also meist noch auf ihr. Ein
            // hartes Ausblenden liesse die Knoepfe flackern, weil die
            // Mausbewegung im Frame sie sofort wieder einblendet.
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
          // Ins App-Root portalen: dort liegt das Popup ueber der schwebenden
          // Werkzeugleiste und wird nicht vom Device-Container eingefangen
          // (dessen container-type wuerde position:fixed abklemmen).
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
              onScope={setScope}
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

/** Text auf `max` Zeichen kuerzen — SVG-<text> kennt kein Ellipsieren. */
function ellipsisAt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
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

/** Eine Zeile einer Export-Karte. */
interface CardRow {
  text: string;
  /** Monospace (Selektoren, CSS-Werte) statt Fliesstext. */
  mono?: boolean;
  /** Zurueckgenommen (Kontext statt Aussage). */
  dim?: boolean;
}

/**
 * Inhalt der Karte zu einer Markierung: Kopfzeile und Detailzeilen.
 * Element-Marker tragen Geltungsbereich und jede einzelne Aenderung, alles
 * andere nur seine Notiz. `null`, wenn es nichts zu berichten gibt.
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

/** Breite der Export-Karten in Bildschirm-Pixeln. */
const CARD_W = 232;

/**
 * Karten-Spalte am rechten Seitenrand fuer den Screenshot-Export.
 *
 * Frueher stand jede Karte direkt an ihrer Markierung und deckte damit genau
 * den Inhalt zu, um den es ging. Jetzt sammeln sich alle Karten am Rand,
 * jeweils auf Hoehe ihrer Markierung und ohne einander zu ueberlappen; eine
 * duenne Linie mit Punkt am Ziel zeigt, wozu sie gehoert, und eine Ziffer
 * verbindet Karte und Markierung auch dann, wenn die Linie lang wird.
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
  // Nie breiter als der Frame: bei kleinem Zoom waere 232 Bildschirm-Pixel
  // mehr als die ganze Seitenbreite, und die Karte liefe rechts heraus.
  const cardW = Math.min(CARD_W / zoom, frameWidth - margin * 2);
  const pad = 9 / zoom;
  const titleSize = 11 / zoom;
  const rowSize = 10 / zoom;
  const lineH = rowSize * 1.45;
  const gap = 10 / zoom;
  const badge = 15 / zoom;
  const x = Math.max(margin, frameWidth - cardW - margin);

  /**
   * Zeichenbudget je Zeile aus der *tatsaechlichen* Kartenbreite. Ein fester
   * Wert reichte nicht: auf schmalen Frames stand die Haelfte ausserhalb.
   * Monospace baut breiter als Fliesstext, deshalb zwei Budgets.
   */
  const inner = cardW - (pad + 6 / zoom) - pad;
  const fit = (mono: boolean) => Math.max(8, Math.floor(inner / (rowSize * (mono ? 0.62 : 0.55))));
  /** Zeilen auf die Kartenbreite umbrechen — lange Werte bleiben lesbar. */
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
        // Auf Hoehe der Markierung, aber nie in die vorige Karte hinein.
        const y = Math.max(cursor, bounds.y);
        cursor = y + h + gap;
        const n = i + 1;

        // Ziel der Linie: die dem Kartenrand naechste Kante der Markierung.
        const toX = Math.min(bounds.x + bounds.w, x - 6 / zoom);
        const toY = bounds.y + Math.min(bounds.h / 2, 40 / zoom);
        const fromY = y + h / 2;

        return (
          <g key={`card-${shape.id}`}>
            {/* Fuehrungslinie: waagerecht am Kartenrand, dann zum Ziel. */}
            <path
              d={`M${x},${fromY} L${toX + 10 / zoom},${fromY} L${toX},${toY}`}
              fill="none"
              stroke={shape.color}
              strokeWidth={1.2 / zoom}
              strokeOpacity={0.75}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            />
            <circle cx={toX} cy={toY} r={2.6 / zoom} fill={shape.color} />

            {/* Ziffer an der Markierung — bleibt zuordenbar, auch wenn die
                Linie ueber halbe Seiten laeuft. */}
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
 * Beschriftungs-Pill: dunkle Kapsel mit farbigem Rand und weissem Text —
 * ersetzt den frueheren Text mit Kontur-Stroke, der auf bunten Seiten
 * unruhig wirkte. Konstante Bildschirmgroesse, deshalb /zoom.
 *
 * Sitzt fest oberhalb ihrer Markierung (am Dokumentanfang darunter) und wird
 * *nicht* in den sichtbaren Ausschnitt geklemmt: sonst klebte sie am oberen
 * Frame-Rand und wanderte beim Scrollen endlos mit, obwohl die Markierung
 * laengst weg ist — und im Screenshot tauchte sie an jeder Slice-Kante erneut auf.
 */
function renderLabelPill(x: number, y: number, text: string, color: string, zoom: number) {
  const size = 11 / zoom;
  const padX = 6 / zoom;
  const padY = 3.5 / zoom;
  const w = text.length * size * 0.62 + padX * 2;
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
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {text}
      </text>
    </g>
  );
}

/** Kachelgroesse und Strichstaerke der Abstands-Schraffur (Bildschirm-Pixel). */
const HATCH_TILE = 8;
const HATCH_STROKE = 1.7;
/**
 * Zwei Striche je Kachel: einer kraeftig gesaettigt, einer fast weiss. Ein
 * einzelner Ton geht je nach Untergrund unter — ein blasses Gruen auf einem
 * gelben Button ist praktisch unsichtbar, ein helles auf weissem Grund auch.
 * So traegt immer mindestens einer der beiden Striche.
 */
const HATCH_MARGIN = {
  fill: 'rgba(246, 178, 107, .16)',
  stripe: 'rgba(214, 122, 24, .8)',
  // Margin liegt fast immer auf ruhigem Seitenhintergrund und braucht den
  // Gegenstrich kaum — er bleibt schwach, damit er das Padding nicht uebertoent.
  stripeAlt: 'rgba(255, 246, 232, .28)',
};
const HATCH_PADDING = {
  fill: 'rgba(147, 196, 125, .22)',
  stripe: 'rgba(46, 142, 52, .92)',
  stripeAlt: 'rgba(238, 255, 238, .6)',
};
/** Kante des Content-Bereichs — begrenzt die Padding-Flaeche nach innen. */
const PADDING_EDGE = 'rgba(56, 152, 62, .95)';

/**
 * Box-Model-Visualisierung fuer den Element-Picker (Figma-Dev-Mode-Metapher):
 * Margin-Flaechen orange schraffiert, Padding-Flaechen gruen, Werte als
 * Mini-Pills, wenn der Streifen genug Platz bietet. Negative Margins werden
 * nicht gezeichnet.
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
  // Schraffur statt Flaeche: auf bunten Seiten verschwindet ein flacher Ton,
  // die Streifen bleiben auf jedem Hintergrund als "hier ist Abstand" lesbar.
  // Margin und Padding laufen gegenlaeufig — auch ohne Farbe unterscheidbar.
  const tile = HATCH_TILE / zoom;
  // Die Id muss den Zoom tragen: mehrere Frames teilen sich einen Shadow Tree,
  // gleiche Id wuerde das Muster des ersten Frames auf alle anderen ziehen.
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
      {/* Innenkante des Paddings: die Schraffur allein geht auf einem hellen
          Element unter, die Linie zeigt zuverlaessig, wo der Inhalt beginnt. */}
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

/**
 * Handgezeichneter Rahmen um eine Box — die gemeinsame Darstellung von
 * Rechteck- und Element-Markierung.
 *
 * Hover zieht die Kontur ein zweites Mal nach (wie mit dem Stift
 * nachgefahren) und nimmt die Staerke hoch; beim Ziehen hebt sich die
 * Markierung zusaetzlich leicht an und wirft einen Schatten.
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
  // Zweite Kontur beim Hover: andere Variante, leicht verdreht — der Rahmen
  // sieht aus, als waere er ein zweites Mal nachgezogen worden.
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
      {/* Kraeftigere Seiten — gibt dem Strich die Pinsel-Anmutung. */}
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
          {renderSketchBox(shape, shape, strokeWidth, 0.08, emphasis)}
          {renderLabelPill(shape.x, shape.y, shape.label, shape.color, zoom)}
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
