/**
 * Sessions: a random token in an httpOnly cookie; the database holds its hash.
 * Every request (WebSocket upgrades included) gets `request.user`, or null.
 */
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../deps';
import type { User } from '../store/types';
import { hashToken, newToken } from './tokens';

export const SESSION_COOKIE = 'ct_session';
const DAY = 24 * 60 * 60 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    /** Hash of the session token, when signed in. */
    sessionId: string | null;
  }
}

export async function registerSessions(app: FastifyInstance, deps: Deps): Promise<void> {
  const { store, config, now } = deps;
  await app.register(cookie);
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const id = hashToken(token);
    const session = await store.getSession(id);
    const time = now();
    if (!session || session.expiresAt <= time) {
      clearSessionCookie(reply);
      return;
    }
    const user = await store.getUser(session.userId);
    if (!user) return;
    request.user = user;
    request.sessionId = id;
    // Sliding expiry, refreshed at most once a day.
    if (time.getTime() - session.lastSeenAt.getTime() > DAY) {
      await store.touchSession(id, time, new Date(time.getTime() + config.sessionDays * DAY));
      setSessionCookie(reply, deps, token);
    }
  });
}

/** Signs this browser in as `userId`, replacing any session it had. */
export async function startSession(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: Deps,
  userId: string,
): Promise<void> {
  if (request.sessionId) await deps.store.deleteSession(request.sessionId);
  const token = newToken();
  const time = deps.now();
  await deps.store.createSession({
    id: hashToken(token),
    userId,
    lastSeenAt: time,
    expiresAt: new Date(time.getTime() + deps.config.sessionDays * DAY),
  });
  setSessionCookie(reply, deps, token);
}

function setSessionCookie(reply: FastifyReply, deps: Deps, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.config.secureCookies,
    path: '/',
    maxAge: deps.config.sessionDays * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** A user as other players see them. */
export function publicUser(user: User) {
  return { id: user.id, displayName: user.displayName, signedIn: user.email !== null };
}
