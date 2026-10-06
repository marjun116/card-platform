import { describe, expect, it } from 'vitest';
import { miniRummy, spades, tinyTricks } from '../__fixtures__/games';
import { card, id, play, withZones } from '../__fixtures__/helpers';
import { createGame } from '../api';
import { evaluate } from '../expr/evaluate';
import { findCard } from './cards';
import { buildScope, cardValue } from './scope';
import {
  draft,
  meldsIn,
  parseZoneKey,
  takeCard,
  teamOf,
  zoneCards,
  zoneInstances,
  zoneKey,
} from './state';

describe('expression scope', () => {
  const state = createGame(tinyTricks, {}, 2, 'scope');
  const L = state.cursor.current;
  const D = 1 - L;
  const at = (expr: string, ctx = {}) => evaluate(expr, buildScope(state, { player: L, ...ctx }));

  it('describes the player', () => {
    expect(at('player.id')).toBe(L);
    expect(at('player.team')).toBe(L);
    expect(at('player.score')).toBe(0);
    expect(at('player.bid')).toBeNull();
    expect(at('player.tricks')).toBe(0);
    expect(at('player.active')).toBe(true);
    expect(at('player.isDealer')).toBe(false);
    expect(at('player.hasLookedAtHand')).toBe(true);
    expect(at('player.hasLegalPlay')).toBe(true);
    expect(at('player.hand.count')).toBe(4);
    expect(() => at('player.nickname')).toThrow('Unknown property "nickname"');
  });

  it('describes the team', () => {
    expect(at('team.id')).toBe(L);
    expect(at('team.score')).toBe(0);
    expect(at('team.tricks')).toBe(0);
    expect(at('team.bid')).toBe(0);
    expect(at('team.players')).toBe(1);
    // `won` is per player in this game, so it's on the player, not the team.
    expect(at('player.won.count')).toBe(0);
    expect(() => at('team.won')).toThrow('Unknown property "won"');
  });

  it('answers questions about piles of cards', () => {
    // L holds 5S 3S 5H 3H
    expect(at('hand.top.rank')).toBe('3');
    expect(at('hand.cards.count')).toBe(4);
    expect(at("hand.countSuit('spades')")).toBe(2);
    expect(at("hand.hasRank('5')")).toBe(true);
    expect(at("hand.hasRank('4')")).toBe(false);
    expect(at("hand.countRank('3')")).toBe(2);
    expect(at("hand.onlySuit('spades')")).toBe(false);
    expect(at('trick.count')).toBe(0);
    expect(at('trick.top')).toBeNull();
    expect(at('trick.leader')).toBe(L);
    expect(at('trick.winner')).toBeNull();
    expect(at('trick.ledSuit')).toBeNull();
  });

  it('knows the led suit once a card is played', () => {
    const next = play(state, { player: L, type: 'playToTrick', card: id('5S') });
    expect(evaluate('trick.ledSuit', buildScope(next, { player: D }))).toBe('spades');
  });

  it('provides the card being considered', () => {
    expect(at('card.isJoker', { card: card('QH') })).toBe(false);
    expect(() => at('card')).toThrow('Unknown name "card"');
  });

  it('provides round, active players, options and functions', () => {
    expect(at('round')).toBe(1);
    expect(at('activePlayers.count')).toBe(2);
    expect(at('options')).toEqual({});
    expect(at('sum([1, 2, 3])')).toBe(6);
    expect(at('min([3, 1, 2])')).toBe(1);
    expect(at('max([3, 1, 2])')).toBe(3);
    expect(at('abs(-4)')).toBe(4);
    expect(at('sum(hand, cardValue)')).toBe(5 + 3 + 5 + 3);
    expect(() => at("sum('x')")).toThrow('sum() needs a list');
    expect(() => at("sum(['x'])")).toThrow('sum() needs numbers');
    expect(() => at("abs('x')")).toThrow('abs() needs a number');
    expect(() => at('cardValue(1)')).toThrow('cardValue needs a card');
  });

  it('leaves out names that need a player when there is none', () => {
    const noPlayer = buildScope(state);
    expect(noPlayer.lookup('player')).toBeUndefined();
    expect(noPlayer.lookup('team')).toBeUndefined();
    expect(noPlayer.lookup('hand')).toBeUndefined();
    expect(noPlayer.lookup('trick')).toBeDefined();
    expect(noPlayer.lookup('nothing')).toBeUndefined();
  });

  it('values cards by the scoring table, falling back to rank numbers', () => {
    const rummy = createGame(miniRummy, {}, 2, 'v');
    const value = (spec: string) =>
      cardValue(rummy, { id: '', rank: card(spec).id.slice(0, -3), suit: 'x', isJoker: false });
    expect(value('AH')).toBe(1);
    expect(value('KH')).toBe(10);
    expect(value('7H')).toBe(7);
    expect(cardValue(state, { rank: 'JOKER' })).toBe(0);
    expect(cardValue(state, { rank: 'Q' })).toBe(12);
  });

  it('counts melds in a meld zone', () => {
    const rummy = createGame(miniRummy, {}, 2, 'melds');
    const s = draft(rummy);
    s.melds['melds@0'] = [[card('3H'), card('4H'), card('5H')]];
    expect(evaluate('melds.melds', buildScope(s, { player: 0 }))).toBe(1);
    expect(evaluate('melds.count', buildScope(s, { player: 0 }))).toBe(3);
  });

  it('exposes tracked counters as 0 until something is tracked', () => {
    const s = createGame(spades, {}, 4, 'track');
    expect(evaluate('team.bags', buildScope(s, { player: 0 }))).toBe(0);
    expect(evaluate('player.bags', buildScope(s, { player: 0 }))).toBe(0);
    expect(evaluate('team.won.count', buildScope(s, { player: 0 }))).toBe(0);
    expect(evaluate('won.count', buildScope(s, { team: 1 }))).toBe(0);
  });
});

