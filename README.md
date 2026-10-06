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

Hand-written test games live in `packages/engine/src/__fixtures__/games.ts`.

## Guard rails

- **Engine purity is enforced by lint.** In `packages/engine`, ESLint rejects
  `Math.random`, `Date`, timers, `node:*` imports and imports of the games, server or
  web code. Randomness must come from the seeded RNG in game state.
- **No string evaluation anywhere.** `eval` and `new Function` are lint errors across
  the repo, since game files must stay data, never code.
- **Dependency install scripts are blocked by default** (a pnpm safety feature). Only
  packages listed under `allowBuilds` in `pnpm-workspace.yaml` may run them.
