/**
 * Rule-of-thumb play for trick-taking games: win tricks cheaply (or duck
 * them), let a partner's winning card stand, lead winners, and throw away
 * the right cards when you can't follow suit.
 */
import { type Card, type Suit, SUITS } from '../cards/card';
import type { Move, PlayerId } from '../game/move';
import type { PlayerView } from '../view';
import type { BotInput, BotPart } from './types';
import {
  bySuit,
  handOf,
  isMaster,
  playedThisRound,
  power,
  suitOf,
  type TrickRules,
  trickRules,
  winningIndex,
  wouldWin,
} from './table';

export interface TrickGoals {
  /**
   * What the bot wants from tricks: as many as it can ("most"), as few as it
   * can ("fewest"), or exactly what its side bid ("bid": spades, Oh Hell).
   */
  aim: 'most' | 'fewest' | 'bid';
  /**
   * Points a card costs whoever takes it (hearts: 1 a heart, 13 the Q♠): such
   * cards are never won if it can be helped, and the costliest are dumped first.
   */
  points?: (card: Card) => number;
}

type Option = { move: Move; card: Card };

const lowest = (rules: TrickRules, list: readonly Option[]): Option =>
  list.reduce((a, b) => (power(rules, b.card) < power(rules, a.card) ? b : a));
const highest = (rules: TrickRules, list: readonly Option[]): Option =>
  list.reduce((a, b) => (power(rules, b.card) > power(rules, a.card) ? b : a));

/** Seats on the same team (a one-player team is just the player). */
function partners(view: PlayerView, a: PlayerId, b: PlayerId): boolean {
  return view.players[a]?.team === view.players[b]?.team;
}

/** Does this seat (or its side) still want tricks this hand? */
export function wantsTricks(goals: TrickGoals, view: PlayerView, seat: PlayerId): boolean {
  if (goals.aim === 'most') return true;
  if (goals.aim === 'fewest') return false;
  const player = view.players[seat];
  if (!player || typeof player.bid !== 'number') return false; // nil, or no bid yet
  const team = view.teams[player.team];
  if (!team || team.players.length === 1) return player.tricks < player.bid;
  const bid = team.players.reduce((sum, p) => {
    const b = view.players[p]?.bid;
    return sum + (typeof b === 'number' ? b : 0);
  }, 0);
  return team.tricks < bid;
}

/** Plays a card to the trick, when that's what the bot has to do. */
export function trickPlay(goals: TrickGoals): BotPart {
  return (input) => {
    const moves = input.legal.filter((m) => m.type === 'playToTrick');
    const first = moves[0];
    if (!first) return null;
    // Usually the bot's own seat; bridge's declarer also plays the dummy's cards.
    const seat = first.player;
    const hand = handOf(input.view, seat);
    const options = moves.flatMap((move): Option[] => {
      const card = 'card' in move ? hand.find((c) => c.id === move.card) : undefined;
      return card ? [{ move, card }] : [];
    });
    if (options.length === 0) return null;
    const rules = trickRules(input.file, input.view);
    const plays = input.view.trick?.plays ?? [];
    const played = plays.flatMap((p) => (p.card ? [p.card] : []));
    const want = wantsTricks(goals, input.view, seat);
    if (played.length === 0) return lead(input, goals, rules, options, hand, want).move;
    return follow(input.view, goals, rules, options, plays, played, seat, want).move;
  };
}

function follow(
  view: PlayerView,
  goals: TrickGoals,
  rules: TrickRules,
  options: Option[],
  plays: readonly { player: PlayerId; card: Card | null }[],
  played: Card[],
  seat: PlayerId,
  want: boolean,
): Option {
  const points = goals.points ?? (() => 0);
  const winners = options.filter((o) => wouldWin(rules, played, o.card));
  const losers = options.filter((o) => !winners.includes(o));
  const leader = plays[winningIndex(rules, played)]?.player ?? seat;
  const partnerWinning = leader !== seat && partners(view, leader, seat);
  const players = view.players.filter((p) => p.active && !p.sittingOut).length;
  const last = played.length === players - 1;
  const led = suitOf(rules, played[0] as Card);
  const following = options.some((o) => suitOf(rules, o.card) === led);

  if (want && !partnerWinning && winners.length > 0) {
    // Last to play: the cheapest winner. Otherwise a strong winner, but no trump
    // higher than needed.
    if (last) return lowest(rules, winners);
    const trumps = winners.filter((o) => suitOf(rules, o.card) === rules.trump);
    return trumps.length === winners.length ? lowest(rules, winners) : highest(rules, winners);
  }

  if (!want && losers.length > 0) {
    // Can't follow: dump point cards first, then the most dangerous high card.
    if (!following) {
      return losers.reduce((a, b) => {
        const score = (o: Option) => points(o.card) * 100 + power(rules, o.card);
        return score(b) > score(a) ? b : a;
      });
    }
    // Following: the highest card that still ducks under the winner.
    return highest(rules, losers);
  }

  if (!want) {
    // Every card wins: take it with the highest card that isn't a point card, saving
    // low cards for ducking later (and never adding points of our own if we can help it).
    const clean = options.filter((o) => points(o.card) === 0);
    return highest(rules, clean.length > 0 ? clean : options);
  }

  // Wanting tricks but not winning this one (or the partner has it): throw the cheapest
  // card, keeping trumps.
  const nonTrumps = options.filter((o) => suitOf(rules, o.card) !== rules.trump);
  return lowest(rules, nonTrumps.length > 0 ? nonTrumps : options);
}