describe('state helpers', () => {
  const state = createGame(spades, {}, 4, 'helpers');

  it('names zone instances', () => {
    expect(zoneKey(state, 'hand', 2)).toBe('hand@2');
    expect(zoneKey(state, 'won', 3)).toBe('won@t1');
    expect(zoneKey(state, 'trick', null)).toBe('trick');
    expect(zoneInstances(state, 'hand')).toEqual(['hand@0', 'hand@1', 'hand@2', 'hand@3']);
    expect(zoneInstances(state, 'won')).toEqual(['won@t0', 'won@t1']);
    expect(zoneInstances(state, 'trick')).toEqual(['trick']);
    expect(parseZoneKey('hand@2')).toEqual({ name: 'hand', player: 2, team: null });
    expect(parseZoneKey('won@t1')).toEqual({ name: 'won', player: null, team: 1 });
    expect(parseZoneKey('stock')).toEqual({ name: 'stock', player: null, team: null });
    expect(teamOf(state, 3)).toBe(1);
  });

  it('reports missing zones and cards', () => {
    expect(() => zoneCards(state, 'nowhere')).toThrow("isn't a card pile");
    expect(() => meldsIn(state, 'hand@0')).toThrow("doesn't hold melds");
    expect(() => takeCard(draft(state), 'trick', 'AS.0')).toThrow("isn't in trick");
  });

  it('finds a card wherever it is', () => {
    const s = withZones(state, { trick: ['AS'] }, 'won@t0');
    expect(findCard(s, id('AS'))?.id).toBe(id('AS'));
    const melded = draft(createGame(miniRummy, {}, 2, 'find'));
    const meldCard = melded.zones['hand@0']?.pop();
    if (!meldCard) throw new Error('no card');
    melded.melds['melds@0'] = [[meldCard]];
    expect(findCard(melded, meldCard.id)).toBe(meldCard);
    const passingCard = melded.zones['hand@1']?.pop();
    if (!passingCard) throw new Error('no card');
    melded.passing[0] = [passingCard];
    expect(findCard(melded, passingCard.id)).toBe(passingCard);
    expect(findCard(melded, 'nope')).toBeNull();
  });
});
