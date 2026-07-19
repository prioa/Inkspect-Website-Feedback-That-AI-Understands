import { useEffect, useState, type JSX } from 'react';
import {
  DEVICE_BUNDLES,
  isCustomPreset,
  SIZE_MAX,
  SIZE_MIN,
  type DevicePreset,
  type Workspace,
} from '@/lib/devices';
import type { ThemePref } from '@/lib/settings';
import { ANNOTATION_COLORS } from '@/lib/annotations';
import {
  IconCheck,
  IconClose,
  IconCode,
  IconDots,
  IconExpand,
  IconFit,
  IconGlobe,
  IconHelp,
  IconInspector,
  IconLayers,
  IconMessage,
  IconMinus,
  IconMonitor,
  IconMoon,
  IconPhone,
  IconPlus,
  IconReload,
  IconSave,
  IconSun,
  IconTablet,
  IconThemeAuto,
  IconTrash,
} from './icons';

/** Einzeln schaltbare Sync-Bereiche (Toolbar-Menue). */
export interface SyncPrefs {
  scroll: boolean;
  hover: boolean;
  /** Klicks, Eingaben und der Navigations-Angleich. */
  input: boolean;
}

export type SyncKey = keyof SyncPrefs | 'all';

interface Props {
  src: string;
  zoom: number;
  /** Eingebaute + eigene Presets — die Menueliste. */
  presets: readonly DevicePreset[];
  editorOpen: boolean;
  sync: SyncPrefs;
  feedbackOpen: boolean;
  feedbackCount: number;
  /** Es ist ein Zeichenwerkzeug aktiv — der Feedback-Knopf leuchtet dann mit. */
  annotating: boolean;
  /** Der Schrift-Inspector ist aktiv (Hover zeigt Font-Infos). */
  inspecting: boolean;
  /** Aktuelles UI-Theme (System/Hell/Dunkel). */
  theme: ThemePref;
  /** Eigene gespeicherte Grid-Layouts (Device-Sets). */
  workspaces: readonly Workspace[];
  onNavigate: (url: string) => void;
  onAddDevice: (presetId: string) => void;
  /** Mehrere Presets auf einmal (Schnell-Set). */
  onAddBundle: (presetIds: string[]) => void;
  /** Legt ein eigenes Preset an (persistiert) und stellt es ins Grid. */
  onAddCustomDevice: (name: string, width: number, height: number) => void;
  onRemoveCustomPreset: (presetId: string) => void;
  /** Ersetzt das Grid durch ein gespeichertes Layout. */
  onApplyWorkspace: (ws: Workspace) => void;
  /** Speichert das aktuelle Grid als benanntes Layout. */
  onSaveWorkspace: (name: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onZoom: (zoom: number) => void;
  /** Auto-Fit ist an: der Zoom haelt alle Karten in einer Zeile. */
  autoFit: boolean;
  /** Schaltet Auto-Fit an/aus (an passt sofort ein). */
  onToggleAutoFit: () => void;
  /** Inkspect startet im Vollbild-Modus. */
  startFullscreen: boolean;
  onToggleStartFullscreen: () => void;
  /** Wie viele Feedback-Farben die Werkzeugleiste anbietet (2 oder 4). */
  paletteColorCount: number;
  onSetPaletteColorCount: (count: number) => void;
  onReload: () => void;
  onToggleEditor: () => void;
  /** Schaltet den Schrift-Inspector an/aus. */
  onToggleInspector: () => void;
  /** Schaltet einen Sync-Bereich um — 'all' fuer alles an/aus. */
  onToggleSync: (key: SyncKey) => void;
  onToggleFeedback: () => void;
  onSetTheme: (theme: ThemePref) => void;
  /** Oeffnet das Shortcuts-/Hilfe-Overlay. */
  onHelp: () => void;
  /** Wechselt in den Vollbild-Modus (Seite ueber das ganze Fenster). */
  onFullscreen: () => void;
  onClose: () => void;
}

const THEME_ROWS: { key: ThemePref; label: string; icon: JSX.Element }[] = [
  { key: 'system', label: 'System', icon: <IconThemeAuto size={15} /> },
  { key: 'light', label: 'Light', icon: <IconSun size={15} /> },
  { key: 'dark', label: 'Dark', icon: <IconMoon size={15} /> },
];

export function deviceIcon(width: number, size?: number) {
  if (width < 600) return <IconPhone size={size} />;
  if (width < 1024) return <IconTablet size={size} />;
  return <IconMonitor size={size} />;
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 1;
const ZOOM_STEP = 0.05;

const SYNC_ROWS: { key: keyof SyncPrefs; label: string }[] = [
  { key: 'scroll', label: 'Scroll' },
  { key: 'hover', label: 'Hover' },
  { key: 'input', label: 'Clicks & inputs' },
];

export function Toolbar({
  src,
  zoom,
  presets,
  editorOpen,
  sync,
  feedbackOpen,
  feedbackCount,
  annotating,
  inspecting,
  theme,
  workspaces,
  onNavigate,
  onAddDevice,
  onAddBundle,
  onAddCustomDevice,
  onRemoveCustomPreset,
  onApplyWorkspace,
  onSaveWorkspace,
  onDeleteWorkspace,
  onZoom,
  autoFit,
  onToggleAutoFit,
  startFullscreen,
  onToggleStartFullscreen,
  paletteColorCount,
  onSetPaletteColorCount,
  onReload,
  onToggleEditor,
  onToggleInspector,
  onToggleSync,
  onToggleFeedback,
  onSetTheme,
  onHelp,
  onFullscreen,
  onClose,
}: Props) {
  // Die Domain steht fest (Cross-Origin ist ohnehin gesperrt) — editierbar
  // ist nur der Pfad. Eine eingefuegte volle URL derselben Origin wird auf
  // ihren Pfad reduziert; fremde Origins landen unveraendert in onNavigate,
  // das den verstaendlichen Hinweis zeigt.
  const { origin, host } = (() => {
    try {
      const u = new URL(src);
      return { origin: u.origin, host: u.host };
    } catch {
      return { origin: location.origin, host: location.host };
    }
  })();
  const pathOf = (url: string): string => {
    try {
      const u = new URL(url, origin);
      return u.origin === origin ? u.pathname + u.search + u.hash : url;
    } catch {
      return url;
    }
  };

  const [draft, setDraft] = useState(() => pathOf(src));
  useEffect(() => {
    // Navigation in den Frames (Links, SPA-Routing) zieht die Anzeige nach.
    setDraft(pathOf(src));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const submitDraft = () => {
    const value = draft.trim();
    if (!value) return;
    if (/^https?:\/\//i.test(value)) {
      onNavigate(value); // volle URL — onNavigate validiert die Origin
      return;
    }
    onNavigate(origin + (value.startsWith('/') ? value : `/${value}`));
  };

  const [menuOpen, setMenuOpen] = useState(false);
  // Ein einziges „More"-Menue buendelt alle Neben-Funktionen (Seiten-Werkzeuge,
  // Sync, Theme, Shortcuts) — die Toolbar bleibt dadurch aufgeraeumt.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Inline-Feld „aktuelles Grid als Set speichern".
  const [wsName, setWsName] = useState('');
  const submitWorkspace = () => {
    if (!wsName.trim()) return;
    onSaveWorkspace(wsName);
    setWsName('');
  };

  const syncAll = sync.scroll && sync.hover && sync.input;

  // Inline-Form fuer eigene Viewport-Groessen im Add-Device-Menue.
  const [customName, setCustomName] = useState('');
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const customValid = (() => {
    const w = Number(customW);
    const h = Number(customH);
    return w >= SIZE_MIN && w <= SIZE_MAX && h >= SIZE_MIN && h <= SIZE_MAX;
  })();

  const submitCustom = () => {
    if (!customValid) return;
    onAddCustomDevice(customName, Number(customW), Number(customH));
    setCustomName('');
    setCustomW('');
    setCustomH('');
    setMenuOpen(false);
  };

  // Live-Vorschau des Seitenverhaeltnisses waehrend der Eingabe: die groessere
  // Kante wird auf 42px normiert, das Verhaeltnis gekuerzt angezeigt.
  const customPreview = (() => {
    const pw = Number(customW);
    const ph = Number(customH);
    if (!(pw > 0) || !(ph > 0)) return null;
    const scale = 42 / Math.max(pw, ph);
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(pw, ph) || 1;
    return {
      pw,
      ph,
      w: Math.max(5, Math.round(pw * scale)),
      h: Math.max(5, Math.round(ph * scale)),
      ratio: `${pw / g} : ${ph / g}`,
    };
  })();

  const stepZoom = (dir: 1 | -1) => {
    const next = Math.round((zoom + dir * ZOOM_STEP) * 100) / 100;
    onZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  };

  return (
    <header className="toolbar">
      <span className="toolbar__brand">
        Ink<em>spect</em>
      </span>

      <form
        className="omnibox"
        onSubmit={(e) => {
          e.preventDefault();
          submitDraft();
        }}
      >
        <span className="omnibox__icon">
          <IconGlobe size={15} />
        </span>
        <span className="omnibox__origin" title={origin}>
          {host}
        </span>
        <input
          className="omnibox__input"
          value={draft}
          onChange={(e) => setDraft(pathOf(e.target.value))}
          spellCheck={false}
          aria-label="Path"
        />
        <button
          type="button"
          className="icon-btn icon-btn--small omnibox__reload"
          onClick={onReload}
          title="Reload all frames"
        >
          <IconReload size={14} />
        </button>
      </form>

      <span className="toolbar__sep" />

      {/* Kernaktionen — beschriftet, damit auf einen Blick klar ist, was sie tun. */}
      <div className="toolbar__group">
        <button
          className={`toolbar__btn toolbar__feedback${feedbackOpen || annotating ? ' icon-btn--active' : ''}`}
          onClick={onToggleFeedback}
          aria-pressed={feedbackOpen}
          title="Annotation tools and the feedback list (or right-click a preview)"
        >
          <IconMessage size={16} />
          Feedback
          {feedbackCount > 0 && <span className="toolbar__count">{feedbackCount}</span>}
        </button>
      </div>

      <span className="toolbar__sep" />

      {/* Grid: Devices hinzufuegen, einpassen, zoomen. */}
      <div className="toolbar__group">
        <div className="add-device">
          <button
            className={`toolbar__btn${menuOpen ? ' icon-btn--active' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            title="Add device"
          >
            <IconPlus size={16} />
            Devices
          </button>

          {menuOpen && (
            <>
              {/* Transparenter Backdrop faengt Outside-Clicks — zuverlaessiger
                  als document-Listener quer durch den Shadow Tree. */}
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu menu--wide" role="menu">
                <div className="menu__title">Quick sets</div>
                {DEVICE_BUNDLES.map((bundle) => (
                  <button
                    key={bundle.id}
                    className="menu__item"
                    role="menuitem"
                    onClick={() => {
                      onAddBundle(bundle.presetIds);
                      setMenuOpen(false);
                    }}
                  >
                    <span className="menu__item-icon">
                      <IconLayers size={15} />
                    </span>
                    <span className="menu__item-name">{bundle.name}</span>
                    <span className="menu__item-size">{bundle.presetIds.length}</span>
                  </button>
                ))}

                <div className="menu__title menu__title--sep">Add device</div>
                {presets.map((p: DevicePreset) => (
                  <div key={p.id} className="menu__row">
                    <button
                      className="menu__item"
                      role="menuitem"
                      onClick={() => {
                        onAddDevice(p.id);
                        setMenuOpen(false);
                      }}
                    >
                      <span className="menu__item-icon">{deviceIcon(p.width, 15)}</span>
                      <span className="menu__item-name">{p.name}</span>
                      <span className="menu__item-size">
                        {p.width}×{p.height}
                      </span>
                    </button>
                    {isCustomPreset(p.id) && (
                      <button
                        className="icon-btn icon-btn--small icon-btn--danger menu__delete"
                        title="Delete this custom size"
                        onClick={() => onRemoveCustomPreset(p.id)}
                      >
                        <IconClose size={12} />
                      </button>
                    )}
                  </div>
                ))}

                <div className="menu__title menu__title--sep">Saved sets</div>
                {workspaces.length === 0 && (
                  <div className="menu__empty">Save the current grid as a reusable set.</div>
                )}
                {workspaces.map((ws) => (
                  <div key={ws.id} className="menu__row">
                    <button
                      className="menu__item"
                      role="menuitem"
                      title="Replace the grid with this set"
                      onClick={() => {
                        onApplyWorkspace(ws);
                        setMenuOpen(false);
                      }}
                    >
                      <span className="menu__item-icon">
                        <IconLayers size={15} />
                      </span>
                      <span className="menu__item-name">{ws.name}</span>
                      <span className="menu__item-size">{ws.devices.length}</span>
                    </button>
                    <button
                      className="icon-btn icon-btn--small icon-btn--danger menu__delete"
                      title="Delete this set"
                      onClick={() => onDeleteWorkspace(ws.id)}
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                ))}
                <form
                  className="menu__custom"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitWorkspace();
                  }}
                >
                  <div className="menu__inline">
                    <input
                      placeholder="Save current grid as…"
                      value={wsName}
                      spellCheck={false}
                      onChange={(e) => setWsName(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="menu__inline-add"
                      disabled={!wsName.trim()}
                      title="Save current grid"
                    >
                      <IconSave size={13} />
                    </button>
                  </div>
                </form>

                <div className="menu__title menu__title--sep">Custom size</div>
                <form
                  className="menu__custom"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitCustom();
                  }}
                >
                  <input
                    className="menu__custom-name"
                    placeholder="Name (optional)"
                    value={customName}
                    spellCheck={false}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                  <div className="menu__custom-size">
                    <input
                      placeholder="Width"
                      inputMode="numeric"
                      value={customW}
                      onChange={(e) => setCustomW(e.target.value.replace(/\D/g, ''))}
                    />
                    <span>×</span>
                    <input
                      placeholder="Height"
                      inputMode="numeric"
                      value={customH}
                      onChange={(e) => setCustomH(e.target.value.replace(/\D/g, ''))}
                    />
                    <button type="submit" className="menu__custom-add" disabled={!customValid}>
                      <IconPlus size={13} />
                    </button>
                  </div>
                  {customPreview && (
                    <div className="menu__preview">
                      <div className="menu__preview-frame">
                        <span
                          className="menu__preview-box"
                          style={{ width: customPreview.w, height: customPreview.h }}
                        />
                      </div>
                      <div className="menu__preview-meta">
                        <strong>
                          {customPreview.pw}×{customPreview.ph}
                        </strong>
                        <br />
                        {customPreview.ratio}
                      </div>
                    </div>
                  )}
                </form>
              </div>
            </>
          )}
        </div>

        <div className="zoomer" title="Zoom">
          <button
            className="icon-btn icon-btn--small"
            onClick={() => stepZoom(-1)}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Zoom out"
          >
            <IconMinus size={14} />
          </button>
          <span className="zoomer__value">{Math.round(zoom * 100)}%</span>
          <button
            className="icon-btn icon-btn--small"
            onClick={() => stepZoom(1)}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Zoom in"
          >
            <IconPlus size={14} />
          </button>
          <button
            className={`icon-btn icon-btn--small${autoFit ? ' icon-btn--active' : ''}`}
            onClick={onToggleAutoFit}
            aria-pressed={autoFit}
            aria-label="Auto zoom — keep devices fitted to width"
            title={
              autoFit
                ? 'Auto zoom is on — devices stay fitted to width. Click to turn off.'
                : 'Auto zoom is off — click to fit devices to width and keep them fitted.'
            }
          >
            <IconFit size={14} />
          </button>
        </div>
      </div>

      <span className="toolbar__sep" />

      {/* Vollbild ist der haeufigste Moduswechsel — fester Platz statt Menue. */}
      <div className="toolbar__group">
        <button
          className="icon-btn"
          onClick={onFullscreen}
          title="Full window mode — the page at full size with the feedback bar"
          aria-label="Full window mode"
        >
          <IconExpand />
        </button>
      </div>

      <span className="toolbar__sep" />

      {/* „More": alle Neben-Funktionen beschriftet an einem Ort — haelt die
          Toolbar aufgeraeumt und macht die Bedeutung sofort klar. */}
      <div className="toolbar__group">
        <span className="toolbar__menu">
          <button
            className={`icon-btn${moreMenuOpen ? ' icon-btn--active' : ''}`}
            onClick={() => setMoreMenuOpen((v) => !v)}
            aria-expanded={moreMenuOpen}
            title="More tools & settings"
          >
            <IconDots />
          </button>
          {moreMenuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMoreMenuOpen(false)} />
              <div className="menu menu--wide" role="menu">
                <button
                  className="menu__item"
                  role="menuitemcheckbox"
                  aria-checked={editorOpen}
                  onClick={() => {
                    onToggleEditor();
                    setMoreMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconCode size={15} />
                  </span>
                  <span className="menu__item-name">CSS editor</span>
                  <span className="menu__check">{editorOpen && <IconCheck size={14} />}</span>
                </button>
                <button
                  className="menu__item"
                  role="menuitemcheckbox"
                  aria-checked={inspecting}
                  onClick={() => {
                    onToggleInspector();
                    setMoreMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconInspector size={15} />
                  </span>
                  <span className="menu__item-name">Font inspector</span>
                  <span className="menu__check">{inspecting && <IconCheck size={14} />}</span>
                </button>
                <button
                  className="menu__item"
                  role="menuitemcheckbox"
                  aria-checked={startFullscreen}
                  title="Open Inkspect in full window mode from now on"
                  onClick={onToggleStartFullscreen}
                >
                  <span className="menu__item-icon">
                    <IconExpand size={15} />
                  </span>
                  <span className="menu__item-name">Start in full window</span>
                  <span className="menu__check">
                    {startFullscreen && <IconCheck size={14} />}
                  </span>
                </button>
                <div className="menu__title menu__title--sep">Sync across frames</div>
                {SYNC_ROWS.map((row) => (
                  <button
                    key={row.key}
                    className="menu__item"
                    role="menuitemcheckbox"
                    aria-checked={sync[row.key]}
                    onClick={() => onToggleSync(row.key)}
                  >
                    <span className="menu__item-name">{row.label}</span>
                    <span className="menu__check">{sync[row.key] && <IconCheck size={14} />}</span>
                  </button>
                ))}
                <button className="menu__item" role="menuitem" onClick={() => onToggleSync('all')}>
                  <span className="menu__item-name">{syncAll ? 'Turn all off' : 'Turn all on'}</span>
                </button>

                <div className="menu__title menu__title--sep">Feedback colours</div>
                {[2, 4].map((count) => (
                  <button
                    key={count}
                    className="menu__item"
                    role="menuitemradio"
                    aria-checked={paletteColorCount === count}
                    title={`Offer ${count} colours in the feedback tool bar`}
                    onClick={() => onSetPaletteColorCount(count)}
                  >
                    <span className="menu__item-icon menu__swatches">
                      {ANNOTATION_COLORS.slice(0, count).map((c) => (
                        <i key={c} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="menu__item-name">{count} colours</span>
                    <span className="menu__check">
                      {paletteColorCount === count && <IconCheck size={14} />}
                    </span>
                  </button>
                ))}

                <div className="menu__title menu__title--sep">Theme</div>
                {THEME_ROWS.map((row) => (
                  <button
                    key={row.key}
                    className="menu__item"
                    role="menuitemradio"
                    aria-checked={theme === row.key}
                    onClick={() => {
                      onSetTheme(row.key);
                      setMoreMenuOpen(false);
                    }}
                  >
                    <span className="menu__item-icon">{row.icon}</span>
                    <span className="menu__item-name">{row.label}</span>
                    <span className="menu__check">{theme === row.key && <IconCheck size={14} />}</span>
                  </button>
                ))}

                <div className="menu__divider" />
                <button
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    onHelp();
                    setMoreMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconHelp size={15} />
                  </span>
                  <span className="menu__item-name">Keyboard shortcuts</span>
                </button>
              </div>
            </>
          )}
        </span>

        <button className="icon-btn" onClick={onClose} title="Close Inkspect">
          <IconClose />
        </button>
      </div>
    </header>
  );
}
