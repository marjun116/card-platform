/**
 * Runs the Store tests against real Postgres. Skipped unless TEST_DATABASE_URL
 * is set (in .env or the environment). Every table is emptied before each
 * test, so never point it at a database whose data you want to keep.
 * Set it up once with `pnpm --filter @card-table/server db:migrate:test`.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe } from 'vitest';
import { createPrismaClient } from '../db';
import { storeContract } from './contract';
import { PrismaStore } from './prisma';

const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PrismaStore (TEST_DATABASE_URL)', () => {
  const db = createPrismaClient(url ?? '');

  afterAll(() => db.$disconnect());

  storeContract(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "Variant", "Result", "MoveLog", "Seat", "Table", "GameVersion", "GameDefinition", ' +
        '"LoginToken", "Session", "User" CASCADE',
    );
    return new PrismaStore(db);
  });
});
