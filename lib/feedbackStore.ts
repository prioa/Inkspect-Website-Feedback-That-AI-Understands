import { storageLocal } from './storage';
import type { Point, Shape } from './annotations';
import { reportContextError } from './extensionContext';
import { createLogger } from './log';

const log = createLogger('feedback-store');

/**
 * Persistenz fuer Feedback-Marker in storageLocal().
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
  /**
   * Hier angelegt (nicht aus einem geteilten Link importiert). Nur eigene
   * Marker lassen sich verschieben — fremdes Feedback bleibt, wo es der
   * Ersteller gesetzt hat. Fehlt das Feld (Alt-Daten), gilt der Eintrag als
   * eigener: vor dem Teilen-Feature konnte nichts Fremdes im Store liegen.
   */
  mine?: boolean;
}

/** Eigener Eintrag? Alt-Daten ohne Flag zaehlen als eigene. */
export function isMine(item: FeedbackItem): boolean {
  return item.mine !== false;
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
  const result = await storageLocal().get(KEY);
  const list = (result as Record<string, unknown>)[KEY];
  return Array.isArray(list) ? migrateItems(list as FeedbackItem[]) : [];
}

async function writeAll(items: FeedbackItem[]): Promise<void> {
  await storageLocal().set({ [KEY]: items });
}

// Schreiboperationen sind Read-Modify-Write-Zyklen auf demselben Key —
// parallel gestartet wuerde der zweite `set` das Update des ersten
// ueberschreiben (Lost Update). Die Kette serialisiert sie.
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(op, op);
  writeQueue = next.catch(() => {});
  return next;
}

/** Alle Eintraege des Browsers — das Panel gruppiert selbst nach Seite. */
export async function loadAll(): Promise<FeedbackItem[]> {
  return readAll();
}

/** Fuegt Eintraege hinzu; bereits bekannte ids (Import-Merge) werden uebersprungen. */
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

/** Ersetzt mehrere Eintraege in einem Schreibzyklus (synchronisierte Marker). */
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
  // Importiertes Feedback stammt per Definition von jemand anderem.
  return migrateItems(valid).map((item) => ({ ...item, mine: false }));
}

/** Fire-and-forget-Wrapper: UI-State ist fuehrend, Persistenz folgt. */
export function persist(operation: Promise<unknown>, what: string): void {
  operation.catch((e: unknown) => {
    // Nach einem Extension-Update/-Reload laeuft auf offenen Tabs noch das
    // alte Content-Script — dessen storage-Zugriffe sterben mit "Extension
    // context invalidated". Kein echter Defekt: zentral einmalig melden
    // (die UI blendet dann den Reload-Hinweis ein), nicht pro Save spammen.
    if (reportContextError(e)) return;
    log.error(`${what} fehlgeschlagen`, e);
  });
}
