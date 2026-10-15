/**
 * Builds the names an expression can use (player, hand, card, team, trick,
 * state, options, …) from the game state. Everything here is read-only:
 * expressions can look at the game but never change it. Values are computed
 * only when an expression reads them.
 */
import {
  type Card,
  cardCode,
  cardRank,
  cardSuit,
  isJoker,
  isRank,
  isSuit,
  RANKS,
  type Rank,
  type Suit,
} from '../cards/card';
import { countPairs, countSums, runAtEnd, runCards, sameRankAtEnd } from '../cards/patterns';
import { ExprError } from '../errors';
import {
  evaluateNumber,
  type ExprFunction,
  type ExprObject,
  getProperty,
  isList,
  isObject,
  lookupObject,
  openObject,
  type Scope,
  type Value,
} from '../expr/evaluate';
import { hasLegalPlay, hasMove } from './legal';
import { checkedGroups, deadwood, hasPureRunOnTable, meldRulesOf } from './arrangement';
import { groupInfo } from '../actions/arrange';
import type { CardId } from '../cards/card';
import type { BidValue, PlayerId, ZoneKey } from './move';
import { type GameState, suitOf, type TrickState, teamZoneKey, trumpSuit } from './state';
import { trickWinnerIndex } from '../cards/order';

/** What expressions see as `meld`. */
export interface MeldContext {
  kind: string;
  size: number;
  isPure: boolean;
  usesWild: boolean;
  /** A set's rank (null for a run, or a set of only wild cards). */
  rank: string | null;
  naturals: number;
  wilds: number;
  /** Card values added up (`scoring.cardValue`). */
  points: number;
  /** The melds being judged would empty the player's hand. */
  goingOut: boolean;
  /** Taking a pile: true for a new meld, false for adding to one already down. */
  isNew?: boolean;
}

export interface ScopeContext {
  /** The player the expression is about (acting player, or the one being scored). */
  player?: PlayerId;
  /** The team being scored (defaults to the player's team). */
  team?: number;
  /** The card being considered (when checking a card's legality or running its effects). */
  card?: Card;
  /** The suit being considered (a declareTrump action's `if`). */
  suit?: Suit;
  /** The bid being considered (a bid action's `if`). */
  bid?: BidValue;
  /** The meld being considered (a meld action's `if`, `meldRules.allowed`, taking a pile). */
  meld?: MeldContext;
  /** Cards the move is using from the player's hand, left out of `player.groups`. */
  using?: ReadonlySet<CardId>;
}

const fn = (f: (...args: Value[]) => Value): ExprFunction => f;

export function cardObject(card: Card): ExprObject {
  return {
    id: card.id,
    code: cardCode(card),
    suit: cardSuit(card),
    rank: cardRank(card),
    isJoker: isJoker(card),
  };
}

/** A pile of cards: count, top, cards and a few questions about them. */
function cardsObject(
  cards: readonly Card[],
  ranks: readonly Rank[],
  extra: (name: string) => Value | undefined = () => undefined,
): ExprObject {
  return lookupObject((name) => {
    switch (name) {
      case 'count':
        return cards.length;
      case 'top': {
        const top = cards[cards.length - 1];
        return top ? cardObject(top) : null;
      }
      case 'cards':
        return cards.map(cardObject);
      case 'containsSuit':
        return fn((suit) => cards.some((c) => cardSuit(c) === suit));
      case 'onlySuit':
        return fn((suit) => cards.length > 0 && cards.every((c) => cardSuit(c) === suit));
      case 'countSuit':
        return fn((suit) => cards.filter((c) => cardSuit(c) === suit).length);
      case 'hasRank':
        return fn((rank) => cards.some((c) => cardRank(c) === rank));
      case 'countRank':
        return fn((rank) => cards.filter((c) => cardRank(c) === rank).length);
      case 'countCard':
        // countCard('QS'), or a rank and suit: countCard('A', state.trump).
        return fn((...args) => {
          const [code, suit] = args;
          return args.length < 2
            ? cards.filter((c) => cardCode(c) === code).length
            : cards.filter((c) => cardRank(c) === code && cardSuit(c) === suit).length;
        });
      case 'hasCard':
        // hasCard('QS'), or a rank and suit: hasCard('J', starter.top.suit).
        return fn((...args) => {
          const [code, suit] = args;
          return args.length < 2
            ? cards.some((c) => cardCode(c) === code)
            : cards.some((c) => cardRank(c) === code && cardSuit(c) === suit);
        });
      case 'sameRankAtEnd':
        return sameRankAtEnd(cards);
      case 'runAtEnd':
        return runAtEnd(cards, ranks);
      default:
        return extra(name);
    }
  });
}

