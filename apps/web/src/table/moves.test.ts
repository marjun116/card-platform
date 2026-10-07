import type { Move } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { createGame, gameMessage, passing, playUntil, spades } from '../test/games';
import {
  buildControls,
  groupHint,
  hasDecisions,
  isCardUsable,
  movesForSelection,
  quickMove,
  turnPrompt,
} from './moves';

const p = 0;

describe('buildControls', () => {
  it('turns bids into a bid picker (spades)', () => {
    const state = createGame(spades, {}, 4, 'moves');
    const controls = buildControls(gameMessage(state, state.cursor.current).legalMoves);
    expect(controls.bids.map((b) => b.value)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      'nil',
    ]);
    expect(controls.byCard.size).toBe(0);
  });

  it('only lets playable cards be used (spades, following suit)', () => {
    const state = playUntil(
      createGame(spades, {}, 4, 'moves'),
      (s) => (s.trick?.plays.length ?? 0) === 1,
    );
    const seat = state.cursor.current;
    const message = gameMessage(state, seat);
    const controls = buildControls(message.legalMoves);
    const hand = message.view.zones[`hand@${seat}`];
    if (hand?.kind !== 'cards') throw new Error('expected cards');
    const usable = hand.cards.filter((c) => isCardUsable(controls, c.id));
    expect(usable.length).toBe(message.legalMoves.length);
    expect(usable.length).toBeGreaterThan(0);
  });

  it('groups pass moves and matches them to a selection in any order (hearts-like)', () => {
    const state = createGame(passing, {}, 4, 'moves');
    const controls = buildControls(gameMessage(state, state.cursor.current).legalMoves);
    expect(groupHint(controls)).toEqual([{ type: 'pass', sizes: [3] }]);
    const first = controls.groups[0];
    if (!first) throw new Error('expected a pass move');
    const reversed = [...first.cards].reverse();
    expect(movesForSelection(controls, reversed)).toEqual([first]);
    expect(movesForSelection(controls, reversed.slice(0, 2))).toEqual([]);
    // A card used in group moves isn't played by tapping it twice.
    expect(quickMove(controls, first.cards[0] as string)).toBeNull();
  });

  it('sorts the other kinds of moves', () => {
    const moves: Move[] = [
      { player: p, type: 'draw', from: 'stock' },
      { player: p, type: 'pickUpPile', from: 'discard' },
      { player: p, type: 'chooseSuit', suit: 'hearts' },
      { player: p, type: 'endTurn' },
      { player: p, type: 'discard', card: 'QH.0', to: 'discard' },
      { player: p, type: 'layOff', card: 'QH.0', meld: { zone: 'melds@1', index: 0 } },
    ];
    const controls = buildControls(moves);
    expect([...controls.byPile.keys()]).toEqual(['stock', 'discard']);
    expect(controls.suits.map((s) => s.suit)).toEqual(['hearts']);
    expect(controls.other).toEqual([{ player: p, type: 'endTurn' }]);
    expect(movesForSelection(controls, ['QH.0'])).toHaveLength(2);
    // It could do two things, so tapping it twice doesn't pick one.
    expect(quickMove(controls, 'QH.0')).toBeNull();
  });

  it('plays a card on the second tap when that is all it can do', () => {
    const move: Move = { player: p, type: 'playToTrick', card: '9H.0' };
    expect(quickMove(buildControls([move]), '9H.0')).toEqual(move);
  });

  it('says what the player has to do', () => {
    const bid: Move = { player: p, type: 'bid', value: 3 };
    expect(turnPrompt(buildControls([bid]))).toBe('Your turn: choose your bid.');
    expect(turnPrompt(buildControls([{ player: p, type: 'playToTrick', card: '9H.0' }]))).toBe(
      'Your turn: choose a card.',
    );
    const drawOrDiscard: Move[] = [
      { player: p, type: 'draw', from: 'stock' },
      { player: p, type: 'discard', card: 'QH.0', to: 'discard' },
    ];
    expect(turnPrompt(buildControls(drawOrDiscard))).toBe(
      'Your turn: draw a card or choose a card.',
    );
    expect(turnPrompt(buildControls([{ player: p, type: 'endTurn' }]))).toBe('Your turn.');
  });

  it('knows which moves belong in the middle of the table', () => {
    expect(hasDecisions(buildControls([{ player: p, type: 'bid', value: 1 }]))).toBe(true);
    expect(hasDecisions(buildControls([{ player: p, type: 'draw', from: 'stock' }]))).toBe(true);
    const card: Move = { player: p, type: 'playToTrick', card: '9H.0' };
    expect(hasDecisions(buildControls([card]))).toBe(false);
  });
});
