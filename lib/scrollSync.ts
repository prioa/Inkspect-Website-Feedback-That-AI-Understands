import { frameDocument } from './framing';
import { cssPath, findIn } from './selector';

function ratio(offset: number, max: number): number {
  return max > 0 ? offset / max : 0;
}

/**
 * Keeps the scroll position of all preview frames in sync.
 *
 * What is synced is the *ratio*, not the absolute offset — the frames have
 * different content heights, because the layout wraps differently at each
 * width.
 *
 * Besides the document scroll, inner scroll containers are picked up too
 * (capture listeners, because element scrolls do not bubble); the counterpart
 * in the other frame is found through a CSS path.
 */
export class ScrollSync {
  /** Scroll mirroring can be switched off (sync menu in the toolbar). */
  enabled = true;

  /**
   * Mirroring paused until the user scrolls for the first time.
   *
   * While the frames are still taking the page's position over, each of them
   * gets its own *exact* position (see `seed`). Mirroring on top of that would
   * only pull them apart again: it passes on a ratio, and with differently tall
   * viewports that is an approximation — measurably so, a few dozen pixels. One
   * frame finishing loading was enough to drag the others off their mark.
   */
  hold = false;

  /**
   * The user scrolled in one of the frames.
   *
   * Deliberately reported before the mirroring is filtered — even with
   * mirroring off: the question is not whether it gets passed on, but whether
   * any work is happening at all. The mockup ties its first fade to this (see
   * `PhonePreview`). Only what we set ourselves stays out of it, and that is
   * exactly the echo below.
   */
  onScroll?: () => void;

  private readonly detachers = new Map<HTMLIFrameElement, () => void>();
  private syncing = false;
  /**
   * The last position set *programmatically*, per element. Setting it fires a
   * 'scroll' of its own in the target frame — but that only arrives on the
   * next frame, so usually after the rAF guard below. Without this receipt the
   * echo would propagate back and the frames would visibly oscillate (the
   * target position rounds slightly differently in each frame).
   */
  private readonly echo = new WeakMap<Element, { top: number; left: number }>();

  attach(iframe: HTMLIFrameElement): void {
    this.detach(iframe);

    const win = iframe.contentWindow;
    const doc = frameDocument(iframe);
    if (!win || !doc) return;

    const onScroll = (e: Event) => this.propagate(iframe, e);
    doc.addEventListener('scroll', onScroll, { passive: true, capture: true });
    this.detachers.set(iframe, () => doc.removeEventListener('scroll', onScroll, true));
  }

  /**
   * Set a frame's document position without it counting as a scroll of the
   * user's: at start-up the page's own position is carried into every freshly
   * loaded frame (see `scrollAnchor`).
   *
   * It runs through the same echo receipt as the mirroring — so the resulting
   * 'scroll' neither propagates to the other frames (each one gets its own
   * position, matched to its own layout) nor is reported as work.
   */
  seed(el: Element, top: number, left: number): void {
    this.applyScroll(el, top, left);
  }

  detach(iframe: HTMLIFrameElement): void {
    this.detachers.get(iframe)?.();
    this.detachers.delete(iframe);
  }

  detachAll(): void {
    for (const detach of this.detachers.values()) detach();
    this.detachers.clear();
  }

  /**
   * Set the position and record it. If the target is already there, nothing
   * happens — which saves the whole echo.
   */
  private applyScroll(el: Element, top: number, left: number): void {
    if (Math.abs(el.scrollTop - top) < 1 && Math.abs(el.scrollLeft - left) < 1) return;
    this.echo.set(el, { top, left });
    // Always instant: if the page sets `scroll-behavior: smooth`, even a plain
    // scrollTop assignment would animate. The intermediate positions of that
    // animation then do not match the echo receipt, count as scrolls of their
    // own and propagate back — the frames drag each other back to the starting
    // position and nobody gets anywhere.
    el.scrollTo({ top, left, behavior: 'instant' });
  }

  /** Did this 'scroll' come from our own setting? Then do not pass it on. */
  private isEcho(el: Element): boolean {
    const expected = this.echo.get(el);
    if (!expected) return false;
    const hit =
      Math.abs(el.scrollTop - expected.top) < 2 && Math.abs(el.scrollLeft - expected.left) < 2;
    if (hit) this.echo.delete(el);
    return hit;
  }

  private propagate(source: HTMLIFrameElement, e: Event): void {
    const target = e.target as Node | null;
    const element = target && target.nodeType === Node.ELEMENT_NODE ? (target as Element) : null;
    const scrolled = element ?? frameDocument(source)?.scrollingElement ?? null;
    // Our own doing — the echo of a mirrored position or of `seed`. Not the
    // user's work and nothing to pass on. The scroll that caused it has already
    // been reported by its own frame.
    if (scrolled && this.isEcho(scrolled)) return;

    this.onScroll?.();

    // Setting scrollTop fires 'scroll' again in the target frames. Without
    // this flag the frames would wind each other up.
    if (!this.enabled || this.syncing || this.hold) return;

    this.syncing = true;

    if (element) {
      this.syncElement(source, element);
    } else {
      this.syncDocument(source);
    }

    requestAnimationFrame(() => {
      this.syncing = false;
    });
  }

  private syncDocument(source: HTMLIFrameElement): void {
    const sourceEl = frameDocument(source)?.scrollingElement;
    if (!sourceEl) return;

    const ry = ratio(sourceEl.scrollTop, sourceEl.scrollHeight - sourceEl.clientHeight);
    const rx = ratio(sourceEl.scrollLeft, sourceEl.scrollWidth - sourceEl.clientWidth);

    for (const target of this.detachers.keys()) {
      if (target === source) continue;
      const el = frameDocument(target)?.scrollingElement;
      if (!el) continue;
      this.applyScroll(
        el,
        ry * (el.scrollHeight - el.clientHeight),
        rx * (el.scrollWidth - el.clientWidth),
      );
    }
  }

  private syncElement(source: HTMLIFrameElement, el: Element): void {
    const path = cssPath(el);
    if (!path) return;

    const ry = ratio(el.scrollTop, el.scrollHeight - el.clientHeight);
    const rx = ratio(el.scrollLeft, el.scrollWidth - el.clientWidth);

    for (const target of this.detachers.keys()) {
      if (target === source) continue;
      const doc = frameDocument(target);
      const other = doc ? findIn(doc, path) : null;
      if (!other) continue;
      this.applyScroll(
        other,
        ry * (other.scrollHeight - other.clientHeight),
        rx * (other.scrollWidth - other.clientWidth),
      );
    }
  }
}
