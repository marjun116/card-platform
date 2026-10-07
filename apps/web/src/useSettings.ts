import { createContext, useContext } from 'react';

export interface Settings {
  /** Colorblind-safe suits: spades black, hearts red, diamonds blue, clubs green. */
  fourColor: boolean;
}

export const DEFAULTS: Settings = { fourColor: true };

export const SettingsContext = createContext<{
  settings: Settings;
  change: (change: Partial<Settings>) => void;
}>({ settings: DEFAULTS, change: () => undefined });

/** Display settings for this device. */
export function useSettings() {
  return useContext(SettingsContext);
}
