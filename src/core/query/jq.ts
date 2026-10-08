interface JqModule {
  raw(json: string, filter: string, flags?: string[]): string;
}

let jqPromise: Promise<JqModule> | undefined;

function loadJq(): Promise<JqModule> {
  // jq-web resolves jq.wasm next to the running script, so the build copies it into dist/.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  jqPromise ??= require('jq-web') as Promise<JqModule>;
  return jqPromise;
}

/** Runs a jq filter; returns every value the filter emits. */
export async function runJq(data: unknown, filter: string): Promise<unknown[]> {
  const jq = await loadJq();
  let raw: string;
  try {
    raw = jq.raw(JSON.stringify(data ?? null), filter, ['-c']);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg.replace(/^Non-zero exit code: \d+\s*/, '').trim());
  }
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}
