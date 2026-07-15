import { browser } from 'wxt/browser';

export interface DevicePreset {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface DeviceInstance extends DevicePreset {
  /** Eindeutig pro Instanz — dasselbe Preset darf mehrfach im Grid stehen. */
  uid: string;
  rotated: boolean;
}

export const PRESETS: readonly DevicePreset[] = [
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667 },
  { id: 'iphone-15', name: 'iPhone 15', width: 393, height: 852 },
  { id: 'pixel-8', name: 'Pixel 8', width: 412, height: 915 },
  { id: 'ipad-mini', name: 'iPad mini', width: 768, height: 1024 },
  { id: 'ipad-pro', name: 'iPad Pro 11"', width: 834, height: 1194 },
  { id: 'laptop', name: 'Laptop', width: 1280, height: 800 },
  { id: 'desktop', name: 'Desktop', width: 1440, height: 900 },
  { id: 'desktop-hd', name: 'Desktop HD', width: 1920, height: 1080 },
];

const DEFAULT_IDS = ['iphone-se', 'laptop'];

let uidCounter = 0;
export function instantiate(preset: DevicePreset): DeviceInstance {
  uidCounter += 1;
  return { ...preset, uid: `${preset.id}-${uidCounter}`, rotated: false };
}

export function defaultDevices(): DeviceInstance[] {
  return DEFAULT_IDS.map((id) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`Unknown default preset: ${id}`);
    return instantiate(preset);
  });
}

/** Logische CSS-Pixel des Viewports — das ist, worauf Media Queries reagieren. */
export function viewport(device: DeviceInstance): { width: number; height: number } {
  return device.rotated
    ? { width: device.height, height: device.width }
    : { width: device.width, height: device.height };
}

/*
 * Persistenz in browser.storage.local: eigene Device-Presets des Nutzers und
 * das zuletzt benutzte Grid (welche Devices, Rotation, Zoom) — das Setup soll
 * Sessions ueberleben.
 */

const CUSTOM_KEY = 'ink-devices-v1';
const GRID_KEY = 'ink-grid-v1';

export const SIZE_MIN = 200;
export const SIZE_MAX = 4000;

export function isCustomPreset(id: string): boolean {
  return id.startsWith('custom-');
}

/** Baut ein validiertes Custom-Preset; null bei unbrauchbaren Massen. */
export function createCustomPreset(name: string, width: number, height: number): DevicePreset | null {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < SIZE_MIN || w > SIZE_MAX || h < SIZE_MIN || h > SIZE_MAX) return null;
  return {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || `${w}×${h}`,
    width: w,
    height: h,
  };
}

function isPreset(value: unknown): value is DevicePreset {
  const p = value as Partial<DevicePreset> | null;
  return (
    typeof p?.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.width === 'number' &&
    typeof p.height === 'number'
  );
}

export async function loadCustomPresets(): Promise<DevicePreset[]> {
  const result = await browser.storage.local.get(CUSTOM_KEY);
  const list = (result as Record<string, unknown>)[CUSTOM_KEY];
  return Array.isArray(list) ? list.filter(isPreset) : [];
}

export async function saveCustomPresets(presets: DevicePreset[]): Promise<void> {
  await browser.storage.local.set({ [CUSTOM_KEY]: presets.filter((p) => isCustomPreset(p.id)) });
}

export interface GridState {
  devices: { presetId: string; rotated: boolean }[];
  zoom: number;
}

export async function loadGridState(): Promise<GridState | null> {
  const result = await browser.storage.local.get(GRID_KEY);
  const state = (result as Record<string, unknown>)[GRID_KEY] as Partial<GridState> | undefined;
  if (!state || !Array.isArray(state.devices) || typeof state.zoom !== 'number') return null;
  return {
    devices: state.devices.filter(
      (d): d is GridState['devices'][number] =>
        typeof (d as { presetId?: unknown })?.presetId === 'string',
    ),
    zoom: Math.min(1, Math.max(0.2, state.zoom)),
  };
}

export async function saveGridState(state: GridState): Promise<void> {
  await browser.storage.local.set({ [GRID_KEY]: state });
}
