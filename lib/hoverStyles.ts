/**
 * CSS-:hover-Simulation fuer die Ziel-Frames des Hover-Syncs.
 *
 * Synthetische Maus-Events aendern den :hover-Zustand des Browsers nicht.
 * Stattdessen werden alle :hover-Regeln der Seite dupliziert, wobei ':hover'
 * durch eine Marker-Klasse ersetzt wird (gleiche Spezifitaet: Pseudoklasse und
 * Klasse zaehlen identisch). Die Klasse wird dann — wie echtes Hover — auf das
 * Element und alle Vorfahren gesetzt.
 */

const HOVER_CLASS = '__dv-hover__';
const STYLE_ID = '__dv-hover-style__';

/** styleSheets.length beim letzten Scan — erkennt nachgeladene Styles (SPA). */
const scanned = new WeakMap<Document, number>();

function collectHoverRules(rules: CSSRuleList, out: string[]): void {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule & {
      selectorText?: string;
      conditionText?: string;
      cssRules?: CSSRuleList;
    };

    // Duck-Typing statt instanceof: die Regeln stammen aus einem anderen Realm.
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
        // @layer u. ae. — vereinfachend ohne Wrapper uebernehmen.
        out.push(...inner);
      }
    }
  }
}

/** Erzeugt/aktualisiert das Regel-Duplikat im Frame. Idempotent und billig. */
function ensureHoverRules(doc: Document): void {
  if (scanned.get(doc) === doc.styleSheets.length) return;

  const out: string[] = [];
  for (let i = 0; i < doc.styleSheets.length; i++) {
    const sheet = doc.styleSheets[i];
    if (!sheet) continue;
    // Duck-Typing statt instanceof (fremder Realm): unser eigenes Sheet auslassen.
    if ((sheet.ownerNode as Element | null)?.id === STYLE_ID) continue;
    try {
      collectHoverRules(sheet.cssRules, out);
    } catch {
      // Cross-Origin-Sheet ohne CORS — nicht lesbar, ueberspringen.
    }
  }

  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    doc.head?.append(style);
  }
  style.textContent = out.join('\n');

  // Nach dem Anhaengen zaehlen — unser eigenes Sheet ist Teil der Laenge.
  scanned.set(doc, doc.styleSheets.length);
}

/** Zuletzt markierte Hover-Kette pro Frame — querySelectorAll saehe Shadow-DOM-Elemente nicht. */
const lastChain = new WeakMap<Document, Element[]>();

/**
 * Setzt die simulierte Hover-Kette auf `el` (Element + Vorfahren, ueber
 * Shadow-Grenzen hinweg — wie echtes :hover) und entfernt die vorherige.
 * `null` loescht nur.
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
