import { browser } from 'wxt/browser';
import type { CaptureResponse } from './messages';
import { createLogger } from './log';

const log = createLogger('screenshot');

/**
 * Annotierte Device-Screenshots: der Background fotografiert den sichtbaren
 * Tab (inklusive gezeichneter Marker im Overlay), hier wird auf das
 * Device-Viewport-Element zugeschnitten und als PNG heruntergeladen.
 */

/** Screenshot des sichtbaren Tabs, zugeschnitten auf `rect` (CSS-Pixel). */
export async function captureElementShot(rect: DOMRect): Promise<Blob | null> {
  const res = (await browser.runtime.sendMessage({ type: 'ink:capture' })) as CaptureResponse;
  if (!res.ok) {
    log.warn('Tab-Capture fehlgeschlagen', res.error);
    return null;
  }

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = res.dataUrl;
  });

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
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
