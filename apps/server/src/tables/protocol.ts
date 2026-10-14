/**
 * The WebSocket protocol between a table and its players. Every message is
 * JSON. Clients send ClientMessage; the server checks it with the schema
 * below before doing anything with it. The server sends ServerMessage.
 *
 * The web app imports these types as "@card-table/server/protocol", so this
 * file must not import anything that only works in Node.
 */
import type { Move, OptionDef, OptionValue, PlayerView, Scores } from '@card-table/engine';
import { z } from 'zod';
import type { TableStatus } from '../store/types';

const cardId = z.string().min(1).max(16);
const zoneName = z.string().min(1).max(40);
const suit = z.enum(['clubs', 'diamonds', 'hearts', 'spades']);
// Multi-deck games (canasta: 108 cards) can have big hands.
const cardList = z.array(cardId).min(1).max(400);
const meldRef = z.strictObject({ zone: zoneName, index: z.number().int().min(0).max(100) });

/**
 * A move as the client sends it. Normally `player` is optional and ignored:
 * the server fills in the sender's own seat. A move made for another seat
 * (bridge's declarer playing the dummy) names that seat in `player` and has
 * `by`; the server sets `by` to the sender's seat and the engine checks the
 * sender really controls that seat.
 */
const player = {
  player: z.number().int().min(0).max(9).optional(),
  by: z.number().int().min(0).max(9).optional(),
};
export const moveSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...player, type: z.literal('play'), card: cardId, to: zoneName }),
  z.strictObject({ ...player, type: z.literal('playToTrick'), card: cardId }),
  z.strictObject({ ...player, type: z.literal('discard'), card: cardId, to: zoneName }),
  z.strictObject({ ...player, type: z.literal('draw'), from: zoneName }),
  z.strictObject({
    ...player,
    type: z.literal('pickUpPile'),
    from: zoneName,
    cards: cardList.optional(),
    meld: meldRef.optional(),
  }),
  z.strictObject({ ...player, type: z.literal('pass'), cards: cardList }),
  z.strictObject({ ...player, type: z.literal('meld'), cards: cardList }),
  z.strictObject({
    ...player,
    type: z.literal('layOff'),
    card: cardId,
    meld: meldRef,
  }),
  z.strictObject({
    ...player,
    type: z.literal('bid'),
    value: z.union([z.number().finite(), z.string().max(20)]),
  }),
  z.strictObject({ ...player, type: z.literal('passBid') }),
  z.strictObject({ ...player, type: z.literal('declareTrump'), suit }),
  z.strictObject({ ...player, type: z.literal('chooseSuit'), suit }),
  z.strictObject({ ...player, type: z.literal('choose'), value: z.string().min(1).max(40) }),
  z.strictObject({
    ...player,
    type: z.literal('showHand'),
    card: cardId.nullable(),
    to: zoneName,
  }),
  z.strictObject({
    ...player,
    type: z.literal('arrange'),
    groups: z.array(z.array(cardId).max(400)).max(100),
  }),
  z.strictObject({ ...player, type: z.literal('sortHand') }),
  z.strictObject({ ...player, type: z.literal('lookAtHand') }),
  z.strictObject({ ...player, type: z.literal('endTurn') }),
]);

/** Client-chosen id, echoed in the server's ack or error so the client can match them up. */
const id = z.union([z.string().max(64), z.number()]);
const seat = z.number().int().min(0).max(9);

