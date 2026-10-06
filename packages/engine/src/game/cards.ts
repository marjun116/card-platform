import type { Card, CardId } from '../cards/card';
import type { GameState } from './state';

/** Finds a card anywhere in the game (zones, melds, cards being passed). */
export function findCard(state: GameState, id: CardId): Card | null {
  for (const cards of Object.values(state.zones)) {
    const card = cards.find((c) => c.id === id);
    if (card) return card;
  }
  for (const melds of Object.values(state.melds)) {
    for (const meld of melds) {
      const card = meld.find((c) => c.id === id);
      if (card) return card;
    }
  }
  for (const cards of state.passing) {
    const card = cards.find((c) => c.id === id);
    if (card) return card;
  }
  return null;
}
