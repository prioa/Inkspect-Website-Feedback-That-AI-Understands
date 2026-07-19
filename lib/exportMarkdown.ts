import type { DevicePreset } from './devices';
import type { FeedbackItem } from './feedbackStore';
import type { Shape } from './annotations';
import { lineGap, shapeFocusPoint, TOOL_LABELS } from './annotations';

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

/**
 * Verortung eines Markers im Quellcode: CSS-Pfad des markierten bzw. des
 * darunterliegenden Elements. Shadow-DOM-Grenzen stehen als ' >>> ' im Pfad.
 * Freihand kreuzt oft mehrere Elemente — die kommen als Zusatzzeile mit.
 */
function refLinesOf(shape: Shape): string[] {
  const out: string[] = [];
  const selector = shape.tool === 'element' ? shape.selector : shape.anchor;
  if (selector) out.push(`  - selector: \`${selector}\``);

  const crossed = shape.tool === 'element' ? undefined : shape.anchors;
  const extra = crossed?.filter((sel) => sel !== selector) ?? [];
  if (extra.length > 0) {
    out.push(`  - also crosses: ${extra.map((sel) => `\`${sel}\``).join(', ')}`);
  }

  // Linienpaare messen einen Abstand — der ist die eigentliche Aussage.
  if (shape.tool === 'hline' || shape.tool === 'vline') {
    const gap = lineGap(shape);
    if (gap != null) out.push(`  - spacing: ${Math.round(gap)} px`);
  }

  // Position immer mitgeben: ohne aufloesbaren Selektor ist sie der einzige
  // Anhaltspunkt, wo auf der Seite die Markierung sitzt.
  const p = shapeFocusPoint(shape);
  out.push(`  - position: ${Math.round(p.x)}, ${Math.round(p.y)} (document px)`);
  return out;
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
 * Baut aus den Feedback-Eintraegen einer Domain eine Markdown-Liste: nach
 * Seite gruppiert, darin nach Device (mit Viewport-Groesse), jeder Eintrag
 * als GFM-Checkbox (abgehakt = erledigt) samt CSS-Pfad und Position. Damit
 * laesst sich das Feedback in ein Ticket-Tool kippen — oder einer KI
 * vorlegen, die die Stelle im Quellcode finden soll.
 */
export function feedbackToMarkdown(
  items: FeedbackItem[],
  presets: readonly DevicePreset[],
  /**
   * Fertiges Share-Fragment (`#ink-feedback=…`, deflate-raw + base64url).
   * Haengt als zusammenklappbarer Block ans Ende: an eine Seiten-URL
   * gehaengt stellt es exakt diesen Stand wieder her — der Text darueber ist
   * fuer Menschen und KI, dieser Block fuer die Extension. Kommt fertig vom
   * Aufrufer, damit dieses Modul nicht am Store haengt.
   */
  shareHash?: string,
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
      const preset = presets.find((p) => p.id === deviceId);
      const size = preset && preset.width > 0 ? ` (${preset.width}×${preset.height})` : '';
      lines.push(`### ${presetName.get(deviceId) ?? deviceId}${size}`);
      for (const item of deviceItems) {
        lines.push(`- [${item.done ? 'x' : ' '}] ${lineOf(item.shape)}`);
        lines.push(...refLinesOf(item.shape));
      }
      lines.push('');
    }
  }

  if (shareHash) {
    lines.push(
      '---',
      '',
      '<details>',
      `<summary>Inkspect payload — append this to a ${host} page URL to restore these markings</summary>`,
      '',
      '```',
      shareHash,
      '```',
      '',
      '</details>',
    );
  }

  return lines.join('\n').trimEnd() + '\n';
}
