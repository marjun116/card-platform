import { useEffect, useState } from 'react';
import { describeServerStatus, type ServerStatus } from './serverStatus';

export function App() {
  const [status, setStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setStatus(res.ok ? 'ok' : 'unreachable'))
      .catch(() => setStatus('unreachable'));
  }, []);

  return (
    <main>
      <h1>Card Table</h1>
      <p>{describeServerStatus(status)}</p>
    </main>
  );
}
