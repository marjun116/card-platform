/** Multi-step turns (draw → meld/lay off → discard) using the mini rummy fixture. */
import { describe, expect, it } from 'vitest';
import { miniRummy } from './__fixtures__/games';
import { hand, id, play, withZones } from './testing';
import { applyMove, createGame, getLegalMoves, viewFor } from './api';
import type { Move } from './game/move';
import { draft } from './game/state';

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

describe('running out of stock', () => {
  /**
   * One card left in the stock; everything else (except the top discard) is
   * underneath the discard pile, ready to be reshuffled.
   */
  function lastCard(options = {}) {
    const base = createGame(miniRummy, options, 2, 'stock');
    const p0 = base.cursor.current;
    const p1 = 1 - p0;
    const state = withZones(
      base,
      { [`hand@${p0}`]: ['2C', '5D', '9H'], [`hand@${p1}`]: ['3C', '6D', '10H'], stock: ['KS'] },
      'discard',
    );
    return { state, p0, p1 };
  }
  const draw = (player: number): Move => ({ player, type: 'draw', from: 'stock' });
  const discard = (player: number, spec: string): Move => ({
    player,
    type: 'discard',
    card: id(spec),
    to: 'discard',
  });

  it('reshuffles the discard pile as often as needed by default', () => {
    const { state, p0, p1 } = lastCard();
    const s = play(state, draw(p0), discard(p0, '2C'));
    expect(s.zones.stock).toEqual([]);
    const pile = s.zones.discard?.length ?? 0;
    const next = applyMove(s, draw(p1));
    expect(next.reshuffles.stock).toBe(1);
    expect(next.zones.discard).toHaveLength(1); // only the top card stays
    expect(next.zones.stock).toHaveLength(pile - 2); // the rest, minus the card drawn
    // No limit: even after many reshuffles the stock can be refilled again.
    const later = draft(s);
    later.reshuffles.stock = 50;
    expect(getLegalMoves(later, p1)).toContainEqual(draw(p1));
  });

  it('with a limit, ends the round once the reshuffles are used up', () => {
    const { state, p0 } = lastCard({ reshuffles: 1 });
    const s = draft(state);
    s.reshuffles.stock = 1;
    const drawn = applyMove(s, draw(p0));
    // p0 took the last card but still gets to finish their turn.
    expect(drawn.round).toBe(1);
    expect(getLegalMoves(drawn, p0)).toContainEqual(discard(p0, '2C'));
    const ended = applyMove(drawn, discard(p0, '2C'));
    expect(ended.round).toBe(2);
    expect(ended.reshuffles).toEqual({}); // counted per round
  });

  it('with a limit, still reshuffles until it is reached', () => {
    const { state, p0, p1 } = lastCard({ reshuffles: 1 });
    const s = play(state, draw(p0), discard(p0, '2C'), draw(p1));
    expect(s.reshuffles.stock).toBe(1);
    expect(s.round).toBe(1);
  });

  it('offers the limit as a house rule, defaulting to unlimited', () => {
    expect(createGame(miniRummy, {}, 2, 'x').options.reshuffles).toBe('unlimited');
    expect(() => createGame(miniRummy, { reshuffles: 5 }, 2, 'x')).toThrow(
      'must be one of unlimited, 1, 2, 3',
    );
  });
});
