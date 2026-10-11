/**
 * The games tables can be created from. Built-in game files are saved to the
 * database at startup, as a new version whenever a file changes, so a table
 * always replays with the exact file it started with.
 */
import { createHash } from 'node:crypto';
import { type GameFile, teamsFor } from '@card-table/engine';
import { builtInGames, builtInRules } from '@card-table/games';
import type { GameVersion, Store } from '../store/types';
import type { GameSummary } from '../tables/protocol';

export function playerCounts(file: GameFile): number[] {
  const [min, max] = Array.isArray(file.meta.players)
    ? file.meta.players
    : [file.meta.players, file.meta.players];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

export class GameCatalog {
  private latest = new Map<string, GameVersion>();
  private versions = new Map<string, GameVersion>();

  constructor(private readonly store: Store) {}

  /** Saves every built-in game file, so tables can point at its version. */
  async syncBuiltIns(): Promise<void> {
    for (const [slug, file] of Object.entries(builtInGames)) {
      const fileHash = createHash('sha256').update(JSON.stringify(file)).digest('hex');
      const version = await this.store.saveBuiltInGame({
        slug,
        name: file.meta.name,
        file,
        fileHash,
      });
      this.latest.set(slug, version);
      this.versions.set(version.id, version);
    }
  }

  list(): GameSummary[] {
    return [...this.latest.values()].map(({ slug, file }) => ({
      slug,
      name: file.meta.name,
      players: playerCounts(file),
      teams: Array.isArray(file.meta.teams) ? file.meta.teams : null,
      partnersWith: playerCounts(file).filter((n) => teamsFor(file, n) !== null),
      options: file.options ?? {},
    }));
  }

  /** The current version of a built-in game. */
  builtIn(slug: string): GameVersion | undefined {
    return this.latest.get(slug);
  }

  /**
   * A built-in game's rulebook. Rules aren't versioned: an old table shows the
   * current rules (see docs/decisions.md, "Rulebook").
   */
  rules(slug: string): string | undefined {
    return Object.hasOwn(builtInRules, slug)
      ? builtInRules[slug as keyof typeof builtInRules]
      : undefined;
  }

  /** Any version, by id. Versions never change, so they're cached. */
  async version(id: string): Promise<GameVersion> {
    let version = this.versions.get(id);
    if (!version) {
      version = (await this.store.getGameVersion(id)) ?? undefined;
      if (!version) throw new Error(`Game version ${id} not found`);
      this.versions.set(id, version);
    }
    return version;
  }
}
