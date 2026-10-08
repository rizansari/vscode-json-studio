import * as path from 'path';
import * as vscode from 'vscode';
import { generateTypes, inferSchema, LANGUAGES } from '../../core/codegen';
import { FORMATS, fromFormat, toFormat, type Format } from '../../core/convert';
import { applyOps } from '../../core/edit';
import { indentString, stringify } from '../../core/format';
import { parseStrict } from '../../core/parse';
import { formatPath, getAtPath, type JsonPath } from '../../core/path';
import { applyTransform, TRANSFORMS } from '../../core/transform';
import { formatting, indentSetting, openUntitled, replaceText, type Target } from '../util';

/** Lets the user choose between the node at the cursor/selection and the whole document. */
async function pickScope(target: Target, action: string): Promise<JsonPath | undefined> {
  if (!target.path.length) return [];
  const pick = await vscode.window.showQuickPick(
    [
      { label: `$(symbol-field) Selected node`, description: formatPath(target.path, 'jsonpath'), path: target.path },
      { label: '$(file) Whole document', description: '$', path: [] as JsonPath },
    ],
    { placeHolder: `${action}: apply to…` },
  );
  return pick?.path;
}

function valueAt(doc: vscode.TextDocument, p: JsonPath): unknown {
  const value = getAtPath(parseStrict(doc.getText()), p);
  if (value === undefined) throw new Error(`Nothing at ${formatPath(p, 'jsonpath')}`);
  return value;
}

export async function transform(target: Target) {
  const pick = await vscode.window.showQuickPick(
    TRANSFORMS.map((t) => ({ label: t.label, detail: t.detail, t })),
    { placeHolder: 'Transform', matchOnDetail: true },
  );
  if (!pick) return;
  const scope = await pickScope(target, pick.label);
  if (!scope) return;
  let arg: string | undefined;
  if (pick.t.needsKey) {
    arg = await vscode.window.showInputBox({ prompt: 'Property to sort by (dot path; prefix with - for descending)', placeHolder: 'name or -meta.created' });
    if (arg === undefined) return;
  }
  const { doc } = target;
  const next = applyTransform(pick.t.id, valueAt(doc, scope), arg);
  const text = scope.length ? applyOps(doc.getText(), [{ kind: 'set', path: scope, value: next }], formatting(doc)) : stringify(next, indentSetting());
  await replaceText(doc, text);
}

export async function convertTo(target: Target) {
  const pick = await vscode.window.showQuickPick(
    FORMATS.filter((f) => f.id !== 'json').map((f) => ({ label: f.label, f })),
    { placeHolder: 'Convert JSON to…' },
  );
  if (!pick) return;
  const scope = await pickScope(target, `Convert to ${pick.label}`);
  if (!scope) return;
  await openUntitled(toFormat(valueAt(target.doc, scope), pick.f.id, indentString(indentSetting())), pick.f.language);
}

const LANGUAGE_FORMATS: Record<string, Format> = { yaml: 'yaml', csv: 'csv', tsv: 'tsv', xml: 'xml', toml: 'toml', json: 'json', jsonc: 'json' };

export async function convertFrom(target: Target) {
  const { doc } = target;
  const ext = path.extname(doc.fileName).slice(1).toLowerCase();
  let format = LANGUAGE_FORMATS[doc.languageId] ?? (ext === 'yml' ? 'yaml' : LANGUAGE_FORMATS[ext]);
  if (!format || format === 'json') {
    const pick = await vscode.window.showQuickPick(
      FORMATS.filter((f) => f.id !== 'json').map((f) => ({ label: f.label, f })),
      { placeHolder: 'Source format of the active document' },
    );
    if (!pick) return;
    format = pick.f.id;
  }
  await openUntitled(stringify(fromFormat(doc.getText(), format), indentSetting()), 'json');
}

export async function generateTypesCmd(target: Target) {
  const pick = await vscode.window.showQuickPick(
    LANGUAGES.map((l) => ({ label: l.label, l })),
    { placeHolder: 'Generate types for…' },
  );
  if (!pick) return;
  const scope = await pickScope(target, 'Generate types');
  if (!scope) return;
  const name = await vscode.window.showInputBox({ prompt: 'Top-level type name', value: topLevelName(target.doc, scope) });
  if (!name) return;
  const json = JSON.stringify(valueAt(target.doc, scope));
  const code = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Generating types…' }, () => generateTypes(json, pick.l.id, name));
  await openUntitled(code, pick.l.language);
}

export async function inferSchemaCmd(target: Target) {
  const scope = await pickScope(target, 'Infer schema');
  if (!scope) return;
  const json = JSON.stringify(valueAt(target.doc, scope));
  await openUntitled(await inferSchema(json, topLevelName(target.doc, scope)), 'json');
}

function topLevelName(doc: vscode.TextDocument, scope: JsonPath): string {
  const last = [...scope].reverse().find((s): s is string => typeof s === 'string');
  const raw = last ?? (doc.isUntitled ? 'Root' : path.basename(doc.fileName).replace(/\..*$/, ''));
  const pascal = raw.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, __, c: string) => c.toUpperCase()).replace(/^[^A-Za-z]+/, '');
  return pascal || 'Root';
}
