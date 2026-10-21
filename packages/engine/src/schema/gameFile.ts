/**
 * The game file format (docs/game-format.md) as a Zod schema. This is the
 * single source of truth: the TypeScript types in game/types.ts are derived
 * from it, and the JSON Schema file is generated from it.
 *
 * Objects are strict, so a misspelled key ("visiblity") is an error rather
 * than being silently ignored. Checks that need the whole file (does that
 * zone exist? is the deck big enough?) live in validate.ts.
 */
import { z } from 'zod';
import { RANKS, SUITS } from '../cards/card';

const name = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Names may only use letters, digits and _ (e.g. "hand")');
const expr = z.string().min(1).describe('An expression, e.g. "hand.count == 0"');
const rank = z.enum(RANKS);
const suit = z.enum(SUITS);
const count = (min: number) => z.int().min(min);
const cardCode = z
  .string()
  .min(1)
  .describe('A card code, e.g. "QS" (queen of spades), "10H" or "2C"');
/** Words shown instead of raw values, e.g. { "rotate": "Left, right, across, hold" }. */
const labels = z.record(z.string(), z.string().min(1));
/**
 * A setting with a fixed list of values that may also be an expression giving
 * one of them, so a house rule can change it: "direction": "options.passing".
 */
const settingOr = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.enum(values), expr]);

export const optionValueSchema = z.union([z.boolean(), z.number(), z.string()]);

const teams = z.array(z.array(count(0)).min(1)).min(1);

export const metaSchema = z.strictObject({
  name: z.string().min(1),
  players: z.union([count(1).max(10), z.tuple([count(1).max(10), count(1).max(10)])]),
  /**
   * Partnerships: a list of teams, or teams by player count, e.g.
   * { "4": [[0, 2], [1, 3]] } (other player counts play alone).
   */
  teams: z
    .union([teams, z.record(z.string().regex(/^\d+$/, 'Use a player count, e.g. "4"'), teams)])
    .optional(),
  custom: z.boolean().optional(),
  description: z.string().optional(),
});

export const deckSchema = z.strictObject({
  /** A number, or an expression such as "activePlayers.count >= 8 ? 2 : 1". */
  copies: z.union([count(1).max(6), expr]).optional(),
  ranks: z.array(rank).min(1).optional(),
  suits: z.array(suit).min(1).optional(),
  jokers: z.union([count(0).max(2), expr]).optional(),
  /** Cards taken out (every copy), e.g. the 2♦ when three play hearts. */
  remove: z
    .array(z.strictObject({ if: expr.optional(), cards: z.array(cardCode).min(1) }))
    .min(1)
    .optional(),
});

export const cardOrderSchema = z.strictObject({
  ranks: z.array(rank).min(1).optional(),
  trump: z.union([suit, z.literal('declared')]).optional(),
  /** Which cards are wild in melds, e.g. "card.isJoker || card.rank == state.cutRank". */
  wild: expr.optional(),
  /**
   * Euchre's bowers: the jack of trump ranks highest, and the other jack of the
   * same colour ranks second and counts as a trump.
   */
  bowers: z.boolean().optional(),
});

export const ACES = ['low', 'high', 'both'] as const;
/**
 * How melds work in games where players arrange their own hands: what counts
 * as a meld, and the rules melding, laying off and scoring share.
 */
export const meldRulesSchema = z.strictObject({
  kinds: z
    .array(z.enum(['set', 'run']))
    .min(1)
    .optional(),
  minSize: count(1).optional(),
  /** Aces in runs: low (A-2-3), high (Q-K-A) or both (but not K-A-2). */
  aces: settingOr(ACES).optional(),
  /** Without a pure run (no wild card filling in), a player's melds don't count. */
  pureRunRequired: z.union([z.boolean(), expr]).optional(),
  /** Players may use "Sort into melds". Default true. */
  autoArrange: z.union([z.boolean(), expr]).optional(),
  /** Zone holding melds on the table, one per player or per team. Default "melds". */
  zone: name.optional(),
  /**
   * Sets: one card of each suit (the default), or any suits, so two decks can
   * make a set of eight 7s.
   */
  sets: z.enum(['differentSuits', 'anySuits']).optional(),
  /**
   * A condition every meld must meet, reading `meld` (rank, naturals, wilds,
   * size, goingOut, …), e.g. "meld.naturals >= 2 && meld.wilds <= 3".
   */
  allowed: expr.optional(),
});

export const optionSchema = z.strictObject({
  label: z.string().min(1),
  type: z.enum(['boolean', 'choice']),
  values: z.array(optionValueSchema).min(1).optional(),
  labels: labels.optional(),
  default: optionValueSchema,
});

