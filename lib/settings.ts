import { storageLocal } from './storage';
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
  /**
   * Die gefuehrte Tour wurde durchlaufen oder abgebrochen.
   *
   * Bewusst ein neues Feld statt des abgeloesten `onboardingSeen`: die Tour
   * zeigt Gesten, die der alte Ein-Satz-Hinweis nie erwaehnt hat —
   * Bestandsnutzer sollen sie einmal sehen, auch wenn sie den alten Hinweis
   * laengst weggeklickt hatten. Das Alt-Feld bleibt in gespeicherten Staenden
   * liegen und wird schlicht nicht mehr gelesen.
   */
  tourDone: boolean;
  /** Zoom automatisch einpassen, wenn sich Grid oder Breite aendern. */
  autoFit: boolean;
  /** Inkspect direkt im Vollbild-Modus oeffnen. */
  startFullscreen: boolean;
  /**
   * Schwebendes Smartphone-Mockup im Vollbild eingeblendet. Optional und
   * standardmaessig aus — wer die Mobile-Ansicht braucht, holt sie ueber den
   * Phone-Knopf der Werkzeugleiste dazu.
   */
  phonePreview: boolean;
  /**
   * Markierungen dauerhaft eingeblendet (Auge im Panel). Aus ist der Default:
   * so sieht man das Ergebnis der Korrekturen ungestoert, und ein Zeiger ueber
   * dem Panel blendet sie kurz ein.
   */
  showMarkings: boolean;
  /** Die per Element-Picker gespeicherten CSS-Aenderungen auf die Seite anwenden. */
  applyChanges: boolean;
  /** Wie viele der Feedback-Farben die Werkzeugleiste anbietet (2 oder 4). */
  paletteColorCount: number;
  /**
   * Platzierung der Werkzeugleiste im Vollbild-Modus: an einer Kante
   * eingerastet oder frei im Fenster (dann zaehlen `toolbarX`/`toolbarY`).
   */
  toolbarDock: ToolbarDock;
  /** Freie Position (linke obere Ecke der Leiste, Fenster-Koordinaten). */
  toolbarX: number;
  toolbarY: number;
  /**
   * Verschobene Position des Feedback-Knopfs im Vollbild (linke obere Ecke,
   * Fenster-Koordinaten). `null` heisst: unveraendert am Standardplatz unten
   * rechts — der bleibt an der Fensterecke kleben, auch wenn sich die Groesse
   * aendert.
   */
  fabX: number | null;
  fabY: number | null;
  /**
   * Origins, fuer die der Nutzer dem Entfernen der Framing-Header zugestimmt
   * hat. Gefragt wird einmal pro Origin; danach laedt eine blockierte Seite
   * direkt, solange der Toolbar-Indikator den laufenden Eingriff zeigt.
   */
  framingAllowed: string[];
}

/**
 * Die Werkzeugleiste haengt im Vollbild frei im Fenster ('free') oder rastet
 * an einem der beiden Snap-Punkte ein: linke Kante bzw. unterer Rand.
 */
export type ToolbarDock = 'left' | 'bottom' | 'free';

/** Platzierung der Leiste — 'free' nutzt zusaetzlich x/y. */
export interface ToolbarPlacement {
  dock: ToolbarDock;
  x: number;
  y: number;
}

export const EDITOR_WIDTH_MIN = 280;
export const EDITOR_WIDTH_MAX = 720;
export const PANEL_WIDTH_MIN = 260;
export const PANEL_WIDTH_MAX = 640;

export const DEFAULT_SETTINGS: UiSettings = {
  theme: 'system',
  editorWidth: 380,
  panelWidth: 320,
  tourDone: false,
  autoFit: true,
  startFullscreen: false,
  phonePreview: false,
  showMarkings: false,
  applyChanges: true,
  paletteColorCount: 2,
  // Unten mittig — dieselbe Stelle, an der die Leiste auch in der
  // Device-Ansicht sitzt; der Wechsel ins Vollbild verschiebt sie so nicht.
  toolbarDock: 'bottom',
  toolbarX: 14,
  toolbarY: 80,
  fabX: null,
  fabY: null,
  framingAllowed: [],
};

/** Optionale Fenster-Koordinate: alles Unbrauchbare wird zu `null`. */
function coord(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(10000, Math.max(0, value))
    : null;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export async function loadSettings(): Promise<UiSettings> {
  try {
    const result = await storageLocal().get(KEY);
    const raw = (result as Record<string, unknown>)[KEY] as Partial<UiSettings> | undefined;
    if (!raw) return { ...DEFAULT_SETTINGS };
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
      editorWidth: clamp(raw.editorWidth, EDITOR_WIDTH_MIN, EDITOR_WIDTH_MAX, DEFAULT_SETTINGS.editorWidth),
      panelWidth: clamp(raw.panelWidth, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX, DEFAULT_SETTINGS.panelWidth),
      tourDone: raw.tourDone === true,
      // Vorbelegt an: alte Staende ohne das Feld bekommen die Automatik.
      autoFit: raw.autoFit !== false,
      startFullscreen: raw.startFullscreen === true,
      phonePreview: raw.phonePreview === true,
      showMarkings: raw.showMarkings === true,
      // Vorbelegt an: alte Staende ohne das Feld behalten die Wirkung.
      applyChanges: raw.applyChanges !== false,
      // Nur 2 oder 4 — alles andere (auch Alt-Staende) faellt auf 2 zurueck.
      paletteColorCount: raw.paletteColorCount === 4 ? 4 : DEFAULT_SETTINGS.paletteColorCount,
      toolbarDock:
        raw.toolbarDock === 'left' || raw.toolbarDock === 'free'
          ? raw.toolbarDock
          : DEFAULT_SETTINGS.toolbarDock,
      toolbarX: clamp(raw.toolbarX, 0, 10000, DEFAULT_SETTINGS.toolbarX),
      toolbarY: clamp(raw.toolbarY, 0, 10000, DEFAULT_SETTINGS.toolbarY),
      // Alt-Staende kennen die Felder nicht: null laesst den Knopf an seinem
      // angestammten Platz unten rechts.
      fabX: coord(raw.fabX),
      fabY: coord(raw.fabY),
      framingAllowed: Array.isArray(raw.framingAllowed)
        ? raw.framingAllowed.filter((o): o is string => typeof o === 'string')
        : [],
    };
  } catch (e) {
    if (!reportContextError(e)) log.error('Settings laden fehlgeschlagen', e);
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
    await storageLocal().set({ [KEY]: { ...current, ...patch } });
  } catch (e) {
    // Callers feuern das fire-and-forget (void saveSettings(...)). Nach einem
    // Extension-Reload stirbt der storage-Zugriff — zentral melden statt als
    // unhandled rejection durchschlagen zu lassen.
    if (reportContextError(e)) return;
    log.error('Settings speichern fehlgeschlagen', e);
  }
}
