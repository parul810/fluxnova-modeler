const START = Date.now();
const TRACE_ENABLED = process.env.TRACE_CALLS !== 'false';

export function truncate(value, limit = 400) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return String(text);
  return text.length > limit ? `${text.slice(0, limit)}…(${text.length} chars total)` : text;
}

export function redactHeaders(headers) {
  if (!headers) return headers;
  const redacted = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = /auth|token|key|secret|cookie/i.test(key) ? '***' : value;
  }
  return redacted;
}

export function trace(tag, message) {
  if (!TRACE_ENABLED) return;
  const elapsed = ((Date.now() - START) / 1000).toFixed(3).padStart(8, ' ');
  console.log(`[+${elapsed}s] [${tag}] ${message}`);
}