function zoneObject(state: GameState, key: ZoneKey): ExprObject {
  const melds = state.melds[key];
  if (melds) return meldsObject(state, melds);
  return cardsObject(state.zones[key] ?? [], rankOrder(state));
}

/**
 * Melds (on the table, or a player's valid groups): their cards, how many,
 * and how many have at least n cards (with no wild card, for countNaturalMelds).
 */
function meldsObject(state: GameState, melds: readonly (readonly Card[])[]): ExprObject {
  const atLeast = (n: Value) => {
    if (typeof n !== 'number') throw new ExprError('countMelds() needs a number of cards');
    return melds.filter((m) => m.length >= n);
  };
  return cardsObject(melds.flat(), rankOrder(state), (name) => {
    switch (name) {
      case 'melds':
        return melds.length;
      case 'countMelds':
        return fn((n) => atLeast(n).length);
      case 'countNaturalMelds':
        return fn((n) => {
          const isWild = meldRulesOf(state)?.isWild ?? (() => false);
          return atLeast(n).filter((m) => !m.some((c) => isJoker(c) || isWild(c))).length;
        });
      default:
        return undefined;
    }
  });
}

/** The player's valid groups, leaving out cards a move is using (and rechecking what's left). */
function groupsObject(state: GameState, player: PlayerId, using?: ReadonlySet<CardId>): ExprObject {
  const rules = meldRulesOf(state);
  const groups = checkedGroups(state, player)
    .map((g) => (using ? g.cards.filter((c) => !using.has(c.id)) : g.cards))
    .filter((cards) => rules !== null && groupInfo(cards, rules) !== null);
  return meldsObject(state, groups);
}

function rankOrder(state: GameState): readonly Rank[] {
  return state.file.cardOrder?.ranks ?? RANKS;
}

function trickObject(state: GameState, trick: TrickState | null): ExprObject {
  const cards = trick?.plays.map((p) => p.card) ?? [];
  return cardsObject(cards, rankOrder(state), (name) => {
    switch (name) {
      case 'leader':
        return trick?.leader ?? null;
      case 'number':
        return trick?.number ?? null;
      case 'winner':
        return trick?.winner ?? null;
      case 'isBeatenBy':
        // Would this card take the trick so far? (Trump beats other suits; of two
        // identical cards, the first played wins.)
        return fn((card) => {
          const [candidate] = cardsFrom('trick.isBeatenBy', [[card]]);
          if (!candidate) throw new ExprError('trick.isBeatenBy() needs a card');
          return (
            trickWinnerIndex(
              [...cards, candidate],
              'highestTrumpElseHighestLed',
              trumpSuit(state),
              rankOrder(state),
              state.file.cardOrder?.bowers === true,
            ) === cards.length
          );
        });
      case 'ledSuit': {
        // The suit the first card counts as (a left bower leads trump).
        const first = cards.find((c) => !isJoker(c));
        return first ? suitOf(state)(first) : null;
      }
      default:
        return undefined;
    }
  });
}

/** Track names used anywhere in scoring, so `team.bags` reads 0 before any are tracked. */
const trackNameCache = new WeakMap<object, Set<string>>();
function trackNames(state: GameState): Set<string> {
  let names = trackNameCache.get(state.file);
  if (!names) {
    const { perTeam = [], perPlayer = [] } = state.file.scoring;
    names = new Set([...perTeam, ...perPlayer].flatMap((r) => Object.keys(r.track ?? {})));
    trackNameCache.set(state.file, names);
  }
  return names;
}

