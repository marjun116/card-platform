# Build checklist

Nine phases take the platform from an empty repo to a public launch, each ending in something you can run and test. Work through them in order; each phase has a checklist, a prompt to paste into Claude Code, and a test for when it's done.

## How to work with Claude Code

You act as product owner and tester; Claude Code writes most of the code. The pattern for every phase:

1. Start a fresh session and paste the phase prompt.
2. Ask Claude Code to propose a plan before writing code, and correct anything that doesn't match the spec.
3. Let it build in small steps, committing after each working step.
4. Run the app or tests yourself and check the phase's **Done when** list. Report bugs back in plain words.
5. Tick the boxes here, then move on.

Keep sessions focused on one phase or sub-task. When a session gets long or confused, start a new one; the standing instructions below carry the context forward.

**Standing instructions.** Save this as `CLAUDE.md` in the root of the repo. Claude Code reads it at the start of every session.

```markdown
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
```

## Phase 0: Project setup

Get the repo, tools and docs in place so every later session starts from the same baseline.

- [x] Install Node.js (LTS), pnpm, Git and Claude Code
- [x] Create a private GitHub repository
- [x] Create a free hosted Postgres database for development (e.g. Neon or Supabase) and copy its connection string
- [x] Export the **Game format** tab of this doc to Markdown and save it as `docs/game-format.md`
- [x] Export this tab and save it as `docs/build-checklist.md`
- [x] Save the standing instructions above as `CLAUDE.md`
- [x] Create an empty `docs/decisions.md`
- [x] Run the prompt below
- [ ] Pick a working name for the platform (the instructions use "Card Table" as a placeholder)

```text
Read CLAUDE.md and docs/game-format.md. Set up the monorepo described in
CLAUDE.md: pnpm workspaces with packages/engine, packages/games, apps/server
and apps/web. Configure TypeScript strict mode, ESLint, Prettier and Vitest
across all packages. Development uses a hosted Postgres database, not Docker:
read the connection string from DATABASE_URL in a .env file that is never
committed, and add a .env.example showing the variable. Add a GitHub Actions workflow that runs lint, typecheck and tests
on every push. Each package should have a placeholder test that passes.
Add a README explaining how to install, run and test everything.
Propose the plan first, then build it.
```

**Done when:** `pnpm install`, `pnpm test` and `pnpm lint` all succeed locally, the project can connect to your hosted database, and the GitHub Actions check is green.

## Phase 1: Rules engine core

Build the engine as a pure library with no server or UI. This is the most important code in the project; everything else depends on it being correct.

- [x] Card, deck and zone types; deck builder supporting copies, ranks, suits and jokers
- [x] Seeded random number generator, so any game can be replayed exactly
- [x] Expression evaluator for conditions (`hand.count == 0`, `card.rank in [...]`), with a fixed set of operators and no loops
- [x] Game state model: players, teams, zones, scores, phase, whose turn, custom state values
- [x] Phase and turn machine: phase order, repeats, `until` conditions, leader rules, turn order
- [x] Action library from the spec: card movement, trick-taking, bidding, turn control
- [x] `getLegalMoves(state, player)` and `applyMove(state, move)` as the main API
- [x] `viewFor(state, player)` that strips hidden cards using each zone's `visibility`
- [x] Scoring and end-of-game evaluation
- [x] Move log, so a game is fully described by its seed plus its list of moves

```text
Read CLAUDE.md and docs/game-format.md. Build packages/engine: a pure
TypeScript rules engine that runs games described by the JSON game format.

Public API:
- createGame(gameFile, options, playerCount, seed) -> state
- getLegalMoves(state, playerId) -> Move[]
- applyMove(state, move) -> newState (immutable; throws on illegal moves)
- viewFor(state, playerId) -> state with hidden information removed
- isGameOver(state), getScores(state)

Requirements:
- No I/O and no Math.random; randomness comes from a seeded RNG in state.
- The expression language for conditions is a small safe parser and
  evaluator, never eval() or new Function().
- Implement the building blocks and actions listed in the spec. Where the
  spec is vague, propose a precise design and record it in docs/decisions.md.
- Write unit tests for each building block as you go.

Start by proposing the TypeScript types and module layout. Wait for my
approval before implementing.
```

