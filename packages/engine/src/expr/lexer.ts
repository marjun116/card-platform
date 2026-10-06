import { ExprError } from '../errors';

export type Token =
  | { type: 'num'; value: number; pos: number }
  | { type: 'str'; value: string; pos: number }
  | { type: 'name'; value: string; pos: number }
  | { type: 'op'; value: string; pos: number }
  | { type: 'eof'; pos: number };

const TWO_CHAR_OPS = ['<=', '>=', '==', '!=', '&&', '||'];
const ONE_CHAR_OPS = '()[],.?:!-+*/%<>';

/** Splits an expression into tokens. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;

    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9]/.test(ch)) {
      const match = /^[0-9]+(\.[0-9]+)?/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ type: 'num', value: Number(match[0]), pos: i });
      i += match[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ type: 'name', value: match[0], pos: i });
      i += match[0].length;
    } else if (ch === '"' || ch === "'") {
      const start = i;
      let value = '';
      i++;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\' && i + 1 < source.length) i++;
        value += source[i];
        i++;
      }
      if (i >= source.length) throw new ExprError('Unclosed string', source);
      i++;
      tokens.push({ type: 'str', value, pos: start });
    } else if (TWO_CHAR_OPS.includes(source.slice(i, i + 2))) {
      tokens.push({ type: 'op', value: source.slice(i, i + 2), pos: i });
      i += 2;
    } else if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i });
      i++;
    } else if (ch === '=') {
      throw new ExprError('Use == to compare values (a single = is not allowed)', source);
    } else {
      throw new ExprError(`Unexpected character "${ch}"`, source);
    }
  }
  tokens.push({ type: 'eof', pos: source.length });
  return tokens;
}
