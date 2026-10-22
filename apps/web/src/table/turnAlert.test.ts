import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_TITLE, useTurnAlert } from './turnAlert';

let hidden = false;

function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  hidden = false;
  document.title = 'Card Table';
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useTurnAlert', () => {
  it('changes the tab title only while it is your turn and the tab is in the background', () => {
    const { rerender } = renderHook(({ turn }) => useTurnAlert(turn), {
      initialProps: { turn: false },
    });
    act(() => setHidden(true));
    expect(document.title).toBe('Card Table');

    rerender({ turn: true });
    expect(document.title).toBe(`${TURN_TITLE} – Card Table`);

    act(() => setHidden(false));
    expect(document.title).toBe('Card Table');

    act(() => setHidden(true));
    expect(document.title).toBe(`${TURN_TITLE} – Card Table`);

    rerender({ turn: false });
    expect(document.title).toBe('Card Table');
  });

  it('puts the title back when the table closes', () => {
    hidden = true;
    const { unmount } = renderHook(() => useTurnAlert(true));
    expect(document.title).toBe(`${TURN_TITLE} – Card Table`);
    unmount();
    expect(document.title).toBe('Card Table');
  });

  it('buzzes the phone when your turn starts, not when you open the table on it', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate });

    const { rerender } = renderHook(({ turn }) => useTurnAlert(turn), {
      initialProps: { turn: true },
    });
    expect(vibrate).not.toHaveBeenCalled();

    rerender({ turn: false });
    rerender({ turn: true });
    expect(vibrate).toHaveBeenCalledTimes(1);

    // Still your turn (a turn with more than one step): no second buzz.
    rerender({ turn: true });
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does nothing on phones that cannot vibrate', () => {
    vi.stubGlobal('navigator', { ...navigator, vibrate: undefined });
    const { rerender } = renderHook(({ turn }) => useTurnAlert(turn), {
      initialProps: { turn: false },
    });
    expect(() => rerender({ turn: true })).not.toThrow();
  });
});
