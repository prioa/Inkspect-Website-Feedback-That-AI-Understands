import { CHROME_STORE_BADGE } from './storeBadge';

/**
 * Header bar above the screenshot: logo, wordmark and tagline on the left,
 * buttons on the right. Behind "Open on web" sits the share link (deflate-
 * compressed in the hash, no server involved): whoever receives the file is
 * one click away from the same annotations in Inkspect.
 *
 * Everything is drawn into the canvas; the buttons only become clickable in
 * the PDF, which lays link areas over the rectangles returned here.
 */

/** Where the extension lives in the store. */
export const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/opckhhggofkbihbnabhhaidgknmniebk';

/**
 * The Inkspect logo as a data URI. Inline rather than
 * `browser.runtime.getURL`: extension files are not web-accessible, and an
 * SVG without external references does not taint the canvas.
 */
const LOGO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
      '<rect width="128" height="128" rx="24" fill="#12151d"/>' +
      '<path d="M64 10C46 38 30 55 30 76a34 34 0 0 0 68 0C98 55 82 38 64 10Z" fill="#5b8cff"/>' +
      '<path d="m62 58 48 18-20.5 8L81.5 106 62 58Z" fill="#fff" stroke="#12151d" ' +
      'stroke-width="7" stroke-linejoin="round"/>' +
      '</svg>',
  );

const TAGLINE = 'website feedback that ai understands';

/** Capture date for the header bar — formatted locally, without a time. */
function today(): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export interface BannerButton {
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
}

