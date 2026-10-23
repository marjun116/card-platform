import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsButton } from './components/Settings';
import { motionSetting, resetSettings, setMotionSetting } from './settings';
import { motionSpeed } from './table/motion/animate';

beforeEach(() => {
  localStorage.clear();
  resetSettings();
  delete document.documentElement.dataset.motion;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('animation speed setting', () => {
  it('is normal until chosen, then saved in the browser', () => {
    expect(motionSetting()).toBe('normal');
    expect(motionSpeed()).toBe(1);
    setMotionSetting('fast');
    expect(motionSpeed()).toBe(2);
    expect(localStorage.getItem('card-table:motion')).toBe('fast');
    expect(document.documentElement.dataset.motion).toBe('fast');
    // A fresh page reads it back.
    resetSettings();
    expect(motionSetting()).toBe('fast');
  });

  it('turns motion off', () => {
    setMotionSetting('off');
    expect(motionSpeed()).toBe(0);
    expect(document.documentElement.dataset.motion).toBe('off');
  });

  it('ignores a saved value it does not know', () => {
    localStorage.setItem('card-table:motion', 'ludicrous');
    expect(motionSetting()).toBe('normal');
  });

  it('still works where the browser blocks storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(motionSetting()).toBe('normal');
    setMotionSetting('off');
    expect(motionSetting()).toBe('off');
  });

  it('is chosen in the Settings pop-up from the header', () => {
    render(<SettingsButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const normal = screen.getByRole<HTMLInputElement>('radio', { name: /^Normal/ });
    expect(normal.checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /^Off/ }));
    expect(motionSetting()).toBe('off');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^Off/ }).checked).toBe(true);
  });
});
