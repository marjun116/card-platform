/**
 * Building blocks added for hearts but meant for any game: play
 * restrictions, card codes, trick numbers, removing cards from the deck,
 * settings that house rules can change, and named choices.
 */
import { describe, expect, it } from 'vitest';
import { tinyTricks } from './__fixtures__/games';
import { card, hand, id, play, withZones } from './testing';
import { applyMove, createGame, getLegalMoves, viewFor } from './api';
import { passTarget } from './actions/cardMovement';
import { evaluate } from './expr/evaluate';
import { buildScope } from './game/scope';
import { draft } from './game/state';
import type { Move } from './game/move';
import type { GameFile, PlayRestriction } from './game/types';
import { validate } from './schema/validate';

const trick = (player: number, spec: string): Move => ({
  player,
  type: 'playToTrick',
  card: id(spec),
});
const cardsOf = (moves: Move[]) =>
  moves.flatMap((m) => (m.type === 'playToTrick' ? [m.card] : [])).sort();
const ids = (...specs: string[]) => specs.map(id).sort();

/** tinyTricks with these playToTrick restrictions (and a hearts-broken flag). */
function withRestrictions(restrictions: PlayRestriction[]): GameFile {
  return {
    ...tinyTricks,
    phases: [
      {
        name: 'play',
        leader: { first: 'leftOfDealer', then: 'lastTrickWinner' },
        actions: [{ type: 'playToTrick', followSuit: true, restrictions }],
        afterTrick: [
          { resolveTrick: 'highestLed' },
          { moveTrick: 'won', of: 'winner' },
          { set: 'state.heartsBroken', if: "trick.containsSuit('hearts')" },
        ],
      },
    ],
  };
}

/** A two-player tinyTricks game where L (left of the dealer, who leads) and D hold these cards. */
function dealt(file: GameFile, l: string[], d: string[]) {
  const state = createGame(file, {}, 2, 'rules');
  const D = state.dealer;
  const L = 1 - D;
  const zones = { [`hand@${L}`]: l, [`hand@${D}`]: d };
  return { state: withZones(state, zones, `won@${L}`), L, D };
}

describe('play restrictions', () => {
  const noLeadingHearts = withRestrictions([
    { if: 'trick.count == 0 && !state.heartsBroken', cannotPlay: "card.suit == 'hearts'" },
  ]);

  it('removes the cards a cannotPlay rule matches', () => {
    const { state, L } = dealt(noLeadingHearts, ['2H', '3S'], ['4H', '5S']);
    expect(cardsOf(getLegalMoves(state, L))).toEqual(ids('3S'));
  });

  it('is skipped when it would leave nothing to play', () => {
    const { state, L } = dealt(noLeadingHearts, ['2H', '3H'], ['4S', '5S']);
    expect(cardsOf(getLegalMoves(state, L))).toEqual(ids('2H', '3H'));
  });

  it('only applies when its "if" holds', () => {
    const { state, L, D } = dealt(noLeadingHearts, ['2H', '3S', '4H'], ['5H', '2S', '4S']);
    // L leads a spade; D follows. Next trick D leads: hearts still unbroken.
    const next = play(state, trick(L, '3S'), trick(D, '4S'));
    expect(cardsOf(getLegalMoves(next, D))).toEqual(ids('2S'));
    // Once a heart has been played, D could lead one.
    const broken = draft(next);
    broken.vars.heartsBroken = true;
    expect(cardsOf(getLegalMoves(broken, D))).toEqual(ids('2S', '5H'));
  });

  it('applies after following suit, so it never forces a revoke', () => {
    const avoidHigh = withRestrictions([{ cannotPlay: "card.rank == '5'" }]);
    // D must follow spades with the only spade it has, even though it's a 5.
    const { state, L, D } = dealt(avoidHigh, ['2S', '3H'], ['5S', '4H']);
    const led = applyMove(state, trick(L, '2S'));
    expect(cardsOf(getLegalMoves(led, D))).toEqual(ids('5S'));
  });

  it('keeps only the matching cards with mustPlay', () => {
    const lowestHeart = withRestrictions([
      { if: 'trick.number == 1 && trick.count == 0', mustPlay: "card.code == '2H'" },
    ]);
    const { state, L, D } = dealt(lowestHeart, ['2H', '3S'], ['4H', '5S']);
    expect(cardsOf(getLegalMoves(state, L))).toEqual(ids('2H'));
    // From the second trick on, the rule no longer applies.
    const second = play(state, trick(L, '2H'), trick(D, '4H'));
    expect(second.trick?.number).toBe(2);
    expect(cardsOf(getLegalMoves(second, D))).toEqual(ids('5S'));
  });

  it('checks restrictions in the game file', () => {
    const bad = withRestrictions([
      { cannotPlay: 'card.suit == "heart"' },
      { mustPlay: "card.code == '2H'", cannotPlay: "card.code == '3H'" },
      { if: 'trick.count == 0' },
      { mustPlay: "card.code == 'QX'" },
    ]);
    const result = validate(bad);
    expect(result.ok).toBe(false);
    const messages = result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
    const at = 'phases[0] ("play").actions[0].restrictions';
    expect(messages).toEqual([
      `${at}[0].cannotPlay: "heart" isn't a suit (use clubs, diamonds, hearts or spades) in "card.suit == "heart""`,
      `${at}[1]: Give exactly one of "mustPlay" or "cannotPlay"`,
      `${at}[2]: Give exactly one of "mustPlay" or "cannotPlay"`,
      `${at}[3].mustPlay: "QX" isn't a card (use a rank and suit letter, e.g. "QS", "10H", "2C", or JOKER) in "card.code == 'QX'"`,
    ]);
  });
});

