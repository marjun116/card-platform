import { ExprError } from '../errors';
import { type BinaryOp, type Node, parse } from './parser';

/**
 * Values an expression can produce or read. Objects and functions only ever
 * come from the engine (via the scope); a game file can't create them.
 */
export type Value = null | boolean | number | string | readonly Value[] | ExprObject | ExprFunction;
export type ExprFunction = (...args: Value[]) => Value;
export interface ExprObject {
  readonly [key: string]: Value;
}

/**
 * Engine objects (player, team, zones, …) answer property reads through a
 * single function stored under this symbol, so nothing is computed until an
 * expression reads it. The function returns undefined for unknown names.
 */
const GET = Symbol('get');
type Getter = (name: string) => Value | undefined;

export function lookupObject(get: Getter): ExprObject {
  return { [GET]: get };
}

/** An object whose missing properties read as null. Used for `state`, whose values start unset. */
export function openObject(values: Readonly<Record<string, Value>>): ExprObject {
  return lookupObject((name) => (Object.hasOwn(values, name) ? values[name] : null));
}

/** Reads a property the way an expression would; undefined if it doesn't exist. */
export function getProperty(object: ExprObject, name: string): Value | undefined {
  const get = (object as { [GET]?: Getter })[GET];
  if (get) return get(name);
  return Object.hasOwn(object, name) ? object[name] : undefined;
}

export const QUANTIFIERS = ['anyPlayer', 'everyPlayer', 'anyTeam', 'everyTeam'] as const;
export type Quantifier = (typeof QUANTIFIERS)[number];

export interface Scope {
  /**
   * The value of a name (player, hand, card, state, options, …), or
   * undefined if the name doesn't exist. Values are computed only when an
   * expression actually uses them.
   */
  readonly lookup: (name: string) => Value | undefined;
  /** Objects that anyPlayer/everyPlayer range over (active players). */
  readonly players?: () => readonly ExprObject[];
  /** Objects that anyTeam/everyTeam range over. */
  readonly teams?: () => readonly ExprObject[];
}

/** A scope backed by a fixed set of names. */
export function scopeOf(
  names: Readonly<Record<string, Value>>,
  extra: Omit<Scope, 'lookup'> = {},
): Scope {
  return { ...extra, lookup: (name) => (Object.hasOwn(names, name) ? names[name] : undefined) };
}

export interface Compiled {
  readonly source: string;
  readonly ast: Node;
  readonly quantifier: Quantifier | null;
}

// Parsing is pure, so each distinct expression is only parsed once.
const cache = new Map<string, Compiled>();

export function compile(source: string): Compiled {
  const cached = cache.get(source);
  if (cached) return cached;
  const ast = parse(source);
  const found = new Set<Quantifier>();
  walk(ast, (node) => {
    if (node.kind === 'name' && (QUANTIFIERS as readonly string[]).includes(node.name)) {
      found.add(node.name as Quantifier);
    }
  });
  if (found.size > 1) {
    throw new ExprError(`Use only one of ${[...found].join(', ')} per expression`, source);
  }
  const compiled: Compiled = { source, ast, quantifier: [...found][0] ?? null };
  cache.set(source, compiled);
  return compiled;
}

/** Visits every node of an expression tree. */
export function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  switch (node.kind) {
    case 'array':
      node.items.forEach((item) => walk(item, visit));
      break;
    case 'member':
      walk(node.object, visit);
      break;
    case 'call':
      walk(node.callee, visit);
      node.args.forEach((arg) => walk(arg, visit));
      break;
    case 'unary':
      walk(node.arg, visit);
      break;
    case 'binary':
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case 'cond':
      walk(node.test, visit);
      walk(node.then, visit);
      walk(node.else, visit);
      break;
    default:
      break;
  }
}

/** Evaluates an expression (string or compiled) against a scope. */
export function evaluate(expr: string | Compiled, scope: Scope): Value {
  const compiled = typeof expr === 'string' ? compile(expr) : expr;
  const q = compiled.quantifier;
  if (q === null) return new Evaluator(compiled.source, scope.lookup).run(compiled.ast);

  const subjects = (q.endsWith('Player') ? scope.players : scope.teams)?.() ?? [];
  const holds = (subject: ExprObject) => {
    const lookup = (name: string) => (name === q ? subject : scope.lookup(name));
    const result = new Evaluator(compiled.source, lookup).run(compiled.ast);
    return asBool(result, compiled.source, `an expression using ${q}`);
  };
  return q.startsWith('any') ? subjects.some(holds) : subjects.every(holds);
}

/** Evaluates and requires a true/false answer (null counts as false). */
export function evaluateCondition(expr: string | Compiled, scope: Scope): boolean {
  const compiled = typeof expr === 'string' ? compile(expr) : expr;
  return asBool(evaluate(compiled, scope), compiled.source, 'a condition');
}

