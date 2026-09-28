import {
  loadConversationHistory,
  saveConversationTurn,
  resetConversationHistory,
  trimHistory,
} from './conversation_history.js';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_GROQ_TIMEOUT_MS = 12_000;

// L1: cache curtíssimo no isolate para eliminar leituras duplicadas dentro do mesmo atendimento.
const INSTRUCTIONS_CACHE_TTL_MS = 5_000;
const INSTRUCTIONS_CACHE_MAX_ENTRIES = 100;
const instructionsCache = new Map();

// L2: cache persistente no KV já existente e compartilhado com o worker do painel.
// O D1 continua sendo a fonte da verdade. O painel atualiza este cache após cada gravação.
const KNOWLEDGE_CACHE_PREFIX = 'ai_instructions_cache:v1:';
const KNOWLEDGE_CACHE_TTL_SECONDS = 6 * 60 * 60;

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    status: error?.status || null,
  };
}

/**
 * Cria um Error com metadados HTTP (status/code/details) usados no tratamento
 * de falhas (timeout, resposta não-ok, corpo vazio). Centralizar a criação
 * aqui evita repetir `error.status = ...` solto e corrige a tipagem: um
 * `Error` puro não tem essas propriedades para o checkJs do TypeScript.
 * @param {string} message
 * @param {{status?: number, code?: string, details?: unknown}} [extra]
 * @returns {Error & {status?: number, code?: string, details?: unknown}}
 */
function httpError(message, extra = {}) {
  const error = /** @type {Error & {status?: number, code?: string, details?: unknown}} */ (new Error(message));
  Object.assign(error, extra);
  return error;
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

function knowledgeCacheKey(tenant) {
  return `${KNOWLEDGE_CACHE_PREFIX}${tenant}`;
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

  if (instructionsCache.size >= INSTRUCTIONS_CACHE_MAX_ENTRIES && !instructionsCache.has(tenant)) {
    const oldestKey = instructionsCache.keys().next().value;
    if (oldestKey) instructionsCache.delete(oldestKey);
  }

  instructionsCache.set(tenant, {
    instructions,
    savedAt: Date.now(),
  });
}

async function readPersistentKnowledgeCache(env, tenant) {
  if (!env?.MENU_STORAGE || !tenant) return '';

  try {
    return String(await env.MENU_STORAGE.get(knowledgeCacheKey(tenant)) || '').trim();
  } catch (error) {
    console.warn('[AI][INSTRUCTIONS] kv-cache:read-error', safeError(error));
    return '';
  }
}

async function writePersistentKnowledgeCache(env, tenant, instructions) {
  if (!env?.MENU_STORAGE || !tenant || !instructions) return;

  try {
    await env.MENU_STORAGE.put(knowledgeCacheKey(tenant), instructions, {
      expirationTtl: KNOWLEDGE_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    // Falha de cache nunca pode interromper o atendimento: D1 continua sendo a fonte oficial.
    console.warn('[AI][INSTRUCTIONS] kv-cache:write-error', safeError(error));
  }
}

export function groqEnabled(env) {
  return Boolean(env?.GROQ_API_KEY);
}

export function groqModel(env) {
  return env?.GROQ_MODEL || DEFAULT_GROQ_MODEL;
}

function groqTimeoutMs(env) {
  const configured = Number(env?.GROQ_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 3_000
    ? configured
    : DEFAULT_GROQ_TIMEOUT_MS;
}

export async function loadGroqInstructions(env, setupData = {}) {
  const tenant = setupData?.app_key || setupData?.token || '';
  const fallback = String(setupData?.prompt_na_pergunta || '').trim();

  if (!tenant) return fallback;

  const cachedInstructions = getCachedInstructions(tenant);
  if (cachedInstructions) {
    console.log('[AI][INSTRUCTIONS] memory-cache:hit', {
      instructions_length: cachedInstructions.length,
      ttl_ms: INSTRUCTIONS_CACHE_TTL_MS,
    });
    return cachedInstructions;
  }

  const persistentCachedInstructions = await readPersistentKnowledgeCache(env, tenant);
  if (persistentCachedInstructions) {
    setCachedInstructions(tenant, persistentCachedInstructions);
    console.log('[AI][INSTRUCTIONS] kv-cache:hit', {
      instructions_length: persistentCachedInstructions.length,
      ttl_seconds: KNOWLEDGE_CACHE_TTL_SECONDS,
    });
    return persistentCachedInstructions;
  }

  if (!env?.db) return fallback;

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
      await writePersistentKnowledgeCache(env, tenant, instructions);
      console.log('[AI][INSTRUCTIONS] d1:loaded-and-cached', {
        instructions_length: instructions.length,
      });
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
  const timeoutMs = groqTimeoutMs(env);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('groq_timeout'), timeoutMs);

  console.log('[GROQ][RESPONSES] request:start', {
    model,
    input_items: Array.isArray(body.input) ? body.input.length : 1,
    instructions_length: typeof body.instructions === 'string' ? body.instructions.length : 0,
    timeout_ms: timeoutMs,
  });

  let response;
  try {
    response = await fetch(`${GROQ_API_BASE}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
        'Groq-Beta': 'inference-metrics',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = httpError(`Groq excedeu o limite de ${timeoutMs}ms`, {
        status: 504,
        code: 'GROQ_TIMEOUT',
      });
      console.error('[GROQ][RESPONSES] request:timeout', {
        elapsed_ms: Date.now() - startedAt,
        timeout_ms: timeoutMs,
      });
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = httpError(payload?.error?.message || `Groq HTTP ${response.status}`, {
      status: response.status,
      details: payload,
    });
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
    throw httpError('Groq retornou resposta sem texto', { status: 502 });
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

/**
 * @typedef {{
 *   phone?: string,
 *   setupData?: Record<string, any>,
 *   input?: string,
 *   instructions?: string,
 *   maxOutputTokens?: number,
 * }} RespondGroqOptions
 */

/**
 * checkJs infere o tipo de um parâmetro desestruturado só a partir das
 * propriedades com valor-padrão (aqui, só `maxOutputTokens`), gerando falsos
 * "Property does not exist" nesta função e em quem a chama. Nomear o
 * parâmetro e desestruturar no corpo evita a inferência errada.
 * @param {RespondGroqOptions} options
 */
export async function respondGroq(env, options = {}) {
  const { phone, setupData, input, instructions, maxOutputTokens = 1200 } = options;

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