describe('card codes', () => {
  // With no shuffle, L is dealt 5S 3S 5H 3H and D is dealt 4S 2S 4H 2H.
  const state = createGame(tinyTricks, {}, 2, 'codes');
  const D = state.dealer;
  const L = 1 - D;
  const ask = (expr: string, player = L) => evaluate(expr, buildScope(state, { player }));

  it('names cards by rank and suit letter', () => {
    expect(ask("hand.hasCard('5S')")).toBe(true);
    expect(ask("hand.hasCard('2S')")).toBe(false);
    expect(evaluate('card.code', buildScope(state, { card: card('10H') }))).toBe('10H');
  });

  it("finds who holds a card, or null if it's in nobody's hand", () => {
    expect(ask("holderOf('2H')")).toBe(D);
    expect(ask("holderOf('5S')")).toBe(L);
    expect(ask("holderOf('AS')")).toBe(null);
  });

  it('values a card by its own entry, then rank, then suit, then default', () => {
    const file: GameFile = {
      ...tinyTricks,
      scoring: {
        perPlayer: [{ add: 'sum(player.won, cardValue)' }],
        cardValue: { '5S': 13, '5': 5, hearts: 1, default: 0 },
      },
    };
    const game = createGame(file, {}, 2, 'values');
    const value = (spec: string) =>
      evaluate('cardValue(card)', buildScope(game, { card: card(spec) }));
    expect(value('5S')).toBe(13);
    expect(value('5H')).toBe(5);
    expect(value('2H')).toBe(1);
    expect(value('2S')).toBe(0);
  });

  it('checks card codes in the game file', () => {
    const file: GameFile = {
      ...tinyTricks,
      setup: { ...tinyTricks.setup, deal: { to: 'hand', count: "holderOf('1H') == null ? 4 : 3" } },
      scoring: {
        perPlayer: [{ add: "player.won.hasCard('ZZ') ? 1 : 0" }],
        cardValue: { QS: 13, hearts: 1, Q: 2, spade: 1 },
      },
    };
    const result = validate(file);
    const messages = result.ok ? [] : result.errors.map((e) => e.path);
    expect(messages).toEqual([
      'setup.deal.count',
      'scoring.perPlayer[0].add',
      'scoring.cardValue.spade',
    ]);
  });
});

