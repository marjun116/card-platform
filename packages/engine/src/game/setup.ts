import { type Card, cardCode } from '../cards/card';
import { buildDeck } from '../cards/deck';
import { applySet } from '../effects';
import { layDownBonusCards } from '../actions/cardMovement';
import { GameFileError, SetupError } from '../errors';
import { compile, evaluateCondition, evaluateNumber } from '../expr/evaluate';
import type { Node } from '../expr/parser';
import { randomInt, seedRng, shuffle } from '../rng';
import { enterPhase, settle } from './flow';
import type { PlayerId } from './move';
import { buildScope } from './scope';
import {
  type GameState,
  nextActive,
  type TeamState,
  teamZoneKey,
  noteCards,
  zoneCards,
  zoneKey,
} from './state';
import type { GameFile, OptionValue } from './types';

/**
 * Starts a game from a file that has already been validated (createGame in
 * api.ts validates first). Same file, options, player count and seed always
 * give the same game.
 */
export function startGame(
  file: GameFile,
  options: Record<string, OptionValue>,
  playerCount: number,
  seed: string,
): GameState {
  checkPlayerCount(file, playerCount);
  const teams = buildTeams(file, playerCount);
  const rng = seedRng(seed);
  const resolved = resolveOptions(file, options);

  const state: GameState = {
    file,
    options: resolved,
    seed,
    rng,
    players: Array.from({ length: playerCount }, (_, id) => ({
      id,
      team: teams.findIndex((t) => t.players.includes(id)),
      active: true,
      bid: null,
      tricks: 0,
      tracks: {},
      hasLookedAtHand: true,
      vars: {},
      groups: [],
      sittingOut: false,
    })),
    teams,
    zones: {},
    melds: {},
    reshuffles: {},
    passing: [],
    passes: [],
    vars: {},
    playedBy: {},
    scoreEvents: [],
    cardEvents: [],
    moments: [],
    roundStartScores: [],
    round: 1,
    dealer: randomInt(rng, playerCount),
    cursor: {
      phase: 0,
      step: 0,
      current: 0,
      direction: 1,
      turns: [],
      tricks: 0,
      passesInARow: 0,
      skipNext: 0,
      draws: 0,
    },
    trick: null,
    lastTrick: null,
    pending: null,
    lookRequired: usesBlindBids(file, resolved),
    status: 'inProgress',
    winners: [],
    notes: [],
    log: [],
    history: [],
    roundMoves: 0,
    roundStart: 0,
  };
  startRound(state);
  settle(state);
  return state;
}

/**
 * Whether players start with their own hand face down (for blind bids such as
 * blind nil). True if any expression mentions player.hasLookedAtHand, except
 * ones switched off by an option: in "options.blindNil && !player.hasLookedAtHand"
 * with blindNil off, nobody can ever bid blind, so hands start face up.
 */
function usesBlindBids(file: GameFile, options: Record<string, OptionValue>): boolean {
  const strings: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(file);
  return strings
    .filter((s) => s.includes('hasLookedAtHand'))
    .some((source) => !conjuncts(compile(source).ast).some((part) => isOffOption(part, options)));
}

/** The parts of a && b && c. */
function conjuncts(node: Node): Node[] {
  return node.kind === 'binary' && node.op === '&&'
    ? [...conjuncts(node.left), ...conjuncts(node.right)]
    : [node];
}

function isOffOption(node: Node, options: Record<string, OptionValue>): boolean {
  return (
    node.kind === 'member' &&
    node.object.kind === 'name' &&
    node.object.name === 'options' &&
    options[node.name] === false
  );
}

function checkPlayerCount(file: GameFile, count: number): void {
  const [min, max] = Array.isArray(file.meta.players)
    ? file.meta.players
    : [file.meta.players, file.meta.players];
  if (!Number.isInteger(count) || count < min || count > max) {
    throw new SetupError(
      min === max
        ? `${file.meta.name} needs exactly ${min} players (got ${count})`
        : `${file.meta.name} needs ${min} to ${max} players (got ${count})`,
    );
  }
}

/**
 * The partnerships for this many players (`meta.teams`, which may list teams
 * by player count), or null when everyone plays alone.
 */
export function teamsFor(file: GameFile, playerCount: number): number[][] | null {
  const teams = file.meta.teams;
  if (!teams) return null;
  if (Array.isArray(teams)) return teams;
  return Object.hasOwn(teams, String(playerCount)) ? (teams[String(playerCount)] ?? null) : null;
}

function buildTeams(file: GameFile, playerCount: number): TeamState[] {
  const team = (id: number, players: PlayerId[]): TeamState => ({
    id,
    players,
    score: 0,
    tricks: 0,
    tracks: {},
    held: {},
  });
  const teams = teamsFor(file, playerCount);
  if (!teams) {
    return Array.from({ length: playerCount }, (_, id) => team(id, [id]));
  }
  const seats = teams.flat().sort((a, b) => a - b);
  if (seats.length !== playerCount || seats.some((seat, i) => seat !== i)) {
    throw new GameFileError(`meta.teams must list each seat 0 to ${playerCount - 1} exactly once`);
  }
  return teams.map((players, id) => team(id, [...players]));
}

