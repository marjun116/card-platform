import { describe, expect, it } from 'vitest';
import { allFixtures, miniRummy, sevensUp, spades, tinyTricks } from '../__fixtures__/games';
import { createGame } from '../api';
import { GameFileError } from '../errors';
import type { GameFile, PhaseDef } from '../game/types';
import { formatIssues, validate } from './validate';

/** Every error as "path: message". */
function errors(file: unknown): string[] {
  const result = validate(file);
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
}
function warnings(file: unknown): string[] {
  return validate(file).warnings.map((w) => `${w.path}: ${w.message}`);
}

const [bidding, playPhase] = spades.phases as [PhaseDef, PhaseDef];
const trickPhase = tinyTricks.phases[0] as PhaseDef;
const withPhases = (file: GameFile, phases: PhaseDef[]): GameFile => ({ ...file, phases });

describe('validate', () => {
  it.each(Object.entries(allFixtures))('accepts the %s test game', (_name, file) => {
    const result = validate(file);
    expect(result.ok ? [] : formatIssues(result.errors)).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('returns the checked file', () => {
    const result = validate(JSON.parse(JSON.stringify(spades)));
    expect(result.ok && result.file).toEqual(spades);
  });

  describe('shape (schema)', () => {
    it('rejects things that are not game files', () => {
      expect(errors(null)).toEqual([': Expected object, received null']);
      expect(errors({})).toContain('meta: Required (expected object)');
    });

    it('rejects misspelled keys', () => {
      const file = {
        ...spades,
        zones: { ...spades.zones, hand: { per: 'player', visiblity: 'owner' } },
      };
      expect(errors(file)).toEqual([
        'zones.hand.visibility: Must be one of "owner", "all", "none", "topCardOnly"',
        'zones.hand: Unknown key "visiblity" (check the spelling)',
      ]);
    });

    it('rejects unknown action types', () => {
      const file = withPhases(spades, [{ ...bidding, actions: [{ type: 'shout' } as never] }]);
      expect(errors(file)[0]).toMatch(
        /^phases\[0\] \("bidding"\)\.actions\[0\]\.type: Unknown action type/,
      );
    });

    it('checks numbers and names', () => {
      expect(errors({ ...spades, deck: { copies: 7 } })[0]).toMatch(/^deck\.copies: Too big/);
      expect(
        errors({ ...spades, zones: { ...spades.zones, 'my hand': { visibility: 'all' } } })[0],
      ).toMatch(/Names may only use letters/);
    });
  });

  describe('meta and options', () => {
    it('checks player counts and teams', () => {
      expect(errors({ ...sevensUp, meta: { name: 'x', players: [6, 2] } })).toContain(
        'meta.players: The minimum (6) is more than the maximum (2)',
      );
      expect(errors({ ...spades, meta: { ...spades.meta, players: [4, 6] } })).toContain(
        'meta.teams: Teams need a fixed number of players (e.g. "players": 4)',
      );
      expect(
        errors({
          ...spades,
          meta: {
            ...spades.meta,
            teams: [
              [0, 1],
              [1, 3],
            ],
          },
        }),
      ).toContain('meta.teams: Teams must list each seat 0 to 3 exactly once');
    });

    it('checks option defaults and values', () => {
      const options = {
        a: { label: 'A', type: 'boolean', default: 3 },
        b: { label: 'B', type: 'boolean', default: true, values: [true] },
        c: { label: 'C', type: 'choice', default: 1 },
        d: { label: 'D', type: 'choice', values: [1, 2], default: 3 },
      };
      expect(errors({ ...tinyTricks, options })).toEqual([
        'options.a.default: A true/false option needs a default of true or false',
        'options.b.values: A true/false option has no "values"',
        'options.c: A choice option needs a list of "values"',
        "options.d.default: The default 3 isn't one of the values",
      ]);
    });
  });

  describe('zones and the deck', () => {
    it('requires a per-player hand zone', () => {
      const { hand: _hand, ...zones } = tinyTricks.zones;
      expect(errors({ ...tinyTricks, zones })).toContain(
        'zones: Every game needs a per-player zone called "hand"',
      );
    });

    it('rejects zone names that expressions already use', () => {
      const zones = { ...tinyTricks.zones, player: { visibility: 'all' as const } };
      expect(errors({ ...tinyTricks, zones })).toContain(
        'zones.player: "player" can\'t be a zone name: expressions already use it for something else',
      );
    });

    it('rejects contradictory zones and warns about pointless settings', () => {
      const zones = {
        ...tinyTricks.zones,
        odd: {
          per: 'player' as const,
          shared: true,
          visibility: 'all' as const,
          countVisible: true,
        },
      };
      expect(errors({ ...tinyTricks, zones })).toContain(
        'zones.odd: A zone can\'t be both "per": "player" and "shared"',
      );
      expect(
        warnings({
          ...tinyTricks,
          zones: { ...tinyTricks.zones, pile: { visibility: 'all', countVisible: true } },
        }),
      ).toEqual(['zones.pile.countVisible: Only matters for zones with "visibility": "none"']);
    });

    it('checks the deck is big enough for the deal', () => {
      const file = { ...sevensUp, setup: { ...sevensUp.setup, deal: { to: 'hand', count: 9 } } };
      expect(errors(file)).toEqual([
        'setup.deal.count: The deck has 52 cards, but dealing 9 to 6 players and flipping one needs 55',
      ]);
    });

    it('checks referenced zones exist and are the right kind', () => {
      const file = withPhases(tinyTricks, [
        { ...trickPhase, actions: [{ type: 'playToTrick', to: 'tricks' }] },
      ]);
      expect(errors(file)).toContain(
        'phases[0] ("play").actions[0].to: Zone "tricks" doesn\'t exist. Did you mean "trick"?',
      );
      const setup = { ...tinyTricks.setup, deal: { to: 'trick', count: 4 }, rest: 'won' };
      expect(errors({ ...tinyTricks, setup })).toEqual([
        'setup.deal.to: Zone "trick" must be a per-player zone ("per": "player")',
        'setup.rest: Zone "won" must be shared, not one per player',
      ]);
    });

    it('keeps melds and piles apart', () => {
      const [rummyPhase] = miniRummy.phases as [PhaseDef];
      const steps = rummyPhase.turn ?? [];
      const discardToMelds = withPhases(miniRummy, [
        {
          ...rummyPhase,
          turn: [...steps.slice(0, 2), { actions: [{ type: 'discard', to: 'melds' }] }],
        },
      ]);
      expect(errors(discardToMelds)).toContain(
        'phases[0] ("play").turn[2].actions[0].to: Zone "melds" holds melds; use meld or layOff to put cards there',
      );
      const meldToPile = withPhases(miniRummy, [
        {
          ...rummyPhase,
          turn: [steps[0]!, { actions: [{ type: 'meld', to: 'discard' }] }, steps[2]!],
        },
      ]);
      expect(errors(meldToPile)).toContain(
        'phases[0] ("play").turn[1].actions[0].to: Zone "discard" must hold melds ("melds": true)',
      );
    });

    it('checks the starting flip', () => {
      const flip = (f: object) => ({
        ...sevensUp,
        setup: { ...sevensUp.setup, flip: { ...sevensUp.setup.flip, ...f } },
      });
      expect(errors(flip({ triggerEffects: true }))).toEqual([
        'setup.flip.triggerEffects: Only false is supported for now',
      ]);
      expect(errors(flip({ from: 'discard' }))).toEqual([
        'setup.flip.from: The starting card must come from the undealt cards ("rest": "stock")',
      ]);
      expect(errors(flip({ set: { 'state.suit': 'player.id' } }))).toEqual([
        'setup.flip.set.state.suit: "player" isn\'t available here (there is no current player) in "player.id"',
      ]);
    });

    it('warns when the rank order or trump looks incomplete', () => {
      expect(warnings({ ...spades, cardOrder: { ranks: ['2', '3'], trump: 'declared' } })).toEqual([
        "cardOrder.ranks: Doesn't include 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, which are in the deck",
        'cardOrder.trump: "declared" trump needs a declareTrump action somewhere',
      ]);
    });
  });

  describe('phases', () => {
    it('needs actions, and not both kinds', () => {
      const { actions: _actions, ...noActions } = bidding;
      expect(errors(withPhases(spades, [noActions, playPhase]))).toContain(
        'phases[0] ("bidding"): Needs "actions" (or "turn" steps) saying what players can do',
      );
      const both = { ...bidding, turn: [{ actions: bidding.actions ?? [] }] };
      expect(errors(withPhases(spades, [both, playPhase]))).toContain(
        'phases[0] ("bidding"): Use either "actions" or "turn", not both',
      );
    });

    it('requires every phase to be able to end', () => {
      const { rounds: _rounds, ...endless } = bidding;
      expect(errors(withPhases(spades, [endless, playPhase]))).toEqual([
        'phases[0] ("bidding"): This phase never ends: give it "rounds", "until" or a "whenEmpty" endRound',
      ]);
    });

    it('checks trick phases resolve their tricks', () => {
      expect(
        errors(withPhases(tinyTricks, [{ ...trickPhase, afterTrick: [{ moveTrick: 'won' }] }])),
      ).toEqual([
        'phases[0] ("play").afterTrick: A trick phase needs a resolveTrick effect in "afterTrick"',
      ]);
      const backwards = {
        ...trickPhase,
        afterTrick: [{ moveTrick: 'won' }, { resolveTrick: 'highestLed' as const }],
      };
      expect(errors(withPhases(tinyTricks, [backwards]))).toEqual([
        'phases[0] ("play").afterTrick[0]: moveTrick must come after resolveTrick',
      ]);
    });

    it('keeps trick-only settings in trick phases', () => {
      const file = withPhases(spades, [
        { ...bidding, repeat: 2, afterTrick: [{ resolveTrick: 'highestLed' }] },
        playPhase,
      ]);
      expect(errors(file)).toEqual([
        'phases[0] ("bidding").repeat: "repeat" only applies to trick phases (with playToTrick)',
        'phases[0] ("bidding").afterTrick: "afterTrick" only applies to trick phases (with playToTrick)',
      ]);
    });

    it('accepts a reshuffle limit and checks its expression', () => {
      const [phase] = miniRummy.phases as [PhaseDef];
      const limit = (value: string | number) =>
        withPhases(miniRummy, [
          { ...phase, whenEmpty: { stock: { policy: 'reshuffleDiscardExceptTop', limit: value } } },
        ]);
      expect(errors(limit(2))).toEqual([]);
      expect(errors(limit('options.reshufles'))).toEqual([
        `phases[0] ("play").whenEmpty.stock.limit: Option "reshufles" isn't declared (options: reshuffles). Did you mean "reshuffles"? in "options.reshufles"`,
      ]);
    });

    it('checks whenEmpty', () => {
      const [phase] = sevensUp.phases as [PhaseDef];
      const noDiscard = {
        ...sevensUp,
        zones: {
          hand: sevensUp.zones.hand!,
          stock: sevensUp.zones.stock!,
          pile: sevensUp.zones.discard!,
        },
        setup: { ...sevensUp.setup, flip: { ...sevensUp.setup.flip!, to: 'pile' } },
        phases: [
          {
            ...phase,
            actions: [{ type: 'play' as const, to: 'pile' }],
            whenEmpty: { stok: 'reshuffleDiscardExceptTop' as const },
          },
        ],
      };
      expect(errors(noDiscard)).toEqual([
        'phases[0] ("play").whenEmpty.stok: Zone "stok" doesn\'t exist. Did you mean "stock"?',
        'phases[0] ("play").whenEmpty.stok: Reshuffling needs a zone called "discard"',
      ]);
    });

    it('checks draw follow-ups and bid ranges', () => {
      const [phase] = sevensUp.phases as [PhaseDef];
      const drawOnly = {
        ...phase,
        actions: [
          { type: 'draw' as const, from: 'stock', count: 2, then: 'mayPlayDrawnCard' as const },
        ],
      };
      expect(errors({ ...sevensUp, phases: [drawOnly] })).toEqual([
        'phases[0] ("play").actions[0].then: "mayPlayDrawnCard" needs a play action in the same phase',
        'phases[0] ("play").actions[0].then: "mayPlayDrawnCard" only works when drawing one card',
      ]);
      const badBid = {
        ...bidding,
        actions: [{ type: 'bid' as const, values: { range: [5, 1] as [number, number] } }],
      };
      expect(errors(withPhases(spades, [badBid, playPhase]))).toEqual([
        'phases[0] ("bidding").actions[0].values.range: 5 is more than 1',
      ]);
    });
  });

  describe('effects', () => {
    const playWith = (effects: unknown[]) =>
      withPhases(tinyTricks, [
        { ...trickPhase, actions: [{ type: 'playToTrick', effects } as never] },
      ]);

    it('requires each effect to do exactly one thing', () => {
      expect(errors(playWith([{}]))).toEqual([
        'phases[0] ("play").actions[0].effects[0]: This effect doesn\'t do anything',
      ]);
      expect(errors(playWith([{ skip: true, reverse: true }]))).toEqual([
        'phases[0] ("play").actions[0].effects[0]: Each effect should do one thing; this one has skip, reverse',
      ]);
    });

    it('checks choose, set and of', () => {
      expect(errors(playWith([{ choose: 'suit' }]))).toEqual([
        'phases[0] ("play").actions[0].effects[0].set: "choose" needs "set": "state.<name>" to store the choice',
      ]);
      expect(errors(playWith([{ set: 'player.score' }, { set: { 'state.ok': 1, x: 2 } }]))).toEqual(
        [
          'phases[0] ("play").actions[0].effects[0].set: Can only set custom values written as "state.<name>", not "player.score"',
          'phases[0] ("play").actions[0].effects[1].set.x: Can only set custom values written as "state.<name>", not "x"',
        ],
      );
      expect(errors(playWith([{ skip: true, of: 'winner' }]))).toEqual([
        'phases[0] ("play").actions[0].effects[0].of: "of" only goes with moveTrick',
      ]);
    });

    it('keeps trick effects in afterTrick and choices out of it', () => {
      expect(errors(playWith([{ resolveTrick: 'highestLed' }]))).toEqual([
        'phases[0] ("play").actions[0].effects[0]: resolveTrick only works in a trick phase\'s "afterTrick"',
      ]);
      const choice = {
        ...trickPhase,
        afterTrick: [...(trickPhase.afterTrick ?? []), { choose: 'suit' as const, set: 'state.s' }],
      };
      expect(errors(withPhases(tinyTricks, [choice]))).toEqual([
        'phases[0] ("play").afterTrick[2].choose: Only a player can choose: use it in an action\'s effects',
      ]);
    });

    it('checks nextPlayer', () => {
      expect(errors(playWith([{ nextPlayer: {} }]))).toEqual([
        'phases[0] ("play").actions[0].effects[0].nextPlayer: Needs "draw" and/or "skip"',
      ]);
      expect(errors(playWith([{ nextPlayer: { draw: 1 } }]))[0]).toMatch(
        /Zone "stock" doesn't exist/,
      );
    });
  });

  describe('expressions', () => {
    const until = (expr: string) =>
      withPhases(sevensUp, [{ ...(sevensUp.phases[0] as PhaseDef), until: expr }]);
    const path = 'phases[0] ("play").until';

    it('reports syntax errors', () => {
      expect(errors(until('hand.count = 0'))).toEqual([
        `${path}: Use == to compare values (a single = is not allowed) in "hand.count = 0"`,
      ]);
    });

    it('reports unknown names with suggestions', () => {
      expect(errors(until('hnad.count == 0'))).toEqual([
        `${path}: Unknown name "hnad". Did you mean "hand"? in "hnad.count == 0"`,
      ]);
    });

    it('reports unknown properties on players, teams, zones, cards and lists', () => {
      expect(errors(until('player.scor > 1 || team.wins > 1 || hand.size > 1'))).toEqual([
        `${path}: A player has no "scor". Did you mean "score"? in "player.scor > 1 || team.wins > 1 || hand.size > 1"`,
        `${path}: A team has no "wins". in "player.scor > 1 || team.wins > 1 || hand.size > 1"`,
        `${path}: A zone has no "size". in "player.scor > 1 || team.wins > 1 || hand.size > 1"`,
      ]);
      expect(
        errors(until('discard.top.colour == 1 || hand.cards.length > 0 || activePlayers.left > 1')),
      ).toHaveLength(3);
    });

    it('reports options that are not declared', () => {
      expect(errors(until('options.fast'))).toEqual([
        `${path}: Option "fast" isn't declared (no options are declared). in "options.fast"`,
      ]);
    });

    it('reports names that are unavailable in that place', () => {
      expect(errors(until("card.rank == '7'"))).toEqual([
        `${path}: "card" isn't available here (only card actions and their effects have a card) in "card.rank == '7'"`,
      ]);
      const end = {
        ...spades,
        endCondition: {
          when: 'team.score > 1 || hand.count == 0',
          winner: 'highestScore' as const,
        },
      };
      expect(errors(end)).toEqual([
        'endCondition.when: "team" isn\'t available here (there is no current team) in "team.score > 1 || hand.count == 0"',
        'endCondition.when: "hand" isn\'t available here ("hand" belongs to a player, and there is no current player) in "team.score > 1 || hand.count == 0"',
      ]);
      const perTeam = {
        ...spades,
        scoring: { perTeam: [{ add: 'player.tricks', to: 'team' as const }] },
      };
      expect(errors(perTeam)).toEqual([
        'scoring.perTeam[0].add: "player" isn\'t available here (there is no current player) in "player.tricks"',
        'scoring.perTeam[0].to: "to" only applies to perPlayer rules',
      ]);
      const wonPerTeam = {
        ...spades,
        endCondition: { when: 'won.count > 0', winner: 'highestScore' as const },
      };
      expect(errors(wonPerTeam)[0]).toMatch(
        /"won" belongs to a team, and there is no current team/,
      );
    });

    it('catches misspelled suits and ranks', () => {
      const play = {
        ...trickPhase,
        actions: [
          {
            type: 'playToTrick' as const,
            if: "card.suit != 'spade' && card.rank in ['1', 'K'] && hand.hasRank('11') && !hand.containsSuit('heart')",
          },
        ],
      };
      expect(errors(withPhases(tinyTricks, [play])).map((e) => e.split(' in "')[0])).toEqual([
        'phases[0] ("play").actions[0].if: "spade" isn\'t a suit (use clubs, diamonds, hearts or spades)',
        'phases[0] ("play").actions[0].if: "1" isn\'t a rank (use 2–10, J, Q, K, A or JOKER)',
        'phases[0] ("play").actions[0].if: "11" isn\'t a rank (use 2–10, J, Q, K, A or JOKER)',
        'phases[0] ("play").actions[0].if: "heart" isn\'t a suit (use clubs, diamonds, hearts or spades)',
      ]);
    });

    it('accepts the full vocabulary', () => {
      const exprs = [
        'anyPlayer.hand.count == 0',
        'everyPlayer.score >= 0',
        'anyTeam.won.count >= 0',
        'everyTeam.bags > 0',
        "trick.ledSuit == 'hearts' || trick.winner == player.id || trick.leader == 0",
        'sum(player.hand, cardValue) + min([1]) + max([2]) + abs(-1) + round > 0',
        'state.anything || options.blindNil || player.isDealer || card.isJoker',
        "discard.top.rank == 'K' || 'J' == card.rank",
      ];
      const play = {
        ...playPhase,
        actions: exprs.map((expr) => ({ type: 'playToTrick' as const, if: expr })),
      };
      const zones = { ...spades.zones, discard: { visibility: 'all' as const } };
      expect(errors({ ...spades, zones, phases: [bidding, play] })).toEqual([]);
    });

    it('checks expressions in scoring, elimination and setup', () => {
      const file = {
        ...sevensUp,
        setup: { ...sevensUp.setup, deal: { to: 'hand', count: 'round +' } },
        elimination: { when: 'player.scroe >= 100' },
        scoring: {
          perPlayer: [{ add: 'sum(player.hand, cardValue)', if: 'x', track: { t: 'y' } }],
          cardValue: { '1': 1 },
        },
      };
      expect(errors(file).map((e) => e.split(' in "')[0])).toEqual([
        'setup.deal.count: Unexpected end of expression',
        'scoring.perPlayer[0].if: Unknown name "x".',
        'scoring.perPlayer[0].track.t: Unknown name "y".',
        'scoring.cardValue.1: "1" isn\'t a rank (use 2–10, J, Q, K, A, JOKER or default)',
        'elimination.when: A player has no "scroe". Did you mean "score"?',
      ]);
    });
  });

  describe('end condition', () => {
    it('warns when the end condition may never be true', () => {
      expect(
        warnings({ ...spades, endCondition: { when: 'state.done', winner: 'highestScore' } }),
      ).toEqual([
        "endCondition.when: This may never become true: it doesn't mention scores, rounds or players left",
      ]);
    });

    it('warns about lastActivePlayer without elimination', () => {
      const { elimination: _e, ...noElimination } = sevensUp;
      expect(warnings(noElimination)).toEqual([
        'endCondition.winner: "lastActivePlayer" needs an "elimination" rule to knock players out',
      ]);
    });
  });
});

describe('createGame validation', () => {
  it('refuses to start an invalid game, listing every problem', () => {
    const file = {
      ...spades,
      endCondition: { when: 'player.score > 5', winner: 'highestScore' as const },
    };
    expect(() => createGame(file, {}, 4, 'x')).toThrow(GameFileError);
    expect(() => createGame(file, {}, 4, 'x')).toThrow(
      'Spades has problems:\nendCondition.when: "player" isn\'t available here',
    );
  });
});
