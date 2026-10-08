import type { HostMessage, WebviewMessage } from '../../src/shared/messages';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: (m) => console.log('[post]', m), getState: () => undefined, setState: () => undefined };

export function post(message: WebviewMessage) {
  api.postMessage(message);
}

export function onHostMessage(handler: (m: HostMessage) => void): () => void {
  const listener = (e: MessageEvent<HostMessage>) => handler(e.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** View state that survives the webview being hidden/restored. */
export interface PersistedState {
  tab?: 'tree' | 'table';
  tablePath?: (string | number)[] | null;
  flatten?: boolean;
}

export function loadState(): PersistedState {
  return (api.getState() as PersistedState | undefined) ?? {};
}

export function saveState(patch: PersistedState) {
  api.setState({ ...loadState(), ...patch });
}
