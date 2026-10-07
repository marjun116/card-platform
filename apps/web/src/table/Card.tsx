/**
 * One playing card: a picture from the card set with our own corner index
 * on top (so suits use the four-colour scheme even on face cards), a drawn
 * card back, or a drawn joker.
 */
import type { Card as CardData } from '@card-table/engine';
import { useSettings } from '../useSettings';
import { cardImage, isJoker, SUIT_SYMBOL, spokenLabel, suitClass } from './cards';

export type CardSize = 'normal' | 'small' | 'tiny';

export function CardFace({ card, size = 'normal' }: { card: CardData; size?: CardSize }) {
  const { settings } = useSettings();
  const image = cardImage(card, settings.fourColor);
  const suit = isJoker(card) ? null : card.suit;
  return (
    <span className={`card face size-${size}`} role="img" aria-label={spokenLabel(card)}>
      {image ? (
        <img src={image} alt="" draggable={false} />
      ) : (
        <span className="joker-art" aria-hidden="true">
          ★
        </span>
      )}
      <span className={`index ${suitClass(suit, settings.fourColor)}`} aria-hidden="true">
        <span className="rank">{isJoker(card) ? 'JKR' : card.rank}</span>
        {suit && <span className="pip">{SUIT_SYMBOL[suit]}</span>}
      </span>
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
