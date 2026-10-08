/**
 * Lets a page put its own controls in the site header. The table screen uses
 * it during a game, so the game's name, round and buttons share the top bar
 * instead of taking a second one.
 */
import { createContext, useContext, useEffect } from 'react';

export interface HeaderSlot {
  /** Where to render (with createPortal); null until the header has mounted. */
  slot: HTMLElement | null;
  /** Tells the header a page is using the slot, so it hides its own links. */
  setInUse: (inUse: boolean) => void;
}

/** Null outside Layout (for example in tests): pages then render their controls in place. */
export const HeaderSlotContext = createContext<HeaderSlot | null>(null);

/** Claims the header for as long as the calling component is on screen. */
export function useHeaderSlot(): HeaderSlot | null {
  const header = useContext(HeaderSlotContext);
  const setInUse = header?.setInUse;
  useEffect(() => {
    if (!setInUse) return;
    setInUse(true);
    return () => setInUse(false);
  }, [setInUse]);
  return header;
}
