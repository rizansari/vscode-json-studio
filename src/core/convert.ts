import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import * as yaml from 'js-yaml';
import Papa from 'papaparse';
import * as toml from 'smol-toml';
import { flatten, unflatten } from './transform';

export type Format = 'json' | 'yaml' | 'csv' | 'tsv' | 'xml' | 'toml';

export const FORMATS: { id: Format; label: string; ext: string; language: string }[] = [
  { id: 'json', label: 'JSON', ext: 'json', language: 'json' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', language: 'yaml' },
  { id: 'csv', label: 'CSV', ext: 'csv', language: 'csv' },
  { id: 'tsv', label: 'TSV', ext: 'tsv', language: 'tsv' },
  { id: 'xml', label: 'XML', ext: 'xml', language: 'xml' },
  { id: 'toml', label: 'TOML', ext: 'toml', language: 'toml' },
];

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function toFormat(value: unknown, format: Format, indent = '  '): string {
  switch (format) {
    case 'json':
      return JSON.stringify(value, null, indent) + '\n';
    case 'yaml':
      return yaml.dump(value, { indent: indent === '\t' ? 2 : indent.length, lineWidth: -1, noRefs: true });
    case 'csv':
    case 'tsv':
      return toDelimited(value, format === 'tsv' ? '\t' : ',');
    case 'xml': {
      const root = isObj(value) && Object.keys(value).length === 1 ? value : { root: Array.isArray(value) ? { item: value } : value };
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLBuilder({ format: true, ignoreAttributes: false, attributeNamePrefix: '@_', indentBy: indent }).build(root);
    }
    case 'toml':
      return toml.stringify(isObj(value) ? value : { items: value });
  }
}

export function fromFormat(text: string, format: Format): unknown {
  switch (format) {
    case 'json':
      return JSON.parse(text);
    case 'yaml':
      return yaml.load(text);
    case 'csv':
    case 'tsv': {
      const res = Papa.parse<Record<string, unknown>>(text.trim(), { header: true, dynamicTyping: true, skipEmptyLines: true, delimiter: format === 'tsv' ? '\t' : '' });
      if (res.errors.length && !res.data.length) throw new Error(res.errors[0].message);
      // Columns named "a.b" become nested objects again.
      return res.data.map((row) => (Object.keys(row).some((k) => k.includes('.')) ? unflatten(row) : row));
    }
    case 'xml':
      return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: true }).parse(text);
    case 'toml':
      return toml.parse(text);
  }
}

/** Rows for tabular output: arrays of objects as-is, a single object as one row, scalars wrapped. */
export function toRows(value: unknown): Record<string, unknown>[] {
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((v) => (isObj(v) ? v : { value: v }));
}

export function toDelimited(value: unknown, delimiter = ','): string {
  const rows = toRows(value).map((r) => flatten(r) as Record<string, unknown>);
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) seen.add(k), columns.push(k);
  const data = rows.map((r) => columns.map((c) => cell(r[c])));
  return Papa.unparse({ fields: columns, data }, { delimiter, newline: '\n' }) + '\n';
}

function cell(v: unknown): unknown {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
