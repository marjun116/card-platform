/** Scenario tests for the spec's Sevens Up example: wild 7s, queens, drawing, reshuffling. */
import { describe, expect, it } from 'vitest';
import { sevensUp } from './__fixtures__/games';
import { hand, id, play, withZones } from './testing';
import { applyMove, createGame, getLegalMoves, getScores, viewFor } from './api';
import type { Move } from './game/move';
import { draft, type VarValue } from './game/state';
import type { GameFile } from './game/types';

const playCard = (player: number, spec: string): Move => ({
  player,
  type: 'play',
  card: id(spec),
  to: 'discard',
});
const draw = (player: number): Move => ({ player, type: 'draw', from: 'stock' });

/** Three players; seats returned in turn order starting with whoever plays first. */
function table(
  zones: Record<string, string[]>,
  vars: Record<string, VarValue> = {},
  file: GameFile = sevensUp,
) {
  const base = createGame(file, {}, 3, 'sevens');
  const p0 = base.cursor.current;
  const p1 = (p0 + 1) % 3;
  const p2 = (p0 + 2) % 3;
  const named: Record<string, string[]> = {};
  for (const [key, cards] of Object.entries(zones)) {
    named[key.replace('P0', String(p0)).replace('P1', String(p1)).replace('P2', String(p2))] =
      cards;
  }
  const state = draft(withZones(base, named, 'stock'));
  state.vars = { ...state.vars, ...vars };
  return { state, p0, p1, p2 };
}

