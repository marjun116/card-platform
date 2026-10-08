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
  options: {
    reshuffles: {
      label: 'Reshuffle the discard pile',
      type: 'choice',
      values: ['unlimited', 1, 2, 3],
      default: 'unlimited',
    },
  },
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
      // Reshuffle the discard pile as often as needed, unless the table sets a limit.
      whenEmpty: { stock: { policy: 'reshuffleDiscardExceptTop', limit: 'options.reshuffles' } },
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

/** Two-player rummy with wild jokers and a cut joker, small enough to set up by hand. */
export const wildRummy: GameFile = {
  meta: { name: 'Wild Rummy', players: 2 },
  deck: { jokers: 'options.jokers ? 2 : 0' },
  cardOrder: { wild: 'card.isJoker || card.rank == state.cutRank' },
  options: {
    jokers: { label: 'Jokers', type: 'boolean', default: true },
    cut: { label: 'Cut joker', type: 'boolean', default: true },
    pure: { label: 'Pure run needed', type: 'boolean', default: true },
    sort: { label: 'Sort button', type: 'boolean', default: true },
  },
  meldRules: { pureRunRequired: 'options.pure', autoArrange: 'options.sort' },
  zones: {
    hand: { per: 'player', visibility: 'owner' },
    stock: { shared: true, visibility: 'none', countVisible: true },
    discard: { shared: true, visibility: 'topCardOnly' },
    cut: { shared: true, visibility: 'all' },
    melds: { per: 'player', visibility: 'all', melds: true },
  },
  setup: {
    deal: { to: 'hand', count: 7 },
    rest: 'stock',
    flip: [
      { from: 'stock', to: 'discard' },
      {
        if: 'options.cut',
        from: 'stock',
        to: 'cut',
        set: { 'state.cutRank': "card.isJoker ? 'A' : card.rank" },
      },
    ],
  },
  phases: [
    {
      name: 'play',
      until: 'anyPlayer.hand.count == 0 || state.out != null',
      turn: [
        {
          actions: [
            { type: 'draw', from: 'stock', effects: [{ set: { 'player.taken': null } }] },
            { type: 'draw', from: 'discard', effects: [{ set: { 'player.taken': 'card.id' } }] },
          ],
        },
        {
          optional: true,
          repeatable: true,
          actions: [
            { type: 'meld', to: 'melds', if: '!meld.usesWild || player.hasPureRun' },
            { type: 'layOff', to: 'melds' },
          ],
        },
        {
          actions: [
            {
              type: 'discard',
              to: 'discard',
              if: 'card.id != player.taken',
              effects: [{ if: 'hand.count > 0', set: { 'player.hasMelded': 'melds.melds > 0' } }],
            },
            {
              type: 'showHand',
              to: 'discard',
              effects: [{ set: { 'state.out': 'player.id' } }, { layOutMelds: 'melds' }],
            },
          ],
        },
      ],
      whenEmpty: { stock: { policy: 'reshuffleDiscardExceptTop', limit: 1 } },
    },
    {
      name: 'show',
      if: 'state.out != null',
      rounds: 1,
      actions: [{ type: 'choose', values: ['show'], set: 'state.shown', if: 'hand.count > 0' }],
    },
  ],
  scoring: {
    cardValue: { J: 10, Q: 10, K: 10, A: 1, JOKER: 0, default: 'rankNumber' },
    playerValues: { dw: 'player.deadwood' },
    perPlayer: [
      {
        if: 'player.hand.count == 0 || state.out == player.id',
        add: 'sum(activePlayers, dw)',
      },
    ],
    atGameEnd: [{ if: 'player.score > 0', add: 1000 }],
  },
  endCondition: { when: 'true', winner: 'highestScore' },
};

/**
 * Each player plays a card to a shared pile, scoring pairs and runs at once.
 * When the hands are empty the cards go back to their players, who count
 * fifteens and the jack of spades.
 */
export const counting: GameFile = {
  meta: {
    name: 'Counting',
    players: [2, 4],
    teams: {
      '4': [
        [0, 2],
        [1, 3],
      ],
    },
  },
  deck: { copies: 1, jokers: 0 },
  cardOrder: { ranks: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] },
  options: {
    target: { label: 'Play to', type: 'choice', values: [100, 5, 2], default: 100 },
    immediate: { label: 'End at once', type: 'boolean', default: true },
  },
  zones: {
    hand: { per: 'player', visibility: 'owner' },
    stock: { shared: true, visibility: 'none' },
    pile: { shared: true, visibility: 'all' },
    played: { per: 'player', visibility: 'all' },
  },
  setup: { shuffle: true, deal: { to: 'hand', count: 3 }, rest: 'stock' },
  phases: [
    {
      name: 'play',
      until: 'everyPlayer.hand.count == 0',
      actions: [
        {
          type: 'play',
          to: 'pile',
          effects: [
            { set: { 'state.total': '(state.total == null ? 0 : state.total) + cardValue(card)' } },
            { score: 'pile.sameRankAtEnd * (pile.sameRankAtEnd - 1)', label: 'Pair' },
            { score: 'pile.runAtEnd', label: 'Run' },
            { if: 'everyPlayer.hand.count == 0', returnCards: 'pile', to: 'played' },
          ],
        },
      ],
    },
    {
      name: 'show',
      rounds: 1,
      actions: [
        {
          type: 'choose',
          values: ['count'],
          set: 'state.counted',
          effects: [
            { score: '2 * countSums(15, played)', label: 'Fifteens' },
            { score: "played.hasCard('J', 'spades') ? 1 : 0", label: 'Jack' },
          ],
        },
      ],
    },
  ],
  scoring: { cardValue: { J: 10, Q: 10, K: 10 } },
  endCondition: {
    when: 'anyTeam.score >= options.target',
    winner: 'highestScore',
    immediate: true,
    notes: [{ if: 'anyTeam.score == 0', text: 'Shutout!' }],
  },
  display: [{ label: 'Total', value: 'state.total' }],
};

export const allFixtures = {
  spades,
  sevensUp,
  tinyTricks,
  miniRummy,
  passing,
  wildRummy,
  counting,
};
