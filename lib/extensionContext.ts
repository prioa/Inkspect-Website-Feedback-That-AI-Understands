import { createLogger } from './log';

const log = createLogger('ext-context');

/**
 * After an extension update, reload or deactivation, tabs that are already
 * open still run the old content script. From that moment its `browser.*`
 * calls die with "Extension context invalidated". That is not a defect — but
 * every further write fails until the page is reloaded once.
 *
 * This state is process-wide (the whole content script is dead, not just one
 * store), so it is kept centrally here: detected once, logged once,
 * subscribers (the UI) notified once.
 */

let invalidated = false;
const listeners = new Set<() => void>();

export function isContextInvalidatedError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('Extension context invalidated');
}

/** true as soon as an invalidated context has been detected for the first time. */
export function isContextInvalidated(): boolean {
  return invalidated;
}

/**
 * Reports an error. If it was the invalidation error, the state is set once,
 * exactly one warning is logged and all subscribers are notified. Returns
 * true when the error was the invalidation (the caller should then treat it
 * as expected rather than logging it as a defect).
 */
export function reportContextError(e: unknown): boolean {
  if (!isContextInvalidatedError(e)) return false;
  if (!invalidated) {
    invalidated = true;
    // Deliberately debug rather than warn/error: Chrome collects console.warn
    // and console.error from content scripts in the extension overview
    // (chrome://extensions) and paints them red as "Errors". This is not a
    // defect — the in-UI banner informs the user, the console stays quiet.
    log.debug('The extension was reloaded — saving is paused. Reload the page (F5) to carry on working.');
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* Do not throw a subscriber's error back into the reporting chain */
      }
    }
  }
  return true;
}

/**
 * Subscribes to the invalidation (the UI then shows a reload notice). If the
 * context is already dead, the callback fires immediately. Returns an
 * unsubscribe function.
 */
export function onContextInvalidated(fn: () => void): () => void {
  if (invalidated) fn();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
