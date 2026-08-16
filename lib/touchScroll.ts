import { frameDocument } from './framing';

/**
 * Touch mode for mobile previews: dragging with the mouse button held down
 * scrolls the page (like a finger pan) instead of selecting text. A click
 * that follows a drag is swallowed — on a real touchscreen a pan does not
 * produce a tap either.
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
      // No text selection while panning.
      previousUserSelect = doc.documentElement.style.userSelect;
      doc.documentElement.style.userSelect = 'none';
      win.getSelection?.()?.removeAllRanges();
    }
    e.preventDefault();
    // The content follows the pointer: moving down scrolls up.
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
    // `dragged` stays set until the click listener runs — that one clears it.
  };

  // After a pan the closing click must not reach the page (nor the interaction
  // sync) — a capture listener swallows it.
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
