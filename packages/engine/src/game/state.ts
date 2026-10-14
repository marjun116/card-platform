import type { Card, CardId, Suit } from '../cards/card';
import { effectiveSuit } from '../cards/order';
import { GameFileError } from '../errors';
import type { RngState } from '../rng';
import type { BidValue, Move, PlayerId, ZoneKey } from './move';
import type { EffectDef, GameFile, OptionValue, ZoneDef } from './types';

/** Values a game can store in `state.*`. */
export type VarValue = null | boolean | number | string | VarValue[];

export interface PlayerState {
  id: PlayerId;
  team: number;
  /** False once eliminated. */
  active: boolean;
  bid: BidValue | null;
  tricks: number;
  tracks: Record<string, number>;
  hasLookedAtHand: boolean;
  /** Custom values (`player.x`), reset every round. */
  vars: Record<string, VarValue>;
  /** How the player has grouped their hand (card ids; cards no longer held are ignored). */
  groups: CardId[][];
  /** Out of play for this round only (a lone player's partner): no turns, no cards played. */
  sittingOut: boolean;
}

export interface TeamState {
  id: number;
  players: PlayerId[];
  score: number;
  tricks: number;
  tracks: Record<string, number>;
  /**
   * Points held this round (`score` with `into`, e.g. pinochle meld): not in
   * the score until the round's scoring adds them. Cleared every round.
   */
  held: Record<string, number>;
}

export interface TrickState {
  /** Zone the cards are played into. */
  zone: ZoneKey;
  leader: PlayerId;
  /** 1 for the first trick of the phase, 2 for the second, … */
  number: number;
  plays: { player: PlayerId; card: Card }[];
  winner: PlayerId | null;
}

export interface Cursor {
  /** Index into file.phases. */
  phase: number;
  /** Index into the phase's turn steps. */
  step: number;
  /** Whose turn it is. */
  current: PlayerId;
  /** 1 = clockwise (to the left), -1 = counter-clockwise. */
  direction: 1 | -1;
  /** Turns taken this phase, per seat. */
  turns: number[];
  /** Tricks completed this phase. */
  tricks: number;
  /** Players skipped in a row because they had no legal move. */
  passesInARow: number;
  /** Upcoming players to skip (from `skip` effects). */
  skipNext: number;
  /** Cards the current player has drawn this turn (`turn.draws`). */
  draws: number;
}

/**
 * What happened in one finished round, kept for the round summary. Only
 * public information: bids, trick counts and scores, never cards.
 */
export interface RoundResult {
  round: number;
  dealer: PlayerId;
  teams: {
    id: number;
    /** Points this round (can be negative). */
    points: number;
    /** Total score after this round. */
    score: number;
    tricks: number;
    /** Counters such as bags, after this round. */
    tracks: Record<string, number>;
    /** Points held during the round (such as meld). */
    held: Record<string, number>;
  }[];
  players: {
    id: PlayerId;
    bid: BidValue | null;
    tricks: number;
    tracks: Record<string, number>;
    /** Knocked out at the end of this round. */
    eliminated: boolean;
  }[];
}

/** Points scored during a round (a `score` effect), shown in the game log. */
export interface ScoreEvent {
  round: number;
  /** Moves in the log when the points were scored, to place them among the moves. */
  at: number;
  player: PlayerId;
  team: number;
  points: number;
  label: string | null;
  /** Held points (`into`, e.g. "meld") rather than points added to the score. */
  into: string | null;
}

/**
 * Cards that moved without a player's move: turned up in the deal (setup.flip), or
 * given by a `giveCards` effect. Shown in the game log. A card is listed only if
 * everyone could see it, so this never gives away a hidden card.
 */
export interface CardEvent {
  round: number;
  /** Moves in the log when it happened, to place it among the moves. */
  at: number;
  kind: 'turnedUp' | 'given';
  /** The zone the cards were turned up into, or given from. */
  zone: string;
  /** Who was given the cards; null for cards turned up. */
  player: PlayerId | null;
  /** The cards, if everyone could see them; otherwise empty. */
  cards: CardId[];
}

/** A decision the engine is waiting on before the turn can continue. */
export type Pending =
  | {
      kind: 'chooseSuit';
      player: PlayerId;
      /** "state.x" path that receives the suit. */
      target: string;
      /** Effects still to run after the choice. */
      remaining: EffectDef[];
      card: CardId | null;
      after: AfterAction;
    }
  | { kind: 'mayPlayDrawnCard'; player: PlayerId; card: CardId }
  | {
      /** Another player answers a question (an `ask` effect), then the turn goes on. */
      kind: 'ask';
      /** The player answering. */
      player: PlayerId;
      /** The player whose turn it is, who asked. */
      asker: PlayerId;
      values: string[];
      /** "state.x" path that receives the answer. */
      target: string;
      remaining: EffectDef[];
      card: CardId | null;
      after: AfterAction;
    };

