import { browser } from 'wxt/browser';
import { reportContextError } from './extensionContext';
import { createLogger } from './log';

const log = createLogger('settings');
const KEY = 'ink-settings-v1';

/** UI-Theme: 'system' folgt prefers-color-scheme, sonst fest hell/dunkel. */
export type ThemePref = 'system' | 'light' | 'dark';

/**
 * Persistente UI-Einstellungen (browser.storage.local). Bewusst getrennt
 * vom Grid-/Feedback-State: das sind reine Darstellungs-Vorlieben, die jede
 * Session ueberdauern (Theme, Panel-Breiten, Onboarding gesehen).
 */
export interface UiSettings {
  theme: ThemePref;
  /** Breite des CSS-Editors (links) in Shell-Pixeln. */
  editorWidth: number;
  /** Breite des Feedback-Panels (rechts) in Shell-Pixeln. */
  panelWidth: number;
  /** Der Erst-Hinweis auf die Feedback-Werkzeuge wurde weggeklickt. */
  onboardingSeen: boolean;
  /** Zoom automatisch einpassen, wenn sich Grid oder Breite aendern. */
  autoFit: boolean;
  /** Inkspect direkt im Vollbild-Modus oeffnen. */
  startFullscreen: boolean;
}

export const EDITOR_WIDTH_MIN = 280;
export const EDITOR_WIDTH_MAX = 720;
export const PANEL_WIDTH_MIN = 260;
export const PANEL_WIDTH_MAX = 640;

export const DEFAULT_SETTINGS: UiSettings = {
  theme: 'system',
  editorWidth: 380,
  panelWidth: 320,
  onboardingSeen: false,
  autoFit: true,
  startFullscreen: false,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export async function loadSettings(): Promise<UiSettings> {
  try {
    const result = await browser.storage.local.get(KEY);
    const raw = (result as Record<string, unknown>)[KEY] as Partial<UiSettings> | undefined;
    if (!raw) return { ...DEFAULT_SETTINGS };
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
      editorWidth: clamp(raw.editorWidth, EDITOR_WIDTH_MIN, EDITOR_WIDTH_MAX, DEFAULT_SETTINGS.editorWidth),
      panelWidth: clamp(raw.panelWidth, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX, DEFAULT_SETTINGS.panelWidth),
      onboardingSeen: raw.onboardingSeen === true,
      // Vorbelegt an: alte Staende ohne das Feld bekommen die Automatik.
      autoFit: raw.autoFit !== false,
      startFullscreen: raw.startFullscreen === true,
    };
  } catch (e) {
    log.error('Settings laden fehlgeschlagen', e);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Merge-Speichern: liest den aktuellen Stand und schreibt nur die uebergebenen
 * Felder zurueck. Aenderungen sind selten und nutzergetrieben — kein
 * Lost-Update-Risiko wie beim Feedback-Store.
 */
export async function saveSettings(patch: Partial<UiSettings>): Promise<void> {
  try {
    const current = await loadSettings();
    await browser.storage.local.set({ [KEY]: { ...current, ...patch } });
  } catch (e) {
    // Callers feuern das fire-and-forget (void saveSettings(...)). Nach einem
    // Extension-Reload stirbt der storage-Zugriff — zentral melden statt als
    // unhandled rejection durchschlagen zu lassen.
    if (reportContextError(e)) return;
    log.error('Settings speichern fehlgeschlagen', e);
  }
}
