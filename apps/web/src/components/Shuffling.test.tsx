import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Shuffling } from './Shuffling';

afterEach(cleanup);

describe('Shuffling', () => {
  it('says what is happening, with the shuffling cards hidden from screen readers', () => {
    render(<Shuffling label="Connecting to the table…" />);
    expect(screen.getByRole('status').textContent).toBe('Connecting to the table…');
    const deck = document.querySelector('.shuffle-deck');
    expect(deck?.getAttribute('aria-hidden')).toBe('true');
    expect(deck?.querySelectorAll('.card.back')).toHaveLength(3);
  });
});
