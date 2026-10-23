/**
 * Scenario tests for hearts.json: the rules a real table would check.
 * Most tests deal a few exact cards per player (the rest of the deck goes to
 * someone's won pile) so each rule can be seen on its own.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  type OptionValue,
  viewFor,
} from '@card-table/engine';
import { draft, hand, id, play, restartPhase, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const hearts = builtInGames.hearts;
type Options = Record<string, OptionValue>;

const card = (player: number, spec: string): Move => ({
  player,
  type: 'playToTrick',
  card: id(spec),
});
const playable = (state: GameState, seat: number) =>
  getLegalMoves(state, seat)
    .flatMap((m) => (m.type === 'playToTrick' ? [m.card] : []))
    .sort();
const ids = (...specs: string[]) => specs.map(id).sort();
const phase = (state: GameState) => state.file.phases[state.cursor.phase]?.name;
const score = (state: GameState, seat: number) => state.teams[seat]?.score;

/**
 * Four players holding exactly these cards (seat 0 to 3), with no passing.
 * Every other card goes to `restTo`'s won pile. The first leader is worked
 * out from these hands.
 */
function table(hands: string[][], options: Options = {}, restTo = 0): GameState {
  const base = createGame(hearts, { passing: 'none', ...options }, 4, 'hearts');
  const zones = Object.fromEntries(hands.map((h, seat) => [`hand@${seat}`, h]));
  return restartPhase(withZones(base, zones, `won@${restTo}`));
}

describe('hearts: the deal and passing', () => {
  it('deals 13 each to four players and passes three cards', () => {
    const state = createGame(hearts, {}, 4, 'deal');
    expect(phase(state)).toBe('passing');
    for (let seat = 0; seat < 4; seat++) expect(hand(state, seat)).toHaveLength(13);
    expect(getLegalMoves(state, state.cursor.current).every((m) => m.type === 'pass')).toBe(true);
  });

  it('removes the 2♦ for three players (17 each) and passes left, right, then holds', () => {
    const state = createGame(hearts, {}, 3, 'three');
    const dealt = [0, 1, 2].flatMap((seat) => hand(state, seat));
    expect(dealt).toHaveLength(51);
    expect(dealt).not.toContain(id('2D'));

    const third = draft(state);
    third.round = 3;
    const restarted = restartPhase(withZones(third, {}));
    // A hold round: nobody passes and play starts straight away.
    expect(phase(restarted)).toBe('play');
  });

  it('removes the 2♦ and 2♠ for five players (10 each)', () => {
    const state = createGame(hearts, {}, 5, 'five');
    const dealt = [0, 1, 2, 3, 4].flatMap((seat) => hand(state, seat));
    expect(dealt).toHaveLength(50);
    expect(dealt).not.toContain(id('2D'));
    expect(dealt).not.toContain(id('2S'));
  });

  it('skips passing with "No passing"', () => {
    expect(phase(createGame(hearts, { passing: 'none' }, 4, 'none'))).toBe('play');
  });
});

describe('hearts: the first trick', () => {
  it('starts with whoever holds the 2♣ after passing, and they must lead it', () => {
    let state = createGame(hearts, {}, 4, 'lead');
    for (let i = 0; i < 4; i++) {
      state = applyMove(state, getLegalMoves(state, state.cursor.current)[0] as Move);
    }
    expect(phase(state)).toBe('play');
    const leader = state.cursor.current;
    expect(hand(state, leader)).toContain(id('2C'));
    expect(playable(state, leader)).toEqual(ids('2C'));
  });

  const hands = [
    ['2C', '3D', '4D'],
    ['QS', '5H', '5D'], // no clubs: may not throw points on the first trick
    ['6H', '7H', '8H'], // nothing but hearts: may play one
    ['3C', '4C', '6D'], // must follow clubs
  ];

  it("doesn't allow points from a player who can't follow suit", () => {
    const state = applyMove(table(hands), card(0, '2C'));
    expect(playable(state, 1)).toEqual(ids('5D'));
  });

  it('allows a heart from a player who has nothing else', () => {
    const state = play(table(hands), card(0, '2C'), card(1, '5D'));
    expect(playable(state, 2)).toEqual(ids('6H', '7H', '8H'));
    expect(playable(play(state, card(2, '6H')), 3)).toEqual(ids('3C', '4C'));
  });

  it('allows points with "Allow points on the first trick"', () => {
    const state = applyMove(table(hands, { pointsOnFirstTrick: true }), card(0, '2C'));
    expect(playable(state, 1)).toEqual(ids('QS', '5H', '5D'));
  });

  it('lets the player left of the dealer lead any card but a heart with that house rule', () => {
    const state = table(
      [
        ['2C', '3D', '4H'],
        ['5C', '6D', '7H'],
        ['8C', '9D', '10H'],
        ['JC', 'QD', 'KH'],
      ],
      { firstLead: 'leftOfDealer' },
    );
    const left = (state.dealer + 1) % 4;
    expect(state.cursor.current).toBe(left);
    const notHearts = hand(state, left).filter((c) => !c.includes('H'));
    expect(playable(state, left)).toEqual(notHearts.sort());
  });
});

