/** Messages between the content script and the background. */

export interface FetchCssRequest {
  type: 'ink:fetch-css';
  url: string;
}

export interface FrameBypassRequest {
  type: 'ink:frame-bypass';
  enabled: boolean;
  /** Domain of the preview — the rule applies to it only, not to all frames. */
  host?: string;
}

/**
 * Checks up front whether a URL can be embedded as a frame. Runs in the
 * background, because the content script never sees the response headers.
 */
export interface FrameCheckRequest {
  type: 'ink:frame-check';
  url: string;
}

/** Screenshot of the visible tab (for annotated device exports). */
export interface CaptureRequest {
  type: 'ink:capture';
}

/**
 * The UI was opened or closed in this tab — the background then sets the
 * badge on the toolbar icon ("ON") so the active state is visible.
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
