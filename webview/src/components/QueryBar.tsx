import { forwardRef, type MouseEvent } from 'react';
import { formatPath, type JsonPath } from '../../../src/core/path';
import type { QueryMode, TextOptions } from '../../../src/core/query/types';
import type { SavedQuery } from '../../../src/shared/messages';
import { post } from '../vscode';
import { useMenu, type MenuItem } from './Menu';

export interface QueryState {
  mode: QueryMode;
  query: string;
  text: TextOptions;
  /** Evaluate against the selected node instead of the document root. */
  scoped: boolean;
  /** Hide tree nodes that don't match (text / JSONPath only). */
  filterTree: boolean;
}

interface Props {
  state: QueryState;
  setState: (patch: Partial<QueryState>) => void;
  selected: JsonPath;
  onRun: () => void;
  onClear: () => void;
  history: SavedQuery[];
  saved: SavedQuery[];
  status: { running: boolean; error: string | null; count: number | null; ms: number | null };
}

const MODES: { id: QueryMode; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'jsonpath', label: 'JSONPath' },
  { id: 'jmespath', label: 'JMESPath' },
  { id: 'jq', label: 'jq' },
];

const PLACEHOLDER: Record<QueryMode, string> = {
  text: 'Search keys and values…',
  jsonpath: '$..book[?(@.price < 10)].title',
  jmespath: 'store.book[?price > `10`].{title: title, by: author}',
  jq: '.store.book[] | select(.price < 10) | {title, author}',
};

const EXAMPLES: Record<QueryMode, [string, string][]> = {
  text: [
    ['error', 'Any key or value containing "error"'],
    ['^\\d{4}-\\d{2}-\\d{2}', 'Dates (enable regex .*)'],
  ],
  jsonpath: [
    ['$..id', 'Every "id" at any depth'],
    ['$.items[*].name', 'Name of each item'],
    ['$..[?(@.price > 10)]', 'Any object with price > 10 (nested)'],
    ["$..[?(@.status === 'active' && @.tags)]", 'Combined conditions'],
    ['$.items[0:5]', 'First five items'],
    ['$..*~', 'All property names'],
  ],
  jmespath: [
    ['items[*].name', 'Project a field'],
    ['items[?price > `10`]', 'Filter by condition'],
    ['items[?contains(tags, `"sale"`)].{n: name, p: price}', 'Filter + reshape'],
    ['sort_by(items, &price)[-3:]', 'Top 3 by price'],
    ['length(items)', 'Count'],
    ['items[].tags[] | sort(@)', 'Flatten nested arrays'],
  ],
  jq: [
    ['.items[] | select(.price > 10)', 'Filter'],
    ['[.items[] | {name, price}]', 'Reshape'],
    ['.items | group_by(.category) | map({key: .[0].category, count: length})', 'Group + count'],
    ['[paths(scalars)] | length', 'Count leaf values'],
    ['.. | objects | select(has("id")) | .id', 'Every id, any depth'],
    ['to_entries | map(select(.value != null)) | from_entries', 'Drop null fields'],
    ['[.items[].price] | add / length', 'Average'],
  ],
};

const PATH_STYLE = { jsonpath: 'jsonpath', jmespath: 'jmespath', jq: 'jq' } as const;

