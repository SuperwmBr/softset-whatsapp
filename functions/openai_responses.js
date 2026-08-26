import {
  loadConversationHistory,
  saveConversationTurn,
  trimHistory,
} from './conversation_history.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_FALLBACK_MODEL = 'gpt-5.6-luna';

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

export async function respondOpenAIResponses(env, {
  phone,
  setupData,
  input,
  instructions,
  maxOutputTokens = 1200,
} = {}) {
  if (!env?.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');
  if (!input || typeof input !== 'string') throw new Error('input é obrigatório');

  const previousHistory = await loadConversationHistory(env, phone, setupData);
  const requestHistory = trimHistory([
    ...previousHistory,
    { role: 'user', content: input },
  ]);

  const model = openAIFallbackModel(env);
  const startedAt = Date.now();

  console.log('[OPENAI][RESPONSES][FALLBACK] request:start', {
    model,
    input_items: requestHistory.length,
    instructions_length: typeof instructions === 'string' ? instructions.length : 0,
    shared_history_items: previousHistory.length,
  });

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
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
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`);
    error.status = response.status;
    error.details = payload;
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
    const error = new Error('OpenAI Responses retornou resposta sem texto');
    error.status = 502;
    throw error;
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
