import type { PlayerView } from '@card-table/engine';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CardMotion } from './animate';
import { dealPlan, freshDeal, planMotion } from './plan';

/**
 * Plays the card motion each time a new view is drawn. Where the cards were
 * before is noted when the view arrives (see usePacedGame), just before the
 * screen changes. A table that opens on a fresh deal shows the deal.
 */
export function useCardMotion(motion: CardMotion | undefined, view: PlayerView): void {
  const previous = useRef<PlayerView | null>(null);
  useLayoutEffect(() => {
    const prev = previous.current;
    previous.current = view;
    if (!motion || prev === view) return;
    if (prev) motion.play(planMotion(prev, view));
    else if (freshDeal(view)) motion.play(dealPlan(view));
  }, [motion, view]);
  useEffect(() => () => motion?.dispose(), [motion]);
}
