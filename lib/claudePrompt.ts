import { PRESETS } from './devices';
import { pinNumbers, type ElementRef, type Shape } from './annotations';
import type { FeedbackItem } from './feedbackStore';

/** Beim Prompt-Export heruntergeladener, annotierter Device-Screenshot. */
export interface DeviceScreenshot {
  presetId: string;
  file: string;
}

/**
 * Baut aus dem Feedback einer Seite einen einfuegefertigen Prompt fuer
 * Claude Code: pro Device-Viewport die Korrekturen mit CSS-Selektor,
 * Notiz und Ort, dazu Verweise auf die annotierten Screenshots. Englisch —
 * die Notizen selbst bleiben im Original.
 */
export function buildClaudePrompt(
  url: string,
  items: FeedbackItem[],
  screenshots: DeviceScreenshot[] = [],
): string {
  const lines: string[] = [
    `Please implement the following UI review feedback for ${url}.`,
    '',
    'The feedback was collected with Inkspect directly on the rendered page,',
    'per device viewport. CSS selectors refer to the rendered DOM — map them',
    'to the corresponding source files/components of this project. Notes are',
    'quoted verbatim in their original language.',
  ];

  if (screenshots.length > 0) {
    lines.push(
      '',
      'Annotated screenshots of the marked viewports were saved to the',
      'Downloads folder — read them first: they show the pages with all',
      'markings drawn in, which is essential for hand-drawn markup.',
    );
  }

  lines.push('', 'Keep changes minimal and verify each fix at the given viewport width.');

  for (const preset of PRESETS) {
    const deviceItems = items.filter((item) => item.deviceId === preset.id);
    if (deviceItems.length === 0) continue;

    lines.push('', `## ${preset.name} (${preset.width}×${preset.height})`);
    const shot = screenshots.find((s) => s.presetId === preset.id);
    if (shot) lines.push(`Screenshot: \`${shot.file}\` (Downloads folder)`);

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
      const crossed = (shape.anchors?.length ? shape.anchors : shape.anchor ? [shape.anchor] : [])
        .map((selector) => `\`${selector}\``)
        .join(', ');
      return crossed
        ? `Hand-drawn markup crossing ${crossed} — exact shape and intent are visible in the screenshot`
        : 'Hand-drawn markup — see the screenshot for what is marked';
    }
    case 'arrow':
      return `Arrow pointing at${near(shape) || ' the spot shown in the screenshot'} — visual correction without a note`;
    default: {
      const name = shape.tool === 'rect' ? 'Rectangle drawn around' : 'Ellipse drawn around';
      return `${name}${near(shape) || ' the area shown in the screenshot'} — visual correction without a note`;
    }
  }
}
