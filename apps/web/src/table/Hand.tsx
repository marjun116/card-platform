/**
 * Your hand. Each card is a toggle button: the first press selects it, a
 * second press plays it when that's the only thing it can do. Arrow keys,
 * Home and End move between cards; only one card is in the Tab order.
 */
import type { Card as CardData, ZoneView } from '@card-table/engine';
import { type KeyboardEvent, useRef, useState } from 'react';
import { CardBack, CardFace } from './Card';
import { sortHand, spokenLabel } from './cards';
import { type Controls, isCardUsable } from './moves';

export function Hand({
  zone,
  controls,
  selected,
  onPress,
  onClear,
}: {
  zone: ZoneView | null;
  controls: Controls;
  selected: readonly string[];
  /** A card was pressed (clicked, tapped, Enter or Space). */
  onPress: (card: CardData) => void;
  onClear: () => void;
}) {
  const [focus, setFocus] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  if (!zone || zone.kind === 'hidden') return null;
  if (zone.kind === 'count') {
    // Your own cards face down (for example before a blind bid).
    return (
      <div
        className="hand"
        role="group"
        aria-label={`Your hand: ${zone.count} cards, face down`}
        style={{ ['--n' as string]: zone.count }}
      >
        {Array.from({ length: zone.count }, (_, i) => (
          <span key={i} className="hand-card">
            <CardBack />
          </span>
        ))}
      </div>
    );
  }

  const cards = sortHand(zone.kind === 'cards' ? zone.cards : zone.melds.flat());
  const current = Math.min(focus, cards.length - 1);
  // Dim unusable cards only when some card can be used (not while bidding, say).
  const choosing = controls.byCard.size > 0 || controls.groupCards.size > 0;

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: cards.length - 1,
    };
    if (event.key === 'Escape') {
      onClear();
      return;
    }
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const index = Math.max(0, Math.min(cards.length - 1, next));
    setFocus(index);
    buttons.current[index]?.focus();
  };

  return (
    <div
      className="hand"
      role="group"
      aria-label={`Your hand, ${cards.length} cards`}
      onKeyDown={onKeyDown}
      style={{ ['--n' as string]: cards.length }}
    >
      {cards.map((card, i) => {
        const usable = isCardUsable(controls, card.id);
        const isSelected = selected.includes(card.id);
        const state = [
          choosing && usable ? 'playable' : null,
          choosing && !usable ? 'unusable' : null,
          isSelected ? 'selected' : null,
        ];
        return (
          <button
            key={card.id}
            data-card={card.id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            className={['hand-card', ...state].filter(Boolean).join(' ')}
            tabIndex={i === current ? 0 : -1}
            aria-pressed={isSelected}
            aria-disabled={!usable}
            aria-label={`${spokenLabel(card)}${choosing && !usable ? ", can't be used now" : ''}`}
            onFocus={() => setFocus(i)}
            onClick={() => usable && onPress(card)}
          >
            <CardFace card={card} />
          </button>
        );
      })}
    </div>
  );
}
