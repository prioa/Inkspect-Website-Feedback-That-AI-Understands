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
  /**
   * Unten ein Pixel weglassen. Rundet die Frame-Hoehe auf einen Bruchteil,
   * blitzt dort der Kartenhintergrund durch — im gestitchten Bild ergibt das
   * an jeder Slice-Kante einen dunklen Strich. Der Schnitt kostet nichts:
   * gestitcht wird nach *tatsaechlich* aufgenommener Hoehe, der naechste
   * Slice setzt also exakt dort an. Oben darf nicht geschnitten werden —
   * dort ginge pro Kante ein Pixel Inhalt verloren.
   */
  const h = Math.min(rect.bottom, window.innerHeight) * scale - y - Math.ceil(scale);
  if (w < 10 || h < 10) {
    log.warn('Frame-Ausschnitt zu klein fuer einen Slice', {
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
 * Flaechenbudget des fertigen Bildes. Eine lange Seite mal Geraetepixel-
 * Dichte kommt schnell auf dreistellige Megapixel — das sprengt sowohl die
 * Bild-Ausgabe des Canvas als auch jede vernuenftige Dateigroesse im PDF.
 * Darueber wird proportional heruntergerechnet.
 */
const MAX_AREA = 40_000_000;

/** Bild auf das Flaechenbudget bringen — gibt das Original zurueck, wenn es passt. */
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
  log.info('Bild fuer das Encoding verkleinert', {
    from: `${canvas.width}x${canvas.height}`,
    to: `${scaled.width}x${scaled.height}`,
  });
  return scaled;
}

/** Obergrenze gegen absurd lange Seiten (Canvas-/Zeitbudget). */
const MAX_SLICES = 12;

/**
 * Animationen und Uebergaenge im Frame stilllegen, solange fotografiert wird.
 *
 * Ohne das faengt der Export die Seite mitten in ihren Scroll-Animationen ab:
 * eingeblendete Bloecke stehen halb transparent im Bild (sieht aus wie ein
 * Schatten quer ueber die Seite), Count-up-Zahlen zeigen Zwischenstaende
 * („77 %" statt „100 %"). Mit Dauer 0 springt jede CSS-Animation sofort in
 * ihren Endzustand, sobald sie ausgeloest wird.
 *
 * `scroll-behavior: auto` gehoert zwingend dazu: bei `smooth` wuerde unser
 * `scrollTo` sanft animieren, und die unmittelbar danach gelesene
 * Scroll-Position waere schlicht falsch — die Slices lägen versetzt.
 *
 * JS-getriebene Zaehler laufen weiter; dagegen hilft nur die Wartezeit pro
 * Slice.
 */
const FREEZE_CSS = `*,*::before,*::after{
  animation-duration:0s!important;
  animation-delay:0s!important;
  animation-iteration-count:1!important;
  transition-duration:0s!important;
  transition-delay:0s!important;
}
html{scroll-behavior:auto!important}`;

function freezeAnimations(doc: Document): () => void {
  const added: HTMLStyleElement[] = [];
  const inject = (root: Document | ShadowRoot) => {
    try {
      const style = (root.ownerDocument ?? (root as Document)).createElement('style');
      style.textContent = FREEZE_CSS;
      (root instanceof ShadowRoot ? root : root.head)?.append(style);
      added.push(style);
    } catch {
      /* Root nicht beschreibbar */
    }
  };
  try {
    inject(doc);
    // Web Components bringen ihre eigenen Styles mit — die Regel oben
    // erreicht sie nicht, sie muss in jeden offenen Shadow Root.
    for (const el of doc.querySelectorAll('*')) {
      if (el.shadowRoot) inject(el.shadowRoot);
    }
  } catch (e) {
    log.warn('Animationen liessen sich nicht stilllegen', e);
  }
  return () => {
    for (const style of added) style.remove();
  };
}

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
 * Full-Page-Aufnahme eines Device-Frames als Canvas (der Aufrufer setzt
 * daraus das PDF zusammen): das Frame-Dokument wird in
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
  /**
   * Um jede einzelne Aufnahme herum aufgerufen. Die Ueberblendung, die den
   * Frame waehrend des Scans abdeckt, wuerde sonst mitfotografiert — sie
   * verschwindet fuer den Moment des Ausloesens und ist sofort wieder da.
   */
  veil?: { hide: () => void; show: () => void },
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
    // Frame nicht lesbar — dann wenigstens der sichtbare Ausschnitt.
    const single = await captureCropped(getRect());
    return single?.canvas ?? null;
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
  // Gilt ab dem ersten Slice: Scroll-Animationen sollen ueberall schon
  // abgeschlossen sein, wenn ausgeloest wird.
  const restoreMotion = freezeAnimations(win.document);
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
      /**
       * Tatsaechliche Scroll-Position zurueckholen. Die Sollposition ist
       * gebrochen (Slice-Hoehe / Geraetepixel-Dichte), `scrollTo` rundet aber
       * — und die Seite kann die Position zusaetzlich verschieben (Snap,
       * Maximum am Dokumentende). Rechnet man weiter mit dem Sollwert, driften
       * die Slices um bis zu einem Pixel gegeneinander und an jeder Naht
       * bleibt eine feine Kante stehen.
       */
      const scrolledY = Number.isFinite(win.scrollY) ? win.scrollY : targetY;
      // Renderzeit + captureVisibleTab-Limit (2 Aufrufe/s).
      await new Promise((r) => setTimeout(r, 600));
      veil?.hide();
      /**
       * Warten, bis das Ausblenden auch wirklich *gezeichnet* ist.
       *
       * Ein einzelnes `requestAnimationFrame` genuegt dafuer nicht: dessen
       * Callback laeuft noch *vor* dem naechsten Paint. Die Abdunklung stand
       * damit zum Zeitpunkt der Aufnahme noch im Bild. Erst der zweite Frame
       * liegt hinter dem Paint des ersten; die kurze Pause danach faengt
       * zusaetzlich langsame Compositor-Durchlaeufe ab (backdrop-filter).
       */
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(null))),
      );
      await new Promise((r) => setTimeout(r, 40));
      let shot: CroppedShot | null;
      try {
        shot = await captureCropped(getRect());
      } finally {
        veil?.show();
      }
      if (!shot) break;
      onSlice?.();

      unit = shot.scale * zoom;
      parts.push({ docY: scrolledY, canvas: shot.canvas });
      // Sichtbare Dokumenthoehe dieses Slices — kleiner als viewH, wenn der
      // Frame am Fensterrand beschnitten ist; dann in kleineren Schritten weiter.
      const covered = shot.canvas.height / unit;
      y = scrolledY + covered;
      if (scrolledY >= docH - viewH || y >= docH - 1) break;
    }
  } finally {
    try {
      restoreFixed?.();
      restoreMotion();
    } catch {
      /* Frame schon weg */
    }
  }

  try {
    win.scrollTo(previousScroll.x, previousScroll.y);
  } catch {
    /* Frame schon weg */
  }

  if (parts.length === 0 || unit === 0) {
    log.warn('Kein verwertbarer Slice — kein Bild', { parts: parts.length, unit, zoom });
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
  // Deckender Grund: bliebe irgendwo ein Pixel unbeschrieben, zeigte das PNG
  // dort Transparenz — in Viewern je nach Hintergrund als schwarzer Strich.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, full.width, full.height);

  /**
   * Lueckenlos stapeln statt jeden Slice an seine gerundete Dokumentposition
   * zu setzen: `docY * unit` rundet pro Slice unabhaengig, wodurch zwischen
   * zwei Streifen ein Sub-Pixel klafft — genau die duennen dunklen Linien
   * quer durchs Bild. Stattdessen wird mitgezaehlt, wie viele Canvas-Pixel
   * schon stehen, und vom naechsten Slice nur der noch fehlende Teil kopiert.
   */
  let filled = 0;
  for (const part of parts) {
    const top = Math.round(part.docY * unit);
    // Ueberlappung mit dem bereits Gezeichneten (der letzte Slice wird an
    // `docH - viewH` geklemmt und ueberlappt den vorigen fast immer).
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
