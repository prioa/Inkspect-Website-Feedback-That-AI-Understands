import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Toolbar, type SyncKey, type SyncPrefs } from './Toolbar';
import { CssEditor } from './CssEditor';
import { DeviceFrame } from './DeviceFrame';
import { AnnotationPalette, FeedbackBar } from './AnnotationPalette';
import { FeedbackPanel } from './FeedbackPanel';
import { IconMessage } from './icons';
import {
  createCustomPreset,
  defaultDevices,
  instantiate,
  isCustomPreset,
  loadCustomPresets,
  loadGridState,
  PRESETS,
  saveCustomPresets,
  saveGridState,
  viewport,
  type DeviceInstance,
  type DevicePreset,
} from '@/lib/devices';
import { frameDocument, isFrameBlocked } from '@/lib/framing';
import { ScrollSync } from '@/lib/scrollSync';
import { InteractionSync } from '@/lib/interactionSync';
import { findByShadowPath } from '@/lib/selector';
import {
  ANNOTATION_COLORS,
  penOverlaps,
  shapeBounds,
  shapeFocusPoint,
  shapeId,
  type PaletteTool,
  type Shape,
  type Tool,
} from '@/lib/annotations';
import type { NoteEditRequest } from './AnnotationOverlay';
import {
  addItems,
  clearUrl,
  loadAll,
  normalizeUrl,
  persist,
  removeItems,
  replaceItem,
  sameOrigin,
  type FeedbackItem,
} from '@/lib/feedbackStore';
import { buildShareUrl } from '@/lib/share';
import { captureFullFrameShot, downloadBlob } from '@/lib/screenshot';
import { applyOverride, clearOverride, collectSheets, type SheetSource } from '@/lib/stylesheets';
import type { FrameBypassResponse } from '@/lib/messages';
import { createLogger } from '@/lib/log';

const APPLY_DEBOUNCE_MS = 150;
const log = createLogger('app');

/** Pseudo-Device des Vollbild-Modus: Feedback haengt an dieser Preset-Id. */
const FULLSCREEN_ID = 'fullscreen';
const FS_UID = 'fullscreen';

/** Toleranz um die Marker-Box beim Doppelklick-Hit-Test (Dokument-Pixel). */
const EDIT_HIT_PAD = 8;

/** Abstand zwischen Device-Karten im Grid (muss zum CSS-gap passen). */
const GRID_GAP = 20;
/** Karten-Chrom um den Viewport: 2×10px Padding + 2×1px Rahmen. */
const CARD_CHROME = 22;