/** What happens once an action (and its effects) is done: go to a turn step, or end the turn. */
export type AfterAction = number | 'endTurn';

export interface GameState {
  /** The game file, shared by reference and never copied or changed. */
  readonly file: GameFile;
  options: Record<string, OptionValue>;
  seed: string;
  rng: RngState;
  players: PlayerState[];
  teams: TeamState[];
  /** Ordinary zones. The last card in each array is the top card. */
  zones: Record<ZoneKey, Card[]>;
  /** Zones that hold melds (groups of cards). */
  melds: Record<ZoneKey, Card[][]>;
  /** Times each zone has been refilled from the discard pile this round. */
  reshuffles: Record<ZoneKey, number>;
  /** Cards passed to each seat, delivered when the phase ends. */
  passing: Card[][];
  /** Custom values (`state.*`). Reset every round. */
  vars: Record<string, VarValue>;
  /** Who played each card this round (for `returnCards`). Never shown to players. */
  playedBy: Record<CardId, PlayerId>;
  /** Points scored during rounds (`score` effects), oldest first. Public. */
  scoreEvents: ScoreEvent[];
  /** Cards turned up or given out (see CardEvent), oldest first. Public. */
  cardEvents: CardEvent[];
  /** Each team's score when this round began, so the round summary counts every point. */
  roundStartScores: number[];
  round: number;
  dealer: PlayerId;
  cursor: Cursor;
  trick: TrickState | null;
  lastTrick: TrickState | null;
  pending: Pending | null;
  /** The game uses `hasLookedAtHand` (blind bids), so hands start hidden from their owners. */
  lookRequired: boolean;
  status: 'inProgress' | 'over';
  winners: PlayerId[];
  /** Words shown with the result (`endCondition.notes`), once the game is over. */
  notes: string[];
  log: Move[];
  /** Every finished round, oldest first. */
  history: RoundResult[];
  /** Moves made this round, to catch game files that never end a round. */
  roundMoves: number;
  /** Where this round's moves begin in the log. */
  roundStart: number;
}

// ---- zones ----

export function zoneDef(state: GameState, name: string): ZoneDef {
  const def = state.file.zones[name];
  if (!def) throw new GameFileError(`Zone "${name}" isn't defined in "zones"`);
  return def;
}

/** Key of a zone instance: "stock", "hand@2" (seat 2) or "won@t1" (team 1). */
export function zoneKey(state: GameState, name: string, player: PlayerId | null): ZoneKey {
  const def = zoneDef(state, name);
  if (def.per === 'player' || def.per === 'team') {
    if (player === null) {
      throw new GameFileError(`Zone "${name}" belongs to a ${def.per}, but no player is involved`);
    }
    if (def.per === 'player') return `${name}@${player}`;
    return `${name}@t${teamOf(state, player)}`;
  }
  return name;
}

/**
 * Notes cards that moved without a player's move (see CardEvent). `cards` were on
 * top of the shared zone `zone` (turned up into it, or given from it); they are
 * listed only if everyone could see them there.
 */
export function noteCards(
  state: GameState,
  kind: CardEvent['kind'],
  zone: string,
  player: PlayerId | null,
  cards: readonly Card[],
): void {
  const { visibility } = zoneDef(state, zone);
  const seen = visibility === 'all' || (visibility === 'topCardOnly' && cards.length === 1);
  state.cardEvents.push({
    round: state.round,
    at: state.log.length,
    kind,
    zone,
    player,
    cards: seen ? cards.map((c) => c.id) : [],
  });
}

export function teamZoneKey(name: string, team: number): ZoneKey {
  return `${name}@t${team}`;
}

/** Splits a zone key into its zone name and owner. */
export function parseZoneKey(key: ZoneKey): {
  name: string;
  player: PlayerId | null;
  team: number | null;
} {
  const [name = key, owner] = key.split('@');
  if (owner === undefined) return { name, player: null, team: null };
  if (owner.startsWith('t')) return { name, player: null, team: Number(owner.slice(1)) };
  return { name, player: Number(owner), team: null };
}

export function zoneCards(state: GameState, key: ZoneKey): Card[] {
  const cards = state.zones[key];
  if (!cards) throw new GameFileError(`Zone "${key}" isn't a card pile`);
  return cards;
}

