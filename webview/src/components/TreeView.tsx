import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { getAtPath, pathKey, type JsonPath } from '../../../src/core/path';
import { copy, edit, nodeMenu, type NodeCallbacks } from '../actions';
import { compact, editText, entries, isContainer, isObj, isTabular, parseEdit, preview, typeOf, visibleRows, type Row } from '../model';
import { InlineEditor } from './InlineEditor';
import { useMenu } from './Menu';

export interface Editing {
  key: string;
  field: 'value' | 'key';
}

interface Props {
  value: unknown;
  rootLabel: string;
  /** Disables every editing gesture (used for the repaired preview of a broken document). */
  readOnly: boolean;
  selected: JsonPath;
  onSelect: (path: JsonPath) => void;
  expanded: Set<string>;
  setExpanded: (next: Set<string>) => void;
  matches: Set<string> | null;
  filter: { matches: Set<string>; ancestors: Set<string> } | null;
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  /** Bumped whenever the selection changes from outside and should be scrolled into view. */
  scrollSignal: number;
  callbacks: NodeCallbacks;
}

const ROW_HEIGHT = 22;

export function TreeView(props: Props) {
  const { value, readOnly, selected, onSelect, expanded, setExpanded, matches, filter, editing, setEditing, callbacks } = props;
  const openMenu = useMenu();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => visibleRows(value, { expanded, filter, matches: matches ?? undefined }), [value, expanded, filter, matches]);
  const selectedKey = pathKey(selected);
  const selectedIndex = rows.findIndex((r) => r.key === selectedKey);

  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 20 });

  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scrollSignal]);

  const toggle = (row: Row, recursive = false) => {
    const next = new Set(expanded);
    if (row.expanded) {
      next.delete(row.key);
      if (recursive) {
        // pathKey is a JSON array, so descendants share the prefix up to a following comma.
        const prefix = row.path.length ? row.key.slice(0, -1) + ',' : '[';
        for (const k of [...next]) if (k.startsWith(prefix)) next.delete(k);
      }
    } else {
      next.add(row.key);
      if (recursive) {
        const walk = (v: unknown, p: JsonPath) => {
          if (!isContainer(v)) return;
          next.add(pathKey(p));
          for (const [k, c] of entries(v)) walk(c, [...p, k]);
        };
        walk(row.value, row.path);
      }
    }
    setExpanded(next);
  };

  const select = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    onSelect(row.path);
    virtualizer.scrollToIndex(rows.indexOf(row), { align: 'auto' });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing) return;
    const row = rows[selectedIndex];
    const mod = e.metaKey || e.ctrlKey;
    if (readOnly && ['F2', 'Delete', 'Backspace', '+'].includes(e.key)) return;
    switch (e.key) {
      case 'ArrowDown':
        select(selectedIndex + 1);
        break;
      case 'ArrowUp':
        select(selectedIndex - 1);
        break;
      case 'Home':
        select(0);
        break;
      case 'End':
        select(rows.length - 1);
        break;
      case 'PageDown':
        select(selectedIndex + 20);
        break;
      case 'PageUp':
        select(selectedIndex - 20);
        break;
      case 'ArrowRight':
        if (row?.expandable && !row.expanded) toggle(row, e.altKey);
        else if (row?.expanded) select(selectedIndex + 1);
        break;
      case 'ArrowLeft':
        if (row?.expanded) toggle(row, e.altKey);
        else if (row && row.path.length) onSelect(row.path.slice(0, -1));
        break;
      case 'Enter':
        if (!row) break;
        if (isContainer(row.value)) toggle(row);
        else if (!readOnly) setEditing({ key: row.key, field: 'value' });
        break;
      case 'F2':
        if (row && typeof row.segment === 'string') setEditing({ key: row.key, field: 'key' });
        break;
      case 'Delete':
      case 'Backspace':
        if (row && row.path.length) edit({ kind: 'remove', path: row.path });
        break;
      case '+':
        if (row && isContainer(row.value)) callbacks.onAddChild(row.path);
        break;
      case 'c':
        if (mod && row && !window.getSelection()?.toString()) copy(JSON.stringify(row.value, null, 2), 'value');
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const showMenu = (e: MouseEvent, row: Row) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(row.path);
    openMenu(e, nodeMenu(row.path, row.value, getAtPath(value, row.path.slice(0, -1)), callbacks, readOnly));
  };

  return (
    <div className="tree" ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          const isSelected = row.key === selectedKey;
          const isEditingKey = editing?.key === row.key && editing.field === 'key';
          const isEditingValue = editing?.key === row.key && editing.field === 'value';
          return (
            <div
              key={row.key}
              className={`tree-row${isSelected ? ' selected' : ''}${row.isMatch ? ' hit' : ''}`}
              style={{ transform: `translateY(${vi.start}px)`, height: ROW_HEIGHT, paddingLeft: 6 + row.depth * 16 }}
              onClick={() => onSelect(row.path)}
              onContextMenu={(e) => showMenu(e, row)}
              onDoubleClick={() => (isContainer(row.value) ? toggle(row) : !readOnly && setEditing({ key: row.key, field: 'value' }))}
            >
              <span
                className={`twisty${row.expandable ? '' : ' leaf'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (row.expandable) toggle(row, e.altKey);
                }}
                title={row.expandable ? 'Alt+click to expand/collapse all' : undefined}
              >
                {row.expandable ? (row.expanded ? '▾' : '▸') : ''}
              </span>
              {isEditingKey ? (
                <InlineEditor
                  initial={String(row.segment)}
                  onCommit={(t) => {
                    setEditing(null);
                    edit({ kind: 'renameKey', path: row.path, newKey: t });
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <span
                  className={row.segment === null ? 'key root' : typeof row.segment === 'number' ? 'key index' : 'key'}
                  onDoubleClick={(e) => {
                    if (typeof row.segment !== 'string' || readOnly) return;
                    e.stopPropagation();
                    setEditing({ key: row.key, field: 'key' });
                  }}
                >
                  {row.segment === null ? props.rootLabel : String(row.segment)}
                </span>
              )}
              <span className="colon">{row.segment === null ? ' ' : ': '}</span>
              {isEditingValue ? (
                <InlineEditor
                  initial={editText(row.value)}
                  className={`v-${typeOf(row.value)}`}
                  onCommit={(t) => {
                    setEditing(null);
                    edit({ kind: 'set', path: row.path, value: parseEdit(t, row.value) });
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <ValueCell row={row} />
              )}
              <span className="row-actions">
                {isTabular(row.value) && (
                  <button className="icon-btn" title="Open as table" onClick={(e) => (e.stopPropagation(), callbacks.onOpenTable(row.path))}>
                    ▦
                  </button>
                )}
                <button className="icon-btn" title="More actions" onClick={(e) => showMenu(e, row)}>
                  ⋯
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ValueCell({ row }: { row: Row }) {
  const v = row.value;
  if (isContainer(v)) {
    const n = Array.isArray(v) ? v.length : Object.keys(v).length;
    const brackets = Array.isArray(v) ? `[${n}]` : `{${n}}`;
    return (
      <span className="summary">
        <span className="count">{brackets}</span>
        {!row.expanded && n > 0 && <span className="peek">{peek(v)}</span>}
      </span>
    );
  }
  return (
    <span className={`value v-${typeOf(v)}`} title={typeof v === 'string' && v.length > 60 ? v : undefined}>
      {preview(v, 500)}
    </span>
  );
}

function peek(v: unknown): string {
  if (Array.isArray(v)) return compact(v.slice(0, 5), 120);
  if (isObj(v)) {
    const parts = Object.entries(v)
      .slice(0, 6)
      .map(([k, c]) => `${k}: ${isContainer(c) ? preview(c) : compact(c, 40)}`);
    return parts.join(', ') + (Object.keys(v).length > 6 ? ', …' : '');
  }
  return '';
}
