import { browser } from 'wxt/browser';
import { reportContextError } from './extensionContext';

/**
 * Zugriff auf `browser.storage.local` mit Prüfung.
 *
 * Nach einem Extension-Update/-Reload läuft auf offenen Tabs noch das alte
 * Content-Script, dessen `browser.*`-APIs Chrome dann abräumt: `browser` ist
 * noch da, `browser.storage` aber `undefined`. Ohne diese Hürde platzt der
 * erste Zugriff als „Cannot read properties of undefined (reading 'local')"
 * — ein TypeError, den niemand als das erkennt, was er ist.
 *
 * Deshalb wird daraus derselbe Fehler wie beim normalen Invalidierungs-Pfad:
 * die UI zeigt ihren Reload-Hinweis, Lader fallen auf ihre Defaults zurück.
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