export function meldsIn(state: GameState, key: ZoneKey): Card[][] {
  const melds = state.melds[key];
  if (!melds) throw new GameFileError(`Zone "${key}" doesn't hold melds`);
  return melds;
}

/** Every instance key of a zone, for all players or teams. */
export function zoneInstances(state: GameState, name: string): ZoneKey[] {
  const def = zoneDef(state, name);
  if (def.per === 'player') return state.players.map((p) => `${name}@${p.id}`);
  if (def.per === 'team') return state.teams.map((t) => teamZoneKey(name, t.id));
  return [name];
}

/** Removes a card (by id) from a pile and returns it. */
export function takeCard(state: GameState, key: ZoneKey, id: CardId): Card {
  const cards = zoneCards(state, key);
  const index = cards.findIndex((c) => c.id === id);
  if (index < 0) throw new GameFileError(`Card ${id} isn't in ${key}`);
  return cards.splice(index, 1)[0] as Card;
}

// ---- players and teams ----

export function teamOf(state: GameState, player: PlayerId): number {
  return (state.players[player] as PlayerState).team;
}

export function activePlayerIds(state: GameState): PlayerId[] {
  return state.players.filter((p) => p.active).map((p) => p.id);
}

/** Takes turns this round: still in the game, and not sitting this round out. */
export function isPlaying(player: PlayerState | undefined): boolean {
  return player !== undefined && player.active && !player.sittingOut;
}

export function playingCount(state: GameState): number {
  return state.players.filter(isPlaying).length;
}

/**
 * The next player taking turns from `from` in the given direction (never
 * `from` itself unless alone). Players sitting this round out are passed over.
 */
export function nextActive(state: GameState, from: PlayerId, direction: 1 | -1 = 1): PlayerId {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const seat = (((from + direction * step) % n) + n) % n;
    if (isPlaying(state.players[seat])) return seat;
  }
  return from;
}

/** The suit each card counts as in this game right now (bowers change a jack's suit). */
export function suitOf(state: GameState): (card: Card) => Suit | null {
  const trump = trumpSuit(state);
  const bowers = state.file.cardOrder?.bowers === true;
  return (card) => effectiveSuit(card, trump, bowers);
}

export function trumpSuit(state: GameState): Suit | null {
  const trump = state.file.cardOrder?.trump;
  if (trump === 'declared') {
    const declared = state.vars.trump;
    return typeof declared === 'string' ? (declared as Suit) : null;
  }
  return trump ?? null;
}

// ---- copying ----

/** Copies everything a move can change, so applyMove never touches its input. */
export function draft(state: GameState): GameState {
  const copyRecord = <T>(r: Record<string, T>, copy: (v: T) => T) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, copy(v)]));
  const copyTrick = (t: TrickState | null) => t && { ...t, plays: [...t.plays] };
  return {
    ...state,
    options: { ...state.options },
    rng: [...state.rng],
    players: state.players.map((p) => ({
      ...p,
      tracks: { ...p.tracks },
      vars: copyRecord(p.vars, (v) => (Array.isArray(v) ? structuredCopy(v) : v)),
      groups: p.groups.map((g) => [...g]),
    })),
    teams: state.teams.map((t) => ({
      ...t,
      players: [...t.players],
      tracks: { ...t.tracks },
      held: { ...t.held },
    })),
    zones: copyRecord(state.zones, (cards) => [...cards]),
    melds: copyRecord(state.melds, (melds) => melds.map((m) => [...m])),
    reshuffles: { ...state.reshuffles },
    passing: state.passing.map((cards) => [...cards]),
    vars: copyRecord(state.vars, (v) => (Array.isArray(v) ? structuredCopy(v) : v)),
    playedBy: { ...state.playedBy },
    // Entries are never changed once added.
    scoreEvents: [...state.scoreEvents],
    cardEvents: [...state.cardEvents],
    roundStartScores: [...state.roundStartScores],
    cursor: { ...state.cursor, turns: [...state.cursor.turns] },
    trick: copyTrick(state.trick),
    lastTrick: copyTrick(state.lastTrick),
    pending: state.pending && { ...state.pending },
    winners: [...state.winners],
    notes: [...state.notes],
    log: [...state.log],
    // Entries are never changed once added.
    history: [...state.history],
  };
}

function structuredCopy(value: VarValue[]): VarValue[] {
  return value.map((v) => (Array.isArray(v) ? structuredCopy(v) : v));
}
