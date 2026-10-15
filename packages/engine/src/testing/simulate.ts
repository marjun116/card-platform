/**
 * Random-play simulation for any game file: plays games to the end with
 * seeded random legal moves, checking after every move that the game is in
 * a legal state. A failure reports the seed and move number, so the exact
 * game can be replayed with `replay(file, options, players, seed, moves)`.
 */
import {
  applyMove,
  createGame,
  dealNextRound,
  getLegalMoves,
  playersToAct,
  replay,
  viewFor,
} from '../api';
import { isRevealed } from '../view';
import type { Bot } from '../bots/types';
import { askBot, botSeat } from '../bots/input';
import type { Move, PlayerId } from '../game/move';
import { draft, type GameState, parseZoneKey, zoneDef } from '../game/state';
import { sortHand } from '../game/arrangement';
import type { GameFile, OptionValue } from '../game/types';
import { moveKey } from '../game/move';
import { randomInt, seedRng } from '../rng';

/** Picks one of the legal moves. `pick(n)` returns a seeded random number from 0 to n-1. */
export type Strategy = (moves: Move[], state: GameState, pick: (n: number) => number) => Move;

/** Any legal move, uniformly at random. */
export const randomStrategy: Strategy = (moves, _state, pick) => moves[pick(moves.length)] as Move;

/**
 * The arrangement "Sort into melds" would make, as an ordinary arrange move,
 * for strategies in games where the house rules switch that button off.
 */
export function bestArrangeMove(state: GameState, player: PlayerId): Move {
  const next = draft(state);
  sortHand(next, player);
  return { player, type: 'arrange', groups: next.players[player]?.groups ?? [] };
}

/** A random move that matches `prefer` when there is one, otherwise any random move. */
export function preferring(prefer: (move: Move, state: GameState) => boolean): Strategy {
  return (moves, state, pick) => {
    const preferred = moves.filter((m) => prefer(m, state));
    return randomStrategy(preferred.length > 0 ? preferred : moves, state, pick);
  };
}

/**
 * Bots as a strategy: each seat's bot sees only its own view (viewFor) and its
 * legal moves, as it would at a real table. `bots` is one bot for every seat,
 * or one per seat.
 */
export function botStrategy(bots: Bot | readonly Bot[]): Strategy {
  return (moves, state, pick) => {
    const seat = botSeat(moves, state.cursor.current);
    const bot = typeof bots === 'function' ? bots : bots[seat];
    if (!bot) throw new Error(`No bot for seat ${seat}`);
    return askBot(bot, state, moves, pick);
  };
}

export interface SimulationOptions {
  options?: Record<string, OptionValue>;
  strategy?: Strategy;
  /** Give up (and fail) after this many moves. Default 20,000. */
  maxMoves?: number;
  /** Check that no player can see hidden cards every N moves (0 = never). Default 10. */
  hiddenCardCheckEvery?: number;
  /** Extra checks after every move; throw to fail. */
  check?: (state: GameState, moveNumber: number) => void;
  /**
   * Play as the server does: hold each new deal after a round is scored, then deal
   * it (see ApplyOptions.holdNextRound). The game must come out exactly the same.
   */
  holdNextRound?: boolean;
}

export class SimulationError extends Error {
  override name = 'SimulationError';

  constructor(
    message: string,
    readonly seed: string,
    readonly playerCount: number,
    readonly moves: readonly Move[],
  ) {
    super(`${message}\n  (seed "${seed}", ${playerCount} players, after ${moves.length} moves)`);
  }
}

export interface SimulationResult {
  state: GameState;
  moves: Move[];
}

