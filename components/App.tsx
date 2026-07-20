import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { browser } from 'wxt/browser';
import { Toolbar, type SyncKey, type SyncPrefs } from './Toolbar';
import { CssEditor } from './CssEditor';
import { DeviceFrame } from './DeviceFrame';
import { AnnotationPalette, FeedbackBar } from './AnnotationPalette';
import { FeedbackPanel } from './FeedbackPanel';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { Tour } from './Tour';
import { ConfirmDialog } from './ConfirmDialog';
import { IconClose, IconMessage, IconWarning } from './icons';
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
  type ThemePref,
  type ToolbarPlacement,
} from '@/lib/settings';
import { frameDocument, isFrameBlocked } from '@/lib/framing';
import { ScrollSync } from '@/lib/scrollSync';
import { InteractionSync } from '@/lib/interactionSync';
import {
  ANNOTATION_COLORS,
  DEFAULT_TOOL_ORDER,
  hitsShape,
  isMovableShape,
  penOverlaps,
  shapeBounds,
  translateShape,
  shapeFocusPoint,
  type PaletteTool,
  type Shape,
  type Tool,
} from '@/lib/annotations';
import type { NoteEditRequest } from './AnnotationOverlay';
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
import { captureFullFrameShot, downloadBlob } from '@/lib/screenshot';
import { applyOverride, clearOverride, collectSheets, type SheetSource } from '@/lib/stylesheets';
import type { FrameBypassResponse, FrameCheckResponse } from '@/lib/messages';
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
/** Breite des Grid-Scrollbalkens (muss zur ::-webkit-scrollbar-Regel passen). */
const SCROLLBAR_W = 10;

/**
 * Zoom pro Device: Karten werden greedy in Zeilen gepackt (Basisbreite =
 * Viewport × Zoom) und dann direkt mit `zoom` gerendert. Eine Zeile wird nur
 * dann proportional verkleinert, wenn sie sonst ueber die Grid-Breite liefe —
 * vergroessert wird nie ueber `zoom` hinaus. Ein Device, das allein schon zu
 * breit ist, wird auf Zeilenbreite verkleinert (mindestens ein Device pro
 * Zeile). Der „Fit"-Knopf setzt `zoom` so, dass eine Zeile die Breite fuellt.
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
    // Nur verkleinern (factor < 1), nie ueber `zoom` hinaus strecken.
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

/** Lesbarer Name eines font-weight-Werts fuer den Inspector-Tooltip. */
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
 * Scrollt den Frame zum Marker: vertikal wird zentriert, horizontal aber NUR
 * gescrollt, wenn der Marker sonst ausserhalb des sichtbaren Bereichs laege.
 * Reines Zentrieren wuerde auf Seiten mit (oft ungewolltem) horizontalem
 * Overflow einen stoerenden Seiten-Scroll erzwingen.
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

