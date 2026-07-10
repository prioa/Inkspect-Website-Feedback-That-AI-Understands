/**
 * Erkennung, ob ein iframe von der Seite selbst blockiert wurde
 * (`X-Frame-Options: DENY` bzw. `Content-Security-Policy: frame-ancestors 'none'`).
 *
 * `SAMEORIGIN` und `frame-ancestors 'self'` blockieren uns nicht, weil die
 * Preview-Frames dieselbe Origin haben wie der Tab. Nur die harten Varianten
 * landen hier.
 */

/** Liefert das Dokument des Frames, oder null wenn es cross-origin/blockiert ist. */
export function frameDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    // SecurityError — der Frame gehoert einer fremden Origin (Fehlerseite).
    return null;
  }
}

/**
 * Muss nach dem `load`-Event aufgerufen werden.
 *
 * Chrome ersetzt einen blockierten Frame durch eine Fehlerseite fremder Origin,
 * `contentDocument` ist dann null. Firefox laesst statt dessen ein leeres
 * about:blank-Dokument stehen, das same-origin und damit lesbar ist — deshalb
 * die zweite Pruefung.
 */
export function isFrameBlocked(iframe: HTMLIFrameElement): boolean {
  const doc = frameDocument(iframe);
  if (!doc) return true;

  let href: string;
  try {
    href = doc.location.href;
  } catch {
    return true;
  }

  const expected = iframe.src;
  if (expected && expected !== 'about:blank' && href === 'about:blank') return true;

  // Ein erfolgreich geladenes Dokument hat einen Body mit Inhalt.
  return doc.body == null;
}
