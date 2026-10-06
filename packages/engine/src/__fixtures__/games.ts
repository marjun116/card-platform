/**
 * Hand-written game files for engine tests. Spades and Sevens Up follow the
 * examples in docs/game-format.md; the others are small games that exercise
 * specific building blocks.
 */
import type { GameFile } from '../game/types';

/** The spec's spades example. */
export const spades: GameFile = {
  meta: {
    name: 'Spades',
    players: 4,
    teams: [
      [0, 2],
      [1, 3],
    ],
  },
  deck: { copies: 1, jokers: 0 },
  cardOrder: {
    ranks: ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'],
    trump: 'spades',
  },
  options: {
    nil: { label: 'Allow nil bids', type: 'boolean', default: true },
    blindNil: { label: 'Allow blind nil', type: 'boolean', default: false },
    targetScore: { label: 'Play to', type: 'choice', values: [300, 500, 1000], default: 500 },
    mercyRule: {
      label: 'End the game when a team falls to -200',
      type: 'boolean',
      default: true,
    },
  },
  zones: {
    hand: { per: 'player', visibility: 'owner' },
    trick: { shared: true, visibility: 'all' },
    won: { per: 'team', visibility: 'none', countVisible: true },
  },
  setup: { shuffle: true, deal: { to: 'hand', count: 13 }, dealerRotation: 'left' },
  phases: [
    {
      name: 'bidding',
      order: 'leftOfDealer',
      rounds: 1,
      actions: [
        { type: 'bid', values: { range: [1, 13] } },
        { type: 'bid', values: ['nil'], if: 'options.nil' },
        { type: 'bid', values: ['blindNil'], if: 'options.blindNil && !player.hasLookedAtHand' },
      ],
    },
    {
      name: 'play',
      repeat: 13,
      leader: { first: 'leftOfDealer', then: 'lastTrickWinner' },
      actions: [
        {
          type: 'playToTrick',
          followSuit: true,
          leadRestriction: {
            cannotLead: 'spades',
            unless: "state.spadesBroken || hand.onlySuit('spades')",
          },
        },
      ],
      afterTrick: [
        { resolveTrick: 'highestTrumpElseHighestLed' },
        { moveTrick: 'won', of: 'winnerTeam' },
        { set: 'state.spadesBroken', if: "trick.containsSuit('spades')" },
      ],
    },
  ],
  scoring: {
    perTeam: [
      {
        if: 'team.tricks >= team.bid',
        add: 'team.bid * 10 + (team.tricks - team.bid)',
        track: { bags: 'team.tricks - team.bid' },
      },
      { if: 'team.tricks < team.bid', add: '-team.bid * 10' },
      { if: 'team.bags >= 10', add: -100, track: { bags: -10 } },
    ],
    perPlayer: [
      { if: "player.bid == 'nil'", add: 'player.tricks == 0 ? 100 : -100', to: 'team' },
      { if: "player.bid == 'blindNil'", add: 'player.tricks == 0 ? 200 : -200', to: 'team' },
    ],
  },
  endCondition: {
    when: 'anyTeam.score >= options.targetScore || (options.mercyRule && anyTeam.score <= -200)',
    winner: 'highestScore',
  },
};

/** The spec's Sevens Up example (with the starting card setting the active suit). */
export const sevensUp: GameFile = {
  meta: { name: 'Sevens Up', players: [2, 6], custom: true },
  deck: { copies: 1, jokers: 0 },
  zones: {
    hand: { per: 'player', visibility: 'owner' },
    stock: { shared: true, visibility: 'none', countVisible: true },
    discard: { shared: true, visibility: 'topCardOnly' },
  },
  setup: {
    shuffle: true,
    deal: { to: 'hand', count: 7 },
    rest: 'stock',
    flip: {
      from: 'stock',
      to: 'discard',
      triggerEffects: false,
      set: { 'state.activeSuit': 'card.suit' },
    },
  },
  phases: [
    {
      name: 'play',
      order: 'clockwise',
      until: 'anyPlayer.hand.count == 0',
      actions: [
        {
          type: 'play',
          to: 'discard',
          if: "card.suit == state.activeSuit || card.rank == discard.top.rank || card.rank == '7'",
          effects: [
            { if: "card.rank == '7'", choose: 'suit', set: 'state.activeSuit' },
            { if: "card.rank != '7'", set: { 'state.activeSuit': 'card.suit' } },
            { if: "card.rank == 'Q'", nextPlayer: { draw: 2, from: 'stock' } },
          ],
        },
        {
          type: 'draw',
          from: 'stock',
          count: 1,
          if: '!player.hasLegalPlay',
          then: 'mayPlayDrawnCard',
        },
      ],
      whenEmpty: { stock: 'reshuffleDiscardExceptTop' },
    },
  ],
  scoring: {
    perPlayer: [{ add: 'sum(player.hand, cardValue)' }],
    cardValue: { '7': 20, A: 15, J: 10, Q: 10, K: 10, default: 'rankNumber' },
  },
  elimination: { when: 'player.score >= 100' },
  endCondition: { when: 'activePlayers.count == 1', winner: 'lastActivePlayer' },
};

