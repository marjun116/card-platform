/**
 * Building blocks added for canasta, tested on the Team Sets test game:
 * sets of any suits with a game condition (and going-out mode), team melds
 * and own-only lay-offs, taking the pile by melding its top card, bonus
 * cards, going out without a discard, asking another player, ending the
 * round when the stock is empty unless the player can still move, and the
 * meld counts expressions can read.
 */
import { describe, expect, it } from 'vitest';
import { teamSets } from './__fixtures__/games';
import { bestArrangement, groupInfo } from './actions/arrange';
import { applyMove, createGame, getLegalMoves, viewFor } from './api';
import { evaluate } from './expr/evaluate';
import { meldRulesOf, valueOf } from './game/arrangement';
import type { Move } from './game/move';
import { buildScope } from './game/scope';
import type { GameState } from './game/state';
import { validate } from './schema/validate';
import { card, draft, id, onTop, play, restartPhase, withZones } from './testing';

const draw = (player: number): Move => ({ player, type: 'draw', from: 'stock' });
const arrange = (player: number, ...groups: string[][]): Move => ({
  player,
  type: 'arrange',
  groups: groups.map((g) => g.map(id)),
});
const movesOf = (state: GameState, seat: number, type: Move['type']) =>
  getLegalMoves(state, seat).filter((m) => m.type === type);

function start(options = {}) {
  const state = createGame(teamSets, options, 4, 'team-sets');
  const L = state.cursor.current;
  return { state, L, partner: (L + 2) % 4, team: L % 2, other: (L + 1) % 2 };
}

/** Hands, the discard pile, team melds, and the next cards to draw (first one first). */
function table(
  state: GameState,
  setting: {
    hands?: Record<number, string[]>;
    discard?: string[];
    melds?: Record<number, string[][]>;
    stockTop?: string[];
  },
): GameState {
  const zones: Record<string, string[]> = { discard: setting.discard ?? [] };
  for (const [seat, cards] of Object.entries(setting.hands ?? {})) zones[`hand@${seat}`] = cards;
  const next = draft(withZones(state, zones, 'stock'));
  const melded = new Set(
    Object.values(setting.melds ?? {})
      .flat(2)
      .map(id),
  );
  for (const key of Object.keys(next.zones)) {
    next.zones[key] = (next.zones[key] ?? []).filter((c) => !melded.has(c.id));
  }
  for (const [team, melds] of Object.entries(setting.melds ?? {})) {
    next.melds[`melds@t${team}`] = melds.map((m) => m.map(card));
  }
  return onTop(next, 'stock', setting.stockTop ?? []);
}

describe('sets of any suits, with the game’s own condition', () => {
  const { state } = start();
  const rules = meldRulesOf(state);
  const valid = (...specs: string[]) =>
    rules !== null && groupInfo(specs.map(card), rules) !== null;

  it('allows repeated suits and any size, with at least 2 natural cards', () => {
    expect(valid('7H', '7S', 'JOKER.0')).toBe(true);
    expect(valid('7H', '7S', '7D', '7C', 'JOKER.0', 'JOKER.1')).toBe(true);
    expect(valid('7H', 'JOKER.0', 'JOKER.1')).toBe(false);
    expect(valid('7H', '8S', 'JOKER.0')).toBe(false);
  });

  it('allows a meld the condition keeps for going out only then', () => {
    expect(valid('KH', 'KS', 'KD')).toBe(false);
    const goingOut = meldRulesOf(state, true);
    expect(goingOut && groupInfo(['KH', 'KS', 'KD'].map(card), goingOut)).not.toBeNull();
  });

  it('sorts a big hand into sets by rank, adding wild cards where they help most', () => {
    const hand = [
      ...['7H', '7S', '7D', '9H', '9S', 'QH', 'QS', 'QD', '3C', '4C', '5C', 'JOKER.0'],
      ...['2C', '2D', '2H', '2S', '6C', '6D', '8C', '8D', '10C', '10D', 'AS'],
    ].map(card);
    if (!rules) throw new Error('No meld rules');
    const best = bestArrangement(hand, rules, valueOf(state), false);
    const groups = best.groups.map((g) =>
      g
        .map((c) => c.id.split('.')[0])
        .sort()
        .join(' '),
    );
    expect(groups).toContain('2C 2D 2H 2S');
    expect(groups).toContain('7D 7H 7S');
    expect(groups).toContain('QD QH QS');
    // The joker completes the most valuable pair: the tens.
    expect(groups).toContain('10C 10D JOKER');
  });
});

