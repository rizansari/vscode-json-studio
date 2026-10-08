import type { JsonPath } from '../path';
import type { Match, TextOptions } from './types';

export function buildMatcher(query: string, opts: TextOptions): (s: string) => boolean {
  let source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;
  const re = new RegExp(source, opts.caseSensitive ? '' : 'i');
  return (s) => re.test(s);
}

export function textSearch(data: unknown, query: string, opts: TextOptions, base: JsonPath = []): Match[] {
  const test = buildMatcher(query, opts);
  const matches: Match[] = [];
  const walk = (v: unknown, path: JsonPath) => {
    if (v !== null && typeof v === 'object') {
      const entries: [string | number, unknown][] = Array.isArray(v) ? v.map((c, i) => [i, c]) : Object.entries(v);
      for (const [k, c] of entries) {
        const childPath = [...path, k];
        if (opts.scope !== 'values' && typeof k === 'string' && test(k)) matches.push({ path: childPath, value: c });
        else if (opts.scope !== 'keys' && (c === null || typeof c !== 'object') && test(String(c))) matches.push({ path: childPath, value: c });
        walk(c, childPath);
      }
    } else if (path.length === base.length && opts.scope !== 'keys' && test(String(v))) {
      matches.push({ path, value: v });
    }
  };
  walk(data, base);
  return matches;
}
