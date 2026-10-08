import { createScanner, findNodeAtLocation, getLocation, parse, parseTree, printParseErrorCode, type Node, type ParseError, type ParseOptions } from 'jsonc-parser';
import type { JsonPath } from './path';

export interface JsonError {
  message: string;
  offset: number;
  length: number;
}

export interface ParseResult {
  value: unknown;
  errors: JsonError[];
}

const OPTIONS: ParseOptions = { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true };
const STRICT: ParseOptions = { allowTrailingComma: false, disallowComments: true, allowEmptyContent: true };

const MESSAGES: Record<string, string> = {
  InvalidSymbol: 'Invalid symbol (unquoted key or value, single quotes, or a bare word?)',
  InvalidNumberFormat: 'Invalid number format',
  PropertyNameExpected: 'Property name expected (keys must be double-quoted)',
  ValueExpected: 'Value expected',
  ColonExpected: 'Colon expected',
  CommaExpected: 'Comma expected',
  CloseBraceExpected: 'Closing brace } expected',
  CloseBracketExpected: 'Closing bracket ] expected',
  EndOfFileExpected: 'End of file expected (multiple root values?)',
  InvalidCommentToken: 'Comments are not allowed in JSON',
  UnexpectedEndOfComment: 'Unexpected end of comment',
  UnexpectedEndOfString: 'Unterminated string',
  UnexpectedEndOfNumber: 'Unexpected end of number',
  InvalidUnicode: 'Invalid unicode escape',
  InvalidEscapeCharacter: 'Invalid escape character',
  InvalidCharacter: 'Invalid character in string',
};

function toJsonErrors(errors: ParseError[]): JsonError[] {
  return errors.map((e) => {
    const code = printParseErrorCode(e.error);
    return { message: MESSAGES[code] ?? code, offset: e.offset, length: e.length };
  });
}

/**
 * Error-tolerant parse that always yields a best-effort value. `strict` (plain .json) also reports
 * comments and trailing commas; otherwise they are accepted as JSONC.
 */
export function parseJson(text: string, strict = false): ParseResult {
  const errors: ParseError[] = [];
  const value = parse(text, errors, strict ? STRICT : OPTIONS);
  return { value, errors: toJsonErrors(errors) };
}

/** Parse that throws on any syntax error. */
export function parseStrict(text: string): unknown {
  const { value, errors } = parseJson(text, false);
  if (errors.length) {
    const e = errors[0];
    const { line, column } = lineCol(text, e.offset);
    throw new Error(`${e.message} at line ${line}, column ${column}`);
  }
  return value;
}

export function lineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}

export function tree(text: string): Node | undefined {
  return parseTree(text, [], OPTIONS);
}

export function pathAtOffset(text: string, offset: number): JsonPath {
  const path = getLocation(text, offset).path;
  // Between properties getLocation reports an empty trailing key; that means "the enclosing object".
  return path.length && path[path.length - 1] === '' ? path.slice(0, -1) : path;
}

/** Returns the text range of the value at `path` (or of the property key when `key` is true). */
export function rangeAtPath(text: string, path: JsonPath, key = false): { offset: number; length: number } | undefined {
  const root = tree(text);
  if (!root) return undefined;
  const node = findNodeAtLocation(root, path);
  if (!node) return undefined;
  if (key && node.parent?.type === 'property' && node.parent.children?.[0]) {
    const k = node.parent.children[0];
    return { offset: k.offset, length: k.length };
  }
  return { offset: node.offset, length: node.length };
}

export function hasComments(text: string): boolean {
  const scanner = createScanner(text, false);
  // SyntaxKind is a const enum (not usable with isolatedModules): 12/13 = line/block comment, 17 = EOF.
  let kind: number;
  while ((kind = scanner.scan()) !== 17) {
    if (kind === 12 || kind === 13) return true;
  }
  return false;
}

export interface Stats {
  nodes: number;
  depth: number;
}

export function stats(value: unknown): Stats {
  let nodes = 0;
  let depth = 0;
  const walk = (v: unknown, d: number) => {
    nodes++;
    if (d > depth) depth = d;
    if (v && typeof v === 'object') for (const c of Object.values(v)) walk(c, d + 1);
  };
  walk(value, 0);
  return { nodes, depth };
}
