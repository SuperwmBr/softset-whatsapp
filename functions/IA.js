// Camada de compatibilidade da migração de Assistants/Threads para Responses API.
// Groq permanece primário. OpenAI Responses API é somente fallback do chat genérico.
// IA_legacy.js continua exportado apenas para fluxos ainda não migrados (ex.: formulários/queues).
import * as legacy from './IA_legacy.js';
import * as formata from './formatacoes.js';
import * as wpp from './wppconnect.js';
import {
  groqEnabled,
  loadGroqInstructions,
  respondGroq,
} from './groq.js';
import {
  openAIResponsesEnabled,
  respondOpenAIResponses,
} from './openai_responses.js';

export * from './IA_legacy.js';

async function stopPresence(phone, setupData, audioOnly) {
  try {
    if (audioOnly) {
      await wpp.sendRecording(phone, false, setupData);
    } else {
      await wpp.sendTyping(phone, false, setupData);
    }
  } catch (error) {
    console.warn('[AI][WHATSAPP] Falha ao desligar presença', error?.message || String(error));
  }
}

async function startPresence(phone, setupData, audioOnly) {
  try {
    if (audioOnly) {
      await wpp.sendRecording(phone, true, setupData);
    } else {
      await wpp.sendTyping(phone, true, setupData);
    }
  } catch (error) {
    console.warn('[AI][WHATSAPP] Falha ao ligar presença', error?.message || String(error));
  }
}

/**
 * Compatibilidade segura para obter_setup().
 * Se as instruções já estão no D1, não precisamos consultar o Assistant remoto.
 * Mantemos o ID antigo apenas como dado legado para fluxos ainda não migrados.
 */
export async function verifica_assistant(idTokenCliente, assistantIdExists, env) {
  if (!groqEnabled(env) && !openAIResponsesEnabled(env)) {
    return legacy.verifica_assistant(idTokenCliente, assistantIdExists, env);
  }

  try {
    const instructions = await loadGroqInstructions(env, {
      app_key: idTokenCliente,
      token: idTokenCliente,
    });

    if (String(instructions || '').trim()) {
      console.log('[AI][SETUP] Usando instruções D1; Assistant remoto dispensado', {
        assistant_id_present: Boolean(assistantIdExists),
        instructions_length: instructions.length,
        groq_enabled: groqEnabled(env),
        openai_responses_available: openAIResponsesEnabled(env),
      });

      return {
        id: assistantIdExists || null,
        name: idTokenCliente,
        instructions,
        model: 'responses-api-d1',
      };
    }
  } catch (error) {
    console.warn('[AI][SETUP] Falha ao carregar instruções D1; preservando compatibilidade legada', {
      message: error?.message || String(error),
    });
  }

  // Somente para clientes ainda não migrados para ai_instructions.
  // O chat genérico NÃO usa este Assistant como fallback de resposta.
  return legacy.verifica_assistant(idTokenCliente, assistantIdExists, env);
}

function buildDynamicInput(userMessage, senderName, mesmaData, setupData) {
  let dynamicInput = '';
  dynamicInput += `A data e hora atual, no contexto do atendimento, é ${formata.formatarDataBRUTC3(Math.floor(Date.now() / 1000))}.\n`;

  if (mesmaData) {
    dynamicInput += `Como é a primeira interação do dia, cumprimente com "${mesmaData}, ${senderName}!" e identifique-se como Atendente Virtual de ${setupData?.nome_fantasia || 'nossa empresa'}. `;
    dynamicInput += 'Depois responda normalmente à dúvida do cliente.\n';
  } else {
    dynamicInput += 'Já houve contato hoje; não repita a saudação inicial. Responda diretamente à dúvida.\n';
  }

  dynamicInput += `Cliente: ${senderName || 'Cliente'}\n`;
  dynamicInput += `Mensagem: ${userMessage}`;
  return dynamicInput;
}

/**
 * Mantém o nome público fetchOpenAI_V2 para não alterar worker.js nem demais chamadores.
 * Arquitetura do chat genérico:
 *   1) Groq Responses API (primário)
 *   2) OpenAI Responses API (fallback)
 * Ambos usam as mesmas instruções do D1 e a mesma memória conversacional persistida em KV.
 * O fallback NÃO usa Assistant, Thread ou Run.
 */
