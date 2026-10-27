/**
 * The server's HTTP API. Every call goes to /api on the same origin, which
 * Vite forwards to the Fastify server during development.
 */
import type { OptionValue, RoundReplay } from '@card-table/engine';
import type {
  GameStats,
  GameSummary,
  PastGame,
  PastGameCount,
  TableInfo,
  VariantInfo,
} from '@card-table/server/protocol';

/** Which past games to list; leave a field out for all of them. */
export interface HistoryFilter {
  game?: string;
  /** Won (a shared win counts), lost, or ended early. */
  outcome?: 'won' | 'lost' | 'early';
}

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
  rules: (slug: string) =>
    request<{ rules: string }>('GET', `/games/${encodeURIComponent(slug)}/rules`).then(
      (r) => r.rules,
    ),
  createTable: (game: string, options: Record<string, OptionValue>, playerCount: number) =>
    request<{ table: TableInfo }>('POST', '/tables', { game, options, playerCount }).then(
      (r) => r.table,
    ),
  myTables: () => request<{ tables: TableInfo[] }>('GET', '/tables/mine').then((r) => r.tables),
  /** A finished round with every hand face up (players at the table only). */
  roundReplay: (code: string, round: number) =>
    request<{ replay: RoundReplay }>(
      'GET',
      `/tables/${encodeURIComponent(code)}/rounds/${round}`,
    ).then((r) => r.replay),
  table: (code: string) =>
    request<{ table: TableInfo }>('GET', `/tables/${encodeURIComponent(code)}`).then(
      (r) => r.table,
    ),

  /** Games you sat at that are over, newest first; `more` says if there's another page. */
  history: (offset = 0, filter: HistoryFilter = {}) => {
    const query = new URLSearchParams({ offset: String(offset) });
    if (filter.game) query.set('game', filter.game);
    if (filter.outcome) query.set('outcome', filter.outcome);
    return request<{ games: PastGame[]; more: boolean }>('GET', `/history?${query}`);
  },
  /** The games in your history, most played first. */
  historyGames: () =>
    request<{ games: PastGameCount[] }>('GET', '/history/games').then((r) => r.games),
  /** Starts (or joins) a finished game's rematch; gives the new table's code. */
  rematch: (code: string) =>
    request<{ code: string }>('POST', `/tables/${encodeURIComponent(code)}/rematch`).then(
      (r) => r.code,
    ),
  stats: () => request<{ stats: GameStats[] }>('GET', '/stats').then((r) => r.stats),

  saveVariant: (
    game: string,
    name: string,
    options: Record<string, OptionValue>,
    playerCount: number,
  ) =>
    request<{ variant: VariantInfo }>('POST', '/variants', {
      game,
      name,
      options,
      playerCount,
    }).then((r) => r.variant),
  myVariants: () =>
    request<{ variants: VariantInfo[] }>('GET', '/variants/mine').then((r) => r.variants),
  variant: (code: string) =>
    request<{ variant: VariantInfo }>('GET', `/variants/${encodeURIComponent(code)}`).then(
      (r) => r.variant,
    ),
  deleteTable: (code: string) =>
    request<{ ok: true }>('DELETE', `/tables/${encodeURIComponent(code)}`),
  deleteVariant: (code: string) =>
    request<{ ok: true }>('DELETE', `/variants/${encodeURIComponent(code)}`),
};

/** The page that starts a table from a variant: its share link. */
export function variantPath(variant: Pick<VariantInfo, 'code' | 'game'>): string {
  return `/games/${variant.game.slug}/new?variant=${encodeURIComponent(variant.code)}`;
}

/** The full share link of a variant. */
export function variantLink(
  variant: Pick<VariantInfo, 'code' | 'game'>,
  location: Location = window.location,
): string {
  return `${location.origin}${variantPath(variant)}`;
}

/** The WebSocket address of a table, on the same host as the page. */
export function tableSocketUrl(code: string, location: Location = window.location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/api/tables/${encodeURIComponent(code)}/ws`;
}
