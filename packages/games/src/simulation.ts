/**
 * The random-play simulation every built-in game must pass (CLAUDE.md):
 * 1,000 seeded games of random legal moves with no crashes and no illegal
 * states, checked after every move by the engine's harness.
 *
 * Purely random play is shallow in some games (random spades bids sink both
 * teams within a couple of rounds), so each game also plays a smaller batch
 * with a "sensible" player that reaches the parts random play never does.
 */
import {
  bestArrangeMove,
  type Strategy,
  preferring,
  randomStrategy,
  simulateMany,
} from '@card-table/engine/testing';
import { type Move, type OptionValue, viewFor } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { type BuiltInGameName, builtInGames } from './index';

/**
 * Random play for games where players arrange their hands: random legal moves,
 * except that it melds, lays off or goes out whenever it can, and arranges its
 * hand after each draw (with "Sort into melds", or the same arrangement made by
 * hand when a house rule switches that off). Purely random players never
 * arrange (or knock), so nobody would ever go out.
 */
const arranging =
  (choose: Strategy): Strategy =>
  (moves, state, pick) => {
    const out = moves.filter(
      (m) =>
        ['meld', 'layOff', 'showHand'].includes(m.type) ||
        (m.type === 'choose' && ['knock', 'gin', 'bigGin'].includes(m.value)),
    );
    if (out.length > 0) return out[pick(out.length)] as Move;
    const player = state.cursor.current;
    if (state.log.at(-1)?.type === 'draw') {
      return moves.find((m) => m.type === 'sortHand') ?? bestArrangeMove(state, player);
    }
    return choose(
      moves.filter((m) => m.type !== 'sortHand'),
      state,
      pick,
    );
  };

/** Discards the loose card worth the most, keeping its melds together. */
const keepMelds: Strategy = (moves, state, pick) => {
  const discards = moves.filter((m) => m.type === 'discard');
  const arrangement = viewFor(state, state.cursor.current).arrangement;
  if (discards.length === 0 || !arrangement) return randomStrategy(moves, state, pick);
  const grouped = new Set(arrangement.groups.filter((g) => g.kind).flatMap((g) => g.cards));
  const worth = (m: Move) => {
    if (m.type !== 'discard') return -1;
    const rank = m.card.split('.')[0]?.slice(0, -1) ?? '';
    const points = ['J', 'Q', 'K'].includes(rank) ? 10 : rank === 'A' ? 1 : Number(rank) || 0;
    return grouped.has(m.card) ? -1 : points;
  };
  return discards.reduce((best, m) => (worth(m) > worth(best) ? m : best));
};

/** Usually the costliest loose card, sometimes any random move. */
const mostlyKeepMelds: Strategy = (moves, state, pick) =>
  pick(3) === 0 ? randomStrategy(moves, state, pick) : keepMelds(moves, state, pick);

/**
 * In an auction, only pass or make the lowest bid on offer. Random bids are
 * mostly far too high: every hand is set and scores fall for ever.
 */
const lowBidding =
  (choose: Strategy): Strategy =>
  (moves, state, pick) => {
    const bids = moves.flatMap((m) => (m.type === 'bid' && typeof m.value === 'number' ? [m] : []));
    if (bids.length === 0) return choose(moves, state, pick);
    const lowest = bids.reduce((a, b) => ((a.value as number) <= (b.value as number) ? a : b));
    const options = [lowest, ...moves.filter((m) => m.type === 'passBid')];
    return options[pick(options.length)] as Move;
  };

/**
 * Random canasta: takes the pile whenever it can, melds, lays off and goes out
 * whenever it can (asking first, and answering at random), and sorts its hand
 * after drawing. Purely random players never arrange their cards, so they'd
 * never meld.
 */
const canastaPlayer =
  (choose: Strategy): Strategy =>
  (moves, state, pick) => {
    const take = moves.filter((m) => m.type === 'pickUpPile');
    if (take.length > 0) return take[pick(take.length)] as Move;
    const meld = moves.filter(
      (m) =>
        ['meld', 'layOff', 'showHand'].includes(m.type) ||
        (m.type === 'choose' && ['layDown', 'askToGoOut'].includes(m.value)),
    );
    if (meld.length > 0) return meld[pick(meld.length)] as Move;
    const last = state.log.at(-1);
    const drew =
      (last?.type === 'draw' || last?.type === 'pickUpPile') &&
      last.player === state.cursor.current;
    const sort = moves.find((m) => m.type === 'sortHand');
    if (drew && sort) return sort;
    return choose(
      moves.filter((m) => m.type !== 'sortHand'),
      state,
      pick,
    );
  };

