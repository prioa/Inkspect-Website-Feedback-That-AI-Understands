/** Nachrichten zwischen Content-Script und Background. */

export interface FetchCssRequest {
  type: 'ink:fetch-css';
  url: string;
}

export interface FrameBypassRequest {
  type: 'ink:frame-bypass';
  enabled: boolean;
  /** Domain der Vorschau — die Regel gilt nur fuer sie, nicht fuer alle Frames. */
  host?: string;
}

/**
 * Vorab-Pruefung, ob eine URL sich als Frame einbetten laesst. Laeuft im
 * Background, weil das Content-Script die Antwort-Header nicht sieht.
 */
export interface FrameCheckRequest {
  type: 'ink:frame-check';
  url: string;
}

/** Screenshot des sichtbaren Tabs (fuer annotierte Device-Exports). */
export interface CaptureRequest {
  type: 'ink:capture';
}

/**
 * UI in diesem Tab geoeffnet/geschlossen — der Background setzt daraufhin
 * das Badge am Toolbar-Icon („ON"), damit der aktive Zustand sichtbar ist.
 */
export interface UiStateMessage {
  type: 'ink:ui-state';
  open: boolean;
}

export type BackgroundRequest =
  | FetchCssRequest
  | FrameBypassRequest
  | FrameCheckRequest
  | CaptureRequest
  | UiStateMessage;

export type FetchCssResponse = { ok: true; text: string } | { ok: false; error: string };
export type FrameBypassResponse = { ok: true } | { ok: false; error: string };
export type FrameCheckResponse = { ok: true; blocked: boolean } | { ok: false; error: string };
export type CaptureResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

export interface ToggleMessage {
  type: 'ink:toggle';
}
