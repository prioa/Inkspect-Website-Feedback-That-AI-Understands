import { browser } from 'wxt/browser';
import type { CaptureResponse } from './messages';
import { createLogger } from './log';

const log = createLogger('screenshot');

/**
 * Annotated device screenshots: the background photographs the visible tab
 * (including the markers drawn in the overlay), and here the result is cropped
 * to the device viewport element. For full-page captures the frame is scrolled
 * slice by slice and the pieces are stitched together.
 */

interface CroppedShot {
  canvas: HTMLCanvasElement;
  /** Device pixels per CSS pixel of the window (the capture's dpr). */
  scale: number;
}

/** Screenshot of the visible tab, cropped to `rect` (CSS pixels). */
async function captureCropped(rect: DOMRect): Promise<CroppedShot | null> {
  // sendMessage can reject by itself (port closed, SW restart in the middle of
  // a multi-page export) — that must not abort the export as an exception.
  let res: CaptureResponse;
  try {
    res = (await browser.runtime.sendMessage({
      type: 'ink:capture',
    })) as CaptureResponse;
  } catch (e) {
    log.warn('Capture message failed', e);
    return null;
  }
  if (!res?.ok) {
    log.warn('Tab capture failed', res?.error);
    return null;
  }

  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = res.dataUrl;
    });
  } catch {
    log.warn('Capture image could not be decoded');
    return null;
  }

  // The capture is in device pixels — derive the scale from the image width.
  const scale = img.naturalWidth / window.innerWidth;
  const x = Math.max(0, rect.left) * scale;
  const y = Math.max(0, rect.top) * scale;
  const w = Math.min(rect.right, window.innerWidth) * scale - x;
  /**
   * Drop one pixel at the bottom. If the frame height rounds to a fraction,
   * the card background flashes through there — in the stitched image that
   * gives a dark line at every slice edge. The cut costs nothing: stitching
   * goes by the height *actually* captured, so the next slice picks up exactly
   * where this one ended. The top must not be cut — a pixel of content would
   * be lost per edge there.
   */
  const h = Math.min(rect.bottom, window.innerHeight) * scale - y - Math.ceil(scale);
  if (w < 10 || h < 10) {
    log.warn('Frame section too small for a slice', {
      rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      window: `${window.innerWidth}x${window.innerHeight}`,
      w: Math.round(w),
      h: Math.round(h),
    });
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  canvas.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, w, h);
  return { canvas, scale };
}

/**
 * Area budget for the finished image. A long page times the device pixel
 * density quickly reaches hundreds of megapixels — which blows both the
 * canvas's image output and any reasonable file size in the PDF. Above that,
 * it is scaled down proportionally.
 */
const MAX_AREA = 40_000_000;

/** Bring the image within the area budget — returns the original when it fits. */
export function fitToBudget(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const area = canvas.width * canvas.height;
  if (area <= MAX_AREA) return canvas;
  const factor = Math.sqrt(MAX_AREA / area);
  const scaled = document.createElement('canvas');
  scaled.width = Math.max(1, Math.floor(canvas.width * factor));
  scaled.height = Math.max(1, Math.floor(canvas.height * factor));
  const ctx = scaled.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  log.info('Image scaled down for encoding', {
    from: `${canvas.width}x${canvas.height}`,
    to: `${scaled.width}x${scaled.height}`,
  });
  return scaled;
}

/** Upper bound against absurdly long pages (canvas and time budget). */
const MAX_SLICES = 12;

/** The overlay that has to give way for the moment of the capture. */
export interface Veil {
  hide: () => void;
  show: () => void;
}

/**
 * A single capture, once everything has come to rest — the common basis of
 * every capture. It sits in a function because three expensively earned
 * numbers come together here that must not appear anywhere twice:
 *
 * - **600 ms** render time *and* the hard limit of `captureVisibleTab`
 *   (2 calls/s) — not a convenience but a requirement.
 * - **Double `requestAnimationFrame`**: a single one is not enough, its
 *   callback still runs *before* the next paint. The dimming was therefore
 *   still in the picture at capture time. Only the second frame lies behind
 *   the first one's paint.
 * - **40 ms** afterwards catch slow compositor passes (`backdrop-filter`).
 */
async function captureSettled(
  getRect: () => DOMRect,
  veil?: Veil,
): Promise<CroppedShot | null> {
  await new Promise((r) => setTimeout(r, 600));
  veil?.hide();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
  await new Promise((r) => setTimeout(r, 40));
  try {
    return await captureCropped(getRect());
  } finally {
    veil?.show();
  }
}

