import { useMemo, useState, type MouseEvent } from 'react';
import { formatPath, type JsonPath } from '../../../src/core/path';
import type { QueryResult } from '../../../src/core/query/types';
import { copy } from '../actions';
import { compact, isTabular, preview, typeOf } from '../model';
import { post } from '../vscode';
import { JsonView } from './JsonView';
import { useMenu } from './Menu';
import { TableView } from './TableView';

type View = 'matches' | 'json' | 'table';

interface Props {
  result: QueryResult;
  onSelect: (path: JsonPath) => void;
  onClose: () => void;
}

export function Results({ result, onSelect, onClose }: Props) {
  const openMenu = useMenu();
  const tabular = useMemo(() => isTabular(result.output), [result.output]);
  const [preferred, setPreferred] = useState<View>('matches');
  const [flatten, setFlatten] = useState(false);
  const available: View[] = [...(result.matches ? ['matches' as const] : []), 'json', ...(tabular ? ['table' as const] : [])];
  const view = available.includes(preferred) ? preferred : available[0];

  const exportTo = (target: 'newTab' | 'save' | 'copy' | 'replace', format: 'json' | 'csv' | 'yaml') => post({ type: 'export', target, format, data: result.output });

  const saveMenu = (e: MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [
      { section: 'Save result to file' },
      { label: 'JSON…', onClick: () => exportTo('save', 'json') },
      { label: 'CSV…', onClick: () => exportTo('save', 'csv') },
      { label: 'YAML…', onClick: () => exportTo('save', 'yaml') },
      { section: 'Open in new tab' },
      { label: 'as CSV', onClick: () => exportTo('newTab', 'csv') },
      { label: 'as YAML', onClick: () => exportTo('newTab', 'yaml') },
      'separator',
      { label: 'Replace document with result…', danger: true, onClick: () => exportTo('replace', 'json') },
    ]);

  return (
    <div className="results">
      <div className="results-header">
        <div className="seg">
          {available.map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setPreferred(v)}>
              {v === 'matches' ? `Matches (${result.matches!.length})` : v === 'json' ? 'Result JSON' : 'Table'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn small" onClick={() => exportTo('newTab', 'json')} title="Open the result as a new untitled JSON document">
          Open in new tab
        </button>
        <button className="btn small" onClick={saveMenu}>
          Save / Export ▾
        </button>
        <button className="btn small" onClick={() => exportTo('copy', 'json')}>
          Copy
        </button>
        <button className="icon-btn" onClick={onClose} title="Close results (Esc in query box)">
          ✕
        </button>
      </div>
      <div className="results-body">
        {view === 'matches' && result.matches && (
          <div className="match-list">
            {result.matches.length === 0 && <div className="empty">No matches.</div>}
            {result.matches.slice(0, 5000).map((m, i) => (
              <div
                key={i}
                className="match"
                onClick={() => onSelect(m.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(e, [
                    { label: 'Copy value', onClick: () => copy(JSON.stringify(m.value, null, 2), 'value') },
                    { label: 'Copy path', onClick: () => copy(formatPath(m.path, 'jsonpath'), 'path') },
                  ]);
                }}
              >
                <span className="match-path">{formatPath(m.path, 'jsonpath')}</span>
                <span className={`value v-${typeOf(m.value)}`}>{typeof m.value === 'object' && m.value !== null ? `${preview(m.value)} ${compact(m.value, 100)}` : preview(m.value, 200)}</span>
              </div>
            ))}
            {result.matches.length > 5000 && <div className="empty">Showing first 5000 of {result.matches.length}. Export to see all.</div>}
          </div>
        )}
        {view === 'json' && <JsonView value={result.output} />}
        {view === 'table' && <TableView data={result.output} path={[]} readOnly flatten={flatten} setFlatten={setFlatten} />}
      </div>
    </div>
  );
}
