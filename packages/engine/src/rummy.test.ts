/** Multi-step turns (draw → meld/lay off → discard) using the mini rummy fixture. */
import { describe, expect, it } from 'vitest';
import { miniRummy } from './__fixtures__/games';
import { hand, id, play, withZones } from './testing';
import { applyMove, createGame, getLegalMoves, viewFor } from './api';
import type { Move } from './game/move';

const ids = (...specs: string[]) => specs.map(id).sort();

function table() {
  const base = createGame(miniRummy, {}, 2, 'rummy');
  const p0 = base.cursor.current;
  const p1 = 1 - p0;
  const state = withZones(
    base,
    {
      [`hand@${p0}`]: ['3H', '4H', '5H', 'KC', 'KD', 'KS', '2C'],
      [`hand@${p1}`]: ['6H', '9S', '9D', 'JC', 'JD', '8S', '2D'],
      discard: ['QC'],
      stock: ['10S', '9C'],
    },
    'stock',
  );
  return { state, p0, p1 };
}

const types = (moves: Move[]) => [...new Set(moves.map((m) => m.type))].sort();

describe('rummy turns', () => {
  it('must start by drawing from the stock or the discard pile', () => {
    const { state, p0 } = table();
    expect(getLegalMoves(state, p0)).toEqual([
      { player: p0, type: 'draw', from: 'stock' },
      { player: p0, type: 'draw', from: 'discard' },
    ]);
  });

  it('can then meld any number of times before discarding', () => {
    const { state, p0 } = table();
    const drawn = applyMove(state, { player: p0, type: 'draw', from: 'stock' });
    expect(hand(drawn, p0)).toContain(id('9C'));
    const moves = getLegalMoves(drawn, p0);
    // No endTurn: the discard step isn't optional.
    expect(types(moves)).toEqual(['discard', 'meld']);
    expect(moves.filter((m) => m.type === 'meld')).toHaveLength(2);

    const melded = play(
      drawn,
      { player: p0, type: 'meld', cards: ids('3H', '4H', '5H') },
      { player: p0, type: 'meld', cards: ids('KC', 'KD', 'KS') },
    );
    expect(melded.melds[`melds@${p0}`]?.map((m) => m.map((c) => c.id))).toEqual([
      ids('3H', '4H', '5H'),
      ids('KC', 'KD', 'KS'),
    ]);
    expect(melded.cursor.current).toBe(p0);
    expect(types(getLegalMoves(melded, p0))).toEqual(['discard']);
  });

  it('accepts the meld cards in any order', () => {
    const { state, p0 } = table();
    const drawn = applyMove(state, { player: p0, type: 'draw', from: 'stock' });
    const melded = applyMove(drawn, {
      player: p0,
      type: 'meld',
      cards: [id('5H'), id('3H'), id('4H')],
    });
    expect(melded.melds[`melds@${p0}`]).toHaveLength(1);
  });

  it('passes the turn after the discard', () => {
    const { state, p0, p1 } = table();
    const next = play(
      state,
      { player: p0, type: 'draw', from: 'discard' },
      { player: p0, type: 'discard', card: id('2C'), to: 'discard' },
    );
    expect(next.cursor.current).toBe(p1);
    expect(next.zones.discard?.at(-1)?.id).toBe(id('2C'));
  });

  it("lets a player lay off onto another player's meld", () => {
    const { state, p0, p1 } = table();
    const next = play(
      state,
      { player: p0, type: 'draw', from: 'stock' },
      { player: p0, type: 'meld', cards: ids('3H', '4H', '5H') },
      { player: p0, type: 'discard', card: id('2C'), to: 'discard' },
      { player: p1, type: 'draw', from: 'stock' },
    );
    const layOff: Move = {
      player: p1,
      type: 'layOff',
      card: id('6H'),
      meld: { zone: `melds@${p0}`, index: 0 },
    };
    expect(getLegalMoves(next, p1)).toContainEqual(layOff);
    const after = applyMove(next, layOff);
    expect(after.melds[`melds@${p0}`]?.[0]?.map((c) => c.id)).toEqual(ids('3H', '4H', '5H', '6H'));
    // Melds are public.
    expect(viewFor(after, p0).zones[`melds@${p0}`]).toEqual({
      kind: 'melds',
      melds: [after.melds[`melds@${p0}`]?.[0]],
    });
  });

  it('ends the round when a player goes out, scoring the cards left in hand', () => {
    const { state, p0, p1 } = table();
    const out = withZones(state, { [`hand@${p0}`]: ['3H', '4H', '5H'] }, 'stock');
    const next = play(
      out,
      { player: p0, type: 'draw', from: 'discard' }, // takes QC
      { player: p0, type: 'meld', cards: ids('3H', '4H', '5H') },
      { player: p0, type: 'discard', card: id('QC'), to: 'discard' },
    );
    expect(next.teams[p0]?.score).toBe(0);
    expect(next.teams[p1]?.score).toBe(6 + 9 + 9 + 10 + 10 + 8 + 2);
    // 54 passes the 50-point end condition, and the lowest score wins.
    expect(next.status).toBe('over');
    expect(next.winners).toEqual([p0]);
  });
});
