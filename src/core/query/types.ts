import type { JsonPath } from '../path';

export type QueryMode = 'text' | 'jsonpath' | 'jmespath' | 'jq';

export interface TextOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  scope: 'keys' | 'values' | 'both';
}

export interface Match {
  path: JsonPath;
  value: unknown;
}

export interface QueryRequest {
  mode: QueryMode;
  query: string;
  /** Path the query is evaluated against (empty = document root). */
  scope?: JsonPath;
  text?: TextOptions;
}

export interface QueryResult {
  /** Matches with locations — only for modes that can point back into the document. */
  matches?: Match[];
  /** Projected result, ready to export. */
  output: unknown;
  count: number;
  ms: number;
}

export const DEFAULT_TEXT_OPTIONS: TextOptions = { regex: false, caseSensitive: false, wholeWord: false, scope: 'both' };
