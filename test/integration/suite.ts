import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const ws = () => vscode.workspace.workspaceFolders![0].uri;

async function open(name: string) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(ws(), name));
  await vscode.window.showTextDocument(doc);
  return doc;
}

const tests: [string, () => Promise<void>][] = [
  ['activates and registers commands', async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'json-studio')!;
    await ext.activate();
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ['jsonStudio.format', 'jsonStudio.repair', 'jsonStudio.query', 'jsonStudio.diffWithFile']) assert.ok(cmds.includes(c), c);
  }],
  ['minify, beautify and sort keys rewrite the document', async () => {
    const doc = await open('nested.json');
    const arg = { uri: doc.uri.toString(), path: [] };
    await vscode.commands.executeCommand('jsonStudio.minify', arg);
    assert.ok(!doc.getText().includes('\n'), 'minified');
    await vscode.commands.executeCommand('jsonStudio.format', arg);
    assert.ok(doc.getText().startsWith('{\n  "$schema"'), 'beautified');
    await vscode.commands.executeCommand('jsonStudio.sortKeys', arg);
    const keys = Object.keys(JSON.parse(doc.getText()).store);
    assert.deepStrictEqual(keys, [...keys].sort());
    await vscode.commands.executeCommand('undo');
    assert.notDeepStrictEqual(Object.keys(JSON.parse(doc.getText()).store), [...keys].sort(), 'undo restores order');
  }],
  ['offers the Repair quick fix on broken JSON', async () => {
    const doc = await open('broken.json');
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, new vscode.Range(0, 0, 0, 1));
    assert.ok(actions.some((a) => a.title === 'Repair JSON (JSON Studio)'));
  }],
  ['opens the JSON Studio custom editor', async () => {
    const uri = vscode.Uri.joinPath(ws(), 'nested.json');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'jsonStudio.editor');
    await new Promise((r) => setTimeout(r, 1500));
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === 'jsonStudio.editor', 'custom editor active');
  }],
  ['jq runs from the packaged bundle', async () => {
    // The bundled jq.wasm must sit next to dist/extension.js.
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'json-studio')!;
    assert.ok(require('fs').existsSync(path.join(ext.extensionPath, 'dist', 'jq.wasm')));
  }],
];

export async function run() {
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
      failures.push(name);
    }
  }
  if (failures.length) throw new Error(`${failures.length} integration test(s) failed`);
}
