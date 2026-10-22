/**
 * Telling you it's your turn when you might not be looking: the tab title
 * becomes "● Your turn" while the tab is in the background, and a phone gives
 * a short buzz as your turn starts (where the browser allows it; iPhones
 * don't). No sound and no countdown (see docs/decisions.md, "UI polish").
 */
import { useEffect, useRef } from 'react';

export const TURN_TITLE = '● Your turn';
/** How long the phone buzzes, in ms. */
const BUZZ = 150;

export function useTurnAlert(yourTurn: boolean): void {
  // Only a turn that starts while you're at the table buzzes, not one you open the table on.
  const wasYourTurn = useRef(yourTurn);
  useEffect(() => {
    if (yourTurn && !wasYourTurn.current && typeof navigator.vibrate === 'function') {
      navigator.vibrate(BUZZ);
    }
    wasYourTurn.current = yourTurn;
  }, [yourTurn]);

  useEffect(() => {
    if (!yourTurn) return;
    const title = document.title;
    const update = () => {
      document.title = document.hidden ? `${TURN_TITLE} – ${title}` : title;
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      document.title = title;
    };
  }, [yourTurn]);
}
