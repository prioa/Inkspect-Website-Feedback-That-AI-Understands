import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { browser } from 'wxt/browser';
import { arrow, autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import { Toolbar, type SyncKey, type SyncPrefs } from './Toolbar';
import { CssEditor } from './CssEditor';
import { DeviceFrame } from './DeviceFrame';
import { AnnotationPalette, FeedbackBar } from './AnnotationPalette';
import { PHONE_SCALE, PHONE_VIEW_H, PHONE_VIEW_W, PhonePreview } from './PhonePreview';
import { FEEDBACK_REMOVE_MS, FeedbackPanel } from './FeedbackPanel';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { Tour } from './Tour';
import { Nudge } from './Nudge';
import { TooltipHost } from './Tooltip';
import { HintFireContext, useHints, type HintContext, type HintId } from '@/lib/hints';
import { ConfirmDialog } from './ConfirmDialog';
import { IconWarning } from './icons';
import {
  createCustomPreset,
  createWorkspace,
  defaultDevices,
  instantiate,
  isCustomPreset,
  loadCustomPresets,
  loadGridState,
  loadWorkspaces,
  PRESETS,
  saveCustomPresets,
  saveGridState,
  saveWorkspaces,
  viewport,
  type DeviceInstance,
  type DevicePreset,
  type Workspace,
} from '@/lib/devices';
import {
  DEFAULT_SETTINGS,
  EDITOR_WIDTH_MAX,
  EDITOR_WIDTH_MIN,
  loadSettings,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  saveSettings,
  type PanelDock,
  type PanelPlacement,
  type ThemePref,
  type ToolbarPlacement,
} from '@/lib/settings';
import { frameDocument, isFrameBlocked } from '@/lib/framing';
import { ScrollSync } from '@/lib/scrollSync';
import { resolveScrollAnchor, type ScrollAnchor } from '@/lib/scrollAnchor';
import { InteractionSync } from '@/lib/interactionSync';
import {
  ANNOTATION_COLORS,
  DEFAULT_TOOL_ORDER,
  LEGACY_DEFAULT_COLOR,
  hitsShape,
  isMovableShape,
  penOverlaps,
  shapeBounds,
  translateShape,
  shapeFocusPoint,
  shapeSelector,
  type PaletteTool,
  type RevealStep,
  type Shape,
  type Tool,
} from '@/lib/annotations';
import {
  collapseShapeIn,
  isRevealed,
  resolveShapeEl,
  revealShapeIn,
  type RevealRect,
  type RevealUndo,
} from '@/lib/reveal';
import { findByShadowPath } from '@/lib/selector';
import type { ElementPickRequest, ElementShapePatch, NoteEditRequest } from './AnnotationOverlay';
import { FrameGate } from './FrameGate';
import {
  addItems,
  clearUrl,
  isMine,
  loadAll,
  normalizeUrl,
  persist,
  removeItems,
  replaceItem,
  replaceItems,
  sameOrigin,
  type FeedbackItem,
} from '@/lib/feedbackStore';
import {
  isContextInvalidated,
  onContextInvalidated,
  reportContextError,
} from '@/lib/extensionContext';
import { buildShareUrl } from '@/lib/share';
import {
  captureFullFrameShot,
  captureViewportShot,
  downloadBlob,
  fitToBudget,
  freezeAnimations,
  type Veil,
} from '@/lib/screenshot';
import { renderBanner, renderCaption, type Banner } from '@/lib/shotBanner';
import { buildPdf, type PdfImage, type PdfLink, type PdfPage } from '@/lib/pdf';
import { applyOverride, clearOverride, collectSheets, type SheetSource } from '@/lib/stylesheets';
import type { FrameBypassResponse, FrameCheckResponse } from '@/lib/messages';
import { createLogger } from '@/lib/log';
import { motionOk } from '@/lib/motion';

const APPLY_DEBOUNCE_MS = 150;
const log = createLogger('app');

/** Pseudo device of full window mode: feedback hangs off this preset id. */
/** Minimum distance of the feedback card from the window edges. */
const CARD_EDGE = 12;
/** Air between card and button — enough for the tail to stay a point. */
const CARD_GAP = 17;
/** Edge length of the tail (must match `.panel-tail` in styles.ts). */
const TAIL = 14;
/**
 * Height limits of the floating card (must match `.root--fs .panel--right` in
 * styles.ts). Below the minimum the list would no longer be a list; above the
 * maximum the card would take over the window it is only visiting.
 */
const CARD_MIN_H = 180;
const CARD_MAX_H = 560;

/** Distance from the feedback button at which the card snaps to it. */
const PANEL_SNAP = 220;

/**
 * Resting place under the pointer: the side edges win, otherwise the button,
 * otherwise the card stays where it was let go.
 */
function panelSnapAt(x: number, y: number, btn: DOMRect | null): PanelDock {
  if (x < 110) return 'left';
  if (x > window.innerWidth - 110) return 'right';
  if (btn && Math.hypot(x - (btn.left + btn.width / 2), y - (btn.top + btn.height / 2)) < PANEL_SNAP)
    return 'button';
  return 'free';
}

/**
 * Where the feedback card belongs. Returns finished CSS values — the same
 * arithmetic serves the card itself and the preview during the drag, so that
 * the two are guaranteed to mean the same thing.
 */
function panelSpot(
  placement: PanelPlacement,
  btn: DOMRect | null,
  panelWidth: number,
): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(panelWidth, vw - 2 * CARD_EDGE);
  const maxH = Math.min(vh * 0.62, CARD_MAX_H);

  if (placement.dock === 'left' || placement.dock === 'right') {
    return {
      left: placement.dock === 'left' ? CARD_EDGE : 'auto',
      right: placement.dock === 'right' ? CARD_EDGE : 'auto',
      top: CARD_EDGE,
      bottom: CARD_EDGE,
      maxHeight: 'none',
      transformOrigin: placement.dock === 'left' ? '0% 50%' : '100% 50%',
    };
  }

  if (placement.dock === 'free') {
    const left = Math.max(CARD_EDGE, Math.min(placement.x, vw - width - CARD_EDGE));
    const top = Math.max(CARD_EDGE, Math.min(placement.y, vh - 160));
    return {
      left,
      right: 'auto',
      top,
      bottom: 'auto',
      maxHeight: Math.max(CARD_MIN_H, Math.min(maxH, vh - top - CARD_EDGE)),
      transformOrigin: '50% 0%',
    };
  }

  // At the button, Floating UI takes over (see the effect below); until its
  // first measurement arrives, a rough spot on the side with more air applies.
  if (!btn) return {};
  const above = btn.top >= 260;
  if (above) {
    const left = Math.max(
      CARD_EDGE,
      Math.min(Math.round(btn.left + btn.width / 2 - width / 2), vw - width - CARD_EDGE),
    );
    return { left, right: 'auto', top: 'auto', bottom: vh - btn.top + CARD_GAP, maxHeight: maxH };
  }
  const toRight = btn.left + btn.width / 2 < vw / 2;
  return {
    left: toRight
      ? btn.right + CARD_GAP
      : Math.max(CARD_EDGE, btn.left - CARD_GAP - width),
    right: 'auto',
    top: Math.max(CARD_EDGE, Math.min(btn.top, vh - maxH - CARD_EDGE)),
    bottom: 'auto',
    maxHeight: maxH,
  };
}

/** The same area as a preview frame — anchored at the bottom it needs a height. */
function ghostOf(spot: CSSProperties, panelWidth: number): CSSProperties {
  const width = Math.min(panelWidth, window.innerWidth - 2 * CARD_EDGE);
  return spot.top === 'auto'
    ? { ...spot, width, height: spot.maxHeight }
    : { ...spot, width };
}


const FULLSCREEN_ID = 'fullscreen';
const FS_UID = 'fullscreen';
/** Pseudo device of the phone mockup in full window mode — its own feedback group. */
const FS_PHONE_ID = 'fullscreen-phone';
const FS_PHONE_UID = 'fullscreen-phone';

/** Tolerance around the marker box in the double-click hit test (document pixels). */
const EDIT_HIT_PAD = 8;

/** Gap between device cards in the grid (must match the CSS gap). */
const GRID_GAP = 20;
/** Card chrome around the viewport: 2×10px padding + 2×1px border. */
const CARD_CHROME = 22;
/** Width of the grid scrollbar (must match the ::-webkit-scrollbar rule). */
const SCROLLBAR_W = 10;

/**
 * Zoom per device: cards are packed greedily into rows (base width = viewport ×
 * zoom) and then rendered directly with `zoom`. A row is only scaled down
 * proportionally when it would otherwise run past the grid width — it is never
 * stretched beyond `zoom`. A device that is already too wide on its own is
 * scaled down to the row width (at least one device per row). The "Fit" button
 * sets `zoom` so that one row fills the width.
 */
function rowZooms(
  devices: DeviceInstance[],
  zoom: number,
  containerWidth: number,
): Map<string, number> {
  const zooms = new Map<string, number>();
  if (containerWidth <= 0) {
    for (const d of devices) zooms.set(d.uid, zoom);
    return zooms;
  }

  let row: DeviceInstance[] = [];
  let rowWidth = 0;
  const flush = () => {
    if (row.length === 0) return;
    const chrome = row.length * CARD_CHROME + (row.length - 1) * GRID_GAP;
    const base = row.reduce((sum, d) => sum + viewport(d).width * zoom, 0);
    // -1px per card as a rounding reserve, so that the row never wraps.
    const factor = Math.max(0.05, (containerWidth - chrome - row.length) / base);
    // Only scale down (factor < 1), never stretch beyond `zoom`.
    const capped = Math.min(factor, 1);
    for (const d of row) zooms.set(d.uid, zoom * capped);
    row = [];
    rowWidth = 0;
  };

  for (const d of devices) {
    const w = viewport(d).width * zoom + CARD_CHROME;
    if (row.length > 0 && rowWidth + GRID_GAP + w > containerWidth) flush();
    rowWidth = row.length === 0 ? w : rowWidth + GRID_GAP + w;
    row.push(d);
  }
  flush();
  return zooms;
}

/** Readable name of a font-weight value for the inspector tooltip. */
const WEIGHT_NAMES: Record<string, string> = {
  '100': 'Thin',
  '200': 'Extra Light',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semibold',
  '700': 'Bold',
  '800': 'Extrabold',
  '900': 'Black',
  normal: 'Regular',
  bold: 'Bold',
};
function weightLabel(weight: string): string {
  const name = WEIGHT_NAMES[weight];
  if (!name) return weight;
  return /^\d+$/.test(weight) ? `${name} ${weight}` : name;
}

/**
 * Scrolls the frame to the marker: vertically it centres, but horizontally it
 * scrolls ONLY when the marker would otherwise lie outside the visible area.
 * Plain centring would force an intrusive sideways scroll on pages with (often
 * unintended) horizontal overflow.
 */
function scrollFrameToTarget(win: Window, target: { x: number; y: number }): void {
  const margin = 24;
  let left = win.scrollX;
  if (target.x < win.scrollX + margin) left = Math.max(0, target.x - margin);
  else if (target.x > win.scrollX + win.innerWidth - margin) {
    left = target.x - win.innerWidth + margin;
  }
  win.scrollTo({
    left,
    top: Math.max(0, target.y - win.innerHeight / 2),
    behavior: 'smooth',
  });
}

/**
 * How many unfold steps stay attached to the marking. More are recorded; only
 * the last few are stored — the path travels along in share links, and
 * practically no menu goes deeper than four levels.
 */
const MAX_STORED_REVEAL = 4;

/**
 * Attaches the running session's click path to a fresh marking. Only that
 * knows how a hidden element (slideout, accordion, form step) opens up again
 * later.
 *
 * What is sorted out is whatever can no longer be found in the frame — an
 * opener that does not exist helps nobody replay anything. The rest stays
 * unfiltered: replaying only happens for an invisible target anyway, so an
 * uninvolved click in the path costs nothing.
 */
function withRevealTrail<T extends Shape>(
  shape: T,
  trail: RevealStep[],
  iframe: HTMLIFrameElement | null | undefined,
): T {
  if (trail.length === 0) return shape;
  const doc = iframe ? frameDocument(iframe) : null;
  const live = doc
    ? trail.filter((step) => findByShadowPath(doc, step.sel.split(' >>> ')) != null)
    : trail;
  const steps = live.slice(-MAX_STORED_REVEAL);
  return steps.length > 0 ? { ...shape, reveal: steps } : shape;
}

/** Docked (grid mode), the tool bar sits fixed at the bottom centre. */
const DOCKED_PLACEMENT: ToolbarPlacement = { dock: 'bottom', x: 0, y: 0 };

/** Page width of the exported PDF in points (1 pt = 1/72 inch). */
const PDF_PAGE_W = 800;
/** PDF pages must not exceed 14400 pt. */
const PDF_MAX_H = 14000;

/**
 * Assembles the header bar and the page capture into a single-page PDF. The
 * bar's buttons are drawn; here the link areas go over them, so that they
 * become clickable in the PDF.
 */
async function buildShotPdf(
  page: HTMLCanvasElement,
  banner: Banner | null,
  title: string,
  /**
   * Captures of unfolded elements, one page each with a caption. The header bar
   * stays reserved for page 1: it carries the share link and the date, and
   * delivering the link area a second time gains nothing.
   */
  details: { canvas: HTMLCanvasElement; title: string; subtitle: string | null }[] = [],
): Promise<Blob> {
  const bannerH = banner ? (banner.canvas.height / banner.canvas.width) * PDF_PAGE_W : 0;
  const pageH = (page.height / page.width) * PDF_PAGE_W;
  // Very long pages would otherwise exceed the permitted page height — then the
  // whole page shrinks along instead of being cut off.
  const shrink = Math.min(1, PDF_MAX_H / (bannerH + pageH));
  const width = PDF_PAGE_W * shrink;
  const bh = bannerH * shrink;
  const ph = pageH * shrink;

  const images: PdfImage[] = [{ canvas: page, x: 0, y: bh, w: width, h: ph }];
  const links: PdfLink[] = [];
  if (banner) {
    images.unshift({ canvas: banner.canvas, x: 0, y: 0, w: width, h: bh });
    // Convert the bar's canvas pixels into page points.
    const k = width / banner.canvas.width;
    for (const b of banner.buttons) {
      links.push({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k, url: b.url });
    }
  }
  const pages: PdfPage[] = [{ width, height: bh + ph, images, links }];

  for (const detail of details) {
    const caption = renderCaption(detail.canvas.width, detail.title, detail.subtitle);
    const capH = caption ? (caption.height / caption.width) * PDF_PAGE_W : 0;
    const shotH = (detail.canvas.height / detail.canvas.width) * PDF_PAGE_W;
    const k = Math.min(1, PDF_MAX_H / (capH + shotH));
    const w = PDF_PAGE_W * k;
    const ch = capH * k;
    const sh = shotH * k;
    const detailImages: PdfImage[] = [{ canvas: detail.canvas, x: 0, y: ch, w, h: sh }];
    if (caption) detailImages.unshift({ canvas: caption, x: 0, y: 0, w, h: ch });
    pages.push({ width: w, height: ch + sh, images: detailImages, links: [] });
  }

  return buildPdf(pages, `Inkspect feedback — ${title}`);
}

/**
 * How many detail shots a frame contributes at most. Each costs one
 * `captureVisibleTab` call and therefore around 0.64 s (limit: 2 calls/s) —
 * without a cap, a frame with many hidden targets could keep the export running
 * indefinitely.
 */
const MAX_DETAIL_SHOTS = 6;

/** One detail page: a capture of the unfolded state along with its caption. */
interface DetailShot {
  canvas: HTMLCanvasElement;
  title: string;
  subtitle: string | null;
}

/**
 * Captures of the elements that are normally not visible on the page.
 *
 * Sequence per candidate: unfold, let the marker be remeasured, scroll the
 * element into view, take a picture. Afterwards every candidate that has
 * *also* become visible in the process drops out — five notes in one menu
 * therefore produce one capture rather than five. That is more accurate than a
 * guessed grouping key and costs nothing extra.
 *
 * The caller already has the base capture in the can: that needs the page
 * untouched, whereas here it gets changed.
 */
async function captureDetailShots(
  iframe: HTMLIFrameElement,
  items: FeedbackItem[],
  getRect: () => DOMRect,
  isolate: <T>(fn: () => T) => T,
  bumpReveal: () => void,
  veil?: Veil,
): Promise<DetailShot[]> {
  const doc = frameDocument(iframe);
  const win = iframe.contentWindow;
  if (!doc || !win) return []; // frame not readable — degrade quietly, like the base capture

  // Only what is invisible right now. An element that is standing there anyway
  // would be a repetition of the base image.
  let pending = items.filter((item) => {
    const el = resolveShapeEl(doc, item.shape);
    return el != null && !isRevealed(el);
  });
  if (pending.length === 0) return [];

  const shots: DetailShot[] = [];
  // Frozen, the unfolding runs without a transition — `settleMs: 0` is enough,
  // and `scroll-behavior: auto` keeps the jump position exact.
  const restoreMotion = freezeAnimations(doc);
  const previousScroll = { x: win.scrollX, y: win.scrollY };
  try {
    while (pending.length > 0 && shots.length < MAX_DETAIL_SHOTS) {
      const [item, ...rest] = pending;
      if (!item) break;
      pending = rest;

      const result = await revealShapeIn(iframe, item.shape, { isolate, settleMs: 0 });
      if (!result.revealed || !result.rect) continue;

      // Otherwise the overlay only remeasures its markers on the next scroll;
      // without this beat the marking in the image would still be on the old box.
      bumpReveal();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

      const box = result.rect;
      try {
        win.scrollTo({
          left: Math.max(0, box.x + box.w / 2 - win.innerWidth / 2),
          top: Math.max(0, box.y + box.h / 2 - win.innerHeight / 2),
          behavior: 'instant' as ScrollBehavior,
        });
      } catch {
        /* frame already gone */
      }

      const canvas = await captureViewportShot(getRect, veil);
      if (!canvas) {
        log.warn('No detail shot for', shapeSelector(item.shape));
        continue;
      }

      const note = noteOfShape(item.shape);
      const label = item.shape.tool === 'element' ? item.shape.label : item.shape.anchorLabel;
      shots.push({
        canvas,
        title: note ? `${note} — ${label ?? ''}`.trim() : (label ?? 'Hidden element'),
        subtitle: result.steps.length > 0 ? `opened via: ${result.steps.join(' → ')}` : null,
      });

      // Whatever unfolded along with it is in the same image.
      pending = pending.filter((other) => {
        const el = resolveShapeEl(doc, other.shape);
        return el != null && !isRevealed(el);
      });
    }

    if (pending.length > 0) {
      // Truncating silently would be particularly misleading here: the PDF would
      // look complete. So it is noted in the last caption.
      log.warn('Cap on detail shots reached', { left: pending.length });
      const last = shots[shots.length - 1];
      if (last) {
        last.subtitle = `${last.subtitle ?? ''}${last.subtitle ? ' · ' : ''}` +
          `+${pending.length} more hidden spot${pending.length === 1 ? '' : 's'} not captured`;
      }
    }
  } finally {
    try {
      restoreMotion();
      win.scrollTo(previousScroll.x, previousScroll.y);
    } catch {
      /* frame already gone */
    }
  }

  return shots;
}

/** Free text of a marking — pin and text carry it as `text`. */
function noteOfShape(shape: Shape): string | null {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text || null;
  return shape.note ?? null;
}

/**
 * Visible inner area of a frame container (the padding box, without the
 * border). That is exactly the area `overflow: hidden` shows — and only it may
 * go into the screenshot, or the border colour travels into every slice.
 */
