// Camada de compatibilidade para migração gradual de OpenAI Assistants -> Groq.
// O código legado permanece intacto em IA_legacy.js para formulários, filas e fallback.
import * as legacy from './IA_legacy.js';
import * as formata from './formatacoes.js';
import * as wpp from './wppconnect.js';
import {
  groqEnabled,
  loadGroqInstructions,
  respondGroq,
} from './groq.js';

export * from './IA_legacy.js';

async function stopPresence(phone, setupData, audioOnly) {
  try {
    if (audioOnly) {
      await wpp.sendRecording(phone, false, setupData);
    } else {
      await wpp.sendTyping(phone, false, setupData);
    }
  } catch (error) {
    console.warn('[GROQ][WHATSAPP] Falha ao desligar presença', error?.message || String(error));
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
    console.warn('[GROQ][WHATSAPP] Falha ao ligar presença', error?.message || String(error));
  }
}

/**
 * Mantém o nome público fetchOpenAI_V2 para não alterar worker.js nem outros chamadores.
 * Quando GROQ_API_KEY existe, o chat genérico usa Groq Responses API.
 * Se Groq estiver indisponível, o fluxo legado OpenAI continua como fallback.
 *
 * Formulários e o consumer de Queue continuam exportados do IA_legacy.js sem alteração
 * nesta fase, evitando regressão no tool-calling existente.
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
  if (!groqEnabled(env)) {
    console.warn('[GROQ][CHAT] GROQ_API_KEY ausente; usando fluxo OpenAI legado');
    return legacy.fetchOpenAI_V2(
      userMessage,
      promptSystem,
      senderName,
      mesmaData,
      env,
      phone,
      messageId,
      setupData,
      audioOnly
    );
  }

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const savedInstructions = await loadGroqInstructions(env, setupData);
    const extraSystem = String(promptSystem || '').trim();

    // Evita responder sem a configuração do cliente, preservando a intenção do fluxo atual.
    if (!savedInstructions && !extraSystem) {
      console.warn('[GROQ][CHAT] Sem instruções configuradas; resposta não será gerada', {
        request_id: requestId,
        token_present: Boolean(setupData?.app_key || setupData?.token),
      });
      await stopPresence(phone, setupData, audioOnly);
      return;
    }

    await startPresence(phone, setupData, audioOnly);

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

    const instructions = [savedInstructions, extraSystem]
      .filter(Boolean)
      .join('\n\n');

    console.log('[GROQ][CHAT] request', {
      request_id: requestId,
      phone_present: Boolean(phone),
      input_length: dynamicInput.length,
      instructions_length: instructions.length,
      audio_only: Boolean(audioOnly),
      groq_enabled: true,
      openai_fallback_available: Boolean(env?.OPENAI_API_KEY),
    });

    const result = await respondGroq(env, {
      phone,
      setupData,
      input: dynamicInput,
      instructions,
      maxOutputTokens: 1200,
    });

    await wpp.enviarMensagemWhatsapp(
      env,
      result.text,
      phone,
      setupData,
      Boolean(audioOnly),
      messageId
    );

    console.log('[GROQ][CHAT] success', {
      request_id: requestId,
      elapsed_ms: Date.now() - startedAt,
      model: result.model,
      response_id: result.id,
      output_length: result.text.length,
    });

    return [result.text];
  } catch (error) {
    console.error('[GROQ][CHAT] fatal', {
      request_id: requestId,
      elapsed_ms: Date.now() - startedAt,
      name: error?.name || 'Error',
      message: error?.message || String(error),
      status: error?.status || null,
      openai_fallback_available: Boolean(env?.OPENAI_API_KEY),
    });

    await stopPresence(phone, setupData, audioOnly);

    // Migração sem corte brusco: enquanto o formulário/legado ainda depende de OpenAI,
    // uma indisponibilidade do Groq não derruba o atendimento atual.
    if (env?.OPENAI_API_KEY) {
      console.warn('[GROQ][CHAT] Acionando fallback OpenAI legado');
      return legacy.fetchOpenAI_V2(
        userMessage,
        promptSystem,
        senderName,
        mesmaData,
        env,
        phone,
        messageId,
        setupData,
        audioOnly
      );
    }

    throw error;
  }
}
