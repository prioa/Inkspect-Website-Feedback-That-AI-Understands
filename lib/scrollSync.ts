import { frameDocument } from './framing';
import { cssPath, findIn } from './selector';

function ratio(offset: number, max: number): number {
  return max > 0 ? offset / max : 0;
}

/**
 * Haelt die Scroll-Position aller Preview-Frames synchron.
 *
 * Synchronisiert wird das *Verhaeltnis*, nicht der absolute Offset — die Frames
 * haben unterschiedliche Inhaltshoehen, weil das Layout je nach Breite anders
 * umbricht.
 *
 * Neben dem Dokument-Scroll werden auch innere Scroll-Container erfasst
 * (Capture-Listener, weil Element-Scrolls nicht bubbeln); das Gegenstueck im
 * anderen Frame wird ueber einen CSS-Pfad gefunden.
 */
export class ScrollSync {
  /** Scroll-Spiegelung ein-/ausschaltbar (Sync-Menue in der Toolbar). */
  enabled = true;

  private readonly detachers = new Map<HTMLIFrameElement, () => void>();
  private syncing = false;
  /**
   * Zuletzt *programmatisch* gesetzte Position je Element. Das Setzen loest
   * im Zielframe ein eigenes 'scroll' aus — das kommt aber erst im naechsten
   * Frame an, also oft nach dem rAF-Guard unten. Ohne diese Quittung wuerde
   * das Echo zurueckpropagieren und die Frames pendeln sichtbar hin und her
   * (die Zielposition rundet je Frame minimal anders).
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

  detach(iframe: HTMLIFrameElement): void {
    this.detachers.get(iframe)?.();
    this.detachers.delete(iframe);
  }

  detachAll(): void {
    for (const detach of this.detachers.values()) detach();
    this.detachers.clear();
  }

  /**
   * Position setzen und quittieren. Steht das Ziel schon dort, passiert
   * nichts — das spart das ganze Echo.
   */
  private applyScroll(el: Element, top: number, left: number): void {
    if (Math.abs(el.scrollTop - top) < 1 && Math.abs(el.scrollLeft - left) < 1) return;
    this.echo.set(el, { top, left });
    el.scrollTop = top;
    el.scrollLeft = left;
  }

  /** Stammt dieses 'scroll' aus unserem eigenen Setzen? Dann nicht weiterreichen. */
  private isEcho(el: Element): boolean {
    const expected = this.echo.get(el);
    if (!expected) return false;
    const hit =
      Math.abs(el.scrollTop - expected.top) < 2 && Math.abs(el.scrollLeft - expected.left) < 2;
    if (hit) this.echo.delete(el);
    return hit;
  }

  private propagate(source: HTMLIFrameElement, e: Event): void {
    // Das Setzen von scrollTop loest in den Zielframes erneut 'scroll' aus.
    // Ohne dieses Flag schaukeln sich die Frames gegenseitig auf.
    if (!this.enabled || this.syncing) return;

    const target = e.target as Node | null;
    const element = target && target.nodeType === Node.ELEMENT_NODE ? (target as Element) : null;
    const scrolled = element ?? frameDocument(source)?.scrollingElement ?? null;
    if (scrolled && this.isEcho(scrolled)) return;

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