describe('removing cards from the deck', () => {
  const file: GameFile = {
    ...tinyTricks,
    meta: { name: 'Removal', players: [2, 3] },
    deck: {
      ranks: ['2', '3', '4', '5'],
      suits: ['hearts', 'spades'],
      remove: [{ if: 'activePlayers.count == 3', cards: ['2H', '2S'] }, { cards: ['5H'] }],
    },
    setup: { ...tinyTricks.setup, deal: { to: 'hand', count: 'activePlayers.count == 3 ? 1 : 3' } },
  };
  const allCards = (state: ReturnType<typeof createGame>) =>
    state.players.flatMap((p) => hand(state, p.id)).sort();

  it('always removes cards with no condition', () => {
    // 7 cards left; 3 each are dealt (the one left over isn't used).
    const two = createGame(file, {}, 2, 'remove');
    const dealtCards = allCards(two);
    expect(dealtCards).toHaveLength(6);
    expect(dealtCards).not.toContain(id('5H'));
    expect(dealtCards).toContain(id('2S')); // only removed with three players
  });

  it('removes conditional cards only when the condition holds', () => {
    const three = createGame(file, {}, 3, 'remove');
    const dealtCards = allCards(three);
    expect(dealtCards).toHaveLength(3);
    for (const gone of ['2H', '2S', '5H']) expect(dealtCards).not.toContain(id(gone));
  });

  it('warns about cards that are not in the deck and rejects bad codes', () => {
    const result = validate({
      ...file,
      deck: { ...file.deck, remove: [{ cards: ['AH', 'JOKER', '2X'] }] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual([
      'deck.remove[0].cards[1]',
      'deck.remove[0].cards[2]',
    ]);
    expect(result.warnings.map((w) => w.message)).toContain("AH isn't in the deck anyway");
  });
});

describe('settings that house rules can change', () => {
  it('lets an option pick the pass direction, including a cycle with no hold round', () => {
    const file: GameFile = {
      ...tinyTricks,
      meta: { name: 'Pass', players: [2, 4] },
      deck: {},
      options: {
        passing: {
          label: 'Passing',
          type: 'choice',
          values: ['rotate', 'rotateNoHold', 'left'],
          labels: { rotate: 'Left, right, across, hold', rotateNoHold: 'Left, right, across' },
          default: 'rotate',
        },
      },
      setup: { deal: { to: 'hand', count: 2 } },
      phases: [
        {
          name: 'pass',
          rounds: 1,
          actions: [{ type: 'pass', count: 1, direction: 'options.passing' }],
        },
        ...tinyTricks.phases,
      ],
    };
    expect(validate(file).ok).toBe(true);
    const targets = (option: string, players: number) => {
      const state = draft(createGame(file, { passing: option }, players, 'dir'));
      return [1, 2, 3, 4].map((round) => {
        state.round = round;
        return passTarget(state, 0, 'options.passing');
      });
    };
    expect(targets('rotate', 4)).toEqual([1, 3, 2, null]);
    expect(targets('rotateNoHold', 4)).toEqual([1, 3, 2, 1]);
    expect(targets('rotateNoHold', 3)).toEqual([1, 2, 1, 2]);
    expect(targets('left', 4)).toEqual([1, 1, 1, 1]);
    // An expression giving something that isn't a direction is a mistake in the file.
    const state = createGame(file, {}, 4, 'dir');
    expect(() => passTarget(state, 0, "'up'")).toThrow(/Pass direction "'up'" gave "up"/);
  });

  it('starts with the holder of a card, falling back to left of the dealer', () => {
    const file = (first: string): GameFile => ({
      ...tinyTricks,
      phases: [{ ...tinyTricks.phases[0]!, leader: { first, then: 'lastTrickWinner' } }],
    });
    // With no shuffle, the dealer holds the 2♥ (see "card codes").
    const byCard = createGame(file("holderOf('2H')"), {}, 2, 'lead');
    expect(byCard.cursor.current).toBe(byCard.dealer);
    const missing = createGame(file("holderOf('AH')"), {}, 2, 'lead');
    expect(missing.cursor.current).toBe(1 - missing.dealer);
    const named = createGame(file("round > 0 ? 'dealer' : 'leftOfDealer'"), {}, 2, 'lead');
    expect(named.cursor.current).toBe(named.dealer);
    expect(() => createGame(file("'nobody'"), {}, 2, 'lead')).toThrow(/leader.first/);
  });

  it('lets an option decide whether tied winners share the game', () => {
    const file: GameFile = {
      ...tinyTricks,
      options: { share: { label: 'Share ties', type: 'boolean', default: false } },
      scoring: { perPlayer: [{ add: 0 }] },
      endCondition: {
        when: 'true',
        winner: 'highestScore',
        ties: "options.share ? 'share' : 'playOn'",
      },
    };
    const finish = (share: boolean) => {
      let state = createGame(file, { share }, 2, 'ties');
      for (let i = 0; i < 8; i++)
        state = applyMove(state, getLegalMoves(state, state.cursor.current)[0]!);
      return state;
    };
    expect(finish(true).status).toBe('over');
    expect(finish(true).winners).toEqual([0, 1]);
    expect(finish(false).status).toBe('inProgress');
  });

  it('checks setting expressions in the game file', () => {
    const result = validate({
      ...tinyTricks,
      phases: [{ ...tinyTricks.phases[0]!, leader: { first: 'holderOf(2H)' } }],
      endCondition: { ...tinyTricks.endCondition, ties: 'options.shareTies' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual([
      'phases[0] ("play").leader.first',
      'endCondition.ties',
    ]);
  });
});

describe('named choices', () => {
  const file: GameFile = {
    ...tinyTricks,
    phases: [
      {
        name: 'decide',
        rounds: 1,
        actions: [
          {
            type: 'choose',
            values: ['alone', 'together'],
            labels: { alone: 'Go alone' },
            set: 'state.plan',
            if: 'player.isDealer',
          },
        ],
      },
      ...tinyTricks.phases,
    ],
  };

  it('offers the choices to whoever the "if" allows and stores the pick', () => {
    const state = createGame(file, {}, 2, 'choose');
    const D = state.dealer;
    // The player left of the dealer has nothing to decide and is skipped.
    expect(state.cursor.current).toBe(D);
    expect(getLegalMoves(state, D)).toEqual([
      { player: D, type: 'choose', value: 'alone' },
      { player: D, type: 'choose', value: 'together' },
    ]);
    const chosen = applyMove(state, { player: D, type: 'choose', value: 'alone' });
    expect(chosen.vars.plan).toBe('alone');
    expect(chosen.file.phases[chosen.cursor.phase]?.name).toBe('play');
    expect(() => applyMove(state, { player: D, type: 'choose', value: 'never' })).toThrow();
  });

  it('sends the labels to players', () => {
    const state = createGame(file, {}, 2, 'choose');
    expect(viewFor(state, 0).choiceLabels).toEqual({ alone: 'Go alone' });
  });

  it('checks choices in the game file', () => {
    const result = validate({
      ...file,
      phases: [
        {
          name: 'decide',
          rounds: 1,
          actions: [{ type: 'choose', values: ['a', 'a'], labels: { b: 'B' }, set: 'plan' }],
        },
        ...tinyTricks.phases,
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual([
      'phases[0] ("decide").actions[0].set',
      'phases[0] ("decide").actions[0].labels.b',
      'phases[0] ("decide").actions[0].values',
    ]);
  });
});

describe('option labels', () => {
  it('must name one of the option values', () => {
    const result = validate({
      ...tinyTricks,
      options: {
        a: {
          label: 'A',
          type: 'choice',
          values: [1, 2],
          labels: { '1': 'One', '3': 'Three' },
          default: 1,
        },
        b: { label: 'B', type: 'boolean', labels: { true: 'Yes', maybe: '?' }, default: false },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual([
      'options.a.labels.3',
      'options.b.labels.maybe',
    ]);
  });
});
