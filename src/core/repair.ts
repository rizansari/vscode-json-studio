import { jsonrepair } from 'jsonrepair';
import { stringify, type IndentSetting } from './format';
import { parseJson } from './parse';

export interface RepairResult {
  text: string;
  changed: boolean;
}

/**
 * Fixes common breakage: trailing commas, single quotes, unquoted keys, comments, missing
 * commas/brackets, Python True/False/None, NDJSON, JSONP wrappers and markdown fences.
 */
export function repairJson(text: string, indent: IndentSetting = '2'): RepairResult {
  const repaired = jsonrepair(stripFences(text));
  const value = JSON.parse(repaired);
  const out = stringify(value, indent);
  return { text: out, changed: out.trim() !== text.trim() };
}

export function needsRepair(text: string, strict = true): boolean {
  if (!text.trim()) return false;
  return parseJson(text, strict).errors.length > 0;
}

/**
 * The document's value as well as it can be recovered: the tolerant JSONC parse when that succeeds,
 * otherwise the repaired content (`repaired: true`), falling back to the partial parse.
 */
export function bestEffortValue(text: string): { value: unknown; repaired: boolean } {
  const tolerant = parseJson(text, false);
  if (!tolerant.errors.length) return { value: tolerant.value, repaired: false };
  try {
    return { value: JSON.parse(jsonrepair(stripFences(text))), repaired: true };
  } catch {
    return { value: tolerant.value, repaired: true };
  }
}

function stripFences(text: string): string {
  const m = /^\s*```[\w-]*\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  return m ? m[1] : text;
}
