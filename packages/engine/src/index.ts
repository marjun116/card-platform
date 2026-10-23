// Public API of the rules engine.
export {
  applyMove,
  type ApplyOptions,
  createGame,
  dealNextRound,
  getLegalMoves,
  getScores,
  isBetweenRounds,
  isGameOver,
  playersToAct,
  replay,
  viewFor,
} from './api';

export * from './bots';
export * from './cards/card';
export { buildDeck, type DeckDef } from './cards/deck';
export type { TrickRule } from './cards/order';
export { randomInt, seedRng } from './rng';
export { ExprError, GameFileError, IllegalMoveError, SetupError } from './errors';
export type { BidValue, Move, MoveType, PlayerId, ZoneKey } from './game/move';
export type {
  CardEvent,
  GameState,
  MomentEvent,
  PlayerState,
  RoundResult,
  ScoreEvent,
  TeamState,
  VarValue,
} from './game/state';
export { teamsFor } from './game/setup';
export type * from './game/types';
export { gameFileSchema } from './schema/gameFile';
export {
  formatIssues,
  validate,
  type ValidationIssue,
  type ValidationResult,
} from './schema/validate';
export type { Scores } from './scoring';
export { replayRound, type RoundReplay } from './roundReplay';
export {
  bidLabelsOf,
  choiceLabelsOf,
  type OpenView,
  type PlayerView,
  type PublicMove,
  type TrickView,
  type ZoneView,
} from './view';
