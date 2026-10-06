export type ServerStatus = 'checking' | 'ok' | 'unreachable';

export function describeServerStatus(status: ServerStatus): string {
  switch (status) {
    case 'checking':
      return 'Checking server…';
    case 'ok':
      return 'Server is running';
    case 'unreachable':
      return 'Server is not reachable';
  }
}
