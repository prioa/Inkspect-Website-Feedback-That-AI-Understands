import type { DevicePreset } from './devices';
import type { FeedbackItem } from './feedbackStore';
import type { Shape } from './annotations';
import { lineGap, shapeFocusPoint, shapeReveal, shapeSelector, TOOL_LABELS } from './annotations';

/** A marker's free text or note, otherwise null. */
function noteOf(shape: Shape): string | null {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text || null;
  return shape.note ?? null;
}

/** One line per entry: the note (or the tool), and for elements the selector. */
function lineOf(shape: Shape): string {
  const note = noteOf(shape);
  if (shape.tool === 'element') {
    const label = shape.label || TOOL_LABELS.element;
    return note ? `${note} — \`${label}\`` : `\`${label}\``;
  }
  return note ? `${note} _(${TOOL_LABELS[shape.tool]})_` : TOOL_LABELS[shape.tool];
}

/**
 * Where a marker sits in the source: the CSS path of the marked element, or
 * of the one beneath it. Shadow DOM boundaries appear as ' >>> ' in the path.
 * Freehand often crosses several elements — those come along on an extra line.
 */
function refLinesOf(shape: Shape): string[] {
  const out: string[] = [];
  const selector = shapeSelector(shape);
  if (selector) out.push(`  - selector: \`${selector}\``);

  // Directly below the selector: on its own it does not find the element when
  // that sits behind an interaction (slideout, accordion, form step). This is
  // exactly the detail an agent would otherwise be missing.
  const reveal = shapeReveal(shape);
  if (reveal) {
    out.push(`  - reveal: click ${reveal.map((s) => `\`${s.label ?? s.sel}\``).join(' → ')}`);
  }

  // Text changed in the element picker — the target value stands there as a
  // quote. Under class scope it affects every element of the selector; without
  // that addition an agent would read it as a one-off.
  if (shape.tool === 'element' && shape.textChange) {
    const { from, to } = shape.textChange;
    const scope =
      shape.textScope === 'class' && shape.styleTarget ? ` on \`${shape.styleTarget}\`` : '';
    out.push(`  - text${scope}: "${from}" → "${to}"`);
  }

  // Style changes proposed by the element picker, as target values.
  if (shape.tool === 'element' && shape.styleChanges && shape.styleChanges.length > 0) {
    const scope = shape.styleTarget ? ` on \`${shape.styleTarget}\`` : '';
    for (const c of shape.styleChanges) {
      out.push(`  - change${scope}: \`${c.prop}\` ${c.from} → ${c.to}`);
    }
  }

  const crossed = shape.tool === 'element' ? undefined : shape.anchors;
  const extra = crossed?.filter((sel) => sel !== selector) ?? [];
  if (extra.length > 0) {
    out.push(`  - also crosses: ${extra.map((sel) => `\`${sel}\``).join(', ')}`);
  }

  // A pair of lines measures a gap — that gap is the actual statement.
  if (shape.tool === 'hline' || shape.tool === 'vline') {
    const gap = lineGap(shape);
    if (gap != null) out.push(`  - spacing: ${Math.round(gap)} px`);
  }

  // Always include the position: without a resolvable selector it is the only
  // clue as to where on the page the marking sits.
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
 * Turns the feedback entries of one domain into a Markdown list: grouped by
 * page, then by device (with viewport size), every entry a GFM checkbox
 * (ticked = done) along with its CSS path and position. That makes the
 * feedback easy to tip into a ticket tool — or to hand to an AI that is meant
 * to find the spot in the source.
 */
export function feedbackToMarkdown(
  items: FeedbackItem[],
  presets: readonly DevicePreset[],
  /**
   * The finished share fragment (`#ink-feedback=…`, deflate-raw + base64url).
   * Appended as a collapsible block at the end: attached to a page URL it
   * restores exactly this state — the text above is for humans and AI, this
   * block is for the extension. It arrives ready-made from the caller so this
   * module does not depend on the store.
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