**Done when:** the unit tests pass, and Claude Code can show a short script that deals a hand and plays a few legal moves using hand-written test game files.

## Phase 2: Game file schema and spades

Lock down the game file format with a strict validator, then prove it end to end with spades. The validator matters twice: it catches mistakes in built-in games now, and in AI-written custom games later.

- [x] Schema for the game format (Zod), generating a JSON Schema file as well
- [x] Validator with clear, human-readable error messages ("phase 'play' refers to zone 'tricks', which doesn't exist")
- [x] Static checks beyond the schema: deck large enough for the deal, every referenced zone and option exists, an end condition is reachable
- [x] `packages/games/spades.json`, matching the example in the spec, with all four options (nil, blind nil, target score, mercy rule)
- [x] Random-play simulation test: 1,000 seeded games choosing random legal moves, checking that each finishes with no crashes and a valid winner
- [x] Scenario tests for tricky rules: spades not yet broken, following suit, nil and blind nil scoring, bag penalty
- [x] Command-line tool to play a game in the terminal, for quick manual testing

```text
Read CLAUDE.md and docs/game-format.md. In packages/engine, add a Zod schema
for the full game file format and a validate(gameFile) function that returns
readable errors, including cross-reference checks (zones, options and phases
that are referenced must exist; the deck must have enough cards for setup).

Then create packages/games/spades.json from the spades example in the spec,
including the nil, blind nil and targetScore options. Add:
1. A reusable random-play simulation test harness that any game can use.
2. Scenario tests for spades rules: leading spades before broken, following
   suit, nil, blind nil, overtricks and the 10-bag penalty.
3. A small CLI (pnpm play spades) to play in the terminal against random
   moves, showing my hand and the legal moves each turn.

If the engine from Phase 1 can't express something spades needs, stop and
explain the gap before changing the engine.
```

**Done when:** you can play a full game of spades in the terminal, the scoring matches what you'd expect at a real table, and the simulation test passes.

## Phase 3: Multiplayer server

Wrap the engine in a server that holds the real game state and lets several people play the same table from different devices.

- [x] Accounts and sign-in (email magic link or a hosted auth provider; no hand-rolled passwords)
- [x] Database tables: users, game definitions (with versions), tables (rooms), seats, move logs, results
- [x] Create a table, choose game and options, invite by link, take a seat, start
- [x] WebSocket protocol: client sends a move, server validates with the engine, saves it, and sends each player their own `viewFor` state
- [x] Reconnection: a player who drops and returns gets the current state
- [x] Turn nudges: notify a stalled player; host can pause or end the table
- [x] Asynchronous play: tables persist, so a game can continue over days
- [x] Security tests proving a client can never see another player's hand

```text
Read CLAUDE.md and docs/game-format.md. Build apps/server: Fastify with
WebSockets, Postgres via Prisma, using packages/engine for all rules.

The server is authoritative: clients send intended moves, the server checks
them with getLegalMoves/applyMove, appends them to the move log, and sends
each seated player only viewFor(state, theirId). Never send full state.

Include: authentication (recommend an option and explain the trade-offs
before choosing), table creation with game and options, invite links,
seating, starting a game, reconnection, persisted tables that can be
resumed later, and a turn-nudge notification hook.

Write integration tests that run a full 4-player spades game over real
WebSocket connections, and tests proving no message to a player ever
contains another player's hidden cards. Propose the database schema and
message protocol first.
```

**Done when:** the integration test plays a full game over WebSockets, and the hidden-card tests pass.

## Phase 4: Web client

Build the screens people actually see. The table view should be generic: it draws whatever zones and actions the game file declares, so new games need no new UI code.

