import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jsonSchemaText, SCHEMA_FILE } from './schema';

describe('game-file.schema.json', () => {
  it('matches the Zod schema (run `pnpm --filter @card-table/engine schema` to update)', () => {
    expect(readFileSync(SCHEMA_FILE, 'utf8')).toBe(jsonSchemaText());
  });
});
