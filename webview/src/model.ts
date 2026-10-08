import { pathKey, type JsonPath, type Segment } from '../../src/core/path';

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export function typeOf(v: unknown): JsonType {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as JsonType;
}

export const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] => v !== null && typeof v === 'object';
export const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function entries(v: unknown): [Segment, unknown][] {
  if (Array.isArray(v)) return v.map((c, i) => [i, c]);
  if (isObj(v)) return Object.entries(v);
  return [];
}

export function childCount(v: unknown): number {
  return Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0;
}

/** Array whose items are (mostly) objects, or an object whose values are objects — renders well as a grid. */
export function isTabular(v: unknown): boolean {
  const items = Array.isArray(v) ? v : isObj(v) ? Object.values(v) : null;
  if (!items || items.length === 0) return false;
  const objects = items.filter(isObj).length;
  return Array.isArray(v) ? objects > 0 && objects >= items.length / 2 : objects === items.length;
}

/** Breadth-first search for the first tabular node (used as the default table). */
export function findFirstTabular(value: unknown, limit = 5000): JsonPath | null {
  const queue: [unknown, JsonPath][] = [[value, []]];
  let seen = 0;
  while (queue.length && seen++ < limit) {
    const [v, p] = queue.shift()!;
    if (Array.isArray(v) && isTabular(v)) return p;
    for (const [k, c] of entries(v)) if (isContainer(c)) queue.push([c, [...p, k]]);
  }
  return isTabular(value) ? [] : null;
}

export function preview(v: unknown, max = 120): string {
  if (typeof v === 'string') return JSON.stringify(v.length > max ? v.slice(0, max) + '…' : v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (isObj(v)) return `{${Object.keys(v).length}}`;
  return String(v);
}

export function compact(v: unknown, max = 200): string {
  const s = JSON.stringify(v);
  return s === undefined ? '' : s.length > max ? s.slice(0, max) + '…' : s;
}

/** Text shown in an inline editor: strings without quotes, everything else as JSON. */
export function editText(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v, null, isContainer(v) ? 2 : undefined) ?? '';
}

/** Interprets edited text, keeping the original type for strings so "123" stays a string. */
export function parseEdit(raw: string, previous: unknown): unknown {
  if (typeof previous === 'string') return raw;
  const t = raw.trim();
  if (t === '') return '';
  try {
    return JSON.parse(t);
  } catch {
    return raw;
  }
}

export function convertType(v: unknown, to: JsonType): unknown {
  switch (to) {
    case 'string':
      return typeof v === 'string' ? v : JSON.stringify(v);
    case 'number': {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    case 'boolean':
      return v === 'false' ? false : Boolean(v);
    case 'null':
      return null;
    case 'object':
      return isObj(v) ? v : {};
    case 'array':
      return Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
  }
}

export interface Row {
  path: JsonPath;
  key: string;
  segment: Segment | null;
  value: unknown;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  isMatch: boolean;
}

export interface FlattenOptions {
  expanded: Set<string>;
  /** When set, only matches, their ancestors and the subtrees under matches are shown. */
  filter?: { matches: Set<string>; ancestors: Set<string> } | null;
  matches?: Set<string>;
}

/** Visible rows of the tree, walking only into expanded nodes. */
export function visibleRows(root: unknown, opts: FlattenOptions): Row[] {
  const rows: Row[] = [];
  const { expanded, filter } = opts;
  const matchSet = opts.matches ?? filter?.matches;

  const walk = (value: unknown, path: JsonPath, segment: Segment | null, depth: number, underMatch: boolean) => {
    const key = pathKey(path);
    const isMatch = !!matchSet?.has(key);
    if (filter && !underMatch && !isMatch && !filter.ancestors.has(key)) return;
    const expandable = isContainer(value) && childCount(value) > 0;
    // While filtering, ancestors of matches open automatically.
    const isOpen = expandable && (expanded.has(key) || (!!filter && !underMatch && !isMatch && filter.ancestors.has(key)));
    rows.push({ path, key, segment, value, depth, expandable, expanded: isOpen, isMatch });
    if (isOpen) for (const [k, c] of entries(value)) walk(c, [...path, k], k, depth + 1, underMatch || isMatch);
  };
  walk(root, [], null, 0, false);
  return rows;
}

export function ancestorKeys(paths: JsonPath[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) for (let i = 0; i < p.length; i++) out.add(pathKey(p.slice(0, i)));
  return out;
}

/** Keys of every container down to `depth` levels (depth 0 = root only). */
export function expandToDepth(root: unknown, depth: number): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, path: JsonPath, d: number) => {
    if (!isContainer(v) || d > depth) return;
    out.add(pathKey(path));
    for (const [k, c] of entries(v)) walk(c, [...path, k], d + 1);
  };
  walk(root, [], 0);
  return out;
}

export function uniqueKey(obj: Record<string, unknown>, base = 'newKey'): string {
  if (!(base in obj)) return base;
  let i = 1;
  while (`${base}${i}` in obj) i++;
  return `${base}${i}`;
}
