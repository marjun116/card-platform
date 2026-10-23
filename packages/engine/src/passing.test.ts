/** Passing cards (hearts-style): one at a time, held until everyone has passed. */
import { describe, expect, it } from 'vitest';
import { passing } from './__fixtures__/games';
import { hand, play } from './testing';
import { passTarget } from './actions/cardMovement';
import { applyMove, createGame, getLegalMoves, viewFor } from './api';
import type { Move } from './game/move';
import { settle } from './game/flow';
import { startRound } from './game/setup';
import { draft, type GameState } from './game/state';

const firstThree = (state: GameState, seat: number): Move => ({
  player: seat,
  type: 'pass',
  cards: hand(state, seat).slice(0, 3),
});

describe('passing', () => {
  it('offers every choice of three cards', () => {
    const state = createGame(passing, {}, 4, 'pass');
    expect(getLegalMoves(state, state.cursor.current)).toHaveLength(286);
  });

  it('holds passed cards out of sight until everyone has passed', () => {
    const state = createGame(passing, {}, 4, 'pass');
    const giver = state.cursor.current;
    const receiver = (giver + 1) % 4; // round 1 passes left
    const move = firstThree(state, giver);
    const next = applyMove(state, move);

    expect(hand(next, giver)).toHaveLength(10);
    expect(hand(next, receiver)).toHaveLength(13);
    expect(next.passing[receiver]?.map((c) => c.id).sort()).toEqual(
      move.type === 'pass' ? [...move.cards].sort() : [],
    );
    // Nobody can see cards in transit, and others don't learn which cards were passed.
    const receiverView = JSON.stringify(viewFor(next, receiver));
    for (const cardId of move.type === 'pass' ? move.cards : []) {
      expect(receiverView).not.toContain(cardId);
    }
    expect(viewFor(next, receiver).log).toEqual([{ player: giver, type: 'pass', hidden: true }]);
    expect(viewFor(next, giver).log).toEqual(next.log);
  });

  it('delivers all passes together, then starts the tricks', () => {
    let state = createGame(passing, {}, 4, 'pass');
    const before = state.players.map((p) => hand(state, p.id));
    for (let i = 0; i < 4; i++) state = applyMove(state, firstThree(state, state.cursor.current));

    expect(state.file.phases[state.cursor.phase]?.name).toBe('play');
    for (let seat = 0; seat < 4; seat++) {
      const from = (seat + 3) % 4; // received from the right
      expect(hand(state, seat)).toHaveLength(13);
      expect(hand(state, seat)).toEqual(expect.arrayContaining(before[from]?.slice(0, 3) ?? []));
    }
    expect(state.passing.every((cards) => cards.length === 0)).toBe(true);
  });

  it('rotates left, right, across, then hold', () => {
    const state = draft(createGame(passing, {}, 4, 'rotate'));
    const targets = [1, 2, 3, 4].map((round) => {
      state.round = round;
      return passTarget(state, 0, 'rotate');
    });
    expect(targets).toEqual([1, 3, 2, null]);
  });

  it('skips passing entirely on a hold round', () => {
    const state = draft(createGame(passing, {}, 4, 'hold'));
    state.round = 4;
    startRound(state);
    settle(state);
    // Nobody had a pass to make, so the game moved straight on to the tricks.
    expect(state.file.phases[state.cursor.phase]?.name).toBe('play');
    for (let seat = 0; seat < 4; seat++) expect(hand(state, seat)).toHaveLength(13);
  });

  it('passes directly to the named direction', () => {
    const state = createGame(passing, {}, 4, 'dir');
    expect(passTarget(state, 0, 'left')).toBe(1);
    expect(passTarget(state, 0, 'right')).toBe(3);
    expect(passTarget(state, 0, 'across')).toBe(2);
    const three = draft(state);
    three.players[3] = { ...(three.players[3] as GameState['players'][number]), active: false };
    expect(passTarget(three, 0, 'across')).toBeNull();
    expect(passTarget(three, 0, 'rotate')).toBe(1);
  });

  it('tells each player who they passed to and, once delivered, who passed to them', () => {
    let state = createGame(passing, {}, 4, 'who');
    const giver = state.cursor.current;
    const receiver = (giver + 1) % 4;
    const move = firstThree(state, giver);
    const cards = move.type === 'pass' ? [...move.cards].sort() : [];
    state = applyMove(state, move);

    expect(viewFor(state, giver).passes).toEqual([
      { from: giver, to: receiver, cards, delivered: false },
    ]);
    // The receiver knows a pass is coming, but not what's in it.
    expect(viewFor(state, receiver).passes).toEqual([
      { from: giver, to: receiver, cards: [], delivered: false },
    ]);
    // Someone not involved hears nothing.
    expect(viewFor(state, (giver + 2) % 4).passes).toEqual([]);

    for (let i = 0; i < 3; i++) state = applyMove(state, firstThree(state, state.cursor.current));
    expect(viewFor(state, receiver).passes).toContainEqual({
      from: giver,
      to: receiver,
      cards,
      delivered: true,
    });
    expect(viewFor(state, receiver).passes).toHaveLength(2);
  });

  it('says who you pass to and who passes to you, before anyone has passed', () => {
    // Round 1 passes left: each seat to the next, so each hears from the one before.
    const state = createGame(passing, {}, 4, 'plan');
    for (let seat = 0; seat < 4; seat++) {
      expect(viewFor(state, seat).passing).toEqual({ to: (seat + 1) % 4, from: (seat + 3) % 4 });
    }
    // Round 2 passes right.
    const second = draft(state);
    second.round = 2;
    expect(viewFor(second, 0).passing).toEqual({ to: 3, from: 1 });
    // Once the passes are delivered and the tricks start, there's no pass under way.
    const passed = [0, 1, 2, 3].reduce((s) => applyMove(s, firstThree(s, s.cursor.current)), state);
    expect(viewFor(passed, 0).passing).toBeNull();
  });

  it('says nothing about passing on a hold round', () => {
    const state = draft(createGame(passing, {}, 4, 'hold-plan'));
    state.round = 4;
    startRound(state);
    settle(state);
    expect(viewFor(state, 0).passing).toBeNull();
  });

  it('forgets the passes when the next round starts', () => {
    const state = draft(createGame(passing, {}, 4, 'reset'));
    state.passes.push({ from: 0, to: 1, cards: [], delivered: true });
    state.round = 2;
    startRound(state);
    expect(state.passes).toEqual([]);
  });

  it('plays tricks after passing like any trick game', () => {
    let state = createGame(passing, {}, 4, 'tricks');
    for (let i = 0; i < 4; i++) state = applyMove(state, firstThree(state, state.cursor.current));
    const leader = state.cursor.current;
    const lead = getLegalMoves(state, leader)[0] as Move;
    const next = play(state, lead);
    expect(next.trick?.plays).toHaveLength(1);
  });
});
