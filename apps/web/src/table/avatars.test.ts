import type { TableInfo } from '@card-table/server/protocol';
import { describe, expect, it } from 'vitest';
import { initials, seatInitials, teamColour } from './avatars';

describe('initials', () => {
  it('takes the first letters of the first and last names', () => {
    expect(initials('Raj Patel')).toBe('RP');
    expect(initials('Mary Ann de Vries')).toBe('MV');
    expect(initials('ana')).toBe('A');
  });

  it('keeps the number of a numbered name', () => {
    expect(initials('Bot 3')).toBe('B3');
    expect(initials('Seat 12')).toBe('S12');
  });

  it('copes with spaces, accents and emoji', () => {
    expect(initials('  Zoë   Ölund ')).toBe('ZÖ');
    expect(initials('😀 Sam')).toBe('😀S');
    expect(initials('   ')).toBe('?');
  });
});

describe('seatInitials', () => {
  it('uses the player\'s own name, never "You"', () => {
    const table = {
      seats: [
        { seat: 0, user: { displayName: 'Ana Lima' } },
        { seat: 1, user: null },
      ],
    } as unknown as TableInfo;
    const of = seatInitials(table);
    expect(of(0)).toBe('AL');
    expect(of(1)).toBe('S2');
    expect(of(3)).toBe('S4');
  });
});

describe('teamColour', () => {
  it('gives each team a colour, reusing them past the eighth', () => {
    expect(teamColour(0)).toBe('var(--team-0)');
    expect(teamColour(7)).toBe('var(--team-7)');
    expect(teamColour(9)).toBe('var(--team-1)');
  });
});
