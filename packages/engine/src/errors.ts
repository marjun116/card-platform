/** A player tried a move that isn't legal right now. */
export class IllegalMoveError extends Error {
  override name = 'IllegalMoveError';
}

/** The game file asks for something the engine can't do or doesn't understand. */
export class GameFileError extends Error {
  override name = 'GameFileError';
}

/** An expression in the game file couldn't be parsed or evaluated. */
export class ExprError extends GameFileError {
  override name = 'ExprError';

  constructor(
    message: string,
    readonly source?: string,
  ) {
    super(source === undefined ? message : `${message} in "${source}"`);
  }
}
