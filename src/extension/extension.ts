import * as vscode from 'vscode';
import { RepairCodeActions } from './codeActions';
import { diffWithClipboard, diffWithFile, SchemaValidator } from './commands/check';
import { copyPath, formatDoc, minifyDoc, repairDoc, sortKeysDoc } from './commands/format';
import { convertFrom, convertTo, generateTypesCmd, inferSchemaCmd, transform } from './commands/tools';
import { JsonStudioEditor } from './editor/JsonStudioEditor';
import { QueryStore } from './queryStore';
import { JsonStatusBar } from './statusBar';
import { errorMessage, PREVIEW_SCHEME, PreviewProvider, resolveTarget, VIEW_TYPE, type Target } from './util';

export function activate(context: vscode.ExtensionContext) {
  const queries = new QueryStore(context.workspaceState);
  const studio = JsonStudioEditor.register(context, queries);
  const previews = new PreviewProvider();
  const validator = new SchemaValidator();

  const command = (name: string, run: (target: Target) => unknown) =>
    vscode.commands.registerCommand(`jsonStudio.${name}`, async (arg?: unknown) => {
      try {
        const target = await resolveTarget(arg, () => studio.activeStudio());
        if (target) await run(target);
      } catch (e) {
        vscode.window.showErrorMessage(`JSON Studio: ${errorMessage(e)}`);
      }
    });

  const openWith = (column?: vscode.ViewColumn) => async (arg?: unknown) => {
    const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      vscode.window.showWarningMessage('JSON Studio: open a JSON file first.');
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, column);
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, previews),
    validator,
    new JsonStatusBar((doc, path) => studio.selectInStudios(doc, path)),
    vscode.languages.registerCodeActionsProvider([{ language: 'json' }, { language: 'jsonc' }], new RepairCodeActions(), {
      providedCodeActionKinds: RepairCodeActions.kinds,
    }),

    vscode.commands.registerCommand('jsonStudio.open', openWith()),
    vscode.commands.registerCommand('jsonStudio.openToSide', openWith(vscode.ViewColumn.Beside)),
    command('query', ({ doc }) => studio.focusQuery(doc)),

    command('format', formatDoc),
    command('minify', minifyDoc),
    command('sortKeys', sortKeysDoc),
    command('repair', (t) => repairDoc(t, previews)),
    command('copyPath', copyPath),

    command('transform', transform),
    command('convertTo', convertTo),
    command('convertFrom', convertFrom),
    command('generateTypes', generateTypesCmd),
    command('inferSchema', inferSchemaCmd),

    command('validateSchema', (t) => validator.command(t)),
    command('diffWithFile', (t) => diffWithFile(t, previews)),
    command('diffWithClipboard', (t) => diffWithClipboard(t, previews)),
  );
}

export function deactivate() {}
