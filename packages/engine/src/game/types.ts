/**
 * TypeScript types for game files, derived from the Zod schema in
 * schema/gameFile.ts so the two can never disagree. See docs/game-format.md
 * for what each part means.
 */
import type { z } from 'zod';
import type {
  actionSchema,
  cardOrderSchema,
  displaySchema,
  effectSchema,
  endConditionSchema,
  flipSchema,
  gameFileSchema,
  meldRulesSchema,
  metaSchema,
  momentSchema,
  optionSchema,
  optionValueSchema,
  phaseSchema,
  scoreRuleSchema,
  scoringSchema,
  seatsSchema,
  setupSchema,
  turnStepSchema,
  zoneSchema,
} from '../schema/gameFile';

/** An expression in the condition language, e.g. "hand.count == 0". */
export type Expr = string;

export type GameFile = z.infer<typeof gameFileSchema>;
export type MetaDef = z.infer<typeof metaSchema>;
export type CardOrderDef = z.infer<typeof cardOrderSchema>;
export type OptionDef = z.infer<typeof optionSchema>;
export type OptionValue = z.infer<typeof optionValueSchema>;
export type ZoneDef = z.infer<typeof zoneSchema>;
export type Visibility = ZoneDef['visibility'];
export type SetupDef = z.infer<typeof setupSchema>;
export type FlipDef = z.infer<typeof flipSchema>;
export type MeldRulesDef = z.infer<typeof meldRulesSchema>;
export type PhaseDef = z.infer<typeof phaseSchema>;
export type OrderDef = NonNullable<PhaseDef['order']>;
export type LeaderDef = NonNullable<PhaseDef['leader']>;
export type WhenEmptyPolicy = NonNullable<PhaseDef['whenEmpty']>[string];
export type TurnStepDef = z.infer<typeof turnStepSchema>;
export type EffectDef = z.infer<typeof effectSchema>;
export type ScoreRuleDef = z.infer<typeof scoreRuleSchema>;
export type ScoringDef = z.infer<typeof scoringSchema>;
export type EndConditionDef = z.infer<typeof endConditionSchema>;
export type DisplayDef = z.infer<typeof displaySchema>;
export type SeatsDef = z.infer<typeof seatsSchema>;
export type MomentDef = z.infer<typeof momentSchema>;

export type ActionDef = z.infer<typeof actionSchema>;
type Action<T extends ActionDef['type']> = Extract<ActionDef, { type: T }>;
export type PlayAction = Action<'play'>;
export type PlayToTrickAction = Action<'playToTrick'>;
export type DrawAction = Action<'draw'>;
export type DiscardAction = Action<'discard'>;
export type PassAction = Action<'pass'>;
export type MeldAction = Action<'meld'>;
export type LayOffAction = Action<'layOff'>;
export type PickUpPileAction = Action<'pickUpPile'>;
export type BidAction = Action<'bid'>;
export type PassBidAction = Action<'passBid'>;
export type DeclareTrumpAction = Action<'declareTrump'>;
export type ChooseAction = Action<'choose'>;
export type ShowHandAction = Action<'showHand'>;
export type PlayRestriction = NonNullable<PlayToTrickAction['restrictions']>[number];
export type PassDirection = PassAction['direction'];
export type BidValues = BidAction['values'];
