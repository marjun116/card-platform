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
  /** Per-player zone holding each player's melds on the table. Default "melds". */
  zone: name.optional(),
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

export const setupSchema = z.strictObject({
  shuffle: z.boolean().optional(),
  deal: z.strictObject({ to: name, count: z.union([count(0), expr]) }),
  rest: name.optional(),
  /** One card turned face up, or several in order. */
  flip: z.union([flipSchema, z.array(flipSchema).min(1)]).optional(),
  dealerRotation: z.enum(['left', 'right', 'none']).optional(),
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
  /** Gives each card in this shared zone back to the player who played it, into `to`. */
  returnCards: name.optional(),
  to: name.optional(),
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
export const layOffActionSchema = action('layOff', { to: name, from: name.optional() });
/** Go out by discarding one card when every other card is in a valid group. */
export const showHandActionSchema = action('showHand', { to: name });
export const pickUpPileActionSchema = action('pickUpPile', { from: name, to: name.optional() });
export const bidActionSchema = action('bid', {
  values: z.union([
    z.strictObject({ range: z.tuple([z.int(), z.int()]) }),
    z.array(z.union([z.number(), z.string()])).min(1),
  ]),
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
  whenEmpty: z
    .record(
      name,
      z.union([
        z.enum(['reshuffleDiscardExceptTop', 'endRound']),
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
});

export const TIES = ['playOn', 'share'] as const;
export const WINNERS = ['highestScore', 'lowestScore', 'lastActivePlayer'] as const;
export const endConditionSchema = z.strictObject({
  when: expr,
  winner: settingOr(WINNERS),
  ties: settingOr(TIES).optional(),
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
});
