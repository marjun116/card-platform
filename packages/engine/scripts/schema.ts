import { z } from 'zod';
import { gameFileSchema } from '../src/schema/gameFile';

export const SCHEMA_FILE = new URL('../game-file.schema.json', import.meta.url);

/** The game format as JSON Schema text, generated from the Zod schema. */
export function jsonSchemaText(): string {
  const schema = {
    $id: 'https://card-table.local/game-file.schema.json',
    title: 'Card Table game file',
    description: 'A card game described as data. See docs/game-format.md.',
    ...z.toJSONSchema(gameFileSchema, { reused: 'ref' }),
  };
  return `${JSON.stringify(schema, null, 2)}\n`;
}