function resolveOptions(
  file: GameFile,
  given: Record<string, OptionValue>,
): Record<string, OptionValue> {
  const defs = file.options ?? {};
  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(defs, name)) throw new SetupError(`Unknown option "${name}"`);
  }
  const resolved: Record<string, OptionValue> = {};
  for (const [name, def] of Object.entries(defs)) {
    const value = Object.hasOwn(given, name) ? (given[name] as OptionValue) : def.default;
    if (def.type === 'boolean' && typeof value !== 'boolean') {
      throw new SetupError(`Option "${name}" must be true or false`);
    }
    if (def.type === 'choice' && !(def.values ?? []).includes(value)) {
      throw new SetupError(
        `Option "${name}" must be one of ${(def.values ?? []).map(String).join(', ')}`,
      );
    }
    resolved[name] = value;
  }
  return resolved;
}

/** The deck minus `deck.remove` cards (every copy) whose condition holds. */
function withoutRemoved(state: GameState, deck: Card[]): Card[] {
  const removed = new Set(
    (state.file.deck.remove ?? [])
      .filter((r) => !r.if || evaluateCondition(r.if, buildScope(state)))
      .flatMap((r) => r.cards),
  );
  return removed.size === 0 ? deck : deck.filter((card) => !removed.has(cardCode(card)));
}

/** Collects all cards, shuffles, deals and flips for a new round, then starts the first phase. */
export function startRound(state: GameState): void {
  const { file } = state;
  for (const player of state.players) {
    player.bid = null;
    player.tricks = 0;
    player.hasLookedAtHand = !state.lookRequired;
    player.vars = {};
    player.groups = [];
    player.sittingOut = false;
  }
  for (const team of state.teams) {
    team.tricks = 0;
    team.held = {};
  }
  state.vars = {};
  state.playedBy = {};
  state.roundStartScores = state.teams.map((t) => t.score);
  state.trick = null;
  state.lastTrick = null;
  state.pending = null;
  state.passing = state.players.map(() => []);
  state.passes = [];
  state.reshuffles = {};
  state.roundMoves = 0;
  state.roundStart = state.log.length;

  // Empty every zone.
  state.zones = {};
  state.melds = {};
  for (const [name, def] of Object.entries(file.zones)) {
    const keys =
      def.per === 'player'
        ? state.players.map((p) => `${name}@${p.id}`)
        : def.per === 'team'
          ? state.teams.map((t) => teamZoneKey(name, t.id))
          : [name];
    for (const key of keys) {
      if (def.melds) state.melds[key] = [];
      else state.zones[key] = [];
    }
  }

  const number = (n: number | string | undefined) =>
    typeof n === 'string' ? evaluateNumber(n, buildScope(state)) : n;
  const deck = withoutRemoved(
    state,
    buildDeck({ ...file.deck, copies: number(file.deck.copies), jokers: number(file.deck.jokers) }),
  );
  if (file.setup.shuffle !== false) shuffle(deck, state.rng);

  // Deal one card at a time, starting left of the dealer.
  const { deal } = file.setup;
  const count = evaluateNumber(deal.count, buildScope(state));
  const active = state.players.filter((p) => p.active);
  if (!Number.isInteger(count) || count < 0 || count * active.length > deck.length) {
    throw new GameFileError(
      `Can't deal ${count} cards to ${active.length} players from a ${deck.length}-card deck`,
    );
  }
  let seat = state.dealer;
  for (let i = 0; i < count * active.length; i++) {
    seat = nextActive(state, seat, 1);
    zoneCards(state, zoneKey(state, deal.to, seat)).push(deck.pop() as (typeof deck)[number]);
  }

  if (file.setup.rest) zoneCards(state, zoneKey(state, file.setup.rest, null)).push(...deck);

  // Bonus cards dealt (red 3s) are laid down and replaced, starting left of the dealer.
  if (file.bonusCards) {
    let bonusSeat = state.dealer;
    for (let i = 0; i < active.length; i++) {
      bonusSeat = nextActive(state, bonusSeat, 1);
      layDownBonusCards(state, bonusSeat, true);
    }
  }

  const flips = file.setup.flip;
  for (const flip of Array.isArray(flips) ? flips : flips ? [flips] : []) {
    if (flip.if && !evaluateCondition(flip.if, buildScope(state))) continue;
    if (flip.triggerEffects) {
      throw new GameFileError('setup.flip with "triggerEffects": true isn\'t supported yet');
    }
    const source = zoneCards(state, zoneKey(state, flip.from, null));
    let card = source.pop();
    if (!card) throw new GameFileError(`No card left in "${flip.from}" to flip`);
    // Bury a card that mustn't start the pile somewhere below the top and turn the next one.
    // If every card would be buried, the last one turned stays.
    for (let tries = source.length; tries > 0 && flip.reflipIf; tries--) {
      if (!evaluateCondition(flip.reflipIf, buildScope(state, { card }))) break;
      source.splice(randomInt(state.rng, source.length), 0, card);
      card = source.pop() ?? card;
    }
    zoneCards(state, zoneKey(state, flip.to, null)).push(card);
    noteCards(state, 'turnedUp', flip.to, null, [card]);
    if (flip.set) applySet(state, flip.set, { card });
  }

  enterPhase(state, 0);
}
