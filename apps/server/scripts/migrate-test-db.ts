// `pnpm db:migrate:test`: applies the migrations to TEST_DATABASE_URL (used by
// src/store/prisma.test.ts) instead of DATABASE_URL.
import { spawnSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is not set. Add it to .env (see .env.example).');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(result.status ?? 1);