/** How each game is played randomly, where plain random moves wouldn't do. */
const RANDOM: Partial<Record<BuiltInGameName, Strategy>> = {
  rummy: arranging(randomStrategy),
  // Random discards almost never get deadwood down to 10, so every hand would be a draw.
  'gin-rummy': arranging(mostlyKeepMelds),
  // Throwing in costs the bid, so random players do it only now and then.
  pinochle: lowBidding((moves, state, pick) =>
    moves.some((m) => m.type === 'choose' && m.value === 'throwIn') && pick(4) > 0
      ? (moves.find((m) => m.type === 'choose' && m.value === 'play') as Move)
      : randomStrategy(moves, state, pick),
  ),
  canasta: canastaPlayer(randomStrategy),
};

/**
 * House rules every simulated game of this kind uses. Rummy turns the discard
 * pile over only once: with no limit a hand can stall for good (see "Running out
 * of stock" in docs/decisions.md).
 */
const BASE_OPTIONS: Partial<Record<BuiltInGameName, Record<string, OptionValue>>> = {
  rummy: { emptyStock: 'once' },
};

/** A player that plays like a person would, at least a little. */
const SENSIBLE: Record<BuiltInGameName, Strategy> = {
  // Bid low, so teams make their bids, games run to 500 and bags pile up.
  spades: preferring((m) => m.type === 'bid' && typeof m.value === 'number' && m.value <= 3),
  // Duck tricks with low cards, so points spread out and games last.
  hearts: preferring((m) => m.type === 'playToTrick' && /^[2-7][CDHS]/.test(m.card)),
  // Play a card whenever possible instead of drawing.
  'crazy-eights': preferring((m) => m.type === 'play'),
  // Keep melds together and throw away the costliest loose card.
  rummy: arranging(keepMelds),
  'gin-rummy': arranging(keepMelds),
  // Mostly play with a partner, so more hands are ordinary partnership hands.
  euchre: preferring((m) => m.type === 'choose' && m.value === 'withPartner'),
  // Bid low, so some bids are made and scores spread out.
  'oh-hell': preferring((m) => m.type === 'bid' && typeof m.value === 'number' && m.value <= 1),
  // Keep fives and ten-cards for fifteens, so hands score and games reach 121 sooner.
  cribbage: preferring((m) => m.type === 'discard' && !/^(5|10|J|Q|K)[CDHS]/.test(m.card)),
  // Only the first player to speak bids (the minimum), so bids are usually made.
  // Never discards a wild card (that freezes the pile), so piles are taken more often.
  canasta: canastaPlayer(
    preferring((m) => m.type !== 'discard' || !/^(2[CDHS]|JOKER)/.test(m.card)),
  ),
  pinochle: (moves, state, pick) => {
    const pass = moves.find((m) => m.type === 'passBid');
    if (pass && state.vars.bidder != null) return pass;
    return lowBidding(randomStrategy)(
      moves.filter((m) => m.type !== 'passBid'),
      state,
      pick,
    );
  },
};

/**
 * House rules that change how a game plays, simulated on top of the random
 * games. Each set is played in a batch of its own.
 */
