import { createHash, randomBytes } from 'node:crypto';

/** A random secret for a cookie or a sign-in link. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database stores instead of the token, so a database leak can't be used to sign in. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

/** A short code for invite links, easy to read aloud. 32^10: about 50 bits, too many to guess. */
export function newInviteCode(): string {
  const bytes = randomBytes(10);
  return [...bytes].map((b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');
}
