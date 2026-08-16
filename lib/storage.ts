import { browser } from 'wxt/browser';
import { reportContextError } from './extensionContext';

/**
 * Access to `browser.storage.local`, with a guard.
 *
 * After an extension update or reload, open tabs still run the old content
 * script, whose `browser.*` APIs Chrome then tears down: `browser` is still
 * there, but `browser.storage` is `undefined`. Without this guard the first
 * access blows up as "Cannot read properties of undefined (reading 'local')"
 * — a TypeError nobody recognises for what it actually is.
 *
 * So it is turned into the same error as the regular invalidation path: the
 * UI shows its reload notice, loaders fall back to their defaults.
 */
export function storageLocal(): NonNullable<typeof browser.storage>['local'] {
  const area = browser?.storage?.local;
  if (!area) {
    const error = new Error('Extension context invalidated (storage unavailable)');
    reportContextError(error);
    throw error;
  }
  return area;
}
