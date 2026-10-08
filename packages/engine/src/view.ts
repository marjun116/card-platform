/**
 * viewFor: the game as one player is allowed to see it. The server sends
 * only this to a client, never the full state.
 */
import type { Card, CardId } from './cards/card';
import { turnSteps } from './game/legal';
import { checkedGroups, deadwood } from './game/arrangement';
import type { BidValue, Move, PlayerId, ZoneKey } from './game/move';
import {
  type GameState,
  parseZoneKey,
  type RoundResult,
  type TrickState,
  zoneDef,
  zoneKey,
} from './game/state';
import type { GameFile, OptionValue } from './game/types';

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
  }[];
  teams: {
    id: number;
    players: PlayerId[];
    score: number;
    tricks: number;
    tracks: Record<string, number>;
  }[];
  vars: GameState['vars'];
  phase: string;
  currentPlayer: PlayerId;
  direction: 1 | -1;
  trick: TrickView | null;
  lastTrick: TrickView | null;
  /** Names of the zones tricks are played into, so a client can draw them as tricks, not piles. */
  trickZones: string[];
  /** A decision the game is waiting on; `card` is shown only to the player deciding. */
  pending: { kind: 'chooseSuit' | 'mayPlayDrawnCard'; player: PlayerId; card?: CardId } | null;
  zones: Record<ZoneKey, ZoneView>;
  log: PublicMove[];
  /** Every finished round, oldest first (public: bids, tricks and scores only). */
  history: RoundResult[];
  /** Words for `choose` values, e.g. { "shooterMinus26": "Take 26 off my score" }. */
  choiceLabels: Record<string, string>;
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

/** Labels for every `choose` action's values in the game file. */
export function choiceLabelsOf(file: GameFile): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const phase of file.phases) {
    for (const step of turnSteps(phase)) {
      for (const action of step.actions) {
        if (action.type === 'choose') Object.assign(labels, action.labels);
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
  if (move.player === viewer) return move;
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
    })),
    teams: state.teams.map((t) => ({ ...t, players: [...t.players], tracks: { ...t.tracks } })),
    vars: { ...state.vars },
    phase: state.file.phases[state.cursor.phase]?.name ?? '',
    currentPlayer: state.cursor.current,
    direction: state.cursor.direction,
    trick: trickView(state, state.trick, viewer),
    lastTrick: trickView(state, state.lastTrick, viewer),
    trickZones: trickZones(state),
    pending: pending && {
      kind: pending.kind,
      player: pending.player,
      ...(pending.kind === 'mayPlayDrawnCard' && pending.player === viewer
        ? { card: pending.card }
        : {}),
    },
    zones,
    log: state.log.map((m) => publicMove(state, m, viewer)),
    history: state.history,
    choiceLabels: choiceLabelsOf(state.file),
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
