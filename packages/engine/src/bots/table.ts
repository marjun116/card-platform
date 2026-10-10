/** What a bot can work out about the table from its view: hands, trump, tricks, cards gone. */
import {
  type Card,
  cardCode,
  isJoker,
  RANKS,
  type Rank,
  type Suit,
  SUITS,
  suitedCard,
} from '../cards/card';
import { effectiveSuit, rankIndex, type TrickRule, trickWinnerIndex } from '../cards/order';
import type { PlayerId } from '../game/move';
import type { GameFile, PhaseDef } from '../game/types';
import type { PlayerView } from '../view';

/** The cards a seat holds, if this view can see them (your own, or a hand shown face up). */
export function handOf(view: PlayerView, seat: PlayerId): Card[] {
  const zone = view.zones[`hand@${seat}`];
  return zone?.kind === 'cards' ? zone.cards : [];
}

/** The phase being played, from the game file. */
export function phaseOf(file: GameFile, view: PlayerView): PhaseDef | undefined {
  return file.phases.find((p) => p.name === view.phase);
}

/** How tricks are won in this game right now. */
export interface TrickRules {
  ranks: readonly Rank[];
  trump: Suit | null;
  rule: TrickRule;
  bowers: boolean;
}

export function trickRules(file: GameFile, view: PlayerView): TrickRules {
  const order = file.cardOrder;
  const declared = typeof view.vars.trump === 'string' ? (view.vars.trump as Suit) : null;
  const trump = order?.trump === 'declared' ? declared : (order?.trump ?? null);
  const resolve = phaseOf(file, view)?.afterTrick?.find((e) => e.resolveTrick)?.resolveTrick;
  return {
    ranks: order?.ranks ?? RANKS,
    trump,
    rule: resolve ?? 'highestTrumpElseHighestLed',
    bowers: order?.bowers === true,
  };
}

/** The suit a card counts as (the left bower counts as trump). */
export function suitOf(rules: TrickRules, card: Card): Suit | null {
  return effectiveSuit(card, rules.trump, rules.bowers);
}

/**
 * How strong a card is, for "play high" and "play low": trumps above every
 * other suit, the bowers above other trumps. Jokers are weakest.
 */
export function power(rules: TrickRules, card: Card): number {
  if (isJoker(card)) return -1;
  const top = rules.ranks.length;
  const trump = rules.trump !== null && suitOf(rules, card) === rules.trump;
  if (trump && rules.bowers && card.rank === 'J') {
    return 2 * top + (card.suit === rules.trump ? 2 : 1);
  }
  return rankIndex(rules.ranks, card) + (trump ? top : 0);
}

/** Would this card win the trick as it stands (with these cards already played)? */
export function wouldWin(rules: TrickRules, played: readonly Card[], card: Card): boolean {
  const cards = [...played, card];
  return (
    trickWinnerIndex(cards, rules.rule, rules.trump, rules.ranks, rules.bowers) === cards.length - 1
  );
}

/** Which of the played cards is winning the trick so far (an index into `played`). */
export function winningIndex(rules: TrickRules, played: readonly Card[]): number {
  return trickWinnerIndex(played, rules.rule, rules.trump, rules.ranks, rules.bowers);
}

/** Card ids played face up this hand (to tricks or piles), as everyone saw them. */
export function playedThisRound(view: PlayerView): Set<string> {
  const seen = new Set<string>();
  for (const move of view.log.slice(view.roundStart)) {
    if ('hidden' in move) continue;
    if (move.type === 'playToTrick' || move.type === 'play' || move.type === 'discard') {
      seen.add(move.card);
    }
  }
  return seen;
}

/** The deck's suits and copies, for reasoning about which cards are still out. */
export function deckOf(file: GameFile): { suits: readonly Suit[]; copies: number } {
  const copies = file.deck.copies;
  return { suits: file.deck.suits ?? SUITS, copies: typeof copies === 'number' ? copies : 1 };
}

/**
 * Is this card the highest of its suit still out (every copy of every higher
 * card of the suit is in the bot's hand or already played)? Such a card wins
 * if its suit is led and nobody trumps it.
 */
export function isMaster(
  file: GameFile,
  rules: TrickRules,
  card: Card,
  mine: readonly Card[],
  gone: ReadonlySet<string>,
): boolean {
  if (isJoker(card)) return false;
  const suit = suitOf(rules, card);
  const strength = power(rules, card);
  const known = new Map<string, number>();
  for (const id of [...mine.map((c) => c.id), ...gone]) {
    const code = id.split('.')[0] as string;
    known.set(code, (known.get(code) ?? 0) + 1);
  }
  const deck = deckOf(file);
  for (const s of deck.suits) {
    for (const rank of rules.ranks) {
      const other = suitedCard(rank, s);
      if (suitOf(rules, other) !== suit || power(rules, other) <= strength) continue;
      if ((known.get(cardCode(other)) ?? 0) < deck.copies) return false;
    }
  }
  return true;
}

/** Cards of each suit in a hand (by the suit they count as). */
export function bySuit(rules: TrickRules, cards: readonly Card[]): Map<Suit | null, Card[]> {
  const groups = new Map<Suit | null, Card[]>();
  for (const card of cards) {
    const suit = suitOf(rules, card);
    groups.set(suit, [...(groups.get(suit) ?? []), card]);
  }
  return groups;
}

/**
 * A rough count of the tricks a hand should take: aces and kings (with a
 * guard), plus trumps beyond the third. Used for bids.
 */
export function estimateTricks(rules: TrickRules, cards: readonly Card[]): number {
  const top = rules.ranks.length - 1;
  let tricks = 0;
  for (const [suit, cardsOfSuit] of bySuit(rules, cards)) {
    if (suit === null) continue;
    const isTrump = suit === rules.trump;
    const ranks = cardsOfSuit.map((c) => power(rules, c) - (isTrump ? rules.ranks.length : 0));
    if (ranks.some((r) => r >= top)) tricks += 1;
    if (ranks.some((r) => r === top - 1) && cardsOfSuit.length >= 2) tricks += 0.7;
    if (isTrump) tricks += Math.max(0, cardsOfSuit.length - 3);
  }
  return tricks;
}
