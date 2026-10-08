import { create } from 'jsondiffpatch';
import { format as toJsonPatchOps } from 'jsondiffpatch/formatters/jsonpatch';
import { sortKeysDeep } from './format';
import type { JsonPath } from './path';

export interface Change {
  kind: 'added' | 'removed' | 'changed';
  path: JsonPath;
  before?: unknown;
  after?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function idOf(v: unknown, idKey: string): string | undefined {
  if (!idKey || !isObj(v) || !(idKey in v)) return undefined;
  return JSON.stringify(v[idKey]);
}

/** True when every item of both arrays is an object carrying `idKey`. */
function matchableById(a: unknown[], b: unknown[], idKey: string): boolean {
  return !!idKey && a.length + b.length > 0 && [...a, ...b].every((v) => idOf(v, idKey) !== undefined);
}

/** Semantic diff: key order never matters; arrays of objects are matched by `idKey` when every item has one. */
export function semanticDiff(a: unknown, b: unknown, idKey = 'id'): Change[] {
  const changes: Change[] = [];
  const walk = (x: unknown, y: unknown, path: JsonPath) => {
    if (isObj(x) && isObj(y)) {
      for (const k of Object.keys(x)) {
        if (!(k in y)) changes.push({ kind: 'removed', path: [...path, k], before: x[k] });
        else walk(x[k], y[k], [...path, k]);
      }
      for (const k of Object.keys(y)) if (!(k in x)) changes.push({ kind: 'added', path: [...path, k], after: y[k] });
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (matchableById(x, y, idKey)) {
        const byId = new Map(y.map((v, i) => [idOf(v, idKey)!, i]));
        const seen = new Set<string>();
        x.forEach((v, i) => {
          const id = idOf(v, idKey)!;
          const j = byId.get(id);
          if (j === undefined) changes.push({ kind: 'removed', path: [...path, i], before: v });
          else {
            seen.add(id);
            walk(v, y[j], [...path, j]);
          }
        });
        y.forEach((v, j) => {
          if (!seen.has(idOf(v, idKey)!)) changes.push({ kind: 'added', path: [...path, j], after: v });
        });
        return;
      }
      const n = Math.max(x.length, y.length);
      for (let i = 0; i < n; i++) {
        if (i >= y.length) changes.push({ kind: 'removed', path: [...path, i], before: x[i] });
        else if (i >= x.length) changes.push({ kind: 'added', path: [...path, i], after: y[i] });
        else walk(x[i], y[i], [...path, i]);
      }
      return;
    }
    if (JSON.stringify(x) !== JSON.stringify(y)) changes.push({ kind: 'changed', path, before: x, after: y });
  };
  walk(a, b, []);
  return changes;
}

/** Canonical text for side-by-side diffing: sorted keys, id-matched arrays sorted by id. */
export function normalizeForDiff(value: unknown, idKey = 'id'): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const items = v.map(norm);
      if (matchableById(items, [], idKey)) items.sort((p, q) => idOf(p, idKey)!.localeCompare(idOf(q, idKey)!, undefined, { numeric: true }));
      return items;
    }
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, c]) => [k, norm(c)]));
    return v;
  };
  return JSON.stringify(sortKeysDeep(norm(value)), null, 2) + '\n';
}

/** RFC 6902 JSON Patch that turns `a` into `b`. */
export function jsonPatch(a: unknown, b: unknown, idKey = 'id'): unknown[] {
  const differ = create({
    objectHash: (o: object, i?: number) => idOf(o, idKey) ?? `$$index:${i}`,
    arrays: { detectMove: true },
  });
  const delta = differ.diff(a, b);
  return delta ? (toJsonPatchOps(delta) as unknown[]) : [];
}
