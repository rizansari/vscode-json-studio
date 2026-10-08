import { applyEdits, format, type FormattingOptions } from 'jsonc-parser';
import { parseStrict } from './parse';

export type IndentSetting = '2' | '4' | 'tab';

export function indentString(indent: IndentSetting): string {
  return indent === 'tab' ? '\t' : ' '.repeat(Number(indent));
}

export function formattingOptions(indent: IndentSetting, eol = '\n'): FormattingOptions {
  return { insertSpaces: indent !== 'tab', tabSize: indent === 'tab' ? 4 : Number(indent), eol, insertFinalNewline: true };
}

/** Beautify while preserving comments. Throws if the text is not parseable. */
export function beautify(text: string, indent: IndentSetting = '2', eol = '\n'): string {
  parseStrict(text);
  return applyEdits(text, format(text, undefined, formattingOptions(indent, eol)));
}

export function minify(text: string): string {
  return JSON.stringify(parseStrict(text));
}

export function stringify(value: unknown, indent: IndentSetting = '2'): string {
  return JSON.stringify(value, null, indentString(indent)) + '\n';
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort((a, b) => a.localeCompare(b))) out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

export function sortKeys(text: string, indent: IndentSetting = '2'): string {
  return stringify(sortKeysDeep(parseStrict(text)), indent);
}
