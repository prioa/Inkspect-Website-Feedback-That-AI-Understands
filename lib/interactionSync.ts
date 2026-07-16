import { frameDocument } from './framing';
import { findByShadowPath, shadowPath } from './selector';
import { applyHoverSim } from './hoverStyles';
import { createLogger } from './log';

const log = createLogger('interaction-sync');

/**
 * Spiegelt Benutzer-Interaktionen auf alle Preview-Frames: ein Klick (z.B.
 * Burger-Menue) oder eine Formulareingabe in einem Frame wird im jeweils
 * gleichen Element der anderen Frames wiederholt.
 *
 * - Ziel-Element kommt aus e.composedPath(), damit auch Klicks *innerhalb*
 *   von Shadow DOM (Cookie-Banner, Web Components) das echte Ziel treffen.
 * - Klick-Replay feuert die volle Pointer-Sequenz (pointerdown → mousedown →
 *   pointerup → mouseup → click), weil moderne Frameworks oft auf
 *   pointerdown statt click hoeren.
 * - Nur *echte* Events (isTrusted) werden gespiegelt — die synthetischen
 *   Replays der Zielframes sind untrusted und loesen keine Kaskade aus.
 * - Navigation hat zwei Sicherheitsnetze: Link-Klicks navigieren Ziel-Frames
 *   notfalls direkt per URL (wenn das Element-Replay ins Leere greift), und
 *   ein Watchdog zieht Frames nach, deren URL dauerhaft abweicht — etwa weil
 *   ein Klick in die Ladephase eines Frames fiel, in der noch keine
 *   Sync-Listener hingen.
 */
const WATCHDOG_INTERVAL_MS = 700;

export class InteractionSync {
  /** Klicks & Eingaben spiegeln (inkl. Navigations-Angleich des Watchdogs). */
  enabled = true;
  /** Hover-Zustaende spiegeln — unabhaengig von Klicks/Eingaben schaltbar. */
  hoverEnabled = true;

  /**
   * Meldet die aktuelle Frame-URL, sobald sie sich aendert — auch bei
   * SPA-Navigationen (pushState), die kein load-Event ausloesen.
   */
  onUrlChange: ((href: string) => void) | null = null;

  /** Feuert, wenn ein Klick eine Seiten-Navigation anstoesst (Ladeanzeige). */
  onNavigationStart: (() => void) | null = null;

  private readonly detachers = new Map<HTMLIFrameElement, () => void>();
  /** Zuletzt synthetisch gehovertes Element pro Ziel-Frame (fuer mouseout). */
  private readonly hovered = new Map<HTMLIFrameElement, Element>();
  /** Frames im Touch-Modus: nehmen keine Hover-Spiegelung an und senden keine. */
  private readonly touchFrames = new Set<HTMLIFrameElement>();
  private replaying = false;

  /** Letzte bekannte URL pro Frame (Watchdog-Zustand). */
  private readonly urls = new Map<HTMLIFrameElement, string>();
  /** Ziel-URL einer im letzten Tick erkannten Einzel-Navigation. */
  private pendingUrl: string | null = null;
  private lastReported: string | null = null;
  private watchdog: number | undefined;

  attach(iframe: HTMLIFrameElement): void {
    this.detach(iframe);

    const doc = frameDocument(iframe);
    if (!doc) return;

    const onClick = (e: Event) => {
      if (!this.shouldMirror(e)) return;
      const el = composedTarget(e);
      if (el) this.replayClick(iframe, el);
    };

    const onMouseOver = (e: Event) => {
      if (!this.shouldMirrorHover(e)) return;
      // Touch-Frames kennen kein Hover — weder senden noch empfangen.
      if (this.touchFrames.has(iframe)) return;
      const el = composedTarget(e);
      if (el) this.replayHover(iframe, el);
    };

    // Verlaesst der Zeiger den Frame ganz (relatedTarget == null), wuerde der
    // simulierte Hover in den Ziel-Frames sonst haengen bleiben — es kommt ja
    // kein weiteres mouseover mehr, das ihn abloest.
    const onMouseOut = (e: Event) => {
      if (!this.shouldMirrorHover(e)) return;
      if ((e as MouseEvent).relatedTarget == null) this.clearHover(iframe);
    };

    const onInput = (e: Event) => {
      if (!this.shouldMirror(e)) return;
      const el = composedTarget(e);
      // Checkbox/Radio/Select laufen ueber 'change' — hier nur Texteingaben.
      if (isTextInput(el)) this.replayValue(iframe, el);
    };

    const onChange = (e: Event) => {
      if (!this.shouldMirror(e)) return;
      const el = composedTarget(e);
      if (isCheckable(el)) this.replayChecked(iframe, el);
      else if (isSelect(el)) this.replayValue(iframe, el);
    };

    doc.addEventListener('click', onClick, true);
    doc.addEventListener('input', onInput, true);
    doc.addEventListener('change', onChange, true);
    doc.addEventListener('mouseover', onMouseOver, true);
    doc.addEventListener('mouseout', onMouseOut, true);

    this.detachers.set(iframe, () => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('change', onChange, true);
      doc.removeEventListener('mouseover', onMouseOver, true);
      doc.removeEventListener('mouseout', onMouseOut, true);
    });

