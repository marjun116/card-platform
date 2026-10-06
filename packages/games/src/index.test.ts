import { SUITS } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

describe('games placeholder', () => {
  it('can import the engine through the workspace link', () => {
    expect(SUITS).toContain('spades');
  });

  it('has no built-in games yet', () => {
    expect(builtInGames).toEqual([]);
  });
});
