import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { lineCol, parseJson, stats } from '../../src/core/parse';
import { formatPath, getAtPath, pathKey, type JsonPath } from '../../src/core/path';
import { bestEffortValue } from '../../src/core/repair';
import { DEFAULT_TEXT_OPTIONS, type QueryResult } from '../../src/core/query/types';
import type { SavedQuery, ToolCommand } from '../../src/shared/messages';
import { copyPathItems, edit, nodeMenu, reveal, type NodeCallbacks } from './actions';
import { EditDialog } from './components/InlineEditor';
import { useMenu, type MenuItem } from './components/Menu';
import { QueryBar, type QueryState } from './components/QueryBar';
import { Results } from './components/Results';
import { TableView } from './components/TableView';
import { TreeView, type Editing } from './components/TreeView';
import { ancestorKeys, expandToDepth, findFirstTabular, isContainer, isObj, uniqueKey } from './model';
import { loadState, onHostMessage, post, saveState } from './vscode';

interface Doc {
  text: string;
  strict: boolean;
  fileName: string;
}

type Tab = 'tree' | 'table';

const persisted = loadState();

export function App() {
  const openMenu = useMenu();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [tab, setTabState] = useState<Tab>(persisted.tab ?? 'tree');
  const [selected, setSelected] = useState<JsonPath>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scrollSignal, setScrollSignal] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dialog, setDialog] = useState<{ path: JsonPath; initial: string } | null>(null);
  const [tablePath, setTablePathState] = useState<JsonPath | null>(persisted.tablePath ?? null);
  const [flatten, setFlattenState] = useState(persisted.flatten ?? false);

  const [query, setQueryState] = useState<QueryState>({ mode: 'text', query: '', text: DEFAULT_TEXT_OPTIONS, scoped: false, filterTree: false });
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [queries, setQueries] = useState<{ history: SavedQuery[]; saved: SavedQuery[] }>({ history: [], saved: [] });
  const queryInput = useRef<HTMLInputElement>(null);
  const queryId = useRef(0);
  const initialized = useRef(false);

  const parsed = useMemo(() => (doc ? analyze(doc) : null), [doc]);
  const value = parsed?.value;
  const readOnly = !!parsed?.preview;
  const info = useMemo(() => (doc ? { ...stats(value), bytes: new Blob([doc.text]).size } : null), [doc, value]);

  const setTab = (t: Tab) => {
    setTabState(t);
    saveState({ tab: t });
  };
  const setTablePath = (p: JsonPath | null) => {
    setTablePathState(p);
    saveState({ tablePath: p });
  };
  const setFlatten = (f: boolean) => {
    setFlattenState(f);
    saveState({ flatten: f });
  };

  /** Selects a node, opening its ancestors and scrolling it into view. */
  const focusPath = useCallback((path: JsonPath, revealInEditor: boolean) => {
    setSelected(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < path.length; i++) next.add(pathKey(path.slice(0, i)));
      return next;
    });
    setScrollSignal((n) => n + 1);
    if (revealInEditor) reveal(path);
  }, []);

  // Host → webview.
  useEffect(() => {
    const off = onHostMessage((m) => {
      switch (m.type) {
        case 'doc':
          setDoc({ text: m.text, strict: m.strict, fileName: m.fileName });
          break;
        case 'queryResult':
          if (m.id !== queryId.current) return;
          setRunning(false);
          setQueryError(null);
          setResult(m.result);
          break;
        case 'queryError':
          if (m.id !== queryId.current) return;
          setRunning(false);
          setQueryError(m.error);
          break;
        case 'queries':
          setQueries({ history: m.history, saved: m.saved });
          break;
        case 'select':
          focusPath(m.path, false);
          break;
        case 'focusQuery':
          queryInput.current?.focus();
          queryInput.current?.select();
          break;
      }
    });
    post({ type: 'ready' });
    return off;
  }, [focusPath]);

  // First load: open the top level.
  useEffect(() => {
    if (!parsed || initialized.current) return;
    initialized.current = true;
    setExpanded(expandToDepth(parsed.value, 1));
  }, [parsed]);

  // Queries run as you type (debounced) and again when the document changes.
  // Only the selection matters when the query is scoped to it; avoid re-running on every click otherwise.
  const scopeKey = query.scoped ? pathKey(selected) : '[]';
  const runQuery = useCallback(
    (record: boolean) => {
      const id = ++queryId.current;
      if (!query.query.trim()) {
        setResult(null);
        setQueryError(null);
        setRunning(false);
        return;
      }
      setRunning(true);
      post({ type: 'query', id, record, request: { mode: query.mode, query: query.query, text: query.text, scope: JSON.parse(scopeKey) } });
    },
    [query.mode, query.query, query.text, scopeKey],
  );

  useEffect(() => {
    const t = setTimeout(() => runQuery(false), query.mode === 'text' ? 200 : 400);
    return () => clearTimeout(t);
    // `doc` is a dependency so results refresh after edits.
  }, [runQuery, doc, query.mode]);

  // Reveal a manageable number of matches by opening their ancestors.
  useEffect(() => {
    if (!result?.matches?.length || result.matches.length > 200) return;
    const keys = ancestorKeys(result.matches.map((m) => m.path));
    setExpanded((prev) => new Set([...prev, ...keys]));
  }, [result]);

  const matchSet = useMemo(() => (result?.matches ? new Set(result.matches.map((m) => pathKey(m.path))) : null), [result]);
  const filter = useMemo(() => {
    if (!query.filterTree || !result?.matches || !matchSet || (query.mode !== 'text' && query.mode !== 'jsonpath')) return null;
    return { matches: matchSet, ancestors: ancestorKeys(result.matches.map((m) => m.path)) };
  }, [query.filterTree, query.mode, result, matchSet]);

  const callbacks: NodeCallbacks = {
    onEditValue: (path) => setEditing({ key: pathKey(path), field: 'value' }),
    onEditJson: (path) => setDialog({ path, initial: JSON.stringify(getAtPath(value, path), null, 2) }),
    onRename: (path) => setEditing({ key: pathKey(path), field: 'key' }),
    onAddChild: (path) => {
      const target = getAtPath(value, path);
      setExpanded((prev) => new Set(prev).add(pathKey(path)));
      if (Array.isArray(target)) {
        edit({ kind: 'insert', path, index: target.length, value: null });
        setSelected([...path, target.length]);
        setEditing({ key: pathKey([...path, target.length]), field: 'value' });
      } else if (isObj(target)) {
        const key = uniqueKey(target);
        edit({ kind: 'set', path: [...path, key], value: null });
        setSelected([...path, key]);
        setEditing({ key: pathKey([...path, key]), field: 'key' });
      }
    },
    onOpenTable: (path) => {
      setTablePath(path);
      setTab('table');
    },
    onQueryFrom: (path) => {
      setSelected(path);
      setQueryState((q) => ({ ...q, scoped: true }));
      queryInput.current?.focus();
    },
  };

  const command = (c: ToolCommand) => post({ type: 'command', command: c, path: selected });

  const toolsMenu = (e: MouseEvent<HTMLElement>) => {
    const node = selected.length ? ` (${formatPath(selected, 'jsonpath')} or whole doc)` : '';
    const items: MenuItem[] = [
      { section: 'Transform' + node },
      { label: 'Transform…', hint: 'flatten, prune, dedupe, sort, decode…', onClick: () => command('transform') },
      { section: 'Convert & generate' },
      { label: 'Convert to YAML / CSV / XML / TOML…', onClick: () => command('convertTo') },
      { label: 'Generate types…', hint: 'TS, Zod, Go, Python, Rust…', onClick: () => command('generateTypes') },
      { label: 'Infer JSON Schema', onClick: () => command('inferSchema') },
      { section: 'Check' },
      { label: 'Validate against schema…', onClick: () => command('validateSchema') },
      { label: 'Semantic diff with file…', onClick: () => command('diffWithFile') },
      { label: 'Semantic diff with clipboard', onClick: () => command('diffWithClipboard') },
    ];
    openMenu(e.currentTarget, items);
  };

  if (!doc || !parsed) return <div className="empty">Loading…</div>;

  const errors = parsed.errors;
  const firstError = errors[0];
  const effectiveTablePath = tablePath && getAtPath(value, tablePath) !== undefined ? tablePath : findFirstTabular(value);
  const fileLabel = doc.fileName.split(/[\\/]/).pop() ?? 'document';

  return (
    <div className="app">
      <div className="toolbar">
        <div className="seg">
          <button className={tab === 'tree' ? 'on' : ''} onClick={() => setTab('tree')}>
            Tree
          </button>
          <button className={tab === 'table' ? 'on' : ''} onClick={() => setTab('table')}>
            Table
          </button>
        </div>
        {tab === 'tree' && (
          <div className="seg small" title="Expand to depth">
            <button onClick={() => setExpanded(new Set())} title="Collapse all">
              ⊟
            </button>
            {[1, 2, 3].map((d) => (
              <button key={d} onClick={() => setExpanded(expandToDepth(value, d))}>
                {d}
              </button>
            ))}
            <button onClick={() => setExpanded(expandToDepth(value, Infinity))} title="Expand all">
              ⊞
            </button>
          </div>
        )}
        <span className="spacer" />
        <button className="btn" disabled={readOnly} onClick={() => command('format')} title={readOnly ? 'Repair the JSON first' : 'Beautify (keeps comments)'}>
          Beautify
        </button>
        <button className="btn" disabled={readOnly} onClick={() => command('minify')} title={readOnly ? 'Repair the JSON first' : undefined}>
          Minify
        </button>
        <button className="btn" disabled={readOnly} onClick={() => command('sortKeys')} title={readOnly ? 'Repair the JSON first' : undefined}>
          Sort keys
        </button>
        <button className={`btn${errors.length ? ' warn' : ''}`} onClick={() => command('repair')} title="Fix common JSON breakage with a diff preview">
          Repair
        </button>
        <button className="btn" onClick={toolsMenu}>
          Tools ▾
        </button>
        <button className="btn" onClick={() => command('openText')} title="Open the text editor beside">
          {'{ }'}
        </button>
      </div>

      {firstError && (
        <div className="banner">
          <span>
            ⚠ {errors.length} syntax error{errors.length === 1 ? '' : 's'} — {firstError.message} (line {lineCol(doc.text, firstError.offset).line}, col {lineCol(doc.text, firstError.offset).column}).
            {readOnly ? ' Showing a read-only preview of the repaired JSON.' : ''}
          </span>
          <span className="spacer" />
          <button className="btn small" onClick={() => post({ type: 'reveal', path: [], open: true, offset: firstError.offset })}>
            Go to error
          </button>
          <button className="btn small primary" onClick={() => command('repair')}>
            Repair…
          </button>
        </div>
      )}

      <QueryBar
        ref={queryInput}
        state={query}
        setState={(patch) => setQueryState((q) => ({ ...q, ...patch }))}
        selected={selected}
        onRun={() => runQuery(true)}
        onClear={() => setQueryState((q) => ({ ...q, query: '' }))}
        history={queries.history}
        saved={queries.saved}
        status={{ running, error: queryError, count: result?.count ?? null, ms: result?.ms ?? null }}
      />

      <div className={`main${result ? ' with-results' : ''}`}>
        <div className="pane">
          {tab === 'tree' ? (
            <>
              <Breadcrumbs
                path={selected}
                rootLabel={fileLabel}
                onSelect={(p) => focusPath(p, true)}
                info={info}
                onMenu={(e) => openMenu(e, nodeMenu(selected, getAtPath(value, selected), getAtPath(value, selected.slice(0, -1)), callbacks, readOnly))}
                onCopyPath={(e) => openMenu(e.currentTarget, copyPathItems(selected))}
              />
              <TreeView
                value={value}
                rootLabel={fileLabel}
                readOnly={readOnly}
                selected={selected}
                onSelect={(p) => {
                  setSelected(p);
                  reveal(p);
                }}
                expanded={expanded}
                setExpanded={setExpanded}
                matches={matchSet}
                filter={filter}
                editing={editing}
                setEditing={setEditing}
                scrollSignal={scrollSignal}
                callbacks={callbacks}
              />
            </>
          ) : effectiveTablePath ? (
            <>
              <TableBreadcrumbs path={effectiveTablePath} value={value} onNavigate={setTablePath} />
              <TableView
                data={value}
                path={effectiveTablePath}
                readOnly={readOnly}
                flatten={flatten}
                setFlatten={setFlatten}
                onNavigate={setTablePath}
                onShowInTree={(p) => {
                  setTab('tree');
                  focusPath(p, true);
                }}
              />
            </>
          ) : (
            <div className="empty">No array of objects found. Right-click a node in the tree and choose “Open as table”.</div>
          )}
        </div>
        {result && (
          <Results
            result={result}
            onSelect={(p) => {
              setTab('tree');
              focusPath(p, true);
            }}
            onClose={() => setQueryState((q) => ({ ...q, query: '' }))}
          />
        )}
      </div>

      {dialog && (
        <EditDialog
          title={`Edit ${formatPath(dialog.path, 'jsonpath')}`}
          initial={dialog.initial}
          validate={(t) => {
            try {
              JSON.parse(t);
              return null;
            } catch (e) {
              return (e as Error).message;
            }
          }}
          onCancel={() => setDialog(null)}
          onCommit={(t) => {
            edit({ kind: 'set', path: dialog.path, value: JSON.parse(t) });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Strict-only problems (comments, trailing commas in .json) still allow editing. Real syntax errors
 * switch to a read-only preview of the repaired document, since path edits on broken text are unsafe.
 */
function analyze(doc: Doc) {
  const { value, repaired } = bestEffortValue(doc.text);
  return { value, errors: parseJson(doc.text, doc.strict).errors, preview: repaired };
}

interface BreadcrumbProps {
  path: JsonPath;
  rootLabel: string;
  onSelect: (path: JsonPath) => void;
  info: { nodes: number; depth: number; bytes: number } | null;
  onMenu: (e: MouseEvent) => void;
  onCopyPath: (e: MouseEvent<HTMLElement>) => void;
}

function Breadcrumbs({ path, rootLabel, onSelect, info, onMenu, onCopyPath }: BreadcrumbProps) {
  return (
    <div className="breadcrumbs">
      <button className="crumb" onClick={() => onSelect([])}>
        {rootLabel}
      </button>
      {path.map((seg, i) => (
        <span key={i}>
          <span className="crumb-sep">›</span>
          <button className="crumb" onClick={() => onSelect(path.slice(0, i + 1))}>
            {typeof seg === 'number' ? `[${seg}]` : seg}
          </button>
        </span>
      ))}
      <button className="icon-btn" title="Copy path" onClick={onCopyPath}>
        ⧉
      </button>
      <button className="icon-btn" title="Node actions" onClick={onMenu}>
        ⋯
      </button>
      <span className="spacer" />
      {info && (
        <span className="muted">
          {info.nodes.toLocaleString()} nodes · depth {info.depth} · {formatBytes(info.bytes)}
        </span>
      )}
    </div>
  );
}

function TableBreadcrumbs({ path, value, onNavigate }: { path: JsonPath; value: unknown; onNavigate: (p: JsonPath) => void }) {
  // Offer every tabular ancestor so users can climb back out of a drill-in.
  const crumbs: JsonPath[] = [];
  for (let i = 0; i <= path.length; i++) {
    const p = path.slice(0, i);
    if (isContainer(getAtPath(value, p))) crumbs.push(p);
  }
  return (
    <div className="breadcrumbs">
      <span className="muted">Table:</span>
      {crumbs.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="crumb-sep">›</span>}
          <button className={`crumb${i === crumbs.length - 1 ? ' current' : ''}`} onClick={() => onNavigate(p)}>
            {p.length ? (typeof p[p.length - 1] === 'number' ? `[${p[p.length - 1]}]` : String(p[p.length - 1])) : '$'}
          </button>
        </span>
      ))}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

