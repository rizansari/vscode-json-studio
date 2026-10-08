import * as path from 'path';
import * as vscode from 'vscode';
import { FORMATS, toFormat, type Format } from '../../core/convert';
import { indentString } from '../../core/format';
import type { ExportTarget } from '../../shared/messages';
import { indentSetting, openUntitled, replaceText } from '../util';

/** Sends query/table results somewhere: a new tab, a file, the clipboard, or back into the document. */
export async function exportData(doc: vscode.TextDocument, target: ExportTarget, format: Format, data: unknown) {
  const info = FORMATS.find((f) => f.id === format)!;
  const content = toFormat(data, format, indentString(indentSetting()));

  switch (target) {
    case 'newTab':
      await openUntitled(content, info.language);
      return;
    case 'copy':
      await vscode.env.clipboard.writeText(content);
      vscode.window.setStatusBarMessage(`$(copy) Copied result as ${info.label}`, 2000);
      return;
    case 'replace': {
      if (format !== 'json') throw new Error('Only JSON can replace the document');
      const ok = await vscode.window.showWarningMessage('Replace the whole document with this result? (Undo with Ctrl/Cmd+Z)', { modal: true }, 'Replace');
      if (ok === 'Replace') await replaceText(doc, content);
      return;
    }
    case 'save': {
      const base = doc.isUntitled ? 'result' : path.basename(doc.fileName).replace(/\.[^.]+$/, '');
      const dir = doc.isUntitled ? vscode.workspace.workspaceFolders?.[0]?.uri : vscode.Uri.file(path.dirname(doc.fileName));
      const defaultUri = dir ? vscode.Uri.joinPath(dir, `${base}.result.${info.ext}`) : undefined;
      const uri = await vscode.window.showSaveDialog({ defaultUri, filters: { [info.label]: [info.ext] }, saveLabel: 'Save result' });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      const open = await vscode.window.showInformationMessage(`Saved ${path.basename(uri.fsPath)}`, 'Open');
      if (open) await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
      return;
    }
  }
}
