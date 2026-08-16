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
import { useTip } from './Tooltip';
import {
  IconCheck,
  IconClose,
  IconCode,
  IconCompass,
  IconDots,
  IconExpand,
  IconEye,
  IconEyeOff,
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

/** Individually switchable sync areas (toolbar menu). */
export interface SyncPrefs {
  scroll: boolean;
  hover: boolean;
  /** Clicks, entries and the navigation alignment. */
  input: boolean;
}

export type SyncKey = keyof SyncPrefs | 'all';

interface Props {
  src: string;
  zoom: number;
  /** Built-in plus custom presets — the menu list. */
  presets: readonly DevicePreset[];
  editorOpen: boolean;
  sync: SyncPrefs;
  feedbackOpen: boolean;
  feedbackCount: number;
  /**
   * View switch: is your own work on the preview — markings drawn and saved
   * changes applied? The state is global (it applies to the whole grid), which
   * is why the switch sits in the bar and not in the feedback panel — there it
   * would be hidden behind something collapsible.
   */
  editsShown: boolean;
  /** Counter: every increment restarts the hint pulse on the eye. */
  editsHint?: number;
  /** There is anything on this page at all — otherwise no switch. */
  hasEdits: boolean;
  onToggleEdits: () => void;
  /** A drawing tool is active — the feedback button then lights up with it. */
  annotating: boolean;
  /** The font inspector is active (hovering shows font info). */
  inspecting: boolean;
  /**
   * This page's framing headers are currently being removed. Make it visible
   * for as long as it runs — otherwise it would be a silent change.
   */
  framingBypassed?: boolean;
  /** The page forbids embedding and is currently running without the change. */
  framingBlocked?: boolean;
  /** End the change and withdraw this page's permission. */
  onRevokeFraming?: () => void;
  /** Switch the change on after the fact (out of the blocked state). */
  onEnableFraming?: () => void;
  /** Current UI theme (system/light/dark). */
  theme: ThemePref;
  /** The user's own saved grid layouts (device sets). */
  workspaces: readonly Workspace[];
  onNavigate: (url: string) => void;
  onAddDevice: (presetId: string) => void;
  /** Several presets at once (quick set). */
  onAddBundle: (presetIds: string[]) => void;
  /** Creates a custom preset (persisted) and puts it on the grid. */
  onAddCustomDevice: (name: string, width: number, height: number) => void;
  onRemoveCustomPreset: (presetId: string) => void;
  /** Replaces the grid with a saved layout. */
  onApplyWorkspace: (ws: Workspace) => void;
  /** Saves the current grid as a named layout. */
  onSaveWorkspace: (name: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onZoom: (zoom: number) => void;
  /** Auto-fit is on: the zoom keeps every card in one row. */
  autoFit: boolean;
  /** Switches auto-fit on and off (on fits immediately). */
  onToggleAutoFit: () => void;
  /** Fits the zoom once — every card into one row. */
  onFit: () => void;
  /** Inkspect starts in full window mode. */
  startFullscreen: boolean;
  onToggleStartFullscreen: () => void;
  /** How many feedback colours the tool bar offers (2 or 4). */
  paletteColorCount: number;
  onSetPaletteColorCount: (count: number) => void;
  onReload: () => void;
  onToggleEditor: () => void;
  /** Switches the font inspector on and off. */
  onToggleInspector: () => void;
  /** Toggles one sync area — 'all' for everything on or off. */
  onToggleSync: (key: SyncKey) => void;
  onToggleFeedback: () => void;
  onSetTheme: (theme: ThemePref) => void;
  /** Opens the shortcuts/help overlay. */
  onHelp: () => void;
  /** Starts the guided beginner tour again from the top. */
  onTour: () => void;
  /** Show hints at all. */
  hintsEnabled: boolean;
  onToggleHints: (on: boolean) => void;
  /** Switches to full window mode (the page across the whole window). */
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

/**
 * How long the entrance runs — the last button starts at .34 s and takes
 * .28 s (see `.toolbar--intro` in styles.ts). Generously rounded up: the class
 * has to outlast the animation, or the bar would jump at the end.
 */
const INTRO_MS = 700;

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
  editsShown,
  editsHint = 0,
  hasEdits,
  onToggleEdits,
  annotating,
  inspecting,
  framingBypassed = false,
  framingBlocked = false,
  onRevokeFraming,
  onEnableFraming,
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
  onFit,
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
  onTour,
  hintsEnabled,
  onToggleHints,
  onFullscreen,
  onClose,
}: Props) {
  // The domain is fixed (cross-origin is blocked anyway) — only the path is
  // editable. A pasted full URL of the same origin is reduced to its path;
  // foreign origins reach onNavigate unchanged, which shows the readable
  // notice.
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

  const tip = useTip();
  const [draft, setDraft] = useState(() => pathOf(src));
  useEffect(() => {
    // Navigation inside the frames (links, SPA routing) pulls the display along.
    setDraft(pathOf(src));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const submitDraft = () => {
    const value = draft.trim();
    if (!value) return;
    if (/^https?:\/\//i.test(value)) {
      onNavigate(value); // full URL — onNavigate validates the origin
      return;
    }
    onNavigate(origin + (value.startsWith('/') ? value : `/${value}`));
  };

  const [menuOpen, setMenuOpen] = useState(false);
  // The path is mostly display-only — it becomes editable on a click on the
  // chip. That keeps the toolbar quiet without hiding navigation.
  const [pathEditing, setPathEditing] = useState(false);
  // A single "More" menu bundles every secondary function (page tools, sync,
  // theme, shortcuts) — which keeps the toolbar tidy.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Inline field for "save the current grid as a set".
  const [wsName, setWsName] = useState('');
  const submitWorkspace = () => {
    if (!wsName.trim()) return;
    onSaveWorkspace(wsName);
    setWsName('');
  };

  const syncAll = sync.scroll && sync.hover && sync.input;

  // Inline form for custom viewport sizes in the add-device menu.
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

  // Live preview of the aspect ratio while typing: the longer edge is
  // normalised to 42px and the ratio shown reduced.
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

  /**
   * Entrance: runs once whenever the bar appears — when the tool is opened,
   * and on the way back from full window mode, where it really does come back
   * from the window edge. Afterwards the class goes, so that later changes
   * inside the bar stay quiet.
   */
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setIntro(false), INTRO_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <header className={`toolbar${intro ? ' toolbar--intro' : ''}`}>
      <span className="toolbar__brand">
        Ink<em>spect</em>
      </span>

      {pathEditing ? (
        <form
          className="omnibox"
          onSubmit={(e) => {
            e.preventDefault();
            submitDraft();
            setPathEditing(false);
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
            onBlur={() => setPathEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // Do not fall through to the global Esc handler.
                e.stopPropagation();
                setDraft(pathOf(src));
                setPathEditing(false);
              }
            }}
            autoFocus
            spellCheck={false}
            aria-label="Path"
          />
        </form>
      ) : (
        <button
          type="button"
          className="toolbar__path"
          onClick={() => setPathEditing(true)}
          title={`${src} — click to edit the path`}
        >
          <span className="omnibox__icon">
            <IconGlobe size={15} />
          </span>
          <span className="omnibox__origin">{host}</span>
          <span className="toolbar__path-value">{draft}</span>
        </button>
      )}

      <span className="toolbar__sep" />

      {/* Core actions — labelled, so it is clear at a glance what they do. */}
      <div className="toolbar__group">
        <button
          className={`toolbar__btn toolbar__feedback${feedbackOpen || annotating ? ' icon-btn--active' : ''}`}
          onClick={onToggleFeedback}
          aria-pressed={feedbackOpen}
          {...tip('Annotation tools and the feedback list', { prefer: 'below' })}
        >
          <IconMessage size={16} />
          Feedback
          {feedbackCount > 0 && <span className="toolbar__count">{feedbackCount}</span>}
        </button>

        {/* One switch for the whole view, next to feedback rather than in the
            panel: it acts on the whole grid, and in the panel it was hidden
            behind something collapsible.

            Markings and applied changes were two buttons and answered one
            question — am I looking at my version or at the page as it stands?
            Four combinations, of which only two were ever meant.

            It appears once there is something to switch; turned off it stays
            even after the last entry is gone, or there would be no way back to
            your own view. */}
        {(hasEdits || !editsShown) && (
          <button
            // The counter as the key restarts the hint animation even while it
            // is still running.
            key={editsHint}
            className={`toolbar__btn toolbar__toggle${editsShown ? ' is-on' : ''}${
              editsHint > 0 ? ' toolbar__toggle--hint' : ''
            }`}
            // Anchor for the `edits-hidden` and `first-style-change` hints.
            data-hint="edits"
            aria-pressed={editsShown}
            {...tip(
              editsShown
                ? 'Your markings and changes are shown — click for the original'
                : 'Showing the original — click to bring your edits back',
              { prefer: 'below' },
            )}
            onClick={onToggleEdits}
          >
            {editsShown ? <IconEye size={16} /> : <IconEyeOff size={16} />}
            My edits
            <span className="toolbar__state">{editsShown ? 'On' : 'Off'}</span>
          </button>
        )}
      </div>

      <span className="toolbar__sep" />

      {/* Grid: add devices, fit them, zoom. */}
      <div className="toolbar__group">
        <div className="add-device">
          <button
            className={`toolbar__btn${menuOpen ? ' icon-btn--active' : ''}`}
            // Anchor for `device-removed` and `first-workspace`.
            data-hint="devices"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            {...tip('Add device', { prefer: 'below' })}
          >
            <IconPlus size={16} />
            Devices
          </button>

          {menuOpen && (
            <>
              {/* A transparent backdrop catches outside clicks — more reliable
                  than document listeners across the shadow tree. */}
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
                        {...tip('Delete this custom size')}
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
                      {...tip('Replace the grid with this set')}
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
                      {...tip('Delete this set')}
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
                      {...tip('Save current grid as a set')}
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

      </div>

      {framingBypassed && onRevokeFraming && (
        <>
          <span className="toolbar__sep" />
          <button
            className="toolbar__flag"
            onClick={onRevokeFraming}
            {...tip(
              'This page blocks being shown inside another page. Inkspect has lifted that block for this domain, in this tab — which also turns off the page’s protection against injected scripts. Click to put the block back and reload.',
              { prefer: 'below', wide: true },
            )}
          >
            Protection off in preview
          </button>
        </>
      )}
      {!framingBypassed && framingBlocked && onEnableFraming && (
        <>
          <span className="toolbar__sep" />
          <button
            className="toolbar__flag toolbar__flag--muted"
            onClick={onEnableFraming}
            {...tip(
              'This page blocks being shown inside another page, so the device frames stay empty. Click to lift the block for this domain, in this tab, while Inkspect is open.',
              { prefer: 'below', wide: true },
            )}
          >
            Preview blocked — show anyway
          </button>
        </>
      )}

      <span className="toolbar__sep" />

      {/* Full window is the most frequent mode change — a fixed place, not a menu. */}
      <div className="toolbar__group">
        <button
          className="icon-btn"
          // Anchor for `fullscreen-left`.
          data-hint="fullscreen"
          onClick={onFullscreen}
          {...tip('Full window mode', { prefer: 'below' })}
        >
          <IconExpand />
        </button>
      </div>

      <span className="toolbar__sep" />

      {/* "More": every secondary function labelled in one place — keeps the
          toolbar tidy and makes the meaning immediately clear. */}
      <div className="toolbar__group">
        <span className="toolbar__menu">
          <button
            className={`icon-btn toolbar__more${moreMenuOpen ? ' icon-btn--active' : ''}`}
            onClick={() => setMoreMenuOpen((v) => !v)}
            aria-expanded={moreMenuOpen}
            {...tip('More', { prefer: 'below' })}
          >
            <IconDots />
          </button>
          {moreMenuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMoreMenuOpen(false)} />
              <div className="menu menu--wide" role="menu">
                {/* View: moved here out of the toolbar — day to day this runs
                    over auto-zoom or Cmd/Ctrl+scroll. */}
                <div className="menu__title">View</div>
                <button
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    onFit();
                    setMoreMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconFit size={15} />
                  </span>
                  <span className="menu__item-name">Fit devices to width</span>
                </button>
                <button
                  className="menu__item"
                  role="menuitemcheckbox"
                  aria-checked={autoFit}
                  {...tip('Keep devices fitted to width')}
                  onClick={onToggleAutoFit}
                >
                  <span className="menu__item-name">Auto zoom</span>
                  <span className="menu__check">{autoFit && <IconCheck size={14} />}</span>
                </button>
                <div className="menu__inline menu__zoom">
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
                </div>
                <div className="menu__empty">Cmd/Ctrl + scroll zooms the grid</div>
                <button
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    onReload();
                    setMoreMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconReload size={15} />
                  </span>
                  <span className="menu__item-name">Reload previews</span>
                </button>

                <div className="menu__title menu__title--sep">Tools</div>
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
                  {...tip('Open Inkspect in full window mode from now on')}
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
                    {...tip(`Offer ${count} colours in the feedback tool bar`)}
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
                <button
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    onTour();
                    setMoreMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconCompass size={15} />
                  </span>
                  <span className="menu__item-name">{'Show tips again'}</span>
                </button>
                {/* The off switch for the hints sits right next to the one that
                    turns them back on — whoever looks for one looks for the
                    other in the same place. */}
                <button
                  className="menu__item"
                  role="menuitemcheckbox"
                  aria-checked={hintsEnabled}
                  onClick={() => onToggleHints(!hintsEnabled)}
                >
                  <span className="menu__item-name">{'Tips while you work'}</span>
                  <span className="menu__check">{hintsEnabled && <IconCheck size={14} />}</span>
                </button>
              </div>
            </>
          )}
        </span>

        <button
          className="icon-btn"
          onClick={onClose}
          {...tip('Close Inkspect', { prefer: 'below' })}
        >
          <IconClose />
        </button>
      </div>
    </header>
  );
}
