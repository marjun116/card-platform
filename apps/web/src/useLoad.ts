import { useEffect, useState } from 'react';
import { ApiError } from './api';

export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string; status: number }
  | { state: 'done'; data: T };

/** Runs `load` when `key` changes and tracks its result. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [result, setResult] = useState<{ key: string; loaded: Loaded<T> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => !cancelled && setResult({ key, loaded: { state: 'done', data } }))
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : 'Something went wrong';
        const status = error instanceof ApiError ? error.status : 0;
        setResult({ key, loaded: { state: 'error', message, status } });
      });
    return () => {
      cancelled = true;
    };
    // `load` is a new function every render; `key` says when to load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A result for an older key is stale: show loading until the new one arrives.
  return result?.key === key ? result.loaded : { state: 'loading' };
}
