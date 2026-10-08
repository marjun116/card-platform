/**
 * Melds with wild cards, for games with `meldRules`: is a group of cards a
 * valid set or run (and is it a pure run)? And the best way to split a hand
 * into melds, for "Sort into melds" and for bots. Nothing here knows any
 * game; the rules come from the game file.
 */
import { type Card, cardRank, cardSuit, isJoker, RANKS, type Rank } from '../cards/card';
import type { MeldKind } from './melds';

export type AcesRule = 'low' | 'high' | 'both';

export interface MeldRules {
  kinds: readonly MeldKind[];
  minSize: number;
  aces: AcesRule;
  /** Can this card stand in for any other? (Printed jokers always can.) */
  isWild: (card: Card) => boolean;
  /** Sets may repeat a suit and have any number of cards (several decks). */
  anySuits?: boolean;
  /** The game's own condition on a meld (`meldRules.allowed`); true if it has none. */
  allows?: (cards: readonly Card[], info: GroupInfo) => boolean;
}

export interface GroupInfo {
  kind: MeldKind;
  /** A run with every card standing for itself (no wild card filling in). */
  pure: boolean;
}

/** What a meld condition can read about a group: `meld.rank`, `meld.wilds`, … */
export interface MeldFacts {
  kind: MeldKind;
  size: number;
  isPure: boolean;
  usesWild: boolean;
  /** The rank of a set's natural cards (null for a run, or a set of only wild cards). */
  rank: string | null;
  /** Cards standing for themselves, and wild cards. */
  naturals: number;
  wilds: number;
}

export function meldFacts(cards: readonly Card[], info: GroupInfo, rules: MeldRules): MeldFacts {
  const isWild = wildIn(rules);
  const naturals = cards.filter((c) => !isWild(c));
  const rank = info.kind === 'set' && naturals[0] ? cardRank(naturals[0]) : null;
  return {
    kind: info.kind,
    size: cards.length,
    isPure: info.pure,
    usesWild: usesWild(cards, rules),
    rank,
    naturals: naturals.length,
    wilds: cards.length - naturals.length,
  };
}

/** Most cards in a set: one per suit. */
const MAX_SET = 4;
const ACE_LOW: readonly Rank[] = ['A', ...RANKS.slice(0, -1)];
const ACE_HIGH: readonly Rank[] = RANKS;

function orders(aces: AcesRule): (readonly Rank[])[] {
  return aces === 'low' ? [ACE_LOW] : aces === 'high' ? [ACE_HIGH] : [ACE_LOW, ACE_HIGH];
}

const wildIn = (rules: MeldRules) => (card: Card) => isJoker(card) || rules.isWild(card);

/**
 * What this group of cards is as a meld, or null if it isn't one. Wild cards
 * fill in for missing cards; a card of the wild rank can also stand for
 * itself, which keeps a run pure.
 */
export function groupInfo(cards: readonly Card[], rules: MeldRules): GroupInfo | null {
  const info = shapeOf(cards, rules);
  if (info && rules.allows && !rules.allows(cards, info)) return null;
  return info;
}

/** The meld's kind by its cards alone, before the game's own condition. */
function shapeOf(cards: readonly Card[], rules: MeldRules): GroupInfo | null {
  if (cards.length < rules.minSize) return null;
  const isWild = wildIn(rules);
  // Cards that must stand for themselves.
  const fixed = cards.filter((c) => !isWild(c));

  if (rules.kinds.includes('run')) {
    const pure = cards.every((c) => !isJoker(c)) && isNaturalRun(cards, rules.aces);
    if (pure) return { kind: 'run', pure: true };
  }
  if (rules.kinds.includes('set') && (rules.anySuits || cards.length <= MAX_SET)) {
    if (isSet(fixed, rules.anySuits === true)) return { kind: 'set', pure: false };
  }
  if (rules.kinds.includes('run') && isRunWithWilds(fixed, cards.length, rules.aces)) {
    return { kind: 'run', pure: false };
  }
  return null;
}

/** Same rank, different suits (or any suits). */
function isSet(fixed: readonly Card[], anySuits: boolean): boolean {
  if (fixed.length === 0) return true;
  const rank = cardRank(fixed[0] as Card);
  if (!fixed.every((c) => cardRank(c) === rank)) return false;
  return anySuits || new Set(fixed.map(cardSuit)).size === fixed.length;
}

/** Positions of these cards in a rank order, or null if not all one suit. */
function positions(cards: readonly Card[], order: readonly Rank[]): number[] | null {
  const suit = cards[0] ? cardSuit(cards[0]) : null;
  if (cards.some((c) => isJoker(c) || cardSuit(c) !== suit)) return null;
  return cards.map((c) => order.indexOf(cardRank(c) as Rank)).sort((a, b) => a - b);
}

/** Every card standing for itself, in an unbroken sequence of one suit. */
function isNaturalRun(cards: readonly Card[], aces: AcesRule): boolean {
  return orders(aces).some((order) => {
    const p = positions(cards, order);
    return p !== null && p.every((x, i) => i === 0 || x === (p[i - 1] as number) + 1);
  });
}

