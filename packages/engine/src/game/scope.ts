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
import { hasLegalPlay } from './legal';
import { deadwood, hasPureRunOnTable } from './arrangement';
import type { BidValue, PlayerId, ZoneKey } from './move';
import { type GameState, suitOf, type TrickState, teamZoneKey } from './state';

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
  /** The meld being considered (a meld action's `if`). */
  meld?: { kind: string; size: number; isPure: boolean; usesWild: boolean };
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
  const ranks = rankOrder(state);
  if (melds)
    return cardsObject(melds.flat(), ranks, (name) =>
      name === 'melds' ? melds.length : undefined,
    );
  return cardsObject(state.zones[key] ?? [], ranks);
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
];

function playerObject(state: GameState, id: PlayerId): ExprObject {
  const player = state.players[id];
  if (!player) throw new ExprError(`There is no player ${id}`);
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
        return hasLegalPlay(state, id);
      case 'deadwood':
        return deadwood(state, id);
      case 'hasPureRun':
        return hasPureRunOnTable(state, id);
      case 'sittingOut':
        return player.sittingOut;
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
 * The same scope with `card` set, for checking many cards against one rule
 * without rebuilding everything else each time.
 */
export function withCard(scope: Scope, card: Card): Scope {
  const object = cardObject(card);
  return { ...scope, lookup: (name) => (name === 'card' ? object : scope.lookup(name)) };
}

export function buildScope(state: GameState, ctx: ScopeContext = {}): Scope {
  const team = ctx.team ?? (ctx.player === undefined ? undefined : state.players[ctx.player]?.team);

  function lookup(name: string): Value | undefined {
    switch (name) {
      case 'player':
        return ctx.player === undefined ? undefined : playerObject(state, ctx.player);
      case 'team':
        return team === undefined ? undefined : teamObject(state, team);
      case 'card':
        return ctx.card ? cardObject(ctx.card) : undefined;
      case 'meld':
        return ctx.meld ? { ...ctx.meld } : undefined;
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
