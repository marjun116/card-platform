/**
 * TypeScript shape of a game file (docs/game-format.md). Phase 2 adds a Zod
 * schema and validator; until then the engine trusts files to match these
 * types and reports problems as GameFileError when it runs into them.
 */
import type { Rank, Suit } from '../cards/card';
import type { DeckDef } from '../cards/deck';
import type { TrickRule } from '../cards/order';

/** An expression in the condition language, e.g. "hand.count == 0". */
export type Expr = string;

export type OptionValue = boolean | number | string;
export type Visibility = 'owner' | 'all' | 'none' | 'topCardOnly';

export interface GameFile {
  meta: MetaDef;
  deck: DeckDef;
  cardOrder?: CardOrderDef;
  options?: Record<string, OptionDef>;
  zones: Record<string, ZoneDef>;
  setup: SetupDef;
  phases: PhaseDef[];
  scoring: ScoringDef;
  elimination?: { when: Expr };
  endCondition: EndConditionDef;
}

export interface MetaDef {
  name: string;
  /** Exact count, or [min, max]. */
  players: number | [number, number];
  /** Partnerships as lists of seats, e.g. [[0, 2], [1, 3]]. Omit for every player alone. */
  teams?: number[][];
  custom?: boolean;
  description?: string;
}

export interface CardOrderDef {
  /** Low to high. Default 2…10, J, Q, K, A. */
  ranks?: Rank[];
  /** A fixed trump suit, or "declared" to use the suit chosen by declareTrump. */
  trump?: Suit | 'declared';
}

export interface OptionDef {
  label: string;
  type: 'boolean' | 'choice';
  values?: OptionValue[];
  default: OptionValue;
}

export interface ZoneDef {
  /** One instance per player or per team; omit (or `shared: true`) for a single shared zone. */
  per?: 'player' | 'team';
  shared?: boolean;
  visibility: Visibility;
  /** For `none` zones: show how many cards are there. */
  countVisible?: boolean;
  /** The zone holds melds (groups of cards) instead of a single pile. */
  melds?: boolean;
}

export interface SetupDef {
  /** Default true. */
  shuffle?: boolean;
  /** `count` may be an expression, e.g. for hand sizes that change by round. */
  deal: { to: string; count: number | Expr };
  /** Zone that receives undealt cards. Without it they stay out of play. */
  rest?: string;
  flip?: FlipDef;
  /** Default "left". */
  dealerRotation?: 'left' | 'right' | 'none';
}

export interface FlipDef {
  from: string;
  to: string;
  /** Only `false` is supported: the flipped card's play effects don't run. */
  triggerEffects?: boolean;
  /** Custom values to set, with `card` meaning the flipped card. */
  set?: Record<string, Expr | number | boolean>;
}

export type OrderDef = 'leftOfDealer' | 'clockwise' | 'counterclockwise' | 'dealer';

export interface LeaderDef {
  first?: 'leftOfDealer' | 'dealer';
  then?: 'lastTrickWinner';
}

export interface TurnStepDef {
  actions: ActionDef[];
  optional?: boolean;
  repeatable?: boolean;
}

export interface PhaseDef {
  name: string;
  /** Skip this phase when false (checked when the phase would start). */
  if?: Expr;
  order?: OrderDef;
  /** Every active player takes this many turns, then the phase ends. */
  rounds?: number;
  /** Trick phases: number of tricks. */
  repeat?: number;
  /** Checked after every move; the phase ends when true. */
  until?: Expr;
  leader?: LeaderDef;
  /** A turn is exactly one of these moves. */
  actions?: ActionDef[];
  /** Or: a turn is these steps, in order. */
  turn?: TurnStepDef[];
  afterTrick?: EffectDef[];
  whenEmpty?: Record<string, WhenEmptyPolicy>;
}

export type WhenEmptyPolicy = 'reshuffleDiscardExceptTop' | 'endRound';

interface ActionCommon {
  if?: Expr;
  effects?: EffectDef[];
}

export type PassDirection = 'left' | 'right' | 'across' | 'rotate';
export type BidValues = { range: [number, number] } | (number | string)[];

export type PlayAction = ActionCommon & { type: 'play'; to: string; from?: string };
export type PlayToTrickAction = ActionCommon & {
  type: 'playToTrick';
  /** Zone the trick is played into. Default "trick". */
  to?: string;
  /** Default true. */
  followSuit?: boolean;
  leadRestriction?: { cannotLead: Suit; unless?: Expr };
};
export type DrawAction = ActionCommon & {
  type: 'draw';
  from: string;
  /** Default "hand". */
  to?: string;
  count?: number;
  then?: 'mayPlayDrawnCard';
};
export type DiscardAction = ActionCommon & { type: 'discard'; to: string; from?: string };
export type PassAction = ActionCommon & {
  type: 'pass';
  count: number;
  direction: PassDirection;
  from?: string;
};
export type MeldAction = ActionCommon & {
  type: 'meld';
  to: string;
  kinds?: ('set' | 'run')[];
  minSize?: number;
  from?: string;
};
export type LayOffAction = ActionCommon & { type: 'layOff'; to: string; from?: string };
export type PickUpPileAction = ActionCommon & { type: 'pickUpPile'; from: string; to?: string };
export type BidAction = ActionCommon & { type: 'bid'; values: BidValues };
export type PassBidAction = ActionCommon & { type: 'passBid' };
export type DeclareTrumpAction = ActionCommon & { type: 'declareTrump'; suits?: Suit[] };

export type ActionDef =
  | PlayAction
  | PlayToTrickAction
  | DrawAction
  | DiscardAction
  | PassAction
  | MeldAction
  | LayOffAction
  | PickUpPileAction
  | BidAction
  | PassBidAction
  | DeclareTrumpAction;

/**
 * One effect: the engine doing something that isn't a player's choice.
 * Exactly one of the verbs (set/choose, resolveTrick, moveTrick, nextPlayer,
 * skip, reverse, winnerLeads, breakSuit) should be present.
 */
export interface EffectDef {
  if?: Expr;
  /** "state.x" sets true; { "state.x": "expr" } sets values. With `choose`, where to store the choice. */
  set?: string | Record<string, Expr | number | boolean>;
  choose?: 'suit';
  resolveTrick?: TrickRule;
  moveTrick?: string;
  of?: 'winner' | 'winnerTeam';
  nextPlayer?: { draw?: number; from?: string; skip?: boolean };
  skip?: boolean;
  reverse?: boolean;
  winnerLeads?: boolean;
  breakSuit?: Suit;
}

export interface ScoreRuleDef {
  if?: Expr;
  add?: Expr | number;
  /** Named counters that last across rounds, e.g. { "bags": "team.tricks - team.bid" }. */
  track?: Record<string, Expr | number>;
  /** perPlayer only: send `track` to the team instead of the player. Scores always go to the team. */
  to?: 'team' | 'player';
}

export interface ScoringDef {
  perTeam?: ScoreRuleDef[];
  perPlayer?: ScoreRuleDef[];
  /** Points per rank for `cardValue`, e.g. { "A": 15, "default": "rankNumber" }. */
  cardValue?: Record<string, number | 'rankNumber'>;
}

export interface EndConditionDef {
  when: Expr;
  winner: 'highestScore' | 'lowestScore' | 'lastActivePlayer';
  /** Default "playOn": keep playing rounds until there's a single winner. */
  ties?: 'playOn' | 'share';
}
