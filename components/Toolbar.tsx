import { useState } from 'react';
import { isCustomPreset, SIZE_MAX, SIZE_MIN, type DevicePreset } from '@/lib/devices';
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
  /** Eingebaute + eigene Presets — die Menueliste. */
  presets: readonly DevicePreset[];
  editorOpen: boolean;
  syncEnabled: boolean;
  feedbackOpen: boolean;
  feedbackCount: number;
  onNavigate: (url: string) => void;
  onAddDevice: (presetId: string) => void;
  /** Legt ein eigenes Preset an (persistiert) und stellt es ins Grid. */
  onAddCustomDevice: (name: string, width: number, height: number) => void;
  onRemoveCustomPreset: (presetId: string) => void;
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
  presets,
  editorOpen,
  syncEnabled,
  feedbackOpen,
  feedbackCount,
  onNavigate,
  onAddDevice,
  onAddCustomDevice,
  onRemoveCustomPreset,
  onZoom,
  onReload,
  onToggleEditor,
  onToggleSync,
  onToggleFeedback,
  onClose,
}: Props) {
  const [draft, setDraft] = useState(src);
  const [menuOpen, setMenuOpen] = useState(false);

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
          title="Reload all frames"
        >
          <IconReload size={14} />
        </button>
      </form>

      <div className="toolbar__group">
        <button
          className={`icon-btn${editorOpen ? ' icon-btn--active' : ''}`}
          onClick={onToggleEditor}
          aria-pressed={editorOpen}
          title={editorOpen ? 'Hide CSS editor' : 'Show CSS editor'}
        >
          <IconCode />
        </button>

        <button
          className={`icon-btn${syncEnabled ? ' icon-btn--active' : ''}`}
          onClick={onToggleSync}
          aria-pressed={syncEnabled}
          title={
            syncEnabled
              ? 'Interaction sync on: clicks & inputs run on all frames'
              : 'Interaction sync off'
          }
        >
          {syncEnabled ? <IconLink /> : <IconLinkOff />}
        </button>

        <button
          className={`icon-btn toolbar__feedback${feedbackOpen ? ' icon-btn--active' : ''}`}
          onClick={onToggleFeedback}
          aria-pressed={feedbackOpen}
          title="Feedback panel"
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

      <span className="toolbar__sep" />

      <div className="toolbar__group">
        <div className="add-device">
          <button
            className={`icon-btn${menuOpen ? ' icon-btn--active' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            title="Add device"
          >
            <IconPlus />
          </button>

          {menuOpen && (
            <>
              {/* Transparenter Backdrop faengt Outside-Clicks — zuverlaessiger
                  als document-Listener quer durch den Shadow Tree. */}
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu" role="menu">
                <div className="menu__title">Add device</div>
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
                </form>
              </div>
            </>
          )}
        </div>

        <button className="icon-btn" onClick={onClose} title="Close Inkspect">
          <IconClose />
        </button>
      </div>
    </header>
  );
}