export const zoneSchema = z.strictObject({
  per: z.enum(['player', 'team']).optional(),
  shared: z.boolean().optional(),
  visibility: z.enum(['owner', 'all', 'none', 'topCardOnly']),
  countVisible: z.boolean().optional(),
  melds: z.boolean().optional(),
  /**
   * Everyone sees the owner's cards while this holds, whatever the visibility,
   * e.g. bridge's dummy once the opening lead is made. Read as the owner
   * (`player`, or `team` for a per-team zone).
   */
  reveal: expr.optional(),
  /**
   * A shared zone is drawn on the table only while this holds, e.g. euchre's upcard
   * and kitty until trump is made (`"state.maker == null"`). Its cards don't change.
   */
  showOnTable: expr.optional(),
});

const setValue = z.union([expr, z.number(), z.boolean(), z.null()]);

export const flipSchema = z.strictObject({
  if: expr.optional(),
  from: name,
  to: name,
  triggerEffects: z.boolean().optional(),
  set: z.record(z.string(), setValue).optional(),
  /** Put the card back in the stock (at a random spot) and turn another while this holds. */
  reflipIf: expr.optional(),
});

export const DEALER_ROTATIONS = ['left', 'right', 'none'] as const;
export const setupSchema = z.strictObject({
  shuffle: z.boolean().optional(),
  deal: z.strictObject({ to: name, count: z.union([count(0), expr]) }),
  rest: name.optional(),
  /** One card turned face up, or several in order. */
  flip: z.union([flipSchema, z.array(flipSchema).min(1)]).optional(),
  /** Or an expression giving one, checked as each round ends (a passed-out hand: "none"). */
  dealerRotation: settingOr(DEALER_ROTATIONS).optional(),
});

export const effectSchema = z.strictObject({
  if: expr.optional(),
  set: z.union([z.string(), z.record(z.string(), setValue)]).optional(),
  choose: z.literal('suit').optional(),
  resolveTrick: z.enum(['highestLed', 'highestTrumpElseHighestLed']).optional(),
  moveTrick: name.optional(),
  of: z.enum(['winner', 'winnerTeam']).optional(),
  nextPlayer: z
    .strictObject({
      draw: z.union([count(1), expr]).optional(),
      from: name.optional(),
      skip: z.boolean().optional(),
    })
    .optional(),
  skip: z.boolean().optional(),
  reverse: z.boolean().optional(),
  winnerLeads: z.boolean().optional(),
  breakSuit: suit.optional(),
  /** Moves the player's valid groups from their hand to this meld zone. */
  layOutMelds: name.optional(),
  /** The seat (an expression) sits out until the round ends, e.g. "(player.id + 2) % 4". */
  sitOut: expr.optional(),
  /** Points for the acting player's team straight away, e.g. 2 for a fifteen. */
  score: z.union([expr, z.number()]).optional(),
  /** Words for the points in the game log, e.g. "Fifteen". */
  label: z.string().min(1).optional(),
  /**
   * Hold the points in a team counter (`team.<name>`, cleared every round)
   * instead of adding them to the score, e.g. "meld".
   */
  into: name.optional(),
  /** Gives each card in this shared zone back to the player who played it, into `to`. */
  returnCards: name.optional(),
  /**
   * Gives every card in this shared zone to the player (the acting player, or in a
   * phase's `start`, the player who starts it), into `to`; e.g. euchre's dealer
   * taking the upcard.
   */
  giveCards: name.optional(),
  to: name.optional(),
  /**
   * Another player (a seat expression) answers a question with one of
   * `values`, stored in `set` ("state.x"); the rest of the effects then run.
   */
  ask: expr.optional(),
  values: z.array(z.string().min(1)).min(1).optional(),
  labels: labels.optional(),
});

const common = { if: expr.optional(), effects: z.array(effectSchema).optional() };
const action = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), ...common, ...shape });

