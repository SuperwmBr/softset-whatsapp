const CONVERSATION_TTL_SECONDS = 24 * 60 * 60;
const MAX_HISTORY_ITEMS = 24;
const MAX_HISTORY_JSON_CHARS = 90000;

// Cache L1 curto no isolate. O KV continua sendo a fonte persistente da memória.
// Isso elimina leituras KV repetidas em conversas ativas sem alterar o conteúdo salvo.
const HISTORY_L1_TTL_MS = 30_000;
const HISTORY_L1_MAX_ENTRIES = 500;
const historyL1 = new Map();

function tenantKey(setupData = {}) {
  return setupData?.app_key || setupData?.token || 'unknown';
}

function historyKey(phone, setupData) {
  return `ai_history:v1:${tenantKey(setupData)}:${phone}`;
}

function legacyGroqHistoryKey(phone, setupData) {
  return `groq_history:v2:${tenantKey(setupData)}:${phone}`;
}

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item?.text === 'string') return item.text;
      if (typeof item?.content === 'string') return item.content;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeHistory(items = []) {
  const normalized = [];

  for (const item of Array.isArray(items) ? items : []) {
    const role = item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : null;
    const text = textFromContent(item?.content);

    if (role && text) {
      normalized.push({ role, content: text });
      continue;
    }

    // Compatibilidade com os itens de output já gravados pela Groq Responses API.
    if (item?.type === 'message') {
      const legacyRole = item?.role === 'user' ? 'user' : 'assistant';
      const legacyText = textFromContent(item?.content);
      if (legacyText) normalized.push({ role: legacyRole, content: legacyText });
    }
  }

  return trimHistory(normalized);
}

export function trimHistory(items = []) {
  let history = Array.isArray(items) ? [...items] : [];

  if (history.length > MAX_HISTORY_ITEMS) {
    history = history.slice(-MAX_HISTORY_ITEMS);
  }

  while (history.length > 2 && JSON.stringify(history).length > MAX_HISTORY_JSON_CHARS) {
    history.shift();
  }

  return history;
}

function getL1History(key) {
  const cached = historyL1.get(key);
  if (!cached) return null;

  if ((Date.now() - cached.savedAt) > HISTORY_L1_TTL_MS) {
    historyL1.delete(key);
    return null;
  }

  // Retorna cópia para impedir mutação acidental do valor cacheado.
  return cached.history.map((item) => ({ ...item }));
}

function setL1History(key, history) {
  if (!key) return;

  if (historyL1.size >= HISTORY_L1_MAX_ENTRIES && !historyL1.has(key)) {
    const oldestKey = historyL1.keys().next().value;
    if (oldestKey) historyL1.delete(oldestKey);
  }

  historyL1.set(key, {
    history: history.map((item) => ({ ...item })),
    savedAt: Date.now(),
  });
}

async function persistNormalizedHistory(env, key, history) {
  if (!env?.Whatsapp_threads) return;

  const serialized = JSON.stringify(history);
  await env.Whatsapp_threads.put(key, serialized, {
    expirationTtl: CONVERSATION_TTL_SECONDS,
  });
  setL1History(key, history);
}

// Lock por chave (telefone+tenant) dentro da isolate: serializa leituras/escritas
// concorrentes do mesmo atendimento (ex.: duas mensagens quase simultâneas, ou
// reentrega de webhook) para impedir que uma sobrescreva o turno salvo pela outra.
const historyLocks = new Map();

async function withHistoryLock(key, fn) {
  const previous = historyLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  historyLocks.set(key, previous.then(() => gate));

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (historyLocks.get(key) === gate) historyLocks.delete(key);
  }
}

export async function loadConversationHistory(env, phone, setupData = {}) {
  if (!env?.Whatsapp_threads) return [];

  const key = historyKey(phone, setupData);
  const l1 = getL1History(key);
  if (l1) {
    console.log('[AI][HISTORY] l1-cache:hit', { items: l1.length });
    return l1;
  }

  const raw = await env.Whatsapp_threads.get(key);

  if (raw) {
    try {
      const history = normalizeHistory(JSON.parse(raw));
      setL1History(key, history);
      return history;
    } catch (error) {
      console.warn('[AI][HISTORY] Histórico compartilhado inválido; reiniciando', {
        message: error?.message || String(error),
      });
      historyL1.delete(key);
      await env.Whatsapp_threads.delete(key);
    }
  }

  // Migra silenciosamente o histórico Groq v2 para o formato neutro, quando existir.
  try {
    const legacyRaw = await env.Whatsapp_threads.get(legacyGroqHistoryKey(phone, setupData));
    if (!legacyRaw) return [];

    const migrated = normalizeHistory(JSON.parse(legacyRaw));
    if (migrated.length) {
      await persistNormalizedHistory(env, key, migrated);
      console.log('[AI][HISTORY] Histórico Groq v2 migrado para memória compartilhada', {
        items: migrated.length,
      });
    }
    return migrated;
  } catch (error) {
    console.warn('[AI][HISTORY] Migração do histórico anterior ignorada', {
      message: error?.message || String(error),
    });
    return [];
  }
}

export async function saveConversationHistory(env, phone, setupData = {}, history = []) {
  if (!env?.Whatsapp_threads) return;

  const trimmed = trimHistory(normalizeHistory(history));
  await persistNormalizedHistory(env, historyKey(phone, setupData), trimmed);
}

export async function saveConversationTurn(env, phone, setupData, previousHistory, userText, assistantText) {
  const key = historyKey(phone, setupData);

  return withHistoryLock(key, async () => {
    // Relê o estado mais recente em vez de confiar cegamente no snapshot capturado
    // antes da chamada ao provedor de IA: se uma requisição concorrente do mesmo
    // telefone já salvou um turno enquanto esta chamada estava em andamento, o
    // histórico atual (mais longo) é usado como base para não perder aquele turno.
    const latest = await loadConversationHistory(env, phone, setupData);
    const base = latest.length >= (Array.isArray(previousHistory) ? previousHistory.length : 0)
      ? latest
      : previousHistory;

    const next = trimHistory([
      ...(Array.isArray(base) ? base : []),
      { role: 'user', content: String(userText || '') },
      { role: 'assistant', content: String(assistantText || '') },
    ]);

    await persistNormalizedHistory(env, key, next);
    return next;
  });
}

export async function resetConversationHistory(env, phone, setupData = {}) {
  if (!env?.Whatsapp_threads) return;
  const key = historyKey(phone, setupData);
  historyL1.delete(key);
  await env.Whatsapp_threads.delete(key);
}