/** Evaluates and requires a number. */
export function evaluateNumber(expr: string | number | Compiled, scope: Scope): number {
  if (typeof expr === 'number') return expr;
  const compiled = typeof expr === 'string' ? compile(expr) : expr;
  const value = evaluate(compiled, scope);
  if (typeof value !== 'number') {
    throw new ExprError(`Expected a number but got ${typeName(value)}`, compiled.source);
  }
  return value;
}

function asBool(value: Value, source: string, what: string): boolean {
  if (value === null) return false;
  if (typeof value !== 'boolean') {
    throw new ExprError(`Expected true/false for ${what} but got ${typeName(value)}`, source);
  }
  return value;
}

export function typeName(value: Value): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'object') return 'an object';
  return `${typeof value} ${JSON.stringify(value)}`;
}

export function isList(value: Value): value is readonly Value[] {
  return Array.isArray(value);
}

export function isObject(value: Value): value is ExprObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Equality: same type and same value. Objects with an `id` (cards) compare by id. */
export function valuesEqual(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (isList(a) && isList(b)) {
    return a.length === b.length && a.every((item, i) => valuesEqual(item, b[i] as Value));
  }
  if (isObject(a) && isObject(b)) {
    const id = getProperty(a, 'id');
    return typeof id === 'string' && id === getProperty(b, 'id');
  }
  return false;
}

class Evaluator {
  constructor(
    private readonly source: string,
    private readonly lookup: (name: string) => Value | undefined,
  ) {}

  private fail(message: string): never {
    throw new ExprError(message, this.source);
  }

  run(node: Node): Value {
    switch (node.kind) {
      case 'lit':
        return node.value;
      case 'array':
        return node.items.map((item) => this.run(item));
      case 'name': {
        const value = this.lookup(node.name);
        if (value === undefined) return this.fail(`Unknown name "${node.name}"`);
        return value;
      }
      case 'member':
        return this.member(this.run(node.object), node.name);
      case 'call':
        return this.call(node);
      case 'unary': {
        const arg = this.run(node.arg);
        if (node.op === '!') return !this.bool(arg, '!');
        return -this.num(arg, '-');
      }
      case 'binary':
        return this.binary(node.op, node.left, node.right);
      case 'cond':
        return this.bool(this.run(node.test), '?:') ? this.run(node.then) : this.run(node.else);
    }
  }

  private member(object: Value, name: string): Value {
    if (object === null) return null;
    if (isList(object)) {
      if (name === 'count') return object.length;
      return this.fail(`Lists only have a "count" property, not "${name}"`);
    }
    if (!isObject(object)) return this.fail(`Can't read "${name}" of ${typeName(object)}`);
    const value = getProperty(object, name);
    if (value === undefined) return this.fail(`Unknown property "${name}"`);
    return value;
  }

  private call(node: Extract<Node, { kind: 'call' }>): Value {
    const fn = this.run(node.callee);
    if (typeof fn !== 'function') {
      const name =
        node.callee.kind === 'name' || node.callee.kind === 'member' ? node.callee.name : '?';
      return this.fail(`"${name}" is not a function`);
    }
    return fn(...node.args.map((arg) => this.run(arg)));
  }

  private binary(op: BinaryOp, leftNode: Node, rightNode: Node): Value {
    // Logical operators short-circuit.
    if (op === '&&') {
      return this.bool(this.run(leftNode), op) && this.bool(this.run(rightNode), op);
    }
    if (op === '||') {
      return this.bool(this.run(leftNode), op) || this.bool(this.run(rightNode), op);
    }

    const left = this.run(leftNode);
    const right = this.run(rightNode);
    switch (op) {
      case '==':
        return valuesEqual(left, right);
      case '!=':
        return !valuesEqual(left, right);
      case 'in':
        if (!isList(right)) return this.fail(`"in" needs a list on the right`);
        return right.some((item) => valuesEqual(left, item));
      case '<':
        return this.num(left, op) < this.num(right, op);
      case '<=':
        return this.num(left, op) <= this.num(right, op);
      case '>':
        return this.num(left, op) > this.num(right, op);
      case '>=':
        return this.num(left, op) >= this.num(right, op);
      case '+':
        return this.num(left, op) + this.num(right, op);
      case '-':
        return this.num(left, op) - this.num(right, op);
      case '*':
        return this.num(left, op) * this.num(right, op);
      case '/':
      case '%': {
        const divisor = this.num(right, op);
        if (divisor === 0) return this.fail('Division by zero');
        return op === '/' ? this.num(left, op) / divisor : this.num(left, op) % divisor;
      }
    }
  }

  private bool(value: Value, op: string): boolean {
    if (value === null) return false;
    if (typeof value !== 'boolean') {
      return this.fail(`"${op}" needs true/false but got ${typeName(value)}`);
    }
    return value;
  }

  private num(value: Value, op: string): number {
    if (typeof value !== 'number') {
      return this.fail(`"${op}" needs numbers but got ${typeName(value)}`);
    }
    return value;
  }
}
