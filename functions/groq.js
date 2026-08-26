const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const CONVERSATION_TTL_SECONDS = 24 * 60 * 60;
const MAX_HISTORY_ITEMS = 24;
const MAX_HISTORY_JSON_CHARS = 90000;

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    status: error?.status || null,
  };
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  const parts = [];

  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
      if (content?.type === 'text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }

  return parts.join('\n').trim();
}

function conversationKey(phone, setupData) {
  const tenant = setupData?.app_key || setupData?.token || 'unknown';
  // v2 evita interpretar antigos response_id como histórico JSON.
  return `groq_history:v2:${tenant}:${phone}`;
}

function trimHistory(items = []) {
  let history = Array.isArray(items) ? [...items] : [];

  if (history.length > MAX_HISTORY_ITEMS) {
    history = history.slice(-MAX_HISTORY_ITEMS);
  }

  while (history.length > 2 && JSON.stringify(history).length > MAX_HISTORY_JSON_CHARS) {
    history.shift();
  }

  return history;
}

async function loadConversationHistory(env, phone, setupData) {
  if (!env?.Whatsapp_threads) return [];

  const key = conversationKey(phone, setupData);
  const raw = await env.Whatsapp_threads.get(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return trimHistory(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    console.warn('[GROQ][HISTORY] Histórico inválido; reiniciando conversa', safeError(error));
    await env.Whatsapp_threads.delete(key);
    return [];
  }
}

async function saveConversationHistory(env, phone, setupData, history) {
  if (!env?.Whatsapp_threads) return;

  const key = conversationKey(phone, setupData);
  const trimmed = trimHistory(history);

  await env.Whatsapp_threads.put(key, JSON.stringify(trimmed), {
    expirationTtl: CONVERSATION_TTL_SECONDS,
  });
}

export function groqEnabled(env) {
  return Boolean(env?.GROQ_API_KEY);
}

export function groqModel(env) {
  return env?.GROQ_MODEL || DEFAULT_GROQ_MODEL;
}

export async function loadGroqInstructions(env, setupData = {}) {
  const tenant = setupData?.app_key || setupData?.token || '';
  const fallback = String(setupData?.prompt_na_pergunta || '').trim();

  if (!env?.db || !tenant) return fallback;

  try {
    const row = await env.db.prepare(`
      SELECT instructions
      FROM ai_instructions
      WHERE token = ? OR app_key = ?
      ORDER BY COALESCE(version, 0) DESC, COALESCE(updated_at, created_at) DESC
      LIMIT 1
    `).bind(tenant, tenant).first();

    const instructions = String(row?.instructions || '').trim();
    if (instructions) return instructions;
  } catch (error) {
    console.warn('[GROQ][INSTRUCTIONS] D1 lookup failed; using setup fallback', safeError(error));
  }

  return fallback;
}

async function requestGroq(env, body) {
  const startedAt = Date.now();
  const model = body.model;

  console.log('[GROQ][RESPONSES] request:start', {
    model,
    input_items: Array.isArray(body.input) ? body.input.length : 1,
    instructions_length: typeof body.instructions === 'string' ? body.instructions.length : 0,
  });

  const response = await fetch(`${GROQ_API_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
      'Groq-Beta': 'inference-metrics',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Groq HTTP ${response.status}`);
    error.status = response.status;
    error.details = payload;
    console.error('[GROQ][RESPONSES] request:error', {
      status: response.status,
      elapsed_ms: Date.now() - startedAt,
      type: payload?.error?.type || null,
      code: payload?.error?.code || null,
      message: payload?.error?.message || null,
    });
    throw error;
  }

  const text = extractOutputText(payload);
  if (!text) {
    const error = new Error('Groq retornou resposta sem texto');
    error.status = 502;
    throw error;
  }

  console.log('[GROQ][RESPONSES] request:ok', {
    status: response.status,
    elapsed_ms: Date.now() - startedAt,
    response_id: payload?.id || null,
    model: payload?.model || model,
    output_length: text.length,
    prompt_tokens: payload?.usage?.input_tokens ?? null,
    output_tokens: payload?.usage?.output_tokens ?? null,
    total_tokens: payload?.usage?.total_tokens ?? null,
    inference_total_time: payload?.metadata?.total_time ?? null,
  });

  return {
    id: payload?.id || null,
    model: payload?.model || model,
    text,
    raw: payload,
  };
}

export async function respondGroq(env, {
  phone,
  setupData,
  input,
  instructions,
  maxOutputTokens = 1200,
} = {}) {
  if (!env?.GROQ_API_KEY) throw new Error('GROQ_API_KEY não configurada');
  if (!input || typeof input !== 'string') throw new Error('input é obrigatório');

  // A Groq Responses API não suporta previous_response_id/store neste momento.
  // Mantemos o histórico explicitamente no KV e o reenviamos em cada request.
  const previousHistory = await loadConversationHistory(env, phone, setupData);
  const requestHistory = trimHistory([
    ...previousHistory,
    { role: 'user', content: input },
  ]);

  const body = {
    model: groqModel(env),
    input: requestHistory,
    instructions: instructions || undefined,
    max_output_tokens: maxOutputTokens,
  };

  const result = await requestGroq(env, body);

  // A documentação da Groq recomenda acrescentar response.output ao histórico.
  const outputItems = Array.isArray(result?.raw?.output) ? result.raw.output : [];
  const nextHistory = trimHistory([
    ...requestHistory,
    ...outputItems,
  ]);

  await saveConversationHistory(env, phone, setupData, nextHistory);

  console.log('[GROQ][HISTORY] saved', {
    previous_items: previousHistory.length,
    request_items: requestHistory.length,
    saved_items: nextHistory.length,
  });

  return result;
}

export async function resetGroqConversation(env, phone, setupData = {}) {
  if (!env?.Whatsapp_threads) return;
  await env.Whatsapp_threads.delete(conversationKey(phone, setupData));
}
