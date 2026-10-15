/**
 * viewFor: the game as one player is allowed to see it. The server sends
 * only this to a client, never the full state.
 */
import type { Card, CardId } from './cards/card';
import { controlOf, turnSteps } from './game/legal';
import { checkedGroups, deadwood } from './game/arrangement';
import type { BidValue, Move, PlayerId, ZoneKey } from './game/move';
import {
  type GameState,
  parseZoneKey,
  type RoundResult,
  type CardEvent,
  type ScoreEvent,
  type TrickState,
  zoneDef,
  zoneKey,
} from './game/state';
import type { GameFile, OptionValue } from './game/types';
import { evaluate, evaluateCondition } from './expr/evaluate';
import { buildScope } from './game/scope';

/** What a player sees of one zone. */
export type ZoneView =
  | { kind: 'cards'; cards: Card[] }
  | { kind: 'melds'; melds: Card[][] }
  | { kind: 'count'; count: number; top: Card | null }
  | { kind: 'hidden' };

/** A log entry with any card the viewer may not see removed. */
export type PublicMove =
  | Move
  | { player: PlayerId; type: 'pass'; hidden: true }
  | { player: PlayerId; type: 'arrange'; hidden: true }
  | { player: PlayerId; type: 'play' | 'discard'; to: string; hidden: true };

export interface PlayerView {
  you: PlayerId;
  game: string;
  round: number;
  dealer: PlayerId;
  status: 'inProgress' | 'over';
  winners: PlayerId[];
  options: Record<string, OptionValue>;
  players: {
    id: PlayerId;
    team: number;
    active: boolean;
    bid: BidValue | null;
    tricks: number;
    tracks: Record<string, number>;
    hasLookedAtHand: boolean;
    /** Out of play this round (a lone player's partner). */
    sittingOut: boolean;
  }[];
  teams: {
    id: number;
    players: PlayerId[];
    score: number;
    tricks: number;
    tracks: Record<string, number>;
    /** Points held this round, such as meld (public). */
    held: Record<string, number>;
  }[];
  vars: GameState['vars'];
  phase: string;
  currentPlayer: PlayerId;
  direction: 1 | -1;
  trick: TrickView | null;
  lastTrick: TrickView | null;
  /** Names of the zones tricks are played into, so a client can draw them as tricks, not piles. */
  trickZones: string[];
  /** Shared zones not drawn on the table right now (their `showOnTable` doesn't hold). */
  offTable: string[];
  /** A decision the game is waiting on; `card` is shown only to the player deciding. */
  pending: {
    kind: 'chooseSuit' | 'mayPlayDrawnCard' | 'ask';
    player: PlayerId;
    card?: CardId;
  } | null;
  zones: Record<ZoneKey, ZoneView>;
  log: PublicMove[];
  /** Where this round's moves begin in `log` (to see which cards have gone this hand). */
  roundStart: number;
  /** Every finished round, oldest first (public: bids, tricks and scores only). */
  history: RoundResult[];
  /** Points scored during rounds (`score` effects), oldest first, to show in the log. */
  scoreEvents: ScoreEvent[];
  /** Cards turned up in the deal or given out by effects, oldest first, for the log. */
  cardEvents: CardEvent[];
  /**
   * Values the game shows on the table (`display`), e.g. { label: "Count", value: 23 }.
   * With `format`, the value is a seat or team number to show as names.
   */
  display: { label: string; value: string | number | boolean; format?: 'player' | 'team' }[];
  /** Words shown with the result once the game is over, e.g. "Skunk!". */
  notes: string[];
  /** Words for `choose` values, e.g. { "shooterMinus26": "Take 26 off my score" }. */
  choiceLabels: Record<string, string>;
  /** Words for bids, e.g. { "11": "1♣" }. */
  bidLabels: Record<string, string>;
  /** Words for tracked counters; null means the counter isn't shown. */
  trackLabels: Record<string, string | null>;
  /** One seat playing for another (bridge's declarer for the dummy), or null. */
  control: { seat: PlayerId; by: PlayerId } | null;
  /**
   * How you've grouped your hand, in games where players arrange their hands
   * (null otherwise): each group with what kind of meld it is (null if it
   * isn't a valid one), and the points left outside valid groups.
   */
  arrangement: {
    groups: { cards: CardId[]; kind: 'set' | 'run' | null; pure: boolean }[];
    deadwood: number;
  } | null;
}

