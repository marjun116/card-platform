/**
 * Per-device display settings, remembered in localStorage. Storage can be
 * blocked (private windows), so every read and write is allowed to fail.
 */
import { type ReactNode, useState } from 'react';
import { DEFAULTS, type Settings, SettingsContext } from './useSettings';

const KEY = 'card-table:settings';

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return DEFAULTS;
  }
}

function save(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembered; the setting still applies until the page is closed.
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load);
  const change = (change: Partial<Settings>) => {
    const next = { ...settings, ...change };
    setSettings(next);
    save(next);
  };
  return (
    <SettingsContext.Provider value={{ settings, change }}>{children}</SettingsContext.Provider>
  );
}