/**
 * Capture of the visible part of the frame, without scrolling and without
 * stitching — for the detail shots of unfolded elements. The caller has
 * already scrolled the element into view and frozen the page.
 */
export async function captureViewportShot(
  getRect: () => DOMRect,
  veil?: Veil,
): Promise<HTMLCanvasElement | null> {
  const shot = await captureSettled(getRect, veil);
  return shot?.canvas ?? null;
}

/**
 * Put animations and transitions in the frame to rest while photographing.
 *
 * Without it, the export catches the page in the middle of its scroll
 * animations: blocks that fade in stand half transparent in the image (looking
 * like a shadow across the page), count-up numbers show intermediate states
 * ("77 %" instead of "100 %"). With duration 0, every CSS animation jumps
 * straight to its end state as soon as it is triggered.
 *
 * `scroll-behavior: auto` is a mandatory part of this: with `smooth` our
 * `scrollTo` would animate gently, and the scroll position read immediately
 * afterwards would simply be wrong — the slices would sit offset.
 *
 * Counters driven by JS keep running; the only remedy there is the wait per
 * slice.
 */
const FREEZE_CSS = `*,*::before,*::after{
  animation-duration:0s!important;
  animation-delay:0s!important;
  animation-iteration-count:1!important;
  transition-duration:0s!important;
  transition-delay:0s!important;
}
html{scroll-behavior:auto!important}`;

export function freezeAnimations(doc: Document): () => void {
  const added: HTMLStyleElement[] = [];
  const inject = (root: Document | ShadowRoot) => {
    try {
      const style = (root.ownerDocument ?? (root as Document)).createElement('style');
      style.textContent = FREEZE_CSS;
      (root instanceof ShadowRoot ? root : root.head)?.append(style);
      added.push(style);
    } catch {
      /* root not writable */
    }
  };
  try {
    inject(doc);
    // Web components bring their own styles — the rule above does not reach
    // them, it has to go into every open shadow root.
    for (const el of doc.querySelectorAll('*')) {
      if (el.shadowRoot) inject(el.shadowRoot);
    }
  } catch (e) {
    log.warn('Animations could not be stilled', e);
  }
  return () => {
    for (const style of added) style.remove();
  };
}

/**
 * Fixed and sticky elements would repeat in every slice when scroll-stitching
 * (a header glued to the top of each strip). From the second slice onwards
 * they are therefore neutralised: `fixed` becomes invisible (it takes no space
 * in the flow, so it is only missing where it already stands in the first
 * slice), `sticky` falls back to `static` and scrolls along naturally. Returns
 * a restore function that puts the original inline styles back.
 */
