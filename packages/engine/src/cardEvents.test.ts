/**
 * Cards that move without a player's move: turned up in the deal, or given out
 * by a `giveCards` effect (in a phase's `start`, say). They go in the log, but
 * only cards everyone could see.
 */
import { describe, expect, it } from 'vitest';
import { applyMove, createGame, viewFor } from './api';
import type { GameFile, ZoneDef } from './game/types';
import { validate } from './schema/validate';
import { hand } from './testing';

/** The dealer is given the turned-up card as the "take" phase begins; then everyone says OK. */
function upcardGame(
  up: ZoneDef['visibility'] = 'all',
  start: GameFile['phases'][0]['start'] = [{ if: 'player.isDealer', giveCards: 'up' }],
): GameFile {
  return {
    meta: { name: 'Upcard', players: 2 },
    deck: { ranks: ['2', '3', '4', '5'], suits: ['hearts', 'spades'] },
    zones: {
      hand: { per: 'player', visibility: 'owner' },
      stock: { shared: true, visibility: 'none', countVisible: true },
      up: { shared: true, visibility: up },
    },
    setup: {
      shuffle: true,
      deal: { to: 'hand', count: 2 },
      rest: 'stock',
      flip: { from: 'stock', to: 'up' },
    },
    phases: [
      {
        name: 'take',
        order: 'dealer',
        rounds: 1,
        ...(start && { start }),
        actions: [{ type: 'choose', values: ['ok'], set: 'state.ok' }],
      },
    ],
    scoring: { perPlayer: [{ add: 0 }] },
    endCondition: { when: 'round >= 2', winner: 'highestScore', ties: 'share' },
  };
}

const errors = (file: GameFile) => {
  const result = validate(file);
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
};

describe('cards turned up and given out', () => {
  it('notes the card turned up in the deal, and gives it to the dealer as the phase begins', () => {
    const state = createGame(upcardGame(), {}, 2, 'upcard');
    const [turned, given] = state.cardEvents;
    expect(turned).toMatchObject({ round: 1, at: 0, kind: 'turnedUp', zone: 'up', player: null });
    expect(turned?.cards).toHaveLength(1);
    expect(given).toEqual({ ...turned, kind: 'given', player: state.dealer });
    expect(state.zones.up).toEqual([]);
    expect(hand(state, state.dealer)).toContain(turned?.cards[0]);
    // Everyone sees them in the view; nothing else in it moved.
    expect(viewFor(state, 1 - state.dealer).cardEvents).toEqual(state.cardEvents);
    expect(state.log).toEqual([]);
  });

  it('notes each new round at the move it starts after', () => {
    let state = createGame(upcardGame(), {}, 2, 'upcard-rounds');
    for (const player of [state.dealer, 1 - state.dealer]) {
      state = applyMove(state, { player, type: 'choose', value: 'ok' });
    }
    expect(state.round).toBe(2);
    expect(state.cardEvents.slice(2).map((e) => [e.round, e.at, e.kind])).toEqual([
      [2, 2, 'turnedUp'],
      [2, 2, 'given'],
    ]);
  });

  it('never lists a card nobody could see; a top-card-only pile shows the one card', () => {
    const hidden = createGame(upcardGame('none'), {}, 2, 'upcard');
    expect(hidden.cardEvents.map((e) => e.cards)).toEqual([[], []]);
    const top = createGame(upcardGame('topCardOnly', undefined), {}, 2, 'upcard');
    expect(top.cardEvents.map((e) => e.cards.length)).toEqual([1, 1]);
  });

  it('gives nothing when the pile is empty, or the condition fails', () => {
    const nobody = createGame(upcardGame('all', [{ if: 'false', giveCards: 'up' }]), {}, 2, 'u');
    expect(nobody.cardEvents.map((e) => e.kind)).toEqual(['turnedUp']);
    expect(nobody.zones.up).toHaveLength(1);
    const twice = createGame(
      upcardGame('all', [{ giveCards: 'up' }, { giveCards: 'up', to: 'hand' }]),
      {},
      2,
      'u',
    );
    expect(twice.cardEvents.map((e) => e.kind)).toEqual(['turnedUp', 'given']);
  });

  it('accepts the game, and checks giveCards and phase start effects', () => {
    expect(errors(upcardGame())).toEqual([]);
    const at = 'phases[0] ("take").start[0]';
    expect(errors(upcardGame('all', [{ giveCards: 'hand', to: 'stock' }]))).toEqual([
      `${at}.giveCards: Zone "hand" must be shared, not one per player`,
      `${at}.to: Zone "stock" must be a per-player zone ("per": "player")`,
    ]);
    expect(errors(upcardGame('all', [{ score: 1 }]))).toEqual([
      `${at}: score can't be used in a phase's "start"`,
    ]);
    expect(errors(upcardGame('all', [{ choose: 'suit', set: 'state.suit' }]))).toEqual([
      `${at}: choose can't be used in a phase's "start"`,
    ]);
    const file = upcardGame();
    const inAfterTrick: GameFile = {
      ...file,
      zones: { ...file.zones, trick: { shared: true, visibility: 'all' } },
      phases: [
        {
          name: 'play',
          actions: [{ type: 'playToTrick' }],
          afterTrick: [{ resolveTrick: 'highestLed' }, { giveCards: 'trick' }],
        },
      ],
    };
    expect(errors(inAfterTrick)).toContain(
      `phases[0] ("play").afterTrick[1]: giveCards needs a player: use it in an action's effects or a phase's start`,
    );
  });
});
