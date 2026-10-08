/**
 * The action library: for each action type, which moves it allows and what a
 * move does. The action's effects run afterwards (see game/flow.ts).
 */
import type { Move, PlayerId } from '../game/move';
import type { GameState } from '../game/state';
import type { ActionDef } from '../game/types';
import * as bidding from './bidding';
import * as cardMovement from './cardMovement';
import type { ActionResult } from './common';
import * as trick from './trick';

export { type ActionResult, allowsCard } from './common';

export function actionMoves(state: GameState, player: PlayerId, action: ActionDef): Move[] {
  switch (action.type) {
    case 'play':
    case 'discard':
      return cardMovement.playMoves(state, player, action);
    case 'draw':
      return cardMovement.drawMoves(state, player, action);
    case 'pickUpPile':
      return cardMovement.pickUpMoves(state, player, action);
    case 'pass':
      return cardMovement.passMoves(state, player, action);
    case 'meld':
      return cardMovement.meldMoves(state, player, action);
    case 'layOff':
      return cardMovement.layOffMoves(state, player, action);
    case 'playToTrick':
      return trick.playToTrickMoves(state, player, action);
    case 'bid':
      return bidding.bidMoves(state, player, action);
    case 'passBid':
      return bidding.passBidMoves(state, player, action);
    case 'declareTrump':
      return bidding.declareTrumpMoves(state, player, action);
    case 'choose':
      return bidding.chooseMoves(state, player, action);
  }
}

/** Carries out a legal move on a draft state. */
export function applyAction(state: GameState, move: Move, action: ActionDef): ActionResult {
  switch (action.type) {
    case 'play':
    case 'discard':
      return cardMovement.applyPlay(state, move, action);
    case 'draw':
      return cardMovement.applyDraw(state, move, action);
    case 'pickUpPile':
      return cardMovement.applyPickUp(state, move, action);
    case 'pass':
      return cardMovement.applyPass(state, move, action);
    case 'meld':
      return cardMovement.applyMeld(state, move, action);
    case 'layOff':
      return cardMovement.applyLayOff(state, move, action);
    case 'playToTrick':
      return trick.applyPlayToTrick(state, move);
    case 'bid':
    case 'passBid':
    case 'declareTrump':
      return bidding.applyBid(state, move);
    case 'choose':
      return bidding.applyChoose(state, move, action);
  }
}
