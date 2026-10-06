/** `pnpm --filter @card-table/engine schema`: regenerates game-file.schema.json. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jsonSchemaText, SCHEMA_FILE } from './schema';

writeFileSync(SCHEMA_FILE, jsonSchemaText());
console.log(`Wrote ${fileURLToPath(SCHEMA_FILE)}`);
