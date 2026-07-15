import { browser } from 'wxt/browser';
import type { Point, Shape } from './annotations';
import { createLogger } from './log';

const log = createLogger('feedback-store');

/**
 * Persistenz fuer Feedback-Marker in browser.storage.local.
 *
 * Jeder Marker ist an eine normalisierte URL (Landingpage) und ein
 * Device-Preset gebunden — angezeigt wird er nur auf genau dieser Seite.
 * storage.local statt Seiten-localStorage: ueberlebt Site-Datenloeschung,
 * ist origin-uebergreifend unter Kontrolle der Extension und laeuft nicht
 * in Quota-/Privacy-Grenzen einzelner Seiten.
 */
export interface FeedbackItem {
  id: string;
  /** Normalisierte Seite (origin + pathname + search, ohne Hash). */
  url: string;
  /** Preset-Id (z.B. 'iphone-se') — stabil ueber Sessions, anders als Instanz-uids. */
  deviceId: string;
  shape: Shape;
  createdAt: number;
  /** Abgehakt (Review-Workflow) — erledigte Marker werden gedimmt dargestellt. */
  done?: boolean;
}

const KEY = 'ink-feedback-v1';

/** Hash abschneiden: #section ist Scroll-Zustand, keine andere Landingpage. */
export function normalizeUrl(href: string): string {
  try {
    const u = new URL(href);
    return u.origin + u.pathname + u.search;
  } catch {
    return href;
  }
}

/**
 * Gehoeren zwei Seiten zur selben Domain (Origin)? Feedback fremder Domains
 * bleibt gespeichert, wird aber weder im Panel noch im Zaehler angezeigt.
 */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
}

/**
 * Migriert Alt-Daten: fruehe Pen-Shapes trugen einen einzelnen Zug in
 * `points`, heute sind es mehrere in `strokes`. Ohne Migration crasht das
 * Rendering an `strokes.map`.
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
  const result = await browser.storage.local.get(KEY);
  const list = (result as Record<string, unknown>)[KEY];
  return Array.isArray(list) ? migrateItems(list as FeedbackItem[]) : [];
}

async function writeAll(items: FeedbackItem[]): Promise<void> {
  await browser.storage.local.set({ [KEY]: items });
}

/** Alle Eintraege des Browsers — das Panel gruppiert selbst nach Seite. */
export async function loadAll(): Promise<FeedbackItem[]> {
  return readAll();
}

/** Fuegt Eintraege hinzu; bereits bekannte ids (Import-Merge) werden uebersprungen. */
export async function addItems(newItems: FeedbackItem[]): Promise<number> {
  const all = await readAll();
  const known = new Set(all.map((item) => item.id));
  const fresh = newItems.filter((item) => !known.has(item.id));
  if (fresh.length > 0) await writeAll([...all, ...fresh]);
  return fresh.length;
}

export async function removeItems(ids: string[]): Promise<void> {
  const remove = new Set(ids);
  await writeAll((await readAll()).filter((item) => !remove.has(item.id)));
}

export async function replaceItem(item: FeedbackItem): Promise<void> {
  await writeAll((await readAll()).map((existing) => (existing.id === item.id ? item : existing)));
}

export async function clearUrl(url: string): Promise<void> {
  await writeAll((await readAll()).filter((item) => item.url !== url));
}

/** Minimale Struktur-Validierung geteilter/importierter Eintraege. */
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
  return migrateItems(valid);
}

/** Fire-and-forget-Wrapper: UI-State ist fuehrend, Persistenz folgt. */
export function persist(operation: Promise<unknown>, what: string): void {
  operation.catch((e: unknown) => log.error(`${what} fehlgeschlagen`, e));
}