- [x] Sign-in, home page, game library, create-table and lobby screens
- [x] Generic table view: your hand, other players' card counts, shared piles, current trick, melds, scores
- [x] Legal moves highlighted; illegal cards can't be played
- [x] Action controls generated from the game file (bid picker, draw/discard buttons, suit chooser)
- [x] Scoreboard and round summary, plus end-of-game screen
- [x] Works on phones and tablets as well as desktop
- [x] Accessible: keyboard play, readable card labels for screen readers, colorblind-safe suits
- [x] Card artwork: an original or openly licensed card set

```text
Read CLAUDE.md and docs/game-format.md. Build apps/web with React and Vite,
connected to apps/server.

Key rule: the table view is data-driven. It renders zones according to
their type and visibility, and builds action controls from the legal moves
the server sends. Do not write spades-specific UI; spades is only the first
game to test with.

Screens: sign-in, home, game library, create table (game + options),
lobby with invite link and seats, table, round summary, game over.
Make it responsive down to phone width and playable by keyboard.
Use an openly licensed SVG card set and credit it.

Show me rough layouts for the table screen on desktop and phone before
building them.
```

**Done when:** you and three family members can play spades together on your own devices, on your home network, from start to finish. (Playing from different homes needs the test deployment, which moved to the start of Phase 6.)

## Phase 5: More built-in games, house rules and bots

Add games one at a time, picking each to stretch a different part of the engine. When a game can't be expressed, extend the engine's building blocks rather than special-casing that game.

- [x] Decide the launch list: every built-in game so far (spades, hearts, crazy eights, rummy,
      gin rummy, euchre, Oh Hell, cribbage, pinochle, canasta, bridge). Decided 2026-10-10.
- [x] Suggested order: hearts (passing), crazy eights (shedding), rummy and gin (melds), euchre (stripped deck, bowers), Oh Hell (changing hand sizes), cribbage (unusual scoring), pinochle and canasta (double decks), bridge (bidding auction, dummy hand)
- [x] For each game: game file, common house rule options, scenario tests, simulation test
  - [x] Hearts
  - [x] Crazy eights
  - [x] Rummy
  - [x] Gin rummy
  - [x] Euchre
  - [x] Oh Hell
  - [x] Cribbage
  - [x] Pinochle
  - [x] Canasta
  - [x] Bridge
- [ ] Real playtests (with family, on your own devices):
  - [ ] Hearts
  - [ ] Crazy eights
  - [ ] Rummy
  - [ ] Gin rummy
  - [ ] Euchre
  - [ ] Oh Hell
  - [ ] Cribbage
  - [ ] Pinochle
  - [ ] Canasta
  - [ ] Bridge
  - [ ] Bots: fill seats with bots, and replace a player who leaves mid-game
- [x] Saved variants: a table's chosen options saved as a named, shareable preset
- [x] Game history (results are already saved by the server; nothing shows them yet):
  - [x] "Past games" on the home page: game, date, players, final score, and whether you won
  - [x] A past game's page: final scores and every round
  - [x] Simple stats per game: games played and won
- [ ] Rulebook for each game, readable at any time (plan agreed 2026-10-07, see
      `docs/decisions.md`):
  - [x] Written rules for each built-in game (starting with spades): object, setup,
        bidding, play, scoring, and what each house rule does. Draft for review first.
  - [ ] Review every rulebook on the site, and fix what needs fixing
  - [x] An "At this table" section generated from the table's actual settings (players,
        teams, house rules chosen)
  - [x] A **Rules** button on the table (opens over the game) and in the lobby, plus a
        Rules link for each game on the Games page
  - [x] Rules text in a small formatting subset (headings, paragraphs, lists, bold) shown by
        our own renderer: no new dependency, no raw HTML
- [x] Bots for built-in games: start with random legal moves, then simple rule-of-thumb play per game family
- [x] Bots fill empty seats and replace players who leave

```text
Read CLAUDE.md, docs/game-format.md and docs/decisions.md. Add the built-in
game [GAME NAME] to packages/games.

1. Write out the standard rules in plain English and list the common house
   rule variations. Show me before going further.
2. Write the game file, with the house rules as options.
3. If the engine can't express a rule, propose a general building block
   that other games could also use. Don't special-case this game.
4. Add scenario tests for its trickiest rules and run the simulation test.
5. Tell me what to check when I playtest it.
```

