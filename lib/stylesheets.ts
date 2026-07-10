import { browser } from 'wxt/browser';
import type { FetchCssResponse } from './messages';

/** Markiert die von uns injizierten Override-<style>-Elemente. */
export const OVERRIDE_ATTR = 'data-dv-override';

export interface SheetSource {
  /** Stabil ueber alle Frames hinweg, und als Attributwert sicher verwendbar. */
  id: string;
  label: string;
  kind: 'link' | 'inline';
  /** Absolute URL, nur bei kind === 'link'. */
  href: string | null;
  /** Position unter den <style>-Elementen, nur bei kind === 'inline'. */
  inlineIndex: number | null;
  text: string;
  /** false, wenn der Quelltext nicht geladen werden konnte. */
  readable: boolean;
  error?: string;
}

function isTag(node: Element, tag: string): boolean {
  // Achtung: Knoten aus einem iframe gehoeren einem anderen JS-Realm an.
  // `node instanceof HTMLStyleElement` waere hier immer false, weil es gegen
  // den Konstruktor *unseres* Realms prueft. Deshalb ueber tagName.
  return node.tagName.toLowerCase() === tag;
}

/** Alle Stylesheet-Knoten in DOM-Reihenfolge, ohne unsere eigenen Overrides. */
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
      // Faellt auf den Background-Fetch zurueck.
    }
  }

  // Cross-Origin (z. B. CDN): Content-Scripts unterliegen in MV3 der CORS-Policy
  // der Seite. Der Background hat Host-Permissions und darf.
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

/** Liest alle Stylesheets eines Frames als bearbeitbare Quelltexte ein. */
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

/** Findet den Originalknoten eines Sheets in einem beliebigen Frame-Dokument. */
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
 * Deaktiviert das Original-Sheet und setzt den editierten Text als <style>
 * direkt dahinter. Die DOM-Position bleibt erhalten, damit die Kaskade stimmt.
 *
 * `adoptedStyleSheets` waere hier falsch: die landen immer hinter allen
 * Author-Sheets und wuerden die Reihenfolge veraendern.
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

/** Stellt das Original-Sheet wieder her. */
export function clearOverride(doc: Document, sheet: SheetSource): void {
  const node = findSheetNode(doc, sheet);
  if (node) setDisabled(node, false);
  doc.querySelector(overrideSelector(sheet))?.remove();
}