/** Can the fixed cards sit in a run of `length` cards, wild cards filling the gaps? */
function isRunWithWilds(fixed: readonly Card[], length: number, aces: AcesRule): boolean {
  if (length > ACE_LOW.length) return false;
  if (fixed.length === 0) return true;
  return orders(aces).some((order) => {
    const p = positions(fixed, order);
    if (p === null || new Set(p).size !== p.length) return false;
    return (p[p.length - 1] as number) - (p[0] as number) + 1 <= length;
  });
}

/**
 * Does this meld need a wild card standing in for another card? A card of the
 * wild rank that is in its natural place doesn't count.
 */
export function usesWild(cards: readonly Card[], rules: MeldRules): boolean {
  return cards.some(isJoker) || shapeOf(cards, { ...rules, isWild: () => false }) === null;
}

/** Can this card be added to a meld already on the table? */
export function canAddToMeld(meld: readonly Card[], card: Card, rules: MeldRules): boolean {
  // Quick no: a natural card must share a rank (set) or suit (run) with the meld's natural cards.
  const isWild = wildIn(rules);
  const anchor = meld.find((c) => !isWild(c));
  if (anchor && !isWild(card) && cardRank(card) !== cardRank(anchor)) {
    if (cardSuit(card) !== cardSuit(anchor)) return false;
  }
  return groupInfo([...meld, card], rules) !== null;
}

// ---- best arrangement ----

export interface Arrangement {
  /** The melds, each a valid group. */
  groups: Card[][];
  /** Points of the cards left over (every card, if a needed pure run is missing). */
  deadwood: number;
}

/** Above this many cards the search gives up and leaves the hand unarranged. */
const MAX_SEARCH_CARDS = 22;

/**
 * The split of `hand` into melds that leaves the fewest points over.
 * `needsPure`: without a pure run (here or already on the table), every card
 * counts. Ties are broken towards more cards in melds.
 */
export function bestArrangement(
  hand: readonly Card[],
  rules: MeldRules,
  value: (card: Card) => number,
  needsPure: boolean,
): Arrangement {
  const total = hand.reduce((sum, c) => sum + value(c), 0);
  // Sets of any suits (canasta): grouping by rank is quick for any size of hand.
  if (rules.anySuits && rules.kinds.length === 1 && rules.kinds[0] === 'set') {
    return setsByRank(hand, rules, value);
  }
  if (hand.length > MAX_SEARCH_CARDS) return { groups: [], deadwood: total };

  const candidates = candidateGroups(hand, rules);
  const byLowest = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const lowest = c.mask & -c.mask;
    const list = byLowest.get(lowest);
    if (list) list.push(c);
    else byLowest.set(lowest, [c]);
  }

  interface Result {
    deadwood: number;
    melded: number;
    groups: Candidate[];
  }
  const NONE: Result = { deadwood: Infinity, melded: 0, groups: [] };
  const memo = new Map<number, Result>();
  const better = (a: Result, b: Result) =>
    a.deadwood < b.deadwood || (a.deadwood === b.deadwood && a.melded > b.melded);

  // Least deadwood for the cards in `mask`; `pure` says a pure run is already used.
  const solve = (mask: number, pure: boolean): Result => {
    if (mask === 0) return needsPure && !pure ? NONE : { deadwood: 0, melded: 0, groups: [] };
    const key = mask * 2 + (pure ? 1 : 0);
    const cached = memo.get(key);
    if (cached) return cached;
    const lowest = mask & -mask;
    const index = 31 - Math.clz32(lowest);
    const rest = solve(mask & ~lowest, pure);
    let best: Result = {
      deadwood: rest.deadwood + value(hand[index] as Card),
      melded: rest.melded,
      groups: rest.groups,
    };
    for (const c of byLowest.get(lowest) ?? []) {
      if ((c.mask & mask) !== c.mask) continue;
      const after = solve(mask & ~c.mask, pure || c.pure);
      const option = {
        deadwood: after.deadwood,
        melded: after.melded + c.size,
        groups: [c, ...after.groups],
      };
      if (better(option, best)) best = option;
    }
    memo.set(key, best);
    return best;
  };

  const all = hand.length === 0 ? 0 : (2 ** hand.length - 1) >>> 0;
  const result = solve(all, false);
  if (result.deadwood === Infinity) {
    // No pure run possible: every card counts, but keep the best melds for display.
    const anyway = bestArrangement(hand, rules, value, false);
    return { groups: anyway.groups, deadwood: total };
  }
  return {
    groups: result.groups.map((c) => indexes(c.mask).map((i) => hand[i] as Card)),
    deadwood: result.deadwood,
  };
}

/**
 * Sets of any suits, grouped by rank: every rank with enough natural cards is
 * a set; then the wild cards (cheapest first) complete the most valuable
 * smaller groups, and any left over join sets that can take them. Each step
 * keeps to the game's own condition. A good arrangement, not always the best.
 */
