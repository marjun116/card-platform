/**
 * The built-in games' bots: they finish whole games among themselves, and
 * they play their cards clearly better than random play.
 */
import { type Bot, type GameState, type OptionValue, randomBot } from '@card-table/engine';
import { botStrategy, randomInt, seedRng, simulateGame } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInBots } from './bots';
import { type BuiltInGameName, builtInGames } from './index';
import { VARIANTS } from './simulation';

/** The same bot, but playing its cards to tricks at random (bidding and choices as before). */
function randomCards(bot: Bot): Bot {
  return (input) => {
    const cards = input.legal.filter((m) => m.type === 'playToTrick');
    if (cards.length > 0) return cards[input.random(cards.length)] as (typeof cards)[number];
    return bot(input);
  };
}

const botFor = (game: BuiltInGameName): Bot => builtInBots[game];

/** Plays `games` games with these bots per seat; returns the final states. */
function play(
  game: BuiltInGameName,
  bots: Bot[],
  games: number,
  options: Record<string, OptionValue> = {},
) {
  const states: GameState[] = [];
  for (let i = 0; i < games; i++) {
    const { state } = simulateGame(builtInGames[game], bots.length, `bots-${game}-${i}`, {
      strategy: botStrategy(bots),
      options,
    });
    states.push(state);
  }
  return states;
}

const games = Object.keys(builtInBots) as BuiltInGameName[];

/**
 * Rummy turns the discard pile over only once: with unlimited reshuffles a hand
 * can reach a stalemate nobody can win, bots or people (see "Running out of
 * stock" in docs/decisions.md).
 */
const optionsFor = (game: BuiltInGameName): Record<string, OptionValue> =>
  game === 'rummy' ? { emptyStock: 'once' } : {};

describe.each(games)('%s bots', (game) => {
  it('play whole games among themselves', { timeout: 120_000 }, () => {
    const bot = botFor(game);
    const players = builtInGames[game].meta.players;
    const count = Array.isArray(players) ? players[0] : players;
    expect(play(game, Array<Bot>(count).fill(bot), 10, optionsFor(game))).toHaveLength(10);
  });
});

describe('bots with house rules', () => {
  const cases = games.flatMap((game) =>
    (VARIANTS[game] ?? []).map((options) => [game, JSON.stringify(options), options] as const),
  );
  it.each(cases)('%s with %s', { timeout: 120_000 }, (game, _label, options) => {
    const players = builtInGames[game].meta.players;
    const count = Array.isArray(players) ? players[0] : players;
    const bots = Array<Bot>(count).fill(botFor(game));
    expect(play(game, bots, 5, { ...optionsFor(game), ...options })).toHaveLength(5);
  });
});

describe('bots play their cards better than random play', () => {
  it.each(['spades', 'euchre', 'pinochle', 'bridge'] as const)(
    '%s: the smart side wins most games',
    { timeout: 120_000 },
    (game) => {
      const smart = botFor(game);
      const dumb = randomCards(smart);
      const states = play(game, [smart, dumb, smart, dumb], 10);
      // Seats 0 and 2 are the smart side.
      const wins = states.filter((s) => s.winners.includes(0)).length;
      expect(wins).toBeGreaterThanOrEqual(7);
    },
  );

  it('hearts: the smart player takes fewer points', { timeout: 120_000 }, () => {
    const smart = botFor('hearts');
    const dumb = randomCards(smart);
    const states = play('hearts', [smart, dumb, dumb, dumb], 10);
    const points = (seat: number) =>
      states.reduce((sum, s) => sum + (s.teams[seat]?.score ?? 0), 0);
    const others = (points(1) + points(2) + points(3)) / 3;
    expect(points(0)).toBeLessThan(others * 0.8);
  });

  it('Oh Hell: the smart player scores more', { timeout: 120_000 }, () => {
    const smart = botFor('oh-hell');
    const dumb = randomCards(smart);
    const states = play('oh-hell', [smart, dumb, dumb, dumb], 10);
    const points = (seat: number) =>
      states.reduce((sum, s) => sum + (s.teams[seat]?.score ?? 0), 0);
    const others = (points(1) + points(2) + points(3)) / 3;
    expect(points(0)).toBeGreaterThan(others * 1.2);
  });
});

describe('bots beat random players at other kinds of game', () => {
  it.each([
    ['crazy-eights', 2],
    ['rummy', 2],
    ['gin-rummy', 2],
    ['canasta', 4],
    ['cribbage', 2],
  ] as const)('%s: the bot wins most games', { timeout: 300_000 }, (game, players) => {
    const bots = Array.from({ length: players }, (_, seat) =>
      seat % 2 === 0 ? botFor(game) : randomBot,
    );
    const states = play(game, bots, 10, optionsFor(game));
    const wins = states.filter((s) => s.winners.includes(0)).length;
    expect(wins).toBeGreaterThanOrEqual(7);
  });
});

describe('bots are repeatable', () => {
  it('make the same choices from the same seed', () => {
    const run = () => {
      const rng = seedRng('again');
      const bot = botFor('spades');
      return simulateGame(builtInGames.spades, 4, 'again', {
        strategy: (moves, state) => botStrategy(bot)(moves, state, (n) => randomInt(rng, n)),
      }).moves;
    };
    expect(run()).toEqual(run());
  });
});
