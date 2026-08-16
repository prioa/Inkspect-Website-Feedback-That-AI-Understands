import { browser } from 'wxt/browser';
import type { FetchCssResponse } from './messages';

/** Marks the override <style> elements we inject ourselves. */
export const OVERRIDE_ATTR = 'data-dv-override';

export interface SheetSource {
  /** Stable across all frames, and safe to use as an attribute value. */
  id: string;
  label: string;
  kind: 'link' | 'inline';
  /** Absolute URL, only when kind === 'link'. */
  href: string | null;
  /** Position among the <style> elements, only when kind === 'inline'. */
  inlineIndex: number | null;
  text: string;
  /** false when the source could not be loaded. */
  readable: boolean;
  error?: string;
}

function isTag(node: Element, tag: string): boolean {
  // Careful: nodes from an iframe belong to a different JS realm.
  // `node instanceof HTMLStyleElement` would always be false here, because it
  // checks against *our* realm's constructor. Hence the tagName check.
  return node.tagName.toLowerCase() === tag;
}

/** All stylesheet nodes in DOM order, without our own overrides. */
function sheetNodes(doc: Document): Element[] {
  const nodes = doc.querySelectorAll('link[rel~="stylesheet"][href], style');
  return Array.from(nodes).filter((n) => !n.hasAttribute(OVERRIDE_ATTR));
}

function labelFor(href: string): string {
  try {
    const path = new URL(href).pathname;
    const base = path.split('/').filter(Boolean).pop();
    return base || href;
  } catch {
    return href;
  }
}

async function loadCssText(url: string): Promise<{ text: string } | { error: string }> {
  const sameOrigin = new URL(url, location.href).origin === location.origin;

  if (sameOrigin) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (res.ok) return { text: await res.text() };
    } catch {
      // Falls back to the background fetch.
    }
  }

  // Cross-origin (a CDN, say): in MV3, content scripts are subject to the
  // page's CORS policy. The background has host permissions and may fetch.
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'ink:fetch-css',
      url,
    })) as FetchCssResponse;
    return res.ok ? { text: res.text } : { error: res.error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Reads all stylesheets of a frame as editable source text. */
export async function collectSheets(doc: Document): Promise<SheetSource[]> {
  const nodes = sheetNodes(doc);
  const out: SheetSource[] = [];
  let inlineIndex = 0;

  for (const [i, node] of nodes.entries()) {
    if (isTag(node, 'style')) {
      const idx = inlineIndex;
      inlineIndex += 1;
      out.push({
        id: `s${idx}`,
        label: `<style> #${idx + 1}`,
        kind: 'inline',
        href: null,
        inlineIndex: idx,
        text: node.textContent ?? '',
        readable: true,
      });
      continue;
    }

    const href = (node as HTMLLinkElement).href;
    const result = await loadCssText(href);
    out.push({
      id: `l${i}`,
      label: labelFor(href),
      kind: 'link',
      href,
      inlineIndex: null,
      text: 'text' in result ? result.text : '',
      readable: 'text' in result,
      error: 'error' in result ? result.error : undefined,
    });
  }

  return out;
}

/** Finds a sheet's original node in any given frame document. */
export function findSheetNode(doc: Document, sheet: SheetSource): Element | null {
  const nodes = sheetNodes(doc);

  if (sheet.kind === 'link') {
    return (
      nodes.find((n) => isTag(n, 'link') && (n as HTMLLinkElement).href === sheet.href) ?? null
    );
  }

  const styles = nodes.filter((n) => isTag(n, 'style'));
  return styles[sheet.inlineIndex ?? -1] ?? null;
}

function setDisabled(node: Element, flag: boolean): void {
  (node as HTMLLinkElement | HTMLStyleElement).disabled = flag;
}

function overrideSelector(sheet: SheetSource): string {
  return `style[${OVERRIDE_ATTR}="${CSS.escape(sheet.id)}"]`;
}

/**
 * Disables the original sheet and inserts the edited text as a <style>
 * directly after it. The DOM position is preserved so the cascade still holds.
 *
 * `adoptedStyleSheets` would be wrong here: those always land behind every
 * author sheet and would change the order.
 */
export function applyOverride(doc: Document, sheet: SheetSource, css: string): void {
  const node = findSheetNode(doc, sheet);
  if (!node) return;

  setDisabled(node, true);

  let override = doc.querySelector<HTMLStyleElement>(overrideSelector(sheet));
  if (!override) {
    override = doc.createElement('style');
    override.setAttribute(OVERRIDE_ATTR, sheet.id);
    node.insertAdjacentElement('afterend', override);
  }
  if (override.textContent !== css) override.textContent = css;
}

/** Restores the original sheet. */
export function clearOverride(doc: Document, sheet: SheetSource): void {
  const node = findSheetNode(doc, sheet);
  if (node) setDisabled(node, false);
  doc.querySelector(overrideSelector(sheet))?.remove();
}