    if (this.watchdog === undefined) {
      this.watchdog = window.setInterval(this.watchdogTick, WATCHDOG_INTERVAL_MS);
    }
  }

  /**
   * Touch-Modus eines Frames setzen: er bekommt keine simulierten Hover mehr
   * und spiegelt eigene Hover nicht auf die anderen Frames.
   */
  setTouch(iframe: HTMLIFrameElement, on: boolean): void {
    if (on) this.touchFrames.add(iframe);
    else this.touchFrames.delete(iframe);
  }

  detach(iframe: HTMLIFrameElement): void {
    this.detachers.get(iframe)?.();
    this.detachers.delete(iframe);
    this.hovered.delete(iframe);
    // urls bleibt absichtlich stehen: attach() ruft detach() als Cleanup vor
    // jedem Re-Attach nach einer Navigation — der URL-Merker muss das
    // ueberleben, sonst sieht der Watchdog die Navigation nie. Eintraege
    // wirklich entfernter Frames raeumt der Tick auf.
    if (this.detachers.size === 0) this.stopWatchdog();
  }

  detachAll(): void {
    for (const detach of this.detachers.values()) detach();
    this.detachers.clear();
    this.hovered.clear();
    this.touchFrames.clear();
    this.stopWatchdog();
  }

  private stopWatchdog(): void {
    if (this.watchdog !== undefined) clearInterval(this.watchdog);
    this.watchdog = undefined;
    this.pendingUrl = null;
    this.lastReported = null;
    this.urls.clear();
  }

  /**
   * Erkennt Frames, deren URL von den anderen abweicht, und zieht sie nach.
   * Gehandelt wird erst, wenn eine Einzel-Navigation einen weiteren Tick
   * unbeantwortet bleibt — beim normalen Klick-Replay navigieren die
   * uebrigen Frames von selbst und der Watchdog bleibt stumm.
   */
  private readonly watchdogTick = (): void => {
    const hrefs = new Map<HTMLIFrameElement, string>();
    for (const frame of this.detachers.keys()) {
      try {
        const href = frameDocument(frame)?.location.href;
        if (href && href !== 'about:blank') hrefs.set(frame, href);
      } catch {
        /* Frame nicht lesbar */
      }
    }

    const changed: string[] = [];
    for (const [frame, href] of hrefs) {
      const prev = this.urls.get(frame);
      this.urls.set(frame, href);
      if (prev && prev !== href) changed.push(href);
    }

    if (this.enabled && this.pendingUrl && changed.length === 0) {
      const url = this.pendingUrl;
      for (const [frame, href] of hrefs) {
        if (href === url) continue;
        const doc = frameDocument(frame);
        // Ein noch ladender Frame ist vermutlich selbst unterwegs dorthin.
        if (doc?.readyState !== 'complete') continue;
        log.info('Watchdog gleicht Navigation an', url);
        this.onNavigationStart?.();
        try {
          doc.defaultView?.location.assign(url);
        } catch {
          /* Frame nicht beschreibbar */
        }
      }
    }

    this.pendingUrl = changed.length === 1 ? (changed[0] ?? null) : null;

    for (const frame of [...this.urls.keys()]) {
      if (!this.detachers.has(frame)) this.urls.delete(frame);
    }

    // SPA-Navigationen (kein load-Event) nach oben melden; der erste Frame
    // gilt als massgeblich.
    const current = hrefs.values().next().value ?? null;
    if (current && current !== this.lastReported) {
      this.lastReported = current;
      this.onUrlChange?.(current);
    }
  };

  private shouldMirror(e: Event): boolean {
    return this.enabled && !this.replaying && e.isTrusted;
  }

  private shouldMirrorHover(e: Event): boolean {
    return this.hoverEnabled && !this.replaying && e.isTrusted;
  }

  private *others(source: HTMLIFrameElement, segments: string[]): Generator<Element> {
    for (const target of this.detachers.keys()) {
      if (target === source) continue;
      const doc = frameDocument(target);
      const el = doc ? findByShadowPath(doc, segments) : null;
      if (el) yield el;
    }
  }

  private replayClick(source: HTMLIFrameElement, el: Element): void {
    const segments = shadowPath(el);
    if (segments.length === 0) return;

    // Fallback fuer Link-Klicks: findet das Replay kein Gegenstueck (Frame
    // laedt gerade, DOM weicht ab), navigieren wir direkt zur Ziel-URL.
    const navUrl = anchorUrl(el);
    if (navUrl) this.onNavigationStart?.();

    this.replaying = true;
    try {
      for (const target of this.detachers.keys()) {
        if (target === source) continue;
        const doc = frameDocument(target);
        if (!doc) continue;

        const other = findByShadowPath(doc, segments);
        if (!other) {
          if (navUrl) {
            log.info('Klick-Replay ohne Treffer — navigiere per URL', navUrl);
            try {
              doc.defaultView?.location.assign(navUrl);
            } catch {
              /* Frame nicht beschreibbar */
            }
          }
          continue;
        }

        const win = other.ownerDocument.defaultView;
        if (!win) continue;

        dispatchPointerSequence(other, win);

        // click() statt synthetischem click-Event: nur click() traegt die
        // Aktivierungs-Semantik (Links folgen, Checkboxen toggeln).
        if (typeof (other as HTMLElement).click === 'function') {
          (other as HTMLElement).click();
        } else {
          other.dispatchEvent(
            new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
          );
        }
      }
    } catch (e) {
      log.warn('Klick-Replay fehlgeschlagen', e);
    } finally {
      this.replaying = false;
    }
  }

  /**
   * Spiegelt Hover doppelt: synthetische pointer-/mouse-Events fuer
   * JS-Handler und eine Marker-Klasse fuer duplizierte CSS-:hover-Regeln.
   */
  private replayHover(source: HTMLIFrameElement, el: Element): void {
    const segments = shadowPath(el);
    if (segments.length === 0) return;

    this.replaying = true;
    try {
      for (const target of this.detachers.keys()) {
        if (target === source) continue;
        if (this.touchFrames.has(target)) continue;
        const doc = frameDocument(target);
        const match = doc ? findByShadowPath(doc, segments) : null;
        if (!match) continue;

        const previous = this.hovered.get(target);
        if (previous === match) continue;

        const win = match.ownerDocument.defaultView;
        if (!win) continue;

        applyHoverSim(match.ownerDocument, match);

        const base = pointerInit(match);
        if (previous?.isConnected) {
          dispatchHoverEvents(previous, win, ['pointerout', 'mouseout'], true, base, match);
          dispatchHoverEvents(previous, win, ['pointerleave', 'mouseleave'], false, base, match);
        }
        dispatchHoverEvents(match, win, ['pointerover', 'mouseover'], true, base, previous ?? null);
        dispatchHoverEvents(match, win, ['pointerenter', 'mouseenter'], false, base, previous ?? null);
        this.hovered.set(target, match);
      }
    } catch (e) {
      log.warn('Hover-Replay fehlgeschlagen', e);
    } finally {
      this.replaying = false;
    }
  }

  /** Loest die simulierte Hover-Kette in allen Ziel-Frames (Quelle verlassen). */
  private clearHover(source: HTMLIFrameElement): void {
    this.replaying = true;
    try {
      for (const target of this.detachers.keys()) {
        if (target === source) continue;
        const previous = this.hovered.get(target);
        if (!previous) continue;
        this.hovered.delete(target);

        const doc = frameDocument(target);
        if (!doc) continue;
        applyHoverSim(doc, null);

        const win = previous.ownerDocument.defaultView;
        if (win && previous.isConnected) {
          const base = pointerInit(previous);
          dispatchHoverEvents(previous, win, ['pointerout', 'mouseout'], true, base, null);
          dispatchHoverEvents(previous, win, ['pointerleave', 'mouseleave'], false, base, null);
        }
      }
    } catch (e) {
      log.warn('Hover-Reset fehlgeschlagen', e);
    } finally {
      this.replaying = false;
    }
  }

  private replayValue(
    source: HTMLIFrameElement,
    el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ): void {
    const segments = shadowPath(el);
    if (segments.length === 0) return;

    const eventType = el.localName === 'select' ? 'change' : 'input';

    this.replaying = true;
    try {
      for (const other of this.others(source, segments)) {
        const target = other as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (!('value' in target)) continue;
        setNativeValue(target, el.value);
        dispatchIn(target, eventType);
      }
    } catch (e) {
      log.warn('Eingabe-Replay fehlgeschlagen', e);
    } finally {
      this.replaying = false;
    }
  }

  private replayChecked(source: HTMLIFrameElement, el: HTMLInputElement): void {
    const segments = shadowPath(el);
    if (segments.length === 0) return;

    this.replaying = true;
    try {
      for (const other of this.others(source, segments)) {
        const target = other as HTMLInputElement;
        if (typeof target.checked !== 'boolean') continue;
        setNativeChecked(target, el.checked);
        dispatchIn(target, 'input');
        dispatchIn(target, 'change');
      }
    } catch (e) {
      log.warn('Checked-Replay fehlgeschlagen', e);
    } finally {
      this.replaying = false;
    }
  }
}