describe('team melds', () => {
  it("lays off only on your own team's melds", () => {
    const { state, L, team, other } = start();
    const s = play(
      table(state, {
        hands: { [L]: ['7S', '9S', '4C'] },
        melds: { [team]: [['7H', '7D', '7C']], [other]: [['9H', '9D', '9C']] },
        stockTop: ['5C'],
      }),
      draw(L),
    );
    expect(movesOf(s, L, 'layOff')).toEqual([
      { player: L, type: 'layOff', card: id('7S'), meld: { zone: `melds@t${team}`, index: 0 } },
    ]);
  });

  it('counts melds and natural melds, and the player’s valid groups', () => {
    const { state, L, team } = start();
    const s = applyMove(
      table(state, {
        hands: { [L]: ['5H', '5S', '5D', '5C', '8H', '8S', 'JOKER.0', '2C'] },
        melds: {
          [team]: [
            ['7H', '7D', '7C', '7S'],
            ['9H', '9D', 'JOKER.1', '9C'],
          ],
        },
      }),
      arrange(L, ['5H', '5S', '5D', '5C'], ['8H', '8S', 'JOKER.0']),
    );
    const at = (expr: string) => evaluate(expr, buildScope(s, { player: L }));
    expect(at('team.melds.melds')).toBe(2);
    expect(at('team.melds.countMelds(4)')).toBe(2);
    expect(at('team.melds.countNaturalMelds(4)')).toBe(1);
    expect(at('player.groups.melds')).toBe(2);
    expect(at('player.groups.countNaturalMelds(4)')).toBe(1);
    expect(at('sum(player.groups, cardValue)')).toBe(5 * 4 + 8 * 2 + 20);
    expect(at("player.hasMove('draw')")).toBe(true);
    expect(at("player.hasMove('meld')")).toBe(false);
    expect(() => at("player.hasMove('fly')")).toThrow('"fly" isn\'t a kind of move');
  });
});

describe('taking the pile by melding its top card', () => {
  it('offers new melds with cards from the hand, and own melds the top card fits', () => {
    const { state, L, team } = start();
    const s = table(state, {
      hands: { [L]: ['7S', '7D', 'JOKER.0', '4C'] },
      discard: ['3C', '7H'],
      melds: { [team]: [['8C', '8D', '8H']] },
    });
    // The team's 8s can't take a 7, so only new melds of 7s are offered.
    const takes = movesOf(s, L, 'pickUpPile').map((m) =>
      m.type === 'pickUpPile' ? m.cards : null,
    );
    expect(takes).toEqual([
      [id('7S'), id('7D')],
      [id('7S'), id('JOKER.0')],
      [id('7D'), id('JOKER.0')],
    ]);
  });

  it('melds the top card, gives the rest of the pile to the player, and tells effects about the meld', () => {
    const { state, L, team } = start();
    const s = table(state, {
      hands: { [L]: ['7S', '7D', '4C'] },
      discard: ['3C', 'AH', '7H'],
    });
    const after = applyMove(s, {
      player: L,
      type: 'pickUpPile',
      from: 'discard',
      cards: [id('7S'), id('7D')],
    });
    expect(after.melds[`melds@t${team}`]?.[0]?.map((c) => c.id).sort()).toEqual(
      [id('7H'), id('7S'), id('7D')].sort(),
    );
    // The A♥ is a bonus card: laid aside, and not replaced when taken with the pile.
    expect(after.zones[`bonus@t${team}`]?.map((c) => c.id)).toEqual([id('AH')]);
    expect(after.zones[`hand@${L}`]?.map((c) => c.id).sort()).toEqual([id('3C'), id('4C')].sort());
    expect(after.vars.newMeld).toBe(21);
  });

  it('adds the top card to an own meld when that’s the choice', () => {
    const { state, L, team } = start();
    const s = table(state, {
      hands: { [L]: ['4C', '5D'] },
      discard: ['3C', '7H'],
      melds: { [team]: [['7S', '7D', '7C']] },
    });
    const take = movesOf(s, L, 'pickUpPile');
    expect(take).toEqual([
      {
        player: L,
        type: 'pickUpPile',
        from: 'discard',
        meld: { zone: `melds@t${team}`, index: 0 },
      },
    ]);
    const after = applyMove(s, take[0] as Move);
    expect(after.melds[`melds@t${team}`]?.[0]).toHaveLength(4);
  });
});

