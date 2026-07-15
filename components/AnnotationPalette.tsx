import type { JSX } from 'react';
import type { PaletteTool, Tool } from '@/lib/annotations';
import { ANNOTATION_COLORS, TOOL_LABELS } from '@/lib/annotations';
import {
  IconArrow,
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
  tool: PaletteTool;
  color: string;
  canUndo: boolean;
  onTool: (tool: PaletteTool) => void;
  onColor: (color: string) => void;
  onUndo: () => void;
  onClear: () => void;
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
 * Schwebende Werkzeugleiste am unteren Rand — dauerhaft sichtbar. Der Cursor
 * ganz links laesst die Previews normal bedienen; mit jedem anderen Werkzeug
 * wird auf dem Frame gezeichnet, ueber dem die Maus gerade steht.
 */
export function AnnotationPalette({
  tool,
  color,
  canUndo,
  onTool,
  onColor,
  onUndo,
  onClear,
}: Props) {
  return (
    <div className="palette" role="toolbar" aria-label="Feedback tools">
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
  );
}
