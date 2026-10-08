/**
 * Building blocks added for euchre and Oh Hell but meant for any game:
 * bowers, trump declarations and bids whose conditions see the suit or bid in
 * question, and a seat sitting out a round.
 */
import { describe, expect, it } from 'vitest';
import { passing, tinyTricks } from './__fixtures__/games';
import { card, hand, withZones } from './testing';
import { applyMove, createGame, getLegalMoves, viewFor } from './api';
import { effectiveSuit, trickWinnerIndex } from './cards/order';
import type { Move } from './game/move';
import type { GameFile } from './game/types';
import { validate } from './schema/validate';

const EUCHRE_RANKS = ['9', '10', 'J', 'Q', 'K', 'A'] as const;
const cards = (...specs: string[]) => specs.map(card);

describe('bowers', () => {
  it('makes the other jack of trump’s colour count as trump', () => {
    expect(effectiveSuit(card('JD'), 'hearts', true)).toBe('hearts');
    expect(effectiveSuit(card('JD'), 'hearts', false)).toBe('diamonds');
    expect(effectiveSuit(card('JC'), 'hearts', true)).toBe('clubs');
    expect(effectiveSuit(card('JH'), 'hearts', true)).toBe('hearts');
  });

  it('ranks the right bower, then the left bower, above the ace of trump', () => {
    const win = (...specs: string[]) =>
      trickWinnerIndex(cards(...specs), 'highestTrumpElseHighestLed', 'hearts', EUCHRE_RANKS, true);
    expect(win('AH', 'JD', 'JH', 'KH')).toBe(2); // right bower
    expect(win('AH', 'JD', 'KH', '9H')).toBe(1); // left bower beats the ace
    expect(win('AS', 'JD', 'KS', '9S')).toBe(1); // the left bower trumps a spade lead
    // Without bowers, the jack of diamonds is just a diamond.
    expect(
      trickWinnerIndex(
        cards('AS', 'JD', 'KS'),
        'highestTrumpElseHighestLed',
        'hearts',
        EUCHRE_RANKS,
      ),
    ).toBe(0);
  });

  it('makes a left bower follow trump, not its printed suit', () => {
    const file: GameFile = {
      ...tinyTricks,
      deck: { ranks: ['9', '10', 'J', 'Q', 'K', 'A'], suits: ['hearts', 'diamonds'] },
      cardOrder: { ranks: [...EUCHRE_RANKS], trump: 'hearts', bowers: true },
      setup: { shuffle: false, deal: { to: 'hand', count: 6 } },
      phases: [
        {
          ...tinyTricks.phases[0]!,
          afterTrick: [
            { resolveTrick: 'highestTrumpElseHighestLed' },
            { moveTrick: 'won', of: 'winner' },
          ],
        },
      ],
    };
    const base = createGame(file, {}, 2, 'bowers');
    const L = base.cursor.current;
    const D = 1 - L;
    const state = withZones(
      base,
      { [`hand@${L}`]: ['AH', '9D'], [`hand@${D}`]: ['JD', 'KD'] },
      `won@${L}`,
    );
    const led = applyMove(state, { player: L, type: 'playToTrick', card: card('AH').id });
    // Hearts led: the jack of diamonds is a heart now, so D must play it.
    expect(getLegalMoves(led, D)).toEqual([
      { player: D, type: 'playToTrick', card: card('JD').id },
    ]);
    const won = applyMove(led, { player: D, type: 'playToTrick', card: card('JD').id });
    expect(won.lastTrick?.winner).toBe(D);
  });
});

describe('naming trump with a condition on the suit', () => {
  const file: GameFile = {
    ...tinyTricks,
    cardOrder: { ranks: ['2', '3', '4', '5'], trump: 'declared' },
    phases: [
      {
        name: 'trump',
        until: 'state.trump != null',
        actions: [{ type: 'declareTrump', if: "suit != 'spades' && suit != 'clubs'" }],
      },
      ...tinyTricks.phases,
    ],
  };

  it('offers only the suits the condition allows', () => {
    const state = createGame(file, {}, 2, 'name');
    const p = state.cursor.current;
    expect(getLegalMoves(state, p)).toEqual([
      { player: p, type: 'declareTrump', suit: 'diamonds' },
      { player: p, type: 'declareTrump', suit: 'hearts' },
    ]);
  });

  it('only lets declareTrump conditions use "suit"', () => {
    const bad: GameFile = {
      ...file,
      phases: [
        {
          name: 'trump',
          until: 'state.trump != null',
          actions: [{ type: 'passBid', if: "suit == 'hearts'" }],
        },
        ...tinyTricks.phases,
      ],
    };
    const result = validate(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/only a declareTrump action/);
  });
});

