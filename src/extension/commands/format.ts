import * as vscode from 'vscode';
import { beautify, minify, sortKeys } from '../../core/format';
import { hasComments } from '../../core/parse';
import { formatPath, type PathStyle } from '../../core/path';
import { repairJson } from '../../core/repair';
import { closeDiffTabs, eolOf, indentSetting, replaceText, type PreviewProvider, type Target } from '../util';

export async function formatDoc({ doc }: Target) {
  await replaceText(doc, beautify(doc.getText(), indentSetting(), eolOf(doc)));
}

export async function minifyDoc({ doc }: Target) {
  if (!(await confirmLossy(doc, 'Minify'))) return;
  await replaceText(doc, minify(doc.getText()));
}

export async function sortKeysDoc({ doc }: Target) {
  if (!(await confirmLossy(doc, 'Sort keys'))) return;
  await replaceText(doc, sortKeys(doc.getText(), indentSetting()));
}

async function confirmLossy(doc: vscode.TextDocument, action: string): Promise<boolean> {
  if (!hasComments(doc.getText())) return true;
  const ok = await vscode.window.showWarningMessage(`${action} will remove the comments in this file.`, 'Continue');
  return ok === 'Continue';
}

/** Shows the repaired text in a diff and applies it only after confirmation. */
export async function repairDoc({ doc }: Target, previews: PreviewProvider, confirm = true) {
  const { text, changed } = repairJson(doc.getText(), indentSetting());
  if (!changed) {
    vscode.window.showInformationMessage('JSON Studio: nothing to repair.');
    return;
  }
  if (!confirm) {
    await replaceText(doc, text);
    return;
  }
  const preview = previews.create('repaired.json', text);
  await vscode.commands.executeCommand('vscode.diff', doc.uri, preview, 'Repair JSON (preview)', { preview: true, viewColumn: vscode.ViewColumn.Beside });
  const choice = await vscode.window.showInformationMessage('Apply the repaired JSON shown in the diff?', 'Apply', 'Cancel');
  await closeDiffTabs(preview);
  previews.dispose(preview);
  if (choice === 'Apply') await replaceText(doc, text);
}

const PATH_STYLES: { style: PathStyle; label: string }[] = [
  { style: 'jsonpath', label: 'JSONPath' },
  { style: 'js', label: 'JavaScript accessor' },
  { style: 'jq', label: 'jq' },
  { style: 'jmespath', label: 'JMESPath' },
  { style: 'pointer', label: 'JSON Pointer' },
];

export async function copyPath({ path }: Target) {
  const pick = await vscode.window.showQuickPick(
    PATH_STYLES.map((p) => ({ label: formatPath(path, p.style), description: p.label })),
    { placeHolder: 'Copy path as…' },
  );
  if (!pick) return;
  await vscode.env.clipboard.writeText(pick.label);
  vscode.window.setStatusBarMessage(`$(copy) ${pick.label}`, 2000);
}