/** Plays one game to the end. Throws SimulationError if anything goes wrong. */
export function simulateGame(
  file: GameFile,
  playerCount: number,
  seed: string,
  {
    options = {},
    strategy = randomStrategy,
    maxMoves = 20_000,
    hiddenCardCheckEvery = 10,
    check,
    holdNextRound = false,
  }: SimulationOptions = {},
): SimulationResult {
  const rng = seedRng(`moves:${seed}`);
  const pick = (n: number) => randomInt(rng, n);
  const moves: Move[] = [];
  const fail = (message: string): never => {
    throw new SimulationError(message, seed, playerCount, moves);
  };

  let state: GameState;
  try {
    state = createGame(file, options, playerCount, seed);
  } catch (error) {
    return fail(`createGame failed: ${String(error)}`);
  }
  const deckSize = cardIds(state).length;

  while (state.status !== 'over') {
    if (moves.length >= maxMoves) fail(`The game didn't finish within ${maxMoves} moves`);
    if (state.status === 'betweenRounds') {
      if (playersToAct(state).length > 0) fail('Someone can move before the next deal');
      state = dealNextRound(state);
      continue;
    }
    const actors = playersToAct(state);
    if (actors.length !== 1) fail(`Expected exactly one player to act, got [${actors.join(', ')}]`);
    const actor = actors[0] as PlayerId;
    const legal = getLegalMoves(state, actor).filter((m) => m.type !== 'lookAtHand');
    if (legal.length === 0) fail(`Player ${actor} is due to act but has no legal moves`);

    const move = strategy(legal, state, pick);
    // Arrangements aren't listed among the legal moves; applyMove checks them.
    // Usually one of the listed moves itself; otherwise compare keys.
    const listed =
      (legal as readonly Move[]).includes(move) || legal.some((m) => moveKey(m) === moveKey(move));
    if (move.type !== 'arrange' && !listed) {
      fail(`The strategy chose a move that isn't legal: ${JSON.stringify(move)}`);
    }
    try {
      state = applyMove(state, move, { holdNextRound });
    } catch (error) {
      moves.push(move);
      fail(`applyMove failed: ${String(error)}`);
    }
    moves.push(move);

    const ids = cardIds(state);
    if (ids.length !== deckSize) fail(`Expected ${deckSize} cards but found ${ids.length}`);
    if (new Set(ids).size !== ids.length) fail('The same card is in two places');
    if (state.status === 'inProgress' && !state.players[state.cursor.current]?.active) {
      fail('An eliminated player has the turn');
    }
    for (const team of state.teams) {
      if (!Number.isFinite(team.score)) fail(`Team ${team.id} has score ${team.score}`);
    }
    if (hiddenCardCheckEvery > 0 && moves.length % hiddenCardCheckEvery === 0) {
      const leak = findHiddenCardLeak(state);
      if (leak) fail(leak);
    }
    try {
      check?.(state, moves.length);
    } catch (error) {
      fail(String(error));
    }
  }

  if (state.winners.length === 0) fail('The game ended without a winner');
  if (state.winners.some((w) => !state.players[w]))
    fail(`Invalid winners ${state.winners.join(', ')}`);
  return { state, moves };
}

export interface SimulateManyOptions extends SimulationOptions {
  games: number;
  /** Player counts to rotate through. Default: every count the game allows. */
  playerCounts?: number[];
  /** Seeds are `${seedPrefix}-${i}`. Default "sim". */
  seedPrefix?: string;
  /** Also check that every Nth game replays exactly from its seed and moves (0 = never). Default 50. */
  replayEvery?: number;
  /**
   * Number of the first game (default 0), so a long run can be split into parts
   * that play exactly the same games: seeds, player counts and replay checks all
   * follow the game's number.
   */
  firstGame?: number;
}

export interface SimulationReport {
  games: number;
  averageMoves: number;
  averageRounds: number;
  longestGame: number;
}

