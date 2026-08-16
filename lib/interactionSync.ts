import { frameDocument } from './framing';
import { findByShadowPath, shadowPath } from './selector';
import { applyHoverSim } from './hoverStyles';
import { elementLabel, type RevealStep } from './annotations';
import { createLogger } from './log';

const log = createLogger('interaction-sync');

/**
 * Mirrors user interactions onto all preview frames: a click (a burger menu,
 * say) or a form entry in one frame is repeated in the matching element of the
 * others.
 *
 * - The target element comes from e.composedPath(), so that clicks *inside*
 *   shadow DOM (cookie banners, web components) hit the real target too.
 * - Click replay fires the full pointer sequence (pointerdown → mousedown →
 *   pointerup → mouseup → click), because modern frameworks often listen for
 *   pointerdown rather than click.
 * - Only *real* events (isTrusted) are mirrored — the synthetic replays in the
 *   target frames are untrusted and set off no cascade.
 * - Navigation has two safety nets: link clicks navigate target frames
 *   directly by URL if need be (when the element replay grasps at nothing),
 *   and a watchdog pulls along frames whose URL stays out of line — because a
 *   click landed during a frame's loading phase, say, when no sync listeners
 *   were attached yet.
 */
const WATCHDOG_INTERVAL_MS = 700;

/**
 * How many clicks the unfold path keeps at most. No menu is deeper than a few
 * levels; the cap keeps the path small without anyone having to decide which
 * click was "important".
 */
const MAX_TRAIL = 8;

export class InteractionSync {
  /** Mirror clicks and entries (including the watchdog's navigation alignment). */
  enabled = true;
  /** Mirror hover states — switchable independently of clicks and entries. */
  hoverEnabled = true;

  /**
   * Reports the current frame URL whenever it changes — including SPA
   * navigations (pushState), which fire no load event.
   */
  onUrlChange: ((href: string) => void) | null = null;

  /** Fires when a click starts a page navigation (loading indicator). */
  onNavigationStart: (() => void) | null = null;

  /**
   * Clicks of the running session, oldest first — the route to everything that
   * only becomes visible through an interaction. Deliberately *one* path
   * across all frames: the frames mirror each other, and a burger click is one
   * logical interaction, not three. Kept per frame, it would multiply.
   */
  private trail: RevealStep[] = [];

  private readonly detachers = new Map<HTMLIFrameElement, () => void>();
  /** Last synthetically hovered element per target frame (for mouseout). */
  private readonly hovered = new Map<HTMLIFrameElement, Element>();
  /** Frames in touch mode: they accept no mirrored hover and send none. */
  private readonly touchFrames = new Set<HTMLIFrameElement>();
  private replaying = false;

