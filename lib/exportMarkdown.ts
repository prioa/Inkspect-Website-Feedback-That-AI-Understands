import type { DevicePreset } from './devices';
import type { FeedbackItem } from './feedbackStore';
import type { Shape } from './annotations';
import { TOOL_LABELS } from './annotations';

/** Freitext/Notiz eines Markers, sonst null. */
function noteOf(shape: Shape): string | null {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text || null;
  return shape.note ?? null;
}

/** Eine Zeile pro Eintrag: Notiz (oder Werkzeug), beim Element der Selektor. */
function lineOf(shape: Shape): string {
  const note = noteOf(shape);
  if (shape.tool === 'element') {
    const label = shape.label || TOOL_LABELS.element;
    return note ? `${note} — \`${label}\`` : `\`${label}\``;
  }
  return note ? `${note} _(${TOOL_LABELS[shape.tool]})_` : TOOL_LABELS[shape.tool];
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || '/';
  } catch {
    return url;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Baut aus den Feedback-Eintraegen einer Domain eine Markdown-Liste:
 * nach Seite gruppiert, darin nach Device, jeder Eintrag als GFM-Checkbox
 * (abgehakt = erledigt). Ideal, um Feedback in ein Ticket-Tool zu kippen.
 */
export function feedbackToMarkdown(
  items: FeedbackItem[],
  presets: readonly DevicePreset[],
): string {
  if (items.length === 0) return '';

  const presetName = new Map(presets.map((p) => [p.id, p.name]));
  const host = hostOf(items[0]!.url);

  const byUrl = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    const list = byUrl.get(item.url);
    if (list) list.push(item);
    else byUrl.set(item.url, [item]);
  }
  const pages = [...byUrl.entries()].sort(([a], [b]) => a.localeCompare(b));

  const lines: string[] = [`# Inkspect feedback — ${host}`, ''];

  for (const [url, pageItems] of pages) {
    lines.push(`## ${pathOf(url)}`, '');

    const byDevice = new Map<string, FeedbackItem[]>();
    for (const item of pageItems) {
      const list = byDevice.get(item.deviceId);
      if (list) list.push(item);
      else byDevice.set(item.deviceId, [item]);
    }

    for (const [deviceId, deviceItems] of byDevice) {
      lines.push(`### ${presetName.get(deviceId) ?? deviceId}`);
      for (const item of deviceItems) {
        lines.push(`- [${item.done ? 'x' : ' '}] ${lineOf(item.shape)}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}
