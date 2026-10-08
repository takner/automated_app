// Structured logging with redaction. Never log tokens, passwords, push keys or transcripts.
const SECRET_KEYS = /token|secret|password|authorization|cookie|p256dh|auth$|key|code|transcript|refresh/i;

function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v == null) return v;
  if (v instanceof Error) return { name: v.name, message: v.message.slice(0, 300) };
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(val, depth + 1);
    return out;
  }
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  return v;
}

function write(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data ? (redact(data) as object) : {}) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data),
};
