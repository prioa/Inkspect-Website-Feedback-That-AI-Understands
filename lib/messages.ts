/** Nachrichten zwischen Content-Script und Background. */

export interface FetchCssRequest {
  type: 'ink:fetch-css';
  url: string;
}

export interface FrameBypassRequest {
  type: 'ink:frame-bypass';
  enabled: boolean;
}

export type BackgroundRequest = FetchCssRequest | FrameBypassRequest;

export type FetchCssResponse = { ok: true; text: string } | { ok: false; error: string };
export type FrameBypassResponse = { ok: true } | { ok: false; error: string };

export interface ToggleMessage {
  type: 'ink:toggle';
}