/**
 * Absolute Ziel-URL, wenn der Klick einen normalen Link ausloest —
 * kein neuer Tab, kein Download, nur http(s).
 */
function anchorUrl(el: Element): string | null {
  // Kein instanceof: das Element stammt aus dem Realm des Frames.
  const anchor = el.closest('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  const url = anchor.href;
  if (!url.startsWith('http:') && !url.startsWith('https:')) return null;
  // Reine Hash-Spruenge sind keine Navigation (Scroll-Sync uebernimmt).
  const current = anchor.ownerDocument.location.href;
  if (url.split('#')[0] === current.split('#')[0]) return null;
  return url;
}

/** Echtes Event-Ziel, auch innerhalb von Shadow DOM (composedPath). */
function composedTarget(e: Event): Element | null {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const first = (path[0] ?? e.target) as Node | null;
  return first && first.nodeType === Node.ELEMENT_NODE ? (first as Element) : null;
}

/** Event-Koordinaten in der Mitte des Ziel-Elements — Menues positionieren danach. */
function pointerInit(el: Element): MouseEventInit {
  const rect = el.getBoundingClientRect();
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
}

function dispatchPointerSequence(el: Element, win: Window & typeof globalThis): void {
  const base = pointerInit(el);
  const pointer = { ...base, pointerId: 1, isPrimary: true, pointerType: 'mouse' as const };
  const PointerCtor = win.PointerEvent ?? win.MouseEvent;

  el.dispatchEvent(new PointerCtor('pointerdown', pointer));
  el.dispatchEvent(new win.MouseEvent('mousedown', base));
  el.dispatchEvent(new PointerCtor('pointerup', pointer));
  el.dispatchEvent(new win.MouseEvent('mouseup', base));
}

function dispatchHoverEvents(
  el: Element,
  win: Window & typeof globalThis,
  types: string[],
  bubbles: boolean,
  base: MouseEventInit,
  relatedTarget: Element | null,
): void {
  const PointerCtor = win.PointerEvent ?? win.MouseEvent;
  for (const type of types) {
    const Ctor = type.startsWith('pointer') ? PointerCtor : win.MouseEvent;
    el.dispatchEvent(new Ctor(type, { ...base, bubbles, relatedTarget }));
  }
}

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.localName === 'textarea') return true;
  if (el.localName !== 'input') return false;
  const type = (el as HTMLInputElement).type;
  return type !== 'checkbox' && type !== 'radio';
}

function isCheckable(el: Element | null): el is HTMLInputElement {
  if (!el || el.localName !== 'input') return false;
  const type = (el as HTMLInputElement).type;
  return type === 'checkbox' || type === 'radio';
}

function isSelect(el: Element | null): el is HTMLSelectElement {
  return !!el && el.localName === 'select';
}

/**
 * Setzt value ueber den Prototyp-Setter des Frames. React ueberschreibt den
 * Instanz-Setter mit einem Tracker — direktes `el.value = x` wuerde die
 * anschliessenden input-Events dort als No-op verschlucken.
 */
function setNativeValue(el: Element & { value: string }, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
}

function setNativeChecked(el: HTMLInputElement, checked: boolean): void {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'checked');
  if (desc?.set) desc.set.call(el, checked);
  else el.checked = checked;
}

function dispatchIn(el: Element, type: string): void {
  const win = el.ownerDocument.defaultView;
  if (!win) return;
  el.dispatchEvent(new win.Event(type, { bubbles: true, composed: true }));
}