export async function fetchOpenAI_V2(
  userMessage,
  promptSystem,
  senderName,
  mesmaData,
  env,
  phone,
  messageId,
  setupData,
  audioOnly
) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let provider = null;
  let presencePromise = null;

  try {
    const savedInstructions = await loadGroqInstructions(env, setupData);
    const extraSystem = String(promptSystem || '').trim();
    const instructions = [savedInstructions, extraSystem].filter(Boolean).join('\n\n');

    if (!instructions) {
      console.warn('[AI][CHAT] Sem instruções/base de conhecimento no D1; resposta não será gerada', {
        request_id: requestId,
        token_present: Boolean(setupData?.app_key || setupData?.token),
      });
      await stopPresence(phone, setupData, audioOnly);
      return;
    }

    const dynamicInput = buildDynamicInput(userMessage, senderName, mesmaData, setupData);

    // Não bloqueia a chamada de IA esperando o endpoint de typing/recording.
    // O Promise é aguardado antes do envio da resposta para impedir que a presença
    // seja ligada depois de a mensagem já ter sido entregue.
    presencePromise = startPresence(phone, setupData, audioOnly);

    let result;

    if (groqEnabled(env)) {
      provider = 'groq';
      console.log('[AI][CHAT] provider:primary', {
        request_id: requestId,
        provider,
        input_length: dynamicInput.length,
        instructions_length: instructions.length,
        shared_history: true,
        presence_parallel: true,
      });

      try {
        result = await respondGroq(env, {
          phone,
          setupData,
          input: dynamicInput,
          instructions,
          maxOutputTokens: 1200,
        });
      } catch (groqError) {
        console.error('[GROQ][CHAT] primary:error', {
          request_id: requestId,
          elapsed_ms: Date.now() - startedAt,
          name: groqError?.name || 'Error',
          message: groqError?.message || String(groqError),
          status: groqError?.status || null,
          openai_responses_available: openAIResponsesEnabled(env),
        });

        if (!openAIResponsesEnabled(env)) throw groqError;

        provider = 'openai-responses';
        console.warn('[AI][CHAT] fallback:OpenAI Responses API', {
          request_id: requestId,
          assistants_api_used: false,
          threads_used: false,
          shared_history: true,
        });

        result = await respondOpenAIResponses(env, {
          phone,
          setupData,
          input: dynamicInput,
          instructions,
          maxOutputTokens: 1200,
        });
      }
    } else {
      if (!openAIResponsesEnabled(env)) {
        throw new Error('Nenhum provedor de IA configurado: GROQ_API_KEY e OPENAI_API_KEY ausentes');
      }

      provider = 'openai-responses';
      console.warn('[AI][CHAT] Groq indisponível; usando OpenAI Responses API', {
        request_id: requestId,
        assistants_api_used: false,
        threads_used: false,
        shared_history: true,
      });

      result = await respondOpenAIResponses(env, {
        phone,
        setupData,
        input: dynamicInput,
        instructions,
        maxOutputTokens: 1200,
      });
    }

    if (presencePromise) await presencePromise;

    await wpp.enviarMensagemWhatsapp(
      env,
      result.text,
      phone,
      setupData,
      Boolean(audioOnly),
      messageId
    );

    console.log('[AI][CHAT] success', {
      request_id: requestId,
      elapsed_ms: Date.now() - startedAt,
      provider,
      model: result.model,
      response_id: result.id,
      output_length: result.text.length,
      shared_history: true,
      assistants_api_used: false,
      threads_used: false,
      presence_parallel: true,
    });

    return [result.text];
  } catch (error) {
    console.error('[AI][CHAT] fatal', {
      request_id: requestId,
      elapsed_ms: Date.now() - startedAt,
      provider,
      name: error?.name || 'Error',
      message: error?.message || String(error),
      status: error?.status || null,
    });

    if (presencePromise) await presencePromise;
    await stopPresence(phone, setupData, audioOnly);
    throw error;
  }
}
