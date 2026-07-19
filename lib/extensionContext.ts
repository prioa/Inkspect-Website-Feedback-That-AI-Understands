import { createLogger } from './log';

const log = createLogger('ext-context');

/**
 * Nach einem Extension-Update/-Reload (oder Deaktivieren) laeuft auf bereits
 * offenen Tabs noch das alte Content-Script. Dessen Zugriffe auf `browser.*`
 * sterben ab diesem Moment mit "Extension context invalidated". Das ist kein
 * Defekt — aber jede weitere Persistenz schlaegt fehl, bis die Seite einmal
 * neu geladen wird.
 *
 * Dieser Zustand ist prozessweit (das ganze Content-Script ist tot, nicht nur
 * ein einzelner Store), deshalb wird er hier zentral gehalten: einmal erkannt,
 * einmal geloggt, Subscriber (die UI) einmal benachrichtigt.
 */

let invalidated = false;
const listeners = new Set<() => void>();

export function isContextInvalidatedError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('Extension context invalidated');
}

/** true, sobald zum ersten Mal ein invalidierter Kontext erkannt wurde. */
export function isContextInvalidated(): boolean {
  return invalidated;
}

/**
 * Meldet einen Fehler. War es der Invalidierungs-Fehler, wird der Zustand
 * einmalig gesetzt, genau eine Warnung geloggt und alle Subscriber
 * benachrichtigt. Rueckgabe: true, wenn der Fehler die Invalidierung war
 * (der Aufrufer soll ihn dann als erwartet behandeln, nicht als Defekt loggen).
 */
export function reportContextError(e: unknown): boolean {
  if (!isContextInvalidatedError(e)) return false;
  if (!invalidated) {
    invalidated = true;
    // Bewusst debug statt warn/error: Chrome sammelt console.warn/error aus
    // Content-Scripts in der Extension-Uebersicht (chrome://extensions) und
    // faerbt sie rot als "Errors". Das ist aber kein Defekt — der Nutzer wird
    // ueber das In-UI-Banner informiert, die Konsole bleibt still.
    log.debug('Extension wurde neu geladen — Speichern pausiert. Seite neu laden (F5), um weiterzuarbeiten.');
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* Subscriber-Fehler nicht in die Meldekette zurueckwerfen */
      }
    }
  }
  return true;
}

/**
 * Abonniert die Invalidierung (die UI zeigt daraufhin einen Reload-Hinweis).
 * Ist der Kontext bereits tot, feuert der Callback sofort. Gibt eine
 * Unsubscribe-Funktion zurueck.
 */
export function onContextInvalidated(fn: () => void): () => void {
  if (invalidated) fn();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