function setsByRank(
  hand: readonly Card[],
  rules: MeldRules,
  value: (card: Card) => number,
): Arrangement {
  const isWild = wildIn(rules);
  const wilds = hand.filter(isWild).sort((a, b) => value(a) - value(b));
  const byRank = new Map<string, Card[]>();
  for (const card of hand.filter((c) => !isWild(c))) {
    byRank.set(cardRank(card), [...(byRank.get(cardRank(card)) ?? []), card]);
  }
  const groups: Card[][] = [];
  const short: Card[][] = [];
  for (const cards of byRank.values()) {
    if (groupInfo(cards, rules)) groups.push(cards);
    else short.push(cards);
  }
  const worth = (cards: readonly Card[]) => cards.reduce((sum, c) => sum + value(c), 0);
  // Fewest wild cards needed first, then the most points saved.
  short.sort((a, b) => b.length - a.length || worth(b) - worth(a));
  for (const cards of short) {
    const need = Math.max(0, rules.minSize - cards.length);
    if (need > wilds.length) continue;
    const group = [...cards, ...wilds.slice(0, need)];
    if (!groupInfo(group, rules)) continue;
    wilds.splice(0, need);
    groups.push(group);
  }
  for (const wild of [...wilds]) {
    const target = groups.find((g) => groupInfo([...g, wild], rules));
    if (!target) continue;
    target.push(wild);
    wilds.splice(wilds.indexOf(wild), 1);
  }
  const melded = new Set(groups.flat());
  return { groups, deadwood: worth(hand.filter((c) => !melded.has(c))) };
}

interface Candidate {
  mask: number;
  size: number;
  pure: boolean;
}

function indexes(mask: number): number[] {
  const result: number[] = [];
  for (let i = 0; mask >>> i !== 0; i++) if ((mask >>> i) & 1) result.push(i);
  return result;
}

/** Subsets of `items` of exactly size k. */
function choose<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const [first, ...rest] = items as [T, ...T[]];
  return [...choose(rest, k - 1).map((c) => [first, ...c]), ...choose(rest, k)];
}

/**
 * Every valid group that could be made from the hand, as bitmasks of card
 * positions. Cards of a wild rank are tried both as themselves and as wilds.
 */
function candidateGroups(hand: readonly Card[], rules: MeldRules): Candidate[] {
  const isWild = wildIn(rules);
  const all = hand.map((card, i) => ({ card, bit: 2 ** i }));
  const wilds = all.filter(({ card }) => isWild(card));
  const naturals = all.filter(({ card }) => !isJoker(card));
  const found = new Map<number, Candidate>();
  const add = (bits: number[]) => {
    const mask = bits.reduce((m, b) => m + b, 0);
    if (found.has(mask) || new Set(bits).size !== bits.length) return;
    const cards = indexes(mask).map((i) => hand[i] as Card);
    const info = groupInfo(cards, rules);
    if (info) found.set(mask, { mask, size: cards.length, pure: info.pure });
  };
  // Wild cards that aren't already used, k at a time.
  const withWilds = (used: number[], k: number) =>
    choose(
      wilds.filter((w) => !used.includes(w.bit)),
      k,
    ).map((ws) => [...used, ...ws.map((w) => w.bit)]);

  if (rules.kinds.includes('set')) {
    const byRank = new Map<string, typeof naturals>();
    for (const n of naturals) {
      const rank = cardRank(n.card);
      byRank.set(rank, [...(byRank.get(rank) ?? []), n]);
    }
    for (const group of byRank.values()) {
      for (let size = 1; size <= MAX_SET; size++) {
        for (const picked of choose(group, size)) {
          for (let k = Math.max(0, rules.minSize - size); size + k <= MAX_SET; k++) {
            for (const bits of withWilds(
              picked.map((p) => p.bit),
              k,
            ))
              add(bits);
          }
        }
      }
    }
    for (let size = rules.minSize; size <= MAX_SET; size++) {
      for (const ws of choose(wilds, size)) add(ws.map((w) => w.bit));
    }
  }

  if (rules.kinds.includes('run')) {
    for (const order of orders(rules.aces)) {
      const bySuit = new Map<string, Map<number, number[]>>();
      for (const n of naturals) {
        const suit = cardSuit(n.card) as string;
        const at = order.indexOf(cardRank(n.card) as Rank);
        const positions = bySuit.get(suit) ?? new Map<number, number[]>();
        positions.set(at, [...(positions.get(at) ?? []), n.bit]);
        bySuit.set(suit, positions);
      }
      for (const positions of bySuit.values()) {
        for (let start = 0; start < order.length; start++) {
          for (let end = start + rules.minSize - 1; end < order.length; end++) {
            const present: number[][] = [];
            let missing = 0;
            for (let p = start; p <= end; p++) {
              const copies = positions.get(p);
              if (copies) present.push(copies);
              else missing++;
            }
            if (present.length === 0 || missing > wilds.length) continue;
            // Each combination of copies (two decks), gaps filled with wild cards.
            for (const picked of product(present)) {
              for (const bits of withWilds(picked, missing)) add(bits);
            }
          }
        }
      }
    }
  }
  return [...found.values()];
}

/** One item from each list, every way. */
function product(lists: readonly number[][]): number[][] {
  return lists.reduce<number[][]>(
    (acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])),
    [[]],
  );
}