describe('bonus cards', () => {
  it('are laid aside when drawn, and replaced from the stock', () => {
    const { state, L, team } = start();
    const after = applyMove(table(state, { stockTop: ['AH', '6C'] }), draw(L));
    expect(after.zones[`bonus@t${team}`]?.map((c) => c.id)).toContain(id('AH'));
    expect(after.zones[`hand@${L}`]?.map((c) => c.id)).toContain(id('6C'));
    expect(after.zones[`hand@${L}`]).toHaveLength(8);
  });

  it('are never left in a hand after the deal', () => {
    for (let i = 0; i < 20; i++) {
      const s = createGame(teamSets, {}, 4, `bonus-${i}`);
      for (const seat of [0, 1, 2, 3]) {
        expect(s.zones[`hand@${seat}`]).toHaveLength(7);
        expect(s.zones[`hand@${seat}`]?.some((c) => c.id === id('AH'))).toBe(false);
      }
    }
  });
});

describe('going out', () => {
  it('can be done without a discard, and with a meld kept for going out', () => {
    const { state, L } = start();
    const s = play(
      table(state, { hands: { [L]: ['KH', 'KS', '9C', '9D'] }, stockTop: ['9H'] }),
      draw(L),
      arrange(L, ['KH', 'KS'], ['9C', '9D', '9H']),
    );
    // Two kings aren't a meld, so this hand can't go out.
    expect(movesOf(s, L, 'showHand')).toEqual([]);
    const kings = play(
      table(state, { hands: { [L]: ['KH', 'KS', 'KD', '9C', '9D'] }, stockTop: ['9H'] }),
      draw(L),
      arrange(L, ['KH', 'KS', 'KD'], ['9C', '9D', '9H']),
    );
    // Kings can't be melded as an ordinary meld...
    expect(movesOf(kings, L, 'meld').map((m) => (m.type === 'meld' ? m.cards.length : 0))).toEqual([
      3,
    ]);
    // ...but going out, with no card left to discard, they can.
    expect(movesOf(kings, L, 'showHand')).toEqual([
      { player: L, type: 'showHand', card: null, to: 'discard' },
    ]);
    const out = applyMove(kings, { player: L, type: 'showHand', card: null, to: 'discard' });
    expect(out.history.at(-1)?.round).toBe(1);
  });

  it('asks another player, who answers before the turn goes on', () => {
    const { state, L, partner } = start({ ask: true });
    const s = play(
      table(state, { hands: { [L]: ['9C', '9D', '5D'] }, stockTop: ['9H'] }),
      draw(L),
      arrange(L, ['9C', '9D', '9H']),
    );
    const asked = applyMove(s, { player: L, type: 'choose', value: 'ask' });
    expect(asked.pending).toMatchObject({ kind: 'ask', player: partner, asker: L });
    expect(viewFor(asked, L).pending).toEqual({ kind: 'ask', player: partner });
    expect(viewFor(asked, L).choiceLabels).toMatchObject({ yes: 'Yes', no: 'No' });
    expect(getLegalMoves(asked, partner).filter((m) => m.type === 'choose')).toEqual([
      { player: partner, type: 'choose', value: 'yes' },
      { player: partner, type: 'choose', value: 'no' },
    ]);
    const yes = applyMove(asked, { player: partner, type: 'choose', value: 'yes' });
    expect(yes.vars.answer).toBe('yes');
    expect(yes.pending).toBeNull();
    expect(yes.cursor.current).toBe(L);
    expect(movesOf(yes, L, 'discard')).toEqual([]);
    expect(movesOf(yes, L, 'showHand')).toEqual([
      { player: L, type: 'showHand', card: id('5D'), to: 'discard' },
    ]);
  });
});

