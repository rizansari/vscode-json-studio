import * as vscode from 'vscode';
import { parseJson } from '../core/parse';
import { formatPath } from '../core/path';
import { isJsonDoc, isStrict, pathAtCursor } from './util';

/** Shows the JSONPath at the cursor plus a validity badge for the active JSON editor. */
export class JsonStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private readonly subs: vscode.Disposable[];
  private cache: { uri: string; version: number; errors: number } | undefined;

  constructor(private readonly onCursorPath: (doc: vscode.TextDocument, path: (string | number)[]) => void) {
    this.item.command = 'jsonStudio.copyPath';
    this.subs = [
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.window.onDidChangeTextEditorSelection((e) => this.update(e.textEditor)),
      vscode.workspace.onDidChangeTextDocument((e) => e.document === vscode.window.activeTextEditor?.document && this.update()),
    ];
    this.update();
  }

  private update(editor = vscode.window.activeTextEditor) {
    if (!editor || !isJsonDoc(editor.document)) {
      this.item.hide();
      return;
    }
    const doc = editor.document;
    const path = pathAtCursor(editor);
    const errors = this.errorCount(doc);
    this.item.text = `${errors ? '$(warning)' : '$(json)'} ${formatPath(path, 'jsonpath')}`;
    this.item.tooltip = `${errors ? `${errors} syntax error(s) — run "JSON Studio: Repair JSON"` : 'Valid JSON'}\nClick to copy the path`;
    this.item.show();
    this.onCursorPath(doc, path);
  }

  private errorCount(doc: vscode.TextDocument): number {
    const uri = doc.uri.toString();
    if (this.cache?.uri !== uri || this.cache.version !== doc.version) {
      this.cache = { uri, version: doc.version, errors: parseJson(doc.getText(), isStrict(doc)).errors.length };
    }
    return this.cache.errors;
  }

  dispose() {
    this.subs.forEach((s) => s.dispose());
    this.item.dispose();
  }
}