Run the prompt once per game, filling in the name. For bots, use this prompt after the first few games are in:

```text
Add a bot framework to packages/engine. A bot receives only viewFor(state,
botId), the same information a human player has, and returns a legal move.
Start with a random-legal-move bot, then a heuristic bot for trick-taking
games (play high to win, low to duck, track which cards are gone). Bots are
only offered for built-in games, never custom ones.
```

**Done when:** every launch game passes its tests and a real playtest, and you can fill empty seats with bots in built-in games.

## Bugs and playtest feedback

Found while playing. Fix one at a time; tick each off when it's fixed.

- [ ] **Lobby: "Sit here" / "Move here" buttons spill out of the seat list's card.** In the
      lobby seat list, the seat buttons extend past the edge of the panel they're in. (Likely
      since seat rows were kept to one line on 2026-10-15, so the buttons no longer wrap.)
- [ ] **Euchre: the game info in the middle of the table moves when cards are played.**
      Trump, "Called by" and the other values shift position once cards land on the table.
      They should stay in one fixed place and be readable whether or not there are cards
      in the middle.
- [ ] **Table: the game info labels are too faint on the felt.** "Trump" and "Called by" are a
      very light colour and hard to make out against the green table.
- [ ] **Table: the table grows after you play your last card.** Once your hand is empty, the
      table gets taller, which is jarring. Its size should stay the same.

## Phase 6: Custom game creation and sharing

This is the feature that sets the platform apart. The AI turns typed rules into a game file, asks about every gap, and the validator guarantees that whatever it produces is safe to run.

- [ ] Test deployment online first (e.g. Render, Railway or Fly.io), before any AI feature is reachable, so family can play from home. Moved here from Phase 4.
  - [ ] Real sign-in emails: an email service key (Resend) and, ideally, your own sending domain, so people can sign in to their account on any device
- [ ] Test set first: collect 15–20 real house-rule write-ups from family and friends, typed as they'd naturally type them
- [ ] Rules entry screen: paste or type rules, game name, player count
- [ ] Translation pipeline using Claude through the Anthropic API: rules text in, game file out, checked by the validator, with validator errors fed back for a retry
- [ ] Clarifying questions: the AI lists ambiguities as plain questions; the creator answers in a chat-style screen; the file is revised
- [ ] Plain-English summary of the generated rules for the creator to confirm ("Here's how I understood your game")
- [ ] That summary becomes the custom game's rulebook (same viewer as built-in games), saved with each game version
- [ ] Unsupported rules: say which rule can't be enforced and offer a manual button or table mode
- [ ] Solo playtest mode: the creator plays every seat themselves to check the rules (since custom games have no bots)
- [ ] Versioning: every revision saved; tables record which version they used
- [ ] Sharing: private by default; share by link or invite; anyone with access can host and play without the creator present
- [ ] Safety: rules text is untrusted input; only validated JSON ever reaches the engine; rate limits and a monthly cost cap on AI calls

```text
Read CLAUDE.md, docs/game-format.md and docs/decisions.md. Build the custom
game creation flow.

Pipeline (server side):
1. Send the user's rules text to Claude via the Anthropic API with a system
   prompt containing the full game format spec and 3-4 built-in game files
   as examples. Ask for two outputs: a game file, and a list of ambiguities
   phrased as plain questions with a suggested default for each.
2. Run validate() on the file. On errors, send them back to the model and
   retry, up to 3 times. Never run an unvalidated file.
3. Show the questions to the creator; send their answers back to revise.
4. Generate a plain-English summary of the final rules for confirmation.

Treat rules text as untrusted: it can't change the system prompt's
instructions, and the only output used is schema-valid JSON. Add per-user
rate limits and a global monthly cost cap.

Also build: the rules entry and question screens, solo playtest mode (one
user controls every seat), game versioning, and sharing (private by
default, share link and invites, recipients can host their own tables).

Put the test set of house-rule write-ups in packages/games/custom-tests/
and add a script that runs every one through the pipeline and reports
which validated, how many questions each raised, and failures.
```

