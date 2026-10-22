/**
 * Your hand. Each card is a toggle button: the first press selects it, a
 * second press plays it when that's the only thing it can do. Arrow keys,
 * Home and End move between cards; only one card is in the Tab order.
 *
 * In games where players arrange their hands (rummy, gin), your groups come
 * first, each set apart by a gap, then the cards you haven't grouped; any card
 * can be selected at any time so it can be grouped.
 */
import type { Card as CardData, PlayerView, ZoneView } from '@card-table/engine';
import { type KeyboardEvent, useRef, useState } from 'react';
import { CardBack, CardFace } from './Card';
import { isTrump, sortHand, spokenLabel } from './cards';
import { type Controls, isCardUsable } from './moves';

export function Hand({
  zone,
  controls,
  selected,
  onPress,
  onClear,
  arrangement = null,
  trump = null,
  seat,
  received = null,
}: {
  zone: ZoneView | null;
  /** Your seat, where cards fly to and from (card motion). */
  seat?: number;
  /** Cards just passed to you, raised for a few seconds; screen readers hear who sent them. */
  received?: { cards: readonly string[]; from: string } | null;
  controls: Controls;
  arrangement?: Arrangement;
  /** Trump, so euchre's bowers are sorted in with it. */
  trump?: PlayerView['trump'];
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
        data-anchor={seat === undefined ? undefined : `seat:${seat}`}
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

  const all = zone.kind === 'cards' ? zone.cards : zone.melds.flat();
  const { cards, groupStarts } = arranged(all, arrangement, trump);
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
      data-anchor={seat === undefined ? undefined : `seat:${seat}`}
      onKeyDown={onKeyDown}
      style={{ ['--n' as string]: cards.length }}
    >
      {cards.map((card, i) => {
        // When hands are arranged, any card can be selected to group it.
        const usable = isCardUsable(controls, card.id) || arrangement !== null;
        const isSelected = selected.includes(card.id);
        const trumpCard = isTrump(card, trump);
        const fresh = received?.cards.includes(card.id) ?? false;
        const state = [
          fresh ? 'received' : null,
          choosing && isCardUsable(controls, card.id) ? 'playable' : null,
          choosing && !isCardUsable(controls, card.id) ? 'unusable' : null,
          groupStarts.has(i) ? 'group-start' : null,
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
            aria-label={`${spokenLabel(card)}${trumpCard ? ', trump' : ''}${fresh && received ? `, from ${received.from}` : ''}${choosing && !isCardUsable(controls, card.id) ? ", can't be played now" : ''}`}
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

export type Arrangement = PlayerView['arrangement'];

/** Your cards in display order (groups first, then the rest) and where each group starts. */
function arranged(
  cards: readonly CardData[],
  arrangement: Arrangement,
  trump: PlayerView['trump'],
): { cards: CardData[]; groupStarts: Set<number> } {
  if (!arrangement) return { cards: sortHand(cards, trump), groupStarts: new Set() };
  const byId = new Map(cards.map((c) => [c.id, c]));
  const ordered: CardData[] = [];
  const groupStarts = new Set<number>();
  for (const group of arrangement.groups) {
    const groupCards = group.cards.flatMap((id) => byId.get(id) ?? []);
    if (groupCards.length === 0) continue;
    if (ordered.length > 0) groupStarts.add(ordered.length);
    // Runs read naturally in rank order.
    ordered.push(...sortHand(groupCards));
  }
  const grouped = new Set(ordered.map((c) => c.id));
  const loose = sortHand(cards.filter((c) => !grouped.has(c.id)));
  if (ordered.length > 0 && loose.length > 0) groupStarts.add(ordered.length);
  return { cards: [...ordered, ...loose], groupStarts };
}

const KIND_TEXT = { set: 'Set', run: 'Run' } as const;

/** One line per group above your hand: its cards and whether it's a meld, then your deadwood. */
export function GroupSummary({ arrangement }: { arrangement: Arrangement }) {
  if (!arrangement) return null;
  return (
    <div className="group-summary" aria-label="Your groups">
      {arrangement.groups.map((group) => {
        const label =
          group.kind === null ? 'Not a meld' : group.pure ? 'Pure run' : KIND_TEXT[group.kind];
        return (
          <span
            key={group.cards.join(',')}
            className={`group-chip ${group.kind === null ? 'invalid' : 'valid'}`}
          >
            {group.kind === null ? '✗' : '✓'} {label} ({group.cards.length})
          </span>
        );
      })}
      <span className="muted">Deadwood: {arrangement.deadwood}</span>
    </div>
  );
}