function frameClientRect(viewport: HTMLElement): DOMRect {
  const r = viewport.getBoundingClientRect();
  const cs = getComputedStyle(viewport);
  const left = r.left + (parseFloat(cs.borderLeftWidth) || 0);
  const top = r.top + (parseFloat(cs.borderTopWidth) || 0);
  return new DOMRect(left, top, viewport.clientWidth, viewport.clientHeight);
}

/** The page last opened in the frames (per tab, survives F5). */
const PAGE_KEY = 'ink-ui-page';

/**
 * How long a frame is given to reach the position taken over from the page. It
 * is the page load that is being waited out here — the watch normally ends at
 * the load event, this is only the emergency brake for one that never comes.
 */
const SEED_WINDOW_MS = 12_000;
/**
 * How much longer the position is held after the load event. Late web fonts and
 * images without a size keep moving the content around for a moment, and every
 * one of those movements would otherwise drag the section out of view again.
 */
const SEED_SETTLE_MS = 400;
/** Shared empty set — a new one per render would re-render every frame card. */
const EMPTY_UIDS: ReadonlySet<string> = new Set<string>();

/**
 * The page last opened in the previews, bound to the tab's address. Navigating
 * to a subpage inside the frames does not change the tab's `location.href` — on
 * a reload the start page would otherwise be back in the frames. If the tab
 * address is unchanged when read, it was a reload of the same page and the
 * subpage is restored; if the tab has moved on since, the entry no longer
 * applies.
 */
interface TabSession {
  /** The page in the previews. */
  page: string;
  /** Full window active — beats the `startFullscreen` setting on a reload. */
  fullscreen: boolean;
}