export const QueryBar = forwardRef<HTMLInputElement, Props>(function QueryBar({ state, setState, selected, onRun, onClear, history, saved, status }, inputRef) {
  const openMenu = useMenu();
  const supportsFilter = state.mode === 'text' || state.mode === 'jsonpath';

  const insertPath = () => {
    if (state.mode === 'text') {
      const last = selected[selected.length - 1];
      if (last !== undefined) setState({ query: String(last) });
      return;
    }
    let p = formatPath(selected, PATH_STYLE[state.mode]);
    if (state.mode === 'jmespath' && p === '@') p = '';
    setState({ query: p });
  };

  const historyMenu = (e: MouseEvent<HTMLElement>) => {
    const item = (q: SavedQuery): MenuItem => ({ label: q.name ?? q.query, hint: q.mode, onClick: () => setState({ mode: q.mode, query: q.query }) });
    const items: MenuItem[] = [];
    if (saved.length) {
      items.push({ section: 'Saved' }, ...saved.map(item));
      items.push({ label: 'Delete a saved query…', onClick: () => openMenu(e.currentTarget, saved.map((q) => ({ label: `Delete “${q.name ?? q.query}”`, danger: true, onClick: () => post({ type: 'deleteQuery', query: q }) }))) });
    }
    if (history.length) items.push({ section: 'Recent' }, ...history.map(item));
    if (!items.length) items.push({ section: 'No saved or recent queries yet' });
    openMenu(e.currentTarget, items);
  };

  const examplesMenu = (e: MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [
      { section: `${MODES.find((m) => m.id === state.mode)!.label} examples` },
      ...EXAMPLES[state.mode].map(([q, desc]) => ({ label: q, hint: desc, onClick: () => setState({ query: q }) })),
    ]);

  const toggle = (key: keyof TextOptions, label: string, title: string) => (
    <button className={`toggle${state.text[key] ? ' on' : ''}`} title={title} onClick={() => setState({ text: { ...state.text, [key]: !state.text[key] } })}>
      {label}
    </button>
  );

  return (
    <div className="query-bar">
      <div className="query-row">
        <select className="mode" value={state.mode} onChange={(e) => setState({ mode: e.target.value as QueryMode })} title="Query language">
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <div className={`query-input${status.error ? ' invalid' : ''}`}>
          <input
            ref={inputRef}
            value={state.query}
            spellCheck={false}
            placeholder={PLACEHOLDER[state.mode]}
            onChange={(e) => setState({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRun();
              if (e.key === 'Escape') onClear();
            }}
          />
          {state.mode === 'text' && (
            <span className="toggles">
              {toggle('caseSensitive', 'Aa', 'Match case')}
              {toggle('wholeWord', 'ab', 'Whole word')}
              {toggle('regex', '.*', 'Regular expression')}
              <select
                className="scope"
                value={state.text.scope}
                onChange={(e) => setState({ text: { ...state.text, scope: e.target.value as TextOptions['scope'] } })}
                title="Search in"
              >
                <option value="both">keys + values</option>
                <option value="keys">keys</option>
                <option value="values">values</option>
              </select>
            </span>
          )}
        </div>
        <button className="btn primary" onClick={onRun} disabled={status.running} title="Run (Enter) and add to history">
          Run
        </button>
        <button className="btn" onClick={historyMenu} title="Saved and recent queries">
          ⏱
        </button>
        <button className="btn" onClick={() => state.query.trim() && post({ type: 'saveQuery', query: { mode: state.mode, query: state.query } })} title="Save this query">
          ☆
        </button>
        <button className="btn" onClick={examplesMenu} title="Examples">
          ?
        </button>
      </div>
      <div className="query-options">
        <label className="check" title="Evaluate the query against the selected node instead of the whole document">
          <input type="checkbox" checked={state.scoped} onChange={(e) => setState({ scoped: e.target.checked })} />
          From selected node {state.scoped && selected.length > 0 && <code>{formatPath(selected, 'jsonpath')}</code>}
        </label>
        <label className={`check${supportsFilter ? '' : ' disabled'}`} title={supportsFilter ? 'Show only matching nodes (and their parents) in the tree' : 'Available for Text and JSONPath'}>
          <input type="checkbox" disabled={!supportsFilter} checked={state.filterTree && supportsFilter} onChange={(e) => setState({ filterTree: e.target.checked })} />
          Filter tree
        </label>
        <button className="link" onClick={insertPath} title="Fill the query with the selected node's path">
          Use selected path
        </button>
        <span className="spacer" />
        <span className={`status${status.error ? ' error' : ''}`} title={status.error ?? undefined}>
          {status.running ? 'Running…' : status.error ? status.error.split('\n')[0] : status.count !== null ? `${status.count} result${status.count === 1 ? '' : 's'} · ${status.ms} ms` : ''}
        </span>
      </div>
    </div>
  );
});
