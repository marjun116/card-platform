/**
 * Building blocks added for pinochle: "does this card beat the trick?",
 * counting copies of a card, points held until the round is scored, and
 * teams that win ahead of others when both pass the target.
 */
import { describe, expect, it } from 'vitest';
import { counting, tinyTricks } from './__fixtures__/games';
import { applyMove, createGame, getLegalMoves } from './api';
import { evaluate } from './expr/evaluate';
import { buildScope } from './game/scope';
import type { GameFile } from './game/types';
import { validate } from './schema/validate';
import { id, play, withZones } from './testing';

/** Two copies of 2–5 in hearts and spades; spades are trump; you must beat the trick if you can. */
const beating: GameFile = {
  ...tinyTricks,
  meta: { name: 'Beating', players: 2 },
  deck: { copies: 2, ranks: ['2', '3', '4', '5'], suits: ['hearts', 'spades'] },
  cardOrder: { ranks: ['2', '3', '4', '5'], trump: 'spades' },
  phases: [
    {
      name: 'play',
      leader: { first: 'leftOfDealer', then: 'lastTrickWinner' },
      actions: [
        {
          type: 'playToTrick',
          followSuit: true,
          restrictions: [{ if: 'trick.count > 0', mustPlay: 'trick.isBeatenBy(card)' }],
        },
      ],
      afterTrick: [
        { resolveTrick: 'highestTrumpElseHighestLed' },
        { moveTrick: 'won', of: 'winner' },
      ],
    },
  ],
};

describe('trick.isBeatenBy', () => {
  const start = createGame(beating, {}, 2, 'beat');
  const L = start.cursor.current;
  const D = 1 - L;
  const lead = (mine: string[], theirs: string[], led: string) =>
    applyMove(withZones(start, { [`hand@${L}`]: [led, ...mine], [`hand@${D}`]: theirs }, 'won@0'), {
      player: L,
      type: 'playToTrick',
      card: id(led),
    });
  const playable = (s: ReturnType<typeof lead>) =>
    getLegalMoves(s, D).flatMap((m) => (m.type === 'playToTrick' ? [m.card] : []));

  it('keeps the cards that would take the trick', () => {
    expect(playable(lead([], ['2H', '5H', '3S'], '4H'))).toEqual([id('5H')]);
  });

  it('counts a trump as beating another suit', () => {
    expect(playable(lead([], ['2S', '3S'], '4H'))).toEqual([id('2S'), id('3S')]);
  });

  it("doesn't count a card identical to the one leading", () => {
    // 4H.1 doesn't beat 4H (the first of two identical cards wins), so either heart will do.
    expect(playable(lead([], ['4H.1', '2H'], '4H')).sort()).toEqual([id('4H.1'), id('2H')].sort());
  });

  it('is true for any card when the trick is empty', () => {
    const at = (expr: string) => evaluate(expr, buildScope(start, { player: L }));
    expect(at('trick.isBeatenBy(hand.top)')).toBe(true);
    expect(() => at('trick.isBeatenBy(3)')).toThrow('trick.isBeatenBy() needs cards');
  });
});

describe('countCard', () => {
  it('counts copies of a card by code, or by rank and suit', () => {
    const start = createGame(beating, {}, 2, 'count');
    const s = withZones(start, { 'hand@0': ['4H', '4H.1', '5S', '2H'] }, 'won@0');
    const at = (expr: string) => evaluate(expr, buildScope(s, { player: 0 }));
    expect(at("hand.countCard('4H')")).toBe(2);
    expect(at("hand.countCard('4', 'hearts')")).toBe(2);
    expect(at("hand.countCard('5', 'hearts')")).toBe(0);
    expect(at("min([hand.countCard('4H'), hand.countCard('5S')])")).toBe(1);
  });
});

/** The counting game, but pairs are held as "bonus" points, added at the end of the round. */
const holding: GameFile = {
  ...counting,
  phases: counting.phases.map((phase, i) =>
    i === 0
      ? {
          ...phase,
          actions: [
            {
              type: 'play',
              to: 'pile',
              effects: [
                {
                  score: 'pile.sameRankAtEnd * (pile.sameRankAtEnd - 1)',
                  label: 'Pair',
                  into: 'bonus',
                },
                { if: 'everyPlayer.hand.count == 0', returnCards: 'pile', to: 'played' },
              ],
            },
          ],
        }
      : phase,
  ),
  scoring: { ...counting.scoring, perTeam: [{ if: 'team.bonus > 2', add: 'team.bonus' }] },
};