**Done when:** most of your test-set games produce a playable file after answering the questions, and a family member who didn't write the rules can play a shared game from a link.

## Phase 7: Broken-game reports and table mode

Give players a way out when a custom game misbehaves, and a fallback for games the engine can't enforce.

- [ ] "Report a rule problem" button on custom-game tables, with a short description field
- [ ] On a report: the game is abandoned (scores so far shown, not recorded as a result)
- [ ] Fix flow: the AI receives the game file, the move log up to the problem, and the report, then asks players clarifying questions about the disputed rule
- [ ] Revised file goes through the validator, is saved as a new version, and the creator is notified
- [ ] Table mode: free card movement between zones, no rule checks, shared scorepad
- [ ] Unsupported-rule buttons from Phase 6 (e.g. "Call re-deal") with a table vote

```text
Read CLAUDE.md, docs/game-format.md and docs/decisions.md. Build two things.

1. Rule problem reports for custom games. Any seated player can report a
   problem with a short description. The table is then abandoned. Send the
   AI the game file, the move log up to that point, and the report. It
   should identify the likely faulty rule, explain it in plain words, and
   ask the players clarifying questions. Their answers produce a revised
   file that must pass validate(), saved as a new version. Notify the
   creator. Old versions stay viewable.

2. Table mode: a game type with zones and a deck but no rule enforcement.
   Players drag cards between zones freely; hidden zones stay hidden;
   there's a shared scorepad anyone can edit, with an edit history.
```

**Done when:** you can deliberately break a custom game, report it mid-play, answer the questions, and play the fixed version; and a game can be played start to finish in table mode.

## Phase 8: Launch prep

Harden the platform for strangers, not just family. Several items here involve legal or business decisions that Claude Code can draft but you should decide, ideally with professional advice.

- [ ] Production hosting with database backups, error monitoring and uptime alerts
- [ ] Load test: many simultaneous tables without slowdowns
- [ ] Security review: auth, WebSocket messages, hidden-information leaks, rate limits, the AI pipeline
- [ ] "Sign out everywhere" for accounts (for a lost phone), which also closes that user's open table connections
- [ ] Optional: "Sign in with Google" alongside email links (sessions were built so it can be added without other changes)
- [ ] Moderation basics: report a user, block a user, content filter on game names and chat
- [ ] Privacy policy and terms of service (have a lawyer review; extra rules apply if under-13s could sign up)
- [ ] Trademark check on the platform name and on game names (avoid branded games)
- [ ] Cost plan: hosting plus AI calls per custom game, and how the platform will pay for them (free tier limits, subscription, ads)
- [ ] Simple analytics: tables started, games finished, custom games created
- [ ] Pre-play: where it makes sense for the game (trick-taking games, say), let you choose
      your next card before your turn, and play it automatically when your turn comes if
      it's still legal. Decide which games get it, and how you see and cancel a pre-played
      card.
- [ ] Closed beta with friends and family, then a wider invite-only beta
- [ ] Landing page, help pages and a feedback form

```text
Read CLAUDE.md and docs/decisions.md. We're preparing for a public beta.

1. Do a security review of the whole codebase: authentication, every
   WebSocket message type, hidden-card leaks, input validation, rate limits
   and the AI pipeline. List issues by severity and fix them one at a time
   with my approval.
2. Set up production deployment with database backups, error monitoring and
   uptime alerts. Explain monthly costs at 100, 1,000 and 10,000 players.
3. Write a load test simulating 200 concurrent tables and report results.
4. Add report and block features for users, and a content filter for
   custom game names.
5. Draft a privacy policy and terms of service for me to review with a
   lawyer. Mark them clearly as drafts.
```

**Done when:** the security issues are resolved, the beta group is playing regularly, and you're comfortable with the monthly costs.
