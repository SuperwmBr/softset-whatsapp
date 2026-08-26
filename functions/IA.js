// Arquivo: ia.js
// (Importações no topo do seu arquivo)
import * as formata from './formatacoes.js';
import * as forms from './forms.js';
import * as fn from './funcoes-genericas.js';
import * as wpp from './wppconnect.js';

// Constante da API
const OPENAI_API_BASE = 'https://api.openai.com/v1';

/**
 * [CORRIGIDO]
 * Esta função INICIA um Run de formulário e o coloca na fila assíncrona.
 * Ela NÃO espera a resposta.
 */
export async function RespondeOPENAI_forms(phone, prompt, setup_data, env, messageId, assistantId, formIdHash) {
    let headers = {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
    };
    
    //Verificando se há threads para o usuario (histório de conversa)
    let thread_user = "";
    let chave_user = `form_threads_${phone}_${setup_data.app_key}`;
    console.log("RespondeOPENAI_forms: chave_user (KV): ", chave_user)
    
    
    thread_user = await env.Whatsapp_threads.get(chave_user);
    await _validaThread(chave_user, thread_user, headers, env)
    let thread_user_validada = await env.Whatsapp_threads.get(chave_user);
    console.log(`RespondeOPENAI_forms: valor validado (${chave_user}): `, thread_user_validada)

    try {
        console.log(`Form Produtor: Tarefa (Formulário) para ${phone} sendo enfileirada.`);

        // 1. Adiciona a pergunta do usuário na Thread
        const idMessage = await createMessage(thread_user_validada, prompt, env);
        if (!idMessage || !idMessage.id) {
            console.log("RespondeOPENAI_forms: Falha ao criar o Message na OpenAI.");
            return [{ response_text: `*Resposta não processada*\n_Dica: 😉 Aguarde o retorno antes de enviar uma nova resposta_\nMas pode responder mais de uma pergunta, ou todas de uma só vez.`, messageId: messageId }];
        }

        // 2. Cria o Run para o Assistente começar a trabalhar
        // [CORREÇÃO BUG #1]: Usando o 'assistantId' (do formulário) em vez do 'setup_data.Assistant_ID' (genérico)
        let required = true //Forçar uso das ferramentas
        const runId = await createRun(env.OPENAI_API_KEY, thread_user_validada, assistantId, setup_data.vectorstore, required);

        if (!runId) {
            console.log("RespondeOPENAI_forms: Falha ao criar o Run na OpenAI.");
            return [{ response_text: "Erro ao criar run.", messageId: messageId }];
        }

        // 3. Monta o pacote de dados para o Consumidor
        const taskPayload = {
            phone,
            prompt,
            setup_data,
            messageId,
            threadId: thread_user_validada,
            // [CORREÇÃO BUG #1]: Passando o Assistant ID correto
            Assistant_ID: assistantId,
            chave_user: chave_user,
            runId: runId,
            chatMessageId: idMessage.id,
            type: "enviar_openai", // O consumidor vai tratar isso
            
            // [CORREÇÃO BUG #3]: Passando o contexto do formulário para o consumidor
            isForm: true,
            formIdHash: formIdHash 
        };
        
        console.log("RespondeOPENAI_forms: Colocando na fila (gptprocessamentowhatsapp):", taskPayload)
        await env.gptprocessamentowhatsapp.send(taskPayload);






    } catch (error) {
        // Se falhar, não deleta a thread, mas loga o erro
        console.error("RespondeOPENAI_forms: Erro ao enfileirar tarefa: ", error);
        return [{ response_text: `Erro na API: ${error.message}`, messageId: messageId }];
    }

    // Retorna a resposta imediata "..." para o forms.js saber que o fluxo assíncrono começou
    return [{ response_text: "*Aguarde...*", messageId: messageId }];
}

/**
 * [INTOCADO] - Esta é a sua função original, não foi modificada.
 */
