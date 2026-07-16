import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { PaletteTool, Tool } from '@/lib/annotations';
import { ANNOTATION_COLORS, TOOL_LABELS } from '@/lib/annotations';
import {
  IconArrow,
  IconCollapse,
  IconEllipse,
  IconInspect,
  IconPen,
  IconPin,
  IconPointer,
  IconRect,
  IconText,
  IconTrash,
  IconUndo,
} from './icons';

interface Props {
  /** Wunschposition (Mausposition des Rechtsklicks, Shell-Koordinaten). */
  at: { x: number; y: number };
  tool: PaletteTool;
  color: string;
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

const TOOLS: { id: Tool; icon: () => JSX.Element }[] = [
  { id: 'element', icon: () => <IconInspect /> },
  { id: 'pin', icon: () => <IconPin /> },
  { id: 'pen', icon: () => <IconPen /> },
  { id: 'rect', icon: () => <IconRect /> },
  { id: 'ellipse', icon: () => <IconEllipse /> },
  { id: 'arrow', icon: () => <IconArrow /> },
  { id: 'text', icon: () => <IconText /> },
];

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

        {TOOLS.map((t, i) => (
          <button
            key={t.id}
            className={`icon-btn${tool === t.id ? ' icon-btn--active' : ''}`}
            title={`${TOOL_LABELS[t.id]} (${i + 1})`}
            aria-pressed={tool === t.id}
            onClick={() => onTool(t.id)}
          >
            {t.icon()}
          </button>
        ))}

        <span className="palette__sep" />

        {ANNOTATION_COLORS.map((c) => (
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

/**
 * Fixe Werkzeugleiste des Vollbild-Modus: unten mittig, immer sichtbar.
 * Gleiche Werkzeuge wie die Kontextmenue-Palette, plus Vollbild-Ausgang.
 */
export function FeedbackBar({
  tool,
  color,
  canUndo,
  onTool,
  onColor,
  onUndo,
  onClear,
  onExit,
}: {
  tool: PaletteTool;
  color: string;
  canUndo: boolean;
  onTool: (tool: PaletteTool) => void;
  onColor: (color: string) => void;
  onUndo: () => void;
  onClear: () => void;
  /** Vollbild verlassen (zurueck zum Device-Grid). */
  onExit: () => void;
}) {
  return (
    <div className="palette fsbar" role="toolbar" aria-label="Feedback tools">
      <button
        className={`icon-btn${tool === 'interact' ? ' icon-btn--active' : ''}`}
        title="Interact — clicks & inputs go to the page (Esc)"
        aria-pressed={tool === 'interact'}
        onClick={() => onTool('interact')}
      >
        <IconPointer />
      </button>

      <span className="palette__sep" />

      {TOOLS.map((t, i) => (
        <button
          key={t.id}
          className={`icon-btn${tool === t.id ? ' icon-btn--active' : ''}`}
          title={`${TOOL_LABELS[t.id]} (${i + 1})`}
          aria-pressed={tool === t.id}
          onClick={() => onTool(t.id)}
        >
          {t.icon()}
        </button>
      ))}

      <span className="palette__sep" />

      {ANNOTATION_COLORS.map((c) => (
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

      <span className="palette__sep" />

      <button className="icon-btn" title="Exit full window mode" onClick={onExit}>
        <IconCollapse />
      </button>
    </div>
  );
}
