import { readFileSync } from 'node:fs';
import { formatIssues, type GameFile, validate } from '@card-table/engine';
import bridgeJson from '../bridge.json';
import crazyEightsJson from '../crazy-eights.json';
import canastaJson from '../canasta.json';
import cribbageJson from '../cribbage.json';
import euchreJson from '../euchre.json';
import ginRummyJson from '../gin-rummy.json';
import heartsJson from '../hearts.json';
import ohHellJson from '../oh-hell.json';
import pinochleJson from '../pinochle.json';
import rummyJson from '../rummy.json';
import spadesJson from '../spades.json';

/** Checks a built-in game file when it's loaded, so a broken file fails loudly and early. */
function load(name: string, json: unknown): GameFile {
  const result = validate(json);
  if (!result.ok)
    throw new Error(`Built-in game "${name}" is invalid:\n${formatIssues(result.errors)}`);
  return result.file;
}

export const builtInGames = {
  spades: load('spades', spadesJson),
  hearts: load('hearts', heartsJson),
  'crazy-eights': load('crazy-eights', crazyEightsJson),
  rummy: load('rummy', rummyJson),
  'gin-rummy': load('gin-rummy', ginRummyJson),
  euchre: load('euchre', euchreJson),
  'oh-hell': load('oh-hell', ohHellJson),
  cribbage: load('cribbage', cribbageJson),
  pinochle: load('pinochle', pinochleJson),
  canasta: load('canasta', canastaJson),
  bridge: load('bridge', bridgeJson),
} as const satisfies Record<string, GameFile>;

export type BuiltInGameName = keyof typeof builtInGames;

/**
 * Each built-in game's rulebook, from the `<name>.rules.md` file next to its game file.
 * Rules use a small subset of Markdown: `#` and `##` headings, paragraphs,
 * `- ` bullet lists and `**bold**` (see docs/decisions.md, "Rulebook").
 */
export const builtInRules = Object.fromEntries(
  Object.keys(builtInGames).map((name) => [
    name,
    readFileSync(new URL(`../${name}.rules.md`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
  ]),
) as Record<BuiltInGameName, string>;

export { builtInBots } from './bots';
