/**
 * `pnpm --filter @card-table/engine demo`: deals a game of spades from the
 * spec's example file and plays the first few moves, printing what each
 * player can see. Pass a seed to get a different deal:
 *   pnpm --filter @card-table/engine demo my-seed
 */
import { sevensUp, spades } from '../src/__fixtures__/games';
import {
  applyMove,
  type Card,
  cardLabel,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  viewFor,
} from '../src/index';

const seed = process.argv[2] ?? 'demo';

const labels = (cards: readonly Card[]) => cards.map(cardLabel).join(' ');
const handOf = (state: GameState, seat: number) => labels(state.zones[`hand@${seat}`] ?? []);

function describeMove(state: GameState, move: Move): string {
  const find = (id: string) => {
    for (const cards of Object.values(state.zones)) {
      const card = cards.find((c) => c.id === id);
      if (card) return cardLabel(card);
    }
    return id;
  };
  switch (move.type) {
    case 'bid':
      return `bids ${move.value}`;
    case 'playToTrick':
    case 'play':
      return `plays ${find(move.card)}`;
    case 'draw':
      return `draws from ${move.from}`;
    case 'chooseSuit':
      return `chooses ${move.suit}`;
    default:
      return move.type;
  }
}

/** Makes `count` moves, each the first legal move (bidding 3 in spades), and prints them. */
function playSome(start: GameState, count: number): GameState {
  let state = start;
  for (let i = 0; i < count && state.status === 'inProgress'; i++) {
    const seat = state.pending?.player ?? state.cursor.current;
    const legal = getLegalMoves(state, seat).filter((m) => m.type !== 'lookAtHand');
    const move = legal.find((m) => m.type === 'bid' && m.value === 3) ?? legal[0];
    if (!move) break;
    console.log(`  Seat ${seat} ${describeMove(state, move)}  (${legal.length} legal moves)`);
    // In spades your hand starts face down (for blind nil), so look before acting.
    if (state.lookRequired && !state.players[seat]?.hasLookedAtHand) {
      state = applyMove(state, { player: seat, type: 'lookAtHand' });
    }
    state = applyMove(state, move);
  }
  return state;
}

// ---- Spades ----
let game = createGame(spades, {}, 4, seed);
console.log(`Spades, seed "${seed}". Dealer: seat ${game.dealer}. Teams: 0+2 vs 1+3.\n`);
for (let seat = 0; seat < 4; seat++) console.log(`  Seat ${seat}: ${handOf(game, seat)}`);

console.log('\nBidding, then the first trick:');
game = playSome(game, 8);

const trick = game.lastTrick ?? game.trick;
console.log(
  `\nTrick: ${trick?.plays.map((p) => `seat ${p.player} ${cardLabel(p.card)}`).join(', ')}` +
    (trick?.winner === null || trick?.winner === undefined ? '' : ` — won by seat ${trick.winner}`),
);

const view = viewFor(game, 0);
console.log('\nWhat seat 0 sees of the hands:');
for (let seat = 0; seat < 4; seat++) {
  const zone = view.zones[`hand@${seat}`];
  const shown =
    zone?.kind === 'cards'
      ? labels(zone.cards)
      : `${zone?.kind === 'count' ? zone.count : '?'} hidden cards`;
  console.log(`  Seat ${seat}: ${shown}`);
}

// ---- Sevens Up ----
let sevens = createGame(sevensUp, {}, 3, seed);
const top = sevens.zones.discard?.at(-1);
console.log(`\nSevens Up, 3 players. Starting card: ${top ? cardLabel(top) : '?'}`);
sevens = playSome(sevens, 6);
console.log(`  Active suit is now ${String(sevens.vars.activeSuit)}.`);
