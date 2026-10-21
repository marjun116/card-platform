/**
 * Suits and cards inside text. Every suit symbol is shown in its colour, on a
 * small light chip so red and black stay readable on the felt, on buttons and
 * in dark mode. Cards named in text are drawn as small inline cards, with
 * their spoken name ("Queen of spades") for screen readers.
 */
import type { Card, Suit } from '@card-table/engine';
import { Fragment } from 'react';
import {
  cardFromId,
  isJoker,
  isRed,
  shortLabel,
  SUIT_SYMBOL,
  spokenLabel,
  suitName,
} from './cards';
import type { Line } from './describe';

const SYMBOL_SUIT: Record<string, Suit> = {
  '♣': 'clubs',
  '♦': 'diamonds',
  '♥': 'hearts',
  '♠': 'spades',
};

/** A suit symbol in its colour. Decorative: the suit is also given in words, or by the symbol in text. */
export function SuitSymbol({ suit }: { suit: Suit }) {
  return (
    <span className={`suit-pip ${isRed(suit) ? 'red' : 'black'}`} aria-hidden="true">
      {SUIT_SYMBOL[suit]}
    </span>
  );
}

/**
 * Text with any ♠♥♦♣ in it shown in their colours: "1♣", "Play Q♠", a game's
 * own labels. Screen readers read the text as it is.
 */
export function SuitText({ text }: { text: string }) {
  const pieces = text.split(/([♣♦♥♠])/u);
  if (pieces.length === 1) return <>{text}</>;
  return (
    <>
      {pieces.map((piece, i) => {
        const suit = SYMBOL_SUIT[piece];
        if (!suit) return piece && <Fragment key={i}>{piece}</Fragment>;
        return (
          <span key={i} className={`suit-pip ${isRed(suit) ? 'red' : 'black'}`}>
            {piece}
          </span>
        );
      })}
    </>
  );
}

/** A suit named in a sentence: its symbol, then its name ("♥ hearts"). */
export function SuitWord({ suit, capital = false }: { suit: Suit; capital?: boolean }) {
  return (
    <span className="suit-word">
      <SuitSymbol suit={suit} /> {capital ? suitName(suit) : suit}
    </span>
  );
}

/** A small card inside text: "Q♠" on a white card, read aloud as "Queen of spades". */
export function InlineCard({ card }: { card: Card }) {
  const red = isJoker(card) || isRed(card.suit);
  return (
    <span
      className={`inline-card ${red ? 'red' : 'black'}`}
      role="img"
      aria-label={spokenLabel(card)}
    >
      <span aria-hidden="true">{shortLabel(card)}</span>
    </span>
  );
}

/** A line from `describe.ts` with its cards and suits drawn. */
export function RichLine({ line }: { line: Line }) {
  return (
    <>
      {line.map((part, i) => {
        if (typeof part === 'string') return <SuitText key={i} text={part} />;
        if ('suit' in part) return <SuitWord key={i} suit={part.suit} />;
        const card = cardFromId(part.card);
        return card ? <InlineCard key={i} card={card} /> : <Fragment key={i}>{part.card}</Fragment>;
      })}
    </>
  );
}
