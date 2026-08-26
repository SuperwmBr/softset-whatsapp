import legacyWorker from './worker.js';

const SENSITIVE_KEY_RE = /(^|_)(authorization|password|passwd|secret|api[_-]?key|connectiontoken|token[_-]?zapi|zapi[_-]?secretkey|key)(_|$)/i;
const EXPLICIT_SENSITIVE_KEYS = new Set([
  'Authorization',
  'authorization',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'FRAUDGUARD_API_KEY',
  'ConnectionTokenAPI',
  'token_zapi',
  'zAPI_SecretKey',
  'key',
]);
const MAX_LOG_STRING = 4000;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_KEYS = 80;
const MAX_DEPTH = 6;

function isSafeDiagnosticKey(key) {
  return /(?:_present|_length|_count|_enabled|_available)$/i.test(key);
}

function shouldRedactKey(key) {
  if (!key || isSafeDiagnosticKey(key)) return false;
  return EXPLICIT_SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_RE.test(key);
}

function sanitizeString(value) {
  if (value.length <= MAX_LOG_STRING) return value;
  return `${value.slice(0, MAX_LOG_STRING)}… [truncated ${value.length - MAX_LOG_STRING} chars]`;
}

function sanitizeForLog(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(String(value.message || '')),
      stack: sanitizeString(String(value.stack || '')),
    };
  }

  if (typeof value !== 'object') return String(value);
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) sliced.push(`[+${value.length - MAX_ARRAY_ITEMS} items]`);
    return sliced;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto && proto !== Object.prototype && proto !== null) {
    // Não tenta clonar objetos internos do runtime (Request/Response/etc.).
    return value;
  }

  const out = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  for (const [key, item] of entries) {
    out[key] = shouldRedactKey(key) ? '[REDACTED]' : sanitizeForLog(item, depth + 1, seen);
  }
  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    out.__truncated_keys = Object.keys(value).length - MAX_OBJECT_KEYS;
  }
  return out;
}

function installSafeConsole() {
  const marker = Symbol.for('softset.safeConsole.installed');
  if (globalThis[marker]) return;
  globalThis[marker] = true;

  for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
    const original = console[level]?.bind(console);
    if (!original) continue;
    console[level] = (...args) => original(...args.map((arg) => sanitizeForLog(arg)));
  }
}

installSafeConsole();

export default {
  fetch(request, env, ctx) {
    return legacyWorker.fetch.call(legacyWorker, request, env, ctx);
  },

  queue(batch, env, ctx) {
    if (typeof legacyWorker.queue !== 'function') return undefined;
    return legacyWorker.queue.call(legacyWorker, batch, env, ctx);
  },

  scheduled(controller, env, ctx) {
    if (typeof legacyWorker.scheduled !== 'function') return undefined;
    return legacyWorker.scheduled.call(legacyWorker, controller, env, ctx);
  },
};
