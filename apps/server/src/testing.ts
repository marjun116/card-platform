/** Helpers for the server's tests. */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app';
import { SESSION_COOKIE } from './auth/session';
import { defaultConfig } from './config';
import type { Deps } from './deps';
import { MemoryStore } from './store/memory';
import type { TurnNudge } from './tables/notifier';

export interface TestServer {
  app: FastifyInstance;
  store: MemoryStore;
  /** Sign-in links "emailed" so far. */
  emails: { email: string; link: string }[];
  nudges: TurnNudge[];
  /** Moves the test clock forward. */
  advance(ms: number): void;
}

export async function testServer(overrides: Partial<Deps> = {}): Promise<TestServer> {
  const store = new MemoryStore();
  const emails: TestServer['emails'] = [];
  const nudges: TurnNudge[] = [];
  let time = Date.parse('2026-10-07T12:00:00Z');
  const app = await buildApp({
    store,
    mailer: {
      sendLoginLink(email, link) {
        emails.push({ email, link });
        return Promise.resolve();
      },
    },
    notifier: {
      notify(nudge) {
        nudges.push(nudge);
        return Promise.resolve();
      },
    },
    config: { ...defaultConfig, publicUrl: 'http://cards.test' },
    now: () => new Date(time),
    ...overrides,
  });
  return { app, store, emails, nudges, advance: (ms) => (time += ms) };
}

/** The session token a response set, if any ('' when it cleared the cookie). */
export function sessionCookie(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
}

export const withSession = (token: string) => ({ cookie: `${SESSION_COOKIE}=${token}` });

/** Creates a guest and returns their session token and user id. */
export async function guest(
  app: FastifyInstance,
  displayName: string,
): Promise<{ token: string; userId: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/guest', body: { displayName } });
  const token = sessionCookie(res);
  if (res.statusCode !== 201 || !token) throw new Error(`Guest sign-up failed: ${res.body}`);
  const { user } = res.json<{ user: { id: string } }>();
  return { token, userId: user.id };
}
