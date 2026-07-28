import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { IconMessage } from './icons';

/** Kantenlaenge des runden Knopfs — muss zu `.fs-fab` in styles.ts passen. */
export const FAB_SIZE = 48;
/** Mindestabstand zu den Fensterkanten beim Ziehen. */
const EDGE = 12;
/** Ab dieser Zeigerbewegung ist es ein Zug und kein Klick mehr. */
const DRAG_SLOP = 4;

/** Position der linken oberen Ecke in Fenster-Koordinaten. */
export interface FabPos {
  x: number;
  y: number;
}

/** Standardplatz unten rechts — dieselbe Ecke, die `.fs-fab` ohne Position nimmt. */
export function defaultFabPos(): FabPos {
  return {
    x: window.innerWidth - FAB_SIZE - 18,
    y: window.innerHeight - FAB_SIZE - 18,
  };
}

/** Position ins Fenster zwingen (kleinere Fenster, gedrehte Displays). */
export function clampFabPos(pos: FabPos): FabPos {
  return {
    x: Math.max(EDGE, Math.min(pos.x, window.innerWidth - FAB_SIZE - EDGE)),
    y: Math.max(EDGE, Math.min(pos.y, window.innerHeight - FAB_SIZE - EDGE)),
  };
}

/**
 * Die Vollbild-Feedbackkarte wird am Knopf ausgerichtet — sie waechst aus ihm
 * heraus und muss darum mitwandern. Bevorzugt sitzt sie darueber; klebt der
 * Knopf oben, klappt sie nach unten. Ohne verschobenen Knopf uebernimmt die
 * feste Ecke aus `styles.ts`.
 */
export function fabPanelAnchor(pos: FabPos, panelWidth: number): CSSProperties {
  const gap = 12;
  const width = Math.min(panelWidth, window.innerWidth - 2 * EDGE);
  const maxH = Math.min(window.innerHeight * 0.6, 560);
  // Rechte Kante an der des Knopfs — aber nie aus dem Fenster heraus.
  const left = Math.max(
    EDGE,
    Math.min(pos.x + FAB_SIZE - width, window.innerWidth - width - EDGE),
  );
  // Der Ursprung der Aufklapp-Animation zeigt auf die Mitte des Knopfs.
  const originX = `${Math.round(pos.x + FAB_SIZE / 2 - left)}px`;
  const originGap = gap + FAB_SIZE / 2;
  if (pos.y >= maxH + gap + EDGE) {
    return {
      left,
      right: 'auto',
      top: 'auto',
      bottom: window.innerHeight - pos.y + gap,
      transformOrigin: `${originX} calc(100% + ${originGap}px)`,
    };
  }
  const top = pos.y + FAB_SIZE + gap;
  return {
    left,
    right: 'auto',
    top,
    bottom: 'auto',
    maxHeight: Math.max(160, Math.min(maxH, window.innerHeight - top - EDGE)),
    transformOrigin: `${originX} ${-originGap}px`,
  };
}

/**
 * Feedback-Knopf im Vollbild: oeffnet die Liste und laesst sich frei im
 * Fenster ablegen, wenn er gerade im Weg steht.
 *
 * Klick und Zug haengen am selben Knopf — erst jenseits von `DRAG_SLOP` wird
 * aus dem Druecken ein Zug, und dann verschluckt der Knopf den folgenden
 * Klick. Wie bei der Werkzeugleiste laeuft der Zug ueber Pointer-Capture
 * *und* einen Schild ueber dem Fenster: sonst schnappt der Seiten-iframe die
 * Bewegungen weg, sobald der Zeiger ueber ihm steht.
 */
export function FeedbackFab({
  pos,
  count,
  open,
  pulse,
  onMove,
  onToggle,
}: {
  /** Abgelegte Position oder `null` fuer den Standardplatz unten rechts. */
  pos: FabPos | null;
  /** Anzahl offener Eintraege — als Badge am Knopf. */
  count: number;
  open: boolean;
  /** Zaehler: jede Erhoehung startet die Puls-Animation neu. */
  pulse: number;
  onMove: (pos: FabPos) => void;
  onToggle: () => void;
}) {
  const [drag, setDrag] = useState<FabPos | null>(null);
  // Ein beendeter Zug darf den Knopf nicht auch noch ausloesen.
  const draggedRef = useRef(false);
  // Zeiger liegt auf dem Knopf (ab pointerdown bis zum Loslassen).
  const pressedRef = useRef(false);

  // Fenster kleiner geworden: den Knopf zurueck ins Bild holen.
  useEffect(() => {
    if (!pos) return;
    const onResize = () => {
      const next = clampFabPos(pos);
      if (next.x !== pos.x || next.y !== pos.y) onMove(next);
    };
    // Auch beim Wechsel ins Vollbild pruefen: das Fenster kann seit dem
    // Ablegen kleiner geworden sein.
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, onMove]);

  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const startX = e.clientX;
    const startY = e.clientY;
    draggedRef.current = false;
    pressedRef.current = true;
    btn.setPointerCapture(e.pointerId);

    const at = (ev: PointerEvent) => clampFabPos({ x: ev.clientX - offX, y: ev.clientY - offY });
    const move = (ev: PointerEvent) => {
      if (
        !draggedRef.current &&
        Math.abs(ev.clientX - startX) < DRAG_SLOP &&
        Math.abs(ev.clientY - startY) < DRAG_SLOP
      ) {
        return;
      }
      draggedRef.current = true;
      setDrag(at(ev));
    };
    const finish = () => {
      pressedRef.current = false;
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', cancel);
      try {
        btn.releasePointerCapture(e.pointerId);
      } catch {
        /* Capture schon weg */
      }
    };
    const cancel = () => {
      finish();
      draggedRef.current = false;
      setDrag(null);
    };
    const up = (ev: PointerEvent) => {
      finish();
      setDrag(null);
      if (!draggedRef.current) return;
      onMove(at(ev));
      // Der Klick zum Zug-Ende faellt je nach Loslass-Punkt auf den Schild
      // statt auf den Knopf — die Sperre darum zeitlich loesen und nicht erst
      // im Klick-Handler, sonst verschluckt der Knopf den naechsten echten
      // Klick. Ein Timeout laeuft nach dem Klick-Versand.
      window.setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    };
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', cancel);
  };

  const place = drag ?? pos;

  // Der Zaehler als key startet die Puls-Animation auch dann neu, wenn sie
  // noch laeuft. Solange der Zeiger auf dem Knopf liegt, friert er ein: ein
  // Neuaufbau risse Pointer-Capture und Listener mitten im Zug ab.
  const keyRef = useRef(pulse);
  if (!pressedRef.current) keyRef.current = pulse;

  return (
    <>
      {/* Schild waehrend des Zugs — haelt die Seite im iframe heraus. */}
      {drag && <div className="fsbar-shield" />}
      <button
        key={keyRef.current}
        className={`fs-fab${pulse > 0 && !open && !drag ? ' fs-fab--pulse' : ''}${
          drag ? ' fs-fab--dragging' : ''
        }`}
        style={place ? { left: place.x, top: place.y, right: 'auto', bottom: 'auto' } : undefined}
        title={`${open ? 'Hide feedback list' : 'Show feedback list'} — drag to move`}
        aria-pressed={open}
        onPointerDown={startDrag}
        onClick={() => {
          if (!draggedRef.current) onToggle();
        }}
      >
        <IconMessage size={22} />
        {count > 0 && <span className="fs-fab__badge">{count}</span>}
      </button>
    </>
  );
}
