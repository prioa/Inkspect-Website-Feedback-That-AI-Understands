import { useEffect } from 'react';
import { TOOL_LABELS, type Tool } from '@/lib/annotations';
import { IconClose, IconPointer } from './icons';
import { TOOL_ICONS } from './AnnotationPalette';

/** Cmd on a Mac, Ctrl everywhere else — only for displaying the shortcuts. */
const MOD = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';


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
 * Modal cheat sheet: every keyboard shortcut and the less obvious mouse
 * gestures (right-click opens the palette, double-click edits a note, the
 * title bar drags the card around). Opened with `?` or the help icon, closed
 * with Esc or a click on the backdrop.
 */
export function ShortcutsOverlay({
  order,
  onClose,
}: {
  /** Tool order of the bar — the digits follow it. */
  order: readonly Tool[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture, so that Esc lands here before the global handler leaves draw
    // mode or full window mode.
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
              {order.map((id, i) => (
                <div key={id} className="sheet__row">
                  <span className="sheet__row-icon">{TOOL_ICONS[id]()}</span>
                  <span className="sheet__row-label">{TOOL_LABELS[id]}</span>
                  <Keys keys={[String(i + 1)]} />
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
                <span className="sheet__row-label">Leave draw mode</span>
                <Keys keys={['Esc']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Font inspector</span>
                <Keys keys={['I']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Show this help</span>
                <Keys keys={['?']} />
              </div>

              <div className="sheet__section-title">Mouse</div>
              <div className="sheet__row">
                <span className="sheet__row-label">Grab the element under the cursor</span>
                <Keys keys={['Right-click']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Edit a marker’s note</span>
                <Keys keys={['Double-click']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Move a marking you drew</span>
                <Keys keys={['Drag outline']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Reorder devices</span>
                <Keys keys={['Drag title']} />
              </div>
              <div className="sheet__row">
                <span className="sheet__row-label">Move or reorder the tool bar</span>
                <Keys keys={['Drag grip']} />
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
