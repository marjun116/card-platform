import { existsSync } from 'node:fs';
import { validate } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { builtInGames, builtInRules } from './index';
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

describe('built-in rulebooks', () => {
  it.each(Object.entries(builtInGames))('%s has a rulebook titled with its name', (name, file) => {
    const rules = builtInRules[name as keyof typeof builtInRules];
    expect(rules.split('\n')[0]).toBe(`# ${file.meta.name}`);
  });

  it.each(Object.entries(builtInGames))('%s explains every house rule', (name, file) => {
    const rules = builtInRules[name as keyof typeof builtInRules];
    const houseRules = rules.slice(rules.indexOf('## House rules'));
    for (const def of Object.values(file.options ?? {})) {
      // The label up to its first explanation, as the rulebook names it in bold.
      const short = (def.label.split(/[(:,]/)[0] ?? '').trim();
      expect(houseRules, def.label).toContain(`**${short}`);
    }
  });

  it.each(Object.entries(builtInRules))(
    '%s uses only the formatting the viewer shows',
    (_n, rules) => {
      for (const line of rules.split('\n')) {
        // Headings (# and ##), bullets, paragraphs; bold is the only inline style.
        expect(line, line).not.toMatch(/^(###|\s+-|\d+\.|\* |>|```)/);
        expect(line, line).not.toMatch(/<[a-z/]|\]\(|`/i);
        expect(line.replace(/\*\*/g, ''), line).not.toContain('*');
        expect((line.match(/\*\*/g) ?? []).length % 2, line).toBe(0);
      }
    },
  );
});
