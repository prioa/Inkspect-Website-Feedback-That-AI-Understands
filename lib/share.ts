import type { FeedbackItem } from './feedbackStore';
import { sanitizeItems } from './feedbackStore';

/**
 * Sharing over the URL: a page's feedback is deflate-compressed, base64url-
 * encoded and appended to the hash (`#ink-feedback=…`).
 *
 * The hash never leaves the browser (no server round-trip). When a recipient
 * with the extension installed opens the link, the content script imports the
 * entries automatically and opens Inkspect.
 */

export const SHARE_PARAM = 'ink-feedback';

interface SharePayload {
  v: 1;
  items: FeedbackItem[];
}

async function pipe(data: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const piped = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): Uint8Array {
  const b64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The encoded payload on its own (deflate-raw + base64url) — the basis of the
 * share link and of the attachment in the Markdown export.
 */
export async function encodeShare(items: FeedbackItem[]): Promise<string> {
  const payload: SharePayload = { v: 1, items };
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await pipe(raw, new CompressionStream('deflate-raw'));
  return toBase64Url(packed);
}

export async function buildShareUrl(url: string, items: FeedbackItem[]): Promise<string> {
  return `${url}#${SHARE_PARAM}=${await encodeShare(items)}`;
}

/** Returns the encoded payload from a hash, or null. */
export function extractShareFromHash(hash: string): string | null {
  const match = new RegExp(`#${SHARE_PARAM}=([A-Za-z0-9_-]+)`).exec(hash);
  return match?.[1] ?? null;
}

export async function decodeShare(encoded: string): Promise<FeedbackItem[]> {
  const packed = fromBase64Url(encoded);
  const raw = await pipe(packed, new DecompressionStream('deflate-raw'));
  const payload = JSON.parse(new TextDecoder().decode(raw)) as Partial<SharePayload>;
  if (payload?.v !== 1) throw new Error('Unknown share format.');
  return sanitizeItems(payload.items);
}
