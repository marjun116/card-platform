import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CountUp } from './CountUp';

/** Animation frames run by hand: `frame(ms)` runs the waiting one at that time. */
let waiting: FrameRequestCallback | null = null;
function frame(ms: number) {
  const run = waiting;
  waiting = null;
  act(() => run?.(ms));
}

let reduced = false;

beforeEach(() => {
  waiting = null;
  reduced = false;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    waiting = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    waiting = null;
  });
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function shown(container: HTMLElement): string | null | undefined {
  return container.querySelector('[aria-hidden="true"]')?.textContent;
}

describe('CountUp', () => {
  it('shows the value straight away the first time', () => {
    const { container } = render(<CountUp value={120} />);
    expect(shown(container)).toBe('120');
    expect(waiting).toBeNull();
  });

  it('counts up to a new value, while screen readers only get the new value', () => {
    const { container, rerender } = render(<CountUp value={100} />);
    rerender(<CountUp value={200} />);
    expect(container.querySelector('.visually-hidden')?.textContent).toBe('200');

    frame(0);
    expect(shown(container)).toBe('100');
    frame(300);
    const middle = Number(shown(container));
    expect(middle).toBeGreaterThan(100);
    expect(middle).toBeLessThan(200);
    frame(600);
    expect(shown(container)).toBe('200');
    expect(waiting).toBeNull();
  });

  it('counts down too', () => {
    const { container, rerender } = render(<CountUp value={50} />);
    rerender(<CountUp value={-50} />);
    frame(0);
    frame(700);
    expect(shown(container)).toBe('-50');
  });

  it('jumps straight to the new value with "reduce motion"', () => {
    reduced = true;
    const { container, rerender } = render(<CountUp value={10} />);
    rerender(<CountUp value={40} />);
    expect(shown(container)).toBe('40');
    expect(waiting).toBeNull();
  });
});