export async function RespondeOPENAI(phone, prompt, setup_data, env, messageId, functions, function_call) {
    // verificando se abre um novo chat(conversa) com um novo thread ou se a conversa já iniciou anteriormente.
    let url = ""
    let headers = { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` //'Bearer sk-proj-erH_GfVvc-3UQWJtSy8pEoqFkeEiobPzy0u4STDn0CYKRXJAITsJPdKIW0szoJVdSwz8FyoYKKT3BlbkFJnV1AC9L8ohYOurIs8XrDma70tPEKmCIAJj6oZgYQnXtcGjTpvGtgtq6h6cko8wz7OHR4C7xEEA'
        , 'Content-Type': 'application/json', 'OpenAI-Beta': 'assistants=v2' };
    let reCriaThreadRun = false;
    let threadMessageId = {};
    let thread_mensagem = "";
    let ntempo = 0;
  
    //Verificando se há threads para o usuario (histório de conversa)
    let thread_user = "";
    let chave_user = `${phone}_${setup_data.app_key}`;
    //console.log( "chave_user (KV): ", chave_user )
    thread_user = await env.Whatsapp_threads.get(chave_user);
    //console.log( "valor (KV): ", thread_user )
    await _validaThread(chave_user, thread_user, headers, env)
    let thread_user_validada = await env.Whatsapp_threads.get(chave_user);
    //console.log( `valor (${chave_user}): `, thread_user_validada )
  
  
    //Chamando a resposta pelo servidor e aguardar a resp. da OpenAI enviada pelo servidor RailWay
    // url = "https://messages.softset.com.br/assistente_responde";
    //url = "https://respondechatgpt.softset.com.br/assistente_responde";
  
    let model = 'gpt-4o-mini'
    
    /*
    if (setup_data.plano_atual.toLowerCase().includes('custom') 
         // || setup_data.plano_atual.toLowerCase().includes('demonstracao') 
         // || setup_data.plano_atual.toLowerCase().includes('enterprise')
    ) {
      model = 'gpt-4.1-mini'
    }
  */
  
    url = `https://chatgpt.softset.com.br/api/assistant/message`;
  
    let body
    if (functions) {
      body = {"vectorstore": setup_data.vectorstore, "model": model, "threadId": thread_user_validada, "text": prompt, "assistantId": setup_data.Assistant_ID, messageId, functions, function_call}
    } else {
      //body = JSON.stringify({"vectorstore": setup_data.vectorstore, "model": model, "threadId": thread_user_validada, "text": prompt, "assistantId": setup_data.Assistant_ID, messageId })
      body = {"vectorstore": setup_data.vectorstore, "model": model, "threadId": thread_user_validada, "text": prompt, "assistantId": setup_data.Assistant_ID, messageId }
    }
  
    try {
      //console.log( `RespondeOPENAI:: body:`, body )
  
      
  
    
      console.log(`Produtor: Tarefa para o usuário ${phone} sendo enfileirada.`);
  
      // 1. Adiciona a pergunta do usuário na Thread
      const idMessage = await createMessage(thread_user_validada, prompt, env);
      if (!idMessage.id) {
        console.log("Falha ao criar o Message na OpenAI.",idMessage.id)
        return new Response("Falha ao criar o Message na OpenAI.", { status: 500 });
      }
  
      // 2. Cria o Run para o Assistente começar a trabalhar
      //const runId = await createRun(thread_user_validada, setup_data.Assistant_ID, env);
      // Chamamos a nova versão da função `createRun`, passando todos os parâmetros
      const runId = await createRun(env.OPENAI_API_KEY, thread_user_validada, setup_data.Assistant_ID, setup_data.vectorstore, );
  
      if (!runId) {
        console.log("Falha ao criar o Run na OpenAI.",runId)
        return new Response("Falha ao criar o Run na OpenAI.", { status: 500 });
      }
  
      // 3. Monta o pacote de dados para o Consumidor
      const taskPayload = {
        phone,
        prompt,
        setup_data,
        messageId,
        functions,
        function_call,
        threadId: thread_user_validada,
        Assistant_ID: setup_data.Assistant_ID,
        chave_user: chave_user,
        runId: runId,
        chatMessageId: idMessage.id,
        body: body, 
        type: "enviar_openai",
        
        // Adicionando contexto para o consumidor
        isForm: false, // [NOVO] Marcando como "não-formulário"
        formIdHash: null
      };
      console.log( "Colocando o RunId/Id da mensagem na fila. Parametros", taskPayload )
      const retQueue = await env.gptprocessamentowhatsapp.send(taskPayload);
      console.log("gptprocessamentowhatsapp", retQueue)
  
      thread_mensagem = "..."
      /*
      let response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
      //Aqui pode demorar até uns 15 segundos para aguardar a resp. da OpenAI enviada pelo servidor RailWay 
      let dataResposta = await response.json();
     
      const dataRespostaOpenAI = dataResposta.data // utilizar 
      console.log('Mensagens obtidas devido a pergunta:', dataRespostaOpenAI);
      if (!response.ok) {
        // Se a resposta não for 200, lança um err
        thread_user = await env.Whatsapp_threads.delete(chave_user);
        console.log(`O seguinte erro ocorreu. Thread (${thread_user_validada}) excluída: response`, dataRespostaOpenAI.error)
        thread_mensagem = `Desculpe, não consegui processar sua pergunta. Se desejar, pode repetir a pergunta por gentileza?`
        //throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
      }
      else {
        //threadMessageId = dataRespostaOpenAI.threadId_pergunta;    //thread_id da resposta
        //thread_mensagem = dataRespostaOpenAI.response_text;
        thread_mensagem = dataRespostaOpenAI;
        //ntempo = dataRespostaOpenAI.tempo_decorrido / 1000;
  
      }
      */
  
    } catch (error) {
      thread_user = await env.Whatsapp_threads.delete(chave_user);
      console.error("Erro ao receber as respostas  ", error);
      throw new Error(`Erro na API: ${error}`);
    }
  
    //let thread_id = thread_user_validada;
    //let zapiResponse;
  
    // Preparamos o payload para enviar a resposta ao usuário
    if (typeof thread_mensagem === "undefined") {
      return new Response("Erro ao enviar a resposta para o Whatsapp", { status: 500 });
    }
    console.log(`Tempo decorrido para a resposta: ${ntempo} seg. \n` +
      `Pergunta: ${prompt}\n` +
      `Resposta: ${thread_mensagem}`);
  
    return [thread_mensagem];
}


//
// ... (Suas funções _createThread e _validaThread permanecem aqui, sem alteração) ...
//
export async function _createThread(chave_user, headers, env) {
    // Se a thread não existir, cria uma nova
    let url = 'https://api.openai.com/v1/threads'; //Criando a thread apenas
    try {
      let criando_new_Thread = await fetch(url, { method: 'POST', headers: headers });   //No Body
      let dados_new_thread = await criando_new_Thread.json();
      console.log(`Retorno da tentativa de apenas criar um novo thread:\n
                    ${JSON.stringify(headers)}\n
                    dados_new_thread: `, dados_new_thread);
  
      if (!criando_new_Thread.ok) {
        // Se a resposta não for 200, lança um err
        console.log(`Não foi possível criar uma nova Thread ...`, dados_new_thread);
        await env.Whatsapp_threads.delete(chave_user);
        //throw new Error(`Erro na API: ${criando_new_Thread.status} ${criando_new_Thread.statusText}`);
      }
      else {
        console.log(`Foi criada uma nova Thread ${dados_new_thread.id} ...`, dados_new_thread);
        await env.Whatsapp_threads.put(chave_user, dados_new_thread.id);
      }
  
    } catch (error) {
      console.error("Erro ao criar a Thread ", error);
      //throw new Error(`Erro ao criar a Thread : ${error.message}`);
      await env.Whatsapp_threads.delete(chave_user);
    }
    // Armazene a nova thread no KV
    let thread_user = await env.Whatsapp_threads.get(chave_user);
    if (thread_user) {
      return new Response(JSON.stringify(thread_user));
    } else {
      return new Response(JSON.stringify(""));
    }
  
  }
  
export async function _validaThread(chave_user, thread_id, headers, env) {
    // Se a thread não existir, cria uma nova
    let url = `https://api.openai.com/v1/threads/${thread_id}`; //Criando a thread apenas
    const timestampAtual = Math.floor(Date.now() / 1000);
  
    try {
      let valida_new_Thread = await fetch(url, { method: 'GET', headers: headers });   //No Body
      let dados_valida_new_thread = await valida_new_Thread.json();
      //console.log( "validando thread se existente:  dados_valida_new_thread: ", dados_valida_new_thread);
  
      if ((!(valida_new_Thread.ok && dados_valida_new_thread.id))) {
        // Se não existir, cria uma nova thread
        console.log("A Thread não existe ou não é mais válida na OpenAI.", dados_valida_new_thread)
        const newthread = await _createThread(chave_user, headers, env);
        console.log(`Uma nova thread foi criada:`, newthread)
      }
      else {
        //thread validada pela API OpenAI
        if (dados_valida_new_thread.created_at) {
          if ((timestampAtual - dados_valida_new_thread.created_at) > 86400) {  //Tolerancia de até 24 horas para uma thread ativa
            console.log("A Thread já existia, mas vencida, logo criando uma nova... Thread vencida: ", dados_valida_new_thread)
            //Delete thread
  
            await _createThread(chave_user, headers, env);
  
          } else {
            //console.log(`Foi validadda a Thread ${dados_valida_new_thread.id} ...`, dados_valida_new_thread);
            await env.Whatsapp_threads.put(chave_user, dados_valida_new_thread.id);
          }
        }
  
      }
  
    } catch (error) {
      console.error("Erro ao validar a Thread ", error);
      throw new Error(`Erro ao validar a Thread : ${error.message}`);
    }
    // Armazene a nova thread no KV
    let thread_user = await env.Whatsapp_threads.get(chave_user);
    return new Response(JSON.stringify(thread_user));
  }


//
// ... (Suas funções getAssistantById, createAssistant, fetchOpenAI_V2, etc. permanecem aqui) ...
//
// ... (Seu código original: obtemTranscricaoAudio, GoogleSpeech, ElevenLabs, Text_to_Speech, se_periodo_IA_valido, normalizarTextoTranscrito, sendTranscriptionEmail) ...
  

// ===================================================================
// A. FUNÇÕES AUXILIARES PARA A API DA OPENAI (usando fetch)
// ===================================================================
// (Suas funções createMessage, createRun, getRunStatus, getLatestAssistantMessage originais)
// ...
export async function createMessage(threadId, prompt, env) {
  const maxRetries = 5;
  const baseDelay = 500; // 500ms inicial (mais conservador)
  const maxDelay = 3000; // Máximo de 3s por tentativa
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Tentativa ${attempt}/${maxRetries} - createMessage(${threadId})`, prompt);
      
      const response = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2',
        },
        body: JSON.stringify({
          role: 'user',
          content: prompt,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log("Função createMessage :: data:", data);
        return data;
      }
      
      const shouldRetry = response.status >= 500 || response.status === 429;
      
      if (!shouldRetry || attempt === maxRetries) {
        console.log(`Erro ${response.status} - não retentável ou última tentativa:`, data);
        return null;
      }
      
      // Delay com cap máximo
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      console.log(`Aguardando ${delay}ms antes da próxima tentativa...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
    } catch (erro) {
      console.log(`Erro na tentativa ${attempt}:`, erro);
      
      if (attempt === maxRetries) {
        return null;
      }
      
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
}

export async function createRun(env_OPENAI_API_KEY, threadId, assistantId, vectorstore, required) {
  const maxRetries = 5;
  const baseDelay = 500;
  const maxDelay = 3000;
  
  // 1. Construímos o payload base UMA VEZ (fora do loop)
  const runPayload = {
    assistant_id: assistantId,
    temperature: 0.2,
  };

  if (required) {
    runPayload.tool_choice = "required";
  }
  
  // 3. Adiciona a tool de File Search (Vector Store)
  if (vectorstore) {
    if (!runPayload.tools) {
      runPayload.tools = [];
    }
    runPayload.tools.push({ type: "file_search" });
    runPayload.tool_resources = {
      file_search: {
        vector_store_ids: [vectorstore]
      }
    };
    console.log('PRODUTOR: (createRun) 🔍 FileSearch HABILITADO.', { vectorStoreId: vectorstore });
  }

  console.log('PRODUTOR: (createRun) 🔍 Payload final chamado em /threads/runs:', runPayload);
  
  // Loop de retry
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Tentativa ${attempt}/${maxRetries} - createRun(${threadId})`);
      
      const response = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/runs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env_OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2',
        },
        body: JSON.stringify(runPayload),
      });
      
      const data = await response.json();
      console.log("Retorno de createRun", data);
      
      if (response.ok) {
        return data.id; // ✅ Retorna o ID do Run
      }
      
      // Verifica se deve fazer retry
      const shouldRetry = response.status >= 500 || response.status === 429;
      
      if (!shouldRetry || attempt === maxRetries) {
        console.log(`Erro ${response.status} - não retentável ou última tentativa:`, data);
        return null;
      }
      
      // Delay com exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      console.log(`Aguardando ${delay}ms antes da próxima tentativa...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
    } catch (erro) {
      console.log(`Erro na tentativa ${attempt}:`, erro);
      
      if (attempt === maxRetries) {
        return null;
      }
      
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
}
export async function getRunStatus(threadId, runId, env) {
  const maxRetries = 5;
  const baseDelay = 500;
  const maxDelay = 3000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Tentativa ${attempt}/${maxRetries} - getRunStatus(${threadId}, ${runId})`);
      
      const response = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log("Retorno de getRunStatus:", data);
        return data; // ✅ Retorna o objeto completo
      }
      
      // Verifica se deve fazer retry
      const shouldRetry = response.status >= 500 || response.status === 429;
      
      if (!shouldRetry || attempt === maxRetries) {
        console.log(`Erro ${response.status} - não retentável ou última tentativa`);
        return null;
      }
      
      // Delay com exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      console.log(`Aguardando ${delay}ms antes da próxima tentativa...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
    } catch (erro) {
      console.log(`Erro na tentativa ${attempt}:`, erro);
      
      if (attempt === maxRetries) {
        return null;
      }
      
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
}


export async function getLatestAssistantMessage(threadId, runId, env) {
  // ... (Sua função original)
  const OPENAI_API_BASE = 'https://api.openai.com/v1';

  // 1. Buscar a lista de mensagens da thread
  const messagesResponse = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/messages`, {
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'assistants=v2',
    },
  });

  if (!messagesResponse.ok) {
    console.error(`Erro ao buscar mensagens da thread ${threadId}:`, await messagesResponse.text());
    return null;
  }

  const messagesList = await messagesResponse.json();
  console.log( "retorno de getLatestAssistantMessage :: messagesList", messagesList )
  if (!messagesList.data || messagesList.data.length === 0) {
    console.warn(`Nenhuma mensagem encontrada na thread ${threadId}.`);
    return null;
  }

  //const latestAssistantMessage = messagesList.data.find(msg => msg.role === 'assistant');
  const latestAssistantMessage = messagesList.data.find(msg => msg.role === 'assistant' && msg.run_id === runId);

  if (!latestAssistantMessage) {
    console.warn(`Nenhuma mensagem do assistente encontrada na thread ${threadId}.`);
    return null;
  }

  // 2. Processar o conteúdo da mensagem
  let responseText = '';
  let annotations = [];
  let fileSearchUsed = false;

  const messageContent = latestAssistantMessage.content.find(content => content.type === 'text');
  console.log( "retorno de getLatestAssistantMessage :: messageContent", messageContent)
  if (messageContent && messageContent.text) {
    responseText = messageContent.text.value;
    annotations = messageContent.text.annotations || [];
    fileSearchUsed = annotations.some(ann => ann.type === 'file_citation');

    if (fileSearchUsed) {
      console.log('Citações de arquivo detectadas. Removendo do texto de resposta.', messageContent);
      const sortedAnnotations = [...annotations].sort((a, b) => b.start_index - a.start_index);
      for (const ann of sortedAnnotations) {
        if (ann.type === 'file_citation') {
          responseText = responseText.slice(0, ann.start_index) + responseText.slice(ann.end_index);
        }
      }
    }
  }

  /*
  Nao precisamos disto agora

  // 3. Buscar detalhes da execução (Run) para obter 'model' e 'usage'
  let runStatus = { model: 'unknown', usage: {} };
  if (latestAssistantMessage.run_id) {
    const runResponse = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/runs/${latestAssistantMessage.run_id}`, {
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    if (runResponse.ok) {
      const runData = await runResponse.json();
      runStatus.model = runData.model;
      runStatus.usage = runData.usage;
    } else {
      console.warn(`Não foi possível buscar os detalhes da run ${latestAssistantMessage.run_id}.`);
    }
  }
  */
 

  // 4. Montar e retornar o objeto JSON final
  return {
    file_search_effective: fileSearchUsed,
    resposta: responseText.trim(),
    annotations: annotations,
   // model: runStatus.model,
   // usage: runStatus.usage,
  };
}

// ===================================================================
// B. [NOVO] FUNÇÕES PARA O CICLO DE FERRAMENTAS (TOOL CALL)
// ===================================================================

/**
 * [NOVO]
 * Executa as lógicas de negócios para as ferramentas do formulário (ex: salvar no D1).
 */
/**
 * [NOVO - COM LOGS DE ERRO]
 * Executa as lógicas de negócios para as ferramentas do formulário (ex: salvar no D1).
 */
/**
 * [CORRIGIDO - SOLUÇÃO 1: OBJETO]
 * Executa as lógicas de negócios para as ferramentas do formulário (ex: salvar no D1).
 * Esta versão assume que 'form_data_json' é um OBJETO (mapa) e não um array.
 */
/**
 * [VERSÃO HÍBRIDA - SOLUÇÃO 1 + GERENCIAR]
 * Executa as lógicas de negócios para as ferramentas do formulário.
 * Usa 'json_set' atômico (Solução 1) para preencher e limpar campos.
 * Usa 'Read-Modify-Write + Trava Otimista' (Solução 2) para 'reiniciar_formulario'.
 */


async function executeFormToolCall(toolCall, payload, env) {
  
  const { phone, setup_data, formIdHash,  } = payload;
  const submissionId = `${phone}_${formIdHash}`;
  let args;

  // 🔧 Função segura para parse JSON
  const safeJSONParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return JSON.parse(str.replace(/\r?\n|\r/g, "").trim());
    }
  };

  try {
    args = safeJSONParse(toolCall.function.arguments);
  } catch (e) {
    console.error(`CONSUMIDOR: ERRO ao fazer parse dos argumentos da tool: ${e.message}`, toolCall.function.arguments);
    return {
      tool_call_id: toolCall.id,
      output: JSON.stringify({ success: false, error: `JSON inválido nos argumentos: ${e.message}` }),
    };
  }

  console.log(`CONSUMIDOR: EXECUTANDO TOOL: ${toolCall.function.name}`, args);

  let output = {};
  let status = "in_progress"; // Status padrão
  let updateD1 = true;
  
  // 🧩 Normalizador de valores
  const normalizeValue = (val, field_id) => {
    if (val === "true" || val === true || /^(sim|yes|s)$/i.test(val)) return true;
    if (val === "false" || val === false || /^(não|nao|no|n)$/i.test(val)) return false;
    if (typeof val !== 'boolean' && !isNaN(Number(val)) && /quant|idade|numero|metros|renda/i.test(field_id)) {
        return Number(val);
    }
    return typeof val === "string" ? val.trim() : val;
  };

  try {
    // ================================================================
    // LÓGICA DO SWITCH (Apenas decide o que fazer)
    // ================================================================
    
    switch (toolCall.function.name) {
      case "preencher_campo_formulario": {
        const { field_id, field_value } = args;
        if (!field_id || field_value === undefined) {
            output = { success: false, error: "field_id e field_value são obrigatórios." };
            updateD1 = false;
            break;
        }
        const normalizedValue = normalizeValue(field_value, field_id);
        output = { success: true, field_id, value_set: normalizedValue };
        break;
      }

      case "gerenciar_formulario": {
        const { acao, field_id } = args;
        if (acao === "limpar_campo") {
            if (!field_id) {
                output = { success: false, error: "field_id é obrigatório para 'limpar_campo'.", acao: acao, fieldId: field_id };
                updateD1 = false;
            } else {
                output = { success: true, action: "limpar_campo", field_id };
            }
        } else if (acao === "reiniciar_formulario") {
            output = { success: true, action: "reiniciar_formulario", acao: acao, fieldId: field_id };
            // Deleta a thread da IA
            await env.Whatsapp_threads.delete(payload.chave_user);
            console.log(`[GERENCIAR] Thread ${payload.chave_user} deletada para reinício.`);
        } else {
            output = { success: false, error: `Ação '${acao}' desconhecida.` };
            updateD1 = false;
        }
        break;
      }


      case "finalizar_formulario": {
        const { confirmacao } = args;
        if (confirmacao) {
          status = "completed_pending_confirmation";
          await env.Whatsapp_threads.delete(payload.chave_user);
          await fn.whatsapp_liga_desl_GPT( "0", `${phone}_${setup_data.app_key}`, env);
          output = { success: true, status, finalizar_formulario: confirmacao};
        } else {
          output = { success: true, status: "cancelled_finalization" };
          updateD1 = false;
        }
        break;
      }

      case "enviar_formulario_whatsapp": {
        status = "ready_to_send";
        await fn.whatsapp_liga_desl_GPT( "0", `${phone}_${setup_data.app_key}`, env);
        output = { success: true, status, tool: "enviar_formulario_whatsapp" };
        break;
      }

      case "continuar_formulario": {
        const { acao, campos_pendentes } = args;
        if (acao !== "continuar_formulario") {
          output = { success: false, error: "Ação inválida para continuar_formulario." };
          updateD1 = false;
          break;
        }
      
        // Apenas loga e retorna a lista de campos pendentes
        console.log(`[CONTINUAR_FORM] Campos ainda pendentes:`, campos_pendentes);
      
        output = {
          success: true,
          action: "continuar_formulario",
          campos_pendentes: campos_pendentes || [],
          message: "Assistente continuará solicitando os campos pendentes.",
        };
      
        // Nenhuma atualização no D1 — apenas continuidade lógica
        updateD1 = false;
        break;
      }



      default:
        console.warn(`⚠️ Tool ${toolCall.function.name} desconhecida.`);
        output = { success: false, error: `Tool ${toolCall.function.name} desconhecida.` };
        updateD1 = false;
    }

    // ================================================================
    // 🗃️ [BLOCO CORRIGIDO - HÍBRIDO] Atualiza D1
    // ================================================================
    
    if (updateD1) {
      const offset = -3;
      const newTimestamp = new Date(Date.now() + offset * 60 * 60 * 1000)
        .toISOString()
        .replace("Z", "");
    
      let update;
      let currentTimestamp; // Usado apenas para 'reiniciar_formulario'

      // --- AÇÃO 1: PREENCHER CAMPO (Solução 1 - Atômico) ---
      if (toolCall.function.name === "preencher_campo_formulario" && args?.field_id) {
        
        const novoValor = normalizeValue(args.field_value, args.field_id);
        const path = `$.${args.field_id}.valor`; // Ex: '$.nome_completo.valor'

        console.log(`[SOLUÇÃO 1] ATOMIC UPDATE (Preencher): Path: ${path}`);
        update = await env.db
          .prepare(`
            UPDATE wpp_form_submission
            SET 
              form_data_json = json_set(form_data_json, ?, json(?)),
              status = ?,
              updated_at = ?
            WHERE id = ? AND token = ?
          `)
          .bind(path, JSON.stringify(novoValor), status, newTimestamp, submissionId, setup_data.token)
          .run();

      } 
      // --- AÇÃO 2: LIMPAR CAMPO (Solução 1 - Atômico) ---
      else if (toolCall.function.name === "gerenciar_formulario" && args?.acao === "limpar_campo") {

        const novoValor = ""; // O valor é fixo
        const path = `$.${args.field_id}.valor`; // Ex: '$.nome_completo.valor'

        console.log(`[SOLUÇÃO 1] ATOMIC UPDATE (Limpar): Path: ${path}`);
        update = await env.db
          .prepare(`
            UPDATE wpp_form_submission
            SET 
              form_data_json = json_set(form_data_json, ?, json(?)),
              status = ?,
              updated_at = ?
            WHERE id = ? AND token = ?
          `)
          .bind(path, JSON.stringify(novoValor), status, newTimestamp, submissionId, setup_data.token)
          .run();
      }
      // --- AÇÃO 3: REINICIAR FORMULÁRIO (Solução 2 - R-M-W + Trava) ---
      else if (toolCall.function.name === "gerenciar_formulario" && args?.acao === "reiniciar_formulario") {

        console.log(`[SOLUÇÃO 2] R-M-W (Reiniciar): Lendo JSON atual...`);
        // 1. LER
        const row = await env.db
          .prepare(`SELECT form_data_json, updated_at FROM wpp_form_submission WHERE id = ? AND token = ?`)
          .bind(submissionId, setup_data.token)
          .first();

        if (!row) throw new Error("Submissão não encontrada para reiniciar");
        
        const formObject = JSON.parse(row.form_data_json || "{}");
        currentTimestamp = row.updated_at; // Pega o timestamp atual

        // 2. MODIFICAR
        for (const key in formObject) {
            if (formObject[key] && typeof formObject[key] === 'object') {
                formObject[key].valor = ""; // Limpa o valor de cada campo
            }
        }
        
        // 3. GRAVAR (com Trava Otimista)
        console.log(`[SOLUÇÃO 2] R-M-W (Reiniciar): Gravando JSON zerado...`);
        update = await env.db
          .prepare(`
            UPDATE wpp_form_submission
            SET 
              form_data_json = ?,
              status = ?,
              updated_at = ?
            WHERE id = ? 
              AND token = ?
              AND updated_at = ? -- <-- A Trava Otimista
          `)
          .bind(
              JSON.stringify(formObject), 
              'in_progress', 
              newTimestamp, 
              submissionId, 
              setup_data.token, 
              currentTimestamp // O timestamp que lemos
          )
          .run();
      } else if ( toolCall.function.name === "finalizar_formulario" ) {
              update = await env.db
              .prepare(`
                UPDATE wpp_form_submission
                SET 
                  status = ?,
                  updated_at = ?
                WHERE id = ? AND token = ?
              `)
              .bind(status, newTimestamp, submissionId, setup_data.token)
              .run();
              
               //Enviando msg com o link:
               const linkmsg = `https://whatsapp.softset.workers.dev/formget?token=${setup_data.token}&submissionId=${submissionId}`
              
               let jBody = JSON.stringify({
                 "phone": phone,
                 "isLid": setup_data.isLid || false,
                 "caption": `Segue o formulário preenchido.`,
                 "url":  linkmsg
               });
               console.log("enviando formulário: ", linkmsg, jBody)
               await wpp.sendZapiResponse(phone, jBody, 'send-link-preview', setup_data, env);


      } else if ( toolCall.function.name === "enviar_formulario_whatsapp" ) {
              update = await env.db
                .prepare(`
                  UPDATE wpp_form_submission
                  SET 
                    status = ?,
                    updated_at = ?
                  WHERE id = ? AND token = ?
                `)
                .bind(status, newTimestamp, submissionId, setup_data.token)
                .run();

              //Enviando msg com o link:
              const linkmsg = `https://whatsapp.softset.workers.dev/formget?token=${setup_data.token}&submissionId=${submissionId}`
              
              let jBody = JSON.stringify({
                "phone": phone,
                "isLid": setup_data.isLid || false,
                "caption": `Segue o formulário preenchido.`,
                "url":  linkmsg
              });
              console.log("enviando formulário: ", linkmsg, jBody)
              await wpp.sendZapiResponse(phone, jBody, 'send-link-preview', setup_data, env);
              
      }
      // --- AÇÃO 4: OUTRAS (Finalizar, Enviar - Atômico) ---
      else {
        console.log(`[SOLUÇÃO 1] ATOMIC UPDATE (Status): Novo Status: ${status}`);
        update = await env.db
          .prepare(`
            UPDATE wpp_form_submission
            SET 
              status = ?,
              updated_at = ?
            WHERE id = ? AND token = ?
          `)
          .bind(status, newTimestamp, submissionId, setup_data.token)
          .run();
      }

      // 4) VERIFICA SE O UPDATE (qualquer um deles) FUNCIONOU
      if (update.success && update.meta.changes > 0) {
        console.log(`💾 [DB UPDATE] Sucesso. Formulário ${submissionId} atualizado. Status: ${status}, Assistente: ${payload.Assistant_ID}`);
      } else if (update.success && update.meta.changes === 0) {
        
        // Se 'currentTimestamp' foi definido, foi uma falha de trava otimista
        if (currentTimestamp) {
            console.warn(`⚠️ [TRAVA OTIMISTA] Conflito de concorrência detectado para ${submissionId} (ação: ${args.acao}).`);
            output = { success: false, error: "Conflito de concorrência. A ação falhou, tente novamente." };
            throw new Error("Concurrency conflict"); // Força o 'retry' da fila
        } else {
            console.warn(`⚠️ [DB UPDATE] Update (Solução 1) executado, mas 0 linhas alteradas. A submissão ${submissionId} existe?`);
        }

      } else {
        // Erro no D1
        console.error("❌ Erro no UPDATE D1:", update.error);
        throw new Error(update.error || "Erro no UPDATE D1");
      }
    }
      
  } catch (err) {
    console.error(`🔥 ERRO TOOL ${toolCall.function.name}:`, err);
    output = { success: false, error: err.message };
    
    // Se o erro foi o conflito, retorna o erro específico para a IA
    if (err.message === "Concurrency conflict") {
      return {
        tool_call_id: toolCall.id,
        output: JSON.stringify(output),
      };
    }
  }

  // Retorna o resultado para a OpenAI
  return {
    tool_call_id: toolCall.id,
    output: JSON.stringify(output),
  };
}



