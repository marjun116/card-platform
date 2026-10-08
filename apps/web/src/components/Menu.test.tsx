import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu';

afterEach(cleanup);

/** Lets the menu move focus after it opens (it waits for the next frame). */
async function nextFrame() {
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

function setup() {
  const pause = vi.fn();
  const end = vi.fn();
  render(
    <div>
      <Menu
        label="Game menu"
        buttonText="⋯"
        items={[
          { label: 'Pause', onSelect: pause },
          { label: 'End game', onSelect: end, danger: true },
        ]}
      />
      <p>Elsewhere</p>
    </div>,
  );
  const button = screen.getByRole('button', { name: 'Game menu' });
  return { pause, end, button };
}

describe('Menu', () => {
  it('opens on click and runs the chosen item', async () => {
    const { button, end } = setup();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(button);
    await nextFrame();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'End game' }));
    expect(end).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('works by keyboard: arrows move, Esc closes and returns to the button', async () => {
    const { button } = setup();
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    await nextFrame();
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes when you tap somewhere else', async () => {
    const { button } = setup();
    fireEvent.click(button);
    await nextFrame();
    fireEvent.pointerDown(screen.getByText('Elsewhere'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
