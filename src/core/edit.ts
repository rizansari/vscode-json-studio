import { applyEdits, findNodeAtLocation, modify, type FormattingOptions } from 'jsonc-parser';
import { tree } from './parse';
import type { JsonPath } from './path';

export type EditOp =
  | { kind: 'set'; path: JsonPath; value: unknown }
  | { kind: 'remove'; path: JsonPath }
  | { kind: 'insert'; path: JsonPath; index: number; value: unknown }
  | { kind: 'renameKey'; path: JsonPath; newKey: string };

export interface TextEdit {
  offset: number;
  length: number;
  content: string;
}

/**
 * Applies ops one after another to `text`, preserving comments and formatting outside the
 * touched values. `renameKey` takes the path of the property whose key changes.
 */
export function applyOps(text: string, ops: EditOp[], formatting: FormattingOptions): string {
  let out = text;
  for (const op of ops) out = applyOp(out, op, formatting);
  return out;
}

function applyOp(text: string, op: EditOp, formatting: FormattingOptions): string {
  const options = { formattingOptions: formatting };
  switch (op.kind) {
    case 'set':
      if (op.path.length === 0) return JSON.stringify(op.value, null, formatting.insertSpaces ? formatting.tabSize : '\t') + '\n';
      return applyEdits(text, modify(text, op.path, op.value, options));
    case 'remove':
      if (op.path.length === 0) return '';
      return applyEdits(text, modify(text, op.path, undefined, options));
    case 'insert':
      return applyEdits(text, modify(text, [...op.path, op.index], op.value, { ...options, isArrayInsertion: true }));
    case 'renameKey': {
      const root = tree(text);
      const node = root && findNodeAtLocation(root, op.path);
      const keyNode = node?.parent?.type === 'property' ? node.parent.children?.[0] : undefined;
      if (!keyNode) throw new Error(`No property at ${JSON.stringify(op.path)}`);
      const parentObj = node!.parent!.parent;
      if (parentObj?.children?.some((p) => p.children?.[0]?.value === op.newKey)) throw new Error(`Key "${op.newKey}" already exists`);
      return text.slice(0, keyNode.offset) + JSON.stringify(op.newKey) + text.slice(keyNode.offset + keyNode.length);
    }
  }
}

/** Smallest single edit turning `before` into `after` (common prefix/suffix trimmed). */
export function minimalEdit(before: string, after: string): TextEdit | undefined {
  if (before === after) return undefined;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before.charCodeAt(endB - 1) === after.charCodeAt(endA - 1)) {
    endB--;
    endA--;
  }
  return { offset: start, length: endB - start, content: after.slice(start, endA) };
}