/**
 * [NOVO]
 * Submete os resultados das ferramentas de volta para a OpenAI.
 */
async function submitToolOutputs(threadId, runId, toolOutputs, env) {
    const response = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2',
        },
        body: JSON.stringify({
            tool_outputs: toolOutputs,
        }),
    });

    if (response.ok) {
        return await response.json(); // Retorna o *novo* objeto Run
    }
    console.error("CONSUMIDOR: Falha ao submeter tool outputs:", await response.text());
    return null;
}


// ===================================================================
// C. [REESCRITO] CONSUMIDOR DA FILA
// ===================================================================

/**
 * [REESCRITO]
 * Esta é a função principal do seu consumidor de fila.
 * Agora ela lida com 'completed' E 'requires_action'.
 */

/**
 * [OTIMIZADO] Consumidor de fila - Versão sem polling bloqueante
 * Ganho estimado: 15-30 segundos por requisição
 */


/*
export async function processarEnvioOpenAI(payload, env) {
  const { phone, threadId, setup_data, messageId, isForm } = payload;
  let runId = payload.runId;

  console.log(`CONSUMIDOR: Processando (RunID: ${runId}) para ${phone}. É Formulário? ${!!isForm}`);

  // ✅ OTIMIZAÇÃO #1: Consulta única ao status (sem polling)
  const run = await getRunStatus(threadId, runId, env);

  if (!run) {
    console.error(`CONSUMIDOR: Falha ao obter status do runId ${runId}.`);
    return { status: "error", shouldRetry: true, delaySeconds: 2 };
  }

  // ✅ Estados intermediários: delegar ao sistema de fila
  if (run.status === "in_progress" || run.status === "queued") {
    console.log(`⏳ CONSUMIDOR: Run ${runId} em ${run.status}. Reenfileirando...`);
    await wpp.sendTyping(phone, true, setup_data); // Liga o "digitando..."
    return { 
      status: run.status, 
      shouldRetry: true, 
      delaySeconds: run.status === "queued" ? 2 : 1 
    };
  }

  // ✅ Estados finais: processar imediatamente
  switch (run.status) {
    case "completed": {
      console.log(`✅ CONSUMIDOR: Run ${runId} concluído! Buscando resposta final.`);
      const resultadoCompleto = await getLatestAssistantMessage(threadId, runId, env);
    
      if (resultadoCompleto?.resposta) {
        console.log(`📤 Enviando resposta final: ${resultadoCompleto.resposta.substring(0, 100)}...`);
        await wpp.enviarMensagemWhatsapp(env, resultadoCompleto.resposta, phone, setup_data, false, messageId);
        
        if (isForm) {
          // ✅ CONSULTA STATUS PARA MENU DINÂMICO
          const submissionId = `${phone}_${payload.formIdHash}`;
          const { results } = await env.db.prepare(`
            SELECT 
              status,
              CASE
                WHEN COUNT(
                  CASE 
                    WHEN TRIM(COALESCE(json_extract(je.value, '$.valor'), '')) != ''
                      OR json_type(je.value, '$.valor') IN ('number','boolean')
                    THEN 1
                  END
                ) = 0 THEN 'empty'
                WHEN COUNT(
                  CASE 
                    WHEN json_extract(je.value, '$.obrigatorio') = 1
                      AND (TRIM(COALESCE(json_extract(je.value, '$.valor'), '')) = ''
                        OR json_extract(je.value, '$.valor') IS NULL)
                    THEN 1
                  END
                ) > 0 THEN 'partial'
                ELSE 'complete'
              END AS preenchimento_status
            FROM wpp_form_submission wp
            LEFT JOIN json_each(form_data_json) AS je ON TRUE
            WHERE wp.id = ? AND token = ?
            GROUP BY wp.id
          `).bind(submissionId, setup_data.token).all();
    
          const dbStatus = results[0]?.status || "in_progress";
          const preenchimento = results[0]?.preenchimento_status || "empty";
          
          // Status que impedem edição
          const statusFinalizados = ["completed_pending_confirmation", "ready_to_send", "sent"];
          const isFinalized = statusFinalizados.includes(dbStatus);
          
          // ✅ MONTA MENU FILTRADO
          const session_form = [];
          
          // Opção 1: Continuar (apenas se parcial e não finalizado)
          if (preenchimento === "partial" && !isFinalized) {
            session_form.push({
              rowId: "01",
              title: "📖 Continuar formulário",
              description: "Preencher os campos que ficaram faltando apenas"
            });
          }
          
          // Opção 2: Recomeçar (sempre disponível, exceto se já enviado)
          if (dbStatus !== "sent") {
            session_form.push({
              rowId: "02",
              title: "📖 Quero recomeçar",
              description: "Preencher novamente do zero"
            });
          }
          
          // Opção 3: Visualizar (sempre disponível)
          session_form.push({
            rowId: "03",
            title: "📖 Visualizar Preenchimento",
            description: "Analise o que já foi preenchido"
          });
          
          // Opção 4: Corrigir (apenas se não finalizado)
          if (!isFinalized) {
            session_form.push({
              rowId: "04",
              title: "📖 Quero corrigir um campo",
              description: "Corrigir informação"
            });
          }
          
          // Opção 5: Finalizar (apenas se completo e não finalizado)
          if (preenchimento === "complete" && !isFinalized) {
            session_form.push({
              rowId: "05",
              title: "📖 Finalizar formulário",
              description: "Finalizar o formulário"
            });
          }
          
          // Opção 6: Encaminhar (apenas se finalizado mas não enviado)
          if (dbStatus === "completed_pending_confirmation") {
            session_form.push({
              rowId: "06",
              title: "📖 Encaminhar formulário",
              description: "Enviar pelo Whatsapp"
            });
          }
          
          // Opção 99: Voltar (sempre disponível)
          session_form.push({
            rowId: "99",
            title: "⏮️ Voltar ao Menu",
            description: ""
          });
    
          // ✅ ENVIA MENU APENAS SE TIVER OPÇÕES (além do "Voltar")
          if (session_form.length > 1) {
            const jBody = JSON.stringify({
              phone: phone,
              isGroup: false,
              description: isFinalized 
                ? "_📋 Formulário finalizado. Opções disponíveis:_"
                : "_👇 Comandos do formulário_",
              buttonText: "✨O que gostaria de fazer?✨",
              sections: [{ title: '✨O que gostaria de fazer?✨', rows: session_form }],
              delayMessage: "1"
            });
            
            console.log(`[LOG] Enviando menu dinâmico (${session_form.length} opções) para ${phone}.`);
            await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
          }
        }
        
        return { status: "completed", shouldRetry: false };
      } else {
        console.error(`CONSUMIDOR: Run concluído, mas sem resposta textual.`);
        return { status: "error", shouldRetry: false };
      }
    }

    case "___completed": {
      console.log(`✅ CONSUMIDOR: Run ${runId} concluído! Buscando resposta final.`);
      const resultadoCompleto = await getLatestAssistantMessage(threadId, runId, env);

      if (resultadoCompleto?.resposta) {
        console.log(`📤 Enviando resposta final: ${resultadoCompleto.resposta.substring(0, 100)}...`);
        await wpp.enviarMensagemWhatsapp(env, resultadoCompleto.resposta, phone, setup_data, false, messageId);
        
        // Menu de opções para formulários
        if (isForm) {
          const session_form = [
            { rowId: "01", title: "📖 Continuar formulário",     description: "Preencher os campos que ficaram faltando apenas" },
            { rowId: "02", title: "📖 Quero recomeçar",          description: "Preencher novamente do zero" },
            { rowId: "03", title: "📖 Visualizar Preenchimento", description: "Analise o que já foi preenchido" },
            { rowId: "04", title: "📖 Quero corrigir um campo",  description: "Corrigir informação" },
            { rowId: "05", title: "📖 Finalizar formulário",     description: "Finalizar o formulário" },
            { rowId: "06", title: "📖 Encaminhar formulário",    description: "Enviar pelo Whatsapp" },
            { rowId: "99", title: "⏮️ Voltar ao Menu",           description: "" }
          ];

          const jBody = JSON.stringify({
            phone: phone,
            isGroup: false,
            description: "_👇Comandos do formulário_",
            buttonText: "✨O que gostaria de fazer?✨",
            sections: [{ title: '✨O que gostaria de fazer?✨', rows: session_form }],
            delayMessage: "1"
          });
          
          console.log(`[LOG] Enviando lista de opções (send-option-list) para ${phone}.`);
          await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
        }
        
        await wpp.sendTyping(phone, false, setup_data); // Desliga o "digitando..."
        return { status: "completed", shouldRetry: false };
      } else {
        console.error(`CONSUMIDOR: Run concluído, mas sem resposta textual.`);
        await wpp.sendTyping(phone, false, setup_data);
        return { status: "error", shouldRetry: false };
      }
    }

    case "requires_action": {
      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];

      if (toolCalls.length === 0) {
        console.warn(`⚠️ CONSUMIDOR: requires_action sem tool_calls. Retry...`);
        return { status: "requires_action_empty", shouldRetry: true, delaySeconds: 2 };
      }

      console.log(`🔧 CONSUMIDOR: ${toolCalls.length} tool(s) detectada(s):`, toolCalls.map(t => t.function.name));

      let toolOutputs = [];

      if (isForm) {
        // Executa ferramentas do formulário em paralelo
        toolOutputs = await Promise.all(
          toolCalls.map(async (toolCall) => {
            try {
              const funcName = toolCall.function.name;
              const funcArgs = JSON.parse(toolCall.function.arguments);
              
              console.log(`🛠️ Executando: ${funcName}(${JSON.stringify(funcArgs)})`);
              const ret = await executeFormToolCall(toolCall, payload, env);

              return {
                tool_call_id: toolCall.id,
                output: JSON.stringify(ret?.output || funcArgs)
              };
            } catch (error) {
              console.error(`❌ Erro ao executar tool ${toolCall.function.name}:`, error);
              return {
                tool_call_id: toolCall.id,
                output: JSON.stringify({ success: false, error: error.message })
              };
            }
          })
        );
      } else {
        // Chat genérico sem ferramentas implementadas
        console.warn(`⚠️ CONSUMIDOR: Tool call para chat genérico não implementada.`);
        toolOutputs = toolCalls.map(tc => ({
          tool_call_id: tc.id,
          output: JSON.stringify({ success: false, error: "Tool não implementada para chat genérico" })
        }));
      }

      console.log(`📦 Submetendo ${toolOutputs.length} tool outputs...`);

      const newRun = await submitToolOutputs(threadId, runId, toolOutputs, env);

      if (!newRun) {
        console.error(`❌ CONSUMIDOR: Falha ao submeter tool outputs para Run ${runId}.`);
        return { status: "error_submit_tools", shouldRetry: false };
      }

      console.log(`🔄 Tools submetidas. Novo RunID: ${newRun.id}. Reenfileirando...`);

      // Reenfileira com novo runId para continuar o ciclo
      const newPayload = { ...payload, runId: newRun.id };
      await env.gptprocessamentowhatsapp.send(newPayload);

      return { status: "tools_submitted", shouldRetry: false };
    }

    case "failed":
    case "cancelled":
    case "expired": {
      console.error(`❌ CONSUMIDOR: Run ${runId} falhou (${run.status}).`);
      
      await wpp.sendTyping(phone, false, setup_data); // Desliga o "digitando..."
      
      if (!isForm) {
        await env.Whatsapp_threads.delete(payload.chave_user);
        console.log(`🗑️ Thread ${threadId} deletada (chat genérico falhou).`);
      }
      
      return { status: "failed", shouldRetry: false };
    }

    default: {
      console.warn(`⚠️ CONSUMIDOR: Run ${runId} em estado desconhecido (${run.status}). Retry...`);
      return { status: "unknown", shouldRetry: true, delaySeconds: 2 };
    }
  }
}
*/

                                export async function processarEnvioOpenAI(payload, env) {
                                  const { phone, threadId, setup_data, messageId, isForm } = payload;
                                  let runId = payload.runId;

                                  console.log(`CONSUMIDOR: Processando (RunID: ${runId}) para ${phone}. É Formulário? ${!!isForm}`);

                                  // Polling para aguardar status definitivo
                                  let run;
                                  for (let tentativa = 0; tentativa < 31; tentativa++) {
                                    run = await getRunStatus(threadId, runId, env);

                                    if (!run) {
                                      console.error(`CONSUMIDOR: Falha ao obter status do runId ${runId} (tentativa ${tentativa + 1}).`);
                                      await new Promise(r => setTimeout(r, 1000));
                                      continue;
                                    }

                                    if (["requires_action", "completed", "failed", "cancelled", "expired"].includes(run.status)) {
                                      break;
                                    }

                                    console.log(`⏳ Run ${runId} ainda em ${run.status}, aguardando... (tentativa ${tentativa + 1})`);
                                    await new Promise(r => setTimeout(r, 1000));
                                  }

                                  if (!run) {
                                    console.error(`CONSUMIDOR: Run ${runId} não retornou status válido após polling.`);
                                    return { status: "error", shouldRetry: false };
                                  }

                                  switch (run.status) {
                                    case "completed": {
                                      console.log(`✅ CONSUMIDOR: Run ${runId} concluído! Buscando resposta final.`);
                                      const resultadoCompleto = await getLatestAssistantMessage(threadId, runId, env);
                                    
                                      if (resultadoCompleto?.resposta) {
                                        console.log(`📤 Enviando resposta final: ${resultadoCompleto.resposta.substring(0, 100)}...`);
                                        await wpp.enviarMensagemWhatsapp(env, resultadoCompleto.resposta, phone, setup_data, false, messageId);
                                        
                                        if (isForm) {
                                          // ✅ CONSULTA STATUS PARA MENU DINÂMICO
                                          const submissionId = `${phone}_${payload.formIdHash}`;
                                          const { results } = await env.db.prepare(`
                                            SELECT 
                                              status,
                                              CASE
                                                WHEN COUNT(
                                                  CASE 
                                                    WHEN TRIM(COALESCE(json_extract(je.value, '$.valor'), '')) != ''
                                                      OR json_type(je.value, '$.valor') IN ('number','boolean')
                                                    THEN 1
                                                  END
                                                ) = 0 THEN 'empty'
                                                WHEN COUNT(
                                                  CASE 
                                                    WHEN json_extract(je.value, '$.obrigatorio') = 1
                                                      AND (TRIM(COALESCE(json_extract(je.value, '$.valor'), '')) = ''
                                                        OR json_extract(je.value, '$.valor') IS NULL)
                                                    THEN 1
                                                  END
                                                ) > 0 THEN 'partial'
                                                ELSE 'complete'
                                              END AS preenchimento_status
                                            FROM wpp_form_submission wp
                                            LEFT JOIN json_each(form_data_json) AS je ON TRUE
                                            WHERE wp.id = ? AND token = ?
                                            GROUP BY wp.id
                                          `).bind(submissionId, setup_data.token).all();
                                    
                                          const dbStatus = results[0]?.status || "in_progress";
                                          const preenchimento = results[0]?.preenchimento_status || "empty";
                                          
                                          // Status que impedem edição
                                          const statusFinalizados = ["completed_pending_confirmation", "ready_to_send", "sent"];
                                          const isFinalized = statusFinalizados.includes(dbStatus);
                                          
                                          // ✅ MONTA MENU FILTRADO
                                          const session_form = [];
                                          
                                          // Opção 1: Continuar (apenas se parcial e não finalizado)
                                          if (preenchimento === "partial" && !isFinalized) {
                                            session_form.push({
                                              rowId: "01",
                                              title: "📖 Continuar formulário",
                                              description: "Preencher os campos que ficaram faltando apenas"
                                            });
                                          }
                                          
                                          // Opção 2: Recomeçar (sempre disponível, exceto se já enviado)
                                          if (dbStatus !== "sent") {
                                            session_form.push({
                                              rowId: "02",
                                              title: "📖 Quero recomeçar",
                                              description: "Preencher novamente do zero"
                                            });
                                          }
                                          
                                          // Opção 3: Visualizar (sempre disponível)
                                          session_form.push({
                                            rowId: "03",
                                            title: "📖 Visualizar Preenchimento",
                                            description: "Analise o que já foi preenchido"
                                          });
                                          
                                          // Opção 4: Corrigir (apenas se não finalizado)
                                          if (!isFinalized) {
                                            session_form.push({
                                              rowId: "04",
                                              title: "📖 Quero corrigir um campo",
                                              description: "Corrigir informação"
                                            });
                                          }
                                          
                                          // Opção 5: Finalizar (apenas se completo e não finalizado)
                                          if (preenchimento === "complete" && !isFinalized) {
                                            session_form.push({
                                              rowId: "05",
                                              title: "📖 Finalizar formulário",
                                              description: "Finalizar o formulário"
                                            });
                                          }
                                          
                                          // Opção 6: Encaminhar (apenas se finalizado mas não enviado)
                                          if (dbStatus === "completed_pending_confirmation") {
                                            session_form.push({
                                              rowId: "06",
                                              title: "📖 Encaminhar formulário",
                                              description: "Enviar pelo Whatsapp"
                                            });
                                          }
                                          
                                          // Opção 99: Voltar (sempre disponível)
                                          session_form.push({
                                            rowId: "99",
                                            title: "⏮️ Voltar ao Menu",
                                            description: ""
                                          });
                                    
                                          // ✅ ENVIA MENU APENAS SE TIVER OPÇÕES (além do "Voltar")
                                          if (session_form.length > 1) {
                                            const jBody = JSON.stringify({
                                              phone: phone,
                                              isGroup: false,
                                              isLid: setup_data.isLid || false,
                                              description: isFinalized 
                                                ? "_📋 Formulário finalizado. Opções disponíveis:_"
                                                : "_👇 Comandos do formulário_",
                                              buttonText: "✨O que gostaria de fazer?✨",
                                              sections: [{ title: '✨O que gostaria de fazer?✨', rows: session_form }], 
                                              options: { markIsRead: false} ,
                                              delayMessage: "1"
                                            });
                                            
                                            console.log(`[LOG] Enviando menu dinâmico (${session_form.length} opções) para ${phone}.`);
                                            await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
                                          }
                                        }
                                        
                                        return { status: "completed", shouldRetry: false };
                                      } else {
                                        console.error(`CONSUMIDOR: Run concluído, mas sem resposta textual.`);
                                        return { status: "error", shouldRetry: false };
                                      }
                                    }
                                    case "__completed": {
                                      console.log(`✅ CONSUMIDOR: Run ${runId} concluído! Buscando resposta final.`);
                                      const resultadoCompleto = await getLatestAssistantMessage(threadId, runId, env);

                                      if (resultadoCompleto?.resposta) {
                                        console.log(`📤 Enviando resposta final: ${resultadoCompleto.resposta.substring(0, 100)}...`);
                                        await wpp.enviarMensagemWhatsapp(env, resultadoCompleto.resposta, phone, setup_data, false, messageId);
                                        if (isForm) {
                                              const session_form = [
                                                { rowId: "01", title: "📖 Continuar formulário",     description: "Preencher os campos que ficaram faltando apenas" },
                                                { rowId: "02", title: "📖 Quero recomeçar",          description: "Preencher novamente do zero" },
                                                { rowId: "03", title: "📖 Visualizar Preenchimento", description: "Mostrar todos os campos, preenchidos ou não." },
                                                { rowId: "04", title: "📖 Quero corrigir um campo",  description: "Corrigir um determinado campo (Id)" },
                                                { rowId: "05", title: "📖 Finalizar formulário",     description: "Finalizar o formulário" },
                                                { rowId: "06", title: "📖 Encaminhar formulário",    description: "Enviar pelo Whatsapp" },
                                                { rowId: "99", title: "⏮️ Voltar ao Menu",           description: "" }
                                              ];

                                              const jBody = JSON.stringify({
                                                phone: phone,
                                                isGroup: false,
                                                isLid: setup_data.isLid || false,
                                                description: "_👇Comandos do formuário_",
                                                buttonText: "✨O que gostaria de fazer?✨",
                                                sections: [{ title: '✨O que gostaria de fazer?✨', rows: session_form }], 
                                                options: { markIsRead: false} ,
                                                delayMessage: "1"
                                              });
                                              
                                              console.log(`[LOG] Enviando lista de opções (send-option-list) para ${phone}.`);
                                              await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
                                        }
                                        return { status: "completed", shouldRetry: false };
                                      } else {
                                        console.error(`CONSUMIDOR: Run concluído, mas sem resposta textual.`);
                                        return { status: "error", shouldRetry: false };
                                      }
                                    }

                                    case "requires_action": {
                                      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];

                                      if (toolCalls.length === 0) {
                                        console.warn(`⚠️ CONSUMIDOR: requires_action sem tool_calls. Retry...`);
                                        return { status: "requires_action_empty", shouldRetry: true, delaySeconds: 2 };
                                      }

                                      console.log(`🔧 CONSUMIDOR: ${toolCalls.length} tool(s) detectada(s):`, toolCalls.map(t => t.function.name));

                                      let toolOutputs = [];

                                      if (isForm) {
                                        // Executa ferramentas do formulário
                                        toolOutputs = await Promise.all(
                                          toolCalls.map(async (toolCall) => {
                                            try {
                                              const funcName = toolCall.function.name;
                                              const funcArgs = JSON.parse(toolCall.function.arguments);
                                              
                                              console.log(`🛠️🛠️🛠️🛠️🛠️🛠️🛠️🛠️🛠️ Executando: ${funcName}(${JSON.stringify(funcArgs)})`);
                                              const ret = executeFormToolCall(toolCall, payload, env)

                                              /*
                                              const result = await forms.executarFerramenta({
                                                name: funcName,
                                                arguments: funcArgs,
                                                formId: setup_data.wpp_form_id,
                                                phone
                                              }, env);
                                              */

                                              //console.log(`✔️ Resultado ${funcName}:`, result);

                                              

                                              return {
                                                tool_call_id: toolCall.id,
                                                output: JSON.stringify(funcArgs //result
                                                )
                                              };
                                            } catch (error) {
                                              console.error(`❌ Erro ao executar tool ${toolCall.function.name}:`, error);
                                              return {
                                                tool_call_id: toolCall.id,
                                                output: JSON.stringify({ success: false, error: error.message })
                                              };
                                            }
                                          })
                                        );
                                      } else {
                                        // Chat genérico sem ferramentas implementadas
                                        console.warn(`⚠️ CONSUMIDOR: Tool call para chat genérico não implementada.`);
                                        toolOutputs = toolCalls.map(tc => ({
                                          tool_call_id: tc.id,
                                          output: JSON.stringify({ success: false, error: "Tool não implementada para chat genérico" })
                                        }));
                                      }

                                      console.log(`📦 Submetendo ${toolOutputs.length} tool outputs...`);

                                      const newRun = await submitToolOutputs(threadId, runId, toolOutputs, env);

                                      if (!newRun) {
                                        console.error(`❌ CONSUMIDOR: Falha ao submeter tool outputs para Run ${runId}.`);
                                        return { status: "error_submit_tools", shouldRetry: false };
                                      }

                                      console.log(`🔄 Tools submetidas. Novo RunID: ${newRun.id}. Reenfileirando...`);

                                      // Reenfileira com novo runId para continuar o ciclo
                                      const newPayload = { ...payload, runId: newRun.id };
                                      await env.gptprocessamentowhatsapp.send(newPayload);

                                      return { status: "tools_submitted", shouldRetry: false };
                                    }

                                    case "in_progress":
                                          await wpp.sendTyping(phone, true, setup_data) // liga o "digitando..." (Typing)
                                    case "queued":
                                      console.log(`⏳ CONSUMIDOR: Run ${runId} em andamento (${run.status}). Retry...`);
                                          await wpp.sendTyping(phone, true, setup_data) // Desliga o "digitando..." (Typing)
                                      return { status: "in_progress", shouldRetry: true, delaySeconds: 1 };

                                    case "failed":
                                      await wpp.sendTyping(phone, false, setup_data) // Desliga o "digitando..." (Typing)
                                    case "cancelled":
                                      await wpp.sendTyping(phone, false, setup_data) // Desliga o "digitando..." (Typing)
                                    case "expired":
                                      await wpp.sendTyping(phone, false, setup_data) // Desliga o "digitando..." (Typing)
                                    default: {
                                      console.error(`❌ CONSUMIDOR: Run ${runId} falhou (${run.status}).`);
                                      
                                      if (!isForm) {
                                        await env.Whatsapp_threads.delete(payload.chave_user);
                                        console.log(`🗑️ Thread ${threadId} deletada (chat genérico falhou).`);
                                      }
                                      
                                      return { status: "failed", shouldRetry: false };
                                    }
                                  }
                                }





