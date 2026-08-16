import { useEffect, useRef } from 'react';
import { IconClose } from './icons';

/**
 * Small confirmation dialog for actions that cannot be undone (delete all
 * markings). Esc and the backdrop cancel; on opening, focus sits on Cancel so
 * that hitting Enter too quickly deletes nothing.
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
      // Capture: otherwise the global handler leaves draw mode along with it.
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