export const playActionSchema = action('play', { to: name, from: name.optional() });
export const playToTrickActionSchema = action('playToTrick', {
  to: name.optional(),
  followSuit: z.boolean().optional(),
  leadRestriction: z.strictObject({ cannotLead: suit, unless: expr.optional() }).optional(),
  /**
   * Checked in order after following suit. Each keeps (mustPlay) or removes
   * (cannotPlay) the cards matching its expression, but is skipped if that
   * would leave the player nothing to play.
   */
  restrictions: z
    .array(
      z.strictObject({
        if: expr.optional(),
        mustPlay: expr.optional(),
        cannotPlay: expr.optional(),
      }),
    )
    .min(1)
    .optional(),
});
export const drawActionSchema = action('draw', {
  from: name,
  to: name.optional(),
  count: z.union([count(1), expr]).optional(),
  then: z.literal('mayPlayDrawnCard').optional(),
});
export const discardActionSchema = action('discard', { to: name, from: name.optional() });
export const PASS_DIRECTIONS = ['left', 'right', 'across', 'rotate', 'rotateNoHold'] as const;
export const passActionSchema = action('pass', {
  count: count(1),
  direction: settingOr(PASS_DIRECTIONS),
  from: name.optional(),
});
export const meldActionSchema = action('meld', {
  to: name,
  kinds: z
    .array(z.enum(['set', 'run']))
    .min(1)
    .optional(),
  minSize: count(1).optional(),
  from: name.optional(),
});
export const layOffActionSchema = action('layOff', {
  to: name,
  from: name.optional(),
  /** Only onto your own melds (or your team's, for a per-team meld zone). */
  own: z.boolean().optional(),
});
/** Go out by discarding one card when every other card is in a valid group. */
export const showHandActionSchema = action('showHand', {
  to: name,
  /** Discard a last card to go out: always (true, the default), or optionally. */
  discard: z.union([z.boolean(), z.literal('optional')]).optional(),
});
export const pickUpPileActionSchema = action('pickUpPile', {
  from: name,
  to: name.optional(),
  /**
   * The pile's top card must go straight into a meld in this zone: a new one
   * with `cards` cards from your hand (default 2), or one of your own melds.
   * The action's `if` sees the meld formed as `meld` and the top card as `card`.
   */
  meldTop: z.strictObject({ to: name, cards: count(1).optional() }).optional(),
});
export const bidActionSchema = action('bid', {
  values: z.union([
    z.strictObject({ range: z.tuple([z.int(), z.int()]) }),
    z.array(z.union([z.number(), z.string()])).min(1),
  ]),
  /** Words shown for bids, e.g. { "11": "1♣", "15": "1NT" }. */
  labels: labels.optional(),
});
export const passBidActionSchema = action('passBid', {});
export const declareTrumpActionSchema = action('declareTrump', {
  suits: z.array(suit).min(1).optional(),
});
/** Pick one of several named choices, stored in `state.<name>`. */
export const chooseActionSchema = action('choose', {
  values: z.array(z.string().min(1)).min(1),
  labels: labels.optional(),
  set: z.string(),
});

export const ACTION_TYPES = [
  'play',
  'playToTrick',
  'draw',
  'discard',
  'pass',
  'meld',
  'layOff',
  'pickUpPile',
  'bid',
  'passBid',
  'declareTrump',
  'choose',
  'showHand',
] as const;

export const actionSchema = z.discriminatedUnion(
  'type',
  [
    playActionSchema,
    playToTrickActionSchema,
    drawActionSchema,
    discardActionSchema,
    passActionSchema,
    meldActionSchema,
    layOffActionSchema,
    pickUpPileActionSchema,
    bidActionSchema,
    passBidActionSchema,
    declareTrumpActionSchema,
    chooseActionSchema,
    showHandActionSchema,
  ],
  { error: `Unknown action type. Use one of: ${ACTION_TYPES.join(', ')}` },
);

export const turnStepSchema = z.strictObject({
  actions: z.array(actionSchema).min(1),
  optional: z.boolean().optional(),
  repeatable: z.boolean().optional(),
});

