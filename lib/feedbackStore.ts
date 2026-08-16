import { storageLocal } from './storage';
import type { Point, Shape } from './annotations';
import { reportContextError } from './extensionContext';
import { createLogger } from './log';

const log = createLogger('feedback-store');

/**
 * Persistence for feedback markers in storageLocal().
 *
 * Every marker is bound to a normalised URL (landing page) and a device
 * preset — it is only shown on exactly that page. storage.local rather than
 * the page's localStorage: it survives site-data clearing, spans origins
 * under the extension's control, and does not run into the quota or privacy
 * limits of individual pages.
 */
export interface FeedbackItem {
  id: string;
  /** Normalised page (origin + pathname + search, without the hash). */
  url: string;
  /** Preset id (e.g. 'iphone-se') — stable across sessions, unlike instance uids. */
  deviceId: string;
  shape: Shape;
  createdAt: number;
  /** Ticked off (review workflow) — completed markers are drawn dimmed. */
  done?: boolean;
  /**
   * Created here (not imported from a shared link). Only your own markers can
   * be moved — someone else's feedback stays where its author put it. When the
   * field is missing (old data) the entry counts as your own: before the
   * sharing feature existed, nothing foreign could be in the store.
   */
  mine?: boolean;
}

/** Your own entry? Old data without the flag counts as your own. */
export function isMine(item: FeedbackItem): boolean {
  return item.mine !== false;
}

const KEY = 'ink-feedback-v1';

/** Cut the hash: #section is scroll state, not a different landing page. */
export function normalizeUrl(href: string): string {
  try {
    const u = new URL(href);
    return u.origin + u.pathname + u.search;
  } catch {
    return href;
  }
}

/**
 * Do two pages belong to the same domain (origin)? Feedback from other
 * domains stays stored, but appears in neither the panel nor the counter.
 */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
}

/**
 * Migrates old data: early pen shapes carried a single stroke in `points`,
 * today there are several in `strokes`. Without the migration, rendering
 * crashes at `strokes.map`.
 */
function migrateShape(shape: Shape): Shape | null {
  if (shape.tool !== 'pen') return shape;
  if (Array.isArray(shape.strokes)) return shape;
  const legacy = (shape as { points?: unknown }).points;
  if (Array.isArray(legacy) && legacy.length > 0) {
    return { ...shape, strokes: [legacy as Point[]] };
  }
  return null;
}

function migrateItems(items: FeedbackItem[]): FeedbackItem[] {
  return items.flatMap((item) => {
    const shape = migrateShape(item.shape);
    return shape ? [{ ...item, shape }] : [];
  });
}

async function readAll(): Promise<FeedbackItem[]> {
  const result = await storageLocal().get(KEY);
  const list = (result as Record<string, unknown>)[KEY];
  return Array.isArray(list) ? migrateItems(list as FeedbackItem[]) : [];
}

async function writeAll(items: FeedbackItem[]): Promise<void> {
  await storageLocal().set({ [KEY]: items });
}

// Writes are read-modify-write cycles on the same key — started in parallel,
// the second `set` would overwrite the first one's update (lost update). The
// chain serialises them.
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(op, op);
  writeQueue = next.catch(() => {});
  return next;
}

/** Every entry in the browser — the panel groups them by page itself. */
export async function loadAll(): Promise<FeedbackItem[]> {
  return readAll();
}

/** Adds entries; ids that are already known (import merge) are skipped. */
export function addItems(newItems: FeedbackItem[]): Promise<number> {
  return enqueue(async () => {
    const all = await readAll();
    const known = new Set(all.map((item) => item.id));
    const fresh = newItems.filter((item) => !known.has(item.id));
    if (fresh.length > 0) await writeAll([...all, ...fresh]);
    return fresh.length;
  });
}

export function removeItems(ids: string[]): Promise<void> {
  const remove = new Set(ids);
  return enqueue(async () =>
    writeAll((await readAll()).filter((item) => !remove.has(item.id))),
  );
}

export function replaceItem(item: FeedbackItem): Promise<void> {
  return replaceItems([item]);
}

/** Replaces several entries in one write cycle (synchronised markers). */
export function replaceItems(items: FeedbackItem[]): Promise<void> {
  const byId = new Map(items.map((item) => [item.id, item]));
  return enqueue(async () =>
    writeAll((await readAll()).map((existing) => byId.get(existing.id) ?? existing)),
  );
}

export function clearUrl(url: string): Promise<void> {
  return enqueue(async () =>
    writeAll((await readAll()).filter((item) => item.url !== url)),
  );
}

/** Minimal structural validation of shared or imported entries. */
export function sanitizeItems(data: unknown): FeedbackItem[] {
  if (!Array.isArray(data)) throw new Error('Not Inkspect feedback.');
  const valid = data.filter((item): item is FeedbackItem => {
    const i = item as Partial<FeedbackItem> | null;
    return (
      typeof i?.id === 'string' &&
      typeof i.url === 'string' &&
      typeof i.deviceId === 'string' &&
      i.shape != null &&
      typeof (i.shape as Shape).tool === 'string'
    );
  });
  // Imported feedback comes, by definition, from someone else.
  return migrateItems(valid).map((item) => ({ ...item, mine: false }));
}

/** Fire-and-forget wrapper: UI state leads, persistence follows. */
export function persist(operation: Promise<unknown>, what: string): void {
  operation.catch((e: unknown) => {
    // After an extension update or reload, open tabs still run the old
    // content script — its storage access dies with "Extension context
    // invalidated". Not a real defect: report it centrally, once (the UI then
    // shows the reload notice), rather than spamming per save.
    if (reportContextError(e)) return;
    log.error(`${what} failed`, e);
  });
}
