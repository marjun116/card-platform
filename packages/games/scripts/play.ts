/**
 * Play a built-in game in the terminal against bots:
 *
 *   pnpm play spades
 *   pnpm play spades --seat 2 --seed my-game --option targetScore=300 --option blindNil=true
 *
 * Everything shown comes from viewFor(state, yourSeat), so you only ever see
 * what your seat is allowed to see. The bots pick random legal moves (and,
 * when bidding, a rough count of their likely tricks).
 */
import {
  applyMove,
  type Card,
  cardLabel,
  bidLabelsOf,
  choiceLabelsOf,
  createGame,
  type GameFile,
  type GameState,
  getLegalMoves,
  getScores,
  isJoker,
  type Move,
  type OptionValue,
  playersToAct,
  type PlayerView,
  RANKS,
  type SuitedCard,
  SUITS,
  viewFor,
} from '@card-table/engine';
import { randomInt, seedRng } from '@card-table/engine/testing';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { builtInGames } from '../src/index';

const SUIT_SYMBOL = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as const;
const SUIT_BY_LETTER: Record<string, keyof typeof SUIT_SYMBOL> = {
  C: 'clubs',
  D: 'diamonds',
  H: 'hearts',
  S: 'spades',
};

// ---- arguments ----

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seat: { type: 'string' },
    seed: { type: 'string' },
    players: { type: 'string' },
    option: { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h' },
  },
});

const gameName = positionals[0];
const games = builtInGames as Record<string, GameFile>;
if (args.help || !gameName || !games[gameName]) {
  console.log('Usage: pnpm play <game> [--seat N] [--seed TEXT] [--option name=value ...]');
  console.log(`Games: ${Object.keys(games).join(', ')}`);
  process.exit(gameName && !args.help ? 1 : 0);
}
const file = games[gameName];

const options: Record<string, OptionValue> = {};
for (const pair of args.option ?? []) {
  const [key, raw = ''] = pair.split('=');
  if (!key) continue;
  options[key] =
    raw === 'true'
      ? true
      : raw === 'false'
        ? false
        : raw !== '' && !Number.isNaN(Number(raw))
          ? Number(raw)
          : raw;
}

const choiceLabels = choiceLabelsOf(file);
const bidLabels = bidLabelsOf(file);

const [minPlayers] = Array.isArray(file.meta.players) ? file.meta.players : [file.meta.players];
const playerCount = Number(args.players ?? minPlayers);
const you = Number(args.seat ?? 0);
const seed = args.seed ?? `game-${Date.now()}`;

// ---- names and labels ----

function seatName(seat: number): string {
  if (seat === you) return 'You';
  if (playerCount === 4)
    return (
      ['Left', file.meta.teams ? 'Partner' : 'Across', 'Right'][(seat - you + 3) % 4] ??
      `Seat ${seat}`
    );
  return `Seat ${seat}`;
}

function teamName(players: number[]): string {
  return players.map(seatName).join(' & ');
}

function labelFromId(id: string): string {
  if (id.startsWith('JOKER')) return 'Joker';
  const code = id.split('.')[0] ?? id;
  const suit = SUIT_BY_LETTER[code.slice(-1)];
  return suit ? `${code.slice(0, -1)}${SUIT_SYMBOL[suit]}` : id;
}

function describeMove(move: Move): string {
  const text = moveText(move);
  // Made for another seat (bridge's declarer playing the dummy).
  return move.by === undefined ? text : `${text} for ${seatName(move.player)}`;
}

function moveText(move: Move): string {
  switch (move.type) {
    case 'play':
    case 'playToTrick':
      return `play ${labelFromId(move.card)}`;
    case 'discard':
      return `discard ${labelFromId(move.card)}`;
    case 'bid':
      return move.value === 'nil'
        ? 'bid nil'
        : move.value === 'blindNil'
          ? 'bid blind nil'
          : `bid ${bidLabels[String(move.value)] ?? move.value}`;
    case 'passBid':
      return 'pass';
    case 'lookAtHand':
      return 'look at your hand';
    case 'draw':
      return `draw from the ${move.from}`;
    case 'pickUpPile':
      if (move.cards) return `take the ${move.from} with ${move.cards.map(labelFromId).join(' ')}`;
      if (move.meld) return `take the ${move.from} onto meld ${move.meld.index + 1}`;
      return `pick up the ${move.from}`;
    case 'pass':
      return `pass ${move.cards.map(labelFromId).join(' ')}`;
    case 'meld':
      return `meld ${move.cards.map(labelFromId).join(' ')}`;
    case 'layOff':
      return `lay off ${labelFromId(move.card)}`;
    case 'declareTrump':
    case 'chooseSuit':
      return `choose ${move.suit}`;
    case 'choose':
      return `choose ${choiceLabels[move.value] ?? move.value}`;
    case 'showHand':
      return move.card === null ? 'go out' : `go out, discarding ${labelFromId(move.card)}`;
    case 'arrange':
      return 'arrange your hand';
    case 'sortHand':
      return 'sort your hand into melds';
    case 'endTurn':
      return 'end your turn';
  }
}

