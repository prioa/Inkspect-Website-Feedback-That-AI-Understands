import { frameDocument } from './framing';

/**
 * Touch-Modus fuer Mobile-Previews: Ziehen mit gedrueckter Maustaste scrollt
 * die Seite (wie ein Finger-Pan), statt Text zu selektieren. Ein Klick nach
 * einem Drag wird geschluckt — beim echten Touch loest ein Pan auch keinen
 * Tap aus.
 */
const DRAG_THRESHOLD = 5;

export function attachTouchScroll(iframe: HTMLIFrameElement): (() => void) | null {
  const doc = frameDocument(iframe);
  const win = doc?.defaultView;
  if (!doc || !win) return null;

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let panning = false;
  let dragged = false;
  let previousUserSelect = '';

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    panning = true;
    dragged = false;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
  };

  const onMove = (e: MouseEvent) => {
    if (!panning) return;
    if (!dragged) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      dragged = true;
      // Waehrend des Pans keine Text-Selektion aufziehen.
      previousUserSelect = doc.documentElement.style.userSelect;
      doc.documentElement.style.userSelect = 'none';
      win.getSelection?.()?.removeAllRanges();
    }
    e.preventDefault();
    // Inhalt folgt dem Zeiger: Bewegung nach unten scrollt nach oben.
    const el = doc.scrollingElement;
    if (el) {
      el.scrollLeft -= e.clientX - lastX;
      el.scrollTop -= e.clientY - lastY;
    }
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const onUp = () => {
    if (!panning) return;
    panning = false;
    if (dragged) doc.documentElement.style.userSelect = previousUserSelect;
    // `dragged` bleibt bis zum click-Listener stehen — der raeumt es ab.
  };

  // Nach einem Pan darf der abschliessende Klick nicht auf der Seite landen
  // (und auch nicht im Interaction-Sync) — Capture-Listener schluckt ihn.
  const onClick = (e: MouseEvent) => {
    if (!dragged) return;
    dragged = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  doc.addEventListener('mousedown', onDown, true);
  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('mouseup', onUp, true);
  doc.addEventListener('click', onClick, true);

  return () => {
    doc.removeEventListener('mousedown', onDown, true);
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mouseup', onUp, true);
    doc.removeEventListener('click', onClick, true);
    if (dragged || panning) doc.documentElement.style.userSelect = previousUserSelect;
  };
}
