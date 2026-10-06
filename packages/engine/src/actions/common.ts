import type { Card } from '../cards/card';
import { evaluateCondition } from '../expr/evaluate';
import type { PlayerId } from '../game/move';
import { buildScope } from '../game/scope';
import type { GameState } from '../game/state';
import type { ActionDef } from '../game/types';

/** What happened, for the action's effects to refer to. */
export interface ActionResult {
  /** The card played (available to effects as `card`). */
  card?: Card;
  /** Cards drawn. */
  drawn?: Card[];
}

/** Does the action's `if` allow it (for this card, if there is one)? */
export function allowsCard(
  state: GameState,
  player: PlayerId,
  action: ActionDef,
  card?: Card,
): boolean {
  if (!action.if) return true;
  return evaluateCondition(action.if, buildScope(state, card ? { player, card } : { player }));
}

/** All ways to choose k items from a list, keeping the list's order. */
export function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const result: T[][] = [];
  const pick = (start: number, chosen: T[]) => {
    if (chosen.length === k) {
      result.push([...chosen]);
      return;
    }
    for (let i = start; i <= items.length - (k - chosen.length); i++) {
      chosen.push(items[i] as T);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return result;
}
