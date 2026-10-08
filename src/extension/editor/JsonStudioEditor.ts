import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { applyOps } from '../../core/edit';
import { rangeAtPath } from '../../core/parse';
import { formatPath, type JsonPath } from '../../core/path';
import { runQuery } from '../../core/query';
import { bestEffortValue } from '../../core/repair';
import type { HostMessage, WebviewMessage } from '../../shared/messages';
import { exportData } from '../commands/export';
import { QueryStore } from '../queryStore';
import { errorMessage, formatting, indentSetting, isStrict, replaceText, VIEW_TYPE, type ActiveStudio } from '../util';

interface Panel {
  doc: vscode.TextDocument;
  webview: vscode.Webview;
  /** Node last selected in the webview; commands without an explicit target act on it. */
  path: JsonPath;
}

export class JsonStudioEditor implements vscode.CustomTextEditorProvider {
  private readonly panels = new Set<Panel>();
  private active: Panel | undefined;
  /** Documents whose studio should focus the query bar as soon as it loads. */
  private readonly pendingQueryFocus = new Set<vscode.TextDocument>();
  /** Ignore cursor sync briefly after the studio itself moved the cursor, to avoid echo loops. */
  private suppressSelectUntil = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly queries: QueryStore,
  ) {}

  static register(context: vscode.ExtensionContext, queries: QueryStore): JsonStudioEditor {
    const provider = new JsonStudioEditor(context, queries);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
    );
    return provider;
  }

  /** The focused JSON Studio editor, if any. */
  activeStudio(): ActiveStudio | undefined {
    return this.active ? { doc: this.active.doc, path: this.active.path } : undefined;
  }

  /** Mirrors the text-editor cursor into every studio showing that document. */
  selectInStudios(doc: vscode.TextDocument, path: JsonPath) {
    if (Date.now() < this.suppressSelectUntil) return;
    for (const p of this.panels) if (p.doc === doc) this.post(p, { type: 'select', path });
  }

  /** Focuses the query bar of the studio for `doc`, opening one beside the text editor if needed. */
  async focusQuery(doc: vscode.TextDocument) {
    const panel = [...this.panels].find((p) => p.doc === doc);
    if (panel) {
      this.post(panel, { type: 'focusQuery' });
      return;
    }
    this.pendingQueryFocus.add(doc);
    await vscode.commands.executeCommand('vscode.openWith', doc.uri, VIEW_TYPE, vscode.ViewColumn.Beside);
  }

  resolveCustomTextEditor(doc: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    const webview = webviewPanel.webview;
    const distUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distUri] };
    webview.html = this.html(webview, distUri);

    const panel: Panel = { doc, webview, path: [] };
    this.panels.add(panel);
    if (webviewPanel.active) this.active = panel;

    const sendDoc = () => this.post(panel, { type: 'doc', text: doc.getText(), version: doc.version, strict: isStrict(doc), fileName: doc.fileName });
    const sendSettings = () => this.post(panel, { type: 'settings', indent: indentSetting() });
    const sendQueries = () => this.post(panel, { type: 'queries', ...this.queries.all() });

    let pending: NodeJS.Timeout | undefined;
    const disposables = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document !== doc || !e.contentChanges.length) return;
        clearTimeout(pending);
        pending = setTimeout(sendDoc, 150);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('jsonStudio') && sendSettings()),
      this.queries.onDidChange(sendQueries),
      webviewPanel.onDidChangeViewState(() => {
        if (webviewPanel.active) this.active = panel;
        else if (this.active === panel) this.active = undefined;
      }),
      webview.onDidReceiveMessage((m: WebviewMessage) => this.onMessage(panel, m, { sendDoc, sendSettings, sendQueries })),
    ];

    webviewPanel.onDidDispose(() => {
      clearTimeout(pending);
      disposables.forEach((d) => d.dispose());
      this.panels.delete(panel);
      if (this.active === panel) this.active = undefined;
    });
  }

  private async onMessage(panel: Panel, m: WebviewMessage, send: Record<'sendDoc' | 'sendSettings' | 'sendQueries', () => void>) {
    const { doc } = panel;
    try {
      switch (m.type) {
        case 'ready':
          send.sendSettings();
          send.sendQueries();
          send.sendDoc();
          if (this.pendingQueryFocus.delete(doc)) this.post(panel, { type: 'focusQuery' });
          break;
        case 'edit': {
          const next = applyOps(doc.getText(), m.ops, formatting(doc));
          if (!(await replaceText(doc, next))) throw new Error('The edit could not be applied');
          break;
        }
        case 'reveal':
          panel.path = m.path;
          await this.reveal(doc, m.path, m.open, m.offset);
          break;
        case 'query':
          try {
            const result = await runQuery(bestEffortValue(doc.getText()).value, m.request);
            this.post(panel, { type: 'queryResult', id: m.id, result });
            if (m.record && m.request.query.trim()) this.queries.addHistory({ mode: m.request.mode, query: m.request.query });
          } catch (e) {
            this.post(panel, { type: 'queryError', id: m.id, error: errorMessage(e) });
          }
          break;
        case 'export':
          await exportData(doc, m.target, m.format, m.data);
          break;
        case 'command':
          panel.path = m.path;
          if (m.command === 'openText') await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
          else await vscode.commands.executeCommand(`jsonStudio.${m.command}`, { uri: doc.uri.toString(), path: m.path });
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(m.text);
          vscode.window.setStatusBarMessage(`$(copy) Copied ${m.label ?? ''}`.trim(), 2000);
          break;
        case 'saveQuery':
          await this.queries.save(m.query);
          break;
        case 'deleteQuery':
          await this.queries.remove(m.query);
          break;
        case 'error':
          vscode.window.showErrorMessage(`JSON Studio: ${m.message}`);
          break;
      }
    } catch (e) {
      vscode.window.showErrorMessage(`JSON Studio: ${errorMessage(e)}`);
      // Resync so the webview drops any optimistic state.
      send.sendDoc();
    }
  }

  private async reveal(doc: vscode.TextDocument, path: JsonPath, open: boolean, offset?: number) {
    const range = offset !== undefined ? { offset, length: 0 } : rangeAtPath(doc.getText(), path);
    if (!range) return;
    let editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    if (!editor && open) editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    if (!editor) {
      vscode.window.setStatusBarMessage(formatPath(path, 'jsonpath'), 3000);
      return;
    }
    // Anchor at the end so the cursor sits at the start of the value (where its path resolves).
    const sel = new vscode.Selection(doc.positionAt(range.offset + range.length), doc.positionAt(range.offset));
    this.suppressSelectUntil = Date.now() + 300;
    editor.selection = sel;
    editor.revealRange(sel, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private post(panel: Panel, message: HostMessage) {
    void panel.webview.postMessage(message);
  }

  private html(webview: vscode.Webview, distUri: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'index.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'index.css'));
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>JSON Studio</title>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
