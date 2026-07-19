import { useEffect, type JSX } from 'react';
import { TOOL_LABELS, type Tool } from '@/lib/annotations';
import {
  IconArrow,
  IconClose,
  IconEllipse,
  IconInspect,
  IconPen,
  IconPin,
  IconPointer,
  IconRect,
  IconText,
} from './icons';

/** Cmd auf dem Mac, sonst Ctrl — nur fuer die Anzeige der Shortcuts. */
const MOD = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

const TOOL_ROWS: { id: Tool; icon: JSX.Element; key: string }[] = [
  { id: 'element', icon: <IconInspect size={16} />, key: '1' },
  { id: 'pin', icon: <IconPin size={16} />, key: '2' },
  { id: 'pen', icon: <IconPen size={16} />, key: '3' },
  { id: 'rect', icon: <IconRect size={16} />, key: '4' },
  { id: 'ellipse', icon: <IconEllipse size={16} />, key: '5' },
  { id: 'arrow', icon: <IconArrow size={16} />, key: '6' },
  { id: 'text', icon: <IconText size={16} />, key: '7' },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="sheet__keys">
      {keys.map((k) => (
        <kbd key={k} className="kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Modales Cheatsheet: alle Tastenkuerzel und die weniger offensichtlichen
 * Maus-Gesten (Rechtsklick oeffnet die Palette, Doppelklick editiert eine
 * Notiz, Titelleiste zieht die Karte um). Per `?` oder das Hilfe-Icon
 * geoeffnet, per Esc/Klick auf den Backdrop geschlossen.
 */
export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture, damit Esc hier greift, bevor der globale Handler den
    // Zeichenmodus/Vollbild verlaesst.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="overlay-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <span className="sheet__title">Shortcuts & tips</span>
          <button className="icon-btn icon-btn--small" title="Close" onClick={onClose}>
            <IconClose size={14} />
          </button>
        </div>

        <div className="sheet__body">
          <div className="sheet__cols">
            <div>
              <div className="sheet__section-title">Tools</div>
              <div className="sheet__row">
                <span className="sheet__row-icon">
                  <IconPointer size={16} />
                </span>
                <span className="sheet__row-label">Interact — clicks go to the page</span>
                <Keys keys={['Esc']} />
              </div>
              {TOOL_ROWS.map((row) => (
                <div key={row.id} className="sheet__row">
                  <span className="sheet__row-icon">{row.icon}</span>
                  <span className="sheet__row-label">{TOOL_LABELS[row.id]}</span>
                  <Keys keys={[row.key]} />
                </div>
              ))}
            </div>

            <div>
              <div className="sheet__section-title">Actions</div>
              <div className="sheet__row">
                <span className="sheet__row-label">Undo last marking (while drawing)</span>
                <Keys keys={[MOD, 'Z']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Leave draw mode / exit full window</span>
                <Keys keys={['Esc']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Font inspector</span>
                <Keys keys={['I']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">This help</span>
                <Keys keys={['?']} />
              </div>

              <div className="sheet__section-title">Mouse</div>
              <div className="sheet__row">
                <span className="sheet__row-label">Open the tool palette</span>
                <Keys keys={['Right-click']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Edit a marker's note</span>
                <Keys keys={['Double-click']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Reorder devices</span>
                <Keys keys={['Drag title']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Zoom the grid (turns auto zoom off)</span>
                <Keys keys={[MOD, 'Scroll']} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