/** Plays many seeded games; throws SimulationError on the first problem. */
export function simulateMany(file: GameFile, opts: SimulateManyOptions): SimulationReport {
  const { games, seedPrefix = 'sim', replayEvery = 50, firstGame = 0 } = opts;
  const counts = opts.playerCounts ?? allowedPlayerCounts(file);
  let moves = 0;
  let rounds = 0;
  let longest = 0;
  for (let i = firstGame; i < firstGame + games; i++) {
    const players = counts[i % counts.length] as number;
    const seed = `${seedPrefix}-${i}`;
    const result = simulateGame(file, players, seed, opts);
    moves += result.moves.length;
    rounds += result.state.round;
    longest = Math.max(longest, result.moves.length);
    if (replayEvery > 0 && i % replayEvery === 0) {
      const again = replay(file, opts.options ?? {}, players, seed, result.moves);
      if (JSON.stringify(again) !== JSON.stringify(result.state)) {
        throw new SimulationError(
          'Replaying the moves gave a different game',
          seed,
          players,
          result.moves,
        );
      }
    }
  }
  return {
    games,
    averageMoves: games > 0 ? moves / games : 0,
    averageRounds: games > 0 ? rounds / games : 0,
    longestGame: longest,
  };
}

export function allowedPlayerCounts(file: GameFile): number[] {
  const [min, max] = Array.isArray(file.meta.players)
    ? file.meta.players
    : [file.meta.players, file.meta.players];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** Every card id in the game, wherever it is. */
function cardIds(state: GameState): string[] {
  return [
    ...Object.values(state.zones).flat(),
    ...Object.values(state.melds).flat(2),
    ...state.passing.flat(),
  ].map((c) => c.id);
}

/**
 * Works out from the zone definitions (not from viewFor) which cards each
 * player must not see, then checks viewFor doesn't show them. Returns a
 * description of the first leak, or null. The move log and the last
 * finished trick are left out: they show cards that everyone saw played,
 * which says nothing about where those cards are now.
 */
export function findHiddenCardLeak(state: GameState): string | null {
  // What each zone shows doesn't depend on who's looking, except "owner" zones.
  const zones = Object.entries(state.zones).map(([key, cards]) => {
    const { name, player, team } = parseZoneKey(key);
    const def = zoneDef(state, name);
    const shown =
      isRevealed(state, key) || def.visibility === 'all'
        ? cards
        : def.visibility === 'topCardOnly'
          ? cards.slice(-1)
          : [];
    return { key, cards, player, team, owner: def.visibility === 'owner', shown: new Set(shown) };
  });
  for (const viewer of state.players) {
    const hidden = new Map<string, string>();
    for (const { key, cards, player, team, owner, shown } of zones) {
      const owns = player === viewer.id || (team !== null && team === viewer.team);
      const blind = state.lookRequired && !viewer.hasLookedAtHand && player === viewer.id;
      if (owner && owns && !blind) continue;
      for (const card of cards) if (!shown.has(card)) hidden.set(card.id, key);
    }
    for (const card of state.passing.flat()) hidden.set(card.id, 'cards being passed');

    // The round history and points scored hold no cards, and grow all game long: leaving
    // them out keeps this check from slowing long games down (a rubber of bridge).
    // So are the words for bids, choices and counters, which come from the game file.
    const view = JSON.stringify({
      // The log is left out too (from the state, so viewFor needn't build it).
      ...viewFor({ ...state, log: [] }, viewer.id),
      log: [],
      lastTrick: null,
      history: [],
      scoreEvents: [],
      // Cards everyone saw when they were turned up or given out (checked in the
      // engine's own tests), even if they're in someone's hand now.
      cardEvents: [],
      bidLabels: {},
      choiceLabels: {},
      trackLabels: {},
    });
    // Every card id anywhere in the view, collected once ("QS.0", "10H.1", "JOKER.0").
    const shown = new Set(
      view.match(/(?<=")(?:10|[2-9JQKA])[CDHS]\.\d+(?=")|(?<=")JOKER\.\d+(?=")/g),
    );
    for (const [id, where] of hidden) {
      if (shown.has(id)) return `Player ${viewer.id} can see ${id} (in ${where})`;
    }
  }
  return null;
}