export interface TrickView {
  /** The zone the trick's cards are in, which also appears in `zones`. */
  zone: ZoneKey;
  leader: PlayerId;
  plays: { player: PlayerId; card: Card | null }[];
  winner: PlayerId | null;
}

type Access = 'cards' | 'count' | 'top' | 'hidden';

/** How much of a zone a player may see. */
function access(state: GameState, key: ZoneKey, viewer: PlayerId): Access {
  const { name, player, team } = parseZoneKey(key);
  const def = zoneDef(state, name);
  if (isRevealed(state, key)) return 'cards';
  switch (def.visibility) {
    case 'all':
      return 'cards';
    case 'topCardOnly':
      return 'top';
    case 'none':
      return def.countVisible ? 'count' : 'hidden';
    case 'owner': {
      const viewerTeam = state.players[viewer]?.team;
      const owns = player === viewer || (team !== null && team === viewerTeam);
      if (!owns) return 'count';
      // Blind bids: your own hand stays face down until you look.
      const blind = state.lookRequired && !state.players[viewer]?.hasLookedAtHand;
      return blind && def.per === 'player' ? 'count' : 'cards';
    }
  }
}

/** Is this player's (or team's) zone shown to everyone right now (its `reveal`)? */
export function isRevealed(state: GameState, key: ZoneKey): boolean {
  const { name, player, team } = parseZoneKey(key);
  const reveal = zoneDef(state, name).reveal;
  if (!reveal) return false;
  const owner = player !== null ? { player } : team !== null ? { team } : null;
  return owner !== null && evaluateCondition(reveal, buildScope(state, owner));
}

function zoneView(cards: Card[], level: Access): ZoneView {
  switch (level) {
    case 'cards':
      return { kind: 'cards', cards: [...cards] };
    case 'top':
      return { kind: 'count', count: cards.length, top: cards[cards.length - 1] ?? null };
    case 'count':
      return { kind: 'count', count: cards.length, top: null };
    case 'hidden':
      return { kind: 'hidden' };
  }
}

function offTable(state: GameState): string[] {
  const scope = buildScope(state);
  return Object.entries(state.file.zones)
    .filter(([, def]) => def.showOnTable && !evaluateCondition(def.showOnTable, scope))
    .map(([name]) => name);
}

function trickZones(state: GameState): string[] {
  const names = new Set<string>();
  for (const phase of state.file.phases) {
    for (const step of turnSteps(phase)) {
      for (const action of step.actions) {
        if (action.type === 'playToTrick') names.add(action.to ?? 'trick');
      }
    }
  }
  return [...names];
}

/** Labels for every bid action's values in the game file. */
export function bidLabelsOf(file: GameFile): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const phase of file.phases) {
    for (const step of turnSteps(phase)) {
      for (const action of step.actions) {
        if (action.type === 'bid') Object.assign(labels, action.labels);
      }
    }
  }
  return labels;
}

/** Labels for every `choose` action's (and `ask` effect's) values in the game file. */
export function choiceLabelsOf(file: GameFile): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const phase of file.phases) {
    for (const step of turnSteps(phase)) {
      for (const action of step.actions) {
        if (action.type === 'choose') Object.assign(labels, action.labels);
        for (const effect of action.effects ?? []) {
          if (effect.ask !== undefined) Object.assign(labels, effect.labels);
        }
      }
    }
  }
  return labels;
}

function trickView(state: GameState, trick: TrickState | null, viewer: PlayerId): TrickView | null {
  if (!trick) return null;
  const visible = access(state, trick.zone, viewer) === 'cards';
  return {
    zone: trick.zone,
    leader: trick.leader,
    winner: trick.winner,
    plays: trick.plays.map((p) => ({
      player: p.player,
      card: visible || p.player === viewer ? p.card : null,
    })),
  };
}

