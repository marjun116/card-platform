/**
 * Settings kept in this browser: for now, how fast things move (normal, fast,
 * or off). Read with `motionSetting()`; the page's root element carries it as
 * `data-motion` so CSS effects can follow it too. Storage can be missing or
 * blocked (a private window), in which case it's normal and isn't saved.
 */
import { useSyncExternalStore } from 'react';

export const MOTION_SETTINGS = ['normal', 'fast', 'off'] as const;
export type MotionSetting = (typeof MOTION_SETTINGS)[number];

const KEY = 'card-table:motion';
const listeners = new Set<() => void>();
let current: MotionSetting | null = null;

function load(): MotionSetting {
  try {
    const saved = localStorage.getItem(KEY);
    return MOTION_SETTINGS.find((s) => s === saved) ?? 'normal';
  } catch {
    return 'normal';
  }
}

export function motionSetting(): MotionSetting {
  current ??= load();
  return current;
}

/** Puts the setting on the page's root element, for CSS (see styles.css). */
export function applyMotionSetting(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = motionSetting();
}

export function setMotionSetting(setting: MotionSetting): void {
  current = setting;
  try {
    localStorage.setItem(KEY, setting);
  } catch {
    // Not saved, but it still applies until the page is closed.
  }
  applyMotionSetting();
  for (const listener of listeners) listener();
}

/** The setting, kept up to date in a component. */
export function useMotionSetting(): MotionSetting {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, motionSetting);
}

/** Forgets the setting read so far (tests). */
export function resetSettings(): void {
  current = null;
}
