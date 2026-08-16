/**
 * CSS :hover simulation for the target frames of the hover sync.
 *
 * Synthetic mouse events do not change the browser's own :hover state.
 * Instead every :hover rule of the page is duplicated with ':hover' replaced
 * by a marker class (same specificity: a pseudo-class and a class count the
 * same). That class is then set — just like real hover — on the element and
 * all of its ancestors.
 */

const HOVER_CLASS = '__dv-hover__';
const STYLE_ID = '__dv-hover-style__';

/** styleSheets.length at the last scan — detects styles loaded later (SPA). */
const scanned = new WeakMap<Document, number>();

function collectHoverRules(rules: CSSRuleList, out: string[]): void {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule & {
      selectorText?: string;
      conditionText?: string;
      cssRules?: CSSRuleList;
    };

    // Duck typing instead of instanceof: the rules come from another realm.
    if (typeof rule.selectorText === 'string') {
      const selector = rule.selectorText;
      if (!selector.includes(':hover')) continue;

      const rewritten = selector
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.includes(':hover'))
        .map((s) => s.replaceAll(':hover', `.${HOVER_CLASS}`))
        .join(', ');

      const cssText = rule.cssText;
      const body = cssText.slice(cssText.indexOf('{'));
      out.push(`${rewritten} ${body}`);
      continue;
    }

    if (rule.cssRules && rule.cssRules.length > 0) {
      const inner: string[] = [];
      collectHoverRules(rule.cssRules, inner);
      if (inner.length === 0) continue;

      const cssText = rule.cssText;
      if (cssText.startsWith('@media') && rule.conditionText != null) {
        out.push(`@media ${rule.conditionText} { ${inner.join('\n')} }`);
      } else if (cssText.startsWith('@supports') && rule.conditionText != null) {
        out.push(`@supports ${rule.conditionText} { ${inner.join('\n')} }`);
      } else {
        // @layer and friends — taken over without their wrapper, simplifying.
        out.push(...inner);
      }
    }
  }
}

/** Creates or refreshes the rule duplicate in the frame. Idempotent and cheap. */
function ensureHoverRules(doc: Document): void {
  if (scanned.get(doc) === doc.styleSheets.length) return;

  const out: string[] = [];
  for (let i = 0; i < doc.styleSheets.length; i++) {
    const sheet = doc.styleSheets[i];
    if (!sheet) continue;
    // Duck typing instead of instanceof (foreign realm): skip our own sheet.
    if ((sheet.ownerNode as Element | null)?.id === STYLE_ID) continue;
    try {
      collectHoverRules(sheet.cssRules, out);
    } catch {
      // Cross-origin sheet without CORS — not readable, skip it.
    }
  }

  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    doc.head?.append(style);
  }
  style.textContent = out.join('\n');

  // Count after appending — our own sheet is part of the length.
  scanned.set(doc, doc.styleSheets.length);
}

/** Last marked hover chain per frame — querySelectorAll would miss shadow DOM elements. */
const lastChain = new WeakMap<Document, Element[]>();

/**
 * Sets the simulated hover chain on `el` (the element and its ancestors,
 * across shadow boundaries — like real :hover) and removes the previous one.
 * `null` only clears.
 */
export function applyHoverSim(doc: Document, el: Element | null): void {
  ensureHoverRules(doc);

  for (const node of lastChain.get(doc) ?? []) node.classList.remove(HOVER_CLASS);

  const chain: Element[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    node.classList.add(HOVER_CLASS);
    chain.push(node);
    if (node.parentElement) {
      node = node.parentElement;
    } else {
      const root = node.getRootNode();
      node =
        root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? ((root as ShadowRoot).host ?? null) : null;
    }
  }
  lastChain.set(doc, chain);
}
