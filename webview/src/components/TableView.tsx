import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { EditOp } from '../../../src/core/edit';
import { formatPath, getAtPath, pathKey, type JsonPath, type Segment } from '../../../src/core/path';
import { compareValues } from '../../../src/core/transform';
import { copy, edit } from '../actions';
import { compact, editText, entries, isContainer, isObj, isTabular, parseEdit, typeOf, uniqueKey } from '../model';
import { post } from '../vscode';
import { InlineEditor } from './InlineEditor';
import { useMenu, type MenuItem } from './Menu';

interface Column {
  id: string;
  path: JsonPath;
  label: string;
}

interface TableRow {
  key: Segment;
  value: unknown;
}

interface Props {
  data: unknown;
  /** Path of the array/object being tabulated inside `data`. */
  path: JsonPath;
  readOnly: boolean;
  flatten: boolean;
  setFlatten: (v: boolean) => void;
  onNavigate?: (path: JsonPath) => void;
  onShowInTree?: (path: JsonPath) => void;
}

const ROW_HEIGHT = 24;
const INDEX_WIDTH = 56;
const DEFAULT_WIDTH = 160;
const VALUE_COL: Column = { id: '[]', path: [], label: '(value)' };

function columnsFor(rows: TableRow[], flatten: boolean): Column[] {
  const cols = new Map<string, Column>();
  const add = (p: JsonPath) => {
    const id = pathKey(p);
    if (!cols.has(id)) cols.set(id, { id, path: p, label: p.length ? p.join('.') : VALUE_COL.label });
  };
  const walk = (v: Record<string, unknown>, base: JsonPath) => {
    for (const [k, c] of Object.entries(v)) {
      if (flatten && isObj(c) && Object.keys(c).length) walk(c, [...base, k]);
      else add([...base, k]);
    }
  };
  for (const r of rows) {
    if (isObj(r.value)) walk(r.value, []);
    else add([]);
  }
  return [...cols.values()];
}

/** `>10`, `<=3`, `!=x`, `=x` compare; anything else is a case-insensitive "contains". */
function makePredicate(expr: string): (v: unknown) => boolean {
  const m = /^\s*(>=|<=|!=|>|<|=)\s*(.*)$/.exec(expr);
  if (m) {
    const [, op, rhsRaw] = m;
    const rhsNum = Number(rhsRaw);
    const numeric = rhsRaw.trim() !== '' && Number.isFinite(rhsNum);
    return (v) => {
      if (v === undefined) return op === '!=';
      const c = numeric && typeof v === 'number' ? v - rhsNum : compareValues(display(v), rhsRaw);
      switch (op) {
        case '>': return c > 0;
        case '<': return c < 0;
        case '>=': return c >= 0;
        case '<=': return c <= 0;
        case '=': return c === 0;
        default: return c !== 0;
      }
    };
  }
  const needle = expr.toLowerCase();
  return (v) => display(v).toLowerCase().includes(needle);
}

function display(v: unknown): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (isContainer(v)) return compact(v, 500);
  return String(v);
}

