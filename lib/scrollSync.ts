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
  private readonly detachers = new Map<HTMLIFrameElement, () => void>();
  private syncing = false;

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

  private propagate(source: HTMLIFrameElement, e: Event): void {
    // Das Setzen von scrollTop loest in den Zielframes erneut 'scroll' aus.
    // Ohne dieses Flag schaukeln sich die Frames gegenseitig auf.
    if (this.syncing) return;
    this.syncing = true;

    const target = e.target as Node | null;
    if (target && target.nodeType === Node.ELEMENT_NODE) {
      this.syncElement(source, target as Element);
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
      el.scrollTop = ry * (el.scrollHeight - el.clientHeight);
      el.scrollLeft = rx * (el.scrollWidth - el.clientWidth);
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
      other.scrollTop = ry * (other.scrollHeight - other.clientHeight);
      other.scrollLeft = rx * (other.scrollWidth - other.clientWidth);
    }
  }
}