/** Names of custom per-player values: every "player.x" the game file sets. */
const playerVarCache = new WeakMap<object, Set<string>>();
export function playerVarNames(state: { file: GameState['file'] }): Set<string> {
  let names = playerVarCache.get(state.file);
  if (!names) {
    names = new Set(
      [...JSON.stringify(state.file).matchAll(/"player\.([A-Za-z_][A-Za-z0-9_]*)":/g)].map(
        (m) => m[1] as string,
      ),
    );
    playerVarCache.set(state.file, names);
  }
  return names;
}

/** Names of held points: every `"into"` in the game file's score effects. */
const heldNameCache = new WeakMap<object, Set<string>>();
export function heldNames(state: { file: GameState['file'] }): Set<string> {
  let names = heldNameCache.get(state.file);
  if (!names) {
    names = new Set(
      [...JSON.stringify(state.file).matchAll(/"into":"([A-Za-z_][A-Za-z0-9_]*)"/g)].map(
        (m) => m[1] as string,
      ),
    );
    heldNameCache.set(state.file, names);
  }
  return names;
}

/** A per-player or per-team zone read as a property, e.g. `player.hand` or `team.won`. */
function ownedZone(
  state: GameState,
  per: 'player' | 'team',
  owner: number,
  name: string,
): ExprObject | undefined {
  const def = Object.hasOwn(state.file.zones, name) ? state.file.zones[name] : undefined;
  if (def?.per !== per) return undefined;
  return zoneObject(state, per === 'player' ? `${name}@${owner}` : teamZoneKey(name, owner));
}

/** Properties every player has; custom `player.x` values can't use these names. */
export const PLAYER_PROPERTIES = [
  'id',
  'team',
  'score',
  'bid',
  'tricks',
  'active',
  'isDealer',
  'hasLookedAtHand',
  'hasLegalPlay',
  'deadwood',
  'hasPureRun',
  'sittingOut',
  'groups',
  'hasMove',
];

function playerObject(state: GameState, id: PlayerId, using?: ReadonlySet<CardId>): ExprObject {
  const player = state.players[id];
  if (!player) throw new ExprError(`There is no player ${id}`);
  // Answers that take work, kept for as long as this object lives (one scope, during which
  // the game doesn't change): a rule checked card by card asks them once, not per card.
  const memo = new Map<string, Value>();
  const remember = (key: string, work: () => Value): Value => {
    if (!memo.has(key)) memo.set(key, work());
    return memo.get(key) as Value;
  };
  return lookupObject((name) => {
    switch (name) {
      case 'id':
        return id;
      case 'team':
        return player.team;
      case 'score':
        return state.teams[player.team]?.score ?? 0;
      case 'bid':
        return player.bid;
      case 'tricks':
        return player.tricks;
      case 'active':
        return player.active;
      case 'isDealer':
        return state.dealer === id;
      case 'hasLookedAtHand':
        return player.hasLookedAtHand;
      case 'hasLegalPlay':
        return remember('hasLegalPlay', () => hasLegalPlay(state, id));
      case 'deadwood':
        return remember('deadwood', () => deadwood(state, id));
      case 'hasPureRun':
        return hasPureRunOnTable(state, id);
      case 'sittingOut':
        return player.sittingOut;
      case 'groups':
        return remember('groups', () => groupsObject(state, id, using));
      case 'hasMove':
        return fn((type) => {
          if (typeof type !== 'string') throw new ExprError('player.hasMove() needs a move type');
          return remember(`hasMove:${type}`, () => hasMove(state, id, type));
        });
    }
    if (trackNames(state).has(name)) return player.tracks[name] ?? 0;
    const zone = ownedZone(state, 'player', id, name);
    if (zone) return zone;
    // Custom per-player values (`player.x`) read as null until set.
    return playerVarNames(state).has(name) ? (player.vars[name] ?? null) : undefined;
  });
}

function teamObject(state: GameState, id: number): ExprObject {
  const team = state.teams[id];
  if (!team) throw new ExprError(`There is no team ${id}`);
  return lookupObject((name) => {
    switch (name) {
      case 'id':
        return id;
      case 'score':
        return team.score;
      case 'tricks':
        return team.tricks;
      case 'bid':
        // Non-numeric bids such as "nil" count as 0.
        return team.players.reduce((sum, p) => {
          const bid = state.players[p]?.bid;
          return sum + (typeof bid === 'number' ? bid : 0);
        }, 0);
      case 'players':
        return team.players.length;
    }
    if (trackNames(state).has(name)) return team.tracks[name] ?? 0;
    if (heldNames(state).has(name)) return team.held[name] ?? 0;
    return ownedZone(state, 'team', id, name);
  });
}

