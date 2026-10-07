import { createContext, useContext } from 'react';
import type { User } from './api';

export interface Session {
  /** Undefined while loading; null if nobody is signed in. */
  user: User | null | undefined;
  setUser: (user: User | null) => void;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

/** Who is signed in. Needs SessionProvider (session.tsx) above it. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
