/**
 * Detects whether an iframe was blocked by the page itself
 * (`X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`).
 *
 * `SAMEORIGIN` and `frame-ancestors 'self'` do not block us, because the
 * preview frames share the tab's origin. Only the hard variants end up here.
 */

/**
 * Do the response headers forbid embedding the page as a frame of the *same*
 * origin? Applied to a pre-flight request before loading, so the warning
 * arrives before the frame requests the page at all.
 *
 * `SAMEORIGIN`/`'self'` are harmless — the preview frames share the tab's
 * origin. For a `frame-ancestors` list without `'self'`, `*` or our own host,
 * we conservatively assume it is blocked.
 */
export function framingBlockedByHeaders(headers: Headers, origin: string): boolean {
  const xfo = headers.get('x-frame-options')?.toLowerCase() ?? '';
  if (xfo.includes('deny')) return true;

  const csp = [
    headers.get('content-security-policy') ?? '',
    headers.get('content-security-policy-report-only') ?? '',
  ].join(';');
  const directive = csp
    .split(';')
    .map((d) => d.trim().toLowerCase())
    .find((d) => d.startsWith('frame-ancestors'));
  if (!directive) return false;

  const sources = directive.split(/\s+/).slice(1);
  if (sources.includes("'none'")) return true;
  if (sources.includes("'self'") || sources.includes('*')) return false;

  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return !sources.some((s) => s.includes(host));
}

/** Returns the frame's document, or null if it is cross-origin or blocked. */
export function frameDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    // SecurityError — the frame belongs to a foreign origin (error page).
    return null;
  }
}

/**
 * Must be called after the `load` event.
 *
 * Chrome replaces a blocked frame with an error page of foreign origin, so
 * `contentDocument` is null. Firefox instead leaves an empty about:blank
 * document behind, which is same-origin and therefore readable — hence the
 * second check.
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

  // A document that loaded successfully has a body with content in it.
  return doc.body == null;
}
