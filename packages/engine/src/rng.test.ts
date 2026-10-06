import { describe, expect, it } from 'vitest';
import { nextRandom, randomInt, seedRng, shuffle } from './rng';

describe('seeded RNG', () => {
  it('produces the same sequence for the same seed', () => {
    const a = seedRng('table-42');
    const b = seedRng('table-42');
    const seqA = Array.from({ length: 20 }, () => nextRandom(a));
    const seqB = Array.from({ length: 20 }, () => nextRandom(b));
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = seedRng('seed-1');
    const b = seedRng('seed-2');
    expect(nextRandom(a)).not.toBe(nextRandom(b));
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const rng = seedRng('uniform');
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 10_000; i++) {
      const x = nextRandom(rng);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      buckets[Math.floor(x * 10)]! += 1;
    }
    for (const count of buckets) expect(count).toBeGreaterThan(850);
  });

  it('keeps its state as four unsigned 32-bit numbers', () => {
    const rng = seedRng('');
    nextRandom(rng);
    for (const n of rng) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(2 ** 32);
    }
  });

  it('randomInt covers the whole range', () => {
    const rng = seedRng('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(randomInt(rng, 4));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('shuffle is a deterministic permutation', () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const a = [...items];
    const b = [...items];
    shuffle(a, seedRng('deal'));
    shuffle(b, seedRng('deal'));
    expect(a).toEqual(b);
    expect(a).not.toEqual(items);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
  });
});
