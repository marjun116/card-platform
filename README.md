# Card Table

A website for playing turn-based card games online for points. See
[CLAUDE.md](CLAUDE.md) for the project rules, [docs/game-format.md](docs/game-format.md)
for the game file spec and [docs/build-checklist.md](docs/build-checklist.md) for the
build plan.

## What's in the repo

| Folder            | What it is                                                              |
| ----------------- | ----------------------------------------------------------------------- |
| `packages/engine` | The rules engine. Pure TypeScript: no I/O, no clock, no `Math.random`.  |
| `packages/games`  | Built-in game files (JSON) and their tests.                             |
| `apps/server`     | Fastify + WebSockets server, Postgres through Prisma.                   |
| `apps/web`        | React + Vite website.                                                   |
| `docs/`           | Spec, build checklist and `decisions.md` (answers to spec ambiguities). |

Packages import each other's TypeScript source directly, so there's no build step
between them while developing.

## Install

You need **Node.js 24** and **pnpm** (the exact pnpm version is pinned in
`package.json`; Corepack, which ships with Node, picks it up automatically).

```sh
corepack enable pnpm   # once per machine
pnpm install
```

`pnpm install` also generates the Prisma database client into
`apps/server/src/generated/` (gitignored).

## Connect the database

Development uses a hosted Postgres database (e.g. Neon or Supabase), not Docker.

1. Create a free database and copy its connection string.
2. Copy `.env.example` to `.env` in the repo root and paste the string into
   `DATABASE_URL`. `.env` is gitignored: never commit it.
3. Check the connection:

   ```sh
   pnpm db:check
   ```

   It prints `Connected to database at <host>` on success.

## Run

```sh
pnpm dev
```

This starts the server on <http://127.0.0.1:3000> and the website on
<http://localhost:5173>. The website forwards `/api/*` requests to the server, and its
home page shows whether the server is reachable. Stop both with Ctrl+C.

## Test and check

| Command             | What it does                                |
| ------------------- | ------------------------------------------- |
| `pnpm test`         | Runs every package's tests once (Vitest).   |
| `pnpm test:watch`   | Reruns tests as you edit.                   |
| `pnpm lint`         | ESLint across the whole repo.               |
| `pnpm typecheck`    | TypeScript in strict mode, every package.   |
| `pnpm format`       | Rewrites files with Prettier.               |
| `pnpm format:check` | Fails if any file isn't Prettier-formatted. |

To work on one package only, run commands inside its folder (e.g.
`cd packages/engine && pnpm test`) or use a filter:
`pnpm --filter @card-table/engine test`.

GitHub Actions runs `format:check`, `lint`, `typecheck`, `test` and the engine's coverage
check on every push (see `.github/workflows/ci.yml`). CI doesn't need a database.

## The rules engine

`packages/engine` runs any game described by the JSON game format. Its main functions are
`createGame`, `getLegalMoves`, `applyMove`, `viewFor`, `isGameOver`, `getScores` and
`replay` (see `packages/engine/src/index.ts`). Design decisions are in
[docs/decisions.md](docs/decisions.md).

| Command (in `packages/engine`) | What it does                                                     |
| ------------------------------ | ---------------------------------------------------------------- |
| `pnpm demo [seed]`             | Deals spades and Sevens Up and plays a few moves, printing them. |
| `pnpm test:coverage`           | Runs the engine tests; fails if coverage drops below 90%.        |
| `pnpm schema`                  | Regenerates `game-file.schema.json` after changing the schema.   |

Hand-written test games live in `packages/engine/src/__fixtures__/games.ts`.

### Game files and validation

The game format is defined once, as a Zod schema in `packages/engine/src/schema/gameFile.ts`.
`validate(file)` checks a file against it and then checks the whole file: zones and options
that are referenced must exist, expressions must make sense where they're used, the deck
must cover the deal, every phase must be able to end. Errors say where the problem is:

```text
phases[1] ("play").actions[0].to: Zone "tricks" doesn't exist. Did you mean "trick"?
```

`createGame` refuses to start an invalid game. `packages/engine/game-file.schema.json` is
the same format as JSON Schema; point your editor at it to get checking while you edit a
game file (in VS Code, add `"$schema": "../engine/game-file.schema.json"` at the top).

### Testing a game

`@card-table/engine/testing` has the tools for testing any game file:

