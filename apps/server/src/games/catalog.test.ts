import { builtInGames } from '@card-table/games';
import { describe, expect, it } from 'vitest';
import { tileOf } from './catalog';

describe("a game's tile", () => {
  it('comes from the game file where it says', () => {
    expect(tileOf('spades', builtInGames.spades)).toEqual({
      minutes: [45, 90],
      cards: ['AS', 'KS', 'QS'],
      accent: 0,
    });
  });

  it('reads one number of minutes as both ends', () => {
    const file = { ...builtInGames.spades, meta: { ...builtInGames.spades.meta, minutes: 20 } };
    expect(tileOf('spades', file).minutes).toEqual([20, 20]);
  });

  it("works out the rest for a file that says nothing (a custom game's)", () => {
    const { minutes: _m, cards: _c, accent: _a, ...meta } = builtInGames.euchre.meta;
    const file = { ...builtInGames.euchre, meta };
    const tile = tileOf('my-euchre', file);
    expect(tile.minutes).toBeNull();
    // Euchre's deck is 9 to ace, so its highest cards are aces.
    expect(tile.cards).toEqual(['AS', 'AH', 'AD']);
    expect(tile.accent).toBeGreaterThanOrEqual(0);
    expect(tile.accent).toBeLessThan(8);
    // The same game always gets the same colour.
    expect(tileOf('my-euchre', file).accent).toBe(tile.accent);
  });

  it('every built-in game names its own tile', () => {
    for (const [slug, file] of Object.entries(builtInGames)) {
      expect(file.meta.minutes, slug).toBeDefined();
      expect(file.meta.cards, slug).toHaveLength(3);
      expect(file.meta.accent, slug).toBeDefined();
    }
  });
});
