import type { FeedbackItem } from './feedbackStore';
import { sanitizeItems } from './feedbackStore';

/**
 * Teilen per URL: das Feedback der Seite wird deflate-komprimiert und
 * base64url-codiert in den Hash gehaengt (`#ink-feedback=…`).
 *
 * Der Hash verlaesst den Browser nie (kein Server-Roundtrip). Oeffnet ein
 * Empfaenger mit installierter Extension den Link, importiert das
 * Content-Script die Eintraege automatisch und oeffnet Inkspect.
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

export async function buildShareUrl(url: string, items: FeedbackItem[]): Promise<string> {
  const payload: SharePayload = { v: 1, items };
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await pipe(raw, new CompressionStream('deflate-raw'));
  return `${url}#${SHARE_PARAM}=${toBase64Url(packed)}`;
}

/** Liefert den codierten Payload aus einem Hash, oder null. */
export function extractShareFromHash(hash: string): string | null {
  const match = new RegExp(`#${SHARE_PARAM}=([A-Za-z0-9_-]+)`).exec(hash);
  return match?.[1] ?? null;
}

export async function decodeShare(encoded: string): Promise<FeedbackItem[]> {
  const packed = fromBase64Url(encoded);
  const raw = await pipe(packed, new DecompressionStream('deflate-raw'));
  const payload = JSON.parse(new TextDecoder().decode(raw)) as Partial<SharePayload>;
  if (payload?.v !== 1) throw new Error('Unbekanntes Share-Format.');
  return sanitizeItems(payload.items);
}