describe('the stock running out', () => {
  function emptyStock(pile: string[], melds: Record<number, string[][]> = {}) {
    const { state, L, team } = start();
    const s = draft(
      table(state, { hands: { [L]: ['5D', '6D', '7S', '7D'] }, discard: pile, melds }),
    );
    s.zones.discard?.unshift(...(s.zones.stock ?? []));
    s.zones.stock = [];
    s.roundMoves = 1;
    return { state: restartPhase(s), L, team };
  }

  it("ends the round when the player to draw can't take the pile", () => {
    expect(emptyStock(['3C', '9S']).state.round).toBe(2);
  });

  it('carries on while they can', () => {
    const { state, L } = emptyStock(['3C', '7H']);
    expect(state.round).toBe(1);
    expect(movesOf(state, L, 'pickUpPile').length).toBeGreaterThan(0);
  });
});

describe('checking the canasta blocks', () => {
  const errors = (file: unknown) => {
    const result = validate(file);
    return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
  };
  const [play0] = teamSets.phases;
  const turn = play0?.turn ?? [];
  const withTurn = (step: number, actions: object[]) => ({
    ...teamSets,
    phases: [{ ...play0, turn: turn.map((s, i) => (i === step ? { ...s, actions } : s)) }],
  });

  it('accepts the test game', () => {
    expect(errors(teamSets)).toEqual([]);
  });

  it('checks meld rules, bonus cards and pile takes', () => {
    expect(
      errors({ ...teamSets, meldRules: { ...teamSets.meldRules, allowed: 'player.id == 0' } }),
    ).toEqual([expect.stringContaining('"player" isn\'t available here')]);
    expect(errors({ ...teamSets, bonusCards: { if: 'card.isJoker', to: 'discard' } })).toContain(
      'bonusCards.to: Bonus cards go to a player or team zone',
    );
    const { meldRules: _, ...noMelds } = teamSets;
    expect(errors(noMelds)).toContain(
      'phases[0] ("play").turn[0].actions[1].meldTop: "meldTop" needs "meldRules" (what counts as a meld)',
    );
    expect(
      errors({ ...teamSets, meldRules: { ...teamSets.meldRules, zone: 'discard' } }),
    ).toContain('meldRules.zone: Zone "discard" must hold melds ("melds": true)');
  });

  it('checks ask effects and hasMove', () => {
    const ask = (effect: object) =>
      withTurn(1, [{ type: 'choose', values: ['ask'], set: 'state.asked', effects: [effect] }]);
    expect(errors(ask({ ask: '0', set: 'state.answer' }))).toContain(
      'phases[0] ("play").turn[1].actions[0].effects[0]: ask needs "values": the answers to choose from',
    );
    expect(errors(ask({ ask: '0', values: ['y'], set: 'player.answer' }))).toContain(
      'phases[0] ("play").turn[1].actions[0].effects[0].set: ask needs "set": "state.<name>" to store the answer',
    );
    expect(errors(ask({ set: 'state.x', values: ['y'] }))).toContain(
      'phases[0] ("play").turn[1].actions[0].effects[0]: "values" and "labels" only go with ask',
    );
    expect(
      errors(withTurn(2, [{ type: 'discard', to: 'discard', if: "player.hasMove('fly')" }])),
    ).toEqual([expect.stringContaining('"fly" isn\'t a kind of move')]);
  });
});