/**
 * Zeilenfuellender Zoom pro Device: Karten werden greedy in Zeilen gepackt
 * (Basisbreite = Viewport × Zoom) und jede Zeile dann proportional auf die
 * volle Grid-Breite skaliert. Ein Device, das allein schon zu breit ist,
 * wird auf Zeilenbreite verkleinert — mindestens ein Device pro Zeile.
 * Vergroessert wird hoechstens bis 100 %, sonst rastern die Frames unscharf.
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
    // -1px pro Karte als Rundungsreserve, damit die Zeile nie umbricht.
    const factor = Math.max(0.05, (containerWidth - chrome - row.length) / base);
    const capped = Math.min(factor, 1 / zoom);
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

export function App({
  shadowRoot,
  onClose,
  initialFeedbackOpen = false,
}: {
  shadowRoot: ShadowRoot;
  onClose: () => void;
  initialFeedbackOpen?: boolean;
}) {
  // Presets = eingebaute + eigene des Nutzers; Grid und Zoom werden persistiert
  // und beim Start wiederhergestellt (Setup soll Sessions ueberleben).
  const [presets, setPresets] = useState<readonly DevicePreset[]>(PRESETS);
  const [devices, setDevices] = useState<DeviceInstance[]>([]);
  const [src, setSrc] = useState(location.href);
  const [zoom, setZoom] = useState(0.6);
  const [reloadKey, setReloadKey] = useState(0);
  /** Erst nach dem Restore speichern — sonst ueberschreibt der Default den Stand. */
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
        log.error('Layout laden fehlgeschlagen', e);
        if (alive) setDevices(defaultDevices());
      } finally {
        layoutRestored.current = true;
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Grid + Zoom fortschreiben (debounced; jede Aenderung von devices/zoom).
  useEffect(() => {
    if (!layoutRestored.current) return;
    const timer = window.setTimeout(() => {
      persist(
        saveGridState({
          devices: devices.map((d) => ({ presetId: d.id, rotated: d.rotated })),
          zoom,
        }),
        'Layout speichern',
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [devices, zoom]);

  const [sheets, setSheets] = useState<SheetSource[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editorNonce, setEditorNonce] = useState(0);

  const [blocked, setBlocked] = useState(false);
  const [bypassEnabled, setBypassEnabled] = useState(false);
  const [bypassPending, setBypassPending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  // Sync-Bereiche einzeln schaltbar (Toolbar-Menue am Link-Icon).
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
  const [feedbackOpen, setFeedbackOpen] = useState(initialFeedbackOpen);

  // Vollbild-Modus: die Seite fuellt das ganze Fenster (ein Frame, Zoom 1),
  // unten mittig schwebt die Werkzeugleiste, rechts unten der Panel-Knopf.
  const [fullscreen, setFullscreen] = useState(false);
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

  // Zeilenfuellendes Grid: die Grid-Breite wird gemessen (reagiert auch auf
  // Panel-/Editor-Toggles), daraus ergibt sich der effektive Zoom pro Device.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || fullscreen) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w != null) setGridWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fullscreen]);

  /** Effektiver Zoom pro Device (Zeile auf volle Breite skaliert). */
  const effZooms = useMemo(() => rowZooms(devices, zoom, gridWidth), [devices, zoom, gridWidth]);
  // Frame-Listener (Kontextmenue) und der Screenshot-Export lesen den
  // jeweils aktuellen Wert ueber die Ref.
  const effZoomsRef = useRef(effZooms);
  effZoomsRef.current = effZooms;

  // Touch-Modus pro Device-Instanz: der Hover-Sync muss Touch-Frames kennen
  // (weder Hover senden noch empfangen). Das Set ueberlebt Frame-Reloads.
  const touchUids = useRef(new Set<string>());
  const handleTouchChange = useCallback((uid: string, touch: boolean) => {
    if (touch) touchUids.current.add(uid);
    else touchUids.current.delete(uid);
    const iframe = frames.current.get(uid);
    if (iframe) interactionSync.current.setTouch(iframe, touch);
  }, []);

  // Haelt das Offen-Flag des Content-Scripts aktuell: nach F5 kommt die UI
  // inklusive Panel-Zustand wieder (sessionStorage ist tab-lokal).
  useEffect(() => {
    try {
      sessionStorage.setItem('ink-ui-open', feedbackOpen ? 'feedback' : '1');
    } catch {
      /* Seite blockiert sessionStorage */
    }
  }, [feedbackOpen]);

  // Ladebalken: an bei Navigationsstart (Link-Klick, Adresswechsel, Reload),
  // aus beim ersten fertig geladenen Frame bzw. SPA-URL-Wechsel.
  const [navigating, setNavigating] = useState(true);

  useEffect(() => {
    if (!navigating) return;
    // Sicherheitsnetz: haengende Loads (oder preventDefault-Links ohne
    // Navigation) sollen den Balken nicht endlos laufen lassen.
    const timer = window.setTimeout(() => setNavigating(false), 10_000);
    return () => clearTimeout(timer);
  }, [navigating]);

  // Werkzeugleiste: 'interact' laesst Klicks/Eingaben zur Seite durch; jedes
  // andere Werkzeug schaltet die Zeichen-Overlays aller Frames scharf — auf
  // welchem Device gezeichnet wird, ergibt sich aus dem Frame unterm Cursor.
  const [tool, setTool] = useState<PaletteTool>('interact');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const annotating = tool !== 'interact';
  const drawTool: Tool = tool === 'interact' ? 'element' : tool;

  const toolRef = useRef<PaletteTool>(tool);
  toolRef.current = tool;
  /** Der Einstieg in den Zeichenmodus oeffnet das Feedback-Panel gleich mit. */
  const selectTool = useCallback((next: PaletteTool) => {
    if (next !== 'interact' && toolRef.current === 'interact') setFeedbackOpen(true);
    setTool(next);
  }, []);

  // Die Werkzeug-Palette ist ein Kontextmenue: Rechtsklick (auf Grid,
  // Overlay oder in einer Vorschau) oeffnet sie neben der Maus.
  const [paletteAt, setPaletteAt] = useState<{ x: number; y: number } | null>(null);
  const openPalette = useCallback((x: number, y: number) => setPaletteAt({ x, y }), []);
  const closePalette = useCallback(() => setPaletteAt(null), []);

  // Frame-Listener sehen sonst einen veralteten Zoom.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Feedback ist an die Landingpage gebunden: activeUrl folgt der tatsaechlich
  // geladenen Frame-URL (auch bei Link-Klicks in den Previews). Der State
  // haelt *alle* Eintraege — angezeigt auf den Frames wird nur die aktuelle
  // Seite, das Panel gruppiert den Rest nach Seite.
  const [activeUrl, setActiveUrl] = useState(() => normalizeUrl(location.href));
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);

  // Frame-Listener (dblclick) leben ausserhalb des Render-Zyklus.
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const activeUrlRef = useRef(activeUrl);
  activeUrlRef.current = activeUrl;

  // Doppelklick auf einen Marker im Frame: Overlay dieses Devices oeffnet
  // den Notiz-Editor mit dem vorhandenen Text.
  const [noteEdit, setNoteEdit] = useState<({ uid: string } & NoteEditRequest) | null>(null);

  // Frisch gemountete Overlays (Vollbild-Wechsel, Navigation) wuerden einen
  // liegen gebliebenen Editier-Wunsch erneut oeffnen — verwerfen.
  useEffect(() => {
    setNoteEdit(null);
  }, [fullscreen, activeUrl]);

  useEffect(() => {
    let alive = true;
    loadAll()
      .then((items) => {
        if (alive) setFeedback(items);
      })
      .catch((e: unknown) => log.error('Feedback laden fehlgeschlagen', e));
    return () => {
      alive = false;
    };
  }, []);

  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const scrollSync = useRef(new ScrollSync());
  const interactionSync = useRef(new InteractionSync());
  const collecting = useRef(false);
  const applyTimers = useRef(new Map<string, number>());

  // Der Load-Handler laeuft ausserhalb des Render-Zyklus und wuerde sonst
  // veraltete Werte sehen.
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  useEffect(() => {
    const sync = scrollSync.current;
    const interactions = interactionSync.current;
    const timers = applyTimers.current;
    return () => {
      sync.detachAll();
      interactions.detachAll();
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    scrollSync.current.enabled = syncPrefs.scroll;
    interactionSync.current.enabled = syncPrefs.input;
    interactionSync.current.hoverEnabled = syncPrefs.hover;
  }, [syncPrefs]);

  // SPA-Navigationen (pushState, kein load-Event) meldet der URL-Watchdog —
  // nur so folgt das Feedback auch Router-Seitenwechseln.
  useEffect(() => {
    const sync = interactionSync.current;
    sync.onUrlChange = (href) => {
      const url = normalizeUrl(href);
      setActiveUrl((current) => (current === url ? current : url));
      setNavigating(false); // SPA-Wechsel loest kein load-Event aus
    };
    sync.onNavigationStart = () => setNavigating(true);
    return () => {
      sync.onUrlChange = null;
      sync.onNavigationStart = null;
    };
  }, []);

  const handleAttach = useCallback((device: DeviceInstance, iframe: HTMLIFrameElement | null) => {
    const previous = frames.current.get(device.uid) ?? null;
    // Idempotent: wiederholte Aufrufe mit demselben Element (Ref-Zyklen von
    // React-Re-Renders) duerfen die Sync-Listener nicht abhaengen.
    if (previous === iframe) return;

    if (previous) {
      scrollSync.current.detach(previous);
      interactionSync.current.detach(previous);
    }

    if (iframe) frames.current.set(device.uid, iframe);
    else frames.current.delete(device.uid);
  }, []);

  const handleLoad = useCallback(
    (device: DeviceInstance, iframe: HTMLIFrameElement) => {
      setNavigating(false);
      if (isFrameBlocked(iframe)) {
        log.warn('Frame blockiert', device.name, iframe.src);
        setBlocked(true);
        return;
      }
      log.debug('Frame geladen', device.name);
      setBlocked(false);

      const doc = frameDocument(iframe);
      if (!doc) return;

      scrollSync.current.attach(iframe);
      interactionSync.current.attach(iframe);
      interactionSync.current.setTouch(iframe, touchUids.current.has(device.uid));

      // Rechtsklick in der Vorschau oeffnet die Werkzeug-Palette neben der
      // Maus. Frame-Koordinaten sind unskaliert — der effektive Zoom dieses
      // Devices rechnet sie in Shell-Koordinaten um. Der Listener stirbt mit
      // dem Dokument.
      doc.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const z =
          device.uid === FS_UID
            ? 1
            : (effZoomsRef.current.get(device.uid) ?? zoomRef.current);
        const rect = iframe.getBoundingClientRect();
        openPalette(rect.left + e.clientX * z, rect.top + e.clientY * z);
      });

      // Doppelklick auf einen Marker (Interaktionsmodus — nur dann erreichen
      // Klicks den Frame): Notiz-Editor mit dem vorhandenen Text oeffnen.
      // Hit-Test in Dokument-Koordinaten, hinterste Eintraege zuerst — die
      // liegen im Overlay obenauf.
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

      // Feedback folgt der echten Seite — auch wenn in den Frames navigiert wird.
      try {
        const url = normalizeUrl(doc.location.href);
        setActiveUrl((current) => (current === url ? current : url));
      } catch {
        /* Frame nicht lesbar */
      }

      // Nach Reload/Navigation eines Frames muessen die Overrides erneut greifen.
      let reapplied = 0;
      for (const sheet of sheetsRef.current ?? []) {
        const css = overridesRef.current[sheet.id];
        if (css != null) {
          applyOverride(doc, sheet, css);
          reapplied += 1;
        }
      }
      if (reapplied > 0) log.debug('Overrides erneut angewendet', device.name, reapplied);

      if (sheetsRef.current === null && !collecting.current) {
        collecting.current = true;
        log.info('sammle Stylesheets aus', device.name);
        void log
          .time('collectSheets', () => collectSheets(doc))
          .then((found) => {
            log.info(
              'Stylesheets gefunden',
              found.length,
              found.map((s) => `${s.label}${s.readable ? '' : ' (unlesbar)'}`),
            );
            setSheets(found);
            setActiveId((current) => current ?? found[0]?.id ?? null);
          })
          .catch((e: unknown) => log.error('collectSheets fehlgeschlagen', e));
      }
    },
    [openPalette],
  );

  // Live-Anwendung: laeuft debounced ueber `overrides`.
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
      setEditorNonce((n) => n + 1); // zwingt den Editor auf den Originaltext zurueck
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
        `Only paths on ${location.origin}. A foreign origin makes the frames cross-site — ` +
          `login cookies and access to the stylesheets would be lost.`,
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
    setActiveUrl(normalizeUrl(next.href));
    setNavigating(true);
    setSrc(next.href);
    // src-State und Frame-Inhalt koennen auseinanderliegen (Link-Klicks
    // navigieren die Frames intern) — der key-Wechsel erzwingt den Reload.
    setReloadKey((k) => k + 1);
  }, []);

  const enableBypass = useCallback(async () => {
    setBypassPending(true);
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'ink:frame-bypass',
        enabled: true,
      })) as FrameBypassResponse;

      if (!res.ok) {
        setHint(`Could not bypass the frame blocking: ${res.error}`);
        return;
      }
      setBypassEnabled(true);
      reloadFrames();
    } finally {
      setBypassPending(false);
    }
  }, [reloadFrames]);

  const handleClose = useCallback(async () => {
    scrollSync.current.detachAll();
    interactionSync.current.detachAll();
    if (bypassEnabled) {
      await browser.runtime.sendMessage({
        type: 'ink:frame-bypass',
        enabled: false,
      });
    }
    onClose();
  }, [bypassEnabled, onClose]);

  const addDevice = useCallback(
    (presetId: string) => {
      const preset = presets.find((p) => p.id === presetId);
      if (preset) setDevices((current) => [...current, instantiate(preset)]);
    },
    [presets],
  );

  /** Legt ein eigenes Preset an (persistiert) und stellt es direkt ins Grid. */
  const addCustomDevice = useCallback((name: string, width: number, height: number) => {
    const preset = createCustomPreset(name, width, height);
    if (!preset) return;
    setPresets((current) => {
      const next = [...current, preset];
      persist(saveCustomPresets(next.filter((p) => isCustomPreset(p.id))), 'Devices speichern');
      return next;
    });
    setDevices((current) => [...current, instantiate(preset)]);
  }, []);

  // Entfernt ein Custom-Preset samt Grid-Instanzen. Zugehoeriges Feedback
  // bleibt bestehen — das Panel zeigt unbekannte deviceIds als eigene Gruppe.
  const removeCustomPreset = useCallback((presetId: string) => {
    if (!isCustomPreset(presetId)) return;
    setPresets((current) => {
      const next = current.filter((p) => p.id !== presetId);
      persist(saveCustomPresets(next.filter((p) => isCustomPreset(p.id))), 'Devices speichern');
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
    // Feedback bleibt absichtlich bestehen — es haengt an URL + Preset,
    // nicht an der Grid-Instanz.
  }, []);

  /** Feedback-Eintraege der aktuellen Seite fuer ein Device-Preset. */
  const itemsFor = useCallback(
    (presetId: string) =>
      feedback.filter((item) => item.deviceId === presetId && item.url === activeUrl),
    [feedback, activeUrl],
  );

  const addShape = useCallback(
    (uid: string, shape: Shape) => {
      const device = uid === FS_UID ? fsDevice : devices.find((d) => d.uid === uid);
      if (!device) return;

      // Nach dem Absetzen zurueck zum Standardverhalten (Interagieren) —
      // das ggf. offene Notizfeld bleibt davon unberuehrt bedienbar.
      setTool('interact');

      // Freihand: kreuzt oder ueberlappt der neue Zug bestehende Striche
      // gleicher Farbe auf diesem Device, gehoeren sie zu einer Korrektur.
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
            },
          };
          const obsolete = new Set(rest.map((item) => item.id));
          setFeedback((current) =>
            current
              .filter((item) => !obsolete.has(item.id))
              .map((item) => (item.id === merged.id ? merged : item)),
          );
          persist(replaceItem(merged), 'Feedback speichern');
          if (obsolete.size > 0) persist(removeItems([...obsolete]), 'Feedback speichern');
          return;
        }
      }

      // Element-Marker werden auf alle Viewports gespiegelt: derselbe
      // Selektor wird in jedem anderen Frame aufgeloest und dort mit dessen
      // eigener Bounding-Box als Kopie gespeichert. `syncId` verknuepft die
      // Kopien — Notiz-Aenderungen laufen darueber auf alle.
      if (shape.tool === 'element' && shape.selector) {
        const syncId = shape.id;
        const batch: FeedbackItem[] = [
          {
            id: shape.id,
            url: activeUrl,
            deviceId: device.id,
            shape: { ...shape, syncId },
            createdAt: Date.now(),
          },
        ];
        const covered = new Set([device.id]);
        for (const [otherUid, iframe] of frames.current) {
          if (otherUid === uid) continue;
          const target =
            otherUid === FS_UID ? fsDevice : devices.find((d) => d.uid === otherUid);
          // Instanzen desselben Presets teilen sich den Eintrag ohnehin.
          if (!target || covered.has(target.id)) continue;
          const doc = frameDocument(iframe);
          const win = doc?.defaultView;
          if (!doc || !win) continue;
          let el: Element | null = null;
          try {
            el = findByShadowPath(doc, shape.selector.split(' >>> '));
          } catch {
            el = null;
          }
          if (!el) continue;
          covered.add(target.id);
          const rect = el.getBoundingClientRect();
          const cloneId = shapeId();
          batch.push({
            id: cloneId,
            url: activeUrl,
            deviceId: target.id,
            shape: {
              ...shape,
              id: cloneId,
              syncId,
              x: rect.left + win.scrollX,
              y: rect.top + win.scrollY,
              w: rect.width,
              h: rect.height,
            },
            createdAt: Date.now(),
          });
        }
        setFeedback((current) => [...current, ...batch]);
        persist(addItems(batch), 'Feedback speichern');
        return;
      }

      const item: FeedbackItem = {
        id: shape.id,
        url: activeUrl,
        deviceId: device.id,
        shape,
        createdAt: Date.now(),
      };
      setFeedback((current) => [...current, item]);
      persist(addItems([item]), 'Feedback speichern');
    },
    [devices, fsDevice, activeUrl, feedback],
  );

  /** Entfernt den zuletzt gesetzten Marker der aktuellen Seite (egal welches Device). */
  const undoShape = useCallback(() => {
    const pageItems = feedback.filter((item) => item.url === activeUrl);
    const last = pageItems[pageItems.length - 1];
    if (!last) return;
    setFeedback((current) => current.filter((item) => item.id !== last.id));
    persist(removeItems([last.id]), 'Feedback loeschen');
  }, [feedback, activeUrl]);

  const removeShape = useCallback((itemId: string) => {
    setFeedback((current) => current.filter((item) => item.id !== itemId));
    persist(removeItems([itemId]), 'Feedback loeschen');
  }, []);

  /** Erledigt-Status eines Eintrags umschalten (Review-Workflow). */
  const toggleDone = useCallback(
    (itemId: string) => {
      const existing = feedback.find((item) => item.id === itemId);
      if (!existing) return;
      const updated: FeedbackItem = { ...existing, done: !existing.done };
      setFeedback((current) => current.map((item) => (item.id === itemId ? updated : item)));
      persist(replaceItem(updated), 'Feedback speichern');
    },
    [feedback],
  );

  /**
   * Notiz/Text eines Eintrags setzen. Pins/Texte tragen ihren Inhalt in
   * `text`, alle anderen Marker (inkl. Freihand) in `note`. Auf andere
   * Viewports replizierte Element-Marker (gleiche syncId) bekommen die
   * Notiz mit — es ist eine Korrektur, nicht mehrere.
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
      for (const item of updated) persist(replaceItem(item), 'Notiz speichern');
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

  // Notiz/Text eines Eintrags direkt im Panel aendern oder ergaenzen.
  const editItemText = useCallback(
    (itemId: string, text: string) => {
      const existing = feedback.find((item) => item.id === itemId);
      if (!existing) return;
      applyItemText(existing, text.trim());
    },
    [feedback, applyItemText],
  );

  const clearAllShapes = useCallback(() => {
    setFeedback((current) => current.filter((item) => item.url !== activeUrl));
    persist(clearUrl(activeUrl), 'Feedback loeschen');
  }, [activeUrl]);

  // Panel-Klick: zum Device springen — oder es ins Grid holen, falls entfernt.
  const focusDevice = useCallback(
    (presetId: string) => {
      // Vollbild-Feedback lebt auf dem Vollbild-Frame — dorthin wechseln.
      if (presetId === FULLSCREEN_ID) {
        setFullscreen(true);
        return;
      }
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
   * Warten, bis alle Frames die Zielseite fertig geladen haben. Der Vergleich
   * ist bewusst tolerant (Trailing-Slash-Redirects wie /sub → /sub/ zaehlen
   * als Treffer) — sonst laeuft der Multi-Page-Export in den Timeout, obwohl
   * die richtige Seite laengst steht. Auch der Panel-Sprung auf Eintraege
   * fremder Seiten wartet hierueber, bevor er den Marker anfliegt.
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

  /** Marker auf den Frames global ein-/ausblenden (Auge im Panel-Kopf). */
  const [markersVisible, setMarkersVisible] = useState(true);

  // Panel-Klick auf einen Eintrag: Device und Marker anfliegen, dann kurz
  // aufflashen — Device-Rahmen und Marker pulsieren, damit klar ist, um
  // welche Korrektur auf welchem Layout es geht.
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

  /** Device anfliegen, Marker zentrieren, aufblitzen — Seite muss geladen sein. */
  const focusItemNow = useCallback(
    (item: FeedbackItem) => {
      // Vollbild-Eintraege: in den Vollbild-Modus wechseln und dort flashen.
      if (item.deviceId === FULLSCREEN_ID) {
        setFullscreen(true);
        const iframe = frames.current.get(FS_UID);
        if (iframe) {
          const target = shapeFocusPoint(item.shape);
          try {
            const win = iframe.contentWindow;
            win?.scrollTo({
              left: Math.max(0, target.x - win.innerWidth / 2),
              top: Math.max(0, target.y - win.innerHeight / 2),
              behavior: 'smooth',
            });
          } catch {
            /* Frame nicht lesbar */
          }
        }
        setMarkersVisible(true);
        setFlash((prev) => ({
          uid: FS_UID,
          shapeId: item.shape.id,
          nonce: (prev?.nonce ?? 0) + 1,
        }));
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

      // Den Marker im Frame in die Mitte scrollen (Scroll-Sync zieht die
      // uebrigen Frames mit).
      const iframe = frames.current.get(instance.uid);
      if (iframe) {
        const target = shapeFocusPoint(item.shape);
        try {
          const win = iframe.contentWindow;
          win?.scrollTo({
            left: Math.max(0, target.x - win.innerWidth / 2),
            top: Math.max(0, target.y - win.innerHeight / 2),
            behavior: 'smooth',
          });
        } catch {
          /* Frame nicht lesbar */
        }
      }

      setMarkersVisible(true); // ausgeblendete Marker wuerden den Flash schlucken
      setFlash((prev) => ({
        uid: instance.uid,
        shapeId: item.shape.id,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    },
    [devices, addDevice, shadowRoot],
  );

  // Panel-Klick auf einen Eintrag: liegt er auf einer anderen Seite, erst
  // dorthin navigieren und nach dem Laden zum Marker springen — sonst direkt.
  const focusItem = useCallback(
    (item: FeedbackItem) => {
      if (item.url === activeUrl) {
        focusItemNow(item);
        return;
      }
      handleNavigate(item.url);
      void waitForPage(item.url).then((loaded) => {
        if (!loaded) log.warn('Seite fuer Panel-Sprung nicht rechtzeitig geladen', item.url);
        // Kurzer Aufschub: Overlays und Layout der frischen Frames stehen lassen.
        window.setTimeout(() => focusItemNow(item), 250);
      });
    },
    [activeUrl, focusItemNow, handleNavigate, waitForPage],
  );

  // Hover ueber einen Panel-Eintrag: die zugehoerige Markierung im Viewport
  // ruhig hervorheben (nur aktuelle Seite — andere Seiten rendern nicht).
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
      const instance = devices.find((d) => d.id === item.deviceId);
      setHoverMark(instance ? { uid: instance.uid, shapeId: item.shape.id } : null);
    },
    [devices, activeUrl, fullscreen],
  );

  // Drag&Drop-Sortierung der Device-Karten: waehrend des Zugs wird die Liste
  // live umsortiert (die Karte weicht aus), gespeichert wird ueber die
  // bestehende Grid-Persistenz.
  const [dragUid, setDragUid] = useState<string | null>(null);
  const handleDragHover = useCallback(
    (overUid: string, side: 'before' | 'after') => {
      if (!dragUid || dragUid === overUid) return;
      setDevices((list) => {
        const from = list.findIndex((d) => d.uid === dragUid);
        const over = list.findIndex((d) => d.uid === overUid);
        if (from < 0 || over < 0) return list;
        let to = side === 'before' ? over : over + 1;
        if (from < to) to -= 1; // Index gilt fuer die Liste OHNE das gezogene Element
        if (to === from) return list;
        const next = [...list];
        const [moved] = next.splice(from, 1);
        if (moved) next.splice(to, 0, moved);
        return next;
      });
    },
    [dragUid],
  );

  // Klick auf den Feedback-Zaehler eines Devices: Panel oeffnen und die
  // betroffene Gruppe dort kurz hervorheben.
  const [panelHighlight, setPanelHighlight] = useState<{
    deviceId: string;
    nonce: number;
  } | null>(null);
  const showDeviceFeedback = useCallback((presetId: string) => {
    setFeedbackOpen(true);
    setPanelHighlight((prev) => ({
      deviceId: presetId,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }, []);

  // Teilen per Link: Feedback dieser Seite komprimiert im URL-Hash.
  // Anzeige und Kopieren uebernimmt das Feedback-Panel.
  const buildShareLink = useCallback(
    () =>
      buildShareUrl(
        activeUrl,
        feedback.filter((item) => item.url === activeUrl),
      ),
    [feedback, activeUrl],
  );

  // Waehrend des Screenshot-Exports rendern die Overlays die Notizen als
  // Sprechblasen — der Text steht dann am richtigen Punkt im Bild.
  const [showNotes, setShowNotes] = useState(false);

  /**
   * Laedt fuer jede Seite der aktuellen Domain mit offenem Feedback
   * Full-Page-Screenshots herunter (ein Bild pro Device mit Feedback,
   * Frame slice-weise gescrollt und gestitcht). Notizen werden als
   * Sprechblasen am jeweiligen Marker mitgerendert. Andere Seiten werden
   * dafuer kurz in den Previews geladen; am Ende geht es zurueck zur
   * Ausgangsseite. `onProgress` meldet erledigte/gesamte Devices.
   */
  const exportScreenshots = useCallback(
    async (onProgress?: (done: number, total: number) => void): Promise<number> => {
      /** Dateiname-Slug aus Pfad + Query der Seite. */
      const slugOf = (url: string): string => {
        try {
          const u = new URL(url);
          const slug = (u.pathname + u.search).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
          return slug || 'home';
        } catch {
          return 'page';
        }
      };

      const startUrl = activeUrl;
      // Aktuelle Seite zuerst — sie ist schon geladen. Nur Seiten mit offenen
      // Eintraegen; abgehaktes Feedback braucht keinen Screenshot mehr.
      const open = feedback.filter((i) => sameOrigin(i.url, startUrl) && !i.done);
      const pages = [...new Set(open.map((i) => i.url))].sort((a, b) =>
        a === startUrl ? -1 : b === startUrl ? 1 : a.localeCompare(b),
      );

      // Gesamtzahl der Captures vorab — fuer die Fortschrittsanzeige.
      const gridPresetIds = new Set(devices.map((d) => d.id));
      const total = pages.reduce(
        (sum, pageUrl) =>
          sum +
          new Set(
            open
              .filter((i) => i.url === pageUrl && gridPresetIds.has(i.deviceId))
              .map((i) => i.deviceId),
          ).size,
        0,
      );
      let done = 0;
      onProgress?.(done, total);

      let downloads = 0;
      let currentPage = startUrl;
      setShowNotes(true);
      try {
        // Notizen-Sprechblasen erst rendern lassen.
        await new Promise((r) => setTimeout(r, 150));

        for (const pageUrl of pages) {
          if (pageUrl !== currentPage) {
            handleNavigate(pageUrl);
            currentPage = pageUrl;
            const loaded = await waitForPage(pageUrl);
            // Auch nach Timeout weitermachen: die Frames zeigen mit hoher
            // Wahrscheinlichkeit die richtige Seite (Redirect/Query-Drift) —
            // ein Capture ist besser als eine kommentarlos fehlende Datei.
            if (!loaded) log.warn('Seite evtl. nicht fertig geladen — Capture trotzdem', pageUrl);
            await new Promise((r) => setTimeout(r, 250));
          }

          const captured = new Set<string>();
          for (const device of devices) {
            if (captured.has(device.id)) continue;
            const hasOpen = open.some(
              (item) => item.url === pageUrl && item.deviceId === device.id,
            );
            const iframe = frames.current.get(device.uid);
            const viewport = iframe?.parentElement;
            if (!hasOpen || !iframe || !viewport) continue;
            captured.add(device.id);

            viewport.scrollIntoView({ block: 'nearest', inline: 'nearest' });

            try {
              const blob = await captureFullFrameShot(
                iframe,
                () => viewport.getBoundingClientRect(),
                effZoomsRef.current.get(device.uid) ?? zoom,
              );
              if (blob) {
                downloadBlob(blob, `inkspect-feedback-${slugOf(pageUrl)}-${device.id}.png`);
                downloads += 1;
              }
            } catch (e) {
              log.warn('Screenshot fehlgeschlagen', device.name, e);
            }

            done += 1;
            onProgress?.(done, total);
          }
        }
      } finally {
        setShowNotes(false);
        // Zurueck zur Ausgangsseite, falls fuer andere Seiten navigiert wurde.
        if (currentPage !== startUrl) handleNavigate(startUrl);
      }

      return downloads;
    },
    [devices, feedback, activeUrl, zoom, handleNavigate, waitForPage],
  );

  // Shortcuts: Esc zurueck zum Interagieren, Cmd/Ctrl+Z Undo (nur im
  // Zeichenmodus), 1-7 waehlt ein Werkzeug.
  useEffect(() => {
    const TOOL_KEYS: Tool[] = ['element', 'pin', 'pen', 'rect', 'ellipse', 'arrow', 'text'];
    const onKey = (e: KeyboardEvent) => {
      // In Feldern getippte Tasten gehoeren dem Feld — auch Escape: der
      // Capture-Listener liefe sonst vor dem stopPropagation der Editoren
      // und wuerde beim Schliessen einer Notiz gleich den Modus beenden.
      const origin = e.composedPath()[0] as HTMLElement | undefined;
      const typing =
        origin?.localName === 'input' ||
        origin?.localName === 'textarea' ||
        origin?.isContentEditable === true;
      if (e.key === 'Escape') {
        setPaletteAt(null);
        if (!typing) {
          // Erst den Zeichenmodus beenden; ein weiteres Esc verlaesst das Vollbild.
          if (toolRef.current !== 'interact') selectTool('interact');
          else setFullscreen(false);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (!annotating) return; // Undo der Seite nicht kapern
        e.preventDefault();
        undoShape();
        return;
      }
      if (typing) return;
      const idx = Number(e.key) - 1;
      const next = TOOL_KEYS[idx];
      if (next) selectTool(next);
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [annotating, undoShape, selectTool]);

  // Nur Feedback der aktuellen Domain im Hauptbereich — fremde Domains
  // bekommen im Panel einen eigenen, einklappbaren Bereich. Die Badges
  // zaehlen nur offene (nicht abgehakte) Eintraege.
  const domainFeedback = feedback.filter((item) => sameOrigin(item.url, activeUrl));
  const otherDomainFeedback = feedback.filter((item) => !sameOrigin(item.url, activeUrl));
  const feedbackCount = domainFeedback.filter((item) => !item.done).length;
  const pageFeedbackCount = feedback.filter((item) => item.url === activeUrl).length;

  // Das Panel kennt das Vollbild-Pseudo-Device als eigene Gruppe.
  const panelPresets = useMemo<readonly DevicePreset[]>(
    () => [...presets, fsDevice],
    [presets, fsDevice],
  );

  return (
    <div className={`root${fullscreen ? ' root--fs' : ''}`}>
      {!fullscreen && (
        <Toolbar
          src={activeUrl}
          zoom={zoom}
          presets={presets}
          editorOpen={editorOpen}
          sync={syncPrefs}
          feedbackOpen={feedbackOpen}
          feedbackCount={feedbackCount}
          onNavigate={handleNavigate}
          onAddDevice={addDevice}
          onAddCustomDevice={addCustomDevice}
          onRemoveCustomPreset={removeCustomPreset}
          onZoom={setZoom}
          onReload={reloadFrames}
          onToggleEditor={() => setEditorOpen((v) => !v)}
          onToggleSync={toggleSync}
          onToggleFeedback={() => setFeedbackOpen((v) => !v)}
          onFullscreen={() => setFullscreen(true)}
          onClose={() => void handleClose()}
        />
      )}

      <div className={`loadbar${navigating ? ' loadbar--active' : ''}`} />

      {hint && <div className="hint">{hint}</div>}

      {blocked && !bypassEnabled && (
        <div className="banner">
          <strong>This page refuses to be embedded.</strong>
          <span>
            It sends <code>X-Frame-Options: DENY</code> or <code>frame-ancestors 'none'</code>. To
            work around this, Inkspect removes these headers — only in this tab, only for the
            preview frames.
          </span>
          <span className="device__bar-spacer" />
          <button onClick={() => void enableBypass()} disabled={bypassPending}>
            {bypassPending ? 'Enabling…' : 'Bypass blocking'}
          </button>
        </div>
      )}

      <div className="body">
        {!fullscreen && editorOpen && (
          <CssEditor
            shadowRoot={shadowRoot}
            sheets={sheets}
            activeId={activeId}
            overrides={overrides}
            nonce={editorNonce}
            onSelect={setActiveId}
            onChange={handleChange}
            onReset={handleReset}
          />
        )}

        {fullscreen && (
          <div className="fs-stage">
            <DeviceFrame
              key={FS_UID}
              bare
              device={fsDevice}
              src={src}
              zoom={1}
              reloadKey={reloadKey}
              annotating={annotating}
              shapes={itemsFor(FULLSCREEN_ID).map((item) => item.shape)}
              dimmedIds={
                new Set(
                  itemsFor(FULLSCREEN_ID)
                    .filter((i) => i.done)
                    .map((i) => i.shape.id),
                )
              }
              tool={drawTool}
              color={color}
              showNotes={showNotes}
              markersVisible={markersVisible}
              flashShapeId={flash?.uid === FS_UID ? flash.shapeId : null}
              flashNonce={flash?.nonce ?? 0}
              flashActive={false}
              hoverShapeId={hoverMark?.uid === FS_UID ? hoverMark.shapeId : null}
              noteEdit={noteEdit?.uid === FS_UID ? noteEdit : null}
              dragging={false}
              onLoad={handleLoad}
              onAttach={handleAttach}
              onRotate={() => {}}
              onRemove={() => {}}
              onBadgeClick={showDeviceFeedback}
              onAddShape={addShape}
              onSetShapeNote={setShapeNote}
              onDragBegin={() => {}}
              onDragHover={() => {}}
              onDragEnd={() => {}}
            />
          </div>
        )}

        {!fullscreen && (
        <div
          ref={gridRef}
          className={`grid${dragUid ? ' grid--dragging' : ''}`}
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
              annotating={annotating}
              shapes={itemsFor(device.id).map((item) => item.shape)}
              dimmedIds={
                new Set(
                  itemsFor(device.id)
                    .filter((i) => i.done)
                    .map((i) => i.shape.id),
                )
              }
              tool={drawTool}
              color={color}
              showNotes={showNotes}
              markersVisible={markersVisible}
              flashShapeId={flash?.uid === device.uid ? flash.shapeId : null}
              flashNonce={flash?.nonce ?? 0}
              flashActive={flash?.uid === device.uid}
              hoverShapeId={hoverMark?.uid === device.uid ? hoverMark.shapeId : null}
              noteEdit={noteEdit?.uid === device.uid ? noteEdit : null}
              dragging={dragUid === device.uid}
              onLoad={handleLoad}
              onAttach={handleAttach}
              onTouchChange={handleTouchChange}
              onRotate={rotateDevice}
              onRemove={removeDevice}
              onBadgeClick={showDeviceFeedback}
              onAddShape={addShape}
              onSetShapeNote={setShapeNote}
              onDragBegin={setDragUid}
              onDragHover={handleDragHover}
              onDragEnd={() => setDragUid(null)}
            />
          ))}
        </div>
        )}

        {feedbackOpen && (
          <FeedbackPanel
            items={domainFeedback}
            otherItems={otherDomainFeedback}
            url={activeUrl}
            presets={panelPresets}
            devices={devices}
            markersVisible={markersVisible}
            onToggleMarkers={() => setMarkersVisible((v) => !v)}
            highlight={panelHighlight}
            onJump={focusDevice}
            onJumpItem={focusItem}
            onPreviewItem={previewItem}
            onEditItem={editItemText}
            onNavigate={handleNavigate}
            onDelete={removeShape}
            onToggleDone={toggleDone}
            onClearAll={clearAllShapes}
            onBuildShareLink={buildShareLink}
            onExportScreenshots={exportScreenshots}
            onClose={() => setFeedbackOpen(false)}
          />
        )}
      </div>

      {fullscreen && (
        <>
          <FeedbackBar
            tool={tool}
            color={color}
            canUndo={pageFeedbackCount > 0}
            onTool={selectTool}
            onColor={setColor}
            onUndo={undoShape}
            onClear={clearAllShapes}
            onExit={() => setFullscreen(false)}
          />
          <button
            className="fs-fab"
            title={feedbackOpen ? 'Hide feedback panel' : 'Show feedback panel'}
            aria-pressed={feedbackOpen}
            onClick={() => setFeedbackOpen((v) => !v)}
          >
            <IconMessage size={22} />
            {feedbackCount > 0 && <span className="fs-fab__badge">{feedbackCount}</span>}
          </button>
        </>
      )}

      {paletteAt && (
        <AnnotationPalette
          at={paletteAt}
          tool={tool}
          color={color}
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
    </div>
  );
}