describe('sitting out a round', () => {
  /** Four players: the first may go alone, which sits their partner out; then tricks. */
  const lone: GameFile = {
    ...passing,
    meta: {
      name: 'Lone',
      players: 4,
      teams: [
        [0, 2],
        [1, 3],
      ],
    },
    phases: [
      {
        name: 'decide',
        rounds: 1,
        actions: [
          {
            type: 'choose',
            values: ['alone', 'no'],
            set: 'state.choice',
            if: 'state.choice == null',
            effects: [{ if: "state.choice == 'alone'", sitOut: '(player.id + 2) % 4' }],
          },
        ],
      },
      { ...passing.phases[1]!, repeat: 2 },
    ],
    scoring: { perPlayer: [] },
    endCondition: { when: 'round >= 2', winner: 'highestScore', ties: 'share' },
  };
  const choose = (player: number, value: string): Move => ({ player, type: 'choose', value });

  it('skips the seat for the rest of the round, with one card fewer in each trick', () => {
    const state = createGame(lone, {}, 4, 'lone');
    const first = state.cursor.current;
    const partner = (first + 2) % 4;
    const after = applyMove(state, choose(first, 'alone'));
    expect(after.players[partner]?.sittingOut).toBe(true);
    expect(viewFor(after, 0).players[partner]?.sittingOut).toBe(true);
    // The others had nothing to choose (the choice was made), and play began.
    expect(after.file.phases[after.cursor.phase]?.name).toBe('play');
    expect(getLegalMoves(after, partner)).toEqual([]);

    // A trick of three: the partner is passed over.
    let s = after;
    const seats: number[] = [];
    for (let i = 0; i < 3; i++) {
      seats.push(s.cursor.current);
      s = applyMove(s, getLegalMoves(s, s.cursor.current)[0] as Move);
    }
    expect(seats).not.toContain(partner);
    expect(s.lastTrick?.plays).toHaveLength(3);
    expect(hand(s, partner)).toHaveLength(13);
  });

  it('brings everyone back for the next round', () => {
    const state = createGame(lone, {}, 4, 'lone');
    let s = applyMove(state, choose(state.cursor.current, 'alone'));
    while (s.round === 1) s = applyMove(s, getLegalMoves(s, s.cursor.current)[0] as Move);
    expect(s.players.every((p) => !p.sittingOut)).toBe(true);
  });
});

describe('bids with a condition on the bid', () => {
  const file: GameFile = {
    ...tinyTricks,
    phases: [
      {
        name: 'bidding',
        rounds: 1,
        actions: [
          // Up to the cards held, and the dealer may not bid exactly 2.
          {
            type: 'bid',
            values: { range: [0, 6] },
            if: 'bid <= hand.count && !(player.isDealer && bid == 2)',
          },
        ],
      },
      ...tinyTricks.phases,
    ],
  };

  it('offers only the bids the condition allows', () => {
    const state = createGame(file, {}, 2, 'bids');
    const first = state.cursor.current;
    const bids = (seat: number, s = state) =>
      getLegalMoves(s, seat).flatMap((m) => (m.type === 'bid' ? [m.value] : []));
    expect(bids(first)).toEqual([0, 1, 2, 3, 4]);
    const next = applyMove(state, { player: first, type: 'bid', value: 1 });
    expect(bids(1 - first, next)).toEqual([0, 1, 3, 4]);
  });

  it('only lets bid conditions use "bid"', () => {
    const result = validate({
      ...file,
      phases: [
        { name: 'p', rounds: 1, actions: [{ type: 'passBid', if: 'bid == 1' }] },
        ...tinyTricks.phases,
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/only a bid action/);
  });
});