const RANK_NUMBER: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13, JOKER: 0 };

/**
 * Point value of a card from scoring.cardValue. The most specific entry wins:
 * the card itself ("QS"), then its rank ("Q"), then its suit ("spades"), then
 * "default"; with none of those, its rank number.
 */
export function cardValue(state: GameState, card: Value): number {
  const get = (name: string) => (isObject(card) ? getProperty(card, name) : null);
  const [code, rank, suit] = [get('code'), get('rank'), get('suit')];
  if (typeof rank !== 'string') {
    throw new ExprError('cardValue needs a card');
  }
  const table = state.file.scoring.cardValue ?? {};
  const entry = (key: unknown) =>
    typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
  const value = entry(code) ?? entry(rank) ?? entry(suit) ?? table.default ?? 'rankNumber';
  if (typeof value === 'number') return value;
  return RANK_NUMBER[rank] ?? Number(rank);
}

function numbersFrom(name: string, list: Value, per?: Value): number[] {
  if (!isList(list)) {
    // Zones, tricks and activePlayers can be passed directly: sum(player.hand, cardValue),
    // sum(activePlayers, handValue).
    const items = isObject(list)
      ? (getProperty(list, 'cards') ?? getProperty(list, 'players') ?? null)
      : null;
    if (isList(items)) return numbersFrom(name, items, per);
    throw new ExprError(`${name}() needs a list`);
  }
  return list.map((item) => {
    const n = typeof per === 'function' ? per(item) : item;
    if (typeof n !== 'number') throw new ExprError(`${name}() needs numbers`);
    return n;
  });
}

/**
 * The cards in piles and lists of cards, all together: countPairs(hand, starter)
 * or countPairs(hand.cards).
 */
function cardsFrom(name: string, args: readonly Value[]): Card[] {
  return args.flatMap((arg): Card[] => {
    const items = isObject(arg) ? (getProperty(arg, 'cards') ?? null) : arg;
    if (!isList(items)) throw new ExprError(`${name}() needs piles or lists of cards`);
    return items.map((item) => {
      const get = (prop: string) => (isObject(item) ? getProperty(item, prop) : undefined);
      const [id, rank, suit] = [get('id'), get('rank'), get('suit')];
      if (typeof id !== 'string') throw new ExprError(`${name}() needs cards`);
      if (get('isJoker') === true) return { id, joker: true };
      if (!isRank(rank) || !isSuit(suit)) throw new ExprError(`${name}() needs cards`);
      return { id, rank, suit };
    });
  });
}

const sum = fn((list, per) => numbersFrom('sum', list, per).reduce((a, b) => a + b, 0));
const min = fn((list, per) => Math.min(...numbersFrom('min', list, per)));
const max = fn((list, per) => Math.max(...numbersFrom('max', list, per)));
/**
 * A player value from scoring.playerValues as a function of a player:
 * handValue(player) evaluates "sum(player.hand, cardValue)" for that player.
 */
function playerValue(state: GameState, name: string, expr: string): ExprFunction {
  return fn((player) => {
    const id = isObject(player) ? getProperty(player, 'id') : null;
    if (typeof id !== 'number') throw new ExprError(`${name}() needs a player`);
    return evaluateNumber(expr, buildScope(state, { player: id }));
  });
}

/** Seat whose hand holds the card with this code ("2C"), or null if nobody's does. */
function holderOf(state: GameState): ExprFunction {
  return fn((code) => {
    const holder = state.players.find(
      (p) => p.active && (state.zones[`hand@${p.id}`] ?? []).some((c) => cardCode(c) === code),
    );
    return holder?.id ?? null;
  });
}

const abs = fn((n) => {
  if (typeof n !== 'number') throw new ExprError('abs() needs a number');
  return Math.abs(n);
});

