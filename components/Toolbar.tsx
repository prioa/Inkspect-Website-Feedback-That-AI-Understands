import { useState } from 'react';
import { PRESETS, type DevicePreset } from '@/lib/devices';
import {
  IconClose,
  IconCode,
  IconGlobe,
  IconLink,
  IconLinkOff,
  IconMessage,
  IconMinus,
  IconMonitor,
  IconPhone,
  IconPlus,
  IconReload,
  IconTablet,
} from './icons';

interface Props {
  src: string;
  zoom: number;
  editorOpen: boolean;
  syncEnabled: boolean;
  feedbackOpen: boolean;
  feedbackCount: number;
  onNavigate: (url: string) => void;
  onAddDevice: (presetId: string) => void;
  onZoom: (zoom: number) => void;
  onReload: () => void;
  onToggleEditor: () => void;
  onToggleSync: () => void;
  onToggleFeedback: () => void;
  onClose: () => void;
}

export function deviceIcon(width: number, size?: number) {
  if (width < 600) return <IconPhone size={size} />;
  if (width < 1024) return <IconTablet size={size} />;
  return <IconMonitor size={size} />;
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 1;
const ZOOM_STEP = 0.05;

export function Toolbar({
  src,
  zoom,
  editorOpen,
  syncEnabled,
  feedbackOpen,
  feedbackCount,
  onNavigate,
  onAddDevice,
  onZoom,
  onReload,
  onToggleEditor,
  onToggleSync,
  onToggleFeedback,
  onClose,
}: Props) {
  const [draft, setDraft] = useState(src);
  const [menuOpen, setMenuOpen] = useState(false);

  const stepZoom = (dir: 1 | -1) => {
    const next = Math.round((zoom + dir * ZOOM_STEP) * 100) / 100;
    onZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  };

  return (
    <header className="toolbar">
      <span className="toolbar__brand">
        Dev<em>Viewer</em>
      </span>

      <form
        className="omnibox"
        onSubmit={(e) => {
          e.preventDefault();
          onNavigate(draft);
        }}
      >
        <span className="omnibox__icon">
          <IconGlobe size={15} />
        </span>
        <input
          className="omnibox__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          aria-label="URL"
        />
        <button
          type="button"
          className="icon-btn icon-btn--small omnibox__reload"
          onClick={onReload}
          title="Alle Frames neu laden"
        >
          <IconReload size={14} />
        </button>
      </form>

      <div className="toolbar__group">
        <button
          className={`icon-btn${editorOpen ? ' icon-btn--active' : ''}`}
          onClick={onToggleEditor}
          aria-pressed={editorOpen}
          title={editorOpen ? 'CSS-Editor ausblenden' : 'CSS-Editor einblenden'}
        >
          <IconCode />
        </button>

        <button
          className={`icon-btn${syncEnabled ? ' icon-btn--active' : ''}`}
          onClick={onToggleSync}
          aria-pressed={syncEnabled}
          title={
            syncEnabled
              ? 'Interaktions-Sync aktiv: Klicks & Eingaben laufen auf allen Frames'
              : 'Interaktions-Sync aus'
          }
        >
          {syncEnabled ? <IconLink /> : <IconLinkOff />}
        </button>

        <button
          className={`icon-btn toolbar__feedback${feedbackOpen ? ' icon-btn--active' : ''}`}
          onClick={onToggleFeedback}
          aria-pressed={feedbackOpen}
          title="Feedback-Panel"
        >
          <IconMessage />
          {feedbackCount > 0 && <span className="toolbar__badge">{feedbackCount}</span>}
        </button>
      </div>

      <span className="toolbar__sep" />

      <div className="zoomer" title="Zoom">
        <button
          className="icon-btn icon-btn--small"
          onClick={() => stepZoom(-1)}
          disabled={zoom <= ZOOM_MIN}
          aria-label="Herauszoomen"
        >
          <IconMinus size={14} />
        </button>
        <span className="zoomer__value">{Math.round(zoom * 100)}%</span>
        <button
          className="icon-btn icon-btn--small"
          onClick={() => stepZoom(1)}
          disabled={zoom >= ZOOM_MAX}
          aria-label="Hineinzoomen"
        >
          <IconPlus size={14} />
        </button>
      </div>

      <span className="toolbar__sep" />

      <div className="toolbar__group">
        <div className="add-device">
          <button
            className={`icon-btn${menuOpen ? ' icon-btn--active' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            title="Device hinzufuegen"
          >
            <IconPlus />
          </button>

          {menuOpen && (
            <>
              {/* Transparenter Backdrop faengt Outside-Clicks — zuverlaessiger
                  als document-Listener quer durch den Shadow Tree. */}
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu" role="menu">
                <div className="menu__title">Device hinzufuegen</div>
                {PRESETS.map((p: DevicePreset) => (
                  <button
                    key={p.id}
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
                ))}
              </div>
            </>
          )}
        </div>

        <button className="icon-btn" onClick={onClose} title="Inkspect schliessen">
          <IconClose />
        </button>
      </div>
    </header>
  );
}
