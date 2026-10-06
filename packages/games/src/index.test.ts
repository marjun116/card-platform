import { validate } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

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
});
