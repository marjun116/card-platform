import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guest, sessionCookie, type TestServer, testServer, withSession } from '../testing';

let server: TestServer;

beforeEach(async () => {
  server = await testServer();
});
afterEach(() => server.app.close());

async function me(token?: string) {
  const res = await server.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: token ? withSession(token) : {},
  });
  return res.json<{ user: { id: string; displayName: string; email: string | null } | null }>()
    .user;
}

async function requestLink(email: string, token?: string): Promise<string> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/auth/email',
    body: { email },
    headers: token ? withSession(token) : {},
  });
  expect(res.statusCode).toBe(202);
  const link = server.emails.at(-1)?.link;
  if (!link) throw new Error('No email sent');
  return link;
}

/** Opens a magic link, returning the new session token and where it redirected. */
async function openLink(link: string, token?: string) {
  const url = new URL(link);
  const res = await server.app.inject({
    method: 'GET',
    url: url.pathname + url.search,
    headers: token ? withSession(token) : {},
  });
  expect(res.statusCode).toBe(303);
  return { token: sessionCookie(res), location: res.headers.location };
}

describe('guests', () => {
  it('can play without an account', async () => {
    const { token, userId } = await guest(server.app, 'Gus');
    expect(await me(token)).toMatchObject({ id: userId, displayName: 'Gus', email: null });
    expect(await me()).toBeNull();
  });

  it('rejects bad display names', async () => {
    for (const displayName of ['', '   ', 'x'.repeat(31)]) {
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/auth/guest',
        body: { displayName },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('renames instead of creating a second guest', async () => {
    const { token, userId } = await guest(server.app, 'Gus');
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/auth/guest',
      body: { displayName: 'Gussie' },
      headers: withSession(token),
    });
    expect(res.statusCode).toBe(200);
    expect(await me(token)).toMatchObject({ id: userId, displayName: 'Gussie' });
  });

  it('ignores a made-up session cookie', async () => {
    expect(await me('not-a-real-token')).toBeNull();
  });
});

describe('magic links', () => {
  it('creates an account on first use and signs in after that', async () => {
    const link = await requestLink('  Ann@Example.com ');
    expect(server.emails[0]?.email).toBe('ann@example.com');
    expect(link).toMatch(/^http:\/\/cards\.test\/api\/auth\/verify\?token=/);

    const first = await openLink(link);
    expect(first.location).toBe('http://cards.test/');
    const account = await me(first.token);
    expect(account).toMatchObject({ displayName: 'ann', email: 'ann@example.com' });

    server.advance(2 * 60_000);
    const second = await openLink(await requestLink('ann@example.com'));
    expect((await me(second.token))?.id).toBe(account?.id);
  });

  it('works once only', async () => {
    const link = await requestLink('ann@example.com');
    await openLink(link);
    const again = await openLink(link);
    expect(again.location).toBe('http://cards.test/?signin=expired');
    expect(again.token).toBeUndefined();
  });

  it('expires after 15 minutes', async () => {
    const link = await requestLink('ann@example.com');
    server.advance(15 * 60_000);
    expect((await openLink(link)).location).toBe('http://cards.test/?signin=expired');
  });

  it('rejects made-up tokens and bad emails', async () => {
    const res = await openLink('http://cards.test/api/auth/verify?token=nope');
    expect(res.location).toBe('http://cards.test/?signin=expired');
    const bad = await server.app.inject({
      method: 'POST',
      url: '/api/auth/email',
      body: { email: 'not an email' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('sends at most one email a minute to the same address', async () => {
    await requestLink('ann@example.com');
    await requestLink('ann@example.com');
    expect(server.emails).toHaveLength(1);
    server.advance(60_000);
    await requestLink('ann@example.com');
    expect(server.emails).toHaveLength(2);
  });

  it('turns the guest in the same browser into the account', async () => {
    const gus = await guest(server.app, 'Gus');
    const { token } = await openLink(await requestLink('gus@example.com', gus.token), gus.token);
    expect(await me(token)).toMatchObject({
      id: gus.userId,
      displayName: 'Gus',
      email: 'gus@example.com',
    });
    // The old guest session no longer works.
    expect(await me(gus.token)).toBeNull();
  });

  it('merges the guest into an existing account', async () => {
    const first = await openLink(await requestLink('ann@example.com'));
    const annId = (await me(first.token))?.id;
    const gus = await guest(server.app, 'Gus');
    server.advance(60_000);
    const { token } = await openLink(await requestLink('ann@example.com'), gus.token);
    expect((await me(token))?.id).toBe(annId);
    expect(await me(gus.token)).toBeNull();
  });

  it("doesn't upgrade a guest in another browser", async () => {
    // An attacker with a guest session asks for a link to the victim's email...
    const attacker = await guest(server.app, 'Mallory');
    const link = await requestLink('victim@example.com', attacker.token);
    // ...and the victim opens it in their own browser.
    const victim = await openLink(link);
    expect((await me(victim.token))?.email).toBe('victim@example.com');
    // The attacker is still just a guest.
    expect(await me(attacker.token)).toMatchObject({ id: attacker.userId, email: null });
    expect((await me(victim.token))?.id).not.toBe(attacker.userId);
  });
});

describe('sessions', () => {
  it('signs out', async () => {
    const { token } = await guest(server.app, 'Gus');
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: withSession(token),
    });
    expect(sessionCookie(res)).toBe('');
    expect(await me(token)).toBeNull();
  });

  it('expires after 90 days unused, and unused days are counted from the last visit', async () => {
    const { token } = await guest(server.app, 'Gus');
    server.advance(60 * 86_400_000);
    expect(await me(token)).not.toBeNull(); // refreshes the expiry
    server.advance(60 * 86_400_000);
    expect(await me(token)).not.toBeNull();
    server.advance(91 * 86_400_000);
    expect(await me(token)).toBeNull();
  });

  it('changes the display name', async () => {
    const { token } = await guest(server.app, 'Gus');
    const res = await server.app.inject({
      method: 'PATCH',
      url: '/api/me',
      body: { displayName: 'Augustus' },
      headers: withSession(token),
    });
    expect(res.statusCode).toBe(200);
    expect((await me(token))?.displayName).toBe('Augustus');
  });
});
