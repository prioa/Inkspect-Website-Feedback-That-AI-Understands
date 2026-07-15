import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Toolbar } from './Toolbar';
import { CssEditor } from './CssEditor';
import { DeviceFrame } from './DeviceFrame';
import { AnnotationPalette } from './AnnotationPalette';
import { FeedbackPanel } from './FeedbackPanel';
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
  type DeviceInstance,
  type DevicePreset,
} from '@/lib/devices';
import { frameDocument, isFrameBlocked } from '@/lib/framing';
import { ScrollSync } from '@/lib/scrollSync';
import { InteractionSync } from '@/lib/interactionSync';
import {
  ANNOTATION_COLORS,
  penOverlaps,
  pinNumbers,
  TOOL_LABELS,
  type PaletteTool,
  type Shape,
  type Tool,
} from '@/lib/annotations';
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
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(initialFeedbackOpen);

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

  // Feedback ist an die Landingpage gebunden: activeUrl folgt der tatsaechlich
  // geladenen Frame-URL (auch bei Link-Klicks in den Previews). Der State
  // haelt *alle* Eintraege — angezeigt auf den Frames wird nur die aktuelle
  // Seite, das Panel gruppiert den Rest nach Seite.
  const [activeUrl, setActiveUrl] = useState(() => normalizeUrl(location.href));
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);

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
    interactionSync.current.enabled = syncEnabled;
  }, [syncEnabled]);

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

  const handleLoad = useCallback((device: DeviceInstance, iframe: HTMLIFrameElement) => {
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
  }, []);

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
      await browser.runtime.sendMessage({ type: 'ink:frame-bypass', enabled: false });
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
      const device = devices.find((d) => d.uid === uid);
      if (!device) return;

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
    [devices, activeUrl, feedback],
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

  const setShapeNote = useCallback(
    (_uid: string, shapeId: string, note: string) => {
      const existing = feedback.find((item) => item.shape.id === shapeId);
      if (!existing) return;
      const shape = existing.shape;
      // Pins/Texte tragen ihren Inhalt in `text`, alle anderen Marker mit
      // Freitext in `note`; nur Freihand hat keinen.
      if (shape.tool === 'pen') return;
      const updatedShape: Shape =
        shape.tool === 'pin' || shape.tool === 'text' ? { ...shape, text: note } : { ...shape, note };
      const updated: FeedbackItem = { ...existing, shape: updatedShape };
      setFeedback((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      persist(replaceItem(updated), 'Notiz speichern');
    },
    [feedback],
  );

  const clearAllShapes = useCallback(() => {
    setFeedback((current) => current.filter((item) => item.url !== activeUrl));
    persist(clearUrl(activeUrl), 'Feedback loeschen');
  }, [activeUrl]);

  // Panel-Klick: zum Device springen — oder es ins Grid holen, falls entfernt.
  const focusDevice = useCallback(
    (presetId: string) => {
      const instance = devices.find((d) => d.id === presetId);
      if (!instance) {
        addDevice(presetId);
        return;
      }
      shadowRoot
        .querySelector(`[data-uid="${instance.uid}"]`)
        ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    },
    [devices, addDevice, shadowRoot],
  );

  // Textzusammenfassung fuer Uebergabe an Kollegen/Tickets.
  const copyFeedback = useCallback(async () => {
    const lines = [`Inkspect Feedback — ${activeUrl}`];
    for (const preset of presets) {
      // Erledigte Eintraege bleiben aussen vor — der Export ist eine To-do-Liste.
      const shapes = feedback
        .filter((item) => item.deviceId === preset.id && item.url === activeUrl && !item.done)
        .map((item) => item.shape);
      if (shapes.length === 0) continue;
      lines.push('', `## ${preset.name} (${preset.width}×${preset.height})`);
      const numbers = pinNumbers(shapes);
      for (const shape of shapes) {
        if (shape.tool === 'pin') {
          lines.push(`${numbers.get(shape.id)}. ${shape.text || '(pin without note)'}`);
        } else if (shape.tool === 'element') {
          lines.push(`- Element ${shape.label}${shape.note ? `: "${shape.note}"` : ''}`);
        } else if (shape.tool === 'text') {
          lines.push(`- Text: "${shape.text}"`);
        } else if (shape.tool !== 'pen' && shape.note) {
          lines.push(`- ${TOOL_LABELS[shape.tool]}: "${shape.note}"`);
        } else {
          lines.push(`- ${TOOL_LABELS[shape.tool]}`);
        }
      }
    }
    await navigator.clipboard.writeText(lines.join('\n'));
  }, [feedback, activeUrl, presets]);

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

  /** Warten, bis alle Frames die Zielseite fertig geladen haben. */
  const waitForPage = useCallback((url: string, timeout = 12_000): Promise<boolean> => {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const list = [...frames.current.values()];
        const ready =
          list.length > 0 &&
          list.every((iframe) => {
            const doc = frameDocument(iframe);
            try {
              return doc != null && doc.readyState === 'complete' && normalizeUrl(doc.location.href) === url;
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
      const pages = [...new Set(open.map((i) => i.url))].sort(
        (a, b) => (a === startUrl ? -1 : b === startUrl ? 1 : a.localeCompare(b)),
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
            if (!loaded) {
              log.warn('Seite fuer Screenshot nicht geladen', pageUrl);
              continue;
            }
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
                zoom,
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
        if (!typing) selectTool('interact');
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

  // Nur Feedback der aktuellen Domain — Eintraege anderer Domains bleiben
  // gespeichert, tauchen aber weder im Panel noch im Zaehler auf. Die Badges
  // zaehlen nur offene (nicht abgehakte) Eintraege.
  const domainFeedback = feedback.filter((item) => sameOrigin(item.url, activeUrl));
  const feedbackCount = domainFeedback.filter((item) => !item.done).length;
  const pageFeedbackCount = feedback.filter((item) => item.url === activeUrl).length;

  return (
    <div className="root">
      <Toolbar
        src={src}
        zoom={zoom}
        presets={presets}
        editorOpen={editorOpen}
        syncEnabled={syncEnabled}
        feedbackOpen={feedbackOpen}
        feedbackCount={feedbackCount}
        onNavigate={handleNavigate}
        onAddDevice={addDevice}
        onAddCustomDevice={addCustomDevice}
        onRemoveCustomPreset={removeCustomPreset}
        onZoom={setZoom}
        onReload={reloadFrames}
        onToggleEditor={() => setEditorOpen((v) => !v)}
        onToggleSync={() => setSyncEnabled((v) => !v)}
        onToggleFeedback={() => setFeedbackOpen((v) => !v)}
        onClose={() => void handleClose()}
      />

      <div className={`loadbar${navigating ? ' loadbar--active' : ''}`} />

      {hint && <div className="hint">{hint}</div>}

      {blocked && !bypassEnabled && (
        <div className="banner">
          <strong>This page refuses to be embedded.</strong>
          <span>
            It sends <code>X-Frame-Options: DENY</code> or{' '}
            <code>frame-ancestors 'none'</code>. To work around this, Inkspect removes these
            headers — only in this tab, only for the preview frames.
          </span>
          <span className="device__bar-spacer" />
          <button onClick={() => void enableBypass()} disabled={bypassPending}>
            {bypassPending ? 'Enabling…' : 'Bypass blocking'}
          </button>
        </div>
      )}

      <div className="body">
        {editorOpen && (
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

        <div className="grid">
          {devices.map((device) => (
            <DeviceFrame
              key={device.uid}
              device={device}
              src={src}
              zoom={zoom}
              reloadKey={reloadKey}
              annotating={annotating}
              shapes={itemsFor(device.id).map((item) => item.shape)}
              dimmedIds={new Set(itemsFor(device.id).filter((i) => i.done).map((i) => i.shape.id))}
              tool={drawTool}
              color={color}
              showNotes={showNotes}
              onLoad={handleLoad}
              onAttach={handleAttach}
              onRotate={rotateDevice}
              onRemove={removeDevice}
              onAddShape={addShape}
              onSetShapeNote={setShapeNote}
            />
          ))}
        </div>

        {feedbackOpen && (
          <FeedbackPanel
            items={domainFeedback}
            url={activeUrl}
            presets={presets}
            devices={devices}
            onJump={focusDevice}
            onNavigate={handleNavigate}
            onDelete={removeShape}
            onToggleDone={toggleDone}
            onClearAll={clearAllShapes}
            onCopy={copyFeedback}
            onBuildShareLink={buildShareLink}
            onExportScreenshots={exportScreenshots}
            onClose={() => setFeedbackOpen(false)}
          />
        )}
      </div>

      <AnnotationPalette
        tool={tool}
        color={color}
        canUndo={pageFeedbackCount > 0}
        onTool={selectTool}
        onColor={setColor}
        onUndo={undoShape}
        onClear={clearAllShapes}
      />
    </div>
  );
}
