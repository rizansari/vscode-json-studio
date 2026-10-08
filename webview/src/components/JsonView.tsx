import { useMemo } from 'react';

const LIMIT = 400_000;
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Read-only, syntax-highlighted JSON (truncated for very large results). */
export function JsonView({ value }: { value: unknown }) {
  const { parts, truncated } = useMemo(() => {
    const full = JSON.stringify(value, null, 2) ?? 'undefined';
    const text = full.length > LIMIT ? full.slice(0, LIMIT) : full;
    const out: { text: string; cls?: string }[] = [];
    let last = 0;
    for (const m of text.matchAll(TOKEN)) {
      if (m.index! > last) out.push({ text: text.slice(last, m.index) });
      const cls = m[1] ? (m[2] ? 'key' : 'v-string') : m[3] ? 'v-boolean' : m[0] === 'null' ? 'v-null' : 'v-number';
      if (m[1] && m[2]) {
        out.push({ text: m[1], cls });
        out.push({ text: m[2] });
      } else out.push({ text: m[0], cls });
      last = m.index! + m[0].length;
    }
    out.push({ text: text.slice(last) });
    return { parts: out, truncated: full.length > LIMIT };
  }, [value]);

  return (
    <pre className="json-view">
      {parts.map((p, i) => (p.cls ? <span key={i} className={p.cls}>{p.text}</span> : p.text))}
      {truncated && <div className="empty">… truncated. Use “Open in new tab” to see everything.</div>}
    </pre>
  );
}
