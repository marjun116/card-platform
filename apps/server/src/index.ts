import { buildApp } from './app';
import { consoleMailer, resendMailer } from './auth/mailer';
import { configFromEnv } from './config';
import { createPrismaClient } from './db';
import { PrismaStore } from './store/prisma';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// Without RESEND_API_KEY, sign-in links are printed here instead of emailed.
const { RESEND_API_KEY, EMAIL_FROM } = process.env;
const mailer = RESEND_API_KEY
  ? resendMailer(RESEND_API_KEY, EMAIL_FROM ?? 'Card Table <onboarding@resend.dev>')
  : consoleMailer;

const prisma = createPrismaClient(databaseUrl);
const app = await buildApp({ store: new PrismaStore(prisma), mailer, config: configFromEnv() });
// Closing the app closes every WebSocket first, then the database connection.
app.addHook('onClose', () => prisma.$disconnect());

// Ctrl+C, or the host stopping the server: finish cleanly instead of dropping connections.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error);
        process.exit(1);
      },
    );
  });
}

await app.listen({ port, host });
