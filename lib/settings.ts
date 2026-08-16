import { storageLocal } from './storage';
import { reportContextError } from './extensionContext';
import { createLogger } from './log';
// Type-only — the import disappears at runtime. A value import would make
// hints and settings circular (hints.ts saves through saveSettings).
import type { HintId } from './hints';

const log = createLogger('settings');
const KEY = 'ink-settings-v1';

/** UI theme: 'system' follows prefers-color-scheme, otherwise fixed light/dark. */
export type ThemePref = 'system' | 'light' | 'dark';

/**
 * Persistent UI settings (browser.storage.local). Deliberately kept apart
 * from grid and feedback state: these are pure display preferences that
 * outlive every session (theme, panel widths, onboarding seen).
 */
export interface UiSettings {
  theme: ThemePref;
  /** Width of the CSS editor (left) in shell pixels. */
  editorWidth: number;
  /** Width of the feedback panel (right) in shell pixels. */
  panelWidth: number;
  /**
   * The guided tour was completed or dismissed.
   *
   * Deliberately a new field rather than the retired `onboardingSeen`: the
   * tour shows gestures the old one-line hint never mentioned, so existing
   * users should see it once even if they dismissed that hint long ago. The
   * old field stays in saved state and is simply no longer read.
   */
  tourDone: boolean;
  /**
   * Hints the user has already seen — each one appears exactly once, ever.
   *
   * A list rather than one field per hint: the catalogue grows with every
   * feature, and a new settings field per entry would have to be threaded
   * through three places each time. The retired `phoneHintDone` is folded in
   * on load and never written again.
   *
   * Unknown entries (older catalogue, different build) are left alone and
   * simply go nowhere — they no longer match any hint.
   */
  hintsSeen: HintId[];
  /**
   * Show hints at all. This is the menu switch; the per-session brakes
   * (budget, spacing, being ignored) live in `lib/hints.ts` and are not
   * persisted.
   */
  hintsEnabled: boolean;
  /** Fit the zoom automatically when the grid or the width changes. */
  autoFit: boolean;
  /** Open Inkspect straight in full window mode. Default: on. */
  startFullscreen: boolean;
  /**
   * Floating phone mockup shown in full window mode. Default: on — the mobile
   * view is the more frequent check. The phone button in the tool bar switches
   * it off and back on.
   */
  phonePreview: boolean;
  /**
   * The mockup fades while you are idle (default: on), so it does not cover
   * the page while you work elsewhere. The switch on its frame keeps it fully
   * visible, for anyone who watches the mobile view continuously.
   */
  phoneDimIdle: boolean;
  /**
   * Your work is on the preview: the markings drawn, and the changes saved via
   * the element picker applied to the page. Off shows the page as it stands —
   * the before/after look. On is the default: what you make, you should see.
   *
   * One setting for both, because they answer the same question. Two switches
   * made four combinations, of which only two were ever meant.
   */
  showEdits: boolean;
  /** How many of the feedback colours the tool bar offers (2 or 4). */
  paletteColorCount: number;
  /**
   * Where the tool bar sits in full window mode: snapped to an edge, or free
   * in the window (then `toolbarX`/`toolbarY` apply).
   */
  toolbarDock: ToolbarDock;
  /** Free position (top-left corner of the bar, window coordinates). */
  toolbarX: number;
  toolbarY: number;
  /** Resting place of the feedback card in full window mode. */
  panelDock: PanelDock;
  /** Free position of the card (top-left corner, window coordinates). */
  panelX: number;
  panelY: number;
  /**
   * Origins for which the user agreed to have the framing headers removed.
   * Asked once per origin; after that a blocked page loads straight away, for
   * as long as the toolbar indicator shows the change is active.
   */
  framingAllowed: string[];
}

/**
 * In full window mode the tool bar either floats freely ('free') or snaps to
 * one of the four window edges. Top and bottom lay it out horizontally, left
 * and right turn it into a vertical toolbox.
 */
export const TOOLBAR_DOCKS = ['left', 'right', 'top', 'bottom', 'free'] as const;
export type ToolbarDock = (typeof TOOLBAR_DOCKS)[number];

/**
 * Resting places of the feedback card in full window mode: centred above the
 * feedback button (default), at one of the side edges, or dropped anywhere.
 */
export const PANEL_DOCKS = ['button', 'left', 'right', 'free'] as const;
export type PanelDock = (typeof PANEL_DOCKS)[number];

/** Placement of the card — 'free' additionally uses x/y. */
export interface PanelPlacement {
  dock: PanelDock;
  x: number;
  y: number;
}

/** Placement of the bar — 'free' additionally uses x/y. */
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
  hintsSeen: [],
  hintsEnabled: true,
  autoFit: true,
  startFullscreen: true,
  phonePreview: true,
  phoneDimIdle: true,
  showEdits: true,
  paletteColorCount: 2,
  // Bottom centre — the same spot the bar occupies in the device view, so
  // switching to full window mode does not move it.
  toolbarDock: 'bottom',
  toolbarX: 14,
  toolbarY: 80,
  panelDock: 'button',
  panelX: 24,
  panelY: 80,
  framingAllowed: [],
};