const VARIANTS: Partial<Record<BuiltInGameName, Record<string, OptionValue>[]>> = {
  spades: [{ nil: false, blindNil: true, targetScore: 300 }],
  hearts: [
    { moon: 'shooterChooses', jackOfDiamonds: true, passing: 'rotateNoHold', shareTies: true },
    {
      moon: 'shooterMinus26',
      pointsOnFirstTrick: true,
      queenBreaksHearts: true,
      passing: 'left',
      firstLead: 'leftOfDealer',
      targetScore: 50,
    },
    { leadHeartsAnytime: true, passing: 'none', targetScore: 150 },
  ],
  'crazy-eights': [
    {
      drawing: 'one',
      reshuffle: true,
      drawTwo: true,
      stackTwos: true,
      jacksSkip: true,
      acesReverse: true,
      queenOfSpades: true,
      targetScore: 200,
    },
    {
      scoring: 'penalty',
      drawing: 'upToThree',
      cards: 8,
      starterEight: 'counts',
      drawTwo: true,
      reshuffle: true,
      // Random players drawing up to 3 with reshuffles build huge hands, so keep it to one.
      targetScore: 'oneHand',
    },
    { cards: 7, targetScore: 200 },
  ],
  rummy: [
    { melding: 'inHand', aces: 'both', sortButton: false, emptyStock: 'once' },
    {
      cards: 'hoyle',
      jokers: 'none',
      pureRun: false,
      scoring: 'penalty',
      mustDiscard: true,
      throwBack: true,
      emptyStock: 'end',
      targetScore: 150,
    },
    { cards: 10, jokers: 'printed', aces: 'high', rummyBonus: false, targetScore: 250 },
  ],
  'gin-rummy': [
    {
      ginBonus: 50,
      undercutBonus: 10,
      bigGin: 31,
      aces: 'both',
      sortButton: false,
      targetScore: 150,
    },
    { oklahoma: true, bonuses: false, bigGin: 50 },
    { ginBonus: 20, undercutBonus: 20, targetScore: 250 },
  ],
  euchre: [
    { stickTheDealer: true, euchreLoner4: true, targetScore: 5 },
    { defendAlone: true, canadianLoner: true, loneMarch: 5, targetScore: 11 },
  ],
  'oh-hell': [
    { sequence: 'downUp', maxCards: 7, hook: false, scoring: 'perTrick', topNoTrump: true },
    { sequence: 'down', maxCards: 'max', scoring: 'penalty', blindBids: true },
    { sequence: 'up', maxCards: 13 },
  ],
  canasta: [
    { drawTwo: true, alwaysFrozen: true, targetScore: 3000 },
    { askPartner: true, concealedNeedsPartner: true, wildLimit: 'none' },
  ],
  pinochle: [
    { passing: false, mustBeat: false, throwIn: true, dealerMustBid: false },
    { classic: true, targetScore: 100, minBid: 25 },
    { minBid: 25, targetScore: 200 },
  ],
  cribbage: [
    { fiveCard: true, targetScore: 61 },
    { cribFourFlush: true, handFlushFive: true, hisHeels: false },
    { targetScore: 61 },
  ],
};
const VARIANT_GAMES = 200;

const RANDOM_GAMES = 1_000;
const SENSIBLE_GAMES = 50;

/** Hands a sensible game should last on average, so it reaches its later rounds. */
const MIN_ROUNDS: Record<BuiltInGameName, number> = {
  spades: 5,
  hearts: 5,
  // The winner collects 50 per 8, so games to 100 are short.
  'crazy-eights': 2,
  rummy: 2,
  'gin-rummy': 2,
  euchre: 5,
  // A full game is 19 hands with 3–5 players.
  'oh-hell': 10,
  // About 8 hands to reach 121 with two players, fewer with three or four.
  cribbage: 5,
  pinochle: 4,
  // A game to 5,000 takes a few hands of good melding.
  canasta: 3,
};

/**
 * The simulation tests for one game. Each game has its own test file
 * (`<game>.simulation.test.ts`), so games are simulated in parallel.
 */
export function simulationTests(game: BuiltInGameName): void {
  describe(`${game} simulation`, () => simulate(game));
}

function simulate(game: BuiltInGameName): void {
  const name = game;
  const file = builtInGames[game];
  const random = RANDOM[game] ?? randomStrategy;
  const base = BASE_OPTIONS[game] ?? {};

  it(`plays ${RANDOM_GAMES} random games without a problem`, { timeout: 600_000 }, () => {
    const report = simulateMany(file, {
      games: RANDOM_GAMES,
      seedPrefix: `${name}-random`,
      strategy: random,
      options: base,
    });
    expect(report.games).toBe(RANDOM_GAMES);
  });

  it(`plays ${SENSIBLE_GAMES} sensible games without a problem`, { timeout: 300_000 }, () => {
    const report = simulateMany(file, {
      games: SENSIBLE_GAMES,
      seedPrefix: `${name}-sensible`,
      strategy: SENSIBLE[game],
      options: base,
    });
    // These games should get past the first couple of rounds.
    expect(report.averageRounds).toBeGreaterThan(MIN_ROUNDS[game]);
  });

  const variants = VARIANTS[game] ?? [];
  it.each(variants.map((options) => [JSON.stringify(options), options] as const))(
    `plays ${VARIANT_GAMES} random games with house rules %s`,
    { timeout: 300_000 },
    (label, options) => {
      const report = simulateMany(file, {
        games: VARIANT_GAMES,
        seedPrefix: `${name}-${label}`,
        strategy: random,
        options: { ...base, ...options },
      });
      expect(report.games).toBe(VARIANT_GAMES);
    },
  );
}
