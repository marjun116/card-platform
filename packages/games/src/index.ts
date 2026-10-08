import { formatIssues, type GameFile, validate } from '@card-table/engine';
import crazyEightsJson from '../crazy-eights.json';
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
} as const satisfies Record<string, GameFile>;

export type BuiltInGameName = keyof typeof builtInGames;