/**
 * Is the stored value still one of the allowed ones? The list is the same one
 * the type is derived from, so the union and the check cannot drift apart and
 * a valid resting place never falls back to the default.
 */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/**
 * Hints seen, read from raw state, including the retired single field
 * `phoneHintDone`.
 *
 * Deliberately without a check against the catalogue: that lives in
 * `lib/hints.ts`, and importing it at runtime would be circular. An unknown
 * entry does no harm, it just no longer matches any hint.
 */
function readHintsSeen(raw: Partial<UiSettings> & { phoneHintDone?: unknown }): HintId[] {
  const seen = Array.isArray(raw.hintsSeen)
    ? raw.hintsSeen.filter((id): id is HintId => typeof id === 'string')
    : [];
  if (raw.phoneHintDone === true && !seen.includes('phone-hidden')) seen.push('phone-hidden');
  return seen;
}

/**
 * Retired with the merge of the two view switches into `showEdits`. Kept
 * readable for one migration and never written again — the next `saveSettings`
 * writes the parsed state and the old keys fall out of storage by themselves.
 */
type LegacyViewSwitches = { showMarkings?: unknown; applyChanges?: unknown };

export async function loadSettings(): Promise<UiSettings> {
  try {
    const result = await storageLocal().get(KEY);
    const raw = (result as Record<string, unknown>)[KEY] as
      | (Partial<UiSettings> & LegacyViewSwitches)
      | undefined;
    if (!raw) return { ...DEFAULT_SETTINGS };
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
      editorWidth: clamp(raw.editorWidth, EDITOR_WIDTH_MIN, EDITOR_WIDTH_MAX, DEFAULT_SETTINGS.editorWidth),
      panelWidth: clamp(raw.panelWidth, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX, DEFAULT_SETTINGS.panelWidth),
      tourDone: raw.tourDone === true,
      hintsSeen: readHintsSeen(raw),
      // Defaults to on: only an explicitly stored false switches it off.
      hintsEnabled: raw.hintsEnabled !== false,
      // Defaults to on: older state without the field gets the automatic fit.
      autoFit: raw.autoFit !== false,
      // Defaults to on: only an explicitly stored false switches it off.
      // Existing users have the field materialised (every saveSettings writes
      // the full state) and therefore keep their choice.
      startFullscreen: raw.startFullscreen !== false,
      // Defaults to on: only an explicitly stored false switches it off.
      phonePreview: raw.phonePreview !== false,
      phoneDimIdle: raw.phoneDimIdle !== false,
      // Defaults to on. Older state knows only the two retired switches, and
      // inherits from `applyChanges`, not from `showMarkings`: whoever had
      // their changes on the page (the old default) keeps the changed page and
      // simply gets the markers with it. The other way round the page would
      // quietly fall back to the original — the one thing this must not do.
      showEdits:
        typeof raw.showEdits === 'boolean' ? raw.showEdits : raw.applyChanges !== false,
      // Only 2 or 4 — anything else (including old state) falls back to 2.
      paletteColorCount: raw.paletteColorCount === 4 ? 4 : DEFAULT_SETTINGS.paletteColorCount,
      toolbarDock: oneOf(TOOLBAR_DOCKS, raw.toolbarDock)
        ? raw.toolbarDock
        : DEFAULT_SETTINGS.toolbarDock,
      toolbarX: clamp(raw.toolbarX, 0, 10000, DEFAULT_SETTINGS.toolbarX),
      toolbarY: clamp(raw.toolbarY, 0, 10000, DEFAULT_SETTINGS.toolbarY),
      panelDock: oneOf(PANEL_DOCKS, raw.panelDock) ? raw.panelDock : DEFAULT_SETTINGS.panelDock,
      panelX: clamp(raw.panelX, 0, 10000, DEFAULT_SETTINGS.panelX),
      panelY: clamp(raw.panelY, 0, 10000, DEFAULT_SETTINGS.panelY),
      framingAllowed: Array.isArray(raw.framingAllowed)
        ? raw.framingAllowed.filter((o): o is string => typeof o === 'string')
        : [],
    };
  } catch (e) {
    if (!reportContextError(e)) log.error('Loading the settings failed', e);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Merging save: reads the current state and writes back only the fields
 * passed in. Changes are rare and user-driven — no lost-update risk like the
 * feedback store has.
 */
export async function saveSettings(patch: Partial<UiSettings>): Promise<void> {
  try {
    const current = await loadSettings();
    await storageLocal().set({ [KEY]: { ...current, ...patch } });
  } catch (e) {
    // Callers fire this and forget (void saveSettings(...)). After an
    // extension reload the storage access dies — report it centrally instead
    // of letting it surface as an unhandled rejection.
    if (reportContextError(e)) return;
    log.error('Saving the settings failed', e);
  }
}