export const clientMessageSchema = z.discriminatedUnion('type', [
  /** Take an empty seat. */
  z.strictObject({ id, type: z.literal('sit'), seat }),
  /** Leave your seat (lobby only). */
  z.strictObject({ id, type: z.literal('stand') }),
  /** Host: deal and start playing. Every seat must be filled. */
  z.strictObject({ id, type: z.literal('start') }),
  /** Make a move. `seq` is the number of moves you've seen; a stale one is rejected. */
  z.strictObject({ id, type: z.literal('move'), seq: z.number().int().min(0), move: moveSchema }),
  /** Remind the player whose turn it is. */
  z.strictObject({ id, type: z.literal('nudge'), seat }),
  /** Host controls. */
  z.strictObject({ id, type: z.literal('pause') }),
  z.strictObject({ id, type: z.literal('resume') }),
  z.strictObject({ id, type: z.literal('end') }),
  /** Host: free a seat whose player isn't connected, so someone else can take it. */
  z.strictObject({ id, type: z.literal('freeSeat'), seat }),
  /** Host, built-in games only: a bot takes this empty seat (before or during the game). */
  z.strictObject({ id, type: z.literal('addBot'), seat }),
  /** Host, before the game starts: the bot leaves this seat. */
  z.strictObject({ id, type: z.literal('removeBot'), seat }),
  /** Host, during the game: a bot takes over from a player who isn't connected. */
  z.strictObject({ id, type: z.literal('replaceWithBot'), seat }),
  /** You've closed the last round's scores, so the bots can carry on. */
  z.strictObject({ id, type: z.literal('roundSeen') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type MessageId = z.infer<typeof id>;

export interface SeatInfo {
  seat: number;
  user: { id: string; displayName: string } | null;
  /** The seated player has the table open right now (a bot always has). */
  connected: boolean;
  /** The seat is played by a bot. */
  bot: boolean;
}

/** A game tables can be created from, as listed by GET /api/games. */
export interface GameSummary {
  slug: string;
  name: string;
  /** Allowed player counts, smallest first. */
  players: number[];
  /** Partnerships, for a game always played in teams. */
  teams: number[][] | null;
  /** Player counts that play in partnerships, for games where only some do. */
  partnersWith: number[];
  options: Record<string, OptionDef>;
}

/** What anyone with the invite code may see: the lobby, never any cards. */
export interface TableInfo {
  code: string;
  game: { slug: string; name: string; version: number };
  options: Record<string, OptionValue>;
  playerCount: number;
  teams: number[][] | null;
  status: TableStatus;
  hostId: string;
  seats: SeatInfo[];
  /** Bots can take seats (built-in games only). */
  botsAllowed: boolean;
  /**
   * Seats still looking at the scores of the round that just ended. Bots wait
   * until every one of them has closed the scores (or left the table).
   */
  readingScores: number[];
}

/**
 * A saved variant, as GET /api/variants/... sends it. Anyone with the code
 * may see it. Options and player count already fit the game's current file.
 */
export interface VariantInfo {
  code: string;
  name: string;
  game: { slug: string; name: string };
  options: Record<string, OptionValue>;
  playerCount: number;
  owner: { id: string; displayName: string };
}

/** A game you sat at that's over, as GET /api/history lists it. */
export interface PastGame {
  /** The table's code: its page shows the final scores and every round. */
  code: string;
  game: { slug: string; name: string };
  /** `abandoned`: the host ended it early, and there's no result. */
  status: 'finished' | 'abandoned';
  /** When it ended (ISO 8601). */
  endedAt: string | null;
  seats: { seat: number; displayName: string; bot: boolean }[];
  /** Your seat. */
  you: number;
  winners: number[];
  /** Final scores, one entry per team (one-player teams for games without partners). */
  teams: { players: number[]; score: number }[] | null;
}

/** Games played and won, per game; finished games only. */
export interface GameStats {
  game: { slug: string; name: string };
  played: number;
  won: number;
}

export type ErrorCode =
  | 'BAD_MESSAGE'
  | 'WRONG_STATUS'
  | 'NOT_HOST'
  | 'NOT_SEATED'
  | 'BAD_SEAT'
  | 'SEAT_TAKEN'
  | 'ALREADY_SEATED'
  | 'SEATS_EMPTY'
  | 'STALE_SEQ'
  | 'ILLEGAL_MOVE'
  | 'NOT_THEIR_TURN'
  | 'RATE_LIMITED'
  | 'PLAYER_CONNECTED'
  | 'NO_BOTS'
  | 'SERVER_ERROR';

export type ServerMessage =
  /** Lobby info. Sent on connect and whenever seats, presence or status change. */
  | { type: 'table'; table: TableInfo }
  /** Your view of the game. Sent to seated players on connect and after every move. */
  | {
      type: 'game';
      /** Moves made so far. Send it back with your next move. */
      seq: number;
      view: PlayerView;
      /** Your legal moves right now (none while paused). */
      legalMoves: Move[];
      /** Seats with a move to make. */
      toAct: number[];
    }
  /** The game finished. */
  | { type: 'over'; winners: number[]; scores: Scores }
  /** Someone nudged you: it's your turn. */
  | { type: 'nudged'; by: number }
  | { type: 'ack'; id: MessageId }
  | { type: 'error'; id: MessageId | null; code: ErrorCode; message: string };
