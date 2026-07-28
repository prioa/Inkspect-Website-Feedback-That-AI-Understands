import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { IconClose } from './icons';

/** Logischer Mobile-Viewport im Mockup (iPhone-Klasse). */
const VIEW_W = 375;
const VIEW_H = 760;
/** Darstellungs-Massstab — klein genug, um neben der Seite zu schweben. */
const SCALE = 0.55;
/** Aussenmasse des Mockups (Screen + Bezel-Padding + Rahmen). */
const FRAME_W = VIEW_W * SCALE + 22;
const FRAME_H = VIEW_H * SCALE + 52;

/**
 * Schwebendes Smartphone-Mockup im Feedback-Vollbild: die aktuelle Seite
 * laeuft darin in Mobile-Breite mit. Am Rahmen frei verschiebbar (Pointer-
 * Capture plus Klick-Schild, damit die iframes den Zug nicht schlucken),
 * ueber das X ausblendbar — zurueck geht es ueber den Phone-Knopf der
 * Werkzeugleiste.
 */
export function PhonePreview({
  src,
  anchorRight = 24,
  onHide,
  onAttach,
  onDetach,
  getHideTarget,
}: {
  src: string;
  /**
   * Abstand der Dock-Position vom rechten Rand: Standard Ecke rechts unten;
   * mit Feedback/offenem Panel schiebt die App das Mockup links daneben —
   * der Wechsel gleitet animiert (CSS-Transition auf left/top).
   */
  anchorRight?: number;
  onHide: () => void;
  /** Frame geladen — die App haengt ihn z. B. an den Scroll-Sync. */
  onAttach?: (iframe: HTMLIFrameElement) => void;
  /** Beim Unmount — Gegenstueck zu onAttach. */
  onDetach?: (iframe: HTMLIFrameElement) => void;
  /** Ziel der Ausblende-Animation — der Phone-Knopf in der Werkzeugleiste. */
  getHideTarget?: () => DOMRect | null;
}) {
  /** Vom Nutzer gezogene Position — gewinnt dauerhaft gegen das Docking. */
  const [manual, setManual] = useState<{ x: number; y: number } | null>(null);
  // Unten rechts (ueber dem Feedback-FAB) — bzw. links neben dem Panel.
  const pos = manual ?? {
    x: Math.max(8, window.innerWidth - FRAME_W - anchorRight),
    y: Math.max(8, window.innerHeight - FRAME_H - 78),
  };
  const [dragging, setDragging] = useState(false);

  /**
   * Ohne Hover zieht sich das Mockup optisch zurueck (Opacity .3): beim
   * Einblenden bleibt es 5 s voll sichtbar, nach dem Verlassen mit der Maus
   * startet das Abdunkeln nach 2 s. Explizite Timer statt CSS-Delays — die
   * Zeiten sollen exakt und nachvollziehbar sein.
   */
  const [dimmed, setDimmed] = useState(false);
  const dimTimer = useRef(0);
  const armDim = (delay: number) => {
    window.clearTimeout(dimTimer.current);
    dimTimer.current = window.setTimeout(() => setDimmed(true), delay);
  };
  const wake = () => {
    window.clearTimeout(dimTimer.current);
    setDimmed(false);
  };
  useEffect(() => {
    armDim(5000);
    return () => window.clearTimeout(dimTimer.current);
  }, []);

  // Frame beim Unmount wieder abmelden (Scroll-Sync u. Ae.).
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const onDetachRef = useRef(onDetach);
  onDetachRef.current = onDetach;
  useEffect(
    () => () => {
      const el = frameRef.current;
      if (el) onDetachRef.current?.(el);
    },
    [],
  );

  /**
   * Zug am Rahmen: native Listener + direkte Style-Mutation pro Move (wie
   * bei der Werkzeugleiste) — kein React-Re-Render pro Mausbewegung, sonst
   * schleppt das Mockup samt iframe spuerbar nach. Der State uebernimmt die
   * Endposition erst beim Loslassen.
   */
  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const offX = e.clientX - box.left;
    const offY = e.clientY - box.top;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
    wake();
    setDragging(true);
    const at = (ev: PointerEvent) => ({
      x: Math.max(8, Math.min(ev.clientX - offX, window.innerWidth - 80)),
      y: Math.max(8, Math.min(ev.clientY - offY, window.innerHeight - 80)),
    });
    const move = (ev: PointerEvent) => {
      const p = at(ev);
      root.style.left = `${p.x}px`;
      root.style.top = `${p.y}px`;
    };
    const up = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* Capture schon weg */
      }
      setManual(at(ev));
      setDragging(false);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  // Ausblenden: das Mockup fliegt sichtbar zum Phone-Knopf der Leiste und
  // verschwindet erst dort — so ist klar, wo es sich wieder einschalten laesst.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [flight, setFlight] = useState<{ dx: number; dy: number } | null>(null);
  const startHide = () => {
    if (flight) return;
    const own = rootRef.current?.getBoundingClientRect();
    const target = getHideTarget?.();
    if (!own || !target) {
      onHide();
      return;
    }
    setFlight({
      dx: target.left + target.width / 2 - (own.left + own.width / 2),
      dy: target.top + target.height / 2 - (own.top + own.height / 2),
    });
    window.setTimeout(onHide, 520);
  };

  return (
    <>
      {/* Schild ueber dem Fenster: haelt die Seiten-iframes aus dem Zug heraus. */}
      {dragging && <div className="fsbar-shield" />}
      <div
        ref={rootRef}
        className={`phone-prev${dragging ? ' phone-prev--dragging' : ''}${
          flight ? ' phone-prev--flight' : ''
        }${dimmed && !dragging && !flight ? ' phone-prev--dim' : ''}`}
        onPointerEnter={wake}
        onPointerLeave={() => armDim(2000)}
        style={{
          left: pos.x,
          top: pos.y,
          ...(flight
            ? { transform: `translate(${flight.dx}px, ${flight.dy}px) scale(.08)`, opacity: 0 }
            : {}),
        }}
        role="complementary"
        aria-label="Mobile preview"
      >
        <div
          className="phone-prev__frame"
          onPointerDown={startDrag}
          title="Drag to move"
        >
          <span className="phone-prev__notch" />
          <button
            type="button"
            className="phone-prev__close"
            aria-label="Hide mobile preview"
            title="Hide mobile preview — it tucks into the phone button in the toolbar"
            onClick={startHide}
          >
            <IconClose size={13} />
          </button>
          <div
            className="phone-prev__screen"
            style={{ width: VIEW_W * SCALE, height: VIEW_H * SCALE }}
          >
            <iframe
              ref={frameRef}
              src={src}
              width={VIEW_W}
              height={VIEW_H}
              style={{ transform: `scale(${SCALE})` }}
              title="Mobile preview"
              onLoad={(e) => onAttach?.(e.currentTarget)}
            />
          </div>
          <span className="phone-prev__home" />
        </div>
      </div>
    </>
  );
}
