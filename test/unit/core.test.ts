import { describe, expect, it } from 'vitest';
import { generateTypes, inferSchema } from '../../src/core/codegen';
import { fromFormat, toFormat } from '../../src/core/convert';
import { jsonPatch, normalizeForDiff, semanticDiff } from '../../src/core/diff';
import { applyOps, minimalEdit } from '../../src/core/edit';
import { beautify, formattingOptions, minify, sortKeys } from '../../src/core/format';
import { hasComments, parseJson, pathAtOffset, rangeAtPath } from '../../src/core/parse';
import { formatPath, parsePointer } from '../../src/core/path';
import { runQuery } from '../../src/core/query';
import { bestEffortValue, needsRepair, repairJson } from '../../src/core/repair';
import { validate } from '../../src/core/schema';
import { applyTransform, flatten, unflatten } from '../../src/core/transform';

const data = {
  store: {
    book: [
      { id: 1, title: 'Sayings', author: 'Nigel', price: 8.95, tags: ['ref'] },
      { id: 2, title: 'Sword', author: 'Evelyn', price: 12.99, meta: { isbn: '0-553' } },
      { id: 3, title: 'Moby', author: 'Herman', price: 8.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
};

describe('path', () => {
  const p = ['store', 'book', 0, 'odd key'];
  it('formats in every style', () => {
    expect(formatPath(p, 'jsonpath')).toBe("$.store.book[0]['odd key']");
    expect(formatPath(p, 'js')).toBe('data.store.book[0]["odd key"]');
    expect(formatPath(p, 'jq')).toBe('.store.book[0]["odd key"]');
    expect(formatPath(p, 'jmespath')).toBe('store.book[0]."odd key"');
    expect(formatPath(p, 'pointer')).toBe('/store/book/0/odd key');
    expect(formatPath([], 'jq')).toBe('.');
  });
  it('parses pointers using the data to tell indexes from keys', () => {
    expect(parsePointer('/a/0/b~1c', { a: [{ 'b/c': 1 }] })).toEqual(['a', 0, 'b/c']);
    expect(parsePointer('/m/0', { m: { '0': 1 } })).toEqual(['m', '0']);
  });
});

describe('parse', () => {
  it('reports readable errors and tolerates comments', () => {
    expect(parseJson('{"a": 1, } // c').errors).toEqual([]);
    expect(parseJson('{"a": 1, } // c', true).errors.length).toBeGreaterThan(0);
    expect(parseJson('{a: 1}').errors[0].message).toMatch(/unquoted key/);
    expect(hasComments('{"url": "http://x"}')).toBe(false);
    expect(hasComments('{ // c\n"a":1}')).toBe(true);
  });
  it('maps offsets to paths and back', () => {
    const text = '{"a": {"b": [10, 20]}}';
    expect(pathAtOffset(text, text.indexOf('20'))).toEqual(['a', 'b', 1]);
    expect(rangeAtPath(text, ['a', 'b', 1])).toEqual({ offset: text.indexOf('20'), length: 2 });
    expect(rangeAtPath(text, ['a'], true)).toEqual({ offset: 1, length: 3 });
  });
});

describe('format', () => {
  it('beautifies while keeping comments', () => {
    expect(beautify('{"a":1,// keep\n"b":[1,2]}')).toBe('{\n  "a": 1, // keep\n  "b": [\n    1,\n    2\n  ]\n}\n');
  });
  it('minifies and sorts keys', () => {
    expect(minify('{ "b": 1, "a": [1, 2] }')).toBe('{"b":1,"a":[1,2]}');
    expect(sortKeys('{"b":{"z":1,"y":2},"a":0}', '2')).toBe('{\n  "a": 0,\n  "b": {\n    "y": 2,\n    "z": 1\n  }\n}\n');
  });
  it('throws on invalid input', () => {
    expect(() => beautify('{"a": }')).toThrow(/Value expected at line 1/);
  });
});

describe('repair', () => {
  const cases: [string, string, unknown][] = [
    ['trailing comma', '{"a": 1,}', { a: 1 }],
    ['single quotes + unquoted keys', "{a: 'x'}", { a: 'x' }],
    ['comments', '{"a": 1 /* c */, // d\n "b": 2}', { a: 1, b: 2 }],
    ['missing comma', '{"a": 1 "b": 2}', { a: 1, b: 2 }],
    ['missing brackets', '{"a": [1, 2', { a: [1, 2] }],
    ['python literals', '{"a": True, "b": None}', { a: true, b: null }],
    ['NDJSON', '{"a":1}\n{"a":2}', [{ a: 1 }, { a: 2 }]],
    ['JSONP', 'callback({"a":1});', { a: 1 }],
    ['markdown fence', '```json\n{"a":1}\n```', { a: 1 }],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(needsRepair(input)).toBe(true);
    expect(needsRepair(repairJson(input).text)).toBe(false);
    expect(JSON.parse(repairJson(input).text)).toEqual(expected);
  });
});

describe('bestEffortValue', () => {
  it('uses the JSONC parse when it succeeds and the repaired value otherwise', () => {
    expect(bestEffortValue('{"a": 1, // c\n}')).toEqual({ value: { a: 1 }, repaired: false });
    expect(bestEffortValue("{name: 'x', ok: True")).toEqual({ value: { name: 'x', ok: true }, repaired: true });
  });
});

describe('edit', () => {
  const fmt = formattingOptions('2');
  const text = '{\n  // owner\n  "name": "x",\n  "items": [1, 2]\n}\n';
  it('sets, inserts and removes while keeping comments', () => {
    const out = applyOps(text, [
      { kind: 'set', path: ['name'], value: 'y' },
      { kind: 'insert', path: ['items'], index: 2, value: 3 },
      { kind: 'remove', path: ['items', 0] },
      { kind: 'set', path: ['new'], value: { a: true } },
    ], fmt);
    expect(out).toContain('// owner');
    expect(parseJson(out).value).toEqual({ name: 'y', items: [2, 3], new: { a: true } });
  });
  it('renames keys in place and refuses duplicates', () => {
    const out = applyOps(text, [{ kind: 'renameKey', path: ['name'], newKey: 'title' }], fmt);
    expect(out).toBe(text.replace('"name"', '"title"'));
    expect(() => applyOps(text, [{ kind: 'renameKey', path: ['name'], newKey: 'items' }], fmt)).toThrow(/already exists/);
  });
  it('computes a minimal edit', () => {
    expect(minimalEdit('abcXdef', 'abcYYdef')).toEqual({ offset: 3, length: 1, content: 'YY' });
    expect(minimalEdit('same', 'same')).toBeUndefined();
  });
});

describe('query', () => {
  it('text search over keys and values with nested paths', async () => {
    const r = await runQuery(data, { mode: 'text', query: 'isbn', text: { regex: false, caseSensitive: false, wholeWord: false, scope: 'both' } });
    expect(r.matches?.map((m) => m.path)).toEqual([['store', 'book', 1, 'meta', 'isbn']]);
    const v = await runQuery(data, { mode: 'text', query: '^(sword|moby)$', text: { regex: true, caseSensitive: false, wholeWord: false, scope: 'values' } });
    expect(v.output).toEqual(['Sword', 'Moby']);
  });
  it('JSONPath nested filter returns locations', async () => {
    const r = await runQuery(data, { mode: 'jsonpath', query: '$..book[?(@.price < 10)].title' });
    expect(r.output).toEqual(['Sayings', 'Moby']);
    expect(r.matches?.[1].path).toEqual(['store', 'book', 2, 'title']);
  });
  it('JSONPath honours scope', async () => {
    const r = await runQuery(data, { mode: 'jsonpath', query: '$[*].id', scope: ['store', 'book'] });
    expect(r.matches?.[0].path).toEqual(['store', 'book', 0, 'id']);
  });
  it('JMESPath projection', async () => {
    const r = await runQuery(data, { mode: 'jmespath', query: 'store.book[?price > `10`].{t: title, a: author}' });
    expect(r.output).toEqual([{ t: 'Sword', a: 'Evelyn' }]);
  });
  it('jq with multiple outputs and errors', async () => {
    const r = await runQuery(data, { mode: 'jq', query: '.store.book[] | select(.price < 10) | .id' });
    expect(r.output).toEqual([1, 3]);
    const one = await runQuery(data, { mode: 'jq', query: '[.store.book[].price] | add' });
    expect(one.output).toBeCloseTo(30.93);
    await expect(runQuery(data, { mode: 'jq', query: '.[' })).rejects.toThrow(/syntax error/);
  });
});

describe('transform', () => {
  it('flatten / unflatten round-trip', () => {
    const v = { a: { b: { c: 1 } }, d: [1], e: {} };
    expect(flatten(v)).toEqual({ 'a.b.c': 1, d: [1], e: {} });
    expect(unflatten(flatten(v))).toEqual(v);
  });
  it('prunes, dedupes and sorts', () => {
    expect(applyTransform('removeNulls', { a: null, b: [1, null] })).toEqual({ b: [1] });
    expect(applyTransform('removeEmpty', { a: '', b: { c: [] }, d: 0 })).toEqual({ d: 0 });
    expect(applyTransform('dedupe', [{ a: 1, b: 2 }, { b: 2, a: 1 }, 3])).toEqual([{ a: 1, b: 2 }, 3]);
    expect(applyTransform('sortArrayByKey', [{ n: 10 }, { n: 2 }, {}], 'n')).toEqual([{ n: 2 }, { n: 10 }, {}]);
    expect(applyTransform('sortArrayByKey', [{ n: 10 }, { n: 2 }], '-n')).toEqual([{ n: 10 }, { n: 2 }]);
  });
  it('escapes and decodes embedded JSON', () => {
    expect(applyTransform('stringify', { a: 1 })).toBe('{"a":1}');
    expect(applyTransform('parseString', '{"a":1}')).toEqual({ a: 1 });
    expect(applyTransform('decodeNested', { p: '{"q":"[1,2]"}', s: '{not json}' })).toEqual({ p: { q: [1, 2] }, s: '{not json}' });
  });
});

describe('convert', () => {
  const rows = [{ id: 1, name: 'a', meta: { x: true } }, { id: 2, name: 'b, c' }];
  it('CSV round-trips nested columns', () => {
    const csv = toFormat(rows, 'csv');
    expect(csv.split('\n')[0]).toBe('id,name,meta.x');
    expect(fromFormat(csv, 'csv')).toEqual([{ id: 1, name: 'a', meta: { x: true } }, { id: 2, name: 'b, c', meta: { x: null } }]);
  });
  it.each(['yaml', 'toml', 'xml'] as const)('%s round-trips an object', (f) => {
    const v = { cfg: { name: 'x', port: 8080, on: true } };
    expect(fromFormat(toFormat(v, f), f)).toMatchObject(f === 'xml' ? { cfg: { name: 'x', port: 8080, on: true } } : v);
  });
});

describe('codegen', () => {
  it('generates TypeScript and a JSON Schema', async () => {
    const ts = await generateTypes(JSON.stringify(data), 'typescript');
    const schema = await inferSchema(JSON.stringify(data));
    expect(ts).toContain('export interface Root');
    expect(JSON.parse(schema).$schema).toMatch(/json-schema/);
  });
});

describe('schema', () => {
  const schema = {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, email: { type: 'string', format: 'email' } },
  };
  it('maps errors to paths', () => {
    const issues = validate({ tags: ['a', 1], extra: 1, email: 'nope' }, schema);
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: [], onKey: false, message: 'Missing required property "name"' },
        { path: ['extra'], onKey: true, message: 'Property "extra" is not allowed' },
        expect.objectContaining({ path: ['tags', 1] }),
        expect.objectContaining({ path: ['email'] }),
      ]),
    );
    expect(validate({ name: 'x' }, schema)).toEqual([]);
  });
});

