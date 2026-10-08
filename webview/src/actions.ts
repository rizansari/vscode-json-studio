import type { EditOp } from '../../src/core/edit';
import { formatPath, type JsonPath, type PathStyle } from '../../src/core/path';
import type { MenuItem } from './components/Menu';
import { convertType, isObj, typeOf, uniqueKey, type JsonType } from './model';
import { post } from './vscode';

export const edit = (...ops: EditOp[]) => post({ type: 'edit', ops });

export const copy = (text: string, label?: string) => post({ type: 'copy', text, label });

export const reveal = (path: JsonPath, open = false) => post({ type: 'reveal', path, open });

const STYLES: [PathStyle, string][] = [
  ['jsonpath', 'JSONPath'],
  ['js', 'JavaScript'],
  ['jq', 'jq'],
  ['jmespath', 'JMESPath'],
  ['pointer', 'JSON Pointer'],
];

export function copyPathItems(path: JsonPath): MenuItem[] {
  return STYLES.map(([style, label]) => {
    const text = formatPath(path, style);
    return { label: `Copy path as ${label}`, hint: text.length > 40 ? text.slice(0, 40) + '…' : text, onClick: () => copy(text, 'path') };
  });
}

export interface NodeCallbacks {
  onEditValue: (path: JsonPath) => void;
  onEditJson: (path: JsonPath) => void;
  onRename: (path: JsonPath) => void;
  onAddChild: (path: JsonPath) => void;
  onOpenTable: (path: JsonPath) => void;
  onQueryFrom: (path: JsonPath) => void;
}

/** Context menu for a tree node or breadcrumb. */
export function nodeMenu(path: JsonPath, value: unknown, parent: unknown, cb: NodeCallbacks, readOnly = false): MenuItem[] {
  const type = typeOf(value);
  const container = type === 'object' || type === 'array';
  const last = path[path.length - 1];
  const items: MenuItem[] = [
    { section: formatPath(path, 'jsonpath') },
    { label: 'Copy value', hint: '⌘C', onClick: () => copy(JSON.stringify(value, null, 2), 'value') },
    ...(typeof value === 'string' ? [{ label: 'Copy raw string', onClick: () => copy(value, 'string') }] : []),
    ...copyPathItems(path),
    'separator',
  ];
  if (readOnly) {
    items.push({ label: 'Show in text editor', onClick: () => reveal(path, true) });
    return items;
  }
  if (!container) items.push({ label: 'Edit value', hint: 'Enter', onClick: () => cb.onEditValue(path) });
  items.push({ label: 'Edit as JSON…', onClick: () => cb.onEditJson(path) });
  if (typeof last === 'string' && isObj(parent)) items.push({ label: 'Rename key', hint: 'F2', onClick: () => cb.onRename(path) });
  if (container) items.push({ label: type === 'array' ? 'Append item' : 'Add property', hint: '+', onClick: () => cb.onAddChild(path) });
  if (Array.isArray(parent) && typeof last === 'number') {
    items.push({ label: 'Duplicate item', onClick: () => edit({ kind: 'insert', path: path.slice(0, -1), index: last + 1, value: structuredClone(value) }) });
  } else if (isObj(parent) && typeof last === 'string') {
    items.push({ label: 'Duplicate property', onClick: () => edit({ kind: 'set', path: [...path.slice(0, -1), uniqueKey(parent, `${last}_copy`)], value: structuredClone(value) }) });
  }
  const types: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array'];
  items.push({ section: 'Change type' });
  for (const t of types.filter((t) => t !== type)) items.push({ label: `→ ${t}`, onClick: () => edit({ kind: 'set', path, value: convertType(value, t) }) });
  items.push('separator');
  if (container) items.push({ label: 'Open as table', disabled: type === 'object' && !Object.values(value as object).some(isObj), onClick: () => cb.onOpenTable(path) });
  items.push({ label: 'Query from here', onClick: () => cb.onQueryFrom(path) });
  items.push({ label: 'Transform…', onClick: () => post({ type: 'command', command: 'transform', path }) });
  items.push({ label: 'Generate types…', onClick: () => post({ type: 'command', command: 'generateTypes', path }) });
  items.push({ label: 'Show in text editor', onClick: () => reveal(path, true) });
  if (path.length) {
    items.push('separator');
    items.push({ label: 'Delete', hint: 'Del', danger: true, onClick: () => edit({ kind: 'remove', path }) });
  }
  return items;
}
