import { ExprError } from '../errors';
import { type Token, tokenize } from './lexer';

export type BinaryOp =
  '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | '+' | '-' | '*' | '/' | '%';

export type Node =
  | { kind: 'lit'; value: null | boolean | number | string }
  | { kind: 'array'; items: Node[] }
  | { kind: 'name'; name: string }
  | { kind: 'member'; object: Node; name: string }
  | { kind: 'call'; callee: Node; args: Node[] }
  | { kind: 'unary'; op: '!' | '-'; arg: Node }
  | { kind: 'binary'; op: BinaryOp; left: Node; right: Node }
  | { kind: 'cond'; test: Node; then: Node; else: Node };

export const MAX_LENGTH = 1000;
export const MAX_DEPTH = 40;

// How tightly each infix operator binds; higher binds tighter.
const INFIX_POWER: Record<string, number> = {
  '?': 1,
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  in: 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
};
const PREFIX_POWER = 8;

const LITERAL_NAMES: Record<string, boolean | null> = { true: true, false: false, null: null };

/** Parses an expression into a syntax tree. Throws ExprError with a readable message. */
export function parse(source: string): Node {
  if (source.length > MAX_LENGTH) {
    throw new ExprError(`Expression is longer than ${MAX_LENGTH} characters`, source);
  }
  const tokens = tokenize(source);
  let pos = 0;
  let depth = 0;

  const peek = (): Token => tokens[pos] as Token;
  const next = (): Token => tokens[pos++] as Token;
  const isOp = (token: Token, value: string) => token.type === 'op' && token.value === value;
  const describe = (token: Token) =>
    token.type === 'eof' ? 'end of expression' : `"${String(token.value)}"`;

  function expectOp(value: string): void {
    const token = next();
    if (!isOp(token, value)) {
      throw new ExprError(`Expected "${value}" but found ${describe(token)}`, source);
    }
  }

  function infixOp(token: Token): string | null {
    if (token.type === 'op' && Object.hasOwn(INFIX_POWER, token.value)) return token.value;
    if (token.type === 'name' && token.value === 'in') return 'in';
    return null;
  }

  function parseList(close: string): Node[] {
    const items: Node[] = [];
    if (isOp(peek(), close)) {
      next();
      return items;
    }
    for (;;) {
      items.push(parseExpr(0));
      const token = next();
      if (isOp(token, close)) return items;
      if (!isOp(token, ',')) {
        throw new ExprError(`Expected "," or "${close}" but found ${describe(token)}`, source);
      }
    }
  }

  function parsePrefix(): Node {
    const token = next();
    switch (token.type) {
      case 'num':
        return { kind: 'lit', value: token.value };
      case 'str':
        return { kind: 'lit', value: token.value };
      case 'name':
        if (Object.hasOwn(LITERAL_NAMES, token.value)) {
          return { kind: 'lit', value: LITERAL_NAMES[token.value] ?? null };
        }
        if (token.value === 'in') break;
        return { kind: 'name', name: token.value };
      case 'op':
        if (token.value === '(') {
          const inner = parseExpr(0);
          expectOp(')');
          return inner;
        }
        if (token.value === '[') return { kind: 'array', items: parseList(']') };
        if (token.value === '!' || token.value === '-') {
          return { kind: 'unary', op: token.value, arg: parseExpr(PREFIX_POWER) };
        }
        break;
      case 'eof':
        break;
    }
    throw new ExprError(`Unexpected ${describe(token)}`, source);
  }

  function parsePostfix(left: Node): Node {
    for (;;) {
      const token = peek();
      if (isOp(token, '.')) {
        next();
        const name = next();
        if (name.type !== 'name') {
          throw new ExprError(`Expected a property name after "."`, source);
        }
        left = { kind: 'member', object: left, name: name.value };
      } else if (isOp(token, '(')) {
        if (left.kind !== 'name' && left.kind !== 'member') {
          throw new ExprError('Only named functions can be called', source);
        }
        next();
        left = { kind: 'call', callee: left, args: parseList(')') };
      } else {
        return left;
      }
    }
  }

  function parseExpr(minPower: number): Node {
    if (++depth > MAX_DEPTH) {
      throw new ExprError(`Expression is nested more than ${MAX_DEPTH} levels deep`, source);
    }
    let left = parsePostfix(parsePrefix());
    for (;;) {
      const op = infixOp(peek());
      if (op === null) break;
      const power = INFIX_POWER[op] as number;
      if (power <= minPower) break;
      next();
      if (op === '?') {
        const then = parseExpr(0);
        expectOp(':');
        // Right-associative: a ? b : c ? d : e
        left = { kind: 'cond', test: left, then, else: parseExpr(power - 1) };
      } else {
        left = { kind: 'binary', op: op as BinaryOp, left, right: parseExpr(power) };
      }
    }
    depth--;
    return left;
  }

  const ast = parseExpr(0);
  const rest = peek();
  if (rest.type !== 'eof') throw new ExprError(`Unexpected ${describe(rest)}`, source);
  return ast;
}