describe('hearts: leading hearts', () => {
  // Seat 0 wins the first trick with the 2♣ (nobody else has a club), then leads.
  const hands = [
    ['2C', '2H', '5D'],
    ['9D', '3S', '4S'],
    ['4D', '5S', '6S'],
    ['3D', '7S', '8S'],
  ];
  const afterFirstTrick = (options: Options = {}) =>
    play(table(hands, options), card(0, '2C'), card(1, '9D'), card(2, '4D'), card(3, '3D'));

  it("can't lead a heart until hearts are broken", () => {
    const state = afterFirstTrick();
    expect(state.cursor.current).toBe(0);
    expect(playable(state, 0)).toEqual(ids('5D'));
  });

  it('can lead a heart when holding nothing else', () => {
    // Nobody holds the 2♣, so the player left of the dealer (L) leads, holding only hearts.
    const base = createGame(hearts, { passing: 'none' }, 4, 'only');
    const L = (base.dealer + 1) % 4;
    const hands = [
      ['2H', '3H'],
      ['5S', '6S'],
      ['7S', '8S'],
      ['9S', '10S'],
    ];
    const zones = Object.fromEntries(hands.map((h, i) => [`hand@${(L + i) % 4}`, h]));
    const state = restartPhase(withZones(base, zones, `won@${L}`));
    expect(state.cursor.current).toBe(L);
    expect(playable(state, L)).toEqual(ids('2H', '3H'));
  });

  it('can lead hearts any time with that house rule', () => {
    expect(playable(afterFirstTrick({ leadHeartsAnytime: true }), 0)).toEqual(ids('2H', '5D'));
  });

  it('is broken by a heart, and by the Q♠ only with that house rule', () => {
    const queenHands = [
      ['2C', '9D', '2H'],
      ['QS', '3D', '4D'],
      ['3C', '5D', '6D'],
      ['4C', '7D', '3H'],
    ];
    const trickOne = (options: Options) =>
      play(
        table(queenHands, { pointsOnFirstTrick: true, ...options }),
        card(0, '2C'),
        card(1, 'QS'),
        card(2, '3C'),
        card(3, '4C'),
      );
    // Seat 3 won with the 4♣ and leads next.
    expect(playable(trickOne({}), 3)).toEqual(ids('7D'));
    expect(playable(trickOne({ queenBreaksHearts: true }), 3)).toEqual(ids('7D', '3H'));
  });
});

/**
 * The last trick of a hand: the player left of the dealer (L) leads the A♥
 * and wins it, having already taken `wonByL`. Everything else went to the
 * next player. Returns the state after the trick, and L.
 */
function lastTrick(wonByL: string[], options: Options = {}, before?: (s: GameState) => void) {
  const base = createGame(hearts, { passing: 'none', ...options }, 4, 'last');
  const L = (base.dealer + 1) % 4;
  const seats = [L, (L + 1) % 4, (L + 2) % 4, (L + 3) % 4] as const;
  const zones = {
    [`hand@${seats[0]}`]: ['AH'],
    [`hand@${seats[1]}`]: ['2D'],
    [`hand@${seats[2]}`]: ['3D'],
    [`hand@${seats[3]}`]: ['4D'],
    [`won@${seats[0]}`]: wonByL,
  };
  let state = restartPhase(withZones(base, zones, `won@${seats[1]}`));
  if (before) {
    state = draft(state);
    before(state);
  }
  // Nobody holds the 2♣, so L leads.
  expect(state.cursor.current).toBe(L);
  const after = play(
    state,
    card(seats[0], 'AH'),
    card(seats[1], '2D'),
    card(seats[2], '3D'),
    card(seats[3], '4D'),
  );
  return { state: after, seats };
}

const otherHearts = ['2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', '10H', 'JH', 'QH', 'KH'];