/** Angedockt (Grid-Modus) sitzt die Werkzeugleiste fest unten mittig. */
const DOCKED_PLACEMENT: ToolbarPlacement = { dock: 'bottom', x: 0, y: 0 };

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
        // Nach einem Extension-Reload sind die Storage-APIs weg — erwartet,
        // die UI zeigt dafuer ihren Reload-Hinweis.
        if (!reportContextError(e)) log.error('Layout laden fehlgeschlagen', e);
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

  // Persistente UI-Vorlieben: Theme, Panel-Breiten, Onboarding. Werden einmal
  // geladen und danach bei jeder Aenderung fortgeschrieben.
  const [theme, setTheme] = useState<ThemePref>(DEFAULT_SETTINGS.theme);
  const [editorWidth, setEditorWidth] = useState(DEFAULT_SETTINGS.editorWidth);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_SETTINGS.panelWidth);
  /**
   * Laufender Schritt der gefuehrten Tour, `null` wenn sie nicht laeuft.
   * Ersetzt den alten Ein-Satz-Hinweis: der nannte nur den Rechtsklick, waehrend
   * die eigentlichen Gesten (Karten ziehen, Hilfslinien aufziehen, Markierung
   * verschieben) unentdeckt blieben.
   */
  const [tourStep, setTourStep] = useState<number | null>(null);
  // Auto-Fit: haelt den Zoom so, dass alle Karten in eine Zeile passen —
  // nachgezogen bei Grid-Wechsel und jeder Breitenaenderung (Panel/Editor,
  // Fenster). Jeder manuelle Zoom schaltet ihn ab.
  const [autoFit, setAutoFit] = useState(DEFAULT_SETTINGS.autoFit);
  /** Beim Oeffnen direkt ins Vollbild — nur beim Start ausgewertet. */
  const [startFullscreen, setStartFullscreen] = useState(DEFAULT_SETTINGS.startFullscreen);
  /** Wie viele Feedback-Farben die Leiste anbietet (2 oder 4). */
  const [paletteColorCount, setPaletteColorCount] = useState(DEFAULT_SETTINGS.paletteColorCount);
  /**
   * Platzierung der Werkzeugleiste im Vollbild — frei im Fenster oder an
   * einem der beiden Snap-Punkte. Ausserhalb des Vollbilds sitzt sie fest
   * unten (dort ist links das Grid).
   */
  const [toolbarPlacement, setToolbarPlacement] = useState<ToolbarPlacement>({
    dock: DEFAULT_SETTINGS.toolbarDock,
    x: DEFAULT_SETTINGS.toolbarX,
    y: DEFAULT_SETTINGS.toolbarY,
  });
  const settingsRestored = useRef(false);
  // Breiten-Refs: der pointerup-Handler des Splitters persistiert den finalen
  // Stand, ohne den Effekt an jedem Zwischenschritt neu aufzuhaengen.
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
      setPaletteColorCount(s.paletteColorCount);
      setToolbarPlacement({ dock: s.toolbarDock, x: s.toolbarX, y: s.toolbarY });
      setFramingAllowed(s.framingAllowed.includes(location.origin));
      framingConsentLoaded.current = true;
      if (s.startFullscreen) setFullscreen(true);
      settingsRestored.current = true;
    });
    return () => {
      alive = false;
    };
  }, []);

  // System-Dunkel-Praeferenz beobachten — nur relevant, wenn theme === 'system'
  // (dann folgt die CodeMirror-Theme dem Systemwert).
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
  const darkUi = theme === 'dark' || (theme === 'system' && systemDark);

  const changeTheme = useCallback((next: ThemePref) => {
    setTheme(next);
    void saveSettings({ theme: next });
  }, []);

  /** Tour beenden — ob durchgelaufen oder abgebrochen, sie kommt nicht wieder. */
  const closeTour = useCallback(() => {
    setTourStep(null);
    void saveSettings({ tourDone: true });
  }, []);
  /** Aus dem „More"-Menue heraus noch einmal von vorn. */
  const restartTour = useCallback(() => setTourStep(0), []);

  // Eigene, benannte Grid-Layouts (Device-Sets).
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
   * Darf die aktuelle URL als Frame geladen werden? Wird *vor* dem Laden
   * geklaert (Header-Vorabpruefung im Background), damit die Warnung kommt,
   * bevor die Seite ueberhaupt angefordert wird.
   */
  const [gate, setGate] = useState<'checking' | 'open' | 'blocked'>('checking');
  /**
   * Diese Origin hat der Nutzer schon einmal freigegeben — dann laedt eine
   * blockierte Seite direkt, statt erneut zu fragen. Der Toolbar-Indikator
   * zeigt den laufenden Eingriff und nimmt die Freigabe wieder zurueck.
   */
  const [framingAllowed, setFramingAllowed] = useState(false);
  const framingConsentLoaded = useRef(false);
  /**
   * Der Nutzer arbeitet bewusst ohne Header-Eingriff weiter: die Oberflaeche
   * laeuft, die Device-Frames bleiben leer und zeigen einen Hinweis.
   */
  const [framingSkipped, setFramingSkipped] = useState(false);
  /** URL → blockiert? Verhindert einen Vorab-Request pro Reload. */
  const framingChecked = useRef(new Map<string, boolean>());
  const [hint, setHint] = useState<string | null>(null);
  // Wird gesetzt, sobald der Extension-Kontext invalidiert ist (Update/Reload
  // der Extension bei offener UI). Ab hier schlaegt jede Persistenz fehl —
  // ein Reload-Banner ersetzt die frueher pro Save wiederholte Konsolen-Warnung.
  const [contextLost, setContextLost] = useState(isContextInvalidated);
  useEffect(() => onContextInvalidated(() => setContextLost(true)), []);

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
  // links schwebt die Werkzeugleiste, rechts unten der Panel-Knopf.
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  // Im Vollbild schiebt sich das Panel nicht ungefragt ins Bild — stattdessen
  // pulsiert der Feedback-Knopf. Der Zaehler startet die Animation neu.
  const [fabPulse, setFabPulse] = useState(0);
  const pulseFab = useCallback(() => setFabPulse((n) => n + 1), []);
  /**
   * Das Panel faehrt im Vollbild sichtbar in den Knopf zurueck, statt einfach
   * zu verschwinden. Solange die Animation laeuft, bleibt es montiert.
   */
  const [panelClosing, setPanelClosing] = useState(false);
  const closeTimer = useRef(0);
  const closeFeedback = useCallback(() => {
    if (!fullscreenRef.current) {
      setFeedbackOpen(false);
      return;
    }
    setPanelClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setPanelClosing(false);
      setFeedbackOpen(false);
    }, 160);
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  /** Einmal pro Session faehrt das Panel im Vollbild von selbst auf. */
  const fsPanelShown = useRef(false);
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
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  /**
   * Callback-Ref statt blossem `useRef`: das Grid haengt am Frame-Gate und
   * montiert erst, wenn das die Seite geprueft hat. Ein Effekt, der beim
   * ersten Lauf `gridRef.current` liest, greift bis dahin ins Leere und haengt
   * ohne Abhaengigkeit auf den Knoten nie nach — Breitenmessung und
   * Wheel-Zoom blieben die ganze Sitzung tot. Der Ref bleibt fuer die
   * imperativen Leser (Scrollbalken-Probe im Fit-Knopf).
   */
  const attachGrid = useCallback((el: HTMLDivElement | null) => {
    gridRef.current = el;
    setGridEl(el);
  }, []);
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    if (!gridEl || fullscreen) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w != null) setGridWidth(w);
    });
    observer.observe(gridEl);
    // Beim Abbau zurueck auf 0: eine stehengebliebene Breite wuerde den
    // naechsten Fit gegen ein Grid rechnen, das es nicht mehr gibt.
    return () => {
      observer.disconnect();
      setGridWidth(0);
    };
  }, [gridEl, fullscreen]);

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
  /** Angebotene Farben — die ersten n aus der Palette. */
  const paletteColors = useMemo(
    () => ANNOTATION_COLORS.slice(0, paletteColorCount),
    [paletteColorCount],
  );
  // Nach dem Verkleinern der Palette kann die aktive Farbe rausgefallen sein.
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

  // Inspector-Modus: ueber Elemente hovern zeigt Schriftgroesse, -art und
  // -schnitt des Texts darunter. Schliesst sich mit dem Zeichenmodus aus —
  // beide brauchen den Frame-Hover exklusiv.
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
  // mousemove feuert dicht — Tooltip hoechstens einmal pro Frame aktualisieren.
  const inspectRaf = useRef(0);
  const inspectNext = useRef<typeof inspect>(null);
  const toggleInspector = useCallback(() => {
    setInspecting((on) => {
      const next = !on;
      if (next) setTool('interact'); // Overlays aus, Frames empfangen Hover
      else setInspect(null);
      return next;
    });
  }, []);

  /** Der Einstieg in den Zeichenmodus oeffnet das Feedback-Panel gleich mit. */
  const selectTool = useCallback(
    (next: PaletteTool) => {
      if (next !== 'interact') setInspecting(false); // Zeichnen und Inspektor exklusiv
      if (next !== 'interact' && toolRef.current === 'interact') {
        // Im Vollbild wuerde das Panel die Seite verdecken, um die es gerade
        // geht — dort nur der Knopf-Puls als Hinweis, wo die Liste wohnt.
        if (fullscreenRef.current) pulseFab();
        else setFeedbackOpen(true);
      }
      setTool(next);
    },
    [pulseFab],
  );

  // Die Werkzeug-Palette ist ein Kontextmenue: Rechtsklick (auf Grid,
  // Overlay oder in einer Vorschau) oeffnet sie neben der Maus.
  const [paletteAt, setPaletteAt] = useState<{ x: number; y: number } | null>(null);
  // Stabiles Objekt: die Tour haengt Effekte daran auf, ein frisches Literal
  // pro Render wuerde sie bei jedem Tastendruck neu bewerten lassen.
  const tourState = useMemo(() => ({ paletteOpen: paletteAt !== null }), [paletteAt]);
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

  // Tastatur-Events aus einem Frame erreichen das Shell-Fenster nicht: der
  // Fokus liegt im Frame-Dokument, und Key-Events queren keine Dokument-
  // Grenze. Der Load-Handler haengt denselben Handler deshalb zusaetzlich in
  // jedes Frame-Dokument — ueber eine Ref, weil er dort ausserhalb des
  // Render-Zyklus laeuft.
  const shortcutKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});

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

      // Shortcuts auch dann, wenn der Fokus in der Preview liegt (Klick in
      // den Frame). Der Listener stirbt mit dem Dokument.
      doc.addEventListener('keydown', (e) => shortcutKeyRef.current(e), true);
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

      /**
       * Marker im Interaktionsmodus verschieben: Klicks landen dann im Frame,
       * nicht im Overlay. Gegriffen wird nur, wer die Kontur einer *eigenen*
       * Markierung trifft — alles andere gehoert weiter der Seite (Links,
       * Textauswahl). Waehrend des Zugs laeuft nur der UI-State mit;
       * gespeichert wird beim Loslassen.
       */
      doc.addEventListener('mousedown', (e) => {
        // Im Zeichenmodus liegt das Overlay davor und macht das selbst.
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
        // Losgelassen ausserhalb des Frames: der Zug muss trotzdem enden.
        window.addEventListener('mouseup', onUp, true);
      }, true);

      // Inspector-Modus: Bewegung ueber dem Frame zeigt Schrift-Infos des
      // Elements unter dem Cursor. Der Listener ist immer da, aber ausserhalb
      // des Inspector-Modus ein No-op. Updates werden per rAF entprellt.
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
    setFramingSkipped(false);
    setActiveUrl(normalizeUrl(next.href));
    setNavigating(true);
    setSrc(next.href);
    // src-State und Frame-Inhalt koennen auseinanderliegen (Link-Klicks
    // navigieren die Frames intern) — der key-Wechsel erzwingt den Reload.
    setReloadKey((k) => k + 1);
  }, []);

  // Letztes Netz: verlaesst der Tab die Seite, stirbt die UI — der Eingriff
  // darf nicht zurueckbleiben. tabs.onUpdated im Background deckt denselben
  // Fall ab, dieser Weg ist der schnellere.
  useEffect(() => {
    const off = () => {
      try {
        void browser.runtime.sendMessage({ type: 'ink:frame-bypass', enabled: false });
      } catch {
        /* Kontext schon weg */
      }
    };
    window.addEventListener('pagehide', off);
    return () => window.removeEventListener('pagehide', off);
  }, []);

  /**
   * Vorab-Pruefung der Framing-Header. Faellt der Check aus (Netzwerkfehler,
   * Background nicht erreichbar), wird geladen — die Erkennung nach dem Load
   * bleibt als Netz bestehen.
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
   * Header-Eingriff einschalten. `remember` speichert die Zustimmung fuer
   * diese Origin — danach laufen blockierte Seiten ohne erneute Nachfrage.
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

  /** Eingriff beenden und die Freigabe dieser Origin zuruecknehmen. */
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
   * Freigegebene Origin: den Eingriff einschalten, sobald eine Seite daran
   * scheitert — ohne erneute Nachfrage, aber sichtbar in der Werkzeugleiste.
   */
  useEffect(() => {
    if (gate !== 'blocked' || bypassEnabled || bypassPending) return;
    if (!framingConsentLoaded.current || !framingAllowed) return;
    void enableBypass(false);
  }, [gate, framingAllowed, bypassEnabled, bypassPending, enableBypass]);

  /**
   * Blockiert — entweder vorab an den Headern erkannt oder (als Netz) erst am
   * leeren Frame nach dem Laden. Bis das geklaert ist, werden keine Frames
   * gerendert; sonst fordern sie die Seite an, bevor die Warnung stand.
   */
  const frameBlocked = (gate === 'blocked' || blocked) && !bypassEnabled;
  const gateOpen = (!frameBlocked || framingSkipped) && gate !== 'checking';

  const handleClose = useCallback(async () => {
    scrollSync.current.detachAll();
    interactionSync.current.detachAll();
    // Bedingungslos: der UI-State kann die Regel verfehlen (zweiter Start bei
    // liegengebliebener Regel) — ein ueberfluessiges Abschalten kostet nichts.
    try {
      await browser.runtime.sendMessage({ type: 'ink:frame-bypass', enabled: false });
    } catch {
      /* Background nicht erreichbar — Cleanup laeuft ueber tabs.onUpdated */
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

  /** Mehrere Presets auf einmal ins Grid holen (Schnell-Set). */
  // Grid komplett ersetzen (Quickset / gespeichertes Set). Existiert schon
  // Feedback, erst per Modal bestaetigen — das Ersetzen leert das Grid.
  const [confirmReplace, setConfirmReplace] = useState<{ apply: () => void } | null>(null);
  const requestReplaceGrid = useCallback((instances: DeviceInstance[]) => {
    if (instances.length === 0) return;
    const run = () => setDevices(instances);
    if (feedbackRef.current.length > 0) setConfirmReplace({ apply: run });
    else run();
  }, []);

  /** Quickset anwenden: Grid auf genau diese Presets zuruecksetzen. */
  const addDevices = useCallback(
    (presetIds: string[]) => {
      const instances = presetIds.flatMap((id) => {
        const preset = presets.find((p) => p.id === id);
        return preset ? [instantiate(preset)] : [];
      });
      requestReplaceGrid(instances);
    },
    [presets, requestReplaceGrid],
  );

  /** Aktuelles Grid als benanntes Layout speichern. */
  const saveWorkspace = useCallback(
    (name: string) => {
      const ws = createWorkspace(
        name,
        devices.map((d) => ({ presetId: d.id, rotated: d.rotated })),
      );
      if (!ws) return;
      setWorkspaces((current) => {
        const next = [...current, ws];
        persist(saveWorkspaces(next), 'Set speichern');
        return next;
      });
    },
    [devices],
  );

  /** Grid durch ein gespeichertes Layout ersetzen (mit Bestaetigung). */
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
      persist(saveWorkspaces(next), 'Set loeschen');
      return next;
    });
  }, []);

  /** Zoom so setzen, dass alle Karten in eine Zeile passen (max. 100 %). */
  const fitZoom = useCallback(() => {
    if (devices.length === 0 || gridWidth <= 0) return;
    const chrome = devices.length * CARD_CHROME + (devices.length - 1) * GRID_GAP;
    const totalWidth = devices.reduce((sum, d) => sum + viewport(d).width, 0);
    if (totalWidth <= 0) return;

    // Der senkrechte Scrollbalken nimmt Breite weg, sobald die Karten hoeher
    // als das Grid sind. Fehlt er im Moment des Klicks, muss er trotzdem
    // eingeplant werden: sonst passt die Zeile rechnerisch, der Balken kommt
    // mit der neuen Kartenhoehe dazu und schiebt sie doch um — genau der
    // Grund, warum erst der zweite Klick sass.
    const el = gridRef.current;
    const hasScrollbar = el ? el.scrollHeight > el.clientHeight : false;
    const avail = gridWidth - (hasScrollbar ? 0 : SCROLLBAR_W);

    // Abrunden statt runden: ein aufgerundetes Prozent macht die Zeile breiter
    // als das Grid — dann bricht sie um, statt zu passen.
    let z = Math.min(1, Math.max(0.2, Math.floor(((avail - chrome) / totalWidth) * 100) / 100));
    // Gegenprobe mit exakt der Packbedingung aus rowZooms: solange die Zeile
    // rechnerisch ueberlaeuft, ein Prozent zurueck. Haelt den Knopf auch dann
    // ehrlich, wenn das Karten-Chrom mal um ein Pixel danebenliegt.
    while (z > 0.2 && totalWidth * z + chrome > avail) {
      z = Math.round((z - 0.01) * 100) / 100;
    }
    setZoom(z);
  }, [devices, gridWidth]);

  // Auto-Fit: bei jedem Wechsel von Grid oder verfuegbarer Breite neu
  // einpassen. `fitZoom` haengt genau an diesen beiden — der Effekt laeuft
  // also, sobald der ResizeObserver die neue Breite gemeldet hat (Panel oder
  // Editor auf/zu, Fenster skaliert) oder das Set ersetzt wurde. `zoom` ist
  // bewusst keine Abhaengigkeit: sonst liefe der Effekt gegen sich selbst.
  useEffect(() => {
    if (!autoFit || devices.length === 0 || gridWidth <= 0) return;
    fitZoom();
  }, [autoFit, devices, gridWidth, fitZoom]);

  const autoFitRef = useRef(autoFit);
  autoFitRef.current = autoFit;

  /** Manueller Zoom (Knoepfe, Cmd+Wheel) — schaltet die Automatik ab. */
  const setZoomManual = useCallback((next: number) => {
    if (autoFitRef.current) {
      setAutoFit(false);
      void saveSettings({ autoFit: false });
    }
    setZoom(next);
  }, []);

  const toggleStartFullscreen = useCallback(() => {
    setStartFullscreen((on) => {
      void saveSettings({ startFullscreen: !on });
      return !on;
    });
  }, []);

  /** Auto-Fit-Knopf: an -> sofort einpassen (der Effekt oben uebernimmt). */
  const toggleAutoFit = useCallback(() => {
    const next = !autoFitRef.current;
    setAutoFit(next);
    void saveSettings({ autoFit: next });
  }, []);

  // Panel-Splitter: Editor (links) und Feedback-Panel (rechts) per Ziehen
  // breiter/schmaler. Waehrend des Zugs schluckt `body--resizing` die
  // iframe-Pointer-Events; am Ende wird die finale Breite persistiert.
  const [resizing, setResizing] = useState(false);
  const startResize = useCallback(
    (which: 'editor' | 'panel') => (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = which === 'editor' ? editorWidthRef.current : panelWidthRef.current;
      setResizing(true);
      const onMove = (ev: PointerEvent) => {
        // Das Panel liegt rechts — nach links ziehen vergroessert es.
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

  // Cmd/Ctrl+Wheel (inkl. Trackpad-Pinch) zoomt das Grid. Nativer Listener mit
  // passive:false — React haengt wheel sonst passiv an, dann greift kein
  // preventDefault.
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

      // Alle Marker (auch Element-Picker) liegen nur auf dem Device, auf dem
      // sie gesetzt wurden — kein Spiegeln auf andere Viewports mehr.
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
      persist(replaceItems(updated), 'Notiz speichern');
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
   * Verschobene Markierung uebernehmen. Nur eigene Eintraege — importiertes
   * Feedback bleibt, wo es der Ersteller gesetzt hat (das Overlay bietet
   * fremde Marker erst gar nicht zum Ziehen an).
   */
  const moveShape = useCallback(
    (_uid: string, shapeId: string, dx: number, dy: number) => {
      const existing = feedback.find((item) => item.shape.id === shapeId);
      if (!existing || !isMine(existing)) return;
      const updated: FeedbackItem = { ...existing, shape: translateShape(existing.shape, dx, dy) };
      setFeedback((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      persist(replaceItem(updated), 'Markierung verschieben');
    },
    [feedback],
  );

  /**
   * Neue Groesse einer Box uebernehmen. Wie beim Verschieben nur eigene
   * Eintraege; das Overlay bietet fremde Marker erst gar nicht mit Griffen an.
   */
  const resizeShape = useCallback(
    (_uid: string, shapeId: string, box: { x1: number; y1: number; x2: number; y2: number }) => {
      const existing = feedback.find((item) => item.shape.id === shapeId);
      if (!existing || !isMine(existing)) return;
      const shape = existing.shape;
      if (shape.tool !== 'rect' && shape.tool !== 'ellipse') return;
      const updated: FeedbackItem = { ...existing, shape: { ...shape, ...box } };
      setFeedback((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      persist(replaceItem(updated), 'Markierung skalieren');
    },
    [feedback],
  );

  /**
   * Zwischenschritt eines Zugs: nur der UI-State wandert mit, gespeichert
   * wird erst beim Loslassen (`commitShape`) — sonst schriebe jede
   * Mausbewegung in den Store.
   */
  const nudgeShape = useCallback((shapeId: string, dx: number, dy: number) => {
    setFeedback((current) =>
      current.map((item) =>
        item.shape.id === shapeId ? { ...item, shape: translateShape(item.shape, dx, dy) } : item,
      ),
    );
  }, []);

  /** Aktuellen Stand einer Markierung speichern (nach Zug oder Zahleneingabe). */
  const commitShape = useCallback((shapeId: string) => {
    const item = feedbackRef.current.find((i) => i.shape.id === shapeId);
    if (item) persist(replaceItem(item), 'Markierung speichern');
  }, []);

  /**
   * Abstand eines Linienpaars setzen. Die zweite Linie behaelt ihre Richtung
   * (nach unten/rechts, solange keine andere gezogen wurde); `null` macht
   * wieder eine einzelne Linie daraus. Nur UI-State — `commitShape` schreibt.
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

  // Notiz/Text eines Eintrags direkt im Panel aendern oder ergaenzen.
  const editItemText = useCallback(
    (itemId: string, text: string) => {
      const existing = feedback.find((item) => item.id === itemId);
      if (!existing) return;
      applyItemText(existing, text.trim());
    },
    [feedback, applyItemText],
  );

  /** „Alles loeschen" fragt erst nach — der Schritt ist nicht umkehrbar. */
  const [confirmClear, setConfirmClear] = useState(false);
  const askClearAll = useCallback(() => setConfirmClear(true), []);

  const clearAllShapes = useCallback(() => {
    setFeedback((current) => current.filter((item) => item.url !== activeUrl));
    persist(clearUrl(activeUrl), 'Feedback loeschen');
  }, [activeUrl]);

  /**
   * Preset-Ids der gerade sichtbaren Viewports — im Vollbild nur der
   * Vollbild-Frame, sonst die Karten des Grids. Das Panel dimmt damit alles,
   * was zu einer anderen Groesse gehoert.
   */
  const activePresetIds = useMemo(
    () => new Set(fullscreen ? [FULLSCREEN_ID] : devices.map((d) => d.id)),
    [fullscreen, devices],
  );

  // Panel-Klick: zum Device springen — oder es ins Grid holen, falls entfernt.
  const focusDevice = useCallback(
    (presetId: string) => {
      // Vollbild-Feedback lebt auf dem Vollbild-Frame — dorthin wechseln.
      if (presetId === FULLSCREEN_ID) {
        setFullscreen(true);
        return;
      }
      // Umgekehrt: Grid-Feedback braucht das Grid — Vollbild verlassen.
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
  const markersVisibleRef = useRef(markersVisible);
  markersVisibleRef.current = markersVisible;

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
            if (win) scrollFrameToTarget(win, target);
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
      // Eintrag eines Grid-Devices, waehrend das Vollbild laeuft: erst
      // zurueck ins Grid, dann (nach dem Mount der Frames) anfliegen.
      if (fullscreenRef.current) {
        setFullscreen(false);
        window.setTimeout(() => focusItemNowRef.current(item), 320);
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
          if (win) scrollFrameToTarget(win, target);
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
  // Ref-Spiegel: der verzoegerte Nachlauf nach dem Vollbild-Wechsel ruft die
  // aktuelle Fassung auf (die Frames stehen dann bereits).
  const focusItemNowRef = useRef(focusItemNow);
  focusItemNowRef.current = focusItemNow;

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
  // Zeichenmodus), 1-9 waehlt ein Werkzeug — die Ziffern folgen der Leiste,
  // „1" ist immer das erste Werkzeug darin.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ist das Hilfe-Overlay offen, gehoeren alle Tasten ihm: Esc schliesst
      // es, alles andere wird geschluckt (kein Werkzeugwechsel im Hintergrund).
      if (helpOpenRef.current) {
        if (e.key === 'Escape') setHelpOpen(false);
        return;
      }
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
        // Esc beendet nur den Zeichenmodus. Das Vollbild bleibt — es zu
        // verlassen ist ein Moduswechsel, der ueber den Knopf in der Leiste
        // laeuft, nicht ueber eine Taste, die man beim Zeichnen staendig drueckt.
        if (!typing && toolRef.current !== 'interact') selectTool('interact');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (!annotating) return; // Undo der Seite nicht kapern
        e.preventDefault();
        undoShape();
        return;
      }
      if (typing) return;
      // „?" (Shift+/) oeffnet das Shortcuts-Overlay.
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      // Browser-Shortcuts (Cmd/Ctrl+1 = Tab-Wechsel, Alt+Ziffer) nicht kapern.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // „I" schaltet den Schrift-Inspector.
      if (e.key === 'i' || e.key === 'I') {
        toggleInspector();
        return;
      }
      const idx = Number(e.key) - 1;
      const next = DEFAULT_TOOL_ORDER[idx];
      if (next) selectTool(next);
    };

    shortcutKeyRef.current = onKey;
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [annotating, undoShape, selectTool, toggleInspector]);

  // Nur Feedback der aktuellen Domain im Hauptbereich — fremde Domains
  // bekommen im Panel einen eigenen, einklappbaren Bereich. Die Badges
  // zaehlen nur offene (nicht abgehakte) Eintraege. Memoisiert: das Panel
  // resettet seinen Share-/Export-Status an der Identitaet von `items`.
  const domainFeedback = useMemo(
    () => feedback.filter((item) => sameOrigin(item.url, activeUrl)),
    [feedback, activeUrl],
  );
  const otherDomainFeedback = useMemo(
    () => feedback.filter((item) => !sameOrigin(item.url, activeUrl)),
    [feedback, activeUrl],
  );
  const feedbackCount = domainFeedback.filter((item) => !item.done).length;

  // Neue Markierung im Vollbild bei zugeklapptem Panel: beim allerersten Mal
  // faehrt die Liste auf (dann sieht man, wo die Eintraege landen), danach
  // pulst nur noch der Knopf.
  const lastCount = useRef(feedbackCount);
  useEffect(() => {
    const grew = feedbackCount > lastCount.current;
    lastCount.current = feedbackCount;
    if (!grew || !fullscreenRef.current || feedbackOpen) return;
    if (fsPanelShown.current) {
      pulseFab();
    } else {
      fsPanelShown.current = true;
      setFeedbackOpen(true);
    }
  }, [feedbackCount, feedbackOpen, pulseFab]);
  const pageFeedbackCount = feedback.filter((item) => item.url === activeUrl).length;

  // Das Panel kennt das Vollbild-Pseudo-Device als eigene Gruppe.
  const panelPresets = useMemo<readonly DevicePreset[]>(
    () => [...presets, fsDevice],
    [presets, fsDevice],
  );

  return (
    <div
      className={`root${fullscreen ? ' root--fs' : ''}${panelClosing ? ' root--panel-closing' : ''}`}
      data-theme={theme}
    >
      {!fullscreen && (
        <Toolbar
          src={activeUrl}
          zoom={zoom}
          presets={presets}
          editorOpen={editorOpen}
          sync={syncPrefs}
          feedbackOpen={feedbackOpen}
          feedbackCount={feedbackCount}
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
          startFullscreen={startFullscreen}
          paletteColorCount={paletteColorCount}
          onSetPaletteColorCount={changePaletteColorCount}
          onToggleStartFullscreen={toggleStartFullscreen}
          onReload={reloadFrames}
          onToggleEditor={() => setEditorOpen((v) => !v)}
          onToggleInspector={toggleInspector}
          onToggleSync={toggleSync}
          onToggleFeedback={() => {
            setFeedbackOpen((open) => {
              // Zuklappen beendet auch den Zeichenmodus — sonst bliebe ein
              // Werkzeug ohne sichtbare Werkzeugleiste scharf.
              if (open) setTool('interact');
              return !open;
            });
          }}
          onSetTheme={changeTheme}
          onHelp={() => setHelpOpen(true)}
          onTour={restartTour}
          onFullscreen={() => setFullscreen(true)}
          onClose={() => void handleClose()}
        />
      )}

      <div className={`loadbar${navigating ? ' loadbar--active' : ''}`} />

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
              previewBlocked={frameBlocked}
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

        {feedbackOpen && (
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
              markersVisible={markersVisible}
              width={panelWidth}
              onToggleMarkers={() => setMarkersVisible((v) => !v)}
              highlight={panelHighlight}
              onJump={focusDevice}
              onJumpItem={focusItem}
              onPreviewItem={previewItem}
              onEditItem={editItemText}
              onNavigate={handleNavigate}
              onDelete={removeShape}
              onToggleDone={toggleDone}
              onClearAll={askClearAll}
              onBuildShareLink={buildShareLink}
              onExportScreenshots={exportScreenshots}
              onShowShortcuts={() => setHelpOpen(true)}
              onClose={closeFeedback}
            />
          </>
        )}
      </div>

      {fullscreen && (
        <>
          <FeedbackBar
            tool={tool}
            color={color}
            colors={paletteColors}
            order={DEFAULT_TOOL_ORDER}
            placement={toolbarPlacement}
            onPlace={placeToolbar}
            canUndo={pageFeedbackCount > 0}
            onTool={selectTool}
            onColor={setColor}
            onUndo={undoShape}
            onClear={askClearAll}
            onExit={() => setFullscreen(false)}
          />
          <button
            // Der Zaehler als key startet die Puls-Animation auch dann neu,
            // wenn sie noch laeuft.
            key={fabPulse}
            className={`fs-fab${fabPulse > 0 && !feedbackOpen ? ' fs-fab--pulse' : ''}`}
            title={feedbackOpen ? 'Hide feedback list' : 'Show feedback list'}
            aria-pressed={feedbackOpen}
            onClick={() => (feedbackOpen ? closeFeedback() : setFeedbackOpen(true))}
          >
            <IconMessage size={22} />
            {feedbackCount > 0 && <span className="fs-fab__badge">{feedbackCount}</span>}
          </button>
        </>
      )}

      {feedbackOpen && !fullscreen && (
        <FeedbackBar
          tool={tool}
          color={color}
          colors={paletteColors}
          order={DEFAULT_TOOL_ORDER}
          placement={DOCKED_PLACEMENT}
          movable={false}
          onPlace={() => {}}
          canUndo={pageFeedbackCount > 0}
          onTool={selectTool}
          onColor={setColor}
          onUndo={undoShape}
          onClear={askClearAll}
          onExit={() => {
            // Werkzeugleiste und Panel sind ein Zustand — das X beendet beides
            // und schaltet zurueck ins Interagieren.
            setFeedbackOpen(false);
            setTool('interact');
          }}
          exitIcon={<IconClose />}
          exitTitle="Close feedback tools"
        />
      )}

      {paletteAt && (
        <AnnotationPalette
          at={paletteAt}
          tool={tool}
          color={color}
          colors={paletteColors}
          order={DEFAULT_TOOL_ORDER}
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

      {/* Die Tour zeigt auf Elemente der Grid-Ansicht; im Vollbild gibt es
          weder Toolbar noch Karten-Titelleisten, dort pausiert sie und laeuft
          beim Zurueckwechseln am selben Schritt weiter. */}
      {tourStep !== null && !fullscreen && !helpOpen && (
        <Tour
          root={shadowRoot}
          state={tourState}
          index={tourStep}
          onIndex={setTourStep}
          onClose={closeTour}
        />
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

      {helpOpen && <ShortcutsOverlay order={DEFAULT_TOOL_ORDER} onClose={() => setHelpOpen(false)} />}

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
  );
}
