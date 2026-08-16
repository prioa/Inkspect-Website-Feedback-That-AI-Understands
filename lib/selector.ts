/**
 * Builds a CSS path that finds an element again in a *different* frame of the
 * same page. The basis for scroll and interaction sync: the frames show the
 * same document, only wrapped differently — an id or an nth-of-type path
 * identifies the same element reliably enough.
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

/** querySelector that returns null on a broken selector instead of throwing. */
export function findIn(doc: Document, path: string): Element | null {
  if (!path) return null;
  try {
    return doc.querySelector(path);
  } catch {
    return null;
  }
}

/**
 * A path across shadow DOM boundaries: one segment per tree, outermost first.
 * Cookie banners and web components live in shadow roots — a plain document
 * selector never reaches inside them.
 */
export function shadowPath(el: Element): string[] {
  const segments: string[] = [];
  let node: Element | null = el;

  while (node) {
    segments.unshift(cssPath(node));
    const root = node.getRootNode();
    // Duck typing instead of `instanceof ShadowRoot` — foreign realm.
    node =
      root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
        ? ((root as ShadowRoot).host ?? null)
        : null;
  }

  return segments;
}

/** Counterpart to shadowPath: walks down through the target's shadow roots. */
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

    if (!el.shadowRoot) return null; // closed shadow root — out of reach
    scope = el.shadowRoot;
  }

  return null;
}
