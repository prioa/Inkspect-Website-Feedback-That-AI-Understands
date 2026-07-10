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
    if (!preset) throw new Error(`Unbekanntes Default-Preset: ${id}`);
    return instantiate(preset);
  });
}

/** Logische CSS-Pixel des Viewports — das ist, worauf Media Queries reagieren. */
export function viewport(device: DeviceInstance): { width: number; height: number } {
  return device.rotated
    ? { width: device.height, height: device.width }
    : { width: device.width, height: device.height };
}