//
// ... (Restante das suas funções em ia.js, como verifica_assistant, get_assistant, etc.)
// ... (Coloque aqui o resto do seu arquivo ia.js que não foi modificado)
//
export async function verifica_assistant(idTokenCliente, assistant_id_exists, env) {
    try {
      // AVISO: NUNCA exponha seu token de API no código.
      // Use variáveis de ambiente (ex: process.env.OPENAI_API_KEY)
      const OPENAI_API_KEY =  env.OPENAI_API_KEY // "sk-proj-erH_GfVvc-3UQWJtSy8pEoqFkeEiobPzy0u4STDn0CYKRXJAITsJPdKIW0szoJVdSwz8FyoYKKT3BlbkFJnV1AC9L8ohYOurIs8XrDma70tPEKmCIAJj6oZgYQnXtcGjTpvGtgtq6h6cko8wz7OHR4C7xEEA"; // Substitua por uma variável de ambiente
  
      const headers = {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      };
  
      // 1. Tenta buscar o assistente existente
      if (assistant_id_exists) {
        console.log(`Tentando encontrar assistente com ID: ${assistant_id_exists}`);
        const urlGet = `https://api.openai.com/v1/assistants/${assistant_id_exists}`;
        const responseGet = await fetch(urlGet, { method: 'GET', headers: headers });
  
        if (responseGet.ok) {
          const assistente = await responseGet.json();
          // Verifica se o nome do assistente corresponde ao token do cliente
          if (assistente.name === idTokenCliente) {
            console.log(`Assistente encontrado com sucesso!`);
            return assistente;
          } else {
            // O assistente com o ID existe, mas pertence a outro cliente
            console.log(`Assistente com ID ${assistant_id_exists} pertence a outro cliente. Criando um novo.`);
          }
        } else if (responseGet.status === 404) {
          console.log(`Assistente com ID ${assistant_id_exists} não encontrado. Criando um novo.`);
        } else {
          // Outro tipo de erro (ex: 401, 500)
          console.error(`Erro ao consultar o assistente: ${responseGet.statusText}`);
          throw new Error(`Erro ao consultar o assistente: ${responseGet.statusText}`);
        }
      } else {
          console.log("ID do assistente não fornecido. Criando um novo assistente.");
      }
      
      // 2. Se a busca falhou ou o ID não foi fornecido, cria um novo assistente
      const novoAssistente = {
        name: idTokenCliente,
        instructions: null, // Adicione instruções
        description: "", // Adicione uma descrição
        temperature: 0.7,
        model: "gpt-4o-mini", // Exemplo de modelo válido
      };
      
      const urlPost = `https://api.openai.com/v1/assistants`;
      const responsePost = await fetch(urlPost, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(novoAssistente)
      });
  
      if (!responsePost.ok) {
        console.error(`Erro ao criar o assistente: ${responsePost.statusText}`);
        throw new Error(`Erro ao criar o assistente: ${responsePost.statusText}`);
      }
  
      const resultCreate = await responsePost.json();
      console.log(`Assistente criado com sucesso! ID: ${resultCreate.id}`);
      return resultCreate;
  
    } catch (error) {
      console.error('Erro no fluxo de verificação/criação do assistente:', error);
      return null;
    }
  }
  
  
  
  
  
 export async function get_assistant(assistant_id, env) {
    try {
      // Cabeçalhos da requisição para a API OpenAI
      const headers = {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`, //'Bearer sk-proj-erH_GfVvc-3UQWJtSy8pEoqFkeEiobPzy0u4STDn0CYKRXJAITsJPdKIW0szoJVdSwz8FyoYKKT3BlbkFJnV1AC9L8ohYOurIs8XrDma70tPEKmCIAJj6oZgYQnXtcGjTpvGtgtq6h6cko8wz7OHR4C7xEEA',
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      };
      // URL para a API de Assistentes
      const url = `https://api.openai.com/v1/assistants/${assistant_id}`;
  
      // Realizando a requisição GET para listar os assistentes existentes
      let response = await fetch(url, { method: 'GET', headers: headers });
  
      // Verifica se a requisição foi bem-sucedida
      if (!response.ok) {
        console.log(`Erro na consulta da API do Assistente: ${response.statusText}`)
        throw new Error(`Erro na consulta da API: ${response.statusText}`);
  
      }
  
      let result = await response.json();
      console.log(`Result: ${url}:`, JSON.stringify(result))
  
      // Procura pelo assistente com o nome fornecido
      const assistenteExistente = result
  
      // Se o assistente já existe, retorna o ID do assistente
      if (assistenteExistente) {
        console.log(`Assistente encontrado com nome: ${assistenteExistente.name}`);
      } else {
        console.log(`Nenhum assistente encontrado com o Id: ${assistant_id}`);
      }
      return assistenteExistente;
    } catch (error) {
      console.error('Erro ao verificar ou criar o assistente:', error);
      return null; // Em caso de erro, retorna null
    }
  }

// ... (Copie o restante das suas funções de ia.js, como fetchOpenAI_V2, obtemTranscricaoAudio, etc. aqui) ...
// ... (Omitido por brevidade, mas você deve mantê-los no seu arquivo) ...
export async function fetchOpenAI_V2(userMessage, prompt_system, senderName, mesmaData, env, phone, messageId, setup_data, audio_only) {


    //const inst_resp = await get_assistant(setup_data.Assistant_ID)
    const inst_resp = await verifica_assistant(setup_data.app_key, setup_data.Assistant_ID, env)
    console.log( "fetchOpenAI_V2 / inst_resp: ", inst_resp)
    const have_instructions = ((inst_resp.instructions || '').trim() !== '')
    if (!have_instructions) {
         //Enviando Typing (digitando...)
         try {
          if (audio_only) {
            await wpp.sendRecording(phone, false, setup_data) // Desliga o "gravando..." (audio)
          } else {
            await wpp.sendTyping(phone, false, setup_data) // Desliga o "digitando..." (Typing)
          }
        } catch (e) {
          console.log("Houve uma falhar ao tentar enviar Recording ou Typing... Continuando...", e.message)
        }
        console.log("Entrou em fetchOpenAI_V2, mas saindo dentro de !have_instructions", have_instructions)
  
    } else { 
  
        //prompt_system = "";
        //prompt_system = await base_conhecimento(prompt_system)
  
        console.log("Entrou em fetchOpenAI_V2", userMessage)
  
        try {
  
          //Enviando Typing (digitando...)
          try {
            if (audio_only) {
              await wpp.sendRecording(phone, true, setup_data) // Desliga o "gravando..." (audio)
            } else {
              await wpp.sendTyping(phone, true, setup_data) // Desliga o "digitando..." (Typing)
            }
          } catch (e) {
            console.log("Houve uma falhar ao tentar enviar Recording ou Typing... Continuando...", e.message)
          }
  
          //const ResponseTyping = await sendZapiResponse(phone, JSON.stringify({"phone": phone, "value":false}), 'typing', setup_data);
  
          let prompt_ori = `Sou: ${senderName} e fiz a pergunta: "${userMessage}" `;
          let prompt_aux = "";
          let query = "";
  
          //console.log( "Obtendo parametros usuario na AI...");
  
          let prompt, data
          let timenow = 
          prompt = setup_data.prompt_na_pergunta
          //if (setup_data.vectorstore) prompt += `\n**Importante**: Apenas caso seja necessário, dependendo do contexto da pergunta, caso não seja encontrada a resposta em 'instructions', procure na base de conhecimento via 'FileSearch' (VectorStore id: ${setup_data.vectorstore}) para responder`
          prompt += `\nApenas para sua instrução, a data e hora de agora é: ${formata.formatarDataBRUTC3(Math.floor(Date.now() / 1000))} se tiver que dar 'Bom dia', 'Boa tarde' ou 'Boa noite' ou até mesmo para calculo de dados, caso seja necessário.\n`
          //prompt += `o que a pessoa não precisa saber:`
          if (mesmaData === "") {
            // prompt +=  `\nComo já houve um contato hoje, não precisa comprimentar, e depois da sua resposta, na sequencia questione: O que mais gostaria de saber? É só perguntar.\n`;
          } else {
            prompt +=  `\nComprimente com "${mesmaData}, ${senderName} !" e identifique-se como: Sou Atendente Virtual de ${setup_data.nome_fantasia} e pergunte qual duvida a pessoa tem, caso seja a primeira mensagem do dia, algo como *O que gostaria de saber? É só perguntar*. Caso contrario não comprimente mais, e apenas responda a pergunta feita. `;
          }
          //prompt += `\nNão precisa fazer o papel de agent de IA oferecendo-se a fazer algo pela pessoa. Apenas siga estas diretrizes acima com a pergunta abaixo:`
          prompt += `\nResponda o que "${senderName}" te perguntou:\n"${userMessage}"`;
  
          //prompt = prompt.replace(`"`,`\"`).replace(`'`,`\'`)
  
          console.log("fetchOpenAI_V2", prompt)
          data = await RespondeOPENAI(phone, prompt, setup_data, env, messageId, null, null);
  
          
        } catch (error) {
          await wpp.sendTyping(phone, false, setup_data) // desliga o "digitando..." (Typing)
          console.error(`Erro ao inserir Whatsapp_message_queue ou processar a fila : ${error.message}`);
          throw error; // Relança o erro para ser tratado na função de chamada
        }
    }
  }
  

  

export async function obtemTranscricaoAudio(messagem, setup_data, env, phone, paranToken) {
    // Transcrever audio //
    await wpp.sendTyping(phone, true, setup_data); // Desliga o "digitando..." (Typing)
    const fileaudio = setup_data.fileUrl.replace("fiftymotorhome.s3.amazonaws.com/", "softset.com.br/")
  
    console.log("fileaudio", fileaudio)
    if (!fileaudio) {
      console.error(`fileaudio não passado:`)
      return null
    }
  
    const url = "https://speech.googleapis.com/v1/speech:recognize?key=AIzaSyBaSUi-RtEU7OzLjZ4fcp_jFLN7mFXbgCA"
    const headers = {
      'Content-Type': 'application/json',
    };
    //Obtem Base64
    let base64 = "", percErr = 0, base64_full = ""
    // https://whatsapp-webhook.softset.workers.dev/urlToBase64?token=A2153C72DEACAA3E907C2545B78877C5&url=https://softset.com.br/A2153C72DEACAA3E907C2545B78877C5/0f97be6231ae628fcece72c5d1ed28a8eeaa0505440d5445.oga
  
    let response_base64 = await env.whatsappwebhook.fetch(`https://whatsapp-webhook.softset.workers.dev/urlToBase64?token=${paranToken}&url=${fileaudio}`)
    console.log("Fetch: response_base64 Tam:", response_base64.length)
    let req_b64 = await response_base64.json()
    console.log("response_base64.json(), Tam:", req_b64.xbase64.length)
  
    if (req_b64) {
      base64 = req_b64.xbase64.replace("data:audio/ogg; codecs=opus;base64,", "")
      base64_full = req_b64.xbase64
      console.log("base64 (tam)", base64.length)
      //let base64 =  
      //let percErr=  transcript_json.results[0].alternatives[0].confidence
  
      
      //const armazenado = await fn_chat_log(base64, setup_data.whatsappServer, setup_data.phone, setup_data.senderName, setup_data.app_key, env, fileaudio, setup_data.messageId )
  
      //chamando o Google Speech to Text
      let body = JSON.stringify(
        {
          "config": {
            "encoding": "OGG_OPUS",
            "sampleRateHertz": 16000,
            "languageCode": "pt-BR",
            "enableAutomaticPunctuation": true
          },
          "audio": {
            "content": base64
          }
        })
  
  
      try {
        // Enviando o texto para a API Deepgram
        let response_google = await fetch(url, { method: 'POST', headers: headers, body: body });
  
        let transcript_json = await response_google.json()
  
        console.log("transcript_json", transcript_json)
  
        // Verificando se a requisição foi bem-sucedida
        if (response_google.ok && transcript_json.results) {
          // Concatena todos os transcripts em uma única string
          const resposta = transcript_json.results
            .map(r => r.alternatives[0].transcript.trim()) // pega o texto de cada resultado
            .join(" "); // junta tudo com espaço entre eles
        
          console.log("Transcrição completa:", resposta);
        
  
          messagem = await normalizarTextoTranscrito(resposta, env)    //Usa IA para normalizar texto
  
         
          messagem = messagem.replace("WhatsApp", "Whatszaip") 
  
          if ( setup_data.apresentacao_transcricao === "mostrar_sempre" ) {
              let jBody = JSON.stringify({
                "phone": phone,
                "isLid": setup_data.isLid || false,
                "message": `_*Audio transcrito*_ \n🗣️ \`${messagem}\` `, 
                options: { markIsRead: false} ,
                "delayMessage": "1"
              });
              await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
          } else if ( setup_data.apresentacao_transcricao === "enviar_email" ) {
        //    await fn_chat_log(messagem, phone, setup_data.whatsapp, setup_data.senderName, setup_data.app_key, env, setup_data.messageId);
  
            const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
              if ( setup_data.email && re.test(setup_data.email) ) {
                const payload = {
                  to: setup_data.email,
                  subject: "WhatsZAIP - Transcrição de audio recebido ",
                  timestamp: Math.floor(Date.now() / 1000),
                  whatsapp: setup_data.phone,
                  name: setup_data.name,
                  transcription: messagem,
                  attachments: [
                    {
                        filename:  `${phone}_${crypto.randomUUID().substring(0, 16)}.ogg`,
                        content: base64,
                        type: "audio/ogg",
                    }
                  ]
  
                }
                const result = await sendTranscriptionEmail(payload, setup_data.token, env);
                
              }
          } else if ( setup_data.apresentacao_transcricao === "enviar_notificacao" ) {
                fn.sendNotification(setup_data.whatsapp, setup_data.token, messagem, `WhatsZAIP - Transcrição de audio recebido de ${formata.formatarNumeroWhatsApp(phone)} em ${formata.formatarDataBRUTC3(Math.floor(Date.now() / 1000))}\n\nMensagem: ${messagem}`, setup_data.photo) 
          } 
          
          return messagem
          
  
          //https://softset.com.br/A2153C72DEACAA3E907C2545B78877C5/3b336c67fc52c0e36913b6430b94383e823688b753e1d4ee.oga
        } else {
          console.log(`Google error:`, response_google.status, transcript_json) // [MODIFICADO] Loga o status e o json
          await wpp.sendTyping(phone, false, setup_data); // Desliga o "digitando..." (Typing)
          return null
        }
      }
      catch (error) {
        console.log("Erro ao chamar a api Google:", error)
        await wpp.sendTyping(phone, false, setup_data); // Desliga o "digitando..." (Typing)
        return null
      }
    } else {
      console.log("Erro em  req_b64")
      await wpp.sendTyping(phone, false, setup_data); // Desliga o "digitando..." (Typing)
      return null
    }
  }
  
  export async function GoogleSpeech(thread_mensagem, setup_data) {
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=AIzaSyBaSUi-RtEU7OzLjZ4fcp_jFLN7mFXbgCA', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        "input": {
          "text": thread_mensagem.replace("WhatsApp", "Whatszaip")
        },
        "voice": {
          "languageCode": "pt-BR",
          "name": (setup_data.voz === 1 ? "pt-BR-Chirp3-HD-Umbriel" : "pt-BR-Chirp3-HD-Aoede"  )  //pt-BR-Chirp3-HD-Aguiar") //"pt-BR-Standard-B"
        },
        "audioConfig": {
          "audioEncoding": "OGG_OPUS"
        }
      })
    });
  
    if (!response.ok) {
      //await sendRecording(phone, false, setup_data) // liga o "digitando..." (Typing)
      throw new Error(`Erro na API do Google: ${response.status}`);
    }
  
    const data = await response.json();
  
    // Retorna o base64 diretamente
  
    console.log("tamanho base64 ", data.audioContent ? data.audioContent.length : 0) // [MODIFICADO] Checa se existe
  
    return data.audioContent
  }
  
  export async function ElevenLabs(thread_mensagem) {
    const apiKey = "sk_5a5b48e0552720a73bde8b6eddb90730d81d85f273f95cab"
    const voiceID = "JBFqnCBsd6RMkjVDRZzb" // 
    // const voiceID = "eUAnqvLQWNX29twcYLUM" // Dyego Noticias
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceID}?output_format=mp3_44100_128`;
    const payload = {
      text: thread_mensagem,
      model_id: "eleven_multilingual_v2"
    };
  
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
  
      if (!response.ok) {
        throw new Error(`Erro na API: ${response.status}`);
      }
  
      const audioBuffer = await response.arrayBuffer();
      const base64String = btoa(
        new Uint8Array(audioBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        )
      );
  
      return new Response(
        JSON.stringify({
          success: true,
          audio: base64String,
          format: "mp3",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
  
  export async function Text_to_Speech(text, phone, setup_data, env, midiasEncontradas, messageId, resume_openai) {
    if (!text) {
      return new Response('Texto é obrigatório', { status: 400 });
    }
    try {
  
      await wpp.sendRecording(phone, true, setup_data) // liga o "digitando..." (Typing)
      let thread_mensagem, thread_messageId
      if (resume_openai) {
        const prompt = `Caso seja a primeira vez que conversa com a pessoa hoje, comprimente-a chamando-a pelo nome ( ${setup_data.senderName} ), caso contrário apenas cite o nome dela antes das respostas. Faça uma boa resumida curta do texto ( ${text} ) e jamais fale o nome de emojis, simbolos ou "#" caso tenham na frase `
  
        //let thread_mensagem = await RespondeOPENAI(phone, prompt, setup_data, env, messageId );
  
        const data = await RespondeOPENAI(phone, prompt, setup_data, env, messageId);
  
        console.log("fetchOpenAI_V2 => Data", data[0])
        thread_mensagem = data[0].response_text
        thread_messageId = data[0].messageId
      } else {
        thread_mensagem = text
        thread_messageId = messageId
      }
  
  
  
  
      const regexEmojisEStars = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{23F0}\u{1F004}-\u{1F0CF}\u{2934}\u{2935}\u{2B06}\u{2194}\u{2B05}\u{2195}\u{2B06}\u{21A9}\u{21AA}\u{2B50}\u{261D}\u{270A}\u{270B}\u{270C}\u{270D}\u{1F926}\u{1F937}\u{2764}\u{1F495}\u{1F4AF}\u{1F64B}\u{1F64C}\u{1F9B9}\u{1F468}\u{1F469}\u{1F9D1}\u{1F9D2}\u{1F9D3}\u{1F9D4}\u{1F9D5}\u{1F9D6}\u{1F9D7}\u{1F9D8}\u{1F9D9}\u{1F9DA}\u{1F9DB}\u{1F9DC}\u{1F9DD}\u{1F9DE}\u{1F9DF}\u{1F9E0}\u{1F9E1}\u{1F9E2}\u{1F9E3}\u{1F9E4}\u{1F9E5}\u{1F9E6}\u{1F9E7}\u{1F9E8}\u{1F9E9}\u{1F9EA}\u{1F9EB}\u{1F9EC}\u{1F9ED}\u{1F9EE}\u{1F9EF}\u{1F9F0}\u{1F9F1}\u{1F9F2}\u{1F9F3}\u{1F9F4}\u{1F9F5}\u{1F9F6}\u{1F9F7}\u{1F9F8}\u{1F9F9}\u{1F9FA}\u{1F9FB}\u{1F9FC}\u{1F9FD}\u{1F9FE}\u{1F9FF}\u{1F004}\u{1F0CF}*]/gu;
      thread_mensagem = thread_mensagem.toString().replace(regexEmojisEStars, '');
  
      console.log("Text_to_Speech >> textoMensagem", thread_mensagem)  //Mensagem com arquivos se existir 
  
      const retorna_fn_markdown = await wpp.fn_markdown(thread_mensagem)
      if (retorna_fn_markdown.midiasEncontradas.length > 0) {
        thread_mensagem = retorna_fn_markdown.textoMensagem
        midiasEncontradas = retorna_fn_markdown.midiasEncontradas
        console.log(`Encontrado: ${midiasEncontradas.length} midias:`, midiasEncontradas)
        console.log(`thread_mensagem`, thread_mensagem)
      }
  
      let voz_b64 = "", voiceGoogle = true;
  
      if (voiceGoogle) {
        voz_b64 = await GoogleSpeech(thread_mensagem, setup_data)
      } else {
        const response_ret_b64 = await ElevenLabs(thread_mensagem)
        const resp_b64 = await response_ret_b64.json();
        voz_b64 = resp_b64.audio
      }
  
      await wpp.sendRecording(phone, false, setup_data) // liga o "digitando..." (Typing)
      // await sendTyping(phone, true, setup_data); // Desliga o "digitando..." (Typing)
  
  
      const jBody = JSON.stringify(
        {
          "phone": phone,
          "isLid": setup_data.isLid || false,
          "base64Ptt": voz_b64
        })
      console.log("Text_to_Speech >> jBody (tamanho):", jBody.length) // [MODIFICADO] Loga o tamanho
  
      let zapiResponse = await wpp.sendZapiResponse(phone, jBody, 'send-voice-base64', setup_data, env, thread_mensagem);
  
      if (midiasEncontradas.length > 0) {
        const zApiBaseUrl = `${setup_data.server_api}/api/${setup_data.app_key}`;
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${setup_data.ConnectionTokenAPI}`
        };
        await wpp.fn_envia_markdown(phone, setup_data, midiasEncontradas, env, headers, zApiBaseUrl)
      }
  
  
      // await sendTyping(phone, false, setup_data); // Desliga o "digitando..." (Typing)
  
  
      return new Response(JSON.stringify({
        success: true,
        audioContent: voz_b64,
        mimeType: 'audio/ogg',
        midiasEncontradas: midiasEncontradas,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
  
    } catch (error) {
      await wpp.sendRecording(phone, false, setup_data) // liga o "digitando..." (Typing)
      //await sendTyping(phone, false, setup_data); // Desliga o "digitando..." (Typing)
  
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }
  }
  
  
export function se_periodo_IA_valido(config) {
    // Verifica se tem a nova estrutura de dias_configurados
    if (!config.dias_configurados) {
      return false;
    }
  
    // Obter data atual no fuso UTC-3 (São Paulo)
    const now = new Date();
  
    // Ajustar para UTC-3
    const utc3Offset = -3 * 60; // em minutos
    const nowUtc3 = new Date(now.getTime() + (now.getTimezoneOffset() + utc3Offset) * 60000);
  
    // Dia da semana no padrão solicitado: 1=Segunda ... 7=Domingo
    // JS: 0=Domingo ... 6=Sabado
    let diaSemana = nowUtc3.getDay();
    diaSemana = diaSemana === 0 ? 7 : diaSemana; // ajustar domingo para 7
  
    // Pega a configuração específica do dia atual
    const configDia = config.dias_configurados[diaSemana.toString()];
    
    console.log("configDia:", configDia )
  
    // Verifica se o dia está configurado e ativo
    if (!configDia || !configDia.ativo) {
      return false;
    }
  
    // Usa os horários específicos do dia atual
    const { horario_inicio, horario_fim } = configDia;
  
    // Função auxiliar para converter "HH:mm" para minutos no dia (0 a 1439)
    function toMinutes(timeStr) {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    }
  
    const minutosInicio = toMinutes(horario_inicio);
    const minutosFim = toMinutes(horario_fim);
  
    // Hora atual em minutos
    const minutosAgora = nowUtc3.getHours() * 60 + nowUtc3.getMinutes();
  
    console.log(`minutosInicio:${minutosInicio}, minutosFim=${minutosFim}, minutosAgora=${minutosAgora}`)
    //    "minutosInicio:660, minutosFim=540, minutosAgora=690"
    if (minutosInicio < minutosFim) {
      // Intervalo normal dentro do mesmo dia, ex: 08:00 - 18:00
  
      return minutosAgora >= minutosInicio && minutosAgora < minutosFim;
    } else {
      // Intervalo que passa pela meia-noite, ex: 18:00 - 09:00
      // Está dentro se:
      // - É depois do inicio até 23:59
      // OU
      // - É entre 00:00 e fim
      return minutosAgora >= minutosInicio || minutosAgora < minutosFim;
    }
  }
  
  


export async function normalizarTextoTranscrito(texto, env) {
    const prompt_system = `
    Você é um assistente especializado em normalizar e converter textos brasileiros, especialmente transcrições de áudio, para formatos escritos corretos e padrões brasileiros.
  
    Sua tarefa é transformar quaisquer dados escritos por extenso, abreviados, mal interpretados, com erros comuns de transcrição, em formatos claros, padronizados e corretos.
    
    Exemplos do que deve normalizar e converter:
    
    - Emails:
      "super wm arroba gemeiu ponto com" 
      => "superwm@gmail.com"
      
      "joão ponto silva arroba hot mail ponto com"
      => "joaosilva@hotmail.com"
    
    - Datas:
      "26 de abril de 1970" 
      => "26/04/1970"
      
      "26 do 04 de 70"
      => "26/04/1970"
      
      "primeiro de janeiro de dois mil e vinte e cinco"
      => "01/01/2025"
      
      "três de fevereiro de 99"
      => "03/02/1999"
    
    - Horas:
      "às cinco da tarde"
      => "às 17:00"
      
      "dez e quinze da manhã"
      => "10:15"
      
      "meio dia e meia"
      => "12:30"
    
    - Telefones:
      "nove nove nove nove nove nove nove nove nove nove"
      => "(99) 99999-9999"
      
      "zero onze nove oito sete seis cinco quatro três dois"
      => "(011) 98765-432"
    
    - Idades:
      "26 anos"
      => "26"
      
      "vinte e cinco anos"
      => "25"
    
    - Valores monetários:
      "cem reais"
      => "R$ 100,00"
      
      "mil e duzentos e cinquenta e cinco reais e sessenta centavos"
      => "R$ 1.255,60"
    
    - Números em geral:
      "quarenta e dois"
      => "42"
      
      "mil e cinquenta"
      => "1.050"
  
    - Se não for especificado o ano em uma data, considere sempre o ano atual.
    
    - Expressões comuns:
      Corrija erros de pontuação e interpretação, por exemplo:
      
      "Tenho interesse em alugar para 26 de outubro de 2.026 às 17 horas"
      => "Tenho interesse em alugar para 26/10/2026 às 17:00"
    
      "Por favor, envie para super ponto wm arroba gemeiu ponto com"
      => "Por favor, envie para superwm@gmail.com"
    
      "Minha data de nascimento é vinte e seis do quatro de setenta"
      => "Minha data de nascimento é 26/04/1970"
    `;
    const prompt_user = `
    Por favor, normalize o texto a seguir, sem explicações adicionais ou agradecimentos
    Se a informação não puder ser convertida, retorne-a como está, mas sempre tentando corrigir.
    Se o texto for uma frase comum sem necessidade de conversão, retorne exatamente como foi recebido.
    
    Considere o texto a seguir para ser convertido se possível: ${texto}
  `;
  
    const body = {
      model: "gpt-4o-mini",   //"gpt-4o-mini",
      messages: [
        { role: "system", content: prompt_system },
        { role: "user", content: prompt_user }
      ],
      temperature: 0,
      max_tokens: 300,
    };
  
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  
    if (!response.ok) {
      const error = await response.json();
      console.log("Nao passou pela API OpenAI:", texto)
      return texto
    }
  
    const data = await response.json();
    const texto_normalizado = data.choices[0].message.content.trim();
    console.log("texto normalizado: ", texto_normalizado)
    return texto_normalizado
  
  }

  

export async function sendTranscriptionEmail(payload = {}, token, env) {
    console.log( "sendTranscriptionEmail => ", payload)
  // Validações mínimas
  const to = payload.to;
  if (!to || typeof to !== 'string') {
    return { ok: false, status: 400, body: { error: 'Campo "to" (email) obrigatório e inválido' } };
  }

  const endpoint = "https://whatsapp-webhook.softset.workers.dev/sendmail";
  if (!endpoint || !token) {
    return { ok: false, status: 500, body: { error: 'SENDMAIL_ENDPOINT ou SENDMAIL_TOKEN não configurados' } };
  }

  const subject = payload.subject || `Transcrição de Áudio — ${formata.formatTimestamp(payload.timestamp)}`;
  const text = payload.text || [
    'Transcrição de áudio',
    '',
    `Data/Hora: ${formata.formatTimestamp(payload.timestamp)}`,
    `WhatsApp: ${payload.whatsapp || ''}`,
    `Nome: ${payload.name || ''}`,
    '',
    'Mensagem:',
    payload.transcription || ''
  ].join('\n');

  const html = formata.buildHtml({
    timestamp: payload.timestamp,
    whatsapp: payload.whatsapp,
    name: payload.name,
    transcription: payload.transcription,
    subject
  });

  // Monta o body esperado pelo seu endpoint /sendmail (ajuste se necessário)
  const sendPayload = { to, subject, text, html };

  // Encaminha attachments se vierem (preserva como vier)
  if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
    // Espera: { filename, content_base64, content_type? }
    sendPayload.attachments = payload.attachments.map(a => ({
      filename: a.filename,
      content: a.content,
      type: a.type || 'application/octet-stream'
    }));
  }

  // Envia para o endpoint (token via query string)
  const url = `${endpoint.replace(/\/$/, '')}?token=${encodeURIComponent(token)}`;
  console.log( "sendTranscriptionEmail => URL => ", url)
  console.log( "sendTranscriptionEmail => Payload => ",sendPayload)
  try {
    const resp = await env.whatsappwebhook.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Access-Control-Allow-Origin': '*', },
      body: JSON.stringify(sendPayload)
    });

    const status = resp.status;
    console.log( "sendTranscriptionEmail => Email", status )
    const bodyText = await resp.text().catch(() => null);


    if (!resp.ok) {
      return { ok: false, status: 502, body: { error: 'Falha no endpoint de envio', status, body: bodyText } };
    }
    console.log( "sendTranscriptionEmail => Email Ok ", bodyText )
   
    // Sucesso
    return { ok: true, status, body: bodyText };
  } catch (err) {
    return { ok: false, status: 500, body: { error: 'Erro ao conectar com endpoint de envio', details: String(err) } };
  }
}
