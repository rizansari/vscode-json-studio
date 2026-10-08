import Ajv, { type ErrorObject } from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parsePointer, type JsonPath } from './path';

export interface SchemaIssue {
  path: JsonPath;
  /** Highlight the property key rather than the value (e.g. additionalProperties). */
  onKey: boolean;
  message: string;
}

function createAjv(schema: Record<string, unknown>) {
  const draft = String(schema.$schema ?? '');
  const opts = { allErrors: true, strict: false, validateFormats: true };
  const ajv = draft.includes('2020-12') ? new Ajv2020(opts) : draft.includes('2019-09') ? new Ajv2019(opts) : new Ajv(opts);
  addFormats(ajv as unknown as Ajv);
  return ajv;
}

export function validate(data: unknown, schema: unknown): SchemaIssue[] {
  if (!schema || typeof schema !== 'object') throw new Error('Schema must be a JSON object');
  const ajv = createAjv(schema as Record<string, unknown>);
  const fn = ajv.compile(schema as object);
  if (fn(data)) return [];
  return (fn.errors ?? []).map((e) => toIssue(e, data));
}

function toIssue(e: ErrorObject, data: unknown): SchemaIssue {
  const path = parsePointer(e.instancePath, data);
  const p = e.params as Record<string, unknown>;
  if (e.keyword === 'additionalProperties' && typeof p.additionalProperty === 'string') {
    return { path: [...path, p.additionalProperty], onKey: true, message: `Property "${p.additionalProperty}" is not allowed` };
  }
  if (e.keyword === 'required') return { path, onKey: false, message: `Missing required property "${p.missingProperty}"` };
  if (e.keyword === 'enum') return { path, onKey: false, message: `${e.message}: ${JSON.stringify(p.allowedValues)}` };
  return { path, onKey: false, message: e.message ?? e.keyword };
}
