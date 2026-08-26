import {
  loadConversationHistory,
  saveConversationTurn,
  resetConversationHistory,
  trimHistory,
} from './conversation_history.js';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

// Cache muito curto apenas para evitar leituras duplicadas do mesmo bloco de instruções
// dentro do mesmo ciclo de atendimento. Mantém atualização do painel praticamente imediata.
const INSTRUCTIONS_CACHE_TTL_MS = 5_000;
const INSTRUCTIONS_CACHE_MAX_ENTRIES = 100;
const instructionsCache = new Map();

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
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
      if (content?.type === 'text' && typeof content.text === 'string') parts.push(content.text);
    }
  }

  return parts.join('\n').trim();
}

function getCachedInstructions(tenant) {
  if (!tenant) return null;
  const cached = instructionsCache.get(tenant);
  if (!cached) return null;

  if ((Date.now() - cached.savedAt) > INSTRUCTIONS_CACHE_TTL_MS) {
    instructionsCache.delete(tenant);
    return null;
  }

  return cached.instructions;
}

function setCachedInstructions(tenant, instructions) {
  if (!tenant || !instructions) return;

  // Evita crescimento indefinido em isolates quentes.
  if (instructionsCache.size >= INSTRUCTIONS_CACHE_MAX_ENTRIES && !instructionsCache.has(tenant)) {
    const oldestKey = instructionsCache.keys().next().value;
    if (oldestKey) instructionsCache.delete(oldestKey);
  }

  instructionsCache.set(tenant, {
    instructions,
    savedAt: Date.now(),
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

  const cachedInstructions = getCachedInstructions(tenant);
  if (cachedInstructions) {
    console.log('[AI][INSTRUCTIONS] cache:hit', {
      instructions_length: cachedInstructions.length,
      ttl_ms: INSTRUCTIONS_CACHE_TTL_MS,
    });
    return cachedInstructions;
  }

  try {
    const row = await env.db.prepare(`
      SELECT instructions
      FROM ai_instructions
      WHERE token = ? OR app_key = ?
      ORDER BY COALESCE(version, 0) DESC, COALESCE(updated_at, created_at) DESC
      LIMIT 1
    `).bind(tenant, tenant).first();

    const instructions = String(row?.instructions || '').trim();
    if (instructions) {
      setCachedInstructions(tenant, instructions);
      return instructions;
    }
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

  const previousHistory = await loadConversationHistory(env, phone, setupData);
  const requestHistory = trimHistory([
    ...previousHistory,
    { role: 'user', content: input },
  ]);

  const result = await requestGroq(env, {
    model: groqModel(env),
    input: requestHistory,
    instructions: instructions || undefined,
    max_output_tokens: maxOutputTokens,
  });

  const nextHistory = await saveConversationTurn(
    env,
    phone,
    setupData,
    previousHistory,
    input,
    result.text
  );

  console.log('[GROQ][HISTORY] saved', {
    previous_items: previousHistory.length,
    request_items: requestHistory.length,
    saved_items: nextHistory.length,
    shared_memory: true,
  });

  return result;
}

export async function resetGroqConversation(env, phone, setupData = {}) {
  await resetConversationHistory(env, phone, setupData);
}
