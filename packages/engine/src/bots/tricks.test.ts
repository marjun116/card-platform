import { describe, expect, it } from 'vitest';
import { spades } from '../__fixtures__/games';
import { applyMove, createGame, getLegalMoves, viewFor } from '../api';
import type { Move } from '../game/move';
import type { GameState } from '../game/state';
import { botStrategy, id, simulateMany, withZones } from '../testing';
import { type Bot, combineBots, randomBot } from './types';
import { lookFirst, passHigh, trickPlay, type TrickGoals, wantsTricks } from './tricks';

/**
 * Spades (the spec's example) after everyone bids 3, with these hands:
 * hands[0] is the first player to lead, hands[1] the next, and so on.
 */
function atPlay(hands: string[][]): { state: GameState; seats: number[] } {
  let state = createGame(spades, {}, 4, 'bots');
  for (let i = 0; i < 4; i++) {
    state = applyMove(state, { player: state.cursor.current, type: 'bid', value: 3 });
  }
  const leader = state.cursor.current;
  const seats = [0, 1, 2, 3].map((i) => (leader + i) % 4);
  const zones = Object.fromEntries(seats.map((seat, i) => [`hand@${seat}`, hands[i] ?? []]));
  return { state: withZones(state, zones, 'won@t0'), seats };
}

const playCard = (state: GameState, player: number, card: string) =>
  applyMove(state, { player, type: 'playToTrick', card: id(card) });

/** What the bot with these goals plays for whoever's turn it is. */
function choose(state: GameState, goals: TrickGoals): Move {
  const seat = state.cursor.current;
  const bot = combineBots(trickPlay(goals));
  return bot({
    file: state.file,
    view: viewFor(state, seat),
    legal: getLegalMoves(state, seat),
    random: () => 0,
    sortedGroups: () => null,
  });
}

const card = (move: Move) => ('card' in move ? move.card : null);

describe('trick-taking bots', () => {
  it('plays low when its partner is already winning', () => {
    const { state, seats } = atPlay([
      ['AH', '2C'],
      ['2H', '3C'],
      ['KH', '3H'],
      ['4H', '4C'],
    ]);
    let s = playCard(state, seats[0] as number, 'AH');
    s = playCard(s, seats[1] as number, '2H');
    expect(card(choose(s, { aim: 'most' }))).toBe(id('3H'));
  });

  it('wins as cheaply as it can when last to play', () => {
    const { state, seats } = atPlay([
      ['5H', '2C'],
      ['2H', '3C'],
      ['9H', '5C'],
      ['10H', 'KH', '3H'],
    ]);
    let s = playCard(state, seats[0] as number, '5H');
    s = playCard(s, seats[1] as number, '2H');
    // The 9♥ belongs to an opponent of the last player.
    s = playCard(s, seats[2] as number, '9H');
    expect(card(choose(s, { aim: 'most' }))).toBe(id('10H'));
  });

  it('trumps in when it cannot follow, and otherwise throws its lowest plain card', () => {
    const { state, seats } = atPlay([['AH', '2C'], ['3C', '9D', '2S'], ['2H'], ['4H']]);
    const s = playCard(state, seats[0] as number, 'AH');
    expect(card(choose(s, { aim: 'most' }))).toBe(id('2S'));
    const { state: noTrump, seats: seats2 } = atPlay([['AH', '2C'], ['3C', '9D'], ['2H'], ['4H']]);
    const s2 = playCard(noTrump, seats2[0] as number, 'AH');
    expect(card(choose(s2, { aim: 'most' }))).toBe(id('3C'));
  });

  it('dumps a point card when it cannot follow, and ducks when it can', () => {
    const goals: TrickGoals = {
      aim: 'fewest',
      points: (c) => ('suit' in c && c.suit === 'hearts' ? 1 : 0),
    };
    const { state, seats } = atPlay([['2C', '9C'], ['QH', '3D'], ['5C', 'KC'], ['4C']]);
    const s = playCard(state, seats[0] as number, '9C');
    expect(card(choose(s, goals))).toBe(id('QH'));
    // Following: the highest club that still ducks under the 9.
    const s2 = playCard(s, seats[1] as number, 'QH');
    expect(card(choose(s2, goals))).toBe(id('5C'));
  });

  it('leads a card nobody can beat, and leads low when avoiding tricks', () => {
    const { state } = atPlay([['AH', '4D', '9D'], ['2H'], ['3H'], ['4H']]);
    expect(card(choose(state, { aim: 'most' }))).toBe(id('AH'));
    expect(card(choose(state, { aim: 'fewest' }))).toBe(id('4D'));
  });

  it('stops wanting tricks once its side has made its bid', () => {
    const { state, seats } = atPlay([['2H'], ['3H'], ['4H'], ['5H']]);
    const view = viewFor(state, seats[0] as number);
    expect(wantsTricks({ aim: 'bid' }, view, seats[0] as number)).toBe(true);
    const made = {
      ...view,
      teams: view.teams.map((t) => ({ ...t, tricks: 6 })),
    };
    expect(wantsTricks({ aim: 'bid' }, made, seats[0] as number)).toBe(false);
  });
});

describe('other decisions', () => {
  it('looks at a face-down hand first, and passes its strongest cards', () => {
    const look = lookFirst({
      file: spades,
      view: viewFor(createGame(spades, {}, 4, 'b'), 0),
      legal: [
        { player: 0, type: 'lookAtHand' },
        { player: 0, type: 'passBid' },
      ],
      random: () => 0,
      sortedGroups: () => null,
    });
    expect(look).toEqual({ player: 0, type: 'lookAtHand' });
    expect(
      passHigh()({
        file: spades,
        view: viewFor(createGame(spades, {}, 4, 'b'), 0),
        legal: [],
        random: () => 0,
        sortedGroups: () => null,
      }),
    ).toBeNull();
  });
});

describe('bots in whole games', () => {
  const smart: Bot = combineBots(lookFirst, trickPlay({ aim: 'bid' }));

  it('play spades to the end, seeing only their own views', { timeout: 60_000 }, () => {
    const report = simulateMany(spades, {
      games: 20,
      strategy: botStrategy(smart),
      seedPrefix: 'bots',
    });
    expect(report.games).toBe(20);
  });

  it('beat random players at taking tricks', { timeout: 60_000 }, () => {
    // Seats 0 and 2 (one team) are smart, 1 and 3 random; count tricks over many hands.
    const bots = [smart, randomBot, smart, randomBot];
    let ours = 0;
    let theirs = 0;
    simulateMany(spades, {
      games: 20,
      seedPrefix: 'bots-vs-random',
      strategy: botStrategy(bots),
      check: (state) => {
        const last = state.history.at(-1);
        if (!last || state.log.length !== state.roundStart) return;
        ours += last.teams[0]?.tricks ?? 0;
        theirs += last.teams[1]?.tricks ?? 0;
      },
    });
    expect(ours).toBeGreaterThan(theirs * 1.3);
  });
});
