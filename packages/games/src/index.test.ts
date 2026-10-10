import { existsSync } from 'node:fs';
import { validate } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';
import { SIMULATION_PARTS } from './simulation';

describe('built-in games', () => {
  it.each(Object.entries(builtInGames))('%s is valid, with no warnings', (_name, file) => {
    const result = validate(file);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('includes spades with its four house rule options', () => {
    expect(builtInGames.spades.meta.name).toBe('Spades');
    expect(Object.keys(builtInGames.spades.options ?? {})).toEqual([
      'nil',
      'blindNil',
      'targetScore',
      'mercyRule',
    ]);
  });

  it.each(Object.keys(builtInGames))('%s has a simulation test file', (name) => {
    expect(existsSync(new URL(`./${name}.simulation.test.ts`, import.meta.url))).toBe(true);
  });

  // A missing part file would silently drop some of a game's simulated games.
  it.each(Object.entries(SIMULATION_PARTS))('%s has a test file for each part', (name, parts) => {
    for (let part = 2; part <= (parts ?? 1); part++) {
      const file = new URL(`./${name}.simulation-${part}.test.ts`, import.meta.url);
      expect(existsSync(file), `${name}.simulation-${part}.test.ts`).toBe(true);
    }
  });
});
