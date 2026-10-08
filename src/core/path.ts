export type Segment = string | number;
export type JsonPath = Segment[];

export type PathStyle = 'jsonpath' | 'js' | 'jq' | 'jmespath' | 'pointer';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const JMES_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function formatPath(path: JsonPath, style: PathStyle): string {
  switch (style) {
    case 'pointer':
      return path.map((s) => '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
    case 'jsonpath':
      return '$' + path.map((s) => (typeof s === 'number' ? `[${s}]` : IDENT.test(s) ? `.${s}` : `['${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`)).join('');
    case 'js':
      return 'data' + path.map((s) => (typeof s === 'number' ? `[${s}]` : IDENT.test(s) ? `.${s}` : `[${JSON.stringify(s)}]`)).join('');
    case 'jq': {
      const p = path.map((s) => (typeof s === 'number' ? `[${s}]` : IDENT.test(s) ? `.${s}` : `[${JSON.stringify(s)}]`)).join('');
      return p.startsWith('.') ? p : '.' + p;
    }
    case 'jmespath': {
      let out = '';
      for (const s of path) {
        if (typeof s === 'number') out += `[${s}]`;
        else out += (out ? '.' : '') + (JMES_IDENT.test(s) ? s : JSON.stringify(s));
      }
      return out || '@';
    }
  }
}

/** Parses an RFC 6901 JSON Pointer (e.g. ajv's instancePath) into a path. */
export function parsePointer(pointer: string, root?: unknown): JsonPath {
  if (!pointer) return [];
  const raw = pointer.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  // Resolve numeric segments against the actual data so object keys like "0" stay strings.
  const out: JsonPath = [];
  let cur: unknown = root;
  for (const s of raw) {
    const isIndex = Array.isArray(cur) ? /^\d+$/.test(s) : root === undefined && /^\d+$/.test(s);
    const seg: Segment = isIndex ? Number(s) : s;
    out.push(seg);
    cur = cur !== null && typeof cur === 'object' ? (cur as Record<string, unknown>)[s] : undefined;
  }
  return out;
}

export function getAtPath(value: unknown, path: JsonPath): unknown {
  let cur = value;
  for (const s of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[s];
  }
  return cur;
}

export function pathKey(path: JsonPath): string {
  return JSON.stringify(path);
}

export function isPrefix(prefix: JsonPath, path: JsonPath): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((s, i) => s === path[i]);
}
