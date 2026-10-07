/**
 * Sign-in routes. Guests get a session with just a display name; anyone can
 * upgrade to an account with an email magic link. See docs/decisions.md.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps';
import { clearSessionCookie, publicUser, startSession } from './session';
import { hashToken, newToken } from './tokens';

const LINK_LIFETIME_MS = 15 * 60 * 1000;
const BAD_NAME = 'Display name must be 1-30 characters';

const displayName = z.string().trim().min(1).max(30);
const nameBody = z.strictObject({ displayName });
const emailBody = z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email()) });
const verifyQuery = z.object({ token: z.string().min(1) });

export function authRoutes(app: FastifyInstance, deps: Deps): void {
  const { store, config, mailer, now } = deps;
  const lastEmailAt = new Map<string, number>();

  app.get('/api/me', (request) => {
    const { user } = request;
    return { user: user && { ...publicUser(user), email: user.email } };
  });

  app.patch('/api/me', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Not signed in' });
    const body = nameBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: BAD_NAME });
    const user = await store.updateUser(request.user.id, body.data);
    return { user: { ...publicUser(user), email: user.email } };
  });

  /** Play without an account. Calling it again just changes the name. */
  app.post('/api/auth/guest', async (request, reply) => {
    const body = nameBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: BAD_NAME });
    if (request.user) {
      const user = await store.updateUser(request.user.id, body.data);
      return { user: publicUser(user) };
    }
    const user = await store.createUser({ displayName: body.data.displayName });
    await startSession(request, reply, deps, user.id);
    return reply.code(201).send({ user: publicUser(user) });
  });

  /** Emails a sign-in link. Always says OK, so nobody can use it to check who has an account. */
  app.post('/api/auth/email', async (request, reply) => {
    const body = emailBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "That doesn't look like an email address" });
    }
    const { email } = body.data;
    const time = now().getTime();
    // Forget addresses whose cooldown is over, so the map can't grow forever.
    for (const [address, at] of lastEmailAt) {
      if (time - at >= config.emailCooldownMs) lastEmailAt.delete(address);
    }
    if (!lastEmailAt.has(email)) {
      lastEmailAt.set(email, time);
      const token = newToken();
      await store.createLoginToken({
        tokenHash: hashToken(token),
        email,
        expiresAt: new Date(time + LINK_LIFETIME_MS),
        usedAt: null,
      });
      const link = new URL('/api/auth/verify', config.publicUrl);
      link.searchParams.set('token', token);
      await mailer.sendLoginLink(email, link.toString());
    }
    return reply.code(202).send({ ok: true });
  });

  /** The magic link. Signs in, upgrading this browser's guest if it has one. */
  app.get('/api/auth/verify', async (request, reply) => {
    const query = verifyQuery.safeParse(request.query);
    const token = query.success
      ? await store.consumeLoginToken(hashToken(query.data.token), now())
      : null;
    if (!token) {
      return reply.redirect(new URL('/?signin=expired', config.publicUrl).toString(), 303);
    }

    const { email } = token;
    const current = request.user;
    const guest = current && current.email === null ? current : null;
    let account = await store.getUserByEmail(email);
    if (!account && guest) {
      // This browser's guest becomes the account; sign that guest out anywhere else.
      account = await store.updateUser(guest.id, { email });
      await store.deleteUserSessions(guest.id);
    } else if (!account) {
      account = await store.createUser({ displayName: email.split('@')[0] ?? email, email });
    } else if (guest) {
      await store.mergeUser(guest.id, account.id);
    }
    await startSession(request, reply, deps, account.id);
    return reply.redirect(new URL('/', config.publicUrl).toString(), 303);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.sessionId) await store.deleteSession(request.sessionId);
    clearSessionCookie(reply);
    return { ok: true };
  });
}
