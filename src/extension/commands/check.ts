import * as path from 'path';
import * as vscode from 'vscode';
import { jsonPatch, normalizeForDiff, semanticDiff, type Change } from '../../core/diff';
import { parseJson, parseStrict, rangeAtPath } from '../../core/parse';
import { formatPath } from '../../core/path';
import { repairJson } from '../../core/repair';
import { validate } from '../../core/schema';
import { config, errorMessage, openUntitled, type PreviewProvider, type Target } from '../util';

/** Validates documents against a JSON Schema and keeps the diagnostics fresh while the user types. */
export class SchemaValidator implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('json-studio-schema');
  /** document uri → schema source (URL or file path) chosen for it. */
  private readonly bound = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        const key = e.document.uri.toString();
        if (!this.bound.has(key)) return;
        clearTimeout(this.timers.get(key));
        this.timers.set(key, setTimeout(() => void this.run(e.document, this.bound.get(key)!).catch(() => undefined), 400));
      }),
      vscode.workspace.onDidCloseTextDocument((d) => {
        this.bound.delete(d.uri.toString());
        this.diagnostics.delete(d.uri);
      }),
    ];
  }

  async command({ doc }: Target) {
    const source = await this.pickSchema(doc);
    if (!source) return;
    this.bound.set(doc.uri.toString(), source);
    const count = await this.run(doc, source);
    if (count === 0) vscode.window.showInformationMessage(`JSON Studio: valid against ${path.basename(source)} ✓`);
    else vscode.window.showWarningMessage(`JSON Studio: ${count} schema problem${count === 1 ? '' : 's'} (see Problems panel). Validation stays on while you edit.`);
  }

  private async pickSchema(doc: vscode.TextDocument): Promise<string | undefined> {
    const options: { label: string; description?: string; source?: string }[] = [];
    const declared = (parseJson(doc.getText()).value as Record<string, unknown> | undefined)?.$schema;
    if (typeof declared === 'string') options.push({ label: '$(link) $schema in document', description: declared, source: declared });
    const configured = config().get<string>('schema.path');
    if (configured) options.push({ label: '$(gear) Configured schema', description: configured, source: configured });
    const previous = this.bound.get(doc.uri.toString());
    if (previous && previous !== declared && previous !== configured) options.push({ label: '$(history) Last used', description: previous, source: previous });
    options.push({ label: '$(file) Choose schema file…' });
    options.push({ label: '$(globe) Enter schema URL…' });

    const pick = await vscode.window.showQuickPick(options, { placeHolder: 'Validate against…' });
    if (!pick) return undefined;
    if (pick.source) return pick.source;
    if (pick.label.includes('URL')) return vscode.window.showInputBox({ prompt: 'Schema URL', placeHolder: 'https://json.schemastore.org/package.json' });
    const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'JSON Schema': ['json'] }, openLabel: 'Use schema' });
    return files?.[0]?.fsPath;
  }

  private async loadSchema(doc: vscode.TextDocument, source: string): Promise<unknown> {
    if (/^https?:\/\//.test(source)) {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`Could not fetch schema (${res.status})`);
      return res.json();
    }
    // Relative paths: next to the document first, then the workspace root.
    const candidates = path.isAbsolute(source)
      ? [vscode.Uri.file(source)]
      : [
          ...(doc.isUntitled ? [] : [vscode.Uri.file(path.resolve(path.dirname(doc.fileName), source))]),
          ...(vscode.workspace.workspaceFolders ?? []).map((f) => vscode.Uri.joinPath(f.uri, source)),
        ];
    let uri: vscode.Uri | undefined;
    for (const c of candidates) {
      try {
        await vscode.workspace.fs.stat(c);
        uri = c;
        break;
      } catch {
        // try next
      }
    }
    if (!uri) throw new Error(`Schema file not found: ${source}`);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseStrict(Buffer.from(bytes).toString('utf8'));
  }

  /** Returns the number of issues found. */
  private async run(doc: vscode.TextDocument, source: string): Promise<number> {
    try {
      const schema = await this.loadSchema(doc, source);
      const text = doc.getText();
      const data = parseJson(text).value;
      const issues = validate(data, schema);
      this.diagnostics.set(
        doc.uri,
        issues.map((issue) => {
          const r = rangeAtPath(text, issue.path, issue.onKey) ?? { offset: 0, length: 1 };
          const d = new vscode.Diagnostic(new vscode.Range(doc.positionAt(r.offset), doc.positionAt(r.offset + r.length)), issue.message, vscode.DiagnosticSeverity.Warning);
          d.source = 'JSON Studio schema';
          d.code = formatPath(issue.path, 'jsonpath');
          return d;
        }),
      );
      return issues.length;
    } catch (e) {
      this.diagnostics.delete(doc.uri);
      vscode.window.showErrorMessage(`JSON Studio: schema validation failed: ${errorMessage(e)}`);
      return -1;
    }
  }

  dispose() {
    this.timers.forEach(clearTimeout);
    this.subs.forEach((s) => s.dispose());
    this.diagnostics.dispose();
  }
}

/** Parses text that is supposed to be JSON, repairing it if needed. */
function lenientParse(text: string): unknown {
  try {
    return parseStrict(text);
  } catch {
    return JSON.parse(repairJson(text).text);
  }
}

export async function diffWithFile(target: Target, previews: PreviewProvider) {
  const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json', 'jsonc', 'json5'] }, openLabel: 'Compare' });
  if (!files?.[0]) return;
  const other = Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString('utf8');
  await showDiff(target, lenientParse(other), path.basename(files[0].fsPath), previews);
}

export async function diffWithClipboard(target: Target, previews: PreviewProvider) {
  const clip = await vscode.env.clipboard.readText();
  if (!clip.trim()) {
    vscode.window.showWarningMessage('JSON Studio: the clipboard is empty.');
    return;
  }
  await showDiff(target, lenientParse(clip), 'clipboard', previews);
}

async function showDiff({ doc }: Target, right: unknown, rightLabel: string, previews: PreviewProvider) {
  const idKey = config().get<string>('diff.arrayIdKey', 'id');
  const left = lenientParse(doc.getText());
  const changes = semanticDiff(left, right, idKey);
  const leftName = doc.isUntitled ? 'document' : path.basename(doc.fileName);
  if (!changes.length) {
    vscode.window.showInformationMessage(`JSON Studio: ${leftName} and ${rightLabel} are semantically identical.`);
    return;
  }
  const l = previews.create(`${leftName} (normalized)`, normalizeForDiff(left, idKey));
  const r = previews.create(`${rightLabel} (normalized)`, normalizeForDiff(right, idKey));
  await vscode.commands.executeCommand('vscode.diff', l, r, `${leftName} ↔ ${rightLabel} (semantic)`);

  const counts = (k: Change['kind']) => changes.filter((c) => c.kind === k).length;
  const summary = `${changes.length} change(s): +${counts('added')} −${counts('removed')} ~${counts('changed')}`;
  const action = await vscode.window.showInformationMessage(`JSON Studio: ${summary}`, 'List changes', 'Export JSON Patch');
  if (action === 'List changes') {
    const list = changes.map((c) => ({ kind: c.kind, path: formatPath(c.path, 'jsonpath'), ...('before' in c ? { before: c.before } : {}), ...('after' in c ? { after: c.after } : {}) }));
    await openUntitled(JSON.stringify(list, null, 2) + '\n', 'json');
  } else if (action === 'Export JSON Patch') {
    await openUntitled(JSON.stringify(jsonPatch(left, right, idKey), null, 2) + '\n', 'json');
  }
}
