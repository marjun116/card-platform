# Card Table: project instructions

## What we're building

A website where people play turn-based card games online for points (no money).
Built-in games (spades, hearts, euchre, rummy, bridge, etc.) plus custom games
that users describe in plain language and an AI converts into a game file.
Full spec: docs/game-format.md. Build plan: docs/build-checklist.md.

## Hard constraints

- Turn-based only. No real-time or speed games.
- Standard 52-card decks only (multiple copies, jokers, removed ranks allowed).
- Points only. Nothing has cash value. No gambling features.
- The server is authoritative. Clients never receive hidden cards they
  aren't allowed to see.
- Game files are data, never code. The expression language has no loops,
  no function definitions, no file or network access.

## Architecture

- pnpm monorepo, TypeScript everywhere, strict mode.
- packages/engine: pure rules engine. No I/O, no randomness except an injected
  seeded RNG, no dependencies on server or UI.
- packages/games: built-in game files (JSON) and their tests.
- apps/server: Node + Fastify + WebSockets, Postgres via Prisma.
- Database: hosted Postgres (e.g. Neon or Supabase) in both development and
  production, connected through DATABASE_URL. No Docker.
- apps/web: React + Vite.

## How to work

- Before a large change, propose a plan and wait for approval.
- Write tests alongside code. The engine must have high test coverage.
- Every built-in game must pass the random-play simulation test
  (1,000 seeded games, no crashes, no illegal states).
- Small commits with clear messages. Never commit secrets.
- Prefer simple, boring solutions. Ask before adding a new dependency.
- If the spec is ambiguous, ask me instead of guessing, and note the answer
  in docs/decisions.md.
- I'm a solo developer: explain anything non-obvious in plain language
  when you finish a task, including how to run and test it.
