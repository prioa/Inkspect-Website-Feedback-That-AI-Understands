/**
 * Baut einen CSS-Pfad, der ein Element in einem *anderen* Frame derselben
 * Seite wiederfindet. Grundlage fuer Scroll- und Interaktions-Sync: die
 * Frames zeigen dasselbe Dokument, nur anders umbrochen — id bzw.
 * nth-of-type-Pfad identifizieren dasselbe Element zuverlaessig genug.
 */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;

  while (node && node.nodeType === 1 && node.tagName !== 'HTML') {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      return parts.join(' > ');
    }

    let part = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }

  return parts.join(' > ');
}

/** querySelector, das bei kaputten Selektoren null liefert statt zu werfen. */
export function findIn(doc: Document, path: string): Element | null {
  if (!path) return null;
  try {
    return doc.querySelector(path);
  } catch {
    return null;
  }
}

/**
 * Pfad ueber Shadow-DOM-Grenzen hinweg: ein Segment pro Baum, aeusserster
 * zuerst. Cookie-Banner und Web Components leben in Shadow Roots — ein
 * reiner Dokument-Selektor findet deren Innenleben nicht.
 */
export function shadowPath(el: Element): string[] {
  const segments: string[] = [];
  let node: Element | null = el;

  while (node) {
    segments.unshift(cssPath(node));
    const root = node.getRootNode();
    // Duck-Typing statt `instanceof ShadowRoot` — fremder Realm.
    node =
      root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
        ? ((root as ShadowRoot).host ?? null)
        : null;
  }

  return segments;
}

/** Gegenstueck zu shadowPath: hangelt sich durch die Shadow Roots des Ziels. */
export function findByShadowPath(doc: Document, segments: string[]): Element | null {
  let scope: Document | ShadowRoot = doc;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) return null;

    let el: Element | null;
    try {
      el = scope.querySelector(segment);
    } catch {
      return null;
    }
    if (!el) return null;
    if (i === segments.length - 1) return el;

    if (!el.shadowRoot) return null; // closed Shadow Root — nicht erreichbar
    scope = el.shadowRoot;
  }

  return null;
}
