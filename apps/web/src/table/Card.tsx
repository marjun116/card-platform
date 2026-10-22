/**
 * One playing card: a picture from the card set (its own corner index shows
 * the rank and suit), a drawn card back, or a drawn joker. Tiny cards, too
 * small for the artwork to be read, show just a large rank and suit instead.
 */
import type { Card as CardData } from '@card-table/engine';
import { cardImage, isJoker, isRed, SUIT_SYMBOL, spokenLabel } from './cards';

export type CardSize = 'normal' | 'small' | 'tiny';

export function CardFace({ card, size = 'normal' }: { card: CardData; size?: CardSize }) {
  const image = cardImage(card);
  const suit = isJoker(card) ? null : card.suit;
  const colour = isRed(suit) || suit === null ? 'red' : 'black';
  return (
    <span
      className={`card face size-${size}`}
      role="img"
      aria-label={spokenLabel(card)}
      // Lets card motion find this card again after the table changes.
      data-card-id={card.id}
    >
      {image && size !== 'tiny' ? (
        <img src={image} alt="" draggable={false} />
      ) : (
        <>
          {!image && (
            <span className="joker-art" aria-hidden="true">
              ★
            </span>
          )}
          <span className={`index ${colour}`} aria-hidden="true">
            <span className="rank">{isJoker(card) ? 'JKR' : card.rank}</span>
            {suit && <span className="pip">{SUIT_SYMBOL[suit]}</span>}
          </span>
        </>
      )}
    </span>
  );
}

export function CardBack({ size = 'normal', label }: { size?: CardSize; label?: string }) {
  return (
    <span
      className={`card back size-${size}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
