import jmespath from 'jmespath';
import { JSONPath } from 'jsonpath-plus';
import { getAtPath, parsePointer, type JsonPath } from '../path';
import { runJq } from './jq';
import { textSearch } from './text';
import { DEFAULT_TEXT_OPTIONS, type Match, type QueryRequest, type QueryResult } from './types';

export * from './types';

export async function runQuery(data: unknown, req: QueryRequest): Promise<QueryResult> {
  const start = Date.now();
  const base: JsonPath = req.scope ?? [];
  const target = getAtPath(data, base);
  let matches: Match[] | undefined;
  let output: unknown;

  switch (req.mode) {
    case 'text':
      matches = textSearch(target, req.query, req.text ?? DEFAULT_TEXT_OPTIONS, base);
      output = matches.map((m) => m.value);
      break;
    case 'jsonpath': {
      const results = JSONPath({ path: req.query, json: target as object, resultType: 'all', wrap: true, eval: 'safe' }) as { pointer: string; value: unknown }[];
      matches = results.map((r) => ({ path: [...base, ...parsePointer(r.pointer, target)], value: r.value }));
      output = matches.map((m) => m.value);
      break;
    }
    case 'jmespath':
      output = jmespath.search(target as object, req.query);
      break;
    case 'jq': {
      const outputs = await runJq(target, req.query);
      output = outputs.length === 1 ? outputs[0] : outputs;
      return { output, count: outputs.length, ms: Date.now() - start };
    }
  }

  const count = matches ? matches.length : Array.isArray(output) ? output.length : output === null || output === undefined ? 0 : 1;
  return { matches, output, count, ms: Date.now() - start };
}
