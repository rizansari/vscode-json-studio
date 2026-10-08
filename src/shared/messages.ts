import type { Format } from '../core/convert';
import type { EditOp } from '../core/edit';
import type { JsonPath } from '../core/path';
import type { QueryMode, QueryRequest, QueryResult } from '../core/query/types';

export interface SavedQuery {
  mode: QueryMode;
  query: string;
  name?: string;
}

export type ExportTarget = 'newTab' | 'save' | 'copy' | 'replace';

/** Host commands the webview toolbar can trigger; they act on this document (and the selected node). */
export type ToolCommand =
  | 'format'
  | 'minify'
  | 'sortKeys'
  | 'repair'
  | 'transform'
  | 'convertTo'
  | 'generateTypes'
  | 'inferSchema'
  | 'validateSchema'
  | 'diffWithFile'
  | 'diffWithClipboard'
  | 'openText';

export type HostMessage =
  | { type: 'doc'; text: string; version: number; strict: boolean; fileName: string }
  | { type: 'settings'; indent: string }
  | { type: 'queryResult'; id: number; result: QueryResult }
  | { type: 'queryError'; id: number; error: string }
  | { type: 'queries'; history: SavedQuery[]; saved: SavedQuery[] }
  | { type: 'select'; path: JsonPath }
  | { type: 'focusQuery' };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'edit'; ops: EditOp[] }
  | { type: 'reveal'; path: JsonPath; open: boolean; offset?: number }
  /** `record` adds the query to history (explicit runs only, not live-as-you-type). */
  | { type: 'query'; id: number; request: QueryRequest; record: boolean }
  | { type: 'export'; target: ExportTarget; format: Format; data: unknown }
  | { type: 'command'; command: ToolCommand; path: JsonPath }
  | { type: 'copy'; text: string; label?: string }
  | { type: 'saveQuery'; query: SavedQuery }
  | { type: 'deleteQuery'; query: SavedQuery }
  | { type: 'error'; message: string };