describe('held points', () => {
  const start = createGame(holding, {}, 2, 'held');
  const L = start.cursor.current;
  const D = 1 - L;
  const dealt = withZones(
    start,
    { [`hand@${L}`]: ['5H', '5S', '9C'], [`hand@${D}`]: ['5C', '6D', '9D'] },
    'stock',
  );
  const put = (player: number, spec: string) => ({
    player,
    type: 'play' as const,
    card: id(spec),
    to: 'pile',
  });

  it('holds points out of the score, noting them in the log', () => {
    const s = play(dealt, put(L, '5H'), put(D, '5C'), put(L, '5S'));
    expect(s.teams.map((t) => t.score)).toEqual([0, 0]);
    expect(s.teams[D]?.held).toEqual({ bonus: 2 });
    expect(s.teams[L]?.held).toEqual({ bonus: 6 });
    expect(s.scoreEvents.map((e) => [e.player, e.points, e.into])).toEqual([
      [D, 2, 'bonus'],
      [L, 6, 'bonus'],
    ]);
    expect(evaluate('team.bonus', buildScope(s, { team: L }))).toBe(6);
  });

  it("lets the round's scoring decide whether they count, then clears them", () => {
    const s = play(
      dealt,
      put(L, '5H'),
      put(D, '5C'),
      put(L, '5S'),
      put(D, '6D'),
      put(L, '9C'),
      put(D, '9D'),
      { player: L, type: 'choose', value: 'count' },
      { player: D, type: 'choose', value: 'count' },
    );
    const round = s.history[0];
    // Held points count only above 2: L's 6 do, and D's 4 (5-5, then 9-9). D also
    // scores 2 straight away in the show, for the fifteen 6+9.
    expect(round?.teams.find((t) => t.id === L)?.points).toBe(6);
    expect(round?.teams.find((t) => t.id === D)?.held).toEqual({ bonus: 4 });
    expect(round?.teams.find((t) => t.id === D)?.points).toBe(6);
    expect(s.teams.map((t) => t.held)).toEqual([{}, {}]);
  });
});

describe('endCondition.priority', () => {
  /** 10 points a trick; game to 10; the team named in `priority` wins once it has 10. */
  const race = (priority: string): GameFile => ({
    ...tinyTricks,
    meta: { name: 'Race', players: 2 },
    scoring: { perPlayer: [{ add: 'player.tricks * 10' }] },
    endCondition: { when: 'anyTeam.score >= 10', winner: 'highestScore', priority },
  });

  /** L takes three tricks (30), the dealer D the last one (10). */
  function playOut(file: GameFile) {
    const start = createGame(file, {}, 2, 'race');
    const L = start.cursor.current;
    const D = 1 - L;
    const dealt = withZones(start, {
      [`hand@${L}`]: ['5H', '4H', '3H', '2S'],
      [`hand@${D}`]: ['2H', '3S', '4S', '5S'],
    });
    const s = play(
      dealt,
      ...[
        [L, '5H'],
        [D, '2H'],
        [L, '4H'],
        [D, '4S'],
        [L, '3H'],
        [D, '5S'],
        [L, '2S'],
        [D, '3S'],
      ].map(([player, spec]) => ({
        player: player as number,
        type: 'playToTrick' as const,
        card: id(spec as string),
      })),
    );
    return { s, L, D };
  }

  it('lets a team meeting the condition win ahead of a higher score', () => {
    // The same seed deals the same dealer, so D is known before writing the file.
    const { D } = playOut(race('false'));
    const { s, L } = playOut(race(`team.id == ${D} && team.score >= 10`));
    expect(s.teams[L]?.score).toBe(30);
    expect(s.teams[D]?.score).toBe(10);
    expect(s.winners).toEqual([D]);
  });

  it('falls back to the highest score when no team meets it', () => {
    const { s, L } = playOut(race('false'));
    expect(s.winners).toEqual([L]);
  });
});

describe('checking the pinochle blocks', () => {
  const errors = (file: unknown) => {
    const result = validate(file);
    return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
  };

  it('accepts the test games', () => {
    expect(errors(beating)).toEqual([]);
    expect(errors(holding)).toEqual([]);
  });

  it('checks into, countCard and priority', () => {
    const withEffect = (effect: object) => ({
      ...holding,
      phases: [
        { ...holding.phases[0], actions: [{ type: 'play', to: 'pile', effects: [effect] }] },
        holding.phases[1],
      ],
    });
    expect(errors(withEffect({ set: 'state.x', into: 'bonus' }))).toEqual([
      'phases[0] ("play").actions[0].effects[0].into: "into" only goes with score',
    ]);
    // (Without an `into: "bonus"` the scoring's team.bonus is unknown too, hence toContain.)
    expect(errors(withEffect({ score: 1, into: 'score' }))).toContain(
      'phases[0] ("play").actions[0].effects[0].into: "score" is already something else; ' +
        'pick another name',
    );
    expect(errors(withEffect({ score: "hand.countCard('X', 'hearts')", into: 'bonus' }))).toEqual([
      expect.stringContaining('"X" isn\'t a rank'),
    ]);
    expect(errors(withEffect({ score: "hand.countCard('XY')", into: 'bonus' }))).toEqual([
      expect.stringContaining('"XY" isn\'t a card'),
    ]);
    expect(
      errors({ ...holding, endCondition: { ...holding.endCondition, priority: 'player.id == 0' } }),
    ).toEqual([expect.stringContaining('"player" isn\'t available here')]);
  });
});