const rankOrder = file.cardOrder?.ranks ?? [...RANKS];

function handText(cards: Card[]): string {
  return SUITS.map((suit) => {
    const ranks = cards
      .filter((c): c is SuitedCard => !isJoker(c) && c.suit === suit)
      .sort((a, b) => rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank))
      .map((c) => c.rank);
    return ranks.length > 0 ? `${SUIT_SYMBOL[suit]} ${ranks.join(' ')}` : '';
  })
    .concat(cards.filter(isJoker).map(() => 'Joker'))
    .filter(Boolean)
    .join('   ');
}

/** Sorts card moves by suit, then rank, so the list reads like the hand. */
function byCard(a: Move, b: Move): number {
  const key = (m: Move) => {
    if (!('card' in m) || m.card === null) return 1000;
    const code = m.card.split('.')[0] ?? '';
    const suit = SUITS.indexOf(SUIT_BY_LETTER[code.slice(-1)] ?? 'spades');
    return suit * 100 + rankOrder.indexOf(code.slice(0, -1) as (typeof rankOrder)[number]);
  };
  return key(a) - key(b);
}

// ---- showing the table ----

function show(view: PlayerView, legal: Move[]): void {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log(`Round ${view.round} · ${view.phase} · dealer: ${seatName(view.dealer)}`);
  console.log(
    'Scores: ' +
      view.teams
        .map((t) => {
          const bags = t.tracks.bags === undefined ? '' : ` (${t.tracks.bags} bags)`;
          return `${teamName(t.players)} ${t.score}${bags}`;
        })
        .join(' · '),
  );
  if (view.players.some((p) => p.bid !== null)) {
    const bids = view.players.map(
      (p) =>
        `${seatName(p.id)} ${p.bid === null ? '–' : (bidLabels[String(p.bid)] ?? p.bid)}${view.trick ? ` (${p.tricks} won)` : ''}`,
    );
    console.log(`Bids:   ${bids.join(' · ')}`);
  }
  for (const item of view.display) {
    const value =
      typeof item.value !== 'number' || !item.format
        ? String(item.value)
        : item.format === 'player'
          ? seatName(item.value)
          : (view.teams[item.value]?.players.map(seatName).join(' & ') ?? String(item.value));
    console.log(`${item.label}: ${value}`);
  }
  // Face-up shared piles (an upcard, cards played in turn), and piles showing their top card.
  for (const [key, zone] of Object.entries(view.zones)) {
    if (key.includes('@') || view.trickZones.includes(key)) continue;
    if (zone.kind === 'cards' && zone.cards.length > 0) {
      console.log(`${key}: ${handText(zone.cards)}`);
    } else if (zone.kind === 'count' && zone.top) {
      console.log(`${key}: ${cardLabel(zone.top)} on top (${zone.count} cards)`);
    }
  }
  if (view.trick && view.trick.plays.length > 0) {
    const plays = view.trick.plays.map(
      (p) => `${seatName(p.player)} ${p.card ? cardLabel(p.card) : '?'}`,
    );
    console.log(`Trick:  ${plays.join(', ')}`);
  }

  // Other players' hands shown face up (bridge's dummy).
  for (const p of view.players) {
    const open = view.zones[`hand@${p.id}`];
    if (p.id === you || open?.kind !== 'cards') continue;
    const by = view.control?.seat === p.id ? ` (played by ${seatName(view.control.by)})` : '';
    console.log(`${seatName(p.id)}'s hand${by}: ${handText(open.cards)}`);
  }

  const hand = view.zones[`hand@${you}`];
  if (hand?.kind === 'cards') console.log(`\nYour hand:  ${handText(hand.cards)}`);
  else if (hand?.kind === 'count')
    console.log(`\nYour hand:  ${hand.count} cards, face down (you haven't looked)`);
  if (view.arrangement && view.arrangement.groups.length > 0) {
    const groups = view.arrangement.groups.map((g) => {
      const kind = g.kind === null ? '✗' : g.pure ? 'pure run' : g.kind;
      return `[${g.cards.map(labelFromId).join(' ')}] ${kind}`;
    });
    console.log(`Your melds: ${groups.join('  ')}  (deadwood ${view.arrangement.deadwood})`);
  }

  console.log('\nYour moves:');
  const width = Math.max(...legal.map((m, i) => `${i + 1}) ${describeMove(m)}`.length)) + 3;
  const columns = Math.max(1, Math.floor(64 / width));
  for (let i = 0; i < legal.length; i += columns) {
    const row = legal
      .slice(i, i + columns)
      .map((m, j) => `${i + j + 1}) ${describeMove(m)}`.padEnd(width));
    console.log(`  ${row.join('')}`);
  }
}

// ---- bots ----

const botRng = seedRng(`bots:${seed}`);

