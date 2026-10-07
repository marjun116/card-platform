import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { tableSocketUrl } from '../api';
import { TableConnection } from './connection';

/** Opens a table's connection for as long as the component is on screen. */
export function useTable(code: string) {
  const connection = useMemo(() => new TableConnection({ url: tableSocketUrl(code) }), [code]);
  useEffect(() => {
    connection.start();
    return () => connection.close();
  }, [connection]);
  const snapshot = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  return { connection, snapshot };
}