export function TableView({ data, path, readOnly, flatten, setFlatten, onNavigate, onShowInTree }: Props) {
  const openMenu = useMenu();
  const target = getAtPath(data, path);
  const isObjectTable = isObj(target);
  const rows: TableRow[] = useMemo(() => entries(target).map(([key, value]) => ({ key, value })), [target]);
  const allColumns = useMemo(() => columnsFor(rows, flatten), [rows, flatten]);

  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [globalFilter, setGlobalFilter] = useState('');
  const [editing, setEditing] = useState<{ row: Segment; col: string } | null>(null);
  const [cursor, setCursor] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [newColumn, setNewColumn] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const dragCol = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset view state when switching to another table.
  const tableId = pathKey(path);
  useEffect(() => {
    setSort(null);
    setFilters({});
    setGlobalFilter('');
    setHidden(new Set());
    setOrder([]);
    setCursor({ r: 0, c: 0 });
  }, [tableId, flatten]);

  const columns = useMemo(() => {
    const byId = new Map(allColumns.map((c) => [c.id, c]));
    const ordered = order.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    for (const c of allColumns) if (!order.includes(c.id)) ordered.push(c);
    return ordered.filter((c) => !hidden.has(c.id));
  }, [allColumns, order, hidden]);

  const cell = (row: TableRow, col: Column) => (col.path.length ? (isObj(row.value) ? getAtPath(row.value, col.path) : undefined) : row.value);

  const view = useMemo(() => {
    const active = Object.entries(filters).filter(([, f]) => f.trim());
    const preds = active.map(([id, f]) => [allColumns.find((c) => c.id === id), makePredicate(f)] as const).filter(([c]) => c);
    const g = globalFilter.trim().toLowerCase();
    let out = rows.filter((r) => preds.every(([c, p]) => p(cell(r, c!))) && (!g || compact(r.value, 100000).toLowerCase().includes(g)));
    if (sort) {
      const col = allColumns.find((c) => c.id === sort.id);
      if (col) out = [...out].sort((a, b) => compareValues(cell(a, col), cell(b, col)) * sort.dir);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, globalFilter, sort, allColumns]);

  const virtualizer = useVirtualizer({ count: view.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 15 });

  if (!isContainer(target)) {
    return <div className="empty">The selected value is not an array or object. Pick an array of objects in the tree and choose “Open as table”.</div>;
  }

  const width = (c: Column) => widths[c.id] ?? Math.min(320, Math.max(90, c.label.length * 8 + 40, DEFAULT_WIDTH));
  const template = `${INDEX_WIDTH}px ${columns.map((c) => `${width(c)}px`).join(' ')}${readOnly ? '' : ' 40px'}`;
  const rowPath = (row: TableRow) => [...path, row.key];
  const cellPath = (row: TableRow, col: Column) => [...rowPath(row), ...col.path];

  const commit = (row: TableRow, col: Column, text: string) => {
    setEditing(null);
    edit({ kind: 'set', path: cellPath(row, col), value: parseEdit(text, cell(row, col)) });
  };

  const objectRows = rows.filter((r) => isObj(r.value));
  const hasPath = (r: TableRow, p: JsonPath) => getAtPath(r.value, p) !== undefined;

  const renameColumn = (col: Column, name: string) => {
    setRenaming(null);
    if (!name || name === col.path[col.path.length - 1]) return;
    const ops: EditOp[] = objectRows.filter((r) => hasPath(r, col.path)).map((r) => ({ kind: 'renameKey', path: cellPath(r, col), newKey: name }));
    if (ops.length) edit(...ops);
  };

  const addColumn = (name: string) => {
    setNewColumn(false);
    if (!name) return;
    const ops: EditOp[] = objectRows.filter((r) => !(name in (r.value as object))).map((r) => ({ kind: 'set', path: [...rowPath(r), name], value: null }));
    if (ops.length) edit(...ops);
  };

  const emptyRow = () => {
    const out: Record<string, unknown> = {};
    for (const c of allColumns) {
      if (!c.path.length) return null;
      let cur = out;
      c.path.forEach((seg, i) => {
        const k = String(seg);
        if (i === c.path.length - 1) cur[k] = null;
        else cur = (cur[k] ??= {}) as Record<string, unknown>;
      });
    }
    return out;
  };

  const addRow = () => {
    if (Array.isArray(target)) edit({ kind: 'insert', path, index: target.length, value: emptyRow() });
    else if (isObj(target)) edit({ kind: 'set', path: [...path, uniqueKey(target, 'newRow')], value: emptyRow() });
  };

  const rowMenu = (e: MouseEvent, row: TableRow) => {
    e.preventDefault();
    const items: MenuItem[] = [
      { section: formatPath(rowPath(row), 'jsonpath') },
      { label: 'Copy row as JSON', onClick: () => copy(JSON.stringify(row.value, null, 2), 'row') },
      ...(onShowInTree ? [{ label: 'Show in tree', onClick: () => onShowInTree(rowPath(row)) }] : []),
    ];
    if (!readOnly) {
      items.push('separator');
      if (Array.isArray(target) && typeof row.key === 'number') {
        const i = row.key;
        items.push({ label: 'Insert row above', onClick: () => edit({ kind: 'insert', path, index: i, value: emptyRow() }) });
        items.push({ label: 'Insert row below', onClick: () => edit({ kind: 'insert', path, index: i + 1, value: emptyRow() }) });
        items.push({ label: 'Duplicate row', onClick: () => edit({ kind: 'insert', path, index: i + 1, value: structuredClone(row.value) }) });
      } else if (isObj(target)) {
        items.push({ label: 'Duplicate row', onClick: () => edit({ kind: 'set', path: [...path, uniqueKey(target, `${row.key}_copy`)], value: structuredClone(row.value) }) });
      }
      items.push({ label: 'Delete row', danger: true, onClick: () => edit({ kind: 'remove', path: rowPath(row) }) });
    }
    openMenu(e, items);
  };

  const columnMenu = (e: MouseEvent, col: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const values = view.map((r) => cell(r, col));
    const items: MenuItem[] = [
      { section: col.label },
      { label: 'Sort ascending', onClick: () => setSort({ id: col.id, dir: 1 }) },
      { label: 'Sort descending', onClick: () => setSort({ id: col.id, dir: -1 }) },
      ...(sort?.id === col.id ? [{ label: 'Clear sort', onClick: () => setSort(null) }] : []),
      { label: 'Hide column', onClick: () => setHidden(new Set([...hidden, col.id])) },
      { label: 'Copy column values', onClick: () => copy(values.map(display).join('\n'), 'column') },
      { label: 'Copy distinct values', onClick: () => copy([...new Set(values.map(display))].join('\n'), 'distinct values') },
    ];
    if (!readOnly && col.path.length) {
      items.push('separator');
      items.push({ label: 'Rename column', onClick: () => setRenaming(col.id) });
      items.push({
        label: 'Delete column',
        danger: true,
        onClick: () => {
          const ops: EditOp[] = objectRows.filter((r) => hasPath(r, col.path)).map((r) => ({ kind: 'remove', path: cellPath(r, col) }));
          if (ops.length) edit(...ops);
        },
      });
    }
    openMenu(e, items);
  };

  const tsv = () => {
    const esc = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const header = [isObjectTable ? 'key' : '#', ...columns.map((c) => c.label)].join('\t');
    const body = view.map((r) => [String(r.key), ...columns.map((c) => esc(display(cell(r, c))))].join('\t'));
    return [header, ...body].join('\n');
  };

  const exportRows = () => (isObjectTable ? Object.fromEntries(view.map((r) => [r.key, r.value])) : view.map((r) => r.value));

  const exportMenu = (e: MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [
      { section: `${view.length} row(s)${view.length !== rows.length ? ' (filtered)' : ''}` },
      { label: 'Copy as TSV (Excel / Sheets)', onClick: () => copy(tsv(), 'TSV') },
      { label: 'Copy as JSON', onClick: () => post({ type: 'export', target: 'copy', format: 'json', data: exportRows() }) },
      'separator',
      { label: 'Open as JSON in new tab', onClick: () => post({ type: 'export', target: 'newTab', format: 'json', data: exportRows() }) },
      { label: 'Open as CSV in new tab', onClick: () => post({ type: 'export', target: 'newTab', format: 'csv', data: view.map((r) => r.value) }) },
      'separator',
      { label: 'Save as JSON…', onClick: () => post({ type: 'export', target: 'save', format: 'json', data: exportRows() }) },
      { label: 'Save as CSV…', onClick: () => post({ type: 'export', target: 'save', format: 'csv', data: view.map((r) => r.value) }) },
      { label: 'Save as YAML…', onClick: () => post({ type: 'export', target: 'save', format: 'yaml', data: exportRows() }) },
    ]);

  const startResize = (e: MouseEvent, col: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = width(col);
    const move = (ev: globalThis.MouseEvent) => setWidths((w) => ({ ...w, [col.id]: Math.max(50, startW + ev.clientX - startX) }));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const dropOn = (target: Column) => {
    const from = dragCol.current;
    dragCol.current = null;
    if (!from || from === target.id) return;
    const ids = columns.map((c) => c.id);
    ids.splice(ids.indexOf(from), 1);
    ids.splice(ids.indexOf(target.id), 0, from);
    setOrder(ids);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing || (e.target as HTMLElement).tagName === 'INPUT') return;
    const row = view[cursor.r];
    const col = columns[cursor.c];
    const move = (r: number, c: number) => {
      const next = { r: Math.max(0, Math.min(view.length - 1, r)), c: Math.max(0, Math.min(columns.length - 1, c)) };
      setCursor(next);
      virtualizer.scrollToIndex(next.r, { align: 'auto' });
    };
    switch (e.key) {
      case 'ArrowDown': move(cursor.r + 1, cursor.c); break;
      case 'ArrowUp': move(cursor.r - 1, cursor.c); break;
      case 'ArrowRight': case 'Tab': move(cursor.r, cursor.c + (e.shiftKey ? -1 : 1)); break;
      case 'ArrowLeft': move(cursor.r, cursor.c - 1); break;
      case 'PageDown': move(cursor.r + 20, cursor.c); break;
      case 'PageUp': move(cursor.r - 20, cursor.c); break;
      case 'Enter':
      case 'F2':
        if (row && col && !readOnly && !isContainer(cell(row, col))) setEditing({ row: row.key, col: col.id });
        break;
      case 'Delete':
        if (row && col && !readOnly && cell(row, col) !== undefined) edit({ kind: 'set', path: cellPath(row, col), value: null });
        break;
      case 'c':
        if ((e.metaKey || e.ctrlKey) && row && col) copy(display(cell(row, col)), 'cell');
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const hiddenCount = hidden.size;

  return (
    <div className="table-view">
      <div className="table-toolbar">
        <span className="muted">
          {view.length === rows.length ? `${rows.length} rows` : `${view.length} of ${rows.length} rows`} · {columns.length} cols
        </span>
        <input className="search small" placeholder="Filter rows…" value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} />
        <label className="check" title="Expand nested objects into a.b columns">
          <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> Flatten nested
        </label>
        {hiddenCount > 0 && (
          <button className="btn small" onClick={() => setHidden(new Set())}>
            Show {hiddenCount} hidden
          </button>
        )}
        <span className="spacer" />
        {!readOnly && (
          <>
            <button className="btn small" onClick={addRow} title="Append a row">
              + Row
            </button>
            {(Array.isArray(target) ? objectRows.length > 0 : true) && (
              <button className="btn small" onClick={() => setNewColumn(true)} title="Add a column to every row">
                + Column
              </button>
            )}
          </>
        )}
        {!readOnly && (
          <button className="btn small" onClick={exportMenu}>
            Export ▾
          </button>
        )}
      </div>

      <div className="grid-scroll" ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown}>
        <div className="grid" style={{ width: INDEX_WIDTH + columns.reduce((s, c) => s + width(c), 0) + (readOnly ? 0 : 40) }}>
          <div className="grid-head" style={{ gridTemplateColumns: template }}>
            <div className="th index">{isObjectTable ? 'key' : '#'}</div>
            {columns.map((c) => (
              <div
                key={c.id}
                className={`th${sort?.id === c.id ? ' sorted' : ''}`}
                draggable={renaming !== c.id}
                onDragStart={() => (dragCol.current = c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(c)}
                onContextMenu={(e) => columnMenu(e, c)}
              >
                {renaming === c.id ? (
                  <InlineEditor initial={String(c.path[c.path.length - 1])} onCommit={(t) => renameColumn(c, t)} onCancel={() => setRenaming(null)} />
                ) : (
                  <span
                    className="th-label"
                    title={`${c.label} — click to sort, drag to reorder, right-click for more`}
                    onClick={() => setSort(sort?.id !== c.id ? { id: c.id, dir: 1 } : sort.dir === 1 ? { id: c.id, dir: -1 } : null)}
                  >
                    {c.label}
                    {sort?.id === c.id && <span className="sort-arrow">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>}
                  </span>
                )}
                <button className="icon-btn th-menu" onClick={(e) => columnMenu(e, c)}>
                  ⋯
                </button>
                <span className="resizer" onMouseDown={(e) => startResize(e, c)} />
              </div>
            ))}
            {!readOnly && (
              <div className="th">
                {newColumn ? <InlineEditor initial="" onCommit={addColumn} onCancel={() => setNewColumn(false)} /> : null}
              </div>
            )}
            <div className="th index filter-cell">⌕</div>
            {columns.map((c) => (
              <div key={c.id} className="th filter-cell">
                <input
                  className="col-filter"
                  placeholder="filter"
                  title="Text contains, or >, <, >=, <=, =, != (e.g. >10)"
                  value={filters[c.id] ?? ''}
                  onChange={(e) => setFilters({ ...filters, [c.id]: e.target.value })}
                />
              </div>
            ))}
            {!readOnly && <div className="th filter-cell" />}
          </div>

          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = view[vi.index];
              return (
                <div key={String(row.key)} className={`grid-row${vi.index % 2 ? ' odd' : ''}`} style={{ gridTemplateColumns: template, transform: `translateY(${vi.start}px)`, height: ROW_HEIGHT }}>
                  <div className="td index" onClick={(e) => rowMenu(e, row)} onContextMenu={(e) => rowMenu(e, row)} title="Row actions">
                    {String(row.key)}
                  </div>
                  {columns.map((c, ci) => {
                    const v = cell(row, c);
                    const isCursor = cursor.r === vi.index && cursor.c === ci;
                    const isEditing = editing?.row === row.key && editing.col === c.id;
                    return (
                      <div
                        key={c.id}
                        className={`td v-${v === undefined ? 'missing' : typeOf(v)}${isCursor ? ' cursor' : ''}`}
                        onClick={() => setCursor({ r: vi.index, c: ci })}
                        onDoubleClick={() => {
                          if (readOnly) return;
                          if (isContainer(v)) {
                            if (isTabular(v) && onNavigate) onNavigate(cellPath(row, c));
                            else onShowInTree?.(cellPath(row, c));
                          } else setEditing({ row: row.key, col: c.id });
                        }}
                        title={v !== undefined && display(v).length > 30 ? display(v) : undefined}
                      >
                        {isEditing ? (
                          <InlineEditor initial={v === undefined ? '' : editText(v)} onCommit={(t) => commit(row, c, t)} onCancel={() => setEditing(null)} />
                        ) : isContainer(v) ? (
                          <span className="nested">
                            <span className="count">{Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).length}}`}</span> {compact(v, 80)}
                            {onNavigate && isTabular(v) && (
                              <button className="icon-btn drill" title="Open nested table" onClick={(e) => (e.stopPropagation(), onNavigate(cellPath(row, c)))}>
                                ↳
                              </button>
                            )}
                          </span>
                        ) : v === undefined ? (
                          <span className="missing">—</span>
                        ) : (
                          display(v)
                        )}
                      </div>
                    );
                  })}
                  {!readOnly && <div className="td" />}
                </div>
              );
            })}
          </div>
        </div>
        {view.length === 0 && <div className="empty">No rows match the filters.</div>}
      </div>
    </div>
  );
}
