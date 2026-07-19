import { useEffect, useRef } from 'react';
import { IconClose } from './icons';

/**
 * Kleiner Bestaetigungsdialog fuer nicht umkehrbare Aktionen (alle
 * Markierungen loeschen). Esc und der Backdrop brechen ab; der Fokus liegt
 * beim Oeffnen auf „Abbrechen", damit ein zu schnelles Enter nichts loescht.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture: sonst beendet der globale Handler den Zeichenmodus mit.
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div
      className="overlay-backdrop"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sheet sheet--confirm" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <span className="sheet__title">{title}</span>
          <button className="icon-btn icon-btn--small" title="Cancel" onClick={onCancel}>
            <IconClose size={14} />
          </button>
        </div>
        <div className="sheet__body">
          <p className="confirm__text">{message}</p>
          <div className="confirm__actions">
            <button ref={cancelRef} onClick={onCancel}>
              Cancel
            </button>
            <button className="btn--danger" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
