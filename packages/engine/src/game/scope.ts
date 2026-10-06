/**
 * Builds the names an expression can use (player, hand, card, team, trick,
 * state, options, …) from the game state. Everything here is read-only:
 * expressions can look at the game but never change it. Values are computed
 * only when an expression reads them.
 */
import { type Card, cardRank, cardSuit, isJoker } from '../cards/card';
import { ExprError } from '../errors';
import {
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
import type { PlayerId, ZoneKey } from './move';
import { type GameState, type TrickState, teamZoneKey } from './state';

export interface ScopeContext {
  /** The player the expression is about (acting player, or the one being scored). */
  player?: PlayerId;
  /** The team being scored (defaults to the player's team). */
  team?: number;
  /** The card being considered (when checking a card's legality or running its effects). */
  card?: Card;
}

const fn = (f: (...args: Value[]) => Value): ExprFunction => f;

export function cardObject(card: Card): ExprObject {
  return { id: card.id, suit: cardSuit(card), rank: cardRank(card), isJoker: isJoker(card) };
}

/** A pile of cards: count, top, cards and a few questions about them. */
function cardsObject(
  cards: readonly Card[],
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
      default:
        return extra(name);
    }
  });
}

function zoneObject(state: GameState, key: ZoneKey): ExprObject {
  const melds = state.melds[key];
  if (melds)
    return cardsObject(melds.flat(), (name) => (name === 'melds' ? melds.length : undefined));
  return cardsObject(state.zones[key] ?? []);
}

function trickObject(trick: TrickState | null): ExprObject {
  const cards = trick?.plays.map((p) => p.card) ?? [];
  return cardsObject(cards, (name) => {
    switch (name) {
      case 'leader':
        return trick?.leader ?? null;
      case 'winner':
        return trick?.winner ?? null;
      case 'ledSuit': {
        const first = cards.find((c) => !isJoker(c));
        return first ? cardSuit(first) : null;
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
    }
    if (trackNames(state).has(name)) return player.tracks[name] ?? 0;
    return ownedZone(state, 'player', id, name);
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

/** Point value of a card from scoring.cardValue (or its rank number if there's no entry). */
export function cardValue(state: GameState, card: Value): number {
  const rank = isObject(card) ? getProperty(card, 'rank') : null;
  if (typeof rank !== 'string') throw new ExprError('cardValue needs a card');
  const table = state.file.scoring.cardValue ?? {};
  const value = table[rank] ?? table.default ?? 'rankNumber';
  if (typeof value === 'number') return value;
  return RANK_NUMBER[rank] ?? Number(rank);
}

function numbersFrom(name: string, list: Value, per?: Value): number[] {
  if (!isList(list)) {
    // Zones and tricks can be passed directly: sum(player.hand, cardValue)
    const cards = isObject(list) ? (getProperty(list, 'cards') ?? null) : null;
    if (isList(cards)) return numbersFrom(name, cards, per);
    throw new ExprError(`${name}() needs a list`);
  }
  return list.map((item) => {
    const n = typeof per === 'function' ? per(item) : item;
    if (typeof n !== 'number') throw new ExprError(`${name}() needs numbers`);
    return n;
  });
}

const sum = fn((list, per) => numbersFrom('sum', list, per).reduce((a, b) => a + b, 0));
const min = fn((list, per) => Math.min(...numbersFrom('min', list, per)));
const max = fn((list, per) => Math.max(...numbersFrom('max', list, per)));
const abs = fn((n) => {
  if (typeof n !== 'number') throw new ExprError('abs() needs a number');
  return Math.abs(n);
});

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
      case 'trick':
        return trickObject(state.trick);
      case 'state':
        return openObject(state.vars);
      case 'options':
        return { ...state.options };
      case 'round':
        return state.round;
      case 'activePlayers':
        return { count: state.players.filter((p) => p.active).length };
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
