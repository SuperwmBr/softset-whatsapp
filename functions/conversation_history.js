const CONVERSATION_TTL_SECONDS = 24 * 60 * 60;
const MAX_HISTORY_ITEMS = 24;
const MAX_HISTORY_JSON_CHARS = 90000;

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

export async function loadConversationHistory(env, phone, setupData = {}) {
  if (!env?.Whatsapp_threads) return [];

  const key = historyKey(phone, setupData);
  const raw = await env.Whatsapp_threads.get(key);

  if (raw) {
    try {
      return normalizeHistory(JSON.parse(raw));
    } catch (error) {
      console.warn('[AI][HISTORY] Histórico compartilhado inválido; reiniciando', {
        message: error?.message || String(error),
      });
      await env.Whatsapp_threads.delete(key);
    }
  }

  // Migra silenciosamente o histórico Groq v2 para o formato neutro, quando existir.
  try {
    const legacyRaw = await env.Whatsapp_threads.get(legacyGroqHistoryKey(phone, setupData));
    if (!legacyRaw) return [];

    const migrated = normalizeHistory(JSON.parse(legacyRaw));
    if (migrated.length) {
      await saveConversationHistory(env, phone, setupData, migrated);
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
  await env.Whatsapp_threads.put(historyKey(phone, setupData), JSON.stringify(trimmed), {
    expirationTtl: CONVERSATION_TTL_SECONDS,
  });
}

export async function saveConversationTurn(env, phone, setupData, previousHistory, userText, assistantText) {
  const next = trimHistory([
    ...(Array.isArray(previousHistory) ? previousHistory : []),
    { role: 'user', content: String(userText || '') },
    { role: 'assistant', content: String(assistantText || '') },
  ]);

  await saveConversationHistory(env, phone, setupData, next);
  return next;
}

export async function resetConversationHistory(env, phone, setupData = {}) {
  if (!env?.Whatsapp_threads) return;
  await env.Whatsapp_threads.delete(historyKey(phone, setupData));
}