function publicMove(state: GameState, move: Move, viewer: PlayerId): PublicMove {
  if (move.player === viewer || move.by === viewer) return move;
  if (move.type === 'pass') return { player: move.player, type: 'pass', hidden: true };
  if (move.type === 'arrange') return { player: move.player, type: 'arrange', hidden: true };
  if (move.type === 'play' || move.type === 'discard') {
    const level = access(state, zoneKey(state, move.to, move.player), viewer);
    if (level !== 'cards' && level !== 'top') {
      return { player: move.player, type: move.type, to: move.to, hidden: true };
    }
  }
  return move;
}

/** The game's `display` values that apply now. The validator keeps them to public values. */
function displayValues(state: GameState): PlayerView['display'] {
  const shown: PlayerView['display'] = [];
  for (const item of state.file.display ?? []) {
    const scope = buildScope(state);
    if (item.if && !evaluateCondition(item.if, scope)) continue;
    const value = evaluate(item.value, scope);
    if (value === null) continue;
    const simple =
      typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
    const word = simple ? item.labels?.[String(value)] : undefined;
    if (word !== undefined) {
      shown.push({ label: item.label, value: word });
      continue;
    }
    shown.push({
      label: item.label,
      value: simple ? value : JSON.stringify(value),
      ...(item.format && typeof value === 'number' ? { format: item.format } : {}),
    });
  }
  return shown;
}

export function viewFor(state: GameState, viewer: PlayerId): PlayerView {
  const zones: Record<ZoneKey, ZoneView> = {};
  for (const [key, cards] of Object.entries(state.zones)) {
    zones[key] = zoneView(cards, access(state, key, viewer));
  }
  for (const [key, melds] of Object.entries(state.melds)) {
    const level = access(state, key, viewer);
    zones[key] =
      level === 'cards'
        ? { kind: 'melds', melds: melds.map((m) => [...m]) }
        : zoneView(melds.flat(), level);
  }

  const pending = state.pending;
  return {
    you: viewer,
    game: state.file.meta.name,
    round: state.round,
    dealer: state.dealer,
    status: state.status,
    winners: [...state.winners],
    options: { ...state.options },
    players: state.players.map((p) => ({
      id: p.id,
      team: p.team,
      active: p.active,
      bid: p.bid,
      tricks: p.tricks,
      tracks: { ...p.tracks },
      hasLookedAtHand: p.hasLookedAtHand,
      sittingOut: p.sittingOut,
    })),
    teams: state.teams.map((t) => ({
      ...t,
      players: [...t.players],
      tracks: { ...t.tracks },
      held: { ...t.held },
    })),
    vars: { ...state.vars },
    phase: state.file.phases[state.cursor.phase]?.name ?? '',
    currentPlayer: state.cursor.current,
    direction: state.cursor.direction,
    trick: trickView(state, state.trick, viewer),
    lastTrick: trickView(state, state.lastTrick, viewer),
    trickZones: trickZones(state),
    offTable: offTable(state),
    pending: pending && {
      kind: pending.kind,
      player: pending.player,
      ...(pending.kind === 'mayPlayDrawnCard' && pending.player === viewer
        ? { card: pending.card }
        : {}),
    },
    zones,
    log: state.log.map((m) => publicMove(state, m, viewer)),
    roundStart: state.roundStart,
    history: state.history,
    scoreEvents: state.scoreEvents,
    cardEvents: state.cardEvents,
    display: displayValues(state),
    notes: [...state.notes],
    choiceLabels: choiceLabelsOf(state.file),
    bidLabels: bidLabelsOf(state.file),
    trackLabels: { ...state.file.scoring.trackLabels },
    control: controlOf(state),
    // A hand that is still face down (blind bids) shows no groups either.
    arrangement:
      state.file.meldRules && !(state.lookRequired && !state.players[viewer]?.hasLookedAtHand)
        ? {
            groups: checkedGroups(state, viewer).map(({ cards, info }) => ({
              cards: cards.map((c) => c.id),
              kind: info?.kind ?? null,
              pure: info?.pure ?? false,
            })),
            deadwood: deadwood(state, viewer),
          }
        : null,
  };
}