describe('diff', () => {
  const a = { name: 'x', users: [{ id: 1, n: 'a' }, { id: 2, n: 'b' }], gone: 1 };
  const b = { users: [{ id: 2, n: 'B' }, { id: 3, n: 'c' }], name: 'x', added: true };
  it('ignores key order and matches array items by id', () => {
    const changes = semanticDiff(a, b, 'id');
    expect(changes).toEqual([
      { kind: 'removed', path: ['users', 0], before: { id: 1, n: 'a' } },
      { kind: 'changed', path: ['users', 0, 'n'], before: 'b', after: 'B' },
      { kind: 'added', path: ['users', 1], after: { id: 3, n: 'c' } },
      { kind: 'removed', path: ['gone'], before: 1 },
      { kind: 'added', path: ['added'], after: true },
    ]);
    expect(semanticDiff({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });
  it('normalizes for side-by-side view and emits a JSON Patch', () => {
    expect(normalizeForDiff({ b: [{ id: 2 }, { id: 1 }], a: 1 })).toBe(normalizeForDiff({ a: 1, b: [{ id: 1 }, { id: 2 }] }));
    const patch = jsonPatch(a, b) as { op: string; path: string }[];
    expect(patch.map((p) => p.op)).toEqual(expect.arrayContaining(['remove', 'add', 'replace']));
  });
});
