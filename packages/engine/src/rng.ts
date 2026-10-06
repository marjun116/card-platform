/**
 * Seeded random number generator (sfc32), so every game can be replayed
 * exactly from its seed. The state is four 32-bit numbers stored in the game
 * state; functions here advance it in place, so only call them on a draft
 * copy of the state.
 */
export type RngState = [number, number, number, number];

/** Turns any string into a starting RNG state (cyrb128 hash). */
export function seedRng(seed: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const state: RngState = [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  // Warm up so similar seeds diverge quickly.
  for (let i = 0; i < 15; i++) nextRandom(state);
  return state;
}

/** Returns a number in [0, 1) and advances the state. */
export function nextRandom(state: RngState): number {
  let [a, b, c, d] = state;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  state[0] = a >>> 0;
  state[1] = b >>> 0;
  state[2] = c >>> 0;
  state[3] = d >>> 0;
  return (t >>> 0) / 4294967296;
}

/** Whole number from 0 to n-1. */
export function randomInt(state: RngState, n: number): number {
  return Math.floor(nextRandom(state) * n);
}

/** Fisher–Yates shuffle, in place. */
export function shuffle<T>(items: T[], state: RngState): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(state, i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
}
