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
  regroup,
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
    const choice: Move = { player: p, type: 'choose', value: 'othersGet26' };
    expect(turnPrompt(buildControls([choice]))).toBe('Your turn: make your choice.');
  });

  it('puts named choices in their own group in the middle of the table', () => {
    const choices: Move[] = [
      { player: p, type: 'choose', value: 'othersGet26' },
      { player: p, type: 'choose', value: 'shooterMinus26' },
    ];
    const controls = buildControls(choices);
    expect(controls.choices).toEqual(choices);
    expect(controls.other).toEqual([]);
    expect(hasDecisions(controls)).toBe(true);
  });

  it('knows which moves belong in the middle of the table', () => {
    expect(hasDecisions(buildControls([{ player: p, type: 'bid', value: 1 }]))).toBe(true);
    expect(hasDecisions(buildControls([{ player: p, type: 'draw', from: 'stock' }]))).toBe(true);
    const card: Move = { player: p, type: 'playToTrick', card: '9H.0' };
    expect(hasDecisions(buildControls([card]))).toBe(false);
  });
});

describe('arranged hands', () => {
  it('keeps "Sort into melds" apart from decisions, and treats going out as a card move', () => {
    const controls = buildControls([
      { player: p, type: 'sortHand' },
      { player: p, type: 'showHand', card: '9C.0', to: 'discard' },
      { player: p, type: 'discard', card: '9C.0', to: 'discard' },
    ]);
    expect(controls.sort).toEqual({ player: p, type: 'sortHand' });
    expect(hasDecisions(controls)).toBe(false);
    expect(controls.byCard.get('9C.0')?.map((m) => m.type)).toEqual(['showHand', 'discard']);
    // Two things the card can do, so a second tap doesn't play it.
    expect(quickMove(controls, '9C.0')).toBeNull();
  });

  it('puts selected cards into a group of their own, or takes them out', () => {
    const arrangement = {
      groups: [
        { cards: ['3H.0', '4H.0', '5H.0'], kind: 'run' as const, pure: true },
        { cards: ['9C.0', '9D.0'], kind: null, pure: false },
      ],
      deadwood: 18,
    };
    expect(regroup(arrangement, ['5H.0', '9C.0', 'KS.0'], 'group')).toEqual([
      ['3H.0', '4H.0'],
      ['9D.0'],
      ['5H.0', '9C.0', 'KS.0'],
    ]);
    expect(regroup(arrangement, ['9C.0', '9D.0'], 'ungroup')).toEqual([['3H.0', '4H.0', '5H.0']]);
  });
});

describe('buildControls: taking a pile by melding its top card, and going out', () => {
  const take = (cards?: string[], meld?: { zone: string; index: number }): Move => ({
    player: p,
    type: 'pickUpPile',
    from: 'discard',
    ...(cards ? { cards } : {}),
    ...(meld ? { meld } : {}),
  });

  it('chooses the hand cards for a pile take like a meld, and offers the rest at the pile', () => {
    const withCards = take(['7S.0', '7D.0']);
    const onto = take(undefined, { zone: 'melds@t0', index: 0 });
    const controls = buildControls([withCards, onto]);
    expect(controls.groups).toEqual([withCards]);
    expect(isCardUsable(controls, '7S.0')).toBe(true);
    expect(controls.byPile.get('discard')).toEqual([onto]);
    expect(movesForSelection(controls, ['7D.0', '7S.0'])).toEqual([withCards]);
    expect(groupHint(controls)).toEqual([{ type: 'pickUpPile', sizes: [2] }]);
  });

  it('makes going out with no discard a button', () => {
    const out: Move = { player: p, type: 'showHand', card: null, to: 'discard' };
    const discarding: Move = { player: p, type: 'showHand', card: '5D.0', to: 'discard' };
    const controls = buildControls([out, discarding]);
    expect(controls.other).toEqual([out]);
    expect(controls.byCard.get('5D.0')).toEqual([discarding]);
    expect(hasDecisions(controls)).toBe(true);
  });
});