function readSession(): TabSession | null {
  try {
    const raw = sessionStorage.getItem(PAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TabSession> & { host?: string };
    const { host, page, fullscreen } = parsed;
    if (!host || !page || host !== normalizeUrl(location.href)) return null;
    // Foreign origins would be cross-site — the same barrier as when navigating.
    if (new URL(page).origin !== location.origin) return null;
    return { page, fullscreen: fullscreen === true };
  } catch {
    return null; // The page blocks sessionStorage, or the entry cannot be read
  }
}

function storeSession(session: TabSession): void {
  try {
    sessionStorage.setItem(
      PAGE_KEY,
      JSON.stringify({ host: normalizeUrl(location.href), ...session }),
    );
  } catch {
    /* the page blocks sessionStorage */
  }
}

export function App({
  shadowRoot,
  onClose,
  initialFeedbackOpen = false,
  initialScroll = null,
}: {
  shadowRoot: ShadowRoot;
  onClose: () => void;
  initialFeedbackOpen?: boolean;
  /**
   * Where the page stood when it was switched on — measured by the content
   * script before the UI was in the document. Every frame takes it over on its
   * first load, so the preview opens on the section that was being looked at.
   */
  initialScroll?: ScrollAnchor | null;
}) {
  // Presets = built-in plus the user's own; grid and zoom are persisted and
  // restored at startup (the setup should outlive sessions).
  const [presets, setPresets] = useState<readonly DevicePreset[]>(PRESETS);
  const [devices, setDevices] = useState<DeviceInstance[]>([]);
  // Once at mount: the tab state restored by a reload.
  const [restored] = useState(readSession);
  const [initialPage] = useState(() => restored?.page ?? location.href);
  const [src, setSrc] = useState(initialPage);
  const [zoom, setZoom] = useState(0.6);
  const [reloadKey, setReloadKey] = useState(0);
  /** Only save after the restore — or the default overwrites the stored state. */
  const layoutRestored = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [custom, grid] = await Promise.all([loadCustomPresets(), loadGridState()]);
        if (!alive) return;
        const all = [...PRESETS, ...custom];
        setPresets(all);
        const stored = (grid?.devices ?? []).flatMap((d) => {
          const preset = all.find((p) => p.id === d.presetId);
          return preset ? [{ ...instantiate(preset), rotated: !!d.rotated }] : [];
        });
        if (grid && stored.length > 0) {
          setDevices(stored);
          setZoom(grid.zoom);
        } else {
          setDevices(defaultDevices());
        }
      } catch (e) {
        // After an extension reload the storage APIs are gone — expected, and
        // the UI shows its reload notice for it.
        if (!reportContextError(e)) log.error('Loading the layout failed', e);
        if (alive) setDevices(defaultDevices());
      } finally {
        layoutRestored.current = true;
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Keep grid and zoom up to date (debounced; on every change to devices/zoom).
  useEffect(() => {
    if (!layoutRestored.current) return;
    const timer = window.setTimeout(() => {
      persist(
        saveGridState({
          devices: devices.map((d) => ({ presetId: d.id, rotated: d.rotated })),
          zoom,
        }),
        'Saving the layout',
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [devices, zoom]);

  // Persistent UI preferences: theme, panel widths, onboarding. Loaded once and
  // written on every change from then on.
  const [theme, setTheme] = useState<ThemePref>(DEFAULT_SETTINGS.theme);
  const [editorWidth, setEditorWidth] = useState(DEFAULT_SETTINGS.editorWidth);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_SETTINGS.panelWidth);
  /**
   * The running step of the guided tour, `null` when it is not running.
   * Replaces the old one-line hint: that only named the right-click, while the
   * actual gestures (dragging cards, drawing guide lines, moving a marking)
   * went undiscovered.
   */
  const [tourStep, setTourStep] = useState<number | null>(null);
  // Auto-fit: keeps the zoom such that every card fits in one row — updated on a
  // grid change and on every width change (panel/editor, window). Any manual
  // zoom switches it off.
  const [autoFit, setAutoFit] = useState(DEFAULT_SETTINGS.autoFit);
  /** Go straight to full window on opening — only evaluated at startup. */
  const [startFullscreen, setStartFullscreen] = useState(DEFAULT_SETTINGS.startFullscreen);
  /**
   * Whether the settings have arrived. They decide which mode the session
   * starts in, and they come from storage — that is, one to two frames after
   * the first render. Until then the bar stays away: otherwise it would begin
   * its entrance, only to be torn out again when a full-window start takes
   * over. Two frames later than the rest of the interface is not noticeable —
   * a bar flying in and vanishing again is.
   */
  const [settingsReady, setSettingsReady] = useState(false);
  /** How many feedback colours the bar offers (2 or 4). */
  const [paletteColorCount, setPaletteColorCount] = useState(DEFAULT_SETTINGS.paletteColorCount);
  /**
   * Placement of the tool bar in full window mode — free in the window or at
   * one of the two snap points. Outside full window mode it sits fixed at the
   * bottom (the grid is on the left there).
   */
  const [toolbarPlacement, setToolbarPlacement] = useState<ToolbarPlacement>({
    dock: DEFAULT_SETTINGS.toolbarDock,
    x: DEFAULT_SETTINGS.toolbarX,
    y: DEFAULT_SETTINGS.toolbarY,
  });
  /**
   * Optional phone mockup in full window mode. Off by default; the phone button
   * in the tool bar fetches it and remembers the choice.
   */
  const [phoneVisible, setPhoneVisible] = useState(DEFAULT_SETTINGS.phonePreview);
  // Ref mirrors for callbacks that should not reattach on every toggle.
  const phoneVisibleRef = useRef(phoneVisible);
  phoneVisibleRef.current = phoneVisible;
  /**
   * Switched off but still in flight: keeps the mockup mounted until the end of
   * its hide animation. Only `togglePhone` sets this — when restoring the
   * settings nothing should fly off that was never visible.
   */
  const [phoneClosing, setPhoneClosing] = useState(false);
  /**
   * May the mockup fade out while nothing happens? The switch on its frame
   * flips that — anyone keeping an eye on the mobile view turns it off.
   */
  const [phoneDimIdle, setPhoneDimIdle] = useState(DEFAULT_SETTINGS.phoneDimIdle);
  const settingsRestored = useRef(false);
  // Width refs: the splitter's pointerup handler persists the final state
  // without reattaching the effect on every intermediate step.
  const editorWidthRef = useRef(editorWidth);
  editorWidthRef.current = editorWidth;
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  useEffect(() => {
    let alive = true;
    void loadSettings().then((s) => {
      if (!alive) return;
      setTheme(s.theme);
      setEditorWidth(s.editorWidth);
      setPanelWidth(s.panelWidth);
      if (!s.tourDone) setTourStep(0);
      setAutoFit(s.autoFit);
      setStartFullscreen(s.startFullscreen);
      setPhoneVisible(s.phonePreview);
      setPhoneDimIdle(s.phoneDimIdle);
      setEditsShown(s.showEdits);
      setPaletteColorCount(s.paletteColorCount);
      setToolbarPlacement({ dock: s.toolbarDock, x: s.toolbarX, y: s.toolbarY });
      setPanelPlacement({ dock: s.panelDock, x: s.panelX, y: s.panelY });
      setFramingAllowed(s.framingAllowed.includes(location.origin));
      framingConsentLoaded.current = true;
      // After a reload the previous state applies — the setting only decides
      // how a fresh session starts.
      if (s.startFullscreen && !restored) setFullscreen(true);
      // The panel does *not* open across the board — whether it is needed is
      // decided only once the feedback has loaded (see below). The button and
      // the full-window tab are unaffected by this and always reachable.
      settingsRestored.current = true;
      setSettingsReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Watch the system dark preference — only relevant when theme === 'system'
  // (the CodeMirror theme then follows the system value).
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  /**
   * The UI theme in effect (add-on elements only, never the page): without an
   * explicit choice it follows the system; light/dark from the menu wins.
   */
  const uiTheme: ThemePref = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const darkUi = uiTheme === 'dark';

  const changeTheme = useCallback((next: ThemePref) => {
    setTheme(next);
    void saveSettings({ theme: next });
  }, []);

  /**
   * Trigger hints. Through a ref, because the conductor needs the complete
   * shell state (frame gate, dialogs) and can therefore only be set up much
   * further down — but the triggering callbacks stand before it. That way
   * `fire` stays stable and usable everywhere.
   */
  const fireRef = useRef<(id: HintId) => void>(() => {});
  const fire = useCallback((id: HintId) => fireRef.current(id), []);
  /** Like `fireRef`: the conductor comes into being further down. */
  const resetHintsRef = useRef<() => void>(() => {});
  const dismissHintRef = useRef<(reason: 'away') => void>(() => {});
  /** Right-clicks in the previews — see `no-palette-fullscreen`. */
  const rightClicks = useRef(0);

  /**
   * End the tour. Actively completed ("Got it"/"Done") means: it does not come
   * back. Merely dismissing it (X/Esc) counts as "later" — on the next start
   * the tips are there again.
   */
  const closeTour = useCallback((persist: boolean) => {
    setTourStep(null);
    if (persist) void saveSettings({ tourDone: true });
  }, []);
  /**
   * From the "More" menu, once more from the top. This also resets the hints —
   * "Show tips again" would otherwise be only half the truth, since the bulk of
   * the explanations lives in them.
   */
  const restartTour = useCallback(() => {
    // The first coachmark points at the tool bar — which has to be there for it.
    setFeedbackOpen(true);
    setTourStep(0);
    resetHintsRef.current();
  }, []);

  // The user's own named grid layouts (device sets).
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  useEffect(() => {
    let alive = true;
    void loadWorkspaces().then((list) => {
      if (alive) setWorkspaces(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Shortcuts-/Hilfe-Overlay.
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;

  const [sheets, setSheets] = useState<SheetSource[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editorNonce, setEditorNonce] = useState(0);

  const [blocked, setBlocked] = useState(false);
  const [bypassEnabled, setBypassEnabled] = useState(false);
  const [bypassPending, setBypassPending] = useState(false);
  /**
   * May the current URL be loaded as a frame? Settled *before* loading (the
   * headers are checked up front in the background), so that the warning
   * arrives before the page is requested at all.
   */
  const [gate, setGate] = useState<'checking' | 'open' | 'blocked'>('checking');
  /**
   * The user has already allowed this origin once — then a blocked page loads
   * straight away instead of asking again. The toolbar indicator shows the
   * change is running and takes the permission back.
   */
  const [framingAllowed, setFramingAllowed] = useState(false);
  const framingConsentLoaded = useRef(false);
  /**
   * The user deliberately carries on without the header change: the interface
   * runs, the device frames stay empty and show a notice.
   */
  const [framingSkipped, setFramingSkipped] = useState(false);
  /** URL → blocked? Prevents one pre-flight request per reload. */
  const framingChecked = useRef(new Map<string, boolean>());
  const [hint, setHint] = useState<string | null>(null);
  // Set as soon as the extension context is invalidated (an update or reload of
  // the extension with the UI open). From then on every write fails — a reload
  // banner replaces the console warning that used to repeat per save.
  const [contextLost, setContextLost] = useState(isContextInvalidated);
  useEffect(() => onContextInvalidated(() => setContextLost(true)), []);

  const [editorOpen, setEditorOpen] = useState(false);
  // Sync areas switchable one by one (the toolbar menu on the link icon).
  const [syncPrefs, setSyncPrefs] = useState<SyncPrefs>({ scroll: true, hover: true, input: true });
  const toggleSync = useCallback((key: SyncKey) => {
    setSyncPrefs((prefs) => {
      if (key === 'all') {
        const on = !(prefs.scroll && prefs.hover && prefs.input);
        return { scroll: on, hover: on, input: on };
      }
      return { ...prefs, [key]: !prefs[key] };
    });
  }, []);
  // Feedback mode (tool bar at the bottom) and the entry list (panel on the
  // right) are separate: the bar is there from the start — the tools are the
  // core of the product and should not have to be found first. The list slides
  // open as soon as there is something to show (first entry, share import,
  // existing markings on the page).
  const [feedbackOpen, setFeedbackOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(initialFeedbackOpen);
  // Full window mode: the page fills the whole window (one frame, zoom 1), the
  // tool bar floats on the left, the panel button at the bottom right.
  // After a reload the previous state counts, not the setting.
  const [fullscreen, setFullscreen] = useState(restored?.fullscreen ?? false);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  /** Last measured position of the feedback button — the card hangs off it. */
  const [feedbackBtnRect, setFeedbackBtnRect] = useState<DOMRect | null>(null);
  /** Resting place of the feedback card (remembered across sessions). */
  const [panelPlacement, setPanelPlacement] = useState<PanelPlacement>({
    dock: DEFAULT_SETTINGS.panelDock,
    x: DEFAULT_SETTINGS.panelX,
    y: DEFAULT_SETTINGS.panelY,
  });
  /** Drag in progress on the card: the current corner and the place it falls into. */
  const [panelDrag, setPanelDrag] = useState<{ x: number; y: number; snap: PanelDock } | null>(
    null,
  );
  /**
   * Entries the user has not yet seen in an open list. They visibly slide in
   * when it unfolds — otherwise you cannot tell after marking which row has just
   * appeared.
   */
  const [freshIds, setFreshIds] = useState<readonly string[]>([]);
  const seenIds = useRef(new Set<string>());


  // In full window mode the panel does not push itself into the picture
  // uninvited — instead the feedback button in the bar pulses. The counter
  // restarts the animation.
  const [feedbackPulse, setFeedbackPulse] = useState(0);
  const pulseFeedback = useCallback(() => setFeedbackPulse((n) => n + 1), []);
  /** A screenshot export is running — the add-on chrome keeps out meanwhile. */
  const [capturing, setCapturing] = useState(false);
  /** The frame currently being scanned slice by slice (overlay). */
  const [scanUid, setScanUid] = useState<string | null>(null);
  /**
   * Window rectangle of that frame. The dimming during the capture lays itself
   * *around* this area rather than on it: what is photographed is exactly the
   * frame crop, and everything outside it never lands in the image. That lets
   * it stay put instead of giving way for every single capture.
   */
  const [scanRect, setScanRect] = useState<DOMRect | null>(null);

  /**
   * A freshly drawn marking while "My edits" is off: it does not vanish
   * abruptly but stays briefly and fades out softly. Afterwards a short pulse
   * points at the switch that brings it back — otherwise it looks as if the
   * marking had been lost.
   */
  const [fadingShapeId, setFadingShapeId] = useState<string | null>(null);
  /** A counter restarts the hint animation on the switch. */
  const [editsHint, setEditsHint] = useState(0);
  const fadeTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(fadeTimer.current), []);
  /**
   * Are the markers hidden *as soon as* no tool is active any more? That is
   * exactly what decides the fade-out: while drawing they are shown anyway, and
   * `addShape` switches the tool off itself. Filled further down (where
   * `editsShown` and `panelHovered` live).
   */
  const marksRestHiddenRef = useRef(false);

  /** How long it stands plus the fade — the same as `ink-mark-fade`. */
  const FADE_MS = 1200;

  const fadeOutNewMark = useCallback(
    (shapeId: string) => {
      // If the markers stay visible, no fade-out is needed.
      if (!marksRestHiddenRef.current) return;
      window.clearTimeout(fadeTimer.current);
      setFadingShapeId(shapeId);
      fadeTimer.current = window.setTimeout(() => {
        setFadingShapeId(null);
        // Point at what brings the marking back: the switch in the bar. That is
        // always there — it used to live in the panel, and with the panel shut
        // the pulse had to take the detour via the feedback button.
        setEditsHint((n) => n + 1);
      }, FADE_MS);
    },
    [],
  );
  /**
   * In full window mode the panel visibly slides back into the button rather
   * than simply disappearing. While the animation runs it stays mounted.
   */
  const [panelClosing, setPanelClosing] = useState(false);
  const closeTimer = useRef(0);
  const closeFeedback = useCallback(() => {
    // The list is the only place the notes are visible — whoever shuts it should
    // know that nothing was deleted.
    fire('panel-closed');
    if (!fullscreenRef.current) {
      setPanelOpen(false);
      return;
    }
    setPanelClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setPanelClosing(false);
      setPanelOpen(false);
    }, 160);
  }, [fire]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const [fsSize, setFsSize] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  useEffect(() => {
    if (!fullscreen) return;
    const measure = () => setFsSize({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [fullscreen]);
  const fsDevice: DeviceInstance = useMemo(
    () => ({
      id: FULLSCREEN_ID,
      name: 'Full window',
      width: fsSize.w,
      height: fsSize.h,
      uid: FS_UID,
      rotated: false,
    }),
    [fsSize],
  );
  /** Pseudo device of the phone mockup — fixed mockup dimensions. */
  const fsPhoneDevice: DeviceInstance = useMemo(
    () => ({
      id: FS_PHONE_ID,
      name: 'Mobile preview',
      width: PHONE_VIEW_W,
      height: PHONE_VIEW_H,
      uid: FS_PHONE_UID,
      rotated: false,
    }),
    [],
  );

  /**
   * At the button resting place, Floating UI does the arithmetic: it looks for
   * the side with room (above, otherwise right/left/below), keeps the card in
   * the window and puts the tail on the centre of the button. By hand this was
   * wrong as soon as the bar no longer stood at the bottom.
   */
  const [float, setFloat] = useState<{
    style: CSSProperties;
    tail: { left: number; top: number; side: string };
  } | null>(null);
  const atButton = fullscreen && panelOpen && !panelDrag && panelPlacement.dock === 'button';
  useEffect(() => {
    if (!atButton) {
      setFloat(null);
      return;
    }
    const ref = shadowRoot.querySelector<HTMLElement>('.fsbar__feedback');
    const card = shadowRoot.querySelector<HTMLElement>('.panel--right');
    if (!ref || !card) return;
    // `animationFrame`: the button sits in a bar that recentres itself as soon
    // as an element appears or disappears (the counter on the feedback button,
    // for instance) — and it does so gliding. During that travel neither its
    // size nor the card's changes, so Floating UI's standard observers stay
    // quiet and the card would stand where the button was at the start of the
    // movement. Remeasuring every frame is the price for the tail really
    // sitting on the icon at the end; the card is only open for as long as you
    // are working with it anyway.
    return autoUpdate(ref, card, () => {
      // A button that has left the DOM measures 0×0 at the top left corner —
      // Floating UI would take that at face value and park the card in the
      // corner. Better to leave it standing where it last was.
      if (!ref.isConnected) return;
      // The tail is looked up fresh on every run: on the very first it may not
      // be in the DOM yet, and without it Floating UI does not align it either.
      const tailEl = shadowRoot.querySelector<HTMLElement>('.panel-tail') ?? undefined;
      /**
       * The height Floating UI has room for. Deliberately noted here and
       * handed on to React below, rather than written into the card's style
       * attribute in `apply`: that write goes past React, so nothing ever took
       * it back. On the way out of full window mode the card becomes an
       * ordinary column again — and stood there capped at 560 px, stuck to the
       * top of the window with a hole beneath it.
       */
      let roomH = CARD_MAX_H;
      void computePosition(ref, card, {
        strategy: 'fixed',
        placement: 'top',
        middleware: [
          offset(CARD_GAP),
          flip({ fallbackPlacements: ['right', 'left', 'bottom'], padding: CARD_EDGE }),
          shift({ padding: CARD_EDGE }),
          size({
            padding: CARD_EDGE,
            apply: ({ availableHeight }) => {
              roomH = Math.max(CARD_MIN_H, Math.min(availableHeight, CARD_MAX_H));
            },
          }),
          ...(tailEl ? [arrow({ element: tailEl, padding: 14 })] : []),
        ],
      }).then(({ x, y, placement, middlewareData }) => {
        const side = placement.split('-')[0] ?? 'top';
        const ax = middlewareData.arrow?.x;
        const ay = middlewareData.arrow?.y;
        const tail = {
          left: Math.round(
            side === 'right'
              ? x - TAIL / 2
              : side === 'left'
                ? x + card.offsetWidth - TAIL / 2
                : // Floating UI already measures the rotated box — do not correct again.
                x + (ax ?? 0),
          ),
          top: Math.round(
            side === 'top'
              ? y + card.offsetHeight - TAIL / 2
              : side === 'bottom'
                ? y - TAIL / 2
                : y + (ay ?? 0),
          ),
          side,
        };
        const style: CSSProperties = {
          left: Math.round(x),
          top: Math.round(y),
          right: 'auto',
          bottom: 'auto',
          maxHeight: roomH,
          // The card grows out of the button — which, seen from the card's
          // origin, lies where the tail sits.
          transformOrigin: `${tail.left - Math.round(x) + TAIL / 2}px ${
            tail.top - Math.round(y) + TAIL / 2
          }px`,
        };
        setFloat((prev) =>
          prev &&
          prev.style.left === style.left &&
          prev.style.top === style.top &&
          // Without this the card would keep a height that no longer fits:
          // position unchanged, room changed (window resized, bar moved).
          prev.style.maxHeight === style.maxHeight &&
          prev.tail.left === tail.left &&
          prev.tail.top === tail.top &&
          prev.tail.side === tail.side
            ? prev
            : { style, tail },
        );
      });
    }, { animationFrame: true });
  }, [atButton, shadowRoot, panelWidth, fsSize]);

  const panelTail = atButton ? float?.tail : undefined;

  /** Placement of the feedback card at the button — full window only. */
  const panelAnchor = useMemo(() => {
    if (!fullscreen) return undefined;
    // Hanging off the pointer, the card follows freely; the preview meanwhile
    // shows where it will land.
    if (panelDrag) {
      return panelSpot({ dock: 'free', x: panelDrag.x, y: panelDrag.y }, feedbackBtnRect, panelWidth);
    }
    // Floating UI overwrites the rough starting place as soon as it has measured.
    if (panelPlacement.dock === 'button' && float) return float.style;
    return panelSpot(panelPlacement, feedbackBtnRect, panelWidth);
  }, [fullscreen, panelDrag, panelPlacement, feedbackBtnRect, panelWidth, fsSize, float]);


  /** Preview frame during the drag — the same arithmetic as the card. */
  const panelGhost = useMemo(
    () =>
      panelDrag
        ? ghostOf(
            panelSpot({ dock: panelDrag.snap, x: panelDrag.x, y: panelDrag.y }, feedbackBtnRect, panelWidth),
            panelWidth,
          )
        : null,
    [panelDrag, feedbackBtnRect, panelWidth],
  );

  // Row-filling grid: the grid width is measured (it reacts to panel and editor
  // toggles too), and from it follows the effective zoom per device.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  /**
   * A callback ref rather than a plain `useRef`: the grid hangs off the frame
   * gate and only mounts once that has checked the page. An effect that reads
   * `gridRef.current` on its first run grasps at nothing until then, and
   * without a dependency on the node it never catches up — width measurement
   * and wheel zoom would stay dead for the whole session. The ref remains for
   * the imperative readers (the scrollbar probe in the fit button).
   */
  const attachGrid = useCallback((el: HTMLDivElement | null) => {
    gridRef.current = el;
    setGridEl(el);
  }, []);

  /**
   * Focused device: it stands alone — centred — in the row, and the other cards
   * give way. Purely a matter of view; the frames stay mounted (hidden rather
   * than removed), or every return from focus would reload all the pages.
   */
  const [focusUid, setFocusUid] = useState<string | null>(null);
  /** Starting position of the focused card for the FLIP animation. */
  const flipFrom = useRef<{ uid: string; left: number; top: number } | null>(null);

  const toggleFocus = useCallback((uid: string) => {
    const card = gridRef.current?.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
    if (card) {
      const r = card.getBoundingClientRect();
      flipFrom.current = { uid, left: r.left, top: r.top };
    }
    setFocusUid((current) => (current === uid ? null : uid));
  }, []);

  /**
   * FLIP: the layout change makes the card jump straight to its new place —
   * here the difference is tweened away afterwards, so that it visibly glides
   * into the centre (or back into the row).
   */
  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!from) return;
    const card = gridRef.current?.querySelector(
      `[data-uid="${CSS.escape(from.uid)}"]`,
    ) as HTMLElement | null;
    if (!card) return;
    const to = card.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    card.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 340, easing: 'cubic-bezier(.22, 1, .36, 1)' },
    );
  }, [focusUid]);

  // A removed device must not hold on to the focus.
  useEffect(() => {
    if (focusUid && !devices.some((d) => d.uid === focusUid)) setFocusUid(null);
  }, [devices, focusUid]);

  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    if (!gridEl || fullscreen) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w != null) setGridWidth(w);
    });
    observer.observe(gridEl);
    // Back to 0 on teardown: a width left standing would make the next fit
    // calculate against a grid that no longer exists.
    return () => {
      observer.disconnect();
      setGridWidth(0);
    };
  }, [gridEl, fullscreen]);

  /** Effective zoom per device (the row scaled to the full width). */
  const effZooms = useMemo(() => rowZooms(devices, zoom, gridWidth), [devices, zoom, gridWidth]);
  // Frame listeners (context menu) and the screenshot export read the current
  // value through the ref.
  const effZoomsRef = useRef(effZooms);
  effZoomsRef.current = effZooms;

  // Touch mode per device instance: the hover sync has to know about touch
  // frames (they neither send nor receive hover). The set survives frame reloads.
  const touchUids = useRef(new Set<string>());
  const handleTouchChange = useCallback((uid: string, touch: boolean) => {
    if (touch) touchUids.current.add(uid);
    else touchUids.current.delete(uid);
    const iframe = frames.current.get(uid);
    if (iframe) interactionSync.current.setTouch(iframe, touch);
  }, []);

  // Keeps the content script's open flag current: after F5 the UI comes back
  // including its panel state (sessionStorage is tab-local).
  useEffect(() => {
    try {
      sessionStorage.setItem('ink-ui-open', panelOpen ? 'feedback' : '1');
    } catch {
      /* the page blocks sessionStorage */
    }
  }, [panelOpen]);

  // Loading bar: on when navigation starts (link click, address change,
  // reload), off on the first fully loaded frame or SPA URL change.
  const [navigating, setNavigating] = useState(true);

  useEffect(() => {
    if (!navigating) return;
    // Safety net: hanging loads (or preventDefault links without navigation)
    // should not let the bar run forever.
    const timer = window.setTimeout(() => setNavigating(false), 10_000);
    return () => clearTimeout(timer);
  }, [navigating]);

  // Tool bar: 'interact' lets clicks and typing through to the page; every
  // other tool arms the drawing overlays of all frames — which device gets
  // drawn on follows from the frame under the cursor.
  const [tool, setTool] = useState<PaletteTool>('interact');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  /** The colours on offer — the first n from the palette. */
  const paletteColors = useMemo(
    () => ANNOTATION_COLORS.slice(0, paletteColorCount),
    [paletteColorCount],
  );
  // After shrinking the palette the active colour may have dropped out.
  useEffect(() => {
    if (!paletteColors.includes(color as (typeof ANNOTATION_COLORS)[number])) {
      setColor(paletteColors[0]!);
    }
  }, [paletteColors, color]);

  const changePaletteColorCount = useCallback((count: number) => {
    setPaletteColorCount(count);
    void saveSettings({ paletteColorCount: count });
  }, []);
  const placeToolbar = useCallback((next: ToolbarPlacement) => {
    setToolbarPlacement(next);
    void saveSettings({ toolbarDock: next.dock, toolbarX: next.x, toolbarY: next.y });
  }, []);
  const annotating = tool !== 'interact';
  const drawTool: Tool = tool === 'interact' ? 'element' : tool;

  const toolRef = useRef<PaletteTool>(tool);
  toolRef.current = tool;

  // Inspector mode: hovering elements shows the font size, family and weight of
  // the text underneath. Mutually exclusive with draw mode — both need the
  // frame hover exclusively.
  const [inspecting, setInspecting] = useState(false);
  const inspectingRef = useRef(inspecting);
  inspectingRef.current = inspecting;
  const [inspect, setInspect] = useState<{
    x: number;
    y: number;
    family: string;
    size: string;
    weight: string;
    style: string;
    lineHeight: string;
  } | null>(null);
  // mousemove fires densely — update the tooltip at most once per frame.
  const inspectRaf = useRef(0);
  const inspectNext = useRef<typeof inspect>(null);
  const toggleInspector = useCallback(() => {
    setInspecting((on) => {
      const next = !on;
      if (next) setTool('interact'); // overlays off, the frames receive hover
      else setInspect(null);
      return next;
    });
  }, []);

  /** Entering draw mode brings a collapsed bar back. */
  const selectTool = useCallback(
    (next: PaletteTool) => {
      if (next !== 'interact') setInspecting(false); // drawing and the inspector are mutually exclusive
      if (next !== 'interact' && toolRef.current === 'interact') {
        // The list only opens with the first entry; in full window mode only the
        // button pulses as a hint to where it lives.
        if (fullscreenRef.current) pulseFeedback();
        else setFeedbackOpen(true);
      }
      // On reaching for a drawing tool: that clicks now draw and Esc gives the
      // page back is not visible from the cursor. The element picker is left
      // out — that explains itself on the click.
      if (next !== 'interact' && next !== 'element') fire('first-draw-tool');
      setTool(next);
    },
    [pulseFeedback, fire],
  );

  /**
   * Tools in the bars and the palette — everyone gets all of them. At the same
   * time the assignment of the number keys.
   */
  const toolOrder = DEFAULT_TOOL_ORDER;

  /** Show/hide the mobile mockup in full window mode; the choice is remembered. */
  const togglePhone = useCallback(() => {
    setPhoneVisible((on) => !on);
    // On hiding, tear down only after the flight to the button; showing clears a
    // hide animation still running, and the mockup then glides back.
    setPhoneClosing(phoneVisible);
    void saveSettings({ phonePreview: !phoneVisible });
  }, [phoneVisible]);

  /**
   * Closed by the x on the mockup itself — and only here does the hint about
   * the way back follow. Whoever switched it off with the button in the bar
   * has just had their finger on that button: pointing at it afterwards
   * explains nothing and puts a bubble over the very thing that was clicked.
   * From the x, on the other hand, the mockup flies off to a button in a bar
   * that fades itself out — that is where the way back is worth a word.
   */
  const hidePhone = useCallback(() => {
    togglePhone();
    fire('phone-hidden');
  }, [togglePhone, fire]);

  /** Fading while idle on/off (the switch on the mockup's frame). */
  const togglePhoneDimIdle = useCallback(() => {
    setPhoneDimIdle(!phoneDimIdle);
    void saveSettings({ phoneDimIdle: !phoneDimIdle });
  }, [phoneDimIdle]);

  /** Remeasure the feedback button (bar moved, window changed). */
  const measureFeedbackBtn = useCallback(() => {
    setFeedbackBtnRect(
      shadowRoot.querySelector('.fsbar__feedback')?.getBoundingClientRect() ?? null,
    );
  }, [shadowRoot]);
  /**
   * Move the card by its header; on release it snaps in. As with the tool bar,
   * the drag runs over pointer capture *and* a shield across the window —
   * otherwise the page's iframe swallows the movements as soon as the pointer
   * is over it.
   */
  const startPanelDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // `.menu` and its backdrop as well as the buttons: the ⋯ sheet is a child
      // of the header, so its full-window backdrop lay *inside* the drag
      // handle. Every click meant to close the menu started a drag instead —
      // which took the pointer capture with it, so the closing click never
      // reached the backdrop and the menu stayed open for good.
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, .menu, .menu-backdrop'))
        return;
      e.preventDefault();
      const card = (e.currentTarget as HTMLElement).closest('.panel') as HTMLElement | null;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      const handle = e.currentTarget as HTMLElement;
      handle.setPointerCapture(e.pointerId);
      const btn = shadowRoot.querySelector('.fsbar__feedback')?.getBoundingClientRect() ?? null;
      const at = (ev: PointerEvent) => ({
        x: ev.clientX - offX,
        y: ev.clientY - offY,
        snap: panelSnapAt(ev.clientX, ev.clientY, btn),
      });
      const move = (ev: PointerEvent) => setPanelDrag(at(ev));
      const finish = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', cancel);
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {
          /* capture already gone */
        }
      };
      const cancel = () => {
        finish();
        setPanelDrag(null);
      };
      const up = (ev: PointerEvent) => {
        finish();
        const end = at(ev);
        setPanelDrag(null);
        const next: PanelPlacement = { dock: end.snap, x: end.x, y: end.y };
        setPanelPlacement(next);
        void saveSettings({ panelDock: next.dock, panelX: next.x, panelY: next.y });
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', cancel);
      setPanelDrag({ x: rect.left, y: rect.top, snap: panelPlacement.dock });
    },
    [shadowRoot, panelPlacement.dock],
  );

  /** Open the feedback card — measuring first the button it hangs from. */
  const openFeedback = useCallback(() => {
    measureFeedbackBtn();
    setPanelOpen(true);
  }, [measureFeedbackBtn]);

  // The tool palette is a context menu: a right-click (on the grid, the overlay
  // or inside a preview) opens it next to the mouse.
  const [paletteAt, setPaletteAt] = useState<{ x: number; y: number } | null>(null);
  const openPalette = useCallback((x: number, y: number) => setPaletteAt({ x, y }), []);
  const closePalette = useCallback(() => setPaletteAt(null), []);

  // Frame listeners would otherwise see a stale zoom.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Feedback is bound to the landing page: activeUrl follows the frame URL
  // actually loaded (link clicks in the previews included). The state holds
  // *every* entry — only the current page is drawn on the frames, and the panel
  // groups the rest by page.
  const [activeUrl, setActiveUrl] = useState(() => normalizeUrl(initialPage));
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);

  // A stable object: the tour hangs effects off it, and a fresh literal per
  // render would make it re-evaluate on every keystroke.
  const hasPageFeedback = useMemo(
    () => feedback.some((item) => item.url === activeUrl),
    [feedback, activeUrl],
  );
  const tourState = useMemo(
    () => ({ hasFeedback: hasPageFeedback, toolPicked: tool !== 'interact' }),
    [hasPageFeedback, tool],
  );

  // Record the preview page and the full window state per tab, so that a reload
  // continues where you were.
  useEffect(() => {
    storeSession({ page: activeUrl, fullscreen });
  }, [activeUrl, fullscreen]);

  // Frame listeners (dblclick) live outside the render cycle.
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const activeUrlRef = useRef(activeUrl);
  activeUrlRef.current = activeUrl;

  // Double-click on a marker in the frame: that device's overlay opens the note
  // editor with the existing text.
  const [noteEdit, setNoteEdit] = useState<({ uid: string } & NoteEditRequest) | null>(null);

  // Right-click in a preview: the device's overlay should pin the element under
  // the cursor and open its edit popup.
  const [elementPick, setElementPick] = useState<({ uid: string } & ElementPickRequest) | null>(
    null,
  );

  // Freshly mounted overlays (a full window change, navigation) would reopen a
  // leftover edit or pick request — discard it.
  useEffect(() => {
    setNoteEdit(null);
    setElementPick(null);
  }, [fullscreen, activeUrl]);

  useEffect(() => {
    let alive = true;
    loadAll()
      .then((items) => {
        if (!alive) return;
        // Pull existing markings in the old warning red over to the new default
        // colour — otherwise the page would stay red although the style has
        // changed. Deliberately chosen colours (amber, green, blue) are untouched.
        const recoloured = items
          .filter((i) => i.shape.color === LEGACY_DEFAULT_COLOR)
          .map((i) => ({ ...i, shape: { ...i.shape, color: ANNOTATION_COLORS[0] } }));
        if (recoloured.length === 0) {
          setFeedback(items);
        } else {
          const byId = new Map(recoloured.map((i) => [i.id, i]));
          setFeedback(items.map((item) => byId.get(item.id) ?? item));
          persist(replaceItems(recoloured), 'Bringing the marking colour into line');
          log.info('Old marking colour brought into line', recoloured.length);
        }
        // The panel only shows itself when there is something to show. On a page
        // without markings it would be empty space — the button fetches it back
        // at any time.
        if (items.some((i) => i.url === activeUrlRef.current)) setPanelOpen(true);
      })
      .catch((e: unknown) => log.error('Loading the feedback failed', e));
    return () => {
      alive = false;
    };
  }, []);

  const frames = useRef(new Map<string, HTMLIFrameElement>());
  /**
   * The position taken over from the page, until it is used up. It goes into
   * every frame once (`seededScroll`) and is dropped as soon as the user
   * scrolls themselves — from then on it is a long-abandoned starting point,
   * and a device added later should not jump back to it.
   */
  const pendingScroll = useRef<ScrollAnchor | null>(initialScroll);
  /** Frames that have their position — or have given up on it. */
  const seededScroll = useRef(new Set<string>());
  /** Frames currently being held at that position while they load. */
  const seedWatch = useRef(new Map<string, { raf: number; until: number; strict: boolean }>());
  /**
   * Frames still covered because they are not standing in the right place yet.
   * The set is mirrored in a ref: the watch runs per animation frame, and
   * without the mirror every one of them would go through the state setter.
   */
  const [settling, setSettling] = useState<ReadonlySet<string>>(EMPTY_UIDS);
  const settlingRef = useRef<ReadonlySet<string>>(EMPTY_UIDS);
  /**
   * The takeover is running — from switching on until the last frame has its
   * position. The loading bar keeps out of that: the covered frames already say
   * what is happening, and in the place where it is happening. Two loading
   * animations for one wait are one too many.
   *
   * Deliberately wider than `settling`: between the last cover disappearing and
   * the last frame's load event lie a few dozen milliseconds, and the bar
   * flashing up for those would be the second animation all over again.
   */
  const [takingOver, setTakingOver] = useState(initialScroll != null);
  const scrollSync = useRef(new ScrollSync());
  const interactionSync = useRef(new InteractionSync());
  const collecting = useRef(false);
  const applyTimers = useRef(new Map<string, number>());

  // Keyboard events from a frame never reach the shell window: the focus is in
  // the frame document, and key events do not cross a document boundary. The
  // load handler therefore additionally hangs the same handler into every frame
  // document — through a ref, because it runs outside the render cycle there.
  const shortcutKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});

  // The load handler runs outside the render cycle and would otherwise see
  // stale values.
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  useEffect(() => {
    const sync = scrollSync.current;
    const interactions = interactionSync.current;
    const timers = applyTimers.current;
    const watches = seedWatch.current;
    return () => {
      sync.detachAll();
      interactions.detachAll();
      for (const t of timers.values()) clearTimeout(t);
      for (const w of watches.values()) cancelAnimationFrame(w.raf);
    };
  }, []);

  useEffect(() => {
    scrollSync.current.enabled = syncPrefs.scroll;
    interactionSync.current.enabled = syncPrefs.input;
    interactionSync.current.hoverEnabled = syncPrefs.hover;
  }, [syncPrefs]);

  /**
   * "Work is happening": the first scroll in one of the previews. So far only
   * the mockup cares — it hangs its first fade off it (see `FIRST_DIM_MS` in
   * `PhonePreview`).
   *
   * Once only, and gated through a ref: the report comes on every scroll event,
   * and a state per event would be a render per scroll.
   */
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);

  /**
   * Give up the position taken over from the page. From here on the frames
   * mirror each other again — which is the point: they are wherever the user
   * has put them, and that is what the ratio is for.
   */
  const dropSeed = useCallback(() => {
    if (pendingScroll.current) log.debug('Scroll position dropped — the user is scrolling themselves');
    pendingScroll.current = null;
    scrollSync.current.hold = false;
  }, []);

  useEffect(() => {
    // As long as the frames are still taking the page's position over, they do
    // not mirror each other — each of them stands exactly on the anchor, and
    // the ratio would only pull them off it again.
    scrollSync.current.hold = pendingScroll.current != null;
    scrollSync.current.onScroll = () => {
      // The user has taken the position over — whatever the page was standing
      // at when it was switched on no longer applies.
      //
      // Not while the frames are still being positioned, though: a document
      // that is still loading gets moved around by the browser's own scroll
      // anchoring, and taking that for "they scrolled themselves" ended the
      // takeover before it had even arrived — with the mirroring back on, one
      // frame finishing loading then pulled the others off the anchor. What
      // does end it during that phase is a real gesture (see the wheel and
      // touch listeners in the load handler).
      if (seedWatch.current.size === 0) dropSeed();
      if (scrolledRef.current) return;
      scrolledRef.current = true;
      setScrolled(true);
    };
  }, [dropSeed]);

  const cover = useCallback((uid: string, on: boolean) => {
    if (settlingRef.current.has(uid) === on) return;
    const next = new Set(settlingRef.current);
    if (on) next.add(uid);
    else next.delete(uid);
    settlingRef.current = next;
    setSettling(next);
  }, []);

  /** End the watch — with `done`, the frame gets no second attempt. */
  const stopSeed = useCallback(
    (uid: string, done: boolean) => {
      const watch = seedWatch.current.get(uid);
      if (watch) cancelAnimationFrame(watch.raf);
      seedWatch.current.delete(uid);
      if (done) seededScroll.current.add(uid);
      cover(uid, false);
      // The last frame is through — the loading bar is free again.
      if (done && seedWatch.current.size === 0) setTakingOver(false);
    },
    [cover],
  );

  // Safety net: without a single frame (a page that refuses to be embedded) no
  // watch ever ends, and the bar would stay away for good.
  useEffect(() => {
    if (!takingOver) return;
    const t = window.setTimeout(() => setTakingOver(false), SEED_WINDOW_MS + 1_000);
    return () => window.clearTimeout(t);
  }, [takingOver]);

  /**
   * Put the frame at the position taken over from the page.
   *
   * `false` while it is not standing where it belongs: the anchor element is
   * missing, or the document is still too short for the position. While loading
   * (`strict`) only a real hit is set at all — the relative fallback divides by
   * a height that is still growing, and would only shove the frame around a
   * document that has not finished arriving.
   */
  const seedFrame = useCallback((iframe: HTMLIFrameElement, strict: boolean): boolean => {
    const start = pendingScroll.current;
    if (!start) return false;
    const doc = frameDocument(iframe);
    // Only on the page it was measured on: a frame that has navigated somewhere
    // else in the meantime has nothing to do with it. `about:blank` before the
    // first byte fails this too — which is exactly right.
    if (!doc || normalizeUrl(doc.location.href) !== normalizeUrl(start.url)) return false;
    const at = resolveScrollAnchor(doc, start);
    if (!at || (strict && !at.matched)) return false;
    scrollSync.current.seed(at.el, at.top, at.left);
    return !strict || !at.clamped;
  }, []);

  /**
   * Hold a frame at the taken-over position while it loads.
   *
   * The load event is far too late as the moment to set it: it only fires once
   * the last image is in. Until then the frame stands at the top of the page,
   * and the position arrives seconds later as a visible jump. So the attempt
   * runs from the moment the frame element exists, once per animation frame,
   * and carries on for a moment past the load (`SEED_SETTLE_MS`) — content
   * above the anchor keeps moving while it loads, and only re-measuring holds
   * the section still instead of shoving it along.
   *
   * Until it stands there, the frame stays covered: the first paints of a page
   * loading at the top are exactly what the takeover is meant to spare the
   * user.
   */
  const watchSeed = useCallback(
    (uid: string, iframe: HTMLIFrameElement) => {
      if (!pendingScroll.current) return;
      if (seededScroll.current.has(uid) || seedWatch.current.has(uid)) return;

      const watch = { raf: 0, until: Date.now() + SEED_WINDOW_MS, strict: true };
      seedWatch.current.set(uid, watch);
      cover(uid, true);

      const tick = () => {
        // The user has taken over, the frame is gone, or the time is up.
        if (!pendingScroll.current || frames.current.get(uid) !== iframe) {
          stopSeed(uid, true);
          return;
        }
        const placed = seedFrame(iframe, watch.strict);
        // Uncover as soon as it stands in the right place. What follows only
        // keeps it there — that is no longer worth hiding.
        if (placed) cover(uid, false);
        if (Date.now() > watch.until) {
          stopSeed(uid, true);
          return;
        }
        watch.raf = requestAnimationFrame(tick);
      };
      tick();
    },
    [cover, seedFrame, stopSeed],
  );

  // SPA navigations (pushState, no load event) are reported by the URL watchdog
  // — that is the only way feedback follows router page changes too.
  useEffect(() => {
    const sync = interactionSync.current;
    sync.onUrlChange = (href) => {
      const url = normalizeUrl(href);
      setActiveUrl((current) => (current === url ? current : url));
      setNavigating(false); // an SPA change fires no load event
    };
    sync.onNavigationStart = () => setNavigating(true);
    return () => {
      sync.onUrlChange = null;
      sync.onNavigationStart = null;
    };
  }, []);

  const handleAttach = useCallback((device: DeviceInstance, iframe: HTMLIFrameElement | null) => {
    const previous = frames.current.get(device.uid) ?? null;
    // Idempotent: repeated calls with the same element (ref cycles from React
    // re-renders) must not detach the sync listeners.
    if (previous === iframe) return;

    if (previous) {
      scrollSync.current.detach(previous);
      interactionSync.current.detach(previous);
    }

    if (iframe) frames.current.set(device.uid, iframe);
    else frames.current.delete(device.uid);

    // A fresh frame element (mount, reload, address change) may take the page's
    // position over — from here on, not only once it has loaded. Gone frames
    // just end the watch: a reload of the same page is allowed to try again.
    if (previous) stopSeed(device.uid, false);
    if (iframe) watchSeed(device.uid, iframe);
  }, [stopSeed, watchSeed]);

  const handleLoad = useCallback(
    (device: DeviceInstance, iframe: HTMLIFrameElement) => {
      setNavigating(false);
      if (isFrameBlocked(iframe)) {
        log.warn('Frame blocked', device.name, iframe.src);
        setBlocked(true);
        stopSeed(device.uid, true); // nothing to position, and nothing to cover
        return;
      }
      log.debug('Frame loaded', device.name);
      setBlocked(false);

      const doc = frameDocument(iframe);
      if (!doc) return;

      scrollSync.current.attach(iframe);
      interactionSync.current.attach(iframe);

      // The position taken over from the page is not set here (see `watchSeed`
      // — that has been running since the frame element existed). The load
      // event only ends the phase in which the anchor element alone counts, and
      // gives the layout a last moment to settle.
      const watch = seedWatch.current.get(device.uid);
      if (watch) {
        watch.strict = false;
        watch.until = Date.now() + SEED_SETTLE_MS;
      } else if (pendingScroll.current && !seededScroll.current.has(device.uid)) {
        // No watch running (the frame was already there when it was switched
        // on) — then this is the one moment for it.
        if (seedFrame(iframe, false)) log.debug('Scroll position carried into the frame', device.name);
        stopSeed(device.uid, true);
      }

      // Mockup frame: it lies over the full-window frame, and Chrome's wheel
      // latching behaves differently there depending on compositing — sometimes
      // the frame scrolls natively, sometimes the wheel events do arrive in the
      // document but move nothing. So *measure* first: if nothing moves after
      // the first wheel burst although there was room, we translate the deltas
      // by hand from then on (the scroll sync pulls the large frame along on
      // top of that). If Chrome scrolls natively, we touch nothing — otherwise
      // everything would run twice. The listener dies with the document.
      if (device.uid === FS_PHONE_UID) {
        let mode: 'probe' | 'native' | 'manual' = 'probe';
        let probeTimer = 0;
        let probeStartY = 0;
        let probeStartX = 0;
        let probeStartedAt = 0;
        let lastScrollAt = -Infinity;
        let sawScroll = false;
        let queuedY = 0;
        let queuedX = 0;
        // The position we last set — if a later 'scroll' differs from it
        // markedly, Chrome is scrolling natively after all (native scrolling
        // only starts ~100ms after the wheel event): then withdraw immediately,
        // or everything would run twice.
        let expectedY = -1;
        let expectedX = -1;
        // The compositor scrolls (when it does) independently of the event
        // timing — comparing positions is therefore a race, and the 'scroll' can
        // even arrive *before* the first wheel event. Proof of native scrolling
        // is therefore any 'scroll' within the probe window or just before it.
        doc.addEventListener(
          'scroll',
          (e) => {
            if (e.target !== doc) return; // inner scrollers say nothing
            lastScrollAt = performance.now();
            if (mode === 'probe' && probeTimer) sawScroll = true;
            const el = doc.scrollingElement;
            if (
              mode === 'manual' &&
              expectedY >= 0 &&
              el &&
              Math.abs(el.scrollTop - expectedY) + Math.abs(el.scrollLeft - expectedX) > 60
            ) {
              mode = 'native';
            }
          },
          { capture: true, passive: true },
        );
        doc.addEventListener(
          'wheel',
          (e) => {
            if (e.defaultPrevented || mode === 'native') return;
            const factor = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
            const dy = e.deltaY * factor;
            const dx = e.deltaX * factor;
            const el = doc.scrollingElement;
            if (!el) return;
            if (mode === 'manual') {
              // Instant, not by assignment: with the page's `scroll-behavior:
              // smooth` the assignment would animate and += would build on
              // intermediate positions.
              el.scrollTo({
                top: el.scrollTop + dy,
                left: el.scrollLeft + dx,
                behavior: 'instant',
              });
              expectedY = el.scrollTop;
              expectedX = el.scrollLeft;
              return;
            }
            if (!probeTimer) {
              sawScroll = false;
              probeStartY = el.scrollTop;
              probeStartX = el.scrollLeft;
              probeStartedAt = performance.now();
              queuedY = 0;
              queuedX = 0;
              probeTimer = window.setTimeout(() => {
                probeTimer = 0;
                if (sawScroll || probeStartedAt - lastScrollAt < 120) {
                  mode = 'native';
                  return;
                }
                // Only decide when movement was possible at all — scrolled to the
                // end stop says nothing.
                const maxY = el.scrollHeight - el.clientHeight;
                const maxX = el.scrollWidth - el.clientWidth;
                const couldY =
                  (queuedY > 0 && probeStartY < maxY - 1) || (queuedY < 0 && probeStartY > 1);
                const couldX =
                  (queuedX > 0 && probeStartX < maxX - 1) || (queuedX < 0 && probeStartX > 1);
                if (!couldY && !couldX) return;
                mode = 'manual';
                el.scrollTo({
                  top: el.scrollTop + queuedY,
                  left: el.scrollLeft + queuedX,
                  behavior: 'instant',
                });
                expectedY = el.scrollTop;
                expectedX = el.scrollLeft;
              }, 250);
            }
            queuedY += dy;
            queuedX += dx;
          },
          { passive: true },
        );
      }

      // A real scroll gesture ends the takeover on the spot. Without this the
      // corrections that hold the section still (see `watchSeed`) would fight
      // the user for the rest of the settle window — and losing is not the
      // point either: whoever scrolls has said where they want to be.
      // The listeners die with the document.
      for (const type of ['wheel', 'touchstart'] as const) {
        doc.addEventListener(type, dropSeed, { passive: true, capture: true });
      }

      // Shortcuts even when the focus is in the preview (a click into the
      // frame). The listener dies with the document.
      doc.addEventListener('keydown', (e) => {
        // Page down, space, arrows — scrolling with the keyboard counts too.
        dropSeed();
        shortcutKeyRef.current(e);
      }, true);
      interactionSync.current.setTouch(iframe, touchUids.current.has(device.uid));

      // A right-click in the preview picks the element under the cursor directly
      // and opens its edit popup (element picker). The frame coordinates go
      // along unchanged — the hit test is done by the device's own overlay in
      // the frame document. The listener dies with the document.
      // A click in the preview clears a standing hint bubble. Necessary because
      // in full window mode the frame fills the whole window: clicks inside it
      // never reach the outer `window`, and the listener in the conductor would
      // never fire — the bubble would stand until its timeout.
      doc.addEventListener('pointerdown', () => dismissHintRef.current('away'), true);

      doc.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        setElementPick((prev) => ({
          uid: device.uid,
          x: e.clientX,
          y: e.clientY,
          nonce: (prev?.nonce ?? 0) + 1,
        }));
        // In full window mode the bar carries only interact and the element
        // picker; the other seven tools live there on the number keys alone.
        // Only from the second right-click on — on the first, the inspect popup
        // opening explains enough already.
        rightClicks.current += 1;
        if (fullscreenRef.current && rightClicks.current >= 2) fire('no-palette-fullscreen');
      });

      // Double-click on a marker (interaction mode — only then do clicks reach
      // the frame): open the note editor with the existing text. Hit test in
      // document coordinates, rearmost entries first — those lie on top in the
      // overlay.
      doc.addEventListener('dblclick', (e) => {
        const page = feedbackRef.current.filter(
          (item) => item.deviceId === device.id && item.url === activeUrlRef.current,
        );
        for (let i = page.length - 1; i >= 0; i--) {
          const b = shapeBounds(page[i]!.shape);
          if (
            b &&
            e.pageX >= b.x - EDIT_HIT_PAD &&
            e.pageX <= b.x + b.w + EDIT_HIT_PAD &&
            e.pageY >= b.y - EDIT_HIT_PAD &&
            e.pageY <= b.y + b.h + EDIT_HIT_PAD
          ) {
            e.preventDefault();
            const shapeIdHit = page[i]!.shape.id;
            setNoteEdit((prev) => ({
              uid: device.uid,
              shapeId: shapeIdHit,
              x: e.pageX,
              y: e.pageY,
              nonce: (prev?.nonce ?? 0) + 1,
            }));
            return;
          }
        }
      });

      /**
       * Move a marker in interaction mode: clicks then land in the frame, not in
       * the overlay. What gets grabbed is only whatever hits the outline of one
       * of *your own* markings — everything else still belongs to the page
       * (links, text selection). During the drag only the UI state travels
       * along; saving happens on release.
       */
      doc.addEventListener('mousedown', (e) => {
        // In draw mode the overlay lies in front and does this itself.
        if (e.button !== 0 || toolRef.current !== 'interact' || !markersVisibleRef.current) return;
        const page = feedbackRef.current.filter(
          (item) => item.deviceId === device.id && item.url === activeUrlRef.current,
        );
        const grabbed = [...page]
          .reverse()
          .find(
            (item) =>
              isMovableShape(item.shape) &&
              isMine(item) &&
              hitsShape(item.shape, { x: e.pageX, y: e.pageY }, EDIT_HIT_PAD),
          );
        if (!grabbed) return;

        e.preventDefault();
        e.stopPropagation();
        const shapeIdHit = grabbed.shape.id;
        let last = { x: e.pageX, y: e.pageY };
        let moved = false;

        const onMove = (ev: MouseEvent) => {
          const dx = ev.pageX - last.x;
          const dy = ev.pageY - last.y;
          if (!moved && Math.hypot(dx, dy) < 2) return;
          moved = true;
          last = { x: ev.pageX, y: ev.pageY };
          nudgeShape(shapeIdHit, dx, dy);
        };
        const onUp = () => {
          doc.removeEventListener('mousemove', onMove, true);
          doc.removeEventListener('mouseup', onUp, true);
          window.removeEventListener('mouseup', onUp, true);
          if (moved) commitShape(shapeIdHit);
        };
        doc.addEventListener('mousemove', onMove, true);
        doc.addEventListener('mouseup', onUp, true);
        // Released outside the frame: the drag still has to end.
        window.addEventListener('mouseup', onUp, true);
      }, true);

      // Inspector mode: movement over the frame shows font info for the element
      // under the cursor. The listener is always there but a no-op outside
      // inspector mode. Updates are debounced via rAF.
      const win = doc.defaultView;
      doc.addEventListener(
        'mousemove',
        (e) => {
          if (!inspectingRef.current || !win) return;
          const el = e.target as Element | null;
          if (!el || el.nodeType !== 1) return;
          const cs = win.getComputedStyle(el);
          const z =
            device.uid === FS_UID
              ? 1
              : device.uid === FS_PHONE_UID
                ? PHONE_SCALE
                : (effZoomsRef.current.get(device.uid) ?? zoomRef.current);
          const rect = iframe.getBoundingClientRect();
          inspectNext.current = {
            x: rect.left + e.clientX * z,
            y: rect.top + e.clientY * z,
            family: (cs.fontFamily.split(',')[0] ?? cs.fontFamily).replace(/["']/g, '').trim(),
            size: cs.fontSize,
            weight: cs.fontWeight,
            style: cs.fontStyle,
            lineHeight: cs.lineHeight,
          };
          if (!inspectRaf.current) {
            inspectRaf.current = win.requestAnimationFrame(() => {
              inspectRaf.current = 0;
              if (inspectingRef.current) setInspect(inspectNext.current);
            });
          }
        },
        true,
      );
      doc.addEventListener('mouseleave', () => {
        if (inspectingRef.current) setInspect(null);
      });

      // Feedback follows the real page — even when navigating inside the frames.
      try {
        const url = normalizeUrl(doc.location.href);
        setActiveUrl((current) => (current === url ? current : url));
      } catch {
        /* frame not readable */
      }

      // After a frame reloads or navigates, the overrides have to take hold again.
      let reapplied = 0;
      for (const sheet of sheetsRef.current ?? []) {
        const css = overridesRef.current[sheet.id];
        if (css != null) {
          applyOverride(doc, sheet, css);
          reapplied += 1;
        }
      }
      if (reapplied > 0) log.debug('Overrides applied again', device.name, reapplied);

      if (sheetsRef.current === null && !collecting.current) {
        collecting.current = true;
        log.info('collecting stylesheets from', device.name);
        void log
          .time('collectSheets', () => collectSheets(doc))
          .then((found) => {
            log.info(
              'Stylesheets found',
              found.length,
              found.map((s) => `${s.label}${s.readable ? '' : ' (unreadable)'}`),
            );
            setSheets(found);
            setActiveId((current) => current ?? found[0]?.id ?? null);
          })
          .catch((e: unknown) => log.error('collectSheets failed', e));
      }
    },
    [dropSeed, seedFrame, stopSeed],
  );

  // Live application: runs debounced through `overrides`.
  useEffect(() => {
    const list = sheets ?? [];
    if (list.length === 0) return;

    for (const iframe of frames.current.values()) {
      const doc = frameDocument(iframe);
      if (!doc) continue;
      for (const sheet of list) {
        const css = overrides[sheet.id];
        if (css != null) applyOverride(doc, sheet, css);
      }
    }
  }, [overrides, sheets]);

  const handleChange = useCallback((id: string, css: string) => {
    const existing = applyTimers.current.get(id);
    if (existing) clearTimeout(existing);

    const timer = window.setTimeout(() => {
      applyTimers.current.delete(id);
      setOverrides((current) => ({ ...current, [id]: css }));
    }, APPLY_DEBOUNCE_MS);

    applyTimers.current.set(id, timer);
  }, []);

  const handleReset = useCallback(
    (id: string) => {
      const sheet = sheets?.find((s) => s.id === id);
      if (!sheet) return;

      const timer = applyTimers.current.get(id);
      if (timer) {
        clearTimeout(timer);
        applyTimers.current.delete(id);
      }

      for (const iframe of frames.current.values()) {
        const doc = frameDocument(iframe);
        if (doc) clearOverride(doc, sheet);
      }

      setOverrides((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setEditorNonce((n) => n + 1); // forces the editor back to the original text
    },
    [sheets],
  );

  const reloadFrames = useCallback(() => {
    scrollSync.current.detachAll();
    interactionSync.current.detachAll();
    setBlocked(false);
    setNavigating(true);
    setReloadKey((k) => k + 1);
  }, []);

  const handleNavigate = useCallback((input: string) => {
    let next: URL;
    try {
      next = new URL(input, location.href);
    } catch {
      setHint('Not a valid URL.');
      return;
    }

    if (next.origin !== location.origin) {
      setHint(
        `Only paths on ${location.origin} work here. Another site would put the previews out ` +
          `of reach — you would lose your login and Inkspect could no longer read the styles.`,
      );
      return;
    }

    setHint(null);
    scrollSync.current.detachAll();
    interactionSync.current.detachAll();
    collecting.current = false;
    setSheets(null);
    setActiveId(null);
    setOverrides({});
    setBlocked(false);
    setFramingSkipped(false);
    setActiveUrl(normalizeUrl(next.href));
    setNavigating(true);
    setSrc(next.href);
    // The src state and the frame content can diverge (link clicks navigate the
    // frames internally) — the key change forces the reload.
    setReloadKey((k) => k + 1);
  }, []);

  // Last net: if the tab leaves the page, the UI dies — the change must not be
  // left behind. tabs.onUpdated in the background covers the same case, but
  // this route is the faster one.
  useEffect(() => {
    const off = () => {
      try {
        void browser.runtime.sendMessage({ type: 'ink:frame-bypass', enabled: false });
      } catch {
        /* context already gone */
      }
    };
    window.addEventListener('pagehide', off);
    return () => window.removeEventListener('pagehide', off);
  }, []);

  /**
   * Pre-flight check of the framing headers. If the check fails (network error,
   * background unreachable), we load — detection after the load remains as a
   * net.
   */
  useEffect(() => {
    if (bypassEnabled) {
      setGate('open');
      return;
    }
    const cached = framingChecked.current.get(src);
    if (cached != null) {
      setGate(cached ? 'blocked' : 'open');
      return;
    }

    let current = true;
    setGate('checking');
    void (async () => {
      let isBlocked = false;
      try {
        const res = (await browser.runtime.sendMessage({
          type: 'ink:frame-check',
          url: src,
        })) as FrameCheckResponse;
        isBlocked = res.ok && res.blocked;
      } catch {
        isBlocked = false;
      }
      framingChecked.current.set(src, isBlocked);
      if (current) setGate(isBlocked ? 'blocked' : 'open');
    })();
    return () => {
      current = false;
    };
  }, [src, bypassEnabled]);

  /**
   * Switch the header change on. `remember` stores the consent for this origin
   * — after that, blocked pages run without asking again.
   */
  const enableBypass = useCallback(
    async (remember = true) => {
      setBypassPending(true);
      try {
        const res = (await browser.runtime.sendMessage({
          type: 'ink:frame-bypass',
          enabled: true,
          host: location.host,
        })) as FrameBypassResponse;

        if (!res.ok) {
          setHint(`Could not load the preview: ${res.error}`);
          return;
        }
        if (remember) {
          setFramingAllowed(true);
          const current = await loadSettings();
          if (!current.framingAllowed.includes(location.origin)) {
            void saveSettings({
              framingAllowed: [...current.framingAllowed, location.origin],
            });
          }
        }
        framingChecked.current.clear();
        setBypassEnabled(true);
        setGate('open');
        reloadFrames();
      } finally {
        setBypassPending(false);
      }
    },
    [reloadFrames],
  );

  /** End the change and withdraw this origin's permission. */
  const revokeBypass = useCallback(async () => {
    await browser.runtime.sendMessage({ type: 'ink:frame-bypass', enabled: false });
    const current = await loadSettings();
    void saveSettings({
      framingAllowed: current.framingAllowed.filter((o) => o !== location.origin),
    });
    framingChecked.current.clear();
    setFramingAllowed(false);
    setBypassEnabled(false);
    reloadFrames();
  }, [reloadFrames]);

  /**
   * An origin already allowed: switch the change on as soon as a page fails on
   * it — without asking again, but visibly in the tool bar.
   */
  useEffect(() => {
    if (gate !== 'blocked' || bypassEnabled || bypassPending) return;
    if (!framingConsentLoaded.current || !framingAllowed) return;
    void enableBypass(false);
  }, [gate, framingAllowed, bypassEnabled, bypassPending, enableBypass]);

  /**
   * Blocked — either spotted up front in the headers or (as a net) only at the
   * empty frame after loading. Until that is settled, no frames are rendered;
   * otherwise they request the page before the warning stood.
   */
  const frameBlocked = (gate === 'blocked' || blocked) && !bypassEnabled;
  const gateOpen = (!frameBlocked || framingSkipped) && gate !== 'checking';

  const handleClose = useCallback(async () => {
    scrollSync.current.detachAll();
    interactionSync.current.detachAll();
    // Unconditionally: the UI state can miss the rule (a second start with a
    // leftover rule) — an unnecessary switch-off costs nothing.
    try {
      await browser.runtime.sendMessage({ type: 'ink:frame-bypass', enabled: false });
    } catch {
      /* background unreachable — cleanup runs via tabs.onUpdated */
    }
    onClose();
  }, [onClose]);

  const addDevice = useCallback(
    (presetId: string) => {
      const preset = presets.find((p) => p.id === presetId);
      if (preset) setDevices((current) => [...current, instantiate(preset)]);
    },
    [presets],
  );

  /** Bring several presets into the grid at once (a quick set). */
  // Replace the grid entirely (a quick set or a saved set). If feedback already
  // exists, confirm via a modal first — replacing empties the grid.
  const [confirmReplace, setConfirmReplace] = useState<{ apply: () => void } | null>(null);
  const requestReplaceGrid = useCallback((instances: DeviceInstance[]) => {
    if (instances.length === 0) return;
    const run = () => setDevices(instances);
    if (feedbackRef.current.length > 0) setConfirmReplace({ apply: run });
    else run();
  }, []);

  /** Apply a quick set: reset the grid to exactly these presets. */
  const addDevices = useCallback(
    (presetIds: string[]) => {
      const instances = presetIds.flatMap((id) => {
        const preset = presets.find((p) => p.id === id);
        return preset ? [instantiate(preset)] : [];
      });
      // Quick sets always run from the largest device to the smallest.
      instances.sort((a, b) => b.width - a.width);
      requestReplaceGrid(instances);
    },
    [presets, requestReplaceGrid],
  );

  /** Save the current grid as a named layout. */
  const saveWorkspace = useCallback(
    (name: string) => {
      const ws = createWorkspace(
        name,
        devices.map((d) => ({ presetId: d.id, rotated: d.rotated })),
      );
      if (!ws) return;
      setWorkspaces((current) => {
        const next = [...current, ws];
        persist(saveWorkspaces(next), 'Saving the set');
        return next;
      });
      fire('first-workspace');
    },
    [devices, fire],
  );

  /** Replace the grid with a saved layout (with confirmation). */
  const applyWorkspace = useCallback(
    (ws: Workspace) => {
      const instances = ws.devices.flatMap((d) => {
        const preset = presets.find((p) => p.id === d.presetId);
        return preset ? [{ ...instantiate(preset), rotated: !!d.rotated }] : [];
      });
      requestReplaceGrid(instances);
    },
    [presets, requestReplaceGrid],
  );

  const deleteWorkspace = useCallback((id: string) => {
    setWorkspaces((current) => {
      const next = current.filter((w) => w.id !== id);
      persist(saveWorkspaces(next), 'Deleting the set');
      return next;
    });
  }, []);

  /** Set the zoom so that every card fits in one row (max. 100 %). */
  const fitZoom = useCallback(() => {
    if (devices.length === 0 || gridWidth <= 0) return;
    const chrome = devices.length * CARD_CHROME + (devices.length - 1) * GRID_GAP;
    const totalWidth = devices.reduce((sum, d) => sum + viewport(d).width, 0);
    if (totalWidth <= 0) return;

    // The vertical scrollbar takes width away as soon as the cards are taller
    // than the grid. If it is absent at the moment of the click, it still has to
    // be budgeted for: otherwise the row fits arithmetically, the bar arrives
    // with the new card height and pushes it over after all — exactly the reason
    // why only the second click used to land.
    const el = gridRef.current;
    const hasScrollbar = el ? el.scrollHeight > el.clientHeight : false;
    const avail = gridWidth - (hasScrollbar ? 0 : SCROLLBAR_W);

    // Round down rather than round: a rounded-up percent makes the row wider
    // than the grid — it then wraps instead of fitting.
    let z = Math.min(1, Math.max(0.2, Math.floor(((avail - chrome) / totalWidth) * 100) / 100));
    // Counter-check with exactly the packing condition from rowZooms: as long as
    // the row overflows arithmetically, step back one percent. Keeps the button
    // honest even when the card chrome is a pixel out.
    while (z > 0.2 && totalWidth * z + chrome > avail) {
      z = Math.round((z - 0.01) * 100) / 100;
    }
    setZoom(z);
  }, [devices, gridWidth]);

  // Auto-fit: refit on every change of the grid or the available width.
  // `fitZoom` depends on exactly those two — so the effect runs as soon as the
  // ResizeObserver has reported the new width (panel or editor opened/closed,
  // window resized) or the set has been replaced. `zoom` is deliberately not a
  // dependency: otherwise the effect would run against itself.
  useEffect(() => {
    if (!autoFit || devices.length === 0 || gridWidth <= 0) return;
    fitZoom();
  }, [autoFit, devices, gridWidth, fitZoom]);

  const autoFitRef = useRef(autoFit);
  autoFitRef.current = autoFit;

  /** Manual zoom (buttons, Cmd+Wheel) — switches the automatic one off. */
  const setZoomManual = useCallback(
    (next: number) => {
      if (autoFitRef.current) {
        setAutoFit(false);
        void saveSettings({ autoFit: false });
        // The automation goes off as a side effect — without a hint you would
        // wonder later why the grid no longer fits itself.
        fire('first-grid-zoom');
      }
      setZoom(next);
    },
    [fire],
  );

  const toggleStartFullscreen = useCallback(() => {
    setStartFullscreen((on) => {
      void saveSettings({ startFullscreen: !on });
      return !on;
    });
  }, []);

  /** Auto-fit button: on -> fit immediately (the effect above takes over). */
  const toggleAutoFit = useCallback(() => {
    const next = !autoFitRef.current;
    setAutoFit(next);
    void saveSettings({ autoFit: next });
  }, []);

  // Panel splitter: make the editor (left) and the feedback panel (right) wider
  // or narrower by dragging. During the drag, `body--resizing` swallows the
  // iframe pointer events; at the end the final width is persisted.
  const [resizing, setResizing] = useState(false);
  const startResize = useCallback(
    (which: 'editor' | 'panel') => (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = which === 'editor' ? editorWidthRef.current : panelWidthRef.current;
      setResizing(true);
      const onMove = (ev: PointerEvent) => {
        // The panel is on the right — dragging left makes it bigger.
        const delta = which === 'editor' ? ev.clientX - startX : startX - ev.clientX;
        const raw = startW + delta;
        if (which === 'editor') {
          setEditorWidth(Math.min(EDITOR_WIDTH_MAX, Math.max(EDITOR_WIDTH_MIN, raw)));
        } else {
          setPanelWidth(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, raw)));
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setResizing(false);
        void saveSettings({
          editorWidth: editorWidthRef.current,
          panelWidth: panelWidthRef.current,
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );

  // Cmd/Ctrl+wheel (trackpad pinch included) zooms the grid. A native listener
  // with passive:false — React otherwise attaches wheel passively, and then no
  // preventDefault applies.
  useEffect(() => {
    const el = gridEl;
    if (!el || fullscreen) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const step = e.deltaY > 0 ? -0.05 : 0.05;
      const next = Math.round((zoomRef.current + step) * 100) / 100;
      setZoomManual(Math.min(1, Math.max(0.2, next)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gridEl, fullscreen, setZoomManual]);

  /** Creates a custom preset (persisted) and puts it straight into the grid. */
  const addCustomDevice = useCallback((name: string, width: number, height: number) => {
    const preset = createCustomPreset(name, width, height);
    if (!preset) return;
    setPresets((current) => {
      const next = [...current, preset];
      persist(saveCustomPresets(next.filter((p) => isCustomPreset(p.id))), 'Saving the devices');
      return next;
    });
    setDevices((current) => [...current, instantiate(preset)]);
  }, []);

  // Removes a custom preset along with its grid instances. The associated
  // feedback remains — the panel shows unknown deviceIds as a group of their own.
  const removeCustomPreset = useCallback((presetId: string) => {
    if (!isCustomPreset(presetId)) return;
    setPresets((current) => {
      const next = current.filter((p) => p.id !== presetId);
      persist(saveCustomPresets(next.filter((p) => isCustomPreset(p.id))), 'Saving the devices');
      return next;
    });
    setDevices((current) => current.filter((d) => d.id !== presetId));
  }, []);

  const rotateDevice = useCallback((uid: string) => {
    setDevices((current) =>
      current.map((d) => (d.uid === uid ? { ...d, rotated: !d.rotated } : d)),
    );
  }, []);

  const removeDevice = useCallback((uid: string) => {
    const iframe = frames.current.get(uid);
    if (iframe) {
      scrollSync.current.detach(iframe);
      interactionSync.current.detach(iframe);
    }
    frames.current.delete(uid);
    setDevices((current) => current.filter((d) => d.uid !== uid));
    // Feedback deliberately remains — it hangs off URL + preset, not off the
    // grid instance.
    fire('device-removed');
  }, [fire]);

  /** Feedback entries of the current page for one device preset. */
  const itemsFor = useCallback(
    (presetId: string) =>
      feedback.filter((item) => item.deviceId === presetId && item.url === activeUrl),
    [feedback, activeUrl],
  );

  const addShape = useCallback(
    (uid: string, raw: Shape) => {
      const device =
        uid === FS_UID
          ? fsDevice
          : uid === FS_PHONE_UID
            ? fsPhoneDevice
            : devices.find((d) => d.uid === uid);
      if (!device) return;

      // The route the user took to this element belongs on the marking —
      // otherwise it points at nothing after the next reload.
      const shape = withRevealTrail(
        raw,
        interactionSync.current.revealTrail,
        frames.current.get(uid),
      );

      // The element picker and the pin are one-shot grabs: after placing, back
      // to interacting (a note field left open stays usable regardless). The
      // drawing tools stay armed by contrast — several strokes in a row are the
      // normal case; draw mode is ended by hand (Esc, clicking the tool again
      // or "Interact").
      if (shape.tool === 'element' || shape.tool === 'pin') setTool('interact');

      // Freehand: if the new stroke crosses or overlaps existing strokes of the
      // same colour on this device, they belong to one correction.
      if (shape.tool === 'pen') {
        const touching = feedback.filter(
          (item) =>
            item.url === activeUrl &&
            item.deviceId === device.id &&
            item.shape.tool === 'pen' &&
            item.shape.color === shape.color &&
            penOverlaps(item.shape.strokes, shape.strokes),
        );
        const [first, ...rest] = touching;
        if (first && first.shape.tool === 'pen') {
          const pens = [first.shape, ...rest.map((i) => i.shape), shape].filter(
            (s): s is Extract<Shape, { tool: 'pen' }> => s.tool === 'pen',
          );
          const anchors = [...new Set(pens.flatMap((s) => s.anchors ?? []))].slice(0, 6);
          const merged: FeedbackItem = {
            ...first,
            shape: {
              ...first.shape,
              strokes: pens.flatMap((s) => s.strokes),
              anchor: first.shape.anchor ?? shape.anchor,
              anchorLabel: first.shape.anchorLabel ?? shape.anchorLabel,
              anchors: anchors.length > 0 ? anchors : undefined,
              reveal: first.shape.reveal ?? shape.reveal,
            },
          };
          const obsolete = new Set(rest.map((item) => item.id));
          setFeedback((current) =>
            current
              .filter((item) => !obsolete.has(item.id))
              .map((item) => (item.id === merged.id ? merged : item)),
          );
          persist(replaceItem(merged), 'Saving the feedback');
          if (obsolete.size > 0) persist(removeItems([...obsolete]), 'Saving the feedback');
          fadeOutNewMark(merged.id);
          return;
        }
      }

      // Every marker (the element picker included) lies only on the device it
      // was placed on — no more mirroring onto other viewports.
      const item: FeedbackItem = {
        id: shape.id,
        url: activeUrl,
        deviceId: device.id,
        shape,
        createdAt: Date.now(),
      };
      setFeedback((current) => [...current, item]);
      persist(addItems([item]), 'Saving the feedback');
      fadeOutNewMark(item.id);
    },
    [devices, fsDevice, fsPhoneDevice, activeUrl, feedback, fadeOutNewMark],
  );

  /** Removes the last marker placed on the current page (whichever device). */
  const undoShape = useCallback(() => {
    const pageItems = feedback.filter((item) => item.url === activeUrl);
    const last = pageItems[pageItems.length - 1];
    if (!last) return;
    setFeedback((current) => current.filter((item) => item.id !== last.id));
    persist(removeItems([last.id]), 'Deleting the feedback');
  }, [feedback, activeUrl]);

  /**
   * Entries whose deletion is confirmed and which are still showing their exit
   * in the panel — they stay in `feedback` for that long.
   */
  const [removingIds, setRemovingIds] = useState<readonly string[]>([]);

  const removeShape = useCallback((itemId: string) => {
    // Save immediately, display gliding: the other way round the entry would be
    // out of state before there is anything to animate. Delaying the save order
    // too would be wrong — anyone closing the tab in the meantime would find the
    // deleted item back again.
    persist(removeItems([itemId]), 'Deleting the feedback');
    const drop = () => setFeedback((current) => current.filter((item) => item.id !== itemId));
    if (!motionOk()) {
      drop();
      return;
    }
    setRemovingIds((ids) => [...ids, itemId]);
    window.setTimeout(() => {
      drop();
      setRemovingIds((ids) => ids.filter((id) => id !== itemId));
    }, FEEDBACK_REMOVE_MS);
  }, []);

  /**
   * Delete button on the marker (overlay) and in the feedback panel — both ask
   * first, since deleting cannot be undone. Entry id and shape id are identical
   * (see `addShape`), so one id is enough.
   */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const askDeleteShape = useCallback((shapeId: string) => setConfirmDelete(shapeId), []);

  /** Toggle an entry's done state (the review workflow). */
  const toggleDone = useCallback(
    (itemId: string) => {
      const existing = feedback.find((item) => item.id === itemId);
      if (!existing) return;
      const updated: FeedbackItem = { ...existing, done: !existing.done };
      setFeedback((current) => current.map((item) => (item.id === itemId ? updated : item)));
      persist(replaceItem(updated), 'Saving the feedback');
    },
    [feedback],
  );

  /**
   * Set an entry's note/text. Pins and texts carry their content in `text`,
   * every other marker (freehand included) in `note`. Element markers
   * replicated onto other viewports (same syncId) get the note too — it is one
   * correction, not several.
   */
  const applyItemText = useCallback(
    (existing: FeedbackItem, value: string) => {
      const update = (shape: Shape): Shape =>
        shape.tool === 'pin' || shape.tool === 'text'
          ? { ...shape, text: value }
          : { ...shape, note: value || undefined };
      const sync = existing.shape.tool === 'element' ? existing.shape.syncId : undefined;
      const affected = feedback.filter(
        (item) =>
          item.id === existing.id ||
          (sync != null && item.shape.tool === 'element' && item.shape.syncId === sync),
      );
      const updated = affected.map((item) => ({ ...item, shape: update(item.shape) }));
      const byId = new Map(updated.map((item) => [item.id, item]));
      setFeedback((current) => current.map((item) => byId.get(item.id) ?? item));
      persist(replaceItems(updated), 'Saving the note');
    },
    [feedback],
  );

  const setShapeNote = useCallback(
    (_uid: string, shapeId: string, note: string) => {
      const existing = feedback.find((item) => item.shape.id === shapeId);
      if (!existing) return;
      applyItemText(existing, note);
    },
    [feedback, applyItemText],
  );

  /**
   * Update an element marker after reopening the popup (values, note,
   * geometry). Your own entries only — as with moving.
   */
  const updateElementShape = useCallback(
    (_uid: string, shapeId: string, patch: ElementShapePatch) => {
      const existing = feedback.find((item) => item.shape.id === shapeId);
      if (!existing || !isMine(existing) || existing.shape.tool !== 'element') return;
      // As when creating: back to interacting after saving.
      setTool('interact');
      const updated: FeedbackItem = { ...existing, shape: { ...existing.shape, ...patch } };
      setFeedback((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      persist(replaceItem(updated), 'Saving the feedback');
    },
    [feedback],
  );

  /**
   * Take over a moved marking. Your own entries only — imported feedback stays
   * where its author put it (the overlay does not even offer foreign markers
   * for dragging).
   */
  const moveShape = useCallback(
    (_uid: string, shapeId: string, dx: number, dy: number) => {
      const existing = feedback.find((item) => item.shape.id === shapeId);
      if (!existing || !isMine(existing)) return;
      const updated: FeedbackItem = { ...existing, shape: translateShape(existing.shape, dx, dy) };
      setFeedback((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      persist(replaceItem(updated), 'Moving the marking');
    },
    [feedback],
  );

  /**
   * Take over a box's new size. As with moving, your own entries only; the
   * overlay does not even give foreign markers handles.
   */
  const resizeShape = useCallback(
    (_uid: string, shapeId: string, box: { x1: number; y1: number; x2: number; y2: number }) => {
      const existing = feedback.find((item) => item.shape.id === shapeId);
      if (!existing || !isMine(existing)) return;
      const shape = existing.shape;
      if (shape.tool !== 'rect' && shape.tool !== 'ellipse') return;
      const updated: FeedbackItem = { ...existing, shape: { ...shape, ...box } };
      setFeedback((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      persist(replaceItem(updated), 'Scaling the marking');
    },
    [feedback],
  );

  /**
   * Intermediate step of a drag: only the UI state travels along, saving
   * happens on release (`commitShape`) — otherwise every mouse movement would
   * write into the store.
   */
  const nudgeShape = useCallback((shapeId: string, dx: number, dy: number) => {
    setFeedback((current) =>
      current.map((item) =>
        item.shape.id === shapeId ? { ...item, shape: translateShape(item.shape, dx, dy) } : item,
      ),
    );
  }, []);

  /** Save a marking's current state (after a drag or a number entry). */
  const commitShape = useCallback(
    (shapeId: string) => {
      const item = feedbackRef.current.find((i) => i.shape.id === shapeId);
      if (item) persist(replaceItem(item), 'Saving the marking');
      // That a finished marking can still be grabbed (drag the outline,
      // double-click for the note) is not visible from looking at it.
      fire('first-shape-done');
    },
    [fire],
  );

  /**
   * Set the gap of a line pair. The second line keeps its direction (down or
   * right, as long as no other has been drawn); `null` turns it back into a
   * single line. UI state only — `commitShape` writes.
   */
  const setLineGap = useCallback((shapeId: string, gap: number | null) => {
    setFeedback((current) =>
      current.map((item) => {
        const shape = item.shape;
        if (item.shape.id !== shapeId || (shape.tool !== 'hline' && shape.tool !== 'vline')) {
          return item;
        }
        const base = shape.tool === 'hline' ? shape.y : shape.x;
        const sign = shape.to != null && shape.to < base ? -1 : 1;
        return { ...item, shape: { ...shape, to: gap == null ? undefined : base + sign * gap } };
      }),
    );
  }, []);

  // Change or add an entry's note/text directly in the panel.
  const editItemText = useCallback(
    (itemId: string, text: string) => {
      const existing = feedback.find((item) => item.id === itemId);
      if (!existing) return;
      applyItemText(existing, text.trim());
    },
    [feedback, applyItemText],
  );

  /** "Delete all" asks first — the step cannot be undone. */
  const [confirmClear, setConfirmClear] = useState(false);
  const askClearAll = useCallback(() => setConfirmClear(true), []);

  const clearAllShapes = useCallback(() => {
    setFeedback((current) => current.filter((item) => item.url !== activeUrl));
    persist(clearUrl(activeUrl), 'Deleting the feedback');
  }, [activeUrl]);

  /**
   * Preset ids of the viewports currently visible — in full window mode only
   * the full-window frame, otherwise the cards of the grid. The panel uses it
   * to dim everything belonging to another size.
   */
  const activePresetIds = useMemo(
    () =>
      new Set(
        fullscreen
          ? phoneVisible
            ? [FULLSCREEN_ID, FS_PHONE_ID]
            : [FULLSCREEN_ID]
          : devices.map((d) => d.id),
      ),
    [fullscreen, phoneVisible, devices],
  );

  // Panel click: jump to the device — or fetch it into the grid if it was removed.
  const focusDevice = useCallback(
    (presetId: string) => {
      // Full-window feedback lives on the full-window frame — switch there.
      if (presetId === FULLSCREEN_ID) {
        setFullscreen(true);
        return;
      }
      // Mockup-Feedback: Vollbild plus eingeblendetes Mockup.
      if (presetId === FS_PHONE_ID) {
        setFullscreen(true);
        setPhoneVisible(true);
        void saveSettings({ phonePreview: true });
        return;
      }
      // The other way round: grid feedback needs the grid — leave full window.
      if (fullscreenRef.current) setFullscreen(false);
      const instance = devices.find((d) => d.id === presetId);
      if (!instance) {
        addDevice(presetId);
        return;
      }
      shadowRoot.querySelector(`[data-uid="${instance.uid}"]`)?.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    },
    [devices, addDevice, shadowRoot],
  );

  /**
   * Wait until every frame has finished loading the target page. The comparison
   * is deliberately tolerant (trailing-slash redirects such as /sub → /sub/
   * count as a hit) — otherwise the multi-page export runs into its timeout even
   * though the right page has long been standing. The panel jump to entries of
   * other pages also waits through this before flying to the marker.
   */
  const waitForPage = useCallback((url: string, timeout = 12_000): Promise<boolean> => {
    const canon = (u: string) => u.replace(/\/+$/, '');
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const list = [...frames.current.values()];
        const ready =
          list.length > 0 &&
          list.every((iframe) => {
            const doc = frameDocument(iframe);
            try {
              return (
                doc != null &&
                doc.readyState === 'complete' &&
                canon(normalizeUrl(doc.location.href)) === canon(url)
              );
            } catch {
              return false;
            }
          });
        if (ready) return resolve(true);
        if (Date.now() - start > timeout) return resolve(false);
        window.setTimeout(tick, 150);
      };
      tick();
    });
  }, []);

  /**
   * Is your own work on the preview — markings drawn, saved changes applied?
   * One switch in the bar governs both, because they answer the same question:
   * am I looking at my version or at the page as it stands? Off is the
   * before/after look.
   */
  const [editsShown, setEditsShown] = useState(DEFAULT_SETTINGS.showEdits);
  /** Pointer over the feedback panel — shows the markers. */
  const [panelHovered, setPanelHovered] = useState(false);
  /**
   * Effective visibility: hidden markers appear while the pointer is over the
   * panel — and while a tool is active. Anyone marking right now has to see
   * what is already marked; otherwise you blindly place a second marking on the
   * same spot.
   *
   * This exception is for the markers alone. The changes are handed to the
   * frames as the bare `editsShown` — a page that relaid itself out every time
   * the pointer brushed the feedback list would be unusable.
   */
  const effectiveMarkersVisible = editsShown || panelHovered || annotating;
  const markersVisibleRef = useRef(effectiveMarkersVisible);
  markersVisibleRef.current = effectiveMarkersVisible;
  marksRestHiddenRef.current = !editsShown && !panelHovered;

  /**
   * The state that decides whether a hint is shown. A stable object: the
   * conductor hangs effects off it, and a fresh literal would set them up again
   * on every render.
   */
  const hintCtx: HintContext = useMemo(
    () => ({
      capturing,
      helpOpen,
      dialogOpen: Boolean(confirmReplace || confirmDelete || confirmClear),
      gateOpen,
      tourActive: tourStep !== null,
      fullscreen,
      phoneVisible,
    }),
    [capturing, helpOpen, confirmReplace, confirmDelete, confirmClear, gateOpen, tourStep, fullscreen, phoneVisible],
  );
  const hints = useHints(hintCtx, shadowRoot);
  // The counterpart to `fire`/`resetHintsRef` further up — from here on the refs
  // point at the real conductor.
  fireRef.current = hints.fire;
  resetHintsRef.current = hints.reset;
  dismissHintRef.current = hints.dismiss;

  // Panel click on an entry: fly to the device and the marker, then flash
  // briefly — the device frame and the marker pulse, so that it is clear which
  // correction on which layout is meant.
  const [flash, setFlash] = useState<{
    uid: string;
    shapeId: string;
    nonce: number;
  } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [flash]);

  /**
   * Counts every unfold. The overlays otherwise only measure their element
   * markers on a scroll — a slideout that opens without one would leave them
   * standing on their old boxes.
   */
  const [revealNonce, setRevealNonce] = useState(0);

  /**
   * Unfold the marking's element in *all* mounted frames.
   *
   * Not only in the one flown to: on the neighbouring cards the marker would
   * otherwise keep pointing at nothing. Every frame is touched individually and
   * shielded — without `runIsolated`, `InteractionSync` additionally echoes the
   * click into all the other frames and you no longer know who triggered what.
   * With a visible element the whole call is a no-op.
   */
  /**
   * What is standing open because of a panel click — per frame one entry with
   * its route back. Deliberately a ref: nothing renders off it, and it has to
   * be current in the same tick in which the next entry is jumped to.
   */
  const openReveals = useRef<{ uid: string; shape: Shape; undo: RevealUndo[] }[]>([]);

  /**
   * Fold shut again what an earlier panel click opened. Otherwise the menu
   * unfolded for one entry stays standing when the next one is jumped to — and
   * the user is looking at a page state they never produced.
   *
   * `keepShapeId` is the entry being jumped to right now: if it hangs on the
   * same marking, it stays open. Closing and immediately unfolding again would
   * be two visible flickers for nothing.
   */
  const collapseOpenReveals = useCallback(async (keepShapeId?: string) => {
    const open = openReveals.current;
    if (open.length === 0) return;
    const keep = open.filter((o) => o.shape.id === keepShapeId);
    const close = open.filter((o) => o.shape.id !== keepShapeId);
    openReveals.current = keep;
    if (close.length === 0) return;

    const isolate = <T,>(fn: () => T) => interactionSync.current.runIsolated(fn);
    await Promise.all(
      close.map(async (o) => {
        const iframe = frames.current.get(o.uid);
        // Frame gone (device removed, page navigated): nothing left to close.
        if (!iframe) return;
        await collapseShapeIn(iframe, o.shape, o.undo, { isolate });
      }),
    );
    // Like unfolding: without this the overlays keep their markers on the boxes
    // measured while it was open.
    setRevealNonce((n) => n + 1);
  }, []);

  const revealItemEverywhere = useCallback(
    async (item: FeedbackItem, uid: string): Promise<RevealRect | null> => {
      // First shut, then open — in that order, because the marking being jumped
      // to may well sit behind the same menu.
      await collapseOpenReveals(item.shape.id);

      const isolate = <T,>(fn: () => T) => interactionSync.current.runIsolated(fn);
      const entries = [...frames.current.entries()];
      const results = await Promise.all(
        entries.map(([, iframe]) => revealShapeIn(iframe, item.shape, { isolate })),
      );
      if (results.some((r) => r.wasHidden)) setRevealNonce((n) => n + 1);

      // Note the route back for everything actually unfolded here.
      results.forEach((r, i) => {
        const entry = entries[i];
        if (!entry || !r.wasHidden || r.undo.length === 0) return;
        openReveals.current.push({ uid: entry[0], shape: item.shape, undo: r.undo });
      });

      // The fresh box of the frame flown to: `shapeFocusPoint` returns the
      // coordinates stored at drawing time, and those only hold again once the
      // element is visible *and* remeasured.
      const index = entries.findIndex(([frameUid]) => frameUid === uid);
      const focused = index >= 0 ? results[index] : null;
      return focused?.revealed ? focused.rect : null;
    },
    [collapseOpenReveals],
  );

  /** Fly to the device, centre the marker, flash — the page has to be loaded. */
  const focusItemNow = useCallback(
    async (item: FeedbackItem) => {
      // Full-window entries: switch to full window mode and flash there.
      // Mockup entries additionally need the mockup shown.
      if (item.deviceId === FULLSCREEN_ID || item.deviceId === FS_PHONE_ID) {
        const uid = item.deviceId === FS_PHONE_ID ? FS_PHONE_UID : FS_UID;
        setFullscreen(true);
        if (item.deviceId === FS_PHONE_ID && !phoneVisibleRef.current) {
          setPhoneVisible(true);
          void saveSettings({ phonePreview: true });
          // A freshly mounted mockup: only fly after the mount.
          window.setTimeout(() => void focusItemNowRef.current(item), 320);
          return;
        }
        // Unfold a hidden element first, then fly — otherwise the flash lands in
        // a place where nothing is.
        const box = await revealItemEverywhere(item, uid);
        const iframe = frames.current.get(uid);
        if (iframe) {
          const target = box
            ? { x: box.x + box.w / 2, y: box.y + box.h / 2 }
            : shapeFocusPoint(item.shape);
          try {
            const win = iframe.contentWindow;
            if (win) scrollFrameToTarget(win, target);
          } catch {
            /* frame not readable */
          }
        }
        setEditsShown(true);
        setFlash((prev) => ({
          uid,
          shapeId: item.shape.id,
          nonce: (prev?.nonce ?? 0) + 1,
        }));
        return;
      }
      // An entry of a grid device while full window mode is running: first back
      // to the grid, then (after the frames mount) fly.
      if (fullscreenRef.current) {
        setFullscreen(false);
        window.setTimeout(() => void focusItemNowRef.current(item), 320);
        return;
      }
      const instance = devices.find((d) => d.id === item.deviceId);
      if (!instance) {
        addDevice(item.deviceId);
        return;
      }
      shadowRoot.querySelector(`[data-uid="${instance.uid}"]`)?.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });

      // Unfold a hidden element first (see `revealItemEverywhere`), then scroll
      // the marker in the frame to the centre — the scroll sync pulls the other
      // frames along.
      const box = await revealItemEverywhere(item, instance.uid);
      const iframe = frames.current.get(instance.uid);
      if (iframe) {
        const target = box
          ? { x: box.x + box.w / 2, y: box.y + box.h / 2 }
          : shapeFocusPoint(item.shape);
        try {
          const win = iframe.contentWindow;
          if (win) scrollFrameToTarget(win, target);
        } catch {
          /* frame not readable */
        }
      }

      // Hidden markers would swallow the flash. Now that the view hangs on a
      // single switch, the changes come back with them — anyone jumping to an
      // entry wants to see it in their own version, not in the original.
      // For this session only: the choice is not saved until the switch.
      setEditsShown(true);
      setFlash((prev) => ({
        uid: instance.uid,
        shapeId: item.shape.id,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    },
    [devices, addDevice, shadowRoot, revealItemEverywhere],
  );
  // Ref mirror: the delayed follow-up after the full window change calls the
  // current version (the frames are standing by then).
  const focusItemNowRef = useRef(focusItemNow);
  focusItemNowRef.current = focusItemNow;

  // Panel click on an entry: if it lies on another page, navigate there first
  // and jump to the marker after loading — otherwise straight away.
  const focusItem = useCallback(
    (item: FeedbackItem) => {
      if (item.url === activeUrl) {
        void focusItemNow(item);
        return;
      }
      handleNavigate(item.url);
      void waitForPage(item.url).then((loaded) => {
        if (!loaded) log.warn('Page for the panel jump did not load in time', item.url);
        // A short delay: let the overlays and the layout of the fresh frames settle.
        window.setTimeout(() => void focusItemNow(item), 250);
      });
    },
    [activeUrl, focusItemNow, handleNavigate, waitForPage],
  );

  /**
   * Edit click on an element entry in the panel: jump to the marker and reopen
   * its edit popup. This runs over the noteEdit channel — the overlay decides
   * for itself that element markers get the popup. On another page the jump
   * navigates first; the popup can then be opened there by double-clicking.
   */
  const editElementItem = useCallback(
    (item: FeedbackItem) => {
      const shape = item.shape;
      if (shape.tool !== 'element') return;
      focusItem(item);
      if (item.url !== activeUrl) return;
      const uid =
        item.deviceId === FULLSCREEN_ID
          ? FS_UID
          : item.deviceId === FS_PHONE_ID
            ? FS_PHONE_UID
            : devices.find((d) => d.id === item.deviceId)?.uid;
      if (!uid) return;
      setNoteEdit((prev) => ({
        uid,
        shapeId: shape.id,
        x: shape.x,
        y: shape.y,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    },
    [activeUrl, devices, focusItem],
  );

  // Hover over a panel entry: quietly highlight the corresponding marking in the
  // viewport (current page only — other pages do not render).
  const [hoverMark, setHoverMark] = useState<{
    uid: string;
    shapeId: string;
  } | null>(null);
  const previewItem = useCallback(
    (item: FeedbackItem | null) => {
      if (!item || item.url !== activeUrl) {
        setHoverMark(null);
        return;
      }
      if (item.deviceId === FULLSCREEN_ID) {
        setHoverMark(fullscreen ? { uid: FS_UID, shapeId: item.shape.id } : null);
        return;
      }
      if (item.deviceId === FS_PHONE_ID) {
        setHoverMark(
          fullscreen && phoneVisible ? { uid: FS_PHONE_UID, shapeId: item.shape.id } : null,
        );
        return;
      }
      const instance = devices.find((d) => d.id === item.deviceId);
      setHoverMark(instance ? { uid: instance.uid, shapeId: item.shape.id } : null);
    },
    [devices, activeUrl, fullscreen, phoneVisible],
  );

  // Drag-and-drop ordering of the device cards: during the drag the list is
  // reordered live (the card moves aside), and saving goes through the existing
  // grid persistence.
  const [dragUid, setDragUid] = useState<string | null>(null);
  const handleDragHover = useCallback(
    (overUid: string, side: 'before' | 'after') => {
      if (!dragUid || dragUid === overUid) return;
      setDevices((list) => {
        const from = list.findIndex((d) => d.uid === dragUid);
        const over = list.findIndex((d) => d.uid === overUid);
        if (from < 0 || over < 0) return list;
        let to = side === 'before' ? over : over + 1;
        if (from < to) to -= 1; // the index applies to the list WITHOUT the dragged element
        if (to === from) return list;
        const next = [...list];
        const [moved] = next.splice(from, 1);
        if (moved) next.splice(to, 0, moved);
        return next;
      });
    },
    [dragUid],
  );

  // Click on a device's feedback counter: open the panel and briefly highlight
  // the group concerned there.
  const [panelHighlight, setPanelHighlight] = useState<{
    deviceId: string;
    nonce: number;
  } | null>(null);
  const showDeviceFeedback = useCallback((presetId: string) => {
    setPanelOpen(true);
    setPanelHighlight((prev) => ({
      deviceId: presetId,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }, []);

  // Sharing by link: feedback compressed in the URL hash. Always the current
  // page, plus the further pages selected at the button (`extraPages`) — the
  // same selection as the screenshot export. Display and copying are handled by
  // the feedback panel.
  const buildShareLink = useCallback(
    (extraPages: string[] = []) => {
      const pages = new Set([activeUrl, ...extraPages]);
      return buildShareUrl(
        activeUrl,
        feedback.filter((item) => pages.has(item.url)),
      );
    },
    [feedback, activeUrl],
  );

  // During the screenshot export the overlays render the notes as speech
  // bubbles — the text then stands at the right point in the image.
  const [showNotes, setShowNotes] = useState(false);

  /**
   * Downloads full-page screenshots for every page of the current domain with
   * open feedback (one image per device with feedback, the frame scrolled slice
   * by slice and stitched). Notes are rendered along as speech bubbles at their
   * marker. Other pages are briefly loaded into the previews for this; at the
   * end it goes back to the starting page. `onProgress` reports devices
   * done/total.
   */
  const exportScreenshots = useCallback(
    async (
      onProgress?: (done: number, total: number) => void,
      /** Additional pages from the selection at the screenshot button. */
      extraPages: string[] = [],
    ): Promise<number> => {
      /** Short page identifier for the caption of the QR badge. */
      const pathOfUrl = (url: string): string => {
        try {
          const u = new URL(url);
          return u.host + u.pathname + u.search;
        } catch {
          return url;
        }
      };
      /** Dateiname: feedback_domain_slug_DDMMYYYY.pdf */
      const fileNameOf = (url: string, deviceId: string): string => {
        const d = new Date();
        const stamp =
          String(d.getDate()).padStart(2, '0') +
          String(d.getMonth() + 1).padStart(2, '0') +
          d.getFullYear();
        const clean = (v: string) => v.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
        try {
          const u = new URL(url);
          const slug = clean(u.pathname + u.search) || 'home';
          return `feedback_${clean(u.host)}_${slug}_${clean(deviceId)}_${stamp}.pdf`;
        } catch {
          return `feedback_page_${stamp}.pdf`;
        }
      };

      const startUrl = activeUrl;
      /**
       * Open feedback of the whole domain — from it follows which frames have
       * something to show on which page. Which pages come up at all has already
       * been chosen by the user at the button.
       */
      const openAll = feedback.filter((i) => sameOrigin(i.url, startUrl) && !i.done);

      const pages = [startUrl, ...extraPages.filter((u) => u !== startUrl)];
      let currentPage = startUrl;

      /**
       * What gets photographed. In full window mode that is the one large frame
       * — the grid cards are not mounted there at all, and the feedback hangs
       * off the full-window id. Without this distinction the export found not a
       * single target in full window mode and downloaded nothing without a word.
       */
      const targets = fullscreenRef.current
        ? [
            { id: FULLSCREEN_ID, uid: FS_UID, name: 'Full window', zoom: 1 },
            // The mockup only counts when it is mounted — `shootFor` checks for
            // a connected frame anyway.
            { id: FS_PHONE_ID, uid: FS_PHONE_UID, name: 'Mobile preview', zoom: PHONE_SCALE },
          ]
        : devices.map((d) => ({
            id: d.id,
            uid: d.uid,
            name: d.name,
            zoom: effZoomsRef.current.get(d.uid) ?? zoom,
          }));

      /** Which frames have something to show on a given page. */
      const shootFor = (url: string) =>
        targets.filter(
          (t) =>
            openAll.some((i) => i.url === url && i.deviceId === t.id) &&
            frames.current.get(t.uid)?.parentElement != null,
        );

      const total = pages.reduce((sum, url) => sum + shootFor(url).length, 0);
      let done = 0;
      onProgress?.(done, total);
      if (total === 0) return 0;

      let downloads = 0;
      /**
       * Was anything unfolded along the way? Within a page that does not matter
       * (every frame is changed shielded, and between pages the navigation
       * reloads anyway) — but at the end the user would be sitting in front of
       * open menus they never opened themselves.
       */
      let revealedDuringExport = false;
      setShowNotes(true);
      // The capture photographs the visible tab — everything floating over the
      // page (tool bar, feedback button, panel, mockup) would otherwise be in
      // the picture. In full window mode the bar even covers every slice.
      setCapturing(true);
      try {
        // Render the note bubbles first and let the chrome disappear.
        await new Promise((r) => setTimeout(r, 150));

        for (const pageUrl of pages) {
        if (pageUrl !== currentPage) {
          // Another page: send the previews there and wait until it stands —
          // otherwise the export photographs the old page.
          handleNavigate(pageUrl);
          currentPage = pageUrl;
          const loaded = await waitForPage(pageUrl);
          if (!loaded) log.warn('Page may not have finished loading — capturing anyway', pageUrl);
          await new Promise((r) => setTimeout(r, 400));
        }

        // The share link carries the markings of exactly this page.
        let shareUrl: string | null = null;
        try {
          shareUrl = await buildShareUrl(
            pageUrl,
            feedback.filter((i) => i.url === pageUrl),
          );
        } catch (e) {
          log.warn('Share link for the button could not be built', e);
        }

        for (const target of shootFor(pageUrl)) {
          const iframe = frames.current.get(target.uid)!;
          const viewport = iframe.parentElement!;
          viewport.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          setScanUid(target.uid);
          // Only outside full window mode is there area around the frame for the
          // dimming to lie on.
          setScanRect(fullscreenRef.current ? null : frameClientRect(viewport));
          // The overlay has to be standing before the first slice is triggered.
          await new Promise((r) => setTimeout(r, 60));

          try {
            // The overlay lies exactly over this frame and gives way only for
            // the moment of the capture.
            // Only what lies *inside* the crop has to give way for the capture:
            // in full window mode the progress indicator, otherwise nothing —
            // the dimming lies around the frame there and stays put throughout.
            const hidden = [...shadowRoot.querySelectorAll<HTMLElement>('.shot-badge--inside')];
            const veil = {
              hide: () => hidden.forEach((el) => el.classList.add('is-away')),
              show: () => hidden.forEach((el) => el.classList.remove('is-away')),
            };
            const raw = await captureFullFrameShot(
              iframe,
              // The card's *padding box*, not its border box and not the iframe
              // either: because of `box-sizing: border-box` the content box is
              // 2px shorter than the scaled iframe, whose layout rect therefore
              // reaches into the 1px border. That ended up at the foot of every
              // slice and produced the dark lines. `clientWidth/Height` is
              // exactly the visible, clipped area.
              () => frameClientRect(viewport),
              target.zoom,
              undefined,
              veil,
            );
            if (!raw) {
              log.warn('No image for this device', target.name);
            } else {
              // Only now, with the base capture in the can, may the page be
              // changed: unfold hidden spots and photograph them individually.
              // `runIsolated` keeps that confined to this frame — the others
              // take their turn untouched.
              const details = await captureDetailShots(
                iframe,
                openAll.filter((i) => i.url === pageUrl && i.deviceId === target.id),
                () => frameClientRect(viewport),
                (fn) => interactionSync.current.runIsolated(fn),
                () => setRevealNonce((n) => n + 1),
                veil,
              );
              if (details.length > 0) revealedDuringExport = true;

              const page = fitToBudget(raw);
              const banner = await renderBanner(page.width, shareUrl, pathOfUrl(pageUrl));
              const blob = await buildShotPdf(
                page,
                banner,
                pathOfUrl(pageUrl),
                details.map((d) => ({ ...d, canvas: fitToBudget(d.canvas) })),
              );
              downloadBlob(blob, fileNameOf(pageUrl, target.id));
              downloads += 1;
            }
          } catch (e) {
            log.warn('Screenshot failed', target.name, e);
          }

          done += 1;
          onProgress?.(done, total);
        }
        }
      } finally {
        setShowNotes(false);
        setCapturing(false);
        setScanUid(null);
        setScanRect(null);
        // Back to the starting page, if we navigated for other pages.
        if (currentPage !== startUrl) handleNavigate(startUrl);
        // Otherwise close the unfolded spots again. Folding them shut by
        // clicking again would be guesswork — a reload restores the initial
        // state reliably (the overlay puts the saved style changes back on
        // afterwards by itself).
        else if (revealedDuringExport) reloadFrames();
      }

      return downloads;
    },
    [devices, feedback, activeUrl, zoom, handleNavigate, waitForPage, reloadFrames],
  );

  // Shortcuts: Esc back to interacting, Cmd/Ctrl+Z undo (in draw mode only),
  // 1-9 picks a tool — the digits follow the bar, and "1" is always the first
  // tool in it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the help overlay is open, every key belongs to it: Esc closes it,
      // everything else is swallowed (no tool change in the background).
      if (helpOpenRef.current) {
        if (e.key === 'Escape') setHelpOpen(false);
        return;
      }
      const path = e.composedPath();
      // Every key in the element picker popup stays local: the popup handles
      // Escape itself, and 1-9/i/Cmd+Z must neither change the tool there (that
      // unmounts the popup) nor undo markers — including with focus on buttons,
      // tabs or the font select, which the typing check does not cover.
      const inInspect = path.some(
        (n) => (n as Partial<HTMLElement>).classList?.contains?.('anno__inspect') === true,
      );
      if (inInspect) return;
      // Keys typed in fields belong to the field — Escape included: the capture
      // listener would otherwise run before the editors' stopPropagation and
      // would end the mode along with closing a note.
      const origin = path[0] as HTMLElement | undefined;
      const typing =
        origin?.localName === 'input' ||
        origin?.localName === 'textarea' ||
        origin?.isContentEditable === true;
      if (e.key === 'Escape') {
        setPaletteAt(null);
        // Esc only ends draw mode. Full window stays — leaving it is a mode
        // change that goes through the button in the bar, not through a key you
        // press constantly while drawing.
        if (!typing && toolRef.current !== 'interact') selectTool('interact');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        // Hijack neither the page's undo nor the native text undo in fields.
        if (!annotating || typing) return;
        e.preventDefault();
        undoShape();
        return;
      }
      if (typing) return;
      // "?" (Shift+/) opens the shortcut sheet.
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      // Do not hijack browser shortcuts (Cmd/Ctrl+1 = tab switch, Alt+digit).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // "I" toggles the font inspector.
      if (e.key === 'i' || e.key === 'I') {
        toggleInspector();
        return;
      }
      // The digits follow the order of the tool bar.
      const idx = Number(e.key) - 1;
      const next = toolOrder[idx];
      if (next) selectTool(next);
    };

    shortcutKeyRef.current = onKey;
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [annotating, undoShape, selectTool, toggleInspector, toolOrder]);

  // Only feedback of the current domain in the main area — other domains get a
  // collapsible section of their own in the panel. The badges count open (not
  // ticked) entries only. Memoised: the panel resets its share/export status on
  // the identity of `items`.
  const domainFeedback = useMemo(
    () => feedback.filter((item) => sameOrigin(item.url, activeUrl)),
    [feedback, activeUrl],
  );
  const otherDomainFeedback = useMemo(
    () => feedback.filter((item) => !sameOrigin(item.url, activeUrl)),
    [feedback, activeUrl],
  );
  const feedbackCount = domainFeedback.filter((item) => !item.done).length;

  // Fresh feedback: the list opens and the new entry visibly takes its place.
  // At startup it stays shut — it only comes when there is something to show.
  const lastCount = useRef(feedbackCount);
  /**
   * The note that set `first-marker` off. The panel lifts exactly that row out
   * of the veil while the hint stands — hence the id and not a flag: by the
   * time the bubble appears the user may have marked a second thing, and the
   * ring belongs on the row the sentence is about.
   */
  const firstNoteId = useRef<string | null>(null);
  useEffect(() => {
    const grew = feedbackCount > lastCount.current;
    const first = grew && lastCount.current === 0;
    lastCount.current = feedbackCount;
    // The first entry is the first time the button in the bar has anything in
    // it — the hint says what it collects.
    if (first) {
      // Going from zero, so there is exactly one open entry: the one just made.
      firstNoteId.current = domainFeedback.find((item) => !item.done)?.id ?? null;
      fire('first-marker');
    }
    if (!grew || panelOpen) return;
    openFeedback();
  }, [feedbackCount, domainFeedback, panelOpen, openFeedback, fire]);

  // The build and use of the list on first unfolding.
  useEffect(() => {
    if (panelOpen) fire('first-panel-open');
  }, [panelOpen, fire]);

  // Leaving full window mode — on an effect rather than on the three exits
  // (button, bar, frame gate), so that none of them is forgotten.
  const wasFullscreen = useRef(fullscreen);
  useEffect(() => {
    if (wasFullscreen.current && !fullscreen) fire('fullscreen-left');
    wasFullscreen.current = fullscreen;
  }, [fullscreen, fire]);

  // Whatever has arrived since the last look at the open list slides in visibly
  // when it unfolds — otherwise you hunt after marking for the row that has
  // just appeared.
  useEffect(() => {
    if (!panelOpen) return;
    const fresh = domainFeedback.filter((i) => !seenIds.current.has(i.id)).map((i) => i.id);
    for (const item of domainFeedback) seenIds.current.add(item.id);
    if (fresh.length) setFreshIds(fresh);
  }, [panelOpen, domainFeedback]);

  // The animation runs once; after that the entry is an entry like any other.
  useEffect(() => {
    if (!freshIds.length) return;
    const id = window.setTimeout(() => setFreshIds([]), 1200);
    return () => window.clearTimeout(id);
  }, [freshIds]);

  // Window changed: the button sits elsewhere, and the open card follows.
  useEffect(() => {
    if (!fullscreen || !panelOpen) return;
    measureFeedbackBtn();
  }, [fsSize, fullscreen, panelOpen, measureFeedbackBtn]);

  const pageFeedback = useMemo(
    () => feedback.filter((item) => item.url === activeUrl),
    [feedback, activeUrl],
  );
  const pageFeedbackCount = pageFeedback.length;

  /**
   * The view switch lives in the bar (grid: toolbar, full window: fsbar) — both
   * bars share this handler, so that the state does not hang off an interface
   * you can collapse.
   */
  const toggleEdits = useCallback(() => {
    // Make it effective immediately, even while the pointer is over the panel
    // (which otherwise keeps the markers shown).
    setPanelHovered(false);
    const next = !editsShown;
    setEditsShown(next);
    void saveSettings({ showEdits: next });
    // Hidden markings look like deleted ones — the interface's most common
    // moment of fright.
    if (!next) fire('edits-hidden');
  }, [editsShown, fire]);

  // The panel knows the full-window pseudo devices as groups of their own.
  const panelPresets = useMemo<readonly DevicePreset[]>(
    () => [...presets, fsDevice, fsPhoneDevice],
    [presets, fsDevice, fsPhoneDevice],
  );

  return (
    <TooltipHost>
    <HintFireContext.Provider value={fire}>
    <div
      className={`root${fullscreen ? ' root--fs' : ''}${panelClosing ? ' root--panel-closing' : ''}${
        capturing ? ' root--capturing' : ''
      }`}
      data-theme={uiTheme}
    >
      {!fullscreen && settingsReady && (
        <Toolbar
          src={activeUrl}
          zoom={zoom}
          presets={presets}
          editorOpen={editorOpen}
          sync={syncPrefs}
          feedbackOpen={feedbackOpen}
          feedbackCount={feedbackCount}
          // Deliberately the bare state, not `effectiveMarkersVisible`: the
          // switch shows what you set, not the moment's hover exception —
          // otherwise it would flicker as you move over the feedback list.
          editsShown={editsShown}
          editsHint={editsHint}
          hasEdits={pageFeedbackCount > 0}
          onToggleEdits={toggleEdits}
          annotating={annotating}
          inspecting={inspecting}
          framingBypassed={bypassEnabled}
          framingBlocked={frameBlocked}
          onRevokeFraming={() => void revokeBypass()}
          onEnableFraming={() => void enableBypass()}
          theme={theme}
          workspaces={workspaces}
          onNavigate={handleNavigate}
          onAddDevice={addDevice}
          onAddBundle={addDevices}
          onAddCustomDevice={addCustomDevice}
          onRemoveCustomPreset={removeCustomPreset}
          onApplyWorkspace={applyWorkspace}
          onSaveWorkspace={saveWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          onZoom={setZoomManual}
          autoFit={autoFit}
          onToggleAutoFit={toggleAutoFit}
          onFit={fitZoom}
          startFullscreen={startFullscreen}
          paletteColorCount={paletteColorCount}
          onSetPaletteColorCount={changePaletteColorCount}
          onToggleStartFullscreen={toggleStartFullscreen}
          onReload={reloadFrames}
          onToggleEditor={() => {
            // On collapsing: the changes stay, only the editor is gone.
            if (editorOpen) fire('editor-closed');
            setEditorOpen((v) => !v);
          }}
          onToggleInspector={toggleInspector}
          onToggleSync={toggleSync}
          onToggleFeedback={() => {
            // The mode is already running and the list is shut: the button
            // fetches the list first. Since it no longer opens by itself, it
            // would otherwise only be reachable on the grid by shutting and
            // reopening — and that takes the markings with it on the way.
            if (feedbackOpen && !panelOpen && feedbackCount > 0) {
              openFeedback();
              return;
            }
            const open = !feedbackOpen;
            setFeedbackOpen(open);
            if (!open) {
              // Shutting also ends draw mode and the list — otherwise a tool
              // would stay armed without a visible tool bar.
              setTool('interact');
              setPanelOpen(false);
            } else if (feedbackCount > 0) {
              setPanelOpen(true);
            }
          }}
          onSetTheme={changeTheme}
          onHelp={() => setHelpOpen(true)}
          onTour={restartTour}
          hintsEnabled={hints.enabled}
          onToggleHints={hints.setEnabled}
          onFullscreen={() => setFullscreen(true)}
          onClose={() => void handleClose()}
        />
      )}

      {/* While the page's position is being taken over, the covered frames say
          what is happening — and they say it where it is happening (see
          `takingOver`). The bar comes back for every later navigation, where
          nothing is covered. */}
      <div className={`loadbar${navigating && !takingOver ? ' loadbar--active' : ''}`} />

      {hint && <div className="hint">{hint}</div>}

      {contextLost && (
        <div className="banner">
          <strong>Inkspect was updated or reloaded.</strong>
          <span>
            This tab is still running the old version, so changes can no longer be saved. Reload the
            page to continue — your saved feedback is safe.
          </span>
          <span className="device__bar-spacer" />
          <button onClick={() => location.reload()}>Reload page</button>
        </div>
      )}

      <div className={`body${resizing ? ' body--resizing' : ''}`}>
        {gateOpen ? null : (
          <FrameGate
            url={src}
            checking={gate === 'checking' && !frameBlocked}
            pending={bypassPending}
            onProceed={() => void enableBypass()}
            onSkip={() => setFramingSkipped(true)}
            onExitFullscreen={fullscreen ? () => setFullscreen(false) : undefined}
            onClose={() => void handleClose()}
          />
        )}
        {gateOpen && !fullscreen && editorOpen && (
          <>
            <CssEditor
              shadowRoot={shadowRoot}
              sheets={sheets}
              activeId={activeId}
              overrides={overrides}
              nonce={editorNonce}
              dark={darkUi}
              width={editorWidth}
              onSelect={setActiveId}
              onChange={handleChange}
              onReset={handleReset}
            />
            <div
              className={`splitter${resizing ? ' splitter--active' : ''}`}
              onPointerDown={startResize('editor')}
              title="Drag to resize"
              role="separator"
              aria-orientation="vertical"
            />
          </>
        )}

        {gateOpen && fullscreen && (
          <div className="fs-stage">
            <DeviceFrame
              key={FS_UID}
              bare
              device={fsDevice}
              src={src}
              zoom={1}
              reloadKey={reloadKey}
              revealNonce={revealNonce}
              annotating={annotating}
              previewBlocked={frameBlocked}
              shapes={itemsFor(FULLSCREEN_ID).map((item) => item.shape)}
              dimmedIds={
                new Set(
                  itemsFor(FULLSCREEN_ID)
                    .filter((i) => i.done)
                    .map((i) => i.shape.id),
                )
              }
              lockedIds={
                new Set(
                  itemsFor(FULLSCREEN_ID)
                    .filter((i) => !isMine(i))
                    .map((i) => i.shape.id),
                )
              }
              tool={drawTool}
              color={color}
              showNotes={showNotes}
              markersVisible={effectiveMarkersVisible}
              fadingShapeId={fadingShapeId}
              scanning={scanUid === FS_UID}
              flashShapeId={flash?.uid === FS_UID ? flash.shapeId : null}
              flashNonce={flash?.nonce ?? 0}
              flashActive={false}
              hoverShapeId={hoverMark?.uid === FS_UID ? hoverMark.shapeId : null}
              noteEdit={noteEdit?.uid === FS_UID ? noteEdit : null}
              elementPick={elementPick?.uid === FS_UID ? elementPick : null}
              dragging={false}
              settling={settling.has(FS_UID)}
              onLoad={handleLoad}
              onAttach={handleAttach}
              onRotate={() => {}}
              onRemove={() => {}}
              onBadgeClick={showDeviceFeedback}
              onAddShape={addShape}
              onSetShapeNote={setShapeNote}
              onUpdateShape={updateElementShape}
              onDeleteShape={askDeleteShape}
              applyChanges={editsShown}
              onMoveShape={moveShape}
              onResizeShape={resizeShape}
              onSetLineGap={setLineGap}
              onCommitShape={commitShape}
              onDragBegin={() => {}}
              onDragHover={() => {}}
              onDragEnd={() => {}}
            />
          </div>
        )}

        {gateOpen && !fullscreen && (
        <div
          ref={attachGrid}
          className={`grid${dragUid ? ' grid--dragging' : ''}${
            focusUid ? ' grid--focus' : ''
          }`}
          onContextMenu={(e) => {
            e.preventDefault();
            openPalette(e.clientX, e.clientY);
          }}
        >
          {devices.map((device) => (
            <DeviceFrame
              key={device.uid}
              device={device}
              src={src}
              zoom={effZooms.get(device.uid) ?? zoom}
              reloadKey={reloadKey}
              revealNonce={revealNonce}
              annotating={annotating}
              previewBlocked={frameBlocked}
              focused={focusUid === device.uid}
              onToggleFocus={toggleFocus}
              shapes={itemsFor(device.id).map((item) => item.shape)}
              dimmedIds={
                new Set(
                  itemsFor(device.id)
                    .filter((i) => i.done)
                    .map((i) => i.shape.id),
                )
              }
              lockedIds={
                new Set(
                  itemsFor(device.id)
                    .filter((i) => !isMine(i))
                    .map((i) => i.shape.id),
                )
              }
              tool={drawTool}
              color={color}
              showNotes={showNotes}
              markersVisible={effectiveMarkersVisible}
              fadingShapeId={fadingShapeId}
              scanning={scanUid === device.uid}
              flashShapeId={flash?.uid === device.uid ? flash.shapeId : null}
              flashNonce={flash?.nonce ?? 0}
              flashActive={flash?.uid === device.uid}
              hoverShapeId={hoverMark?.uid === device.uid ? hoverMark.shapeId : null}
              noteEdit={noteEdit?.uid === device.uid ? noteEdit : null}
              elementPick={elementPick?.uid === device.uid ? elementPick : null}
              dragging={dragUid === device.uid}
              settling={settling.has(device.uid)}
              onLoad={handleLoad}
              onAttach={handleAttach}
              onTouchChange={handleTouchChange}
              onRotate={rotateDevice}
              onRemove={removeDevice}
              onBadgeClick={showDeviceFeedback}
              onAddShape={addShape}
              onSetShapeNote={setShapeNote}
              onUpdateShape={updateElementShape}
              onDeleteShape={askDeleteShape}
              applyChanges={editsShown}
              onMoveShape={moveShape}
              onResizeShape={resizeShape}
              onSetLineGap={setLineGap}
              onCommitShape={commitShape}
              onDragBegin={setDragUid}
              onDragHover={handleDragHover}
              onDragEnd={() => setDragUid(null)}
            />
          ))}
        </div>
        )}

        {/* Preview of the resting place during the drag; the shield in front of
            it keeps the page in the iframe out of the movement. */}
        {panelDrag && panelGhost && (
          <>
            <div className="fsbar-shield" />
            <div className="panel-ghost" style={panelGhost} />
          </>
        )}
        {/* `gateOpen` here too: after a page change the gate checks again while
            the list stays open — it would otherwise lay itself over the
            card. */}
        {panelOpen && gateOpen && (
          <>
            {!fullscreen && (
              <div
                className={`splitter${resizing ? ' splitter--active' : ''}`}
                onPointerDown={startResize('panel')}
                title="Drag to resize"
                role="separator"
                aria-orientation="vertical"
              />
            )}
            <FeedbackPanel
              items={domainFeedback}
              otherItems={otherDomainFeedback}
              url={activeUrl}
              presets={panelPresets}
              devices={devices}
              activePresetIds={activePresetIds}
              width={panelWidth}
              anchor={panelAnchor}
              freshIds={freshIds}
              explainId={hints.current?.id === 'first-marker' ? firstNoteId.current : null}
              removingIds={removingIds}
              onHeadPointerDown={fullscreen ? startPanelDrag : undefined}
              dragging={panelDrag != null}
              highlight={panelHighlight}
              onJump={focusDevice}
              onJumpItem={focusItem}
              onEditElement={editElementItem}
              // Hovered panel areas bring the markers in.
              onPanelHover={setPanelHovered}
              onPreviewItem={previewItem}
              onEditItem={editItemText}
              onNavigate={handleNavigate}
              // Without a prompt in between: the panel's delete button asks for
              // itself, by arming on the first click and only removing on the
              // second. The marker on the page has no room for that and keeps
              // the dialog.
              onDelete={removeShape}
              onToggleDone={toggleDone}
              onClearAll={askClearAll}
              onBuildShareLink={buildShareLink}
              onExportScreenshots={exportScreenshots}
              onShowShortcuts={() => setHelpOpen(true)}
              onClose={closeFeedback}
            />
            {/* After the card in the DOM: that way the tail covers its bottom
                edge and the two merge into one shape. */}
            {/* Always rendered once the card hangs at the button: Floating UI
                measures the tail and only thereby aligns it. Until the first
                measurement arrives it stays invisible. */}
            {atButton && (
              <div
                className="panel-tail"
                data-side={panelTail?.side ?? 'top'}
                style={
                  panelTail
                    ? { left: panelTail.left, top: panelTail.top }
                    : { visibility: 'hidden' }
                }
              />
            )}
          </>
        )}
      </div>

      {/* In full window mode the bar is the only interface: tools, phone
          preview, feedback and the way out all sit in it, rather than lying
          scattered across the window as separate buttons.

          While the consent card is up it stays away: the buttons would act on a
          frame nobody has allowed, and the phone symbol would fix the choice
          before consent. The way out of full window mode is offered by the card
          itself meanwhile. */}
      {fullscreen && gateOpen && (
        <FeedbackBar
          tool={tool}
          color={color}
          colors={paletteColors}
          order={toolOrder}
          placement={toolbarPlacement}
          onPlace={placeToolbar}
          // Deliberately only interact plus the element picker as tools:
          // everything else lives in the right-click palette.
          minimal
          canUndo={pageFeedbackCount > 0}
          phoneVisible={phoneVisible}
          feedbackCount={feedbackCount}
          feedbackOpen={panelOpen}
          feedbackPulse={feedbackPulse}
          // Deliberately the bare state, not `effectiveMarkersVisible`: the
          // switch shows what you set, not the moment's hover exception —
          // otherwise it would flicker as you move over the feedback list.
          editsShown={editsShown}
          editsHint={editsHint}
          hasEdits={pageFeedbackCount > 0}
          onToggleEdits={toggleEdits}
          onTool={selectTool}
          onColor={setColor}
          onUndo={undoShape}
          onClear={askClearAll}
          onTogglePhone={togglePhone}
          onToggleFeedback={() => (panelOpen ? closeFeedback() : openFeedback())}
          onExitFullscreen={() => setFullscreen(false)}
        />
      )}

      {feedbackOpen && !fullscreen && gateOpen && settingsReady && (
        <FeedbackBar
          tool={tool}
          color={color}
          colors={paletteColors}
          order={toolOrder}
          placement={DOCKED_PLACEMENT}
          movable={false}
          onPlace={() => {}}
          canUndo={pageFeedbackCount > 0}
          onTool={selectTool}
          onColor={setColor}
          onUndo={undoShape}
          onClear={askClearAll}
          onFullscreen={() => setFullscreen(true)}
        />
      )}

      {paletteAt && (
        <AnnotationPalette
          at={paletteAt}
          tool={tool}
          color={color}
          colors={paletteColors}
          order={toolOrder}
          canUndo={pageFeedbackCount > 0}
          onTool={(next) => {
            selectTool(next);
            closePalette();
          }}
          onColor={setColor}
          onUndo={undoShape}
          onClear={() => {
            clearAllShapes();
            closePalette();
          }}
          onDismiss={closePalette}
          onMove={openPalette}
        />
      )}

      {/* The coachmarks point at the tool bar (.fsbar exists on the grid and in
          full window mode alike) and at the panel. Behind the frame gate
          (anchors do not exist — an action step would otherwise be stuck), with
          the bar collapsed and during a screenshot they pause, and afterwards
          continue at the same step. */}
      {tourStep !== null && !helpOpen && gateOpen && feedbackOpen && !capturing && (
        <Tour
          root={shadowRoot}
          state={tourState}
          index={tourStep}
          onIndex={setTourStep}
          onClose={closeTour}
        />
      )}

      {/* A hint. Without visibility conditions of its own: when it may appear is
          decided by the conductor in `lib/hints.ts` — otherwise the same
          fivefold chain would grow here a second time. */}
      {hints.current && (
        <Nudge root={shadowRoot} def={hints.current} onClose={() => hints.dismiss('x')} />
      )}

      {/* Optional phone mockup: the mobile view in full window mode. Inside it a
          full DeviceFrame runs with a pseudo device of its own — so marking, the
          element picker and sync work in the mockup exactly as they do in the
          large frame. */}
      {fullscreen && (phoneVisible || phoneClosing) && gateOpen && (
        <PhonePreview
          // A fixed spot at the bottom right. The card gives way to it, not the
          // other way round — a wandering mockup gets lost.
          anchorRight={24}
          hiding={phoneClosing}
          dimIdle={phoneDimIdle}
          // While working with the feedback list you are looking at the mockup:
          // an open list, or a hovered or jumped-to entry, keep it fully visible
          // no matter how far the wait had already run.
          awake={panelOpen || hoverMark != null || flash != null}
          active={scrolled}
          explaining={hints.current?.id === 'phone-dimmed'}
          onToggleDimIdle={togglePhoneDimIdle}
          onHide={hidePhone}
          onHidden={() => setPhoneClosing(false)}
          getHideTarget={() =>
            shadowRoot.querySelector('.fsbar__phone')?.getBoundingClientRect() ?? null
          }
        >
          <DeviceFrame
            key={FS_PHONE_UID}
            bare
            device={fsPhoneDevice}
            src={src}
            zoom={PHONE_SCALE}
            reloadKey={reloadKey}
            revealNonce={revealNonce}
            annotating={annotating}
            previewBlocked={frameBlocked}
            shapes={itemsFor(FS_PHONE_ID).map((item) => item.shape)}
            dimmedIds={
              new Set(
                itemsFor(FS_PHONE_ID)
                  .filter((i) => i.done)
                  .map((i) => i.shape.id),
              )
            }
            lockedIds={
              new Set(
                itemsFor(FS_PHONE_ID)
                  .filter((i) => !isMine(i))
                  .map((i) => i.shape.id),
              )
            }
            tool={drawTool}
            color={color}
            showNotes={showNotes}
            markersVisible={effectiveMarkersVisible}
            fadingShapeId={fadingShapeId}
            scanning={scanUid === FS_PHONE_UID}
            flashShapeId={flash?.uid === FS_PHONE_UID ? flash.shapeId : null}
            flashNonce={flash?.nonce ?? 0}
            flashActive={false}
            hoverShapeId={hoverMark?.uid === FS_PHONE_UID ? hoverMark.shapeId : null}
            noteEdit={noteEdit?.uid === FS_PHONE_UID ? noteEdit : null}
            elementPick={elementPick?.uid === FS_PHONE_UID ? elementPick : null}
            dragging={false}
            settling={settling.has(FS_PHONE_UID)}
            onLoad={handleLoad}
            onAttach={handleAttach}
            onRotate={() => {}}
            onRemove={() => {}}
            onBadgeClick={showDeviceFeedback}
            onAddShape={addShape}
            onSetShapeNote={setShapeNote}
            onUpdateShape={updateElementShape}
            onDeleteShape={askDeleteShape}
            applyChanges={editsShown}
            onMoveShape={moveShape}
            onResizeShape={resizeShape}
            onSetLineGap={setLineGap}
            onCommitShape={commitShape}
            onDragBegin={() => {}}
            onDragHover={() => {}}
            onDragEnd={() => {}}
          />
        </PhonePreview>
      )}

      {/*
        Dimming during the capture — as four areas *around* the frame rather than
        as a veil on it. What is photographed is exactly the frame crop; whatever
        lies beside it never gets into the picture and may therefore stay put the
        whole time. The ring and the progress indicator sit outside as well.
      */}
      {scanRect && (
        <div className="shot-spot" aria-hidden="true">
          <div className="shot-spot__pane" style={{ left: 0, top: 0, right: 0, height: scanRect.top }} />
          <div
            className="shot-spot__pane"
            style={{ left: 0, top: scanRect.top, width: scanRect.left, height: scanRect.height }}
          />
          <div
            className="shot-spot__pane"
            style={{ left: scanRect.right, top: scanRect.top, right: 0, height: scanRect.height }}
          />
          <div
            className="shot-spot__pane"
            style={{ left: 0, top: scanRect.bottom, right: 0, bottom: 0 }}
          />
          {/* The ring lies *outside* its box via box-shadow, and therefore
              outside the crop. */}
          <div
            className="shot-spot__ring"
            style={{
              left: scanRect.left,
              top: scanRect.top,
              width: scanRect.width,
              height: scanRect.height,
            }}
          />
          <div
            className="shot-badge"
            style={{
              left: scanRect.left + scanRect.width / 2,
              // Above the frame when there is room — otherwise below it.
              top: scanRect.top > 44 ? scanRect.top - 34 : scanRect.bottom + 10,
            }}
          >
            <span className="shot-badge__spinner" />
            <span>Capturing full page… please don’t scroll</span>
          </div>
        </div>
      )}

      {inspecting && inspect && (
        <div className="inspect-tip" style={{ left: inspect.x + 14, top: inspect.y + 16 }}>
          <div className="inspect-tip__family">{inspect.family}</div>
          <div className="inspect-tip__row">
            <strong>{parseFloat(inspect.size)}px</strong>
            <span className="inspect-tip__sep">·</span>
            <span>{weightLabel(inspect.weight)}</span>
            {inspect.style !== 'normal' && (
              <>
                <span className="inspect-tip__sep">·</span>
                <span>{inspect.style === 'italic' ? 'Italic' : inspect.style}</span>
              </>
            )}
          </div>
          {inspect.lineHeight && inspect.lineHeight !== 'normal' && (
            <div className="inspect-tip__meta">line-height {inspect.lineHeight}</div>
          )}
        </div>
      )}

      {helpOpen && (
        <ShortcutsOverlay order={toolOrder} onClose={() => setHelpOpen(false)} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this marking?"
          message="This removes the marking and its note. This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            removeShape(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Delete all markings?"
          message={`This removes ${pageFeedbackCount} marking${
            pageFeedbackCount === 1 ? '' : 's'
          } on this page — including notes. This cannot be undone.`}
          confirmLabel="Delete all"
          onConfirm={() => {
            setConfirmClear(false);
            clearAllShapes();
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {confirmReplace && (
        <div
          className="overlay-backdrop"
          onClick={() => setConfirmReplace(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Replace devices"
        >
          <div className="confirm" onClick={(e) => e.stopPropagation()}>
            <div className="confirm__title">
              <IconWarning size={18} />
              Replace the current devices?
            </div>
            <p className="confirm__text">
              Applying a set clears the grid and shows only its devices. Feedback you already added
              stays saved — it reappears once a matching device is back on the grid.
            </p>
            <div className="confirm__actions">
              <button className="confirm__btn" onClick={() => setConfirmReplace(null)}>
                Cancel
              </button>
              <button
                className="confirm__btn confirm__btn--primary"
                onClick={() => {
                  confirmReplace.apply();
                  setConfirmReplace(null);
                }}
              >
                Replace devices
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </HintFireContext.Provider>
    </TooltipHost>
  );
}