describe('Sevens Up', () => {
  it('only allows cards matching the active suit, the top rank, or a 7', () => {
    const { state, p0 } = table(
      { 'hand@P0': ['2H', 'KD', '7C', '3S'], discard: ['KH'] },
      { activeSuit: 'hearts' },
    );
    expect(getLegalMoves(state, p0)).toEqual([
      playCard(p0, '2H'),
      playCard(p0, 'KD'),
      playCard(p0, '7C'),
    ]);
  });

  it('lets the player who plays a 7 choose the next suit', () => {
    const { state, p0, p1 } = table(
      { 'hand@P0': ['7C', '2D'], 'hand@P1': ['3H', '4S'], discard: ['KH'] },
      { activeSuit: 'hearts' },
    );
    const waiting = applyMove(state, playCard(p0, '7C'));
    expect(waiting.pending?.kind).toBe('chooseSuit');
    expect(getLegalMoves(waiting, p0).map((m) => m.type)).toEqual(Array(4).fill('chooseSuit'));
    expect(getLegalMoves(waiting, p1)).toEqual([]);
    expect(viewFor(waiting, p1).pending).toEqual({ kind: 'chooseSuit', player: p0 });

    const chosen = applyMove(waiting, { player: p0, type: 'chooseSuit', suit: 'spades' });
    expect(chosen.vars.activeSuit).toBe('spades');
    expect(chosen.cursor.current).toBe(p1);
    expect(getLegalMoves(chosen, p1)).toEqual([playCard(p1, '4S')]);
  });

  it('sets the active suit to the card played otherwise', () => {
    const { state, p0 } = table(
      { 'hand@P0': ['KD', '2C'], discard: ['KH'] },
      { activeSuit: 'hearts' },
    );
    expect(applyMove(state, playCard(p0, 'KD')).vars.activeSuit).toBe('diamonds');
  });

  it('makes the next player draw two after a queen', () => {
    const { state, p0, p1 } = table(
      { 'hand@P0': ['QH', '2D'], 'hand@P1': ['3C', '4C'], discard: ['KH'] },
      { activeSuit: 'hearts' },
    );
    const next = applyMove(state, playCard(p0, 'QH'));
    expect(hand(next, p1)).toHaveLength(4);
    expect(next.cursor.current).toBe(p1);
  });

  it('only allows drawing when no card can be played', () => {
    const { state, p0 } = table(
      { 'hand@P0': ['2D', '3D'], discard: ['KH'], stock: ['9C', '5H'] },
      { activeSuit: 'hearts' },
    );
    expect(getLegalMoves(state, p0)).toEqual([draw(p0)]);
  });

  it('may play a drawn card that fits, or end the turn', () => {
    const { state, p0, p1 } = table(
      { 'hand@P0': ['2D', '3D'], discard: ['KH'], stock: ['9C', '5H'] },
      { activeSuit: 'hearts' },
    );
    const drawn = applyMove(state, draw(p0));
    expect(drawn.pending).toEqual({ kind: 'mayPlayDrawnCard', player: p0, card: id('5H') });
    expect(getLegalMoves(drawn, p0)).toEqual([playCard(p0, '5H'), { player: p0, type: 'endTurn' }]);
    // Only the drawer learns which card it was.
    expect(viewFor(drawn, p0).pending?.card).toBe(id('5H'));
    expect(viewFor(drawn, p1).pending?.card).toBeUndefined();

    const played = applyMove(drawn, playCard(p0, '5H'));
    expect(played.cursor.current).toBe(p1);
    expect(played.zones.discard?.at(-1)?.id).toBe(id('5H'));

    const kept = applyMove(drawn, { player: p0, type: 'endTurn' });
    expect(kept.cursor.current).toBe(p1);
    expect(hand(kept, p0)).toContain(id('5H'));
  });

  it("passes the turn straight on when the drawn card doesn't fit", () => {
    const { state, p0, p1 } = table(
      { 'hand@P0': ['2D', '3D'], discard: ['KH'], stock: ['5H', '9C'] },
      { activeSuit: 'hearts' },
    );
    const next = applyMove(state, draw(p0));
    expect(next.pending).toBeNull();
    expect(next.cursor.current).toBe(p1);
  });

  it('reshuffles the discard pile (except its top card) when the stock runs out', () => {
    const { state, p0 } = table(
      { 'hand@P0': ['2D', '3D'], discard: ['2C', '3C', '4C', 'KH'], stock: [] },
      { activeSuit: 'hearts' },
    );
    // The withZones spare cards went to the stock, so empty it for this test.
    const s = draft(state);
    s.zones.discard = [...(s.zones.stock ?? []), ...(s.zones.discard ?? [])];
    s.zones.stock = [];
    const next = applyMove(s, draw(p0));
    expect(next.zones.discard?.map((c) => c.id)).toEqual([id('KH')]);
    expect(hand(next, p0)).toHaveLength(3);
    expect((next.zones.stock?.length ?? 0) + 3 + 1).toBe((s.zones.discard?.length ?? 0) + 2);
  });

  it('skips a player who can neither play nor draw', () => {
    // Without reshuffling, an empty stock means there is nothing to draw.
    const [phase] = sevensUp.phases;
    const noReshuffle: GameFile = { ...sevensUp, phases: [{ ...phase!, whenEmpty: {} }] };
    const { state, p0, p1, p2 } = table(
      { 'hand@P0': ['5H', '9H'], 'hand@P1': ['2D', '3D'], 'hand@P2': ['4H'], discard: ['KH'] },
      { activeSuit: 'hearts' },
      noReshuffle,
    );
    const s = draft(state);
    s.zones[`hand@${p2}`]?.unshift(...(s.zones.stock ?? []));
    s.zones.stock = [];
    const next = applyMove(s, playCard(p0, '5H'));
    expect(getLegalMoves(next, p1)).toEqual([]);
    expect(next.cursor.current).toBe(p2);
  });

  it('ends the round when a hand is empty and scores the cards left', () => {
    const { state, p0, p1, p2 } = table(
      {
        'hand@P0': ['5H'],
        'hand@P1': ['KC', '7D', 'AS'],
        'hand@P2': ['2C', '10D'],
        discard: ['KH'],
      },
      { activeSuit: 'hearts' },
    );
    const next = play(state, playCard(p0, '5H'));
    expect(next.round).toBe(2);
    const scores = getScores(next).players;
    expect(scores[p0]?.score).toBe(0);
    expect(scores[p1]?.score).toBe(10 + 20 + 15);
    expect(scores[p2]?.score).toBe(2 + 10);
  });

  it('eliminates players at 100 and ends with the last one left', () => {
    const { state, p0, p1, p2 } = table(
      { 'hand@P0': ['5H'], 'hand@P1': ['KC'], 'hand@P2': ['2C'], discard: ['KH'] },
      { activeSuit: 'hearts' },
    );
    const s = draft(state);
    (s.teams[p1] as { score: number }).score = 95;
    (s.teams[p2] as { score: number }).score = 99;
    const end = applyMove(s, playCard(p0, '5H'));
    expect(end.players.map((p) => p.active)).toEqual([0, 1, 2].map((seat) => seat === p0));
    expect(end.status).toBe('over');
    expect(end.winners).toEqual([p0]);
  });
});
