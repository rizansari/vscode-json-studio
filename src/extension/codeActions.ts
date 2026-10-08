import * as vscode from 'vscode';
import { needsRepair } from '../core/repair';
import { isStrict } from './util';

/** Offers "Repair JSON" as a quick fix wherever the document fails to parse. */
export class RepairCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];
  /** Code actions are requested on every cursor move; parse each document version once. */
  private readonly cache = new WeakMap<vscode.TextDocument, { version: number; broken: boolean }>();

  private isBroken(doc: vscode.TextDocument): boolean {
    const hit = this.cache.get(doc);
    if (hit?.version === doc.version) return hit.broken;
    const broken = needsRepair(doc.getText(), isStrict(doc));
    this.cache.set(doc, { version: doc.version, broken });
    return broken;
  }

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    if (!this.isBroken(doc)) return [];
    const action = new vscode.CodeAction('Repair JSON (JSON Studio)', vscode.CodeActionKind.QuickFix);
    action.command = { command: 'jsonStudio.repair', title: 'Repair JSON', arguments: [{ uri: doc.uri.toString(), path: [] }] };
    action.diagnostics = [...context.diagnostics];
    action.isPreferred = true;
    return [action];
  }
}
