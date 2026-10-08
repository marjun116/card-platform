/**
 * Turns the legal moves the server sent into controls. Nothing here knows
 * the game's rules: if a move isn't in the list, there's no control for it.
 */
import type { BidValue, Move, PlayerView, Suit } from '@card-table/engine';

type CardMove = Extract<Move, { type: 'play' | 'playToTrick' | 'discard' | 'layOff' | 'showHand' }>;
type PileMove = Extract<Move, { type: 'draw' | 'pickUpPile' }>;
type GroupMove = Extract<Move, { type: 'pass' | 'meld' }>;

export interface Controls {
  /** Moves made with one card, by card id. */
  byCard: Map<string, CardMove[]>;
  /** Moves that take from a pile, by zone name. */
  byPile: Map<string, PileMove[]>;
  /** Moves made with several chosen cards. */
  groups: GroupMove[];
  /** Cards that appear in any group move, so they can be selected. */
  groupCards: Set<string>;
  bids: { value: BidValue; move: Move }[];
  /** Suit choices: declaring trump or picking a suit after a wild card. */
  suits: { suit: Suit; move: Move }[];
  /** Named choices from a `choose` action, e.g. how to score shooting the moon. */
  choices: Move[];
  /** "Sort into melds", in games where players arrange their hands. */
  sort: Move | null;
  /** Everything else with no card: pass the bid, look at hand, end turn. */
  other: Move[];
  /** True if there's any move at all. */
  any: boolean;
}

export function buildControls(moves: Move[]): Controls {
  const controls: Controls = {
    byCard: new Map(),
    byPile: new Map(),
    groups: [],
    groupCards: new Set(),
    bids: [],
    suits: [],
    choices: [],
    sort: null,
    other: [],
    any: moves.length > 0,
  };
  for (const move of moves) {
    switch (move.type) {
      case 'play':
      case 'playToTrick':
      case 'discard':
      case 'layOff':
      case 'showHand':
        push(controls.byCard, move.card, move);
        break;
      case 'draw':
      case 'pickUpPile':
        push(controls.byPile, move.from, move);
        break;
      case 'pass':
      case 'meld':
        controls.groups.push(move);
        for (const card of move.cards) controls.groupCards.add(card);
        break;
      case 'bid':
        controls.bids.push({ value: move.value, move });
        break;
      case 'declareTrump':
      case 'chooseSuit':
        controls.suits.push({ suit: move.suit, move });
        break;
      case 'choose':
        controls.choices.push(move);
        break;
      case 'sortHand':
        controls.sort = move;
        break;
      case 'arrange':
        // Never offered: arranging is done with your own groups (see Hand).
        break;
      case 'passBid':
      case 'lookAtHand':
      case 'endTurn':
        controls.other.push(move);
        break;
    }
  }
  return controls;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Whether a card in your hand can be used in any move right now. */
export function isCardUsable(controls: Controls, cardId: string): boolean {
  return controls.byCard.has(cardId) || controls.groupCards.has(cardId);
}

/** The moves the selected cards allow: single-card moves for one card, plus matching group moves. */
export function movesForSelection(controls: Controls, selected: readonly string[]): Move[] {
  const single = selected.length === 1 ? (controls.byCard.get(selected[0] as string) ?? []) : [];
  const key = [...selected].sort().join(',');
  const groups =
    selected.length === 0
      ? []
      : controls.groups.filter((move) => [...move.cards].sort().join(',') === key);
  return [...single, ...groups];
}

/**
 * The sizes of group moves on offer, for hints like "Choose 3 cards to pass".
 * Returns null when no group moves are possible.
 */
export function groupHint(controls: Controls): { type: 'pass' | 'meld'; sizes: number[] }[] | null {
  if (controls.groups.length === 0) return null;
  const byType = new Map<'pass' | 'meld', Set<number>>();
  for (const move of controls.groups) {
    const sizes = byType.get(move.type) ?? new Set();
    sizes.add(move.cards.length);
    byType.set(move.type, sizes);
  }
  return [...byType].map(([type, sizes]) => ({ type, sizes: [...sizes].sort((a, b) => a - b) }));
}

/**
 * What tapping an already-selected card should do: play it, if that's the
 * only thing the card can do and no group move could use it.
 */
export function quickMove(controls: Controls, cardId: string): Move | null {
  const moves = controls.byCard.get(cardId) ?? [];
  if (moves.length !== 1 || controls.groupCards.has(cardId)) return null;
  return moves[0] ?? null;
}

/** Whether there are decisions that don't use a card from your hand (shown mid-table). */
export function hasDecisions(controls: Controls): boolean {
  return (
    controls.bids.length > 0 ||
    controls.suits.length > 0 ||
    controls.choices.length > 0 ||
    controls.byPile.size > 0 ||
    controls.other.length > 0
  );
}

/** What to tell a player whose turn it is, e.g. "Your turn: choose your bid." */
export function turnPrompt(controls: Controls): string {
  const tasks: string[] = [];
  if (controls.bids.length > 0) tasks.push('choose your bid');
  if (controls.suits.length > 0) {
    tasks.push(controls.suits[0]?.move.type === 'declareTrump' ? 'choose trump' : 'choose a suit');
  }
  if (controls.choices.length > 0) tasks.push('make your choice');
  if (controls.byPile.size > 0) tasks.push('draw a card');
  if (controls.byCard.size > 0) tasks.push('choose a card');
  else if (controls.groups.length > 0) tasks.push('choose cards');
  if (tasks.length === 0) return 'Your turn.';
  return `Your turn: ${tasks.length > 1 ? `${tasks.slice(0, -1).join(', ')} or ${tasks[tasks.length - 1]}` : tasks[0]}.`;
}

/**
 * The groups after putting the selected cards in a group of their own (`group`)
 * or taking them out of their groups (`ungroup`).
 */
export function regroup(
  arrangement: NonNullable<PlayerView['arrangement']>,
  selected: readonly string[],
  action: 'group' | 'ungroup',
): string[][] {
  const rest = arrangement.groups
    .map((g) => g.cards.filter((id) => !selected.includes(id)))
    .filter((g) => g.length > 0);
  return action === 'group' ? [...rest, [...selected]] : rest;
}
