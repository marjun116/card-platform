import type { CardId, Suit } from '../cards/card';

/** Seat number, 0 to n-1. */
export type PlayerId = number;
export type ZoneKey = string;
export type BidValue = number | string;

/** A move a player makes. getLegalMoves returns exactly these objects. */
export type Move =
  | { player: PlayerId; type: 'play'; card: CardId; to: string }
  | { player: PlayerId; type: 'playToTrick'; card: CardId }
  | { player: PlayerId; type: 'discard'; card: CardId; to: string }
  | { player: PlayerId; type: 'draw'; from: string }
  | { player: PlayerId; type: 'pickUpPile'; from: string }
  | { player: PlayerId; type: 'pass'; cards: CardId[] }
  | { player: PlayerId; type: 'meld'; cards: CardId[] }
  | { player: PlayerId; type: 'layOff'; card: CardId; meld: { zone: ZoneKey; index: number } }
  | { player: PlayerId; type: 'bid'; value: BidValue }
  | { player: PlayerId; type: 'passBid' }
  | { player: PlayerId; type: 'declareTrump'; suit: Suit }
  | { player: PlayerId; type: 'chooseSuit'; suit: Suit }
  | { player: PlayerId; type: 'choose'; value: string }
  | { player: PlayerId; type: 'showHand'; card: CardId; to: string }
  /** Group the cards in your hand (free; any time). Not listed in legal moves. */
  | { player: PlayerId; type: 'arrange'; groups: CardId[][] }
  /** "Sort into melds": the engine groups your hand for you (free; any time). */
  | { player: PlayerId; type: 'sortHand' }
  | { player: PlayerId; type: 'lookAtHand' }
  | { player: PlayerId; type: 'endTurn' };

export type MoveType = Move['type'];

/** Order-independent identity of a move, used to match a requested move to a legal one. */
export function moveKey(move: Move): string {
  const base = `${move.player}|${move.type}`;
  switch (move.type) {
    case 'play':
    case 'discard':
      return `${base}|${move.card}|${move.to}`;
    case 'playToTrick':
      return `${base}|${move.card}`;
    case 'draw':
    case 'pickUpPile':
      return `${base}|${move.from}`;
    case 'pass':
    case 'meld':
      // Card lists are sets: the order a player picks them in doesn't matter.
      return `${base}|${[...move.cards].sort().join(',')}`;
    case 'layOff':
      return `${base}|${move.card}|${move.meld.zone}|${move.meld.index}`;
    case 'bid':
      return `${base}|${typeof move.value}:${move.value}`;
    case 'declareTrump':
    case 'chooseSuit':
      return `${base}|${move.suit}`;
    case 'choose':
      return `${base}|${move.value}`;
    case 'showHand':
      return `${base}|${move.card}|${move.to}`;
    case 'arrange':
      return `${base}|${move.groups.map((g) => [...g].sort().join(',')).join(';')}`;
    case 'sortHand':
      return base;
    case 'passBid':
    case 'lookAtHand':
    case 'endTurn':
      return base;
  }
}
