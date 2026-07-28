import { CHROME_STORE_BADGE } from './storeBadge';

/**
 * Kopfleiste ueber dem Screenshot: Logo, Wortmarke und Claim links, rechts
 * die Knoepfe. Hinter „Open on web" steckt der Share-Link (deflate-komprimiert
 * im Hash, kein Server dahinter): wer die Datei bekommt, hat mit einem Klick
 * dieselben Anmerkungen in Inkspect.
 *
 * Gezeichnet wird alles ins Canvas; anklickbar werden die Knoepfe erst im
 * PDF, das ueber die zurueckgegebenen Rechtecke Link-Flaechen legt.
 */

/** Wo im Store die Extension liegt. */
export const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/opckhhggofkbihbnabhhaidgknmniebk';

/**
 * Inkspect-Logo als Data-URI. Inline statt `browser.runtime.getURL`:
 * Extension-Dateien sind nicht web-accessible, und ein SVG ohne externe
 * Referenzen macht das Canvas nicht „tainted".
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

/** Aufnahmedatum fuer die Kopfleiste — lokal formatiert, ohne Uhrzeit. */
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
 * Zeichnet die Kopfleiste in der Breite des Screenshots und liefert sie samt
 * der Rechtecke, die im PDF anklickbar werden.
 *
 * Bewusst eine einzige, flache Zeile: links Marke und Seite, rechts die
 * Knoepfe. Der Share-Link steckt hinter „Open on web" — im PDF ist er ein
 * echter Link, ein QR-Code waere dort nur Ballast und hat die Leiste
 * unnoetig aufgeblaeht.
 */
export async function renderBanner(
  width: number,
  shareUrl: string | null,
  pageLabel: string,
): Promise<Banner | null> {
  // Massstab an der Bildbreite: eine Leiste, die bei 1200 px gut aussieht,
  // ist bei 3000 px verloren klein.
  const u = Math.max(1, width / 1200);
  /**
   * Schmale Bilder (Handy-Viewports) bekommen zwei Zeilen. In einer Reihe
   * bliebe von Marke und Claim nichts uebrig — bei 342 px Breite stand dort
   * „ink" neben einem zerquetschten Store-Badge.
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
  // Feine Akzentkante zur Seite hin.
  const edge = Math.max(1, Math.round(2 * u));
  ctx.fillStyle = '#5b8cff';
  ctx.fillRect(0, height - edge, canvas.width, edge);

  const buttons: BannerButton[] = [];
  const badge = await loadImage(CHROME_STORE_BADGE);
  const badgeW = badge ? Math.round((btnH * badge.naturalWidth) / badge.naturalHeight) : 0;
  const logo = await loadImage(LOGO);

  /** „Open on web"-Pille zeichnen und als Klickflaeche melden. */
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

  /** Store-Badge auf hellem Grund — es ist dunkel gezeichnet. */
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
    // Zeile 1: Logo, Wortmarke, Claim daneben (so weit er passt).
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

    // Zeile 2: die Knoepfe nebeneinander.
    const btnY = top + logoSize + gap;
    const bw = drawBadge(padX, btnY);
    drawOpen(padX + (bw ? bw + gap : 0), btnY);
    return { canvas, buttons };
  }

  // Breite Variante: alles in einer Zeile, Knoepfe rechts.
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

  // Trenner zwischen Marke und Claim.
  ctx.fillStyle = '#333a49';
  ctx.fillRect(x, Math.round(mid - titleSize * 0.45), Math.max(1, Math.round(u)), Math.round(titleSize * 0.9));
  x += Math.round(12 * u);

  ctx.font = `500 ${bodySize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const room = Math.max(40, right - Math.round(14 * u) - x);
  ctx.fillStyle = '#aeb6c6';
  const claim = ellipsize(ctx, TAGLINE, room);
  ctx.fillText(claim, x, mid);

  // Die Seite und das Aufnahmedatum dahinter, so weit der Platz reicht.
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