function lead(
  input: BotInput,
  goals: TrickGoals,
  rules: TrickRules,
  options: Option[],
  hand: readonly Card[],
  want: boolean,
): Option {
  const points = goals.points ?? (() => 0);
  if (!want) {
    // Lead low, and not a point card if there's a choice.
    const clean = options.filter((o) => points(o.card) === 0);
    return lowest(rules, clean.length > 0 ? clean : options);
  }
  // A card nobody can beat in its suit (not a trump, so trumps can take tricks later).
  const gone = playedThisRound(input.view);
  const masters = options.filter(
    (o) => suitOf(rules, o.card) !== rules.trump && isMaster(input.file, rules, o.card, hand, gone),
  );
  if (masters.length > 0) return highest(rules, masters);
  // Otherwise low from the longest plain suit, to set up its other cards.
  const suits = bySuit(
    rules,
    options.map((o) => o.card),
  );
  let longest: Suit | null = null;
  for (const [suit, cards] of suits) {
    if (suit === null || suit === rules.trump) continue;
    if (longest === null || cards.length > (suits.get(longest)?.length ?? 0)) longest = suit;
  }
  const pool = options.filter((o) => longest !== null && suitOf(rules, o.card) === longest);
  return lowest(rules, pool.length > 0 ? pool : options);
}

// ---- other decisions trick-taking games share ----

/** Look at a face-down hand first (a blind bid is a gamble bots don't take). */
export const lookFirst: BotPart = ({ legal }) => legal.find((m) => m.type === 'lookAtHand') ?? null;

/** Passing cards: get rid of the strongest cards (point cards first), as in hearts. */
export function passHigh(goals: TrickGoals = { aim: 'fewest' }): BotPart {
  return (input) => {
    const passes = input.legal.filter((m) => m.type === 'pass');
    if (passes.length === 0) return null;
    const rules = trickRules(input.file, input.view);
    const hand = handOf(input.view, input.view.you);
    const score = (id: string) => {
      const card = hand.find((c) => c.id === id);
      if (!card) return 0;
      return power(rules, card) + (goals.points?.(card) ?? 0) * 100;
    };
    return passes.reduce((best, m) => {
      const total = (move: Move) =>
        move.type === 'pass' ? move.cards.reduce((sum, id) => sum + score(id), 0) : 0;
      return total(m) > total(best) ? m : best;
    });
  };
}

/** Naming trump: the suit the bot holds most of, high cards breaking ties. */
export const strongestTrump: BotPart = (input) => {
  const choices = input.legal.filter((m) => m.type === 'declareTrump');
  if (choices.length === 0) return null;
  const hand = handOf(input.view, input.view.you);
  return choices.reduce((best, m) =>
    suitStrength(input, hand, m) > suitStrength(input, hand, best) ? m : best,
  );
};

function suitStrength(input: BotInput, hand: readonly Card[], move: Move): number {
  if (move.type !== 'declareTrump') return -1;
  const rules = { ...trickRules(input.file, input.view), trump: move.suit };
  const cards = hand.filter((c) => suitOf(rules, c) === move.suit);
  return cards.length * 10 + cards.reduce((sum, c) => sum + power(rules, c), 0) / 10;
}

/** The suit a bot holds most of, if it holds any of those offered. */
export function longestSuit(hand: readonly Card[], suits: readonly Suit[] = SUITS): Suit | null {
  let best: Suit | null = null;
  let count = 0;
  for (const suit of suits) {
    const n = hand.filter((c) => 'suit' in c && c.suit === suit).length;
    if (n > count) {
      best = suit;
      count = n;
    }
  }
  return best;
}
