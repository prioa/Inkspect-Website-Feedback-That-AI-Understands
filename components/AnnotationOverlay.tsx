import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ElementRef, Point, Shape, Tool } from '@/lib/annotations';
import { elementLabel, pinNumbers, shapeId } from '@/lib/annotations';
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
  tool: Tool;
  color: string;
  frameEl: HTMLIFrameElement | null;
  /** Zaehlt Frame-Loads hoch — der Scroll-Listener muss dann neu haengen. */
  loadCount: number;
  /**
   * Notizen als Sprechblasen direkt im Overlay rendern — an waehrend des
   * Screenshot-Exports, damit der Text am richtigen Punkt im Bild steht.
   */
  showNotes?: boolean;
  onAdd: (shape: Shape) => void;
  onSetNote: (shapeId: string, note: string) => void;
}

interface TextDraft {
  x: number;
  y: number;
  value: string;
}

/** Offener Notiz-Editor zum zuletzt gesetzten Marker. */
interface NoteDraft {
  shapeId: string;
  /** Ankerpunkt in Dokument-Koordinaten. */
  x: number;
  y: number;
  value: string;
}

/** Bounding-Box, Label und CSS-Pfad des Elements unter dem Cursor (Dokumentraum). */
interface ElementTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  selector: string;
}

