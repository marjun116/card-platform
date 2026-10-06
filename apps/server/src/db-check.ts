// `pnpm db:check`: confirms DATABASE_URL in .env points at a reachable database.
import { createPrismaClient } from './db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const prisma = createPrismaClient(url);
try {
  await prisma.$queryRaw`SELECT 1`;
  console.log(`Connected to database at ${new URL(url).host}`);
} catch (error) {
  console.error('Could not connect to the database:');
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
