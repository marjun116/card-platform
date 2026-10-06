import { GameFileError } from '../errors';
import { type Card, jokerCard, RANKS, type Rank, type Suit, SUITS, suitedCard } from './card';

export interface DeckDef {
  /** How many 52-card decks are combined (1 to 6). Default 1. */
  copies?: number;
  /** Ranks to keep. Default: all 13. */
  ranks?: readonly Rank[];
  /** Suits to keep. Default: all 4. */
  suits?: readonly Suit[];
  /** Jokers per deck (0, 1 or 2). Default 0. */
  jokers?: number;
}

/** Builds the full, unshuffled set of cards for a game. */
export function buildDeck(def: DeckDef): Card[] {
  const copies = def.copies ?? 1;
  const jokers = def.jokers ?? 0;
  if (!Number.isInteger(copies) || copies < 1 || copies > 6) {
    throw new GameFileError(`deck.copies must be a whole number from 1 to 6 (got ${copies})`);
  }
  if (!Number.isInteger(jokers) || jokers < 0 || jokers > 2) {
    throw new GameFileError(`deck.jokers must be 0, 1 or 2 (got ${jokers})`);
  }
  const ranks = def.ranks ?? RANKS;
  const suits = def.suits ?? SUITS;

  const cards: Card[] = [];
  let jokerCount = 0;
  for (let copy = 0; copy < copies; copy++) {
    for (const suit of suits) {
      for (const rank of ranks) cards.push(suitedCard(rank, suit, copy));
    }
    for (let j = 0; j < jokers; j++) cards.push(jokerCard(jokerCount++));
  }
  return cards;
}