/** Rough trick count for bidding: aces, kings and long trumps. */
function estimateTricks(state: GameState, seat: number): number {
  const cards = state.zones[`hand@${seat}`] ?? [];
  const trump = file.cardOrder?.trump;
  let tricks = 0;
  for (const card of cards) {
    if (!('rank' in card)) continue;
    if (card.rank === 'A') tricks += 1;
    else if (card.rank === 'K' && card.suit !== trump) tricks += 0.6;
  }
  const trumps = cards.filter((c) => 'suit' in c && c.suit === trump).length;
  return Math.max(1, Math.round(tricks + Math.max(0, trumps - 3)));
}

function botMove(state: GameState, seat: number, legal: Move[]): Move {
  const numericBids = legal.filter((m) => m.type === 'bid' && typeof m.value === 'number');
  const value = (m: Move) => (m as { value: number }).value;
  // An auction (bids that aren't trick counts, like bridge's 11–75 or pinochle's 20+):
  // open with the lowest bid now and then, otherwise pass, so the auction ends.
  const pass = legal.find((m) => m.type === 'passBid');
  if (pass && numericBids.some((m) => value(m) > 13)) {
    const opened = state.players.some((p) => typeof p.bid === 'number');
    if (opened || randomInt(botRng, 2) === 0) return pass;
    return numericBids.reduce((low, m) => (value(m) < value(low) ? m : low));
  }
  if (numericBids.length > 0) {
    const target = estimateTricks(state, seat);
    return numericBids.reduce((best, m) =>
      Math.abs((m as { value: number }).value - target) <
      Math.abs((best as { value: number }).value - target)
        ? m
        : best,
    );
  }
  return legal[randomInt(botRng, legal.length)] as Move;
}

// ---- the game loop ----

async function main(): Promise<void> {
  let state: GameState;
  try {
    state = createGame(file, options, playerCount, seed);
  } catch (error) {
    // Bad options or player count: show the reason, not a stack trace.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const rl = createInterface({ input: process.stdin });
  // Read input line by line (works when typing and when input is piped in).
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (): Promise<string | null> => {
    process.stdout.write('> ');
    const next = await lines.next();
    return next.done ? null : next.value;
  };
  console.log(
    `${file.meta.name}: you are seat ${you}. Seed "${seed}" (use --seed to replay this deal).`,
  );
  console.log('Type the number of a move. q quits.');

  try {
    while (state.status === 'inProgress') {
      const seat = playersToAct(state)[0];
      if (seat === undefined) throw new Error('Nobody can move');
      const legal = getLegalMoves(state, seat).sort(byCard);
      let move: Move;

      if (seat === you) {
        show(viewFor(state, you), legal);
        for (;;) {
          const line = await ask();
          if (line === null) return; // input closed (Ctrl+D)
          const answer = line.trim().toLowerCase();
          if (answer === 'q' || answer === 'quit') return;
          const choice = legal[Number(answer) - 1];
          if (choice) {
            move = choice;
            break;
          }
          console.log(`Type a number from 1 to ${legal.length}, or q to quit.`);
        }
      } else {
        move = botMove(
          state,
          seat,
          legal.filter((m) => m.type !== 'lookAtHand'),
        );
        console.log(`  ${seatName(seat)}: ${describeMove(move)}`);
      }

      const before = state;
      state = applyMove(state, move);
      reportChanges(before, state);
    }
    const winners = state.winners.map(seatName).join(' & ');
    console.log(
      `\nGame over. ${winners} ${state.winners.length > 1 || winners === 'You' ? 'win' : 'wins'}!`,
    );
    if (state.notes.length > 0) console.log(state.notes.join(' '));
  } finally {
    rl.close();
  }
}

/** Announces points scored during play, finished tricks and rounds. */
function reportChanges(before: GameState, after: GameState): void {
  for (const event of after.scoreEvents.slice(before.scoreEvents.length)) {
    const held = event.into ? ` (${event.into})` : '';
    console.log(
      `  + ${seatName(event.player)}: ${event.label ?? 'points'} for ${event.points}${held}`,
    );
  }
  const trick = after.lastTrick;
  const newTrick = JSON.stringify(trick) !== JSON.stringify(before.lastTrick);
  if (trick && newTrick && trick.winner !== null) {
    const cards = trick.plays.map((p) => `${seatName(p.player)} ${cardLabel(p.card)}`).join(', ');
    console.log(`  → ${seatName(trick.winner)} won the trick (${cards})`);
  }
  if (after.round !== before.round || after.status === 'over') {
    const scores = getScores(after).teams;
    const round = after.history.at(-1);
    console.log(`\nEnd of round ${before.round}:`);
    for (const t of scores) {
      const gained = round?.teams.find((r) => r.id === t.team)?.points ?? 0;
      console.log(`  ${teamName(t.players)}: ${t.score} (${gained >= 0 ? '+' : ''}${gained})`);
    }
  }
}

await main();
