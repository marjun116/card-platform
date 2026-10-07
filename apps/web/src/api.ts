/**
 * The server's HTTP API. Every call goes to /api on the same origin, which
 * Vite forwards to the Fastify server during development.
 */
import type { OptionValue } from '@card-table/engine';
import type { GameSummary, TableInfo } from '@card-table/server/protocol';

export interface User {
  id: string;
  displayName: string;
  /** False for guests (no email address). */
  signedIn: boolean;
  /** Only sent to the user themselves, by /api/me. */
  email?: string | null;
}

/** An error the server explained, safe to show as is. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? `The server answered ${response.status}`, response.status);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>('GET', '/me').then((r) => r.user),
  rename: (displayName: string) =>
    request<{ user: User }>('PATCH', '/me', { displayName }).then((r) => r.user),
  playAsGuest: (displayName: string) =>
    request<{ user: User }>('POST', '/auth/guest', { displayName }).then((r) => r.user),
  emailLink: (email: string) => request<{ ok: true }>('POST', '/auth/email', { email }),
  signOut: () => request<{ ok: true }>('POST', '/auth/logout'),

  games: () => request<{ games: GameSummary[] }>('GET', '/games').then((r) => r.games),
  createTable: (game: string, options: Record<string, OptionValue>, playerCount: number) =>
    request<{ table: TableInfo }>('POST', '/tables', { game, options, playerCount }).then(
      (r) => r.table,
    ),
  myTables: () => request<{ tables: TableInfo[] }>('GET', '/tables/mine').then((r) => r.tables),
  table: (code: string) =>
    request<{ table: TableInfo }>('GET', `/tables/${encodeURIComponent(code)}`).then(
      (r) => r.table,
    ),
};

/** The WebSocket address of a table, on the same host as the page. */
export function tableSocketUrl(code: string, location: Location = window.location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/api/tables/${encodeURIComponent(code)}/ws`;
}