export const LEADER_FIRST = ['leftOfDealer', 'dealer'] as const;
export const phaseSchema = z.strictObject({
  name: z.string().min(1),
  if: expr.optional(),
  order: z.enum(['leftOfDealer', 'clockwise', 'counterclockwise', 'dealer']).optional(),
  rounds: count(1).optional(),
  repeat: count(1).optional(),
  until: expr.optional(),
  leader: z
    .strictObject({
      // Or an expression giving one of these, or a seat number such as holderOf('2C').
      first: settingOr(LEADER_FIRST).optional(),
      then: z.literal('lastTrickWinner').optional(),
    })
    .optional(),
  actions: z.array(actionSchema).min(1).optional(),
  turn: z.array(turnStepSchema).min(1).optional(),
  afterTrick: z.array(effectSchema).optional(),
  /**
   * Effects run as the phase begins, before anyone moves. `player` is the player
   * who starts the phase.
   */
  start: z.array(effectSchema).min(1).optional(),
  /**
   * One seat plays for another during this phase, e.g. bridge's declarer for
   * the dummy: { "seat": "state.dummy", "by": "state.declarer" }. On the
   * seat's turn its moves go to `by`, and the seat itself has none. Either
   * expression giving null means nobody is controlled.
   */
  control: z.strictObject({ seat: expr, by: expr }).optional(),
  whenEmpty: z
    .record(
      name,
      z.union([
        z.enum(['reshuffleDiscardExceptTop', 'endRound']),
        // End the round only when `if` holds for the player whose turn it is
        // (say, when they can't take the discard pile instead).
        z.strictObject({ policy: z.literal('endRound'), if: expr.optional() }),
        // Reshuffle at most `limit` times per round; when it runs out after that, the
        // round ends. `limit` may be an expression; "unlimited" or null means no limit.
        // With no limit the round never ends this way. `if` switches the rule on and off.
        z.strictObject({
          policy: z.literal('reshuffleDiscardExceptTop'),
          limit: z.union([count(0), expr]).optional(),
          if: expr.optional(),
        }),
      ]),
    )
    .optional(),
});

export const scoreRuleSchema = z.strictObject({
  if: expr.optional(),
  add: z.union([expr, z.number()]).optional(),
  track: z.record(name, z.union([expr, z.number()])).optional(),
  to: z.enum(['team', 'player']).optional(),
});

export const scoringSchema = z.strictObject({
  perTeam: z.array(scoreRuleSchema).optional(),
  perPlayer: z.array(scoreRuleSchema).optional(),
  cardValue: z.record(z.string(), z.union([z.number(), z.literal('rankNumber')])).optional(),
  /**
   * Named values worked out for a player, used as functions:
   * { "handValue": "sum(player.hand, cardValue)" } gives handValue(player) and
   * sum(activePlayers, handValue).
   */
  playerValues: z.record(name, expr).optional(),
  /** Rules run once when the game ends, before the winner is decided (bonuses). */
  atGameEnd: z.array(scoreRuleSchema).optional(),
  /**
   * Words for tracked counters on the scoreboard, e.g. { "below": "Part score" };
   * null hides a counter that is only bookkeeping.
   */
  trackLabels: z.record(name, z.union([z.string().min(1), z.null()])).optional(),
});

export const TIES = ['playOn', 'share'] as const;
export const WINNERS = ['highestScore', 'lowestScore', 'lastActivePlayer'] as const;
export const endConditionSchema = z.strictObject({
  when: expr,
  winner: settingOr(WINNERS),
  ties: settingOr(TIES).optional(),
  /**
   * A team condition: teams meeting it win ahead of the others, e.g. the
   * bidding team when both teams pass the target in the same hand.
   */
  priority: expr.optional(),
  /** Also check `when` each time points are scored during a round, ending the game at once. */
  immediate: z.boolean().optional(),
  /** Words shown with the result when their condition holds at the end, e.g. "Skunk!". */
  notes: z
    .array(z.strictObject({ if: expr, text: z.string().min(1) }))
    .min(1)
    .optional(),
});

/** Values shown on the table, e.g. { "label": "Count", "value": "state.total" }. */
export const displaySchema = z.strictObject({
  label: z.string().min(1),
  value: expr,
  if: expr.optional(),
  /** Words for values, e.g. { "1": "Doubled", "2": "Redoubled" }. */
  labels: labels.optional(),
  /**
   * The value is a seat (shown as that player's name), a team (its players' names) or a
   * suit (shown as its symbol and name).
   */
  format: z.enum(['player', 'team', 'suit']).optional(),
});

export const gameFileSchema = z.strictObject({
  /** Lets editors find the JSON Schema; ignored by the engine. */
  $schema: z.string().optional(),
  meta: metaSchema,
  deck: deckSchema,
  cardOrder: cardOrderSchema.optional(),
  options: z.record(name, optionSchema).optional(),
  meldRules: meldRulesSchema.optional(),
  zones: z.record(name, zoneSchema),
  setup: setupSchema,
  phases: z.array(phaseSchema).min(1),
  scoring: scoringSchema,
  elimination: z.strictObject({ when: expr }).optional(),
  endCondition: endConditionSchema,
  display: z.array(displaySchema).min(1).optional(),
  /**
   * Cards laid down as soon as they reach a hand (red 3s in canasta): moved to
   * the player's (or team's) `to` zone and, from the deal or a draw, replaced
   * from `replaceFrom`.
   */
  bonusCards: z.strictObject({ if: expr, to: name, replaceFrom: name.optional() }).optional(),
});