- `simulateMany(file, { games: 1000 })` plays seeded random games to the end, checking
  after every move that the game is in a legal state and that no player can see cards they
  shouldn't. A failure reports the seed and move number, so the game can be replayed.
- `withZones`, `card`, `id` and `play` set up exact hands for scenario tests.

## Built-in games

Built-in games are JSON files in `packages/games` (so far `spades.json`). Each must pass:

- validation, with no warnings
- scenario tests for its tricky rules (`packages/games/src/spades.test.ts`)
- the simulation: 1,000 random games plus 50 games by a "sensible" player
  (`packages/games/src/simulation.test.ts`)

### Play in the terminal

```sh
pnpm play spades
pnpm play spades --seat 2 --seed my-game --option targetScore=300 --option blindNil=true
```

You play one seat; the bots play the others. Each turn shows the scores, bids, the current
trick, your hand and your legal moves, numbered. Type a number to play it, or `q` to quit.
The same `--seed` deals the same cards again.

## The multiplayer server

`apps/server` holds the real game state; clients only ever get their own seat's view. The
design is in [docs/decisions.md](docs/decisions.md) ("Multiplayer server (Phase 3)").

### First-time database setup

Create the tables in your development database (run again whenever a new migration is
added under `apps/server/prisma/migrations`):

```sh
pnpm --filter @card-table/server db:migrate
```

After changing `prisma/schema.prisma`, create a new migration with
`pnpm --filter @card-table/server db:migrate:dev`.

### Signing in

- **Guests:** `POST /api/auth/guest` with a display name. Guests can create and play
  tables of built-in games.
- **Accounts:** `POST /api/auth/email` sends a magic link. Without `RESEND_API_KEY` in
  `.env`, the link is printed in the server's console, so you can sign in locally by
  copying it into the browser.

### Tables

| Route                      | What it does                                       |
| -------------------------- | -------------------------------------------------- |
| `GET /api/games`           | Built-in games, player counts and options          |
| `POST /api/tables`         | Create a table: `{ game, options?, playerCount? }` |
| `GET /api/tables/mine`     | Your unfinished tables                             |
| `GET /api/tables/:code`    | A table's lobby (seats, options, status)           |
| `GET /api/tables/:code/ws` | The table's WebSocket                              |

A table is identified by its invite code (10 letters and digits); the invite link is just a
page with that code. Every WebSocket message is described in
`apps/server/src/tables/protocol.ts`.

### Server tests

`pnpm test` runs them with an in-memory database, so they need no setup:

- `src/tables/game.test.ts`: full 4-player spades games over real WebSockets, reconnecting,
  and resuming after a server restart.
- `src/tables/leaks.test.ts`: checks every message each player's socket received for cards
  that player may not see.
- `src/tables/tables.test.ts`: lobby, host controls, protocol errors and turn nudges.
- `src/auth/auth.test.ts`: guests, magic links and sessions.

`src/store/prisma.test.ts` runs the database tests against real Postgres, but only when
`TEST_DATABASE_URL` is set in `.env`. Use a separate, empty database (a Neon branch works):
**every table in it is wiped before each test.** Set it up once with
`pnpm --filter @card-table/server db:migrate:test`.

### Server settings (`.env`)

| Variable           | Default                 | Meaning                                        |
| ------------------ | ----------------------- | ---------------------------------------------- |
| `DATABASE_URL`     | (required)              | Postgres connection string                     |
| `PUBLIC_URL`       | `http://localhost:5173` | The website's address, used in sign-in links   |
| `RESEND_API_KEY`   | (none)                  | Send sign-in emails; otherwise they're printed |
| `EMAIL_FROM`       | Resend's test sender    | The "from" address of sign-in emails           |
| `IDLE_NUDGE_HOURS` | `12`                    | Nudge a player who's been away this long       |

## Guard rails

- **Engine purity is enforced by lint.** In `packages/engine`, ESLint rejects
  `Math.random`, `Date`, timers, `node:*` imports and imports of the games, server or
  web code. Randomness must come from the seeded RNG in game state.
- **No string evaluation anywhere.** `eval` and `new Function` are lint errors across
  the repo, since game files must stay data, never code.
- **Dependency install scripts are blocked by default** (a pnpm safety feature). Only
  packages listed under `allowBuilds` in `pnpm-workspace.yaml` may run them.
