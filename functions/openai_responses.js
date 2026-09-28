import {
  loadConversationHistory,
  saveConversationTurn,
  trimHistory,
} from './conversation_history.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_FALLBACK_MODEL = 'gpt-5.6-luna';
const DEFAULT_OPENAI_TIMEOUT_MS = 20_000;

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

export function openAIResponsesEnabled(env) {
  return Boolean(env?.OPENAI_API_KEY);
}

export function openAIFallbackModel(env) {
  return env?.OPENAI_FALLBACK_MODEL || DEFAULT_OPENAI_FALLBACK_MODEL;
}

function openAITimeoutMs(env) {
  const configured = Number(env?.OPENAI_FALLBACK_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 5_000
    ? configured
    : DEFAULT_OPENAI_TIMEOUT_MS;
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

/**
 * @typedef {{
 *   phone?: string,
 *   setupData?: Record<string, any>,
 *   input?: string,
 *   instructions?: string,
 *   maxOutputTokens?: number,
 * }} RespondOpenAIResponsesOptions
 */

/**
 * checkJs infere o tipo de um parâmetro desestruturado só a partir das
 * propriedades com valor-padrão (aqui, só `maxOutputTokens`), gerando falsos
 * "Property does not exist" nesta função e em quem a chama. Nomear o
 * parâmetro e desestruturar no corpo evita a inferência errada.
 * @param {RespondOpenAIResponsesOptions} options
 */
export async function respondOpenAIResponses(env, options = {}) {
  const { phone, setupData, input, instructions, maxOutputTokens = 1200 } = options;

  if (!env?.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');
  if (!input || typeof input !== 'string') throw new Error('input é obrigatório');

  const previousHistory = await loadConversationHistory(env, phone, setupData);
  const requestHistory = trimHistory([
    ...previousHistory,
    { role: 'user', content: input },
  ]);

  const model = openAIFallbackModel(env);
  const startedAt = Date.now();
  const timeoutMs = openAITimeoutMs(env);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('openai_timeout'), timeoutMs);

  console.log('[OPENAI][RESPONSES][FALLBACK] request:start', {
    model,
    input_items: requestHistory.length,
    instructions_length: typeof instructions === 'string' ? instructions.length : 0,
    shared_history_items: previousHistory.length,
    timeout_ms: timeoutMs,
  });

  let response;
  try {
    response = await fetch(`${OPENAI_API_BASE}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: requestHistory,
        instructions: instructions || undefined,
        max_output_tokens: maxOutputTokens,
        store: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = httpError(`OpenAI fallback excedeu o limite de ${timeoutMs}ms`, {
        status: 504,
        code: 'OPENAI_FALLBACK_TIMEOUT',
      });
      console.error('[OPENAI][RESPONSES][FALLBACK] request:timeout', {
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
    const error = httpError(payload?.error?.message || `OpenAI HTTP ${response.status}`, {
      status: response.status,
      details: payload,
    });
    console.error('[OPENAI][RESPONSES][FALLBACK] request:error', {
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
    throw httpError('OpenAI Responses retornou resposta sem texto', { status: 502 });
  }

  const nextHistory = await saveConversationTurn(
    env,
    phone,
    setupData,
    previousHistory,
    input,
    text
  );

  console.log('[OPENAI][RESPONSES][FALLBACK] request:ok', {
    status: response.status,
    elapsed_ms: Date.now() - startedAt,
    response_id: payload?.id || null,
    model: payload?.model || model,
    output_length: text.length,
    saved_history_items: nextHistory.length,
    assistants_api_used: false,
    threads_used: false,
  });

  return {
    id: payload?.id || null,
    model: payload?.model || model,
    text,
    raw: payload,
  };
}