  /** Last known URL per frame (watchdog state). */
  private readonly urls = new Map<HTMLIFrameElement, string>();
  /** Target URL of a single navigation spotted in the last tick. */
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
      if (!el) return;
      this.recordStep(el);
      this.replayClick(iframe, el);
    };

    const onMouseOver = (e: Event) => {
      if (!this.shouldMirrorHover(e)) return;
      // Touch frames know no hover — they neither send nor receive it.
      if (this.touchFrames.has(iframe)) return;
      const el = composedTarget(e);
      if (el) this.replayHover(iframe, el);
    };

    // If the pointer leaves the frame entirely (relatedTarget == null), the
    // simulated hover in the target frames would otherwise stay stuck — no
    // further mouseover is coming to replace it.
    const onMouseOut = (e: Event) => {
      if (!this.shouldMirrorHover(e)) return;
      if ((e as MouseEvent).relatedTarget == null) this.clearHover(iframe);
    };

    const onInput = (e: Event) => {
      if (!this.shouldMirror(e)) return;
      const el = composedTarget(e);
      // Checkbox/radio/select go through 'change' — text entry only here.
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
   * Set a frame's touch mode: it receives no more simulated hover and does not
   * mirror its own hover onto the other frames.
   */
  setTouch(iframe: HTMLIFrameElement, on: boolean): void {
    if (on) this.touchFrames.add(iframe);
    else this.touchFrames.delete(iframe);
  }

  detach(iframe: HTMLIFrameElement): void {
    this.detachers.get(iframe)?.();
    this.detachers.delete(iframe);
    this.hovered.delete(iframe);
    // urls is deliberately left standing: attach() calls detach() as cleanup
    // before every re-attach after a navigation — the URL note has to survive
    // that, or the watchdog never sees the navigation. Entries for frames that
    // really are gone are cleared by the tick.
    if (this.detachers.size === 0) this.stopWatchdog();
  }

  detachAll(): void {
    for (const detach of this.detachers.values()) detach();
    this.detachers.clear();
    this.hovered.clear();
    this.touchFrames.clear();
    this.trail = [];
    this.stopWatchdog();
  }

  /** Unfold path of the running session (a copy), oldest step first. */
  get revealTrail(): RevealStep[] {
    return [...this.trail];
  }

  /**
   * Runs `fn` without the events it triggers being mirrored or recorded.
   * Without this, every programmatic click — while unfolding a hidden element,
   * for instance — echoes into all the other frames; but the screenshot
   * capture needs exactly one frame in the changed state. Nestable, so that a
   * call inside a replay does not tear the protection down early.
   */
  runIsolated<T>(fn: () => T): T {
    const before = this.replaying;
    this.replaying = true;
    try {
      return fn();
    } finally {
      this.replaying = before;
    }
  }

  /**
   * Record a click into the unfold path. Left out is anything that cannot
   * unfold: links (which navigate and reset the path anyway), form fields
   * (they go through input/change) and a repeat of the previous step
   * (double-click).
   */
  private recordStep(el: Element): void {
    if (anchorUrl(el)) return;
    if (isTextInput(el) || isCheckable(el) || isSelect(el)) return;

    const sel = shadowPath(el).join(' >>> ');
    if (!sel) return;
    if (this.trail[this.trail.length - 1]?.sel === sel) return;

    this.trail.push({ sel, label: elementLabel(el) });
    if (this.trail.length > MAX_TRAIL) this.trail.shift();
  }

  private stopWatchdog(): void {
    if (this.watchdog !== undefined) clearInterval(this.watchdog);
    this.watchdog = undefined;
    this.pendingUrl = null;
    this.lastReported = null;
    this.urls.clear();
  }

  /**
   * Spots frames whose URL differs from the others and pulls them along.
   * Action is only taken once a single navigation goes unanswered for another
   * tick — on a normal click replay the other frames navigate by themselves
   * and the watchdog stays quiet.
   */
  private readonly watchdogTick = (): void => {
    const hrefs = new Map<HTMLIFrameElement, string>();
    for (const frame of this.detachers.keys()) {
      try {
        const href = frameDocument(frame)?.location.href;
        if (href && href !== 'about:blank') hrefs.set(frame, href);
      } catch {
        /* frame not readable */
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
        // A frame that is still loading is probably on its way there itself.
        if (doc?.readyState !== 'complete') continue;
        log.info('Watchdog realigns the navigation', url);
        this.onNavigationStart?.();
        try {
          doc.defaultView?.location.assign(url);
        } catch {
          /* frame not writable */
        }
      }
    }

    this.pendingUrl = changed.length === 1 ? (changed[0] ?? null) : null;

    for (const frame of [...this.urls.keys()]) {
      if (!this.detachers.has(frame)) this.urls.delete(frame);
    }

    // Report SPA navigations (no load event) upwards; the first frame counts
    // as authoritative.
    const current = hrefs.values().next().value ?? null;
    if (current && current !== this.lastReported) {
      /**
       * New page, new path: the openers of the old page no longer exist there.
       * Here rather than in `attach()` — that runs per frame per load and would
       * throw the path away as soon as the second frame finished loading. Via
       * `lastReported` it also covers SPA navigation without a load event.
       *
       * The `null` case is explicitly *not* a navigation but the first
       * measurement: `stopWatchdog` resets `lastReported`, and that already
       * happens when all frames detach temporarily (React reattaches them
       * afterwards). Without this distinction the next tick would delete the
       * running session's path — and the marking just placed would get none.
       */
      if (this.lastReported !== null) this.trail = [];
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

    // Fallback for link clicks: if the replay finds no counterpart (frame is
    // loading, DOM differs), we navigate straight to the target URL.
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
            log.info('Click replay found nothing — navigating by URL', navUrl);
            try {
              doc.defaultView?.location.assign(navUrl);
            } catch {
              /* frame not writable */
            }
          }
          continue;
        }

        const win = other.ownerDocument.defaultView;
        if (!win) continue;

        dispatchPointerSequence(other, win);

        // click() rather than a synthetic click event: only click() carries
        // activation semantics (links follow, checkboxes toggle).
        if (typeof (other as HTMLElement).click === 'function') {
          (other as HTMLElement).click();
        } else {
          other.dispatchEvent(
            new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
          );
        }
      }
    } catch (e) {
      log.warn('Click replay failed', e);
    } finally {
      this.replaying = false;
    }
  }

  /**
   * Mirrors hover twice over: synthetic pointer/mouse events for JS handlers,
   * and a marker class for the duplicated CSS :hover rules.
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
      log.warn('Hover replay failed', e);
    } finally {
      this.replaying = false;
    }
  }

  /** Clears the simulated hover chain in all target frames (source left). */
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
      log.warn('Hover reset failed', e);
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
      log.warn('Input replay failed', e);
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
      log.warn('Checked replay failed', e);
    } finally {
      this.replaying = false;
    }
  }
}

/**
 * Absolute target URL, when the click triggers a normal link — no new tab, no
 * download, http(s) only.
 *
 * Exported because unfolding hidden elements (`lib/reveal.ts`) asks the same
 * question: a step that navigates unfolds nothing.
 */
export function anchorUrl(el: Element): string | null {
  // No instanceof: the element comes from the frame's realm.
  const anchor = el.closest('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  const url = anchor.href;
  if (!url.startsWith('http:') && !url.startsWith('https:')) return null;
  // Pure hash jumps are not navigation (the scroll sync takes over).
  const current = anchor.ownerDocument.location.href;
  if (url.split('#')[0] === current.split('#')[0]) return null;
  return url;
}

/** The real event target, shadow DOM included (composedPath). */
function composedTarget(e: Event): Element | null {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const first = (path[0] ?? e.target) as Node | null;
  return first && first.nodeType === Node.ELEMENT_NODE ? (first as Element) : null;
}

/** Event coordinates at the centre of the target element — menus position off them. */
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

/**
 * The full pointer sequence before the click itself — modern frameworks often
 * listen for `pointerdown` rather than `click`. Exported for `lib/reveal.ts`:
 * an opener should be touched exactly the way mirroring touches it.
 */
export function dispatchPointerSequence(el: Element, win: Window & typeof globalThis): void {
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
 * Sets value through the frame's prototype setter. React overwrites the
 * instance setter with a tracker — a direct `el.value = x` would make it
 * swallow the following input events as a no-op.
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
