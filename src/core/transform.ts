import { sortKeysDeep } from './format';

export type TransformId =
  | 'flatten'
  | 'unflatten'
  | 'removeNulls'
  | 'removeEmpty'
  | 'dedupe'
  | 'sortArrayByKey'
  | 'sortKeys'
  | 'stringify'
  | 'parseString'
  | 'decodeNested';

export const TRANSFORMS: { id: TransformId; label: string; detail: string; needsKey?: boolean }[] = [
  { id: 'flatten', label: 'Flatten', detail: 'Nested objects → { "a.b.c": value }' },
  { id: 'unflatten', label: 'Unflatten', detail: '{ "a.b.c": value } → nested objects' },
  { id: 'removeNulls', label: 'Remove nulls', detail: 'Drop null properties and array items (recursive)' },
  { id: 'removeEmpty', label: 'Remove empty', detail: 'Drop null, "", [] and {} (recursive)' },
  { id: 'dedupe', label: 'Dedupe arrays', detail: 'Remove deep-equal duplicates from every array' },
  { id: 'sortArrayByKey', label: 'Sort array by key…', detail: 'Sort an array of objects by a property', needsKey: true },
  { id: 'sortKeys', label: 'Sort keys', detail: 'Alphabetical keys (recursive)' },
  { id: 'stringify', label: 'Escape (stringify)', detail: 'Turn the value into a JSON string literal' },
  { id: 'parseString', label: 'Unescape (parse string)', detail: 'Parse a string that contains JSON' },
  { id: 'decodeNested', label: 'Decode embedded JSON', detail: 'Parse every string value that contains a JSON object/array (recursive)' },
];

export function applyTransform(id: TransformId, value: unknown, arg?: string): unknown {
  switch (id) {
    case 'flatten':
      return flatten(value);
    case 'unflatten':
      return unflatten(value);
    case 'removeNulls':
      return prune(value, (v) => v === null);
    case 'removeEmpty':
      return prune(value, isEmpty);
    case 'dedupe':
      return dedupe(value);
    case 'sortArrayByKey':
      return sortArrayByKey(value, arg ?? '');
    case 'sortKeys':
      return sortKeysDeep(value);
    case 'stringify':
      return JSON.stringify(value);
    case 'parseString':
      if (typeof value !== 'string') throw new Error('Selected value is not a string');
      return JSON.parse(value);
    case 'decodeNested':
      return decodeNested(value);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function flatten(value: unknown, sep = '.'): unknown {
  if (Array.isArray(value)) return value.map((v) => flatten(v, sep));
  if (!isObj(value)) return value;
  const out: Record<string, unknown> = {};
  const walk = (v: unknown, prefix: string) => {
    if (isObj(v) && Object.keys(v).length) for (const [k, c] of Object.entries(v)) walk(c, prefix ? `${prefix}${sep}${k}` : k);
    else out[prefix] = v;
  };
  walk(value, '');
  return out;
}

export function unflatten(value: unknown, sep = '.'): unknown {
  if (Array.isArray(value)) return value.map((v) => unflatten(v, sep));
  if (!isObj(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const parts = key.split(sep);
    let cur = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) cur[p] = v;
      else {
        if (!isObj(cur[p])) cur[p] = {};
        cur = cur[p] as Record<string, unknown>;
      }
    });
  }
  return out;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);
}

function prune(value: unknown, drop: (v: unknown) => boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => prune(v, drop)).filter((v) => !drop(v));
  if (isObj(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const p = prune(v, drop);
      if (!drop(p)) out[k] = p;
    }
    return out;
  }
  return value;
}

function canonical(v: unknown): string {
  return JSON.stringify(sortKeysDeep(v));
}

function dedupe(value: unknown): unknown {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    return value.map(dedupe).filter((v) => {
      const k = canonical(v);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, dedupe(v)]));
  return value;
}

export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(typeof a === 'object' ? JSON.stringify(a) : a).localeCompare(String(typeof b === 'object' ? JSON.stringify(b) : b), undefined, { numeric: true });
}

function sortArrayByKey(value: unknown, key: string): unknown {
  if (!Array.isArray(value)) throw new Error('Selected value is not an array');
  const desc = key.startsWith('-');
  const k = desc ? key.slice(1) : key;
  const get = (v: unknown) => (isObj(v) ? k.split('.').reduce<unknown>((o, p) => (isObj(o) ? o[p] : undefined), v) : v);
  return [...value].sort((a, b) => compareValues(get(a), get(b)) * (desc ? -1 : 1));
}

function decodeNested(value: unknown): unknown {
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        return decodeNested(JSON.parse(t));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(decodeNested);
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeNested(v)]));
  return value;
}