function suppressFixedElements(doc: Document): () => void {
  const touched: {
    el: HTMLElement;
    prop: string;
    value: string;
    priority: string;
  }[] = [];
  const override = (el: HTMLElement, prop: string, value: string) => {
    touched.push({
      el,
      prop,
      value: el.style.getPropertyValue(prop),
      priority: el.style.getPropertyPriority(prop),
    });
    el.style.setProperty(prop, value, 'important');
  };
  const visit = (root: ParentNode) => {
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      let position = '';
      try {
        position = el.ownerDocument.defaultView?.getComputedStyle(el).position ?? '';
      } catch {
        continue;
      }
      if (position === 'fixed') override(el, 'visibility', 'hidden');
      else if (position === 'sticky') override(el, 'position', 'static');
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  try {
    visit(doc);
  } catch (e) {
    log.warn('Suppressing fixed/sticky elements failed', e);
  }
  return () => {
    for (const t of touched) {
      if (t.value) t.el.style.setProperty(t.prop, t.value, t.priority);
      else t.el.style.removeProperty(t.prop);
    }
  };
}

/**
 * Full-page capture of a device frame as a canvas (the caller assembles the
 * PDF from it): the frame document is scrolled in viewport-sized steps, every
 * slice photographed via captureVisibleTab (limit: 2 calls/s, hence the 600 ms
 * spacing) and stitched onto a canvas at the full document height. The
 * overlay's markers and note bubbles are included in every slice. Fixed and
 * sticky elements appear exactly once — at their natural position in the first
 * slice (see `suppressFixedElements`).
 */
export async function captureFullFrameShot(
  iframe: HTMLIFrameElement,
  getRect: () => DOMRect,
  zoom: number,
  onSlice?: () => void,
  /**
   * Called around every single capture. The overlay that covers the frame
   * during the scan would otherwise be photographed along with it — it
   * disappears for the moment of the shot and is back immediately after.
   */
  veil?: Veil,
): Promise<HTMLCanvasElement | null> {
  let win: Window;
  let docH: number;
  let viewH: number;
  let previousScroll: { x: number; y: number };
  try {
    const w = iframe.contentWindow;
    const el = w?.document.scrollingElement;
    if (!w || !el) throw new Error('frame');
    win = w;
    viewH = w.innerHeight;
    docH = Math.max(el.scrollHeight, viewH);
    previousScroll = { x: w.scrollX, y: w.scrollY };
  } catch {
    // Frame not readable — then at least the visible part.
    const single = await captureCropped(getRect());
    return single?.canvas ?? null;
  }

  if (docH > MAX_SLICES * viewH) {
    log.warn('Page too long for a full-page capture, cutting it off', {
      docH,
      viewH,
    });
  }

  const parts: { docY: number; canvas: HTMLCanvasElement }[] = [];
  let unit = 0; // canvas pixels per document pixel
  let y = 0;
  let restoreFixed: (() => void) | null = null;
  // Applies from the first slice on: scroll animations should already be
  // finished everywhere by the time the shutter goes.
  const restoreMotion = freezeAnimations(win.document);
  try {
    for (let i = 0; i < MAX_SLICES; i++) {
      const targetY = Math.max(0, Math.min(y, docH - viewH));
      // The first slice shows headers and friends at their real position — from
      // the second on they would repeat, so they are suppressed.
      if (i === 1) restoreFixed = suppressFixedElements(win.document);
      try {
        win.scrollTo(0, targetY);
      } catch {
        break;
      }
      /**
       * Fetch the actual scroll position back. The target position is
       * fractional (slice height / device pixel density), but `scrollTo`
       * rounds — and the page can shift the position further (snap, the
       * maximum at the end of the document). Carrying on with the target value
       * makes the slices drift against each other by up to a pixel, leaving a
       * fine edge at every seam.
       */
      const scrolledY = Number.isFinite(win.scrollY) ? win.scrollY : targetY;
      const shot = await captureSettled(getRect, veil);
      if (!shot) break;
      onSlice?.();

      unit = shot.scale * zoom;
      parts.push({ docY: scrolledY, canvas: shot.canvas });
      // Visible document height of this slice — smaller than viewH when the
      // frame is clipped at the window edge; then continue in smaller steps.
      const covered = shot.canvas.height / unit;
      y = scrolledY + covered;
      if (scrolledY >= docH - viewH || y >= docH - 1) break;
    }
  } finally {
    try {
      restoreFixed?.();
      restoreMotion();
    } catch {
      /* frame already gone */
    }
  }

  try {
    win.scrollTo(previousScroll.x, previousScroll.y);
  } catch {
    /* frame already gone */
  }

  if (parts.length === 0 || unit === 0) {
    log.warn('No usable slice — no image', { parts: parts.length, unit, zoom });
    return null;
  }

  const width = Math.max(...parts.map((p) => p.canvas.width));
  const coveredH = Math.min(
    docH,
    parts.reduce((max, p) => Math.max(max, p.docY + p.canvas.height / unit), 0),
  );
  const full = document.createElement('canvas');
  full.width = width;
  full.height = Math.round(coveredH * unit);
  const ctx = full.getContext('2d')!;
  // An opaque ground: if a pixel anywhere stayed unwritten, the PNG would show
  // transparency there — a black line in viewers, depending on the background.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, full.width, full.height);

  /**
   * Stack them without gaps rather than placing each slice at its rounded
   * document position: `docY * unit` rounds independently per slice, which
   * leaves a sub-pixel gap between two strips — exactly those thin dark lines
   * across the image. Instead, count how many canvas pixels already stand and
   * copy only the still-missing part of the next slice.
   */
  let filled = 0;
  for (const part of parts) {
    const top = Math.round(part.docY * unit);
    // Overlap with what is already drawn (the last slice is clamped to
    // `docH - viewH` and almost always overlaps the previous one).
    const skip = Math.max(0, filled - top);
    const h = Math.min(part.canvas.height - skip, full.height - filled);
    if (h <= 0) continue;
    ctx.drawImage(part.canvas, 0, skip, part.canvas.width, h, 0, filled, part.canvas.width, h);
    filled += h;
  }

  return full;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
