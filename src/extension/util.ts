import * as vscode from 'vscode';
import { minimalEdit } from '../core/edit';
import { formattingOptions, type IndentSetting } from '../core/format';
import { parseJson, pathAtOffset } from '../core/parse';
import type { JsonPath } from '../core/path';

export const VIEW_TYPE = 'jsonStudio.editor';
export const PREVIEW_SCHEME = 'json-studio';

export function config() {
  return vscode.workspace.getConfiguration('jsonStudio');
}

export function indentSetting(): IndentSetting {
  return config().get<IndentSetting>('indent', '2');
}

export function eolOf(doc: vscode.TextDocument): string {
  return doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

export function formatting(doc: vscode.TextDocument) {
  return formattingOptions(indentSetting(), eolOf(doc));
}

export function isJsonDoc(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'json' || doc.languageId === 'jsonc' || /\.json[c5]?$/i.test(doc.fileName);
}

/** Plain .json is strict; .jsonc / .json5 and the jsonc language accept comments and trailing commas. */
export function isStrict(doc: vscode.TextDocument): boolean {
  return doc.languageId !== 'jsonc' && !/\.json[c5]$/i.test(doc.fileName);
}

export function parseDoc(doc: vscode.TextDocument) {
  return parseJson(doc.getText());
}

/** Replaces the document text with a single minimal edit so undo, dirty state and cursor stay sane. */
export async function replaceText(doc: vscode.TextDocument, next: string): Promise<boolean> {
  const edit = minimalEdit(doc.getText(), next);
  if (!edit) return true;
  const we = new vscode.WorkspaceEdit();
  we.replace(doc.uri, new vscode.Range(doc.positionAt(edit.offset), doc.positionAt(edit.offset + edit.length)), edit.content);
  return vscode.workspace.applyEdit(we);
}

export async function openUntitled(content: string, language: string, beside = true): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  return vscode.window.showTextDocument(doc, beside ? vscode.ViewColumn.Beside : undefined);
}

/** Read-only virtual documents for previews (repair preview, normalized diff sides). */
export class PreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private counter = 0;

  create(label: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: '/' + label, query: String(++this.counter) });
    this.contents.set(uri.toString(), content);
    return uri;
  }

  dispose(uri: vscode.Uri) {
    this.contents.delete(uri.toString());
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
}

export async function closeDiffTabs(modified: vscode.Uri) {
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.toString() === modified.toString());
  if (tabs.length) await vscode.window.tabGroups.close(tabs);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** What a command acts on: a document plus an optional node inside it. */
export interface Target {
  doc: vscode.TextDocument;
  path: JsonPath;
}

/** Argument passed when a command is triggered from the JSON Studio webview. */
export interface CommandArg {
  uri: string;
  path: JsonPath;
}

export interface ActiveStudio {
  doc: vscode.TextDocument;
  path: JsonPath;
}

export async function resolveTarget(arg: unknown, active: () => ActiveStudio | undefined): Promise<Target | undefined> {
  if (arg && typeof arg === 'object' && 'uri' in arg && typeof (arg as CommandArg).uri === 'string') {
    const a = arg as CommandArg;
    return { doc: await vscode.workspace.openTextDocument(vscode.Uri.parse(a.uri)), path: a.path ?? [] };
  }
  if (arg instanceof vscode.Uri) return { doc: await vscode.workspace.openTextDocument(arg), path: [] };
  const studio = active();
  if (studio) return studio;
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return { doc: editor.document, path: pathAtCursor(editor) };
  }
  vscode.window.showWarningMessage('JSON Studio: open a JSON file first.');
  return undefined;
}

export function pathAtCursor(editor: vscode.TextEditor): JsonPath {
  if (!isJsonDoc(editor.document)) return [];
  return pathAtOffset(editor.document.getText(), editor.document.offsetAt(editor.selection.active));
}