/**
 * Two players, eight known cards (2–5 of hearts and spades, no shuffle), one
 * round of four tricks. Small enough to reason about exactly in tests.
 */
export const tinyTricks: GameFile = {
  meta: { name: 'Tiny Tricks', players: 2 },
  deck: { ranks: ['2', '3', '4', '5'], suits: ['hearts', 'spades'] },
  cardOrder: { ranks: ['2', '3', '4', '5'] },
  zones: {
    hand: { per: 'player', visibility: 'owner' },
    trick: { shared: true, visibility: 'all' },
    won: { per: 'player', visibility: 'none', countVisible: true },
  },
  setup: { shuffle: false, deal: { to: 'hand', count: 4 } },
  phases: [
    {
      name: 'play',
      leader: { first: 'leftOfDealer', then: 'lastTrickWinner' },
      actions: [{ type: 'playToTrick', followSuit: true }],
      afterTrick: [{ resolveTrick: 'highestLed' }, { moveTrick: 'won', of: 'winner' }],
    },
  ],
  scoring: { perPlayer: [{ add: 'player.tricks' }] },
  endCondition: { when: 'true', winner: 'highestScore', ties: 'share' },
};

/** Draw, meld or lay off any number of times, then discard. First to empty their hand ends the round. */
export const miniRummy: GameFile = {
  meta: { name: 'Mini Rummy', players: [2, 4] },
  deck: {},
  cardOrder: { ranks: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] },
  zones: {
    hand: { per: 'player', visibility: 'owner' },
    stock: { shared: true, visibility: 'none', countVisible: true },
    discard: { shared: true, visibility: 'topCardOnly' },
    melds: { per: 'player', visibility: 'all', melds: true },
  },
  setup: {
    deal: { to: 'hand', count: 7 },
    rest: 'stock',
    flip: { from: 'stock', to: 'discard' },
  },
  phases: [
    {
      name: 'play',
      until: 'anyPlayer.hand.count == 0',
      turn: [
        {
          actions: [
            { type: 'draw', from: 'stock' },
            { type: 'draw', from: 'discard' },
          ],
        },
        {
          optional: true,
          repeatable: true,
          actions: [
            { type: 'meld', to: 'melds', minSize: 3 },
            { type: 'layOff', to: 'melds' },
          ],
        },
        { actions: [{ type: 'discard', to: 'discard' }] },
      ],
      whenEmpty: { stock: 'reshuffleDiscardExceptTop' },
    },
  ],
  scoring: {
    perPlayer: [{ add: 'sum(player.hand, cardValue)' }],
    cardValue: { A: 1, J: 10, Q: 10, K: 10, default: 'rankNumber' },
  },
  endCondition: { when: 'anyPlayer.score >= 50', winner: 'lowestScore' },
};

/** Hearts-like: pass three cards (left, right, across, hold), then tricks. Lowest score wins. */
export const passing: GameFile = {
  meta: { name: 'Passing Hearts', players: 4 },
  deck: {},
  zones: {
    hand: { per: 'player', visibility: 'owner' },
    trick: { shared: true, visibility: 'all' },
    won: { per: 'player', visibility: 'none', countVisible: true },
  },
  setup: { deal: { to: 'hand', count: 13 } },
  phases: [
    {
      name: 'pass',
      rounds: 1,
      actions: [{ type: 'pass', count: 3, direction: 'rotate' }],
    },
    {
      name: 'play',
      repeat: 13,
      leader: { first: 'leftOfDealer', then: 'lastTrickWinner' },
      actions: [{ type: 'playToTrick' }],
      afterTrick: [{ resolveTrick: 'highestLed' }, { moveTrick: 'won', of: 'winner' }],
    },
  ],
  scoring: { perPlayer: [{ add: "player.won.countSuit('hearts')" }] },
  endCondition: { when: 'anyPlayer.score >= 30', winner: 'lowestScore' },
};

export const allFixtures = { spades, sevensUp, tinyTricks, miniRummy, passing };
