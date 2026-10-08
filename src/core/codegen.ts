import { InputData, jsonInputForTargetLanguage, quicktype, type LanguageName } from 'quicktype-core';

export interface TargetLanguage {
  id: string;
  label: string;
  language: string;
  options?: Record<string, string>;
}

export const LANGUAGES: TargetLanguage[] = [
  { id: 'typescript', label: 'TypeScript (interfaces)', language: 'typescript', options: { 'just-types': 'true' } },
  { id: 'typescript-zod', label: 'TypeScript + Zod', language: 'typescript' },
  { id: 'go', label: 'Go', language: 'go', options: { 'just-types': 'true' } },
  { id: 'python', label: 'Python (dataclasses)', language: 'python', options: { 'just-types': 'true', 'python-version': '3.7' } },
  { id: 'rust', label: 'Rust (serde)', language: 'rust' },
  { id: 'java', label: 'Java', language: 'java', options: { 'just-types': 'true', 'lombok': 'false' } },
  { id: 'cs', label: 'C#', language: 'csharp', options: { features: 'just-types' } },
  { id: 'kotlin', label: 'Kotlin', language: 'kotlin', options: { framework: 'just-types' } },
  { id: 'swift', label: 'Swift', language: 'swift', options: { 'just-types': 'true' } },
  { id: 'dart', label: 'Dart', language: 'dart', options: { 'just-types': 'true' } },
];

async function run(json: string, lang: LanguageName, topLevel: string, options?: Record<string, string>): Promise<string> {
  const input = jsonInputForTargetLanguage(lang);
  await input.addSource({ name: topLevel, samples: [json] });
  const inputData = new InputData();
  inputData.addInput(input);
  const result = await quicktype({ inputData, lang, rendererOptions: options, inferEnums: false, inferDateTimes: true });
  return result.lines.join('\n') + '\n';
}

export function generateTypes(json: string, languageId: string, topLevel = 'Root'): Promise<string> {
  const target = LANGUAGES.find((l) => l.id === languageId);
  if (!target) throw new Error(`Unknown language ${languageId}`);
  return run(json, target.id as LanguageName, topLevel, target.options);
}

export async function inferSchema(json: string, topLevel = 'Root'): Promise<string> {
  const out = await run(json, 'schema', topLevel);
  // quicktype emits definitions + $ref; keep it as-is but pretty.
  return JSON.stringify(JSON.parse(out), null, 2) + '\n';
}
