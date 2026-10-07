import { useSyncExternalStore } from 'react';

/** Matches the phone layout breakpoint in styles.css. */
const QUERY = '(max-width: 700px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True while the screen is narrow enough for the phone layout. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(QUERY).matches : false,
  );
}