/**
 * The same scope with one name (`bid`, `suit`) set to a value, for checking
 * many values against one rule without rebuilding everything else each time.
 */
export function withValue(scope: Scope, name: 'bid' | 'suit', value: Value): Scope {
  return { ...scope, lookup: (n) => (n === name ? value : scope.lookup(n)) };
}

/** The same scope with `meld` set (checking many groups against `meldRules.allowed`). */
export function withMeld(scope: Scope, meld: MeldContext): Scope {
  const object = { ...meld };
  return { ...scope, lookup: (name) => (name === 'meld' ? object : scope.lookup(name)) };
}

/**
 * The same scope with `card` set, for checking many cards against one rule
 * without rebuilding everything else each time.
 */
export function withCard(scope: Scope, card: Card): Scope {
  const object = cardObject(card);
  return { ...scope, lookup: (name) => (name === 'card' ? object : scope.lookup(name)) };
}

/**
 * The names an expression can use. A scope is used while the game stands
 * still (checking one rule, or one rule card by card); build a new one after
 * anything changes.
 */
export function buildScope(state: GameState, ctx: ScopeContext = {}): Scope {
  const team = ctx.team ?? (ctx.player === undefined ? undefined : state.players[ctx.player]?.team);
  let me: ExprObject | undefined;

  function lookup(name: string): Value | undefined {
    switch (name) {
      case 'player':
        if (ctx.player === undefined) return undefined;
        me ??= playerObject(state, ctx.player, ctx.using);
        return me;
      case 'team':
        return team === undefined ? undefined : teamObject(state, team);
      case 'card':
        return ctx.card ? cardObject(ctx.card) : undefined;
      case 'meld':
        return ctx.meld ? { ...ctx.meld, rank: ctx.meld.rank } : undefined;
      case 'suit':
        return ctx.suit;
      case 'bid':
        return ctx.bid;
      case 'trick':
        return trickObject(state, state.trick);
      case 'state':
        return openObject(state.vars);
      case 'options':
        return { ...state.options };
      case 'round':
        return state.round;
      case 'dealer':
        return state.dealer;
      case 'activePlayers': {
        const active = state.players.filter((p) => p.active);
        return lookupObject((prop) => {
          if (prop === 'count') return active.length;
          // Not readable in game files; lets sum/min/max go over the players.
          if (prop === 'players') return active.map((p) => playerObject(state, p.id));
          return undefined;
        });
      }
      case 'turn':
        return { draws: state.cursor.draws };
      case 'cardValue':
        return fn((card) => cardValue(state, card));
      case 'sum':
        return sum;
      case 'min':
        return min;
      case 'max':
        return max;
      case 'abs':
        return abs;
      case 'holderOf':
        return holderOf(state);
      case 'countSums':
        return fn((total, ...piles) => {
          if (typeof total !== 'number') throw new ExprError('countSums() needs a total first');
          const cards = cardsFrom('countSums', piles);
          return countSums(
            cards.map((c) => cardValue(state, cardObject(c))),
            total,
          );
        });
      case 'countPairs':
        return fn((...piles) => countPairs(cardsFrom('countPairs', piles)));
      case 'runCards':
        return fn((...piles) => runCards(cardsFrom('runCards', piles), rankOrder(state)));
    }
    const values = state.file.scoring.playerValues;
    if (values && Object.hasOwn(values, name)) {
      return playerValue(state, name, values[name] as string);
    }
    // Zones: shared zones by name; per-player/per-team zones mean "this player's/team's".
    const def = Object.hasOwn(state.file.zones, name) ? state.file.zones[name] : undefined;
    if (!def) return undefined;
    if (def.per === 'player') {
      return ctx.player === undefined ? undefined : zoneObject(state, `${name}@${ctx.player}`);
    }
    if (def.per === 'team') {
      return team === undefined ? undefined : zoneObject(state, teamZoneKey(name, team));
    }
    return zoneObject(state, name);
  }

  return {
    lookup,
    players: () => state.players.filter((p) => p.active).map((p) => playerObject(state, p.id)),
    teams: () =>
      state.teams
        .filter((t) => t.players.some((p) => state.players[p]?.active))
        .map((t) => teamObject(state, t.id)),
  };
}