const MIN_DRAG = 3;

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
  tool,
  color,
  frameEl,
  loadCount,
  showNotes = false,
  onAdd,
  onSetNote,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [scroll, setScroll] = useState<Point>({ x: 0, y: 0 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [picked, setPicked] = useState<ElementTarget | null>(null);

  // Kein veralteter Hover-Rahmen, wenn Werkzeug/Modus wechseln.
  useEffect(() => {
    setPicked(null);
  }, [tool, active]);

  // Ref-Spiegel der Drafts: Commit wird von pointerdown *und* blur aufgerufen —
  // ueber die Ref bleiben die Commits idempotent.
  const [textDraft, setTextDraftState] = useState<TextDraft | null>(null);
  const textDraftRef = useRef<TextDraft | null>(null);
  const setTextDraft = (value: TextDraft | null) => {
    textDraftRef.current = value;
    setTextDraftState(value);
  };

  const [noteDraft, setNoteDraftState] = useState<NoteDraft | null>(null);
  const noteDraftRef = useRef<NoteDraft | null>(null);
  const setNoteDraft = (value: NoteDraft | null) => {
    noteDraftRef.current = value;
    setNoteDraftState(value);
  };

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
      return {
        x: r.left + win.scrollX,
        y: r.top + win.scrollY,
        w: r.width,
        h: r.height,
        label: elementLabel(el),
        selector: shadowPath(el).join(' >>> '),
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
      return { anchor: shadowPath(el).join(' >>> '), anchorLabel: elementLabel(el) };
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
    if (value) onSetNote(current.shapeId, value);
  };

  const handleDown = (e: ReactPointerEvent) => {
    if (!active || e.button !== 0) return;

    // Verhindert die Default-Fokusaenderung des nachfolgenden mousedown —
    // die wuerde das frisch geoeffnete Notiz-Feld sofort wieder blurren
    // (und damit schliessen), bevor es sichtbar wird.
    e.preventDefault();

    // Offene Editoren zuerst bestaetigen (Notiz ist optional — leer = ohne).
    commitText();
    commitNote();

    const p = toDoc(e);

    if (tool === 'element') {
      // Uebernimmt das gerade gehighlightete Element als Markierung.
      const target = pickAt(e);
      if (!target) return;
      const id = shapeId();
      onAdd({ id, tool: 'element', color, ...target });
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
    } else {
      setDraft({ id: shapeId(), tool, color, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
  };

  const handleMove = (e: ReactPointerEvent) => {
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
    }
  };

  /**
   * DOM-Bezug eines Freihand-Strichs: entlang des Zugs sampeln und die
   * tatsaechlich gekreuzten Elemente zaehlen — body/html sind nur der
   * Notnagel, wenn nichts Konkreteres getroffen wurde.
   */
  const penAnchors = (points: Point[]): ElementRef => {
    const step = Math.max(1, Math.floor(points.length / 12));
    const tally = new Map<string, { count: number; label: string }>();
    for (let i = 0; i < points.length; i += step) {
      const ref = anchorAt(points[i]!.x, points[i]!.y);
      if (!ref.anchor) continue;
      const entry = tally.get(ref.anchor) ?? { count: 0, label: ref.anchorLabel ?? '' };
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
    };
  };

  // Freihand speichert ohne Notiz-Editor; Rechteck/Ellipse/Pfeil oeffnen wie
  // Pin und Element-Picker direkt das Notizfeld (optional, leer = ohne).
  // Als DOM-Bezug dienen die gekreuzten Elemente, beim Pfeil das Element
  // unter der Spitze.
  const handleUp = () => {
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
    }
  };

  const strokeWidth = 2.5 / zoom;
  const fontSize = 15 / zoom;
  const numbers = pinNumbers(shapes);

  /** Editor-Position in Overlay-Pixeln, an den Raendern eingeklemmt. */
  const clampEditor = (x: number, y: number, w: number, h: number) => ({
    left: Math.max(4, Math.min((x - scroll.x) * zoom + 14, width * zoom - w - 4)),
    top: Math.max(4, Math.min((y - scroll.y) * zoom + 10, height * zoom - h - 4)),
  });

  return (
    <div className={`anno${active ? ' anno--active' : ''}${active && tool === 'element' ? ' anno--pick' : ''}`}>
      <svg
        ref={svgRef}
        className="anno__svg"
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={() => setDraft(null)}
        onPointerLeave={() => setPicked(null)}
      >
        <g transform={`translate(${-scroll.x}, ${-scroll.y})`}>
          {shapes.map((s) =>
            dimmedIds?.has(s.id) ? (
              <g key={`dim-${s.id}`} opacity={0.35}>
                {renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id))}
              </g>
            ) : (
              renderShape(s, strokeWidth, fontSize, zoom, numbers.get(s.id))
            ),
          )}
          {showNotes && shapes.filter((s) => !dimmedIds?.has(s.id)).map((s) => renderNoteBubble(s, zoom))}
          {draft && renderShape(draft, strokeWidth, fontSize, zoom)}
          {active && tool === 'element' && picked && !noteDraft && (
            <g pointerEvents="none">
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
              {renderElementLabel(picked.x, picked.y, picked.label, color, zoom)}
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
        <div className="anno__note" style={clampEditor(noteDraft.x, noteDraft.y, 230, 92)}>
          <textarea
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
            onBlur={commitNote}
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
    default:
      return null; // Freihand hat keinen Freitext, Text rendert sich selbst
  }
}

/**
 * Notiz als Sprechblase neben der Markierung — nur waehrend des
 * Screenshot-Exports sichtbar, damit der Text im Bild am richtigen Punkt
 * steht. Konstante Bildschirmgroesse, deshalb /zoom.
 */
function renderNoteBubble(shape: Shape, zoom: number) {
  const note = noteOf(shape);
  if (!note) return null;

  const size = 12 / zoom;
  const lineH = size * 1.35;
  const pad = 7 / zoom;
  const lines = wrapNote(note.text, 32, 5);
  const longest = lines.reduce((max, l) => Math.max(max, l.length), 0);
  const w = longest * size * 0.6 + pad * 2;
  const h = lines.length * lineH + pad * 2;

  return (
    <g key={`note-${shape.id}`} pointerEvents="none">
      <rect
        x={note.x}
        y={note.y}
        width={w}
        height={h}
        rx={6 / zoom}
        fill="rgba(14, 16, 20, 0.92)"
        stroke={shape.color}
        strokeWidth={1.2 / zoom}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={note.x + pad}
          y={note.y + pad + i * lineH + size * 0.85}
          fill="#fff"
          fontSize={size}
          fontFamily='ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** Element-Label am oberen Boxrand; rutscht nach innen, wenn oben kein Platz ist. */
function renderElementLabel(x: number, y: number, label: string, color: string, zoom: number) {
  const size = 11 / zoom;
  const ly = y > 16 / zoom ? y - 5 / zoom : y + size + 4 / zoom;
  return (
    <text
      x={x + 2 / zoom}
      y={ly}
      fill={color}
      fontSize={size}
      fontWeight={700}
      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,.6)', strokeWidth: size / 5 }}
    >
      {label}
    </text>
  );
}

function renderShape(
  shape: Shape,
  strokeWidth: number,
  fontSize: number,
  zoom: number,
  pinNumber?: number,
) {
  const stroke = { stroke: shape.color, strokeWidth, fill: 'none' } as const;

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
          {renderElementLabel(shape.x, shape.y, shape.label, shape.color, zoom)}
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
    case 'text':
      return (
        <text
          key={shape.id}
          x={shape.x}
          y={shape.y + fontSize}
          fill={shape.color}
          fontSize={fontSize}
          fontWeight={600}
          fontFamily='ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
          style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,.55)', strokeWidth: fontSize / 6 }}
        >
          {shape.text}
        </text>
      );
  }
}
