/** Who is signed in (a guest or an account), shared by every page. */
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { api, type User } from './api';
import { SessionContext } from './useSession';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((me) => !cancelled && setUser(me))
      .catch(() => !cancelled && setUser(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, setUser, signOut }}>{children}</SessionContext.Provider>
  );
}
