import { browser } from 'wxt/browser';
import type { CaptureResponse } from './messages';
import { createLogger } from './log';

const log = createLogger('screenshot');

/**
 * Annotierte Device-Screenshots: der Background fotografiert den sichtbaren
 * Tab (inklusive gezeichneter Marker im Overlay), hier wird auf das
 * Device-Viewport-Element zugeschnitten. Fuer Full-Page-Aufnahmen wird der
 * Frame slice-weise gescrollt und das Ergebnis zusammengesetzt.
 */

interface CroppedShot {
  canvas: HTMLCanvasElement;
  /** Geraetepixel pro CSS-Pixel des Fensters (dpr des Captures). */
  scale: number;
}

/** Screenshot des sichtbaren Tabs, zugeschnitten auf `rect` (CSS-Pixel). */
async function captureCropped(rect: DOMRect): Promise<CroppedShot | null> {
  // sendMessage kann selbst rejecten (Port geschlossen, SW-Neustart mitten im
  // Multi-Page-Export) — das darf den Export nicht als Exception abbrechen.
  let res: CaptureResponse;
  try {
    res = (await browser.runtime.sendMessage({
      type: 'ink:capture',
    })) as CaptureResponse;
  } catch (e) {
    log.warn('Capture-Nachricht fehlgeschlagen', e);
    return null;
  }
  if (!res?.ok) {
    log.warn('Tab-Capture fehlgeschlagen', res?.error);
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
    log.warn('Capture-Bild nicht dekodierbar');
    return null;
  }

  // Das Capture ist in Geraetepixeln — Skalierung aus der Bildbreite ableiten.
  const scale = img.naturalWidth / window.innerWidth;
  const x = Math.max(0, rect.left) * scale;
  const y = Math.max(0, rect.top) * scale;
  const w = Math.min(rect.right, window.innerWidth) * scale - x;
  const h = Math.min(rect.bottom, window.innerHeight) * scale - y;
  if (w < 10 || h < 10) return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  canvas.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, w, h);
  return { canvas, scale };
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function captureElementShot(rect: DOMRect): Promise<Blob | null> {
  const shot = await captureCropped(rect);
  return shot ? toBlob(shot.canvas) : null;
}

/** Obergrenze gegen absurd lange Seiten (Canvas-/Zeitbudget). */
const MAX_SLICES = 12;

/**
 * Fixed/Sticky-Elemente wuerden sich beim Scroll-Stitching in jedem Slice
 * wiederholen (Header klebt auf jedem Streifen oben). Ab dem zweiten Slice
 * werden sie deshalb neutralisiert: `fixed` wird unsichtbar (behaelt keinen
 * Platz im Flow, fehlt also nur dort, wo es ohnehin schon im ersten Slice
 * steht), `sticky` faellt auf `static` zurueck und scrollt natuerlich mit.
 * Liefert eine Restore-Funktion, die die Original-Inline-Styles zuruecksetzt.
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
    log.warn('Fixed/Sticky-Unterdrueckung fehlgeschlagen', e);
  }
  return () => {
    for (const t of touched) {
      if (t.value) t.el.style.setProperty(t.prop, t.value, t.priority);
      else t.el.style.removeProperty(t.prop);
    }
  };
}

/**
 * Full-Page-Screenshot eines Device-Frames: das Frame-Dokument wird in
 * Viewport-Schritten gescrollt, jeder Slice per captureVisibleTab
 * fotografiert (Limit: 2 Aufrufe/s, daher 600 ms Abstand) und auf ein
 * Canvas in voller Dokumenthoehe gestitcht. Marker und Notiz-Sprechblasen
 * des Overlays sind in jedem Slice enthalten. Fixed/Sticky-Elemente
 * erscheinen genau einmal — an ihrer natuerlichen Position im ersten Slice
 * (siehe `suppressFixedElements`).
 */
export async function captureFullFrameShot(
  iframe: HTMLIFrameElement,
  getRect: () => DOMRect,
  zoom: number,
  onSlice?: () => void,
): Promise<Blob | null> {
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
    // Frame nicht lesbar — dann wenigstens der sichtbare Ausschnitt.
    return captureElementShot(getRect());
  }

  if (docH > MAX_SLICES * viewH) {
    log.warn('Seite zu lang fuer Full-Page-Capture, schneide ab', {
      docH,
      viewH,
    });
  }

  const parts: { docY: number; canvas: HTMLCanvasElement }[] = [];
  let unit = 0; // Canvas-Pixel pro Dokument-Pixel
  let y = 0;
  let restoreFixed: (() => void) | null = null;
  try {
    for (let i = 0; i < MAX_SLICES; i++) {
      const targetY = Math.max(0, Math.min(y, docH - viewH));
      // Der erste Slice zeigt Header & Co. an ihrer echten Position — ab dem
      // zweiten wuerden sie sich wiederholen und werden unterdrueckt.
      if (i === 1) restoreFixed = suppressFixedElements(win.document);
      try {
        win.scrollTo(0, targetY);
      } catch {
        break;
      }
      // Renderzeit + captureVisibleTab-Limit (2 Aufrufe/s).
      await new Promise((r) => setTimeout(r, 600));
      const shot = await captureCropped(getRect());
      if (!shot) break;
      onSlice?.();

      unit = shot.scale * zoom;
      parts.push({ docY: targetY, canvas: shot.canvas });
      // Sichtbare Dokumenthoehe dieses Slices — kleiner als viewH, wenn der
      // Frame am Fensterrand beschnitten ist; dann in kleineren Schritten weiter.
      const covered = shot.canvas.height / unit;
      y = targetY + covered;
      if (targetY >= docH - viewH || y >= docH - 1) break;
    }
  } finally {
    try {
      restoreFixed?.();
    } catch {
      /* Frame schon weg */
    }
  }

  try {
    win.scrollTo(previousScroll.x, previousScroll.y);
  } catch {
    /* Frame schon weg */
  }

  if (parts.length === 0 || unit === 0) return null;

  const width = Math.max(...parts.map((p) => p.canvas.width));
  const coveredH = Math.min(
    docH,
    parts.reduce((max, p) => Math.max(max, p.docY + p.canvas.height / unit), 0),
  );
  const full = document.createElement('canvas');
  full.width = width;
  full.height = Math.round(coveredH * unit);
  const ctx = full.getContext('2d')!;
  for (const part of parts) {
    ctx.drawImage(part.canvas, 0, Math.round(part.docY * unit));
  }
  return toBlob(full);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