describe('hearts: scoring', () => {
  it('scores 1 per heart and 13 for the Q♠', () => {
    const { state, seats } = lastTrick(['QS', '2H', '3H', '4H', '5H']);
    // L took the A♥ too: 13 + 5 = 18. The next player took the other 8 hearts.
    expect(score(state, seats[0])).toBe(18);
    expect(score(state, seats[1])).toBe(8);
    expect(score(state, seats[2])).toBe(0);
    expect(state.round).toBe(2);
  });

  it('gives everyone else 26 when a player shoots the moon', () => {
    const { state, seats } = lastTrick(['QS', ...otherHearts]);
    expect(seats.map((s) => score(state, s))).toEqual([0, 26, 26, 26]);
  });

  it('takes 26 off the shooter with that house rule', () => {
    const { state, seats } = lastTrick(['QS', ...otherHearts], { moon: 'shooterMinus26' });
    expect(seats.map((s) => score(state, s))).toEqual([-26, 0, 0, 0]);
  });

  it('lets the shooter choose with that house rule', () => {
    const { state, seats } = lastTrick(['QS', ...otherHearts], { moon: 'shooterChooses' });
    const [shooter] = seats;
    expect(phase(state)).toBe('moon');
    expect(state.cursor.current).toBe(shooter);
    expect(getLegalMoves(state, shooter)).toEqual([
      { player: shooter, type: 'choose', value: 'othersGet26' },
      { player: shooter, type: 'choose', value: 'shooterMinus26' },
    ]);
    for (const other of seats.slice(1)) expect(getLegalMoves(state, other)).toEqual([]);

    const minus = applyMove(state, { player: shooter, type: 'choose', value: 'shooterMinus26' });
    expect(seats.map((s) => score(minus, s))).toEqual([-26, 0, 0, 0]);
    const plus = applyMove(state, { player: shooter, type: 'choose', value: 'othersGet26' });
    expect(seats.map((s) => score(plus, s))).toEqual([0, 26, 26, 26]);
  });

  it('asks nobody to choose when nobody shot the moon', () => {
    const { state } = lastTrick(['QS', '2H'], { moon: 'shooterChooses' });
    expect(phase(state)).not.toBe('moon');
    expect(state.round).toBe(2);
  });

  it('counts the J♦ as -10 with that house rule, separately from the moon', () => {
    const plain = lastTrick(['JD', '2H']);
    expect(score(plain.state, plain.seats[0])).toBe(2);

    const jack = lastTrick(['JD', '2H'], { jackOfDiamonds: true });
    expect(score(jack.state, jack.seats[0])).toBe(-8);

    const moon = lastTrick(['JD', 'QS', ...otherHearts], { jackOfDiamonds: true });
    expect(moon.seats.map((s) => score(moon.state, s))).toEqual([-10, 26, 26, 26]);
  });
});

describe('hearts: big moments', () => {
  const moments = (state: GameState) => state.moments.map((m) => [m.label, m.player]);

  it('says "Shot the moon!" for the player who took every point', () => {
    const { state, seats } = lastTrick(['QS', ...otherHearts]);
    expect(moments(state)).toContainEqual(['Shot the moon!', seats[0]]);
  });

  it('says it as the last point is taken, before the shooter chooses', () => {
    const { state, seats } = lastTrick(['QS', ...otherHearts], { moon: 'shooterChooses' });
    expect(phase(state)).toBe('moon');
    expect(moments(state)).toContainEqual(['Shot the moon!', seats[0]]);
  });

  it("doesn't say it when the points are shared", () => {
    const { state } = lastTrick(['QS', '2H']);
    expect(moments(state).map(([label]) => label)).not.toContain('Shot the moon!');
  });

  it('says "♥ Hearts broken" once, when the first heart is taken', () => {
    const { state } = lastTrick(['QS', '2H']);
    expect(moments(state).filter(([label]) => label === '♥ Hearts broken')).toHaveLength(1);
  });
});

describe('hearts: end of the game', () => {
  // L takes 18, the next player 8; the other two take nothing and are tied.
  const won = ['QS', '2H', '3H', '4H', '5H'];
  const scores = (start: [number, number, number, number]) => (state: GameState) => {
    const L = (state.dealer + 1) % 4;
    start.forEach((points, i) => {
      const team = state.teams[(L + i) % 4];
      if (team) team.score = points;
    });
  };

  it('ends when someone reaches 100, and the lowest score wins', () => {
    const { state, seats } = lastTrick(won, {}, scores([90, 60, 50, 40]));
    expect(state.status).toBe('over');
    expect(state.winners).toEqual([seats[3]]);
  });

  it('plays another hand when the lowest scores are tied', () => {
    const { state } = lastTrick(won, {}, scores([90, 60, 50, 50]));
    expect(state.status).toBe('inProgress');
    expect(state.round).toBe(2);
  });

  it('lets tied players share the win with that house rule', () => {
    const { state, seats } = lastTrick(won, { shareTies: true }, scores([90, 60, 50, 50]));
    expect(state.status).toBe('over');
    expect(state.winners).toEqual([seats[2], seats[3]].sort((a, b) => a - b));
  });

  it('plays to the chosen target score', () => {
    const { state } = lastTrick(won, { targetScore: 150 }, scores([90, 60, 50, 40]));
    expect(state.status).toBe('inProgress');
  });
});

describe('hearts: what the table shows', () => {
  it("shows each player's points taken, not tricks won, to everyone", () => {
    // Seat 1 has no clubs, so drops the Q♠ on the first trick; seat 3's 4♣ wins it.
    const state = table(
      [
        ['2C', '5D'],
        ['QS', '6D'],
        ['3C', '7D'],
        ['4C', '8D'],
      ],
      { pointsOnFirstTrick: true },
      0,
    );
    const after = play(state, card(0, '2C'), card(1, 'QS'), card(2, '3C'), card(3, '4C'));
    for (let viewer = 0; viewer < 4; viewer++) {
      const view = viewFor(after, viewer);
      expect(view.showTricks).toBe(false);
      expect(view.players[3]?.shown).toEqual([{ label: 'Taken', value: 13 }]);
      expect(view.players[2]?.shown).toEqual([{ label: 'Taken', value: 0 }]);
    }
  });
});