export interface Banner {
  canvas: HTMLCanvasElement;
  buttons: BannerButton[];
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Draws the header bar at the width of the screenshot and returns it along
 * with the rectangles that become clickable in the PDF.
 *
 * Deliberately a single flat row: brand and page on the left, buttons on the
 * right. The share link sits behind "Open on web" — in the PDF that is a real
 * link, whereas a QR code would only be ballast there and used to bloat the
 * bar unnecessarily.
 */
export async function renderBanner(
  width: number,
  shareUrl: string | null,
  pageLabel: string,
): Promise<Banner | null> {
  // Scale off the image width: a bar that looks right at 1200 px is lost and
  // tiny at 3000 px.
  const u = Math.max(1, width / 1200);
  /**
   * Narrow images (phone viewports) get two rows. In a single row nothing of
   * the brand and tagline would survive — at 342 px wide it read "ink" next to
   * a squashed store badge.
   */
  const narrow = width < 620;
  const padX = Math.round((narrow ? 12 : 22) * u);
  const btnH = Math.round((narrow ? 26 : 30) * u);
  const logoSize = Math.round((narrow ? 22 : 30) * u);
  const titleSize = Math.round((narrow ? 15 : 19) * u);
  const bodySize = Math.round((narrow ? 10.5 : 13) * u);
  const gap = Math.round(8 * u);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  const rowH = Math.max(btnH, logoSize);
  const padY = Math.round((narrow ? 10 : 13) * u);
  const height = narrow
    ? padY * 2 + logoSize + gap + btnH
    : padY * 2 + rowH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#12151d';
  ctx.fillRect(0, 0, canvas.width, height);
  // Fine accent edge towards the page.
  const edge = Math.max(1, Math.round(2 * u));
  ctx.fillStyle = '#5b8cff';
  ctx.fillRect(0, height - edge, canvas.width, edge);

  const buttons: BannerButton[] = [];
  const badge = await loadImage(CHROME_STORE_BADGE);
  const badgeW = badge ? Math.round((btnH * badge.naturalWidth) / badge.naturalHeight) : 0;
  const logo = await loadImage(LOGO);

  /** Draw the "Open on web" pill and report it as a click area. */
  const drawOpen = (x: number, y: number): number => {
    if (!shareUrl) return 0;
    ctx.font = `600 ${Math.round((narrow ? 11 : 13) * u)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    const label = 'Open on web ↗';
    const w = Math.round(ctx.measureText(label).width + (narrow ? 20 : 28) * u);
    ctx.fillStyle = '#5b8cff';
    roundedRect(ctx, x, y, w, btnH, btnH / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + btnH / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    buttons.push({ x, y, w, h: btnH, url: shareUrl });
    return w;
  };

  /** Store badge on a light background — it is drawn dark. */
  const drawBadge = (x: number, y: number): number => {
    if (!badge) return 0;
    ctx.fillStyle = '#fff';
    roundedRect(ctx, x, y, badgeW, btnH, Math.round(5 * u));
    ctx.fill();
    ctx.drawImage(badge, x, y, badgeW, btnH);
    buttons.push({ x, y, w: badgeW, h: btnH, url: CHROME_STORE_URL });
    return badgeW;
  };

  if (narrow) {
    // Row 1: logo, wordmark, tagline beside it (as far as it fits).
    const top = padY;
    if (logo) ctx.drawImage(logo, padX, top, logoSize, logoSize);
    const textLeft = padX + logoSize + Math.round(8 * u);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${titleSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText('inkSpect', textLeft, top + logoSize / 2);
    const afterTitle = textLeft + ctx.measureText('inkSpect').width + Math.round(8 * u);
    ctx.font = `500 ${bodySize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#aeb6c6';
    ctx.fillText(
      ellipsize(ctx, TAGLINE, canvas.width - padX - afterTitle),
      afterTitle,
      top + logoSize / 2,
    );
    ctx.textBaseline = 'alphabetic';

    // Row 2: the buttons side by side.
    const btnY = top + logoSize + gap;
    const bw = drawBadge(padX, btnY);
    drawOpen(padX + (bw ? bw + gap : 0), btnY);
    return { canvas, buttons };
  }

  // Wide variant: everything in one row, buttons on the right.
  const mid = padY + rowH / 2;
  let right = canvas.width - padX;
  if (shareUrl) {
    ctx.font = `600 ${Math.round(13 * u)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w = Math.round(ctx.measureText('Open on web ↗').width + 28 * u);
    drawOpen(right - w, Math.round(mid - btnH / 2));
    right -= w + gap;
  }
  if (badge) {
    drawBadge(right - badgeW, Math.round(mid - btnH / 2));
    right -= badgeW + gap;
  }

  if (logo) ctx.drawImage(logo, padX, Math.round(mid - logoSize / 2), logoSize, logoSize);
  let x = padX + logoSize + Math.round(11 * u);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${titleSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText('inkSpect', x, mid);
  x += ctx.measureText('inkSpect').width + Math.round(12 * u);

  // Separator between brand and tagline.
  ctx.fillStyle = '#333a49';
  ctx.fillRect(x, Math.round(mid - titleSize * 0.45), Math.max(1, Math.round(u)), Math.round(titleSize * 0.9));
  x += Math.round(12 * u);

  ctx.font = `500 ${bodySize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const room = Math.max(40, right - Math.round(14 * u) - x);
  ctx.fillStyle = '#aeb6c6';
  const claim = ellipsize(ctx, TAGLINE, room);
  ctx.fillText(claim, x, mid);

  // The page and the capture date after it, as far as the space allows.
  const used = ctx.measureText(claim).width;
  const rest = room - used - Math.round(16 * u);
  if (rest > 60 * u) {
    ctx.fillStyle = '#69728a';
    ctx.fillText(
      ellipsize(ctx, `${pageLabel} · ${today()}`, rest),
      x + used + Math.round(16 * u),
      mid,
    );
  }
  ctx.textBaseline = 'alphabetic';

  return { canvas, buttons };
}

/**
 * Caption above a detail shot: which marking is shown there, and by which
 * route its element was unfolded.
 *
 * Deliberately built the same way as the header bar — same scale, same
 * palette, same truncation. A second text renderer with proportions of its own
 * would look foreign in the same document.
 */
export function renderCaption(
  width: number,
  title: string,
  subtitle: string | null,
): HTMLCanvasElement | null {
  const u = Math.max(1, width / 1200);
  const narrow = width < 620;
  const padX = Math.round((narrow ? 12 : 22) * u);
  const padY = Math.round((narrow ? 10 : 13) * u);
  const titleSize = Math.round((narrow ? 12 : 15) * u);
  const bodySize = Math.round((narrow ? 10.5 : 13) * u);
  const gap = Math.round(5 * u);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = padY * 2 + titleSize + (subtitle ? gap + bodySize : 0);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#12151d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const room = canvas.width - padX * 2;
  ctx.textBaseline = 'top';

  ctx.fillStyle = '#fff';
  ctx.font = `700 ${titleSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(ellipsize(ctx, title, room), padX, padY);

  if (subtitle) {
    ctx.font = `500 ${bodySize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#aeb6c6';
    ctx.fillText(ellipsize(ctx, subtitle, room), padX, padY + titleSize + gap);
  }

  ctx.textBaseline = 'alphabetic';
  return canvas;
}
