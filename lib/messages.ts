/** Nachrichten zwischen Content-Script und Background. */

export interface FetchCssRequest {
  type: 'ink:fetch-css';
  url: string;
}

export interface FrameBypassRequest {
  type: 'ink:frame-bypass';
  enabled: boolean;
}

/** Screenshot des sichtbaren Tabs (fuer annotierte Device-Exports). */
export interface CaptureRequest {
  type: 'ink:capture';
}

export type BackgroundRequest = FetchCssRequest | FrameBypassRequest | CaptureRequest;

export type FetchCssResponse = { ok: true; text: string } | { ok: false; error: string };
export type FrameBypassResponse = { ok: true } | { ok: false; error: string };
export type CaptureResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

export interface ToggleMessage {
  type: 'ink:toggle';
}
