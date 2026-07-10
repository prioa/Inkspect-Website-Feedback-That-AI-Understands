import { PRESETS } from './devices';
import { pinNumbers, type ElementRef, type Shape } from './annotations';
import type { FeedbackItem } from './feedbackStore';

/**
 * Baut aus dem Feedback einer Seite einen einfuegefertigen Prompt fuer
 * Claude Code: pro Device-Viewport die Korrekturen mit CSS-Selektor,
 * Notiz und Ort, plus Rahmenanweisungen. Englisch — die Notizen selbst
 * bleiben im Original.
 */
export function buildClaudePrompt(url: string, items: FeedbackItem[]): string {
  const lines: string[] = [
    `Please implement the following UI review feedback for ${url}.`,
    '',
    'The feedback was collected with Inkspect directly on the rendered page,',
    'per device viewport. CSS selectors refer to the rendered DOM — map them',
    'to the corresponding source files/components of this project. Notes are',
    'quoted verbatim in their original language.',
    '',
    'Keep changes minimal and verify each fix at the given viewport width.',
  ];

  for (const preset of PRESETS) {
    const deviceItems = items.filter((item) => item.deviceId === preset.id);
    if (deviceItems.length === 0) continue;

    lines.push('', `## ${preset.name} (${preset.width}×${preset.height})`);
    const numbers = pinNumbers(deviceItems.map((item) => item.shape));
    deviceItems.forEach(({ shape }, i) => {
      lines.push(`${i + 1}. ${describeShape(shape, numbers.get(shape.id))}`);
    });
  }

  return lines.join('\n');
}

/** ` near \`selector\`` — oder leer, wenn kein DOM-Bezug erfasst wurde. */
function near(ref: ElementRef): string {
  return ref.anchor ? ` near \`${ref.anchor}\`` : '';
}

function quoteNote(note: string | undefined): string {
  return note ? ` — "${note}"` : ' (marked without a note)';
}

function describeShape(shape: Shape, pinNumber: number | undefined): string {
  switch (shape.tool) {
    case 'element': {
      const target = shape.selector ? `\`${shape.selector}\`` : `\`${shape.label}\``;
      return `Marked element ${target}${quoteNote(shape.note)}`;
    }
    case 'pin':
      return `Comment pin ${pinNumber ?? ''}${near(shape)}: "${shape.text || '(no note)'}"`;
    case 'text':
      return `Text annotation${near(shape)}: "${shape.text}"`;
    case 'pen': {
      const points = (shape.strokes ?? []).flat();
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const w = Math.round(Math.max(...xs) - Math.min(...xs));
      const h = Math.round(Math.max(...ys) - Math.min(...ys));
      return `Freehand markup${near(shape)}, covering ~${w}×${h}px — visual correction without a note`;
    }
    case 'arrow':
      return `Arrow pointing at${near(shape) || ' the marked spot'} — visual correction without a note`;
    default: {
      const name = shape.tool === 'rect' ? 'Rectangle' : 'Ellipse';
      const w = Math.round(Math.abs(shape.x2 - shape.x1));
      const h = Math.round(Math.abs(shape.y2 - shape.y1));
      return `${name}${near(shape)}, ~${w}×${h}px — visual correction without a note`;
    }
  }
}
