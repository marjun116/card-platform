// Public API of the rules engine.
export {
  applyMove,
  createGame,
  getLegalMoves,
  getScores,
  isGameOver,
  playersToAct,
  replay,
  viewFor,
} from './api';

export * from './cards/card';
export { buildDeck, type DeckDef } from './cards/deck';
export type { TrickRule } from './cards/order';
export { ExprError, GameFileError, IllegalMoveError, SetupError } from './errors';
export type { BidValue, Move, MoveType, PlayerId, ZoneKey } from './game/move';
export type {
  GameState,
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
export {
  bidLabelsOf,
  choiceLabelsOf,
  type PlayerView,
  type PublicMove,
  type TrickView,
  type ZoneView,
} from './view';
