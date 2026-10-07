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
const cardList = z.array(cardId).min(1).max(60);

/**
 * A move as the client sends it. `player` is optional and always ignored:
 * the server fills in the sender's own seat.
 */
const player = { player: z.number().int().optional() };
export const moveSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...player, type: z.literal('play'), card: cardId, to: zoneName }),
  z.strictObject({ ...player, type: z.literal('playToTrick'), card: cardId }),
  z.strictObject({ ...player, type: z.literal('discard'), card: cardId, to: zoneName }),
  z.strictObject({ ...player, type: z.literal('draw'), from: zoneName }),
  z.strictObject({ ...player, type: z.literal('pickUpPile'), from: zoneName }),
  z.strictObject({ ...player, type: z.literal('pass'), cards: cardList }),
  z.strictObject({ ...player, type: z.literal('meld'), cards: cardList }),
  z.strictObject({
    ...player,
    type: z.literal('layOff'),
    card: cardId,
    meld: z.strictObject({ zone: zoneName, index: z.number().int().min(0).max(100) }),
  }),
  z.strictObject({
    ...player,
    type: z.literal('bid'),
    value: z.union([z.number().finite(), z.string().max(20)]),
  }),
  z.strictObject({ ...player, type: z.literal('passBid') }),
  z.strictObject({ ...player, type: z.literal('declareTrump'), suit }),
  z.strictObject({ ...player, type: z.literal('chooseSuit'), suit }),
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
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type MessageId = z.infer<typeof id>;

export interface SeatInfo {
  seat: number;
  user: { id: string; displayName: string } | null;
  /** The seated player has the table open right now. */
  connected: boolean;
}

/** A game tables can be created from, as listed by GET /api/games. */
export interface GameSummary {
  slug: string;
  name: string;
  /** Allowed player counts, smallest first. */
  players: number[];
  teams: number[][] | null;
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
