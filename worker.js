const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

import * as chamados from './functions/chamados.js';
import * as formata from './functions/formatacoes.js';
import * as forms from './functions/forms.js';
import * as fn from './functions/funcoes-genericas.js';
import * as ia from './functions/IA.js';
import * as menu from './functions/menu.js';
import * as wpp from './functions/wppconnect.js';
import * as fraudguard from './functions/fraudguard.js';


export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      const Payload = message.body;
      console.log(`CONSUMIDOR: Processando tarefa para o usuário ${Payload.phone}.`, Payload);
  
      try {
        const assistantId = Payload.Assistant_ID;

        if (!Payload.threadId || !Payload.runId || !assistantId) {
          console.error("Payload incompleto:", Payload);
          message.ack();
          continue;
        }
        
  
        switch (Payload.type) {
          case "enviar_openai":
          // ✅ Só envia "digitando..." na primeira tentativa
          if (!Payload.retryCount || Payload.retryCount === 0) {
            await wpp.sendTyping(Payload.phone, true, Payload.setup_data);
          }

          const result = await ia.processarEnvioOpenAI({ ...Payload, assistantId }, env);

          const retryCount = (Payload.retryCount || 0) + 1;
          if (result.shouldRetry && retryCount < 8) {
            Payload.retryCount = retryCount;
            const baseDelay = result.delaySeconds || 3;
            const exponentialDelay = baseDelay * Math.pow(2, retryCount - 1);
            const cappedDelay = Math.min(exponentialDelay, 60); // máx 60s

            message.retry({ delaySeconds: cappedDelay });
          } else {
            await wpp.sendTyping(Payload.phone, false, Payload.setup_data);
            message.ack();
          }
          break;
          
          case "processar_imagem":
            // await redimensionarImagem(Payload, env);
            await wpp.sendTyping(Payload.phone, false, Payload.setup_data);
            message.ack();
            break;
  
          default:
            console.log("Tipo desconhecido:", Payload.type);
            await wpp.sendTyping(Payload.phone, false, Payload.setup_data);
            message.ack();
        }
      } catch (error) {
        console.error(`Erro ao processar mensagem:`, error);
        await wpp.sendTyping(Payload.phone, false, Payload.setup_data); 
        message.ack();
      }
    }
  },
  

  async fetch(request, env, ctx) {

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };
    const OPENAI_API_BASE = 'https://api.openai.com/v1';
 
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    
    const { pathname, searchParams } = new URL(request.url);

    if (request.method === 'GET' && pathname === '/formget') {
    
      // 2. MELHORIA: Nomes de variáveis em camelCase (padrão JS)
      const token = searchParams.get('token');
      const submissionId = searchParams.get('submissionId');

  
      // 3. MELHORIA CRÍTICA: Validação de entrada
      // Nunca confie que os parâmetros virão corretos.
      if (!token || !submissionId) {
          return new Response(
              'Erro: Parâmetros "token" e "submissionId" são obrigatórios.', 
              {
                  status: 400, // 400 Bad Request
                  headers: { 'Content-Type': 'text/html; charset=utf-8' },
              }
          );
      }
  
      
      // 4. MELHORIA CRÍTICA: Retorno da Resposta
      // Sua função 'html_form_generate' já retorna uma 'Response'.
      // Você precisa 'retornar' o resultado dela para o cliente.
      try {
          // O 'await' resolve a função, e o 'return' envia
          // a 'Response' dela de volta para o navegador do usuário.
          return await forms.html_form_generate(submissionId, token, env);
      
      } catch (error) {
          // 5. MELHORIA: Tratamento de erro
          // Captura qualquer erro inesperado da sua função.
          console.error('Falha ao gerar o formulário HTML:', error);
          return new Response(
              'Erro interno ao gerar sua página.', 
              {
                  status: 500, // 500 Internal Server Error
                  headers: { 'Content-Type': 'text/html; charset=utf-8' },
              }
          );
      }
    }


    if (request.method === 'POST') {


      const _data = await request.json();
      
      const messageData = JSON.parse(_data);
      


      let messagem = messageData.text?.message || (messageData.listResponseMessage ? messageData.listResponseMessage.title : '');
      if (!messagem && !messageData.type) {
        return new Response(null, { status: 204, headers });
      }



      // const whatsapp_cliente = "5511992076486";
    
      let setup_data = [];
      let labelNames = ""
      let audio_only = false
      const paranToken = searchParams.get('token') || messageData?.instanceId

      /*
      const server_wpp = messageData?.servidor_wpp !== "104.198.110.187"  // << railway
              ? `http://api2.softset.com.br:21465`  // << Contabo
              : "https://api.softset.com.br" 
      */


      // Contato etiquetado 
      if (messageData.sender?.labels) {
        // Normaliza labels para um array de strings (ex: ["23", "3", "2"])
        let labelIds = [];
        if (typeof messageData.sender.labels === 'string') {
          labelIds = messageData.sender.labels.split(',').map(id => id.trim());
        } else if (Array.isArray(messageData.sender.labels)) {
          labelIds = messageData.sender.labels.map(id => String(id).trim());
        }

        //       console.log("IDs das etiquetas normalizadas:", labelIds);

        // Inicializa labelsFull se não existir
        if (!Array.isArray(messageData.sender.labelsFull)) {
          messageData.sender.labelsFull = [];
        }

        // Consulta cada label no banco de dados
        for (const labelId of labelIds) {
          if (!labelId) continue; // Pula IDs vazios

          //            console.log(`Consultando etiqueta: token="${messageData?.instanceId}", label_id_api="${labelId}"`);

          try {
            const result = await env.db.prepare(
              `SELECT name, hexColor FROM whatsapp_etiquetas_api WHERE token = ? AND label_id_api = ?`
            )
              .bind(messageData?.instanceId, labelId)
              .first();

            if (result) {
              messageData.sender.labelsFull.push({
                id: labelId,
                name: result.name,
                hexColor: result.hexColor
              });
            }
            // (Opcional) Removido o else para não adicionar labels vazias
          } catch (error) {
            console.error(`Erro ao consultar label ${labelId}:`, error);
          }
        }

        // Gera string com nomes das etiquetas (ex: "VIP|Cliente|Novo")
        const labelNames = messageData.sender.labelsFull.map(label => label.name).filter(Boolean).join('|');
        //        console.log("Nomes das etiquetas:", labelNames);
      }


      console.log('messageData:', messageData);



      const setup_response = await obter_setup(env, paranToken);
      if (!setup_response.success) {
        console.log("setup_response.error: ", setup_response.error);
        return new Response(setup_response.error, { status: 400 });
      }
      const setup_data_tmp = setup_response.data;
      setup_data = setup_data_tmp[0];
      setup_data.visitante_existente = false;
      setup_data.visitante_nome = "";
      setup_data.no = false;
      setup_data.senderName = messageData.senderName;
      setup_data.phone = messageData.phone.trim()
      setup_data.isLid = messageData.chatLid.toLowerCase().includes("@lid") || messageData.isLid
      setup_data.chatLid = messageData?.chatLid ? messageData.chatLid : ""
      setup_data.whatsappServer = messageData.connectedPhone;
      //setup_data.cpf_cnp = "";
      let dados_cliente;
      dados_cliente = await fn.getClientData(`${setup_data.whatsapp}_${messageData.phone}`, env);
      //console.log( "getClientData:", dados_cliente);
      setup_data.visitante_existente = dados_cliente.success
      setup_data.visitante_blocked = dados_cliente?.data.blocked;
      setup_data.visitante_cpf_cnpj = dados_cliente?.data.cpf_cnpj;
      setup_data.visitante_nome = dados_cliente?.nome;
      setup_data.cnpj = dados_cliente.cnpj || "",
      setup_data.messageId = messageData.messageId || "";
        setup_data.etiquetas = labelNames || "";
      //Gravando como a ultima mensagem
      setup_data.lastmessage = await env.whatsapp_lastmessage.get(`${paranToken}:${setup_data.phone}`) || "";
      setup_data.server_wpp = setup_data.server_api
      setup_data.token = paranToken.trim();
      setup_data.actualmessage = messageData.text?.message || "",
        setup_data.labelsFull = messageData.sender?.labelsFull || []
      const lFim_de_plano = await verifica_fim_plano(setup_data, env) // False = bloqueado | true = liberado
      setup_data.plano_ass_ok = lFim_de_plano
      setup_data.respViaChatGPT = await fn.whatsapp_liga_desl_GPT(null, `${setup_data.phone}_${setup_data.token}`, env)
      //setup_data.respViaChatGPT = String(await env.Whatsapp_chatgpt.get(`${setup_data.phone}_${setup_data.token}`) || 0)   // << está falhando aqui !!!!
      setup_data.fileUrl = messageData?.fileUrl || ""
      setup_data.whatsapp = messageData?.whatsapp || setup_data.chatLid || setup_data.phone || ""
      //console.log(`setup_data.plano_ass_ok = ${setup_data.plano_ass_ok}`)
      if (!setup_data.plano_ass_ok) {
        return new Response(`Cliente com plano vencido/inválido:  token: ${setup_data.token} WhatsappWeb: ${setup_data.whatsappServer}`, { status: 200 });
      }

      
      //  console.log( `>>>> Servidor WPP: ${setup_data.server_wpp} <<<<`, setup_data.server_wpp)

      console.log("Configuraçoes do usuario (setup_data):", setup_data)

      if (setup_data.ligaBot == 0) { //Se o Bot estiver desligado, *NÃO* funciona o Auto-Atendimento e o Assistente Virtual
        return new Response('Auto-Atendimento e o Assistente Virtual *DESLIGADOS* ', { status: 200 });
      }

      const lastmessage = messageData.text?.message || ""


      const mencao_de = messageData.mencao
      let last_protocolo = "", last_contato = ""
      //Verifica se é responsta do atendente:
      const regex = /🗣️ Responder prot\.: \[(\d+)\].*?Responder o chamado do contato (\d+)/s;
      const match = lastmessage.match(regex);
      if (match) {
        last_protocolo = match[1]; // "1745978446"
        last_contato = match[2]; // "5511988704877"
        //  console.log(`Protocolo: ${last_protocolo}, Número: ${last_contato}`);
        env.whatsapp_lastmessage.put(`Atend: ${paranToken}:${last_protocolo}`, `Protocolo respondido: ${last_protocolo} Contato: ${last_contato} por: ${messageData?.phone}`);
        //messageData.status = "XXXXXXXXXX"
        return new Response('Interação com o atendente virtual concluída.', { status: 200 });
      } else {
        //  console.log("Nenhum padrão encontrado");
      }




      if (messageData.status === "RECEIVED" && messageData.event === "onmessage") {
        try {
          const token = messageData?.instanceId;
          const phone = messageData?.phone;
          const isLid = messageData?.isLid
          const body = JSON.stringify({
            id: token,
            phone: isLid ? setup_data.chatLid : phone,
            labels: [messageData.sender.labels],
            timestamp: messageData.momment,
            contact_name: messageData.chatName,
            contact_pushname: messageData.senderName,
            contact_profilePicThumbObj: messageData.photo,
            isLid: isLid,
          })
          /// console.log(`token:${token}, phone:${phone}, body:${body}, header:${headers} `)
         // const ret = await wpp.updatewhatsapp_contatos_archive_picture(env, setup_data, token, phone, body, headers, true)
        } catch (error) {
          //  console.log( "Erro na função updatewhatsapp_contatos_archive_picture ao tentar atualizar a tabela whatsapp_contatos ", error.text)
        }
      }


      try {

        // btoa(unescape(encodeURIComponent(str)))




        const { phone, senderName, text, listResponseMessage, connectedPhone, messageId, instanceId, photo, fileUrl, isLid } = messageData;
        let messagem = text?.message || (listResponseMessage ? listResponseMessage.title : '');
        console.log(">>> Mensagem: ", messagem)
        await env.whatsapp_lastmessage.put(`${paranToken}:${phone}`, messagem);

        //await whatsapp_liga_desl_GPT_audio( 1, `${phone}_${setup_data.token}`, env);   //Audio habilitado por Default

        let ligaBot = setup_data.liga_desl_bot;
        let gclid = "", timestamp = 0, orcamento_id = "";

        try {
            // 1. Melhoria no Regex para evitar erros se a mensagem for nula/vazia
            const foneNormalizado = normalizarTelefone(messageData.whatsapp)
            
            if (foneNormalizado) { // Se match não for null (encontrou o padrão)
                
                // 2. CORREÇÃO: Removi o 'const' e as chaves extras. 
                // Atribuímos diretamente às variáveis que você já declarou acima.
                const resultado = await efetivarConversao(foneNormalizado);
                
                if (resultado) {
                    gclid = resultado.gclid || "";
                    timestamp = resultado.timestamp || 0;
                    // orcamento_id já foi atribuído acima
                }

                console.log(`Conversão efetivada para ID: ${orcamento_id}`);
            } else {
                console.log(`Acesso orgânico. Não por Google ADS`);
            }
        } catch (error) {
            // 3. Captura o erro sem travar a execução do Worker/Bot
            console.error('Erro ao chamar efetivarConversao:', error.message);
        }

        // -====== Controlando se a IA responde automaticamente dentro do horario configurado =====- 
        // Pega o valor do tipo de atendimento do KV (string)
        let tipo_atendimento_kv = await env.MENU_STORAGE.get(`tipo-servico:${setup_data.app_key}`);

        // Converte para número, default 1
        let tipo_atendimento = Number(tipo_atendimento_kv) || 1;

        let se_ia_ok = false;
        let tipo_atendimento_ia_ok = false;

        console.log("tipo_atendimento KV", tipo_atendimento);

        //// Pega a configuração IA do KV (string JSON)
        let tipo_atendimento_IA_CFG_str = await env.MENU_STORAGE.get(`tipo-servico-IA-cfg:${setup_data.app_key}`) || '{}';

        const tipo_gpt = await fn.whatsapp_liga_desl_GPT(null, `${phone}_${setup_data.app_key}`, env);  // "0" => sem GPT

        let tipo_atendimento_IA_CFG = {};
        try {
          // Faz parse da string para objeto
          tipo_atendimento_IA_CFG = JSON.parse(tipo_atendimento_IA_CFG_str);
        } catch (e) {
          console.warn('Erro ao fazer parse do tipo_atendimento_IA_CFG:', e);
        }

        // Verifica se configuracao_ia existe antes de usar
        if (tipo_atendimento_IA_CFG && tipo_atendimento_IA_CFG.configuracao_ia) {
          const configuracao_ia = tipo_atendimento_IA_CFG.configuracao_ia;
          console.log("configuracao_ia KV", configuracao_ia);

          // Verifica se usa o novo formato (dias_configurados) ou o antigo
          let configParaValidacao = configuracao_ia;
          
          // Se tem o novo formato (dias_configurados), usa ele diretamente
          if (configuracao_ia.dias_configurados) {
            configParaValidacao = configuracao_ia;
          } else if (configuracao_ia.dias_semana) {
            // Compatibilidade: converte formato antigo para novo
            const diasConfigurados = {};
            for (let i = 1; i <= 7; i++) {
              diasConfigurados[i] = {
                ativo: configuracao_ia.dias_semana.includes(i),
                horario_inicio: configuracao_ia.horario_inicio || "18:00",
                horario_fim: configuracao_ia.horario_fim || "09:00"
              };
            }
            configParaValidacao = { dias_configurados: diasConfigurados };
          }

          // Chama sua função que verifica o período válido com a nova estrutura
          se_ia_ok = await ia.se_periodo_IA_valido(configParaValidacao);

          console.log("configuracao_ia KV Ok? ", se_ia_ok);

          // Só IA ativo se tipo_atendimento=3 e período ok
          tipo_atendimento_ia_ok = (tipo_atendimento === 3 && se_ia_ok);
          console.log("tipo_atendimento_ia_ok? ", tipo_atendimento_ia_ok);

          if (!tipo_atendimento_ia_ok) { // IA apenas dentro da semana/horário permitidos
            tipo_atendimento = 1;
          }
        }
        // -====== ========================= =====-


        console.log(`Tipo Atendimento: ${tipo_atendimento} :: IA ok? ${se_ia_ok}`);
        let lbot = 0;

        if ( (tipo_atendimento === 3 && tipo_gpt &&  tipo_gpt === "0") || messagem.toLowerCase() === "menu" ) {
            tipo_atendimento = 1
            console.log(`Tipo Atendimento estava = 3, mas bloquado para atendimento por GPT: Tipo atendimento agora: ${tipo_atendimento} :: IA ok? ${se_ia_ok}`);
        }

        //FraudGuard 

        

        //

        // FIRELABELS ===> O que fazer se um contato estiver etiquetado <==
        // FIRELABELS ===> O que fazer se um contato estiver etiquetado <==
        try {
          // Desestruturação de tudo que vamos usar do setup_data
          const {
            labelsFull,
            token,
            app_key,
            phone,
            isLid,
            chatLid,
            wellcome_menu,
            senderName,
            photo
          } = setup_data;

          // Para cada etiqueta, dispara as ações em paralelo
          await Promise.all(labelsFull.map(async label => {
            const label_id_api = label.id;
            const label_name = label.name;

            // Busca todas as ações para esta etiqueta
            const { results } = await env.db
              .prepare(`
                SELECT *
                  FROM whatsapp_etiquetas_acoes
                WHERE action <> 'none'
                  AND token = ?
                  AND label_Id_api = ?
              `)
              .bind(token, label_id_api)
              .all();

            if (!results.length) return;

            // Executa em paralelo cada ação retornada
            await Promise.all(results.map(async row => {
              const { action, value_type, value } = row;

              switch (action) {
                case 'ignore_menu':
                  if ((value_type === 'boolean' && value === "1") || (value_type === 'string' && value === "1")) {
                    //                    console.log( "Entrou em 'ignore_menu' ")
                    await fn.whatsapp_liga_desl_GPT("0", `${phone}_${token}`, env);
                    let menu_digitado = await menu.fn_chamando_menu(messagem.toLowerCase(), setup_data)
                    //                    console.log( `${messagem.toLowerCase()} foi informada em 'ignore_menu'`, menu_digitado)
                    if (menu_digitado) {
                      const jBody = JSON.stringify({
                        phone: isLid ? setup_data.chatLid : phone,
                        isLid: isLid,
                        message: `[ ⚠️ \`Menu indisponível\` ]\n\n`, 
                        options: { markIsRead: false} ,
                        delayMessage: "1"
                      });
                      await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
                      messageData.text = ""
                      messagem = "";
                      let lbot = 0;
                    }
                    // wellcome_menu = "";
                    //                    console.log(">> ignore_menu:", messagem);
                  }
                  break;

                case 'ignore_ai':
                  if (value_type === 'boolean' && value === "1") {
                    tipo_atendimento = 1;
                    messageData.mimetype = ""  //Limpa anexos
                    messagem = messagem.replace("💬", "");
                    //                    console.log(">> ignore_ai:", messagem);
                  }
                  break;

                case 'menu_always':
                  if (value_type === 'boolean' && value === "1") {
                    tipo_atendimento = 1;
                    await fn.whatsapp_liga_desl_GPT("0", `${phone}_${token}`, env);
                    await env.whatsapp_menu_session.delete(`${phone}`);
                    //await whatsapp_liga_desl_GPT_audio( 0, `${phone}_${token}`, env);   //Desabilita audio
                    messageData.fileUrl = ""
                    messagem = messagem.replace("💬", "")
                    //                    console.log(">> menu_always:", messagem);
                  }
                  break;

                case 'ai_always':
                  if (value_type === 'boolean' && value === "1") {
                    messagem = "💬 " + messagem;
                    await fn.whatsapp_liga_desl_GPT("1", `${phone}_${token}`, env);
                    //                    console.log(">> ai_always:", messagem);
                  }
                  break;

                case 'custom_response':
                  if (value) {
                    const jBody = JSON.stringify({
                      phone: isLid ? setup_data.chatLid : phone,
                      isLid: isLid ,
                      message: `${value}\n\n`, 
                      options: { markIsRead: false} ,
                      delayMessage: "1"
                    });
                    //                    console.log(">> custom_response:", jBody);
                    await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
                  }
                  break;

                case 'send_notification':
                  if (value === "1") {
                    const chave = `lastNotify:${app_key}:${phone}:${label_name}`;
                    const last = await env.Controle_NotificacaoKV.get(chave);
                    const now = Date.now();
                    if (!last || now - Number(last) > 5 * 60 * 1000) {
                      const cText = `Aviso: O contato ${formata.formatarNumeroWhatsApp(phone)} (${senderName}), etiquetado como "${label_name}", enviou uma mensagem.`;
                      await fn.sendNotification(phone, paranToken, cText, "WhatszAIp", photo);
                      await env.Controle_NotificacaoKV.put(chave, now.toString());
                    }
                  }
                  break;

                case 'forward_docs':
                  if (value && messageData.mimetype !== "text/plain" && !messageData.mimetype.startsWith("audio/ogg") && fileUrl) {
                    const { results: docs } = await env.db.prepare(`
                      SELECT a.*, b.setor, b.whatsapp
                        FROM Whatsapp_etiquetas_acoes a
                        JOIN whatsapp_atendentes_setores b
                          ON a.token = b.token
                        AND a.value = b.id
                      WHERE a.action = 'forward_docs'
                        AND a.token = ?
                        AND a.label_id_api = ?
                    `).bind(app_key, label_id_api).all();

                    if (docs.length) {
                      const d = docs[0];
                      const chaveD = `lastNotify:${app_key}:${d.whatsapp}:${label_name}`;
                      const lastD = await env.Controle_NotificacaoKV.get(chaveD);
                      const nowD = Date.now();
                      if (!lastD || nowD - Number(lastD) > 5 * 60 * 1000) {
                        const cText2 = `⚠️ Mensagem automática:\nContato: ${formata.formatarNumeroWhatsApp(phone)} (${senderName})\nEtiqueta: "${label_name}" enviou doc/imagem:`;
                        const body1 = JSON.stringify({ phone: isLid ? setup_data.chatLid : phone, isLid: isLid, message: `${cText2}\n\n`, 
                        options: { markIsRead: false} , delayMessage: "1" });
                        const body2 = JSON.stringify({ phone: isLid ? setup_data.chatLid : phone, isLid: isLid, isGroup: false, messageId, 
                          options: { markIsRead: false}  });
                        await wpp.sendZapiResponse(phone, body1, "send-message", setup_data, env);
                        await wpp.sendZapiResponse(phone, body2, "forward-messages", setup_data, env);
                        await env.Controle_NotificacaoKV.put(chaveD, nowD.toString());
                      } else {
                        // Dentro do intervalo: só encaminha
                        const bodyF = JSON.stringify({ phone: d.whatsapp, isLid: isLid, isGroup: false, messageId, 
                          options: { markIsRead: false}  });
                        await wpp.sendZapiResponse(phone, bodyF, "forward-messages", setup_data, env);
                      }
                    }
                  }
                  break;

                case 'assign_label':
                  try {
                    const ret = await fn_attrib_label(
                      phone,
                      String(value),
                      null,
                      setup_data
                    );
                    //                      console.log('[assign_label] Label atribuído com sucesso:', ret);
                  } catch (error) {
                    console.error('[assign_label] Erro ao atribuir label:', error);
                    // aqui você pode, por exemplo, enviar uma mensagem de erro ao usuário
                    // ou lançar novamente: throw error;
                  }
                  break;

                // outros casos (assign_label, block_contact, add_note, etc.)
                default:
                  console.log("Ação não reconhecida:", action);
              }
            }));
          }));
        } catch (erro) {
          console.log("Erro ao executar FireLabels:", erro);
        }


        //
        // ==================================================== 

        if (setup_data.liga_desl_bot === 1 && messageData.mimetype && messageData.type) {

          console.log(`Media recebida: liga_desl_bot: ${setup_data.liga_desl_bot}  mimetype: ${messageData.mimetype}  Type: ${messageData.type} `, fileUrl)

        }





        let chave = `delay_${phone}_${setup_data.app_key}`; // Consistência com 'audioTimeKey' do outro trecho
        let chavegpt = `${phone}_${paranToken}`; // Consistência com 'audioTimeKey' do outro trecho
        // Primeiro, obtenha o status do áudio do KV
        // Se a chave existe, significa que o áudio está desabilitado (dentro dos 10 minutos)
        // Se a chave não existe, significa que o áudio está habilitado (passaram 10 minutos)

        // Se a mensagem é um áudio e o bot está ligado, E o áudio *não* está desabilitado pelo delay...
        if (setup_data.liga_desl_bot === 1
          && messageData.mimetype
          && messageData.mimetype == "audio/ogg; codecs=opus"
          && messageData.type
          && (messageData.type == "ptt" || messageData.type == "audio")
        ) {



          let msg = ""
          let timeDelay =0, difTimestamp_atual = 0, timeremain = 0, ligaMicResposta = false
          // Liga o microfone para resposta da IA (se a condição acima permitir)
          msg = await ia.obtemTranscricaoAudio(messagem, setup_data, env, phone, paranToken);
          
          /* -DESLIGUEI EM 01/11/25, POIS SUBENTENDE-SE QUE O USUARIO PODE ESCREVER OU AUDIO, A RESPOSTA É A MESMA... AUDIO COMO SE FOSSE UM TEXTO DIGITADO...
          let val_ligadesl_audio = await env.Whatsapp_chatgpt_audio.get(chave) // verifica se há timestamp de delay aguardando...
          if ( !val_ligadesl_audio || val_ligadesl_audio === 0) {   // Se estiver timestamp na chave do Whatsapp_chatgpt_audio
            msg = await ia.obtemTranscricaoAudio(messagem, setup_data, env, phone, paranToken);
          } else {
              timeDelay = 900
              difTimestamp_atual = (Math.floor(Date.now() / 1000)) - val_ligadesl_audio;
              timeremain = ( timeDelay-difTimestamp_atual)/60 < 0 ? 0 : (timeDelay-difTimestamp_atual)/60
              console.log(`Aguardando... ${timeremain} de ${timeDelay}`)
              ligaMicResposta = difTimestamp_atual > 900 // 3
          }
          */


          


          //const audioDesabilitadoPeloDelay = await env.Whatsapp_chatgpt_audio.get(chave) !== null;
          //const ligaMicResposta = !audioDesabilitadoPeloDelay; // Reflete o status atual baseado no KV

          if (!ligaMicResposta) {
            await fn_self_messageAlert( `${setup_data.nome_fantasia}\nA mensagem de audio de ${phone} não foi respondido pela IA devido interação humana. Aguardando total de 15 min (${timeDelay} seg)) programado. minutos restantes: ${timeremain}`, setup_data, env)
          }
          console.log(`ligaMicResposta: (Mensagem de audio de ${phone} não está sendo repondida pela IA devido o delay de 15 min (${timeDelay} seg)) programado. minutos restantes: ${timeremain}`);

          if (msg) {

            const lPreenchendoForm = setup_data.respViaChatGPT === "2";
            console.log("Preenchendo formulário? ", lPreenchendoForm);

            let cEmoji = ''; // Inicializa vazio
            audio_only = false; // Assumo que essa variável controla algo mais abaixo
            if (lPreenchendoForm) {
              cEmoji = '📖';
            } else if (ligaMicResposta) { // Se o áudio está habilitado para resposta
              cEmoji = '🎤';
              audio_only = true; // Assumo que essa variável controla algo mais abaixo
            }
            // Se cEmoji permanecer vazio, significa que não está preenchendo formulário e o áudio está desabilitado.

            messagem = `${cEmoji} ${msg}`;

            console.log("Mensagem transcrita pelo audio:", messagem);
          }
        }




        //        console.log("URL de Entrada: ", Requesturl);


        if (messagem === "" || phone.includes("-") || messagem.startsWith("Instruções Principais: Este prompt foi elaborado para que você")) { // previnir que não apresente o prompt system por algum motivo 
          // Se Grupo, desconsiderar
          //return new Response(null, { status: 200  });
          return new Response('Interação com o atendente virtual concluída.', { status: 200 });

        }



        if (messageData.status === "RECEIVED") {

          //await wpp.sendTyping(phone, true, setup_data) // Desliga o "digitando..." (Typing)



          //==========================================//
          //============ INICIO DO CHATHOOK ==========//

          // Lógica para MENU e "Voltar ao Menu" pelo USUÁRIO
          if ((
            (messagem.trim().toLowerCase().split(/\s+/).length === 1 && messagem.trim().toLowerCase() === "menu")
            ||
            (messagem.trim().toLowerCase() === "⏮️ voltar ao menu")
          )
          ) {
            console.log(`Usuário ${phone} solicitou menu.`);
            // Lógica para apresentar o menu inicial ao usuário.
            // Pode ser o ponto para iniciar um novo atendimento se não houver um ativo.
            // return new Response("OK", { status: 200 }); // Descomente se quiser encerrar o processamento aqui
          }
          // Bloco para "encerrar chamado" do usuário, permitindo ID explícito ou buscando o ativo
          else if (messagem.trim().toLowerCase().includes("⏮️ encerrar chamado")) {
            console.log(`Usuário ${phone} solicitou encerramento.`);
            const encerrar_regex_user = /⏮️ encerrar chamado\s*\[?(\d+)\]?/i;
            const encerrar_match_user = messagem.match(encerrar_regex_user);
            let protocol_id_to_terminate_by_user = null;

            if (encerrar_match_user && encerrar_match_user[1]) {
              protocol_id_to_terminate_by_user = encerrar_match_user[1];
              console.log(`Usuário ${phone} solicitou encerramento para protocolo: ${protocol_id_to_terminate_by_user}.`);
              await chamados.fn_encerraProtocolo(phone, paranToken, setup_data, env, "usuario", protocol_id_to_terminate_by_user);
            } else {
              // Se o usuário não especificou o protocolo, tenta encontrar o ativo dele
              const active_protocol_key = `active_protocol_for_client:${phone}:${paranToken}`;
              const active_protocol_id_for_user = await env.whatsapp_chathook.get(active_protocol_key);
              if (active_protocol_id_for_user) {
                console.log(`Usuário ${phone} solicitou encerramento (sem ID explícito), encontrando protocolo ativo: ${active_protocol_id_for_user}.`);
                await chamados.fn_encerraProtocolo(phone, paranToken, setup_data, env, "usuario", active_protocol_id_for_user);
              } else {
                console.warn(`Comando de encerramento de usuário recebido de ${phone}, mas o protocolo não foi especificado e nenhum protocolo ativo foi encontrado. Ignorando.`);
              }
            }
            return new Response("OK", { status: 200 });
          }
          else {
            // --- Processamento de Mensagens de Atendimento ---

            const mencao = messageData?.quotedMsg?.message;
            // Regex ajustado para o formato da menção (removido 'Menu' e adicionado underline opcional)
            //const regex = /^🎫 _Protocolo_: `(\d+)`\n👤 _Cliente_: `(\d+) - (.+?)`\n\n📝 _Pergunta_: \n\n\*?_*(.+?)*_*\n\n_\(Cliente receberá exatamente a sua resposta\)_\s*$/s;
            const regex = /^🎫 _Protocolo_: `(\d+)`\r?\n👤 _Cliente_: `(\d+)(?: - (.+?))?`\r?\n\r?\n📝 _Pergunta_: \r?\n\r?\n\*?\s*_*((?:.|\r?\n)+?)\s*_*?\r?\n\r?\n_\(Cliente receberá exatamente a sua resposta\)_\s*$/s;

            const match = mencao?.match(regex);

            let mencao_protocolo = "";
            let mencao_contatoTelefone = "";
            let mencao_textoMensagem = "";
            let isAtendenteResponding = false;

            if (match) {
              mencao_protocolo = match[1];
              mencao_contatoTelefone = match[2];
              mencao_textoMensagem = match[4]; // Captura o texto da mensagem
              isAtendenteResponding = true;
              console.log(`Mensagem com menção. Atendente ${phone} está respondendo ao cliente ${mencao_contatoTelefone} (protocolo ${mencao_protocolo}).`);
            } else {
             // console.log(`Mensagem sem menção. Assumindo que é do cliente ${phone} ou nova mensagem.`);
              mencao_contatoTelefone = phone; // Assume que o remetente é o cliente
            }

            const phone_alvo_para_cliente = mencao_contatoTelefone;

            const isCurrentSenderAttendantResult = await env.db.prepare(`SELECT id, nome || IFNULL(' [' || setor || ']', '') AS name FROM whatsapp_atendentes_setores WHERE token = ? AND whatsapp = ?`).bind(paranToken, phone).first();
            const isCurrentSenderAttendant = !!isCurrentSenderAttendantResult;
            let atendente_name_from_db = isCurrentSenderAttendantResult?.name || senderName;


            // --- Lógica de ENCERRAMENTO (botão ou digitação do atendente) ---
            if (messagem.toLowerCase().includes(`⏮️ encerrar prot.:`)) {
              let quem_solicitou_encerramento = "atendente";
              let protocolo_para_encerrar = null;

              const encerrar_regex = /⏮️ Encerrar prot\.:\s*\[?(\d+)\]?/;
              const encerrar_match = messagem.match(encerrar_regex);
              if (encerrar_match && encerrar_match[1]) {
                protocolo_para_encerrar = encerrar_match[1];
              }

              if (!protocolo_para_encerrar) {
                console.warn(`Comando de encerramento de atendente recebido de ${phone}, mas o protocolo não foi especificado na mensagem. Ignorando.`);
                return new Response("OK", { status: 200 });
              }

              console.log(`${quem_solicitou_encerramento} ${phone} solicitou encerramento para protocolo: ${protocolo_para_encerrar}.`);
              await chamados.fn_encerraProtocolo(phone, paranToken, setup_data, env, quem_solicitou_encerramento, protocolo_para_encerrar);
              return new Response("OK", { status: 200 });
            }

            // --- Lógica de ROTEAMENTO (se não for encerramento) ---
            if (isAtendenteResponding && isCurrentSenderAttendant) {
              // Atendente respondeu via menção.
              const protocol_map_key = `protocol:${mencao_protocolo}:${paranToken}`;
              const protocol_map_data = await env.whatsapp_chathook.get(protocol_map_key);

              if (protocol_map_data) {
                const map_info = JSON.parse(protocol_map_data);
                if (map_info.client_phone === mencao_contatoTelefone && map_info.attendant_phone === phone) {

                  let jBody = JSON.stringify({
                    phone: mencao_contatoTelefone,
                    isGroup: false,
                    isLid: isLid,
                    description: `🎫 _Protocolo_: \`${mencao_protocolo}\`\n` +
                      `👩‍💻 _Atendimento_: \`${atendente_name_from_db}\`\n\n` +
                      `👤 _Sua pergunta_:\n\`${mencao_textoMensagem}\`\n` +
                      `👩‍💻 _Resposta_:\n*${messagem}*`,
                    buttonText: "✨ ⏮️ Quero encerrar✨",
                    sections: [
                      {
                        title: 'Clique aqui para solicitar o encerramento do chamado',
                        rows: [
                          {
                            "rowId": "99",
                            "title": `⏮️ Encerrar chamado [${mencao_protocolo}]`, // Mude aqui para "encerrar chamado"
                            "description": ""
                          }
                        ]
                      }
                    ], 
                    options: { markIsRead: false} ,
                    delayMessage: "1"
                  });
                  await wpp.sendZapiResponse(mencao_contatoTelefone, jBody, 'send-option-list', setup_data, env);
                  console.log(`Atendente ${phone} respondeu com menção ao cliente ${mencao_contatoTelefone} (Protocolo: ${mencao_protocolo}).`);
                } else {
                  console.warn(`Atendente ${phone} tentou responder via menção, mas o chamado (protocolo ${mencao_protocolo}) não está associado a este atendente ou cliente (${mencao_contatoTelefone}).`);
                }
              } else {
                console.warn(`Atendente ${phone} tentou responder via menção para cliente ${mencao_contatoTelefone}, mas não há registro de protocolo '${mencao_protocolo}' ou ele já foi encerrado.`);
              }
            } else if (!isCurrentSenderAttendant) { // Se a mensagem é de um cliente e não é uma menção/comando de encerramento
              // Tenta encontrar o protocolo ativo para este cliente
              const active_protocol_key = `active_protocol_for_client:${phone}:${paranToken}`;
              const active_protocol_id_for_client = await env.whatsapp_chathook.get(active_protocol_key);

              if (active_protocol_id_for_client) {
                // Cliente tem um protocolo ativo, agora busca os detalhes para rotear
                const protocol_map_key = `protocol:${active_protocol_id_for_client}:${paranToken}`;
                const protocol_map_data = await env.whatsapp_chathook.get(protocol_map_key);

                if (protocol_map_data) {
                  const map_info = JSON.parse(protocol_map_data);
                  const atendente_destino = map_info.attendant_phone;
                  const protocolo_cliente = active_protocol_id_for_client;

                  let jBody = JSON.stringify({
                    phone: atendente_destino,
                    isGroup: false,
                    isLid: isLid,
                    description: `🎫 _Protocolo_: \`${protocolo_cliente}\`\n` +
                      `👤 _Cliente_: \`${phone}\`\n\n` +
                      `📝 _Pergunta_: \n\n*${messagem}*\n\n` +
                      `_(Cliente receberá exatamente a sua resposta)_`,

                    buttonText: `✨ 🗣️ Responda | ✅ Encerrar ✨`,
                    sections: [
                      {
                        title: 'Clique aqui para solicitar o encerramento do chamado',
                        rows: [
                          {
                            "rowId": "99",
                            "title": `⏮️ Encerrar chamado [${protocolo_cliente}]`,
                            "description": ""
                          }
                        ]
                      },
                    ], 
                    options: { markIsRead: false} ,
                    delayMessage: "1"
                  });
                  await wpp.sendZapiResponse(atendente_destino, jBody, 'send-option-list', setup_data, env);
                  console.log(`Cliente ${phone} enviou mensagem para atendente ${atendente_destino} (Protocolo: ${protocolo_cliente}).`);
                } else {
                  console.warn(`Protocolo ativo para cliente ${phone} (${active_protocol_id_for_client}) encontrado, mas mapeamento do protocolo não existe. Indicando inconsistência ou encerramento recente.`);
                  await env.whatsapp_chathook.delete(active_protocol_key); // Limpa a chave auxiliar se o protocolo principal não existe
                  //console.log("Mensagem de cliente sem menção e sem protocolo ativo consistente. Assumindo novo atendimento.");
                  // Lógica para iniciar um novo atendimento aqui
                }
              } else {
                //console.log("Mensagem de cliente sem menção e sem protocolo ativo. Assumindo novo atendimento.");
                // Lógica para iniciar um novo atendimento aqui (iniciar um novo protocolo com atendente disponível)
              }
            } else {
              console.log("Mensagem de atendente sem menção e sem comando de encerramento, ou cenário não mapeado.");
              // Lógica para outros cenários ou mensagem inválida.
            }
          }

          //=========================================//
          /*
          
          //Integração com o Condomob
          if (messagem === "🧾 Listar pendência(s) [CondoMob]") {
            const myphone = phone.replace("55","")
            const token = setup_data.app_key;
            const identificacao = "6199088070" //myphone; //>> Obter diretamente o phone 
            const tipo = "telefone";
          
            const retCondoMob = await env.whatsappwebhook.fetch(
              `https://whatsapp-webhook.softset.workers.dev/integracao_condomob_debito_cnpjcpf?token=${token}&identificacao=${identificacao}&tipo=${tipo}`,
              {
                method: "POST",
                headers: {
                  
                  "Content-Type": "application/json",
                  "administradora": "4923464748105728",
                  "Authorization": "9c76725dacb95f523795471965e4b8d8495338e6"
                },
                body: JSON.stringify({
                  "Authorization": "094611ab6ad67fe2525d0b6bbbbc9c63233523a2",
                  "administradora": "4923464748105728"
                }),
              }
            );
          
            const DataCondoMob = await retCondoMob.json();
            console.log("DataCondoMob", JSON.stringify(DataCondoMob));
          
            let reportDeb = 
              `Condomínio: ${DataCondoMob[0].nome}\n` +
              `Unidade: ${DataCondoMob[0].unidade}\n` +
              `Condômino: ${DataCondoMob[0].nomePagador}\n` +
              "```\nDébito(s):\n" +
              `+---+-------------+---------+\n` +
              `|Doc|   Vencimento|      R$ |\n` +
              `+---+-------------+---------+\n`;
              
            // Itera sobre a sublista 'saldos' do primeiro elemento
            if (DataCondoMob[0].saldos && Array.isArray(DataCondoMob[0].saldos) && DataCondoMob[0].saldos.length > 0) {
              DataCondoMob[0].saldos.forEach(saldo => {
                const documento = saldo.documento.toString().padStart(3, ' '); // Até 3 dígitos
                const vencimento = saldo.vencimento.replace(/-/g, '/'); // "2024-06-24" -> "24/06/2024"
                const valor = parseFloat(saldo.valor).toFixed(2).replace('.', ',').padStart(6, ' '); // "914,59"
          
                reportDeb += `|${documento}|   ${vencimento}|   ${valor}|\n`;
              });
             
            } else {
              reportDeb += "| Nenhum débito encontrado. |\n";
            }
            reportDeb   += `+---+-------------+---------+\n`
            reportDeb += "```\n"; // Fim do bloco monoespaçado
          
            console.log("reportDeb", reportDeb);
          
            let jBody = JSON.stringify({
              "phone": `${phone}`,
              "message": reportDeb,
              "delayMessage": "1"
            });
            await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
          }
          */
          //=========================================//



          //Gravar na base de dados o contato

          //Caso tenha vindo a resposta do comando solicitando CPF/CNPJ, valida e armazena.
          if (setup_data.actualmessage === "🔐 Area Restrita 🔐") {

            if (!setup_data.visitante_existente) {

              const supostoCNPJ = fn.extrairCpfCnpj(messagem);
              //                  console.log( " >>>>> supostoCNPJ", supostoCNPJ)

              // let val = await validarCpfCnpj(supostoCNPJ)

              //console.log("supostoCNPJ:", supostoCNPJ)
              if (supostoCNPJ.validado) {


                const newData = {
                  nome: messageData.chatName,
                  whatsapp: phone,
                  cpf_cnpj: supostoCNPJ.numero,
                  origem: 'Informado',
                  data_hora_ult_msg: new Date(new Date().getTime() - (3 * 60 * 60 * 1000)).toISOString(), // Ajusta para UTC-3
                  blocked: true,
                }
                //console.log("newData", newData ),
                dados_cliente = await fn.updateClientData(`${setup_data.whatsapp}_${messageData.phone}`,
                  newData, env);
                //console.log("updateClientData", dados_cliente)
                if (dados_cliente.success) {
                  let json_retorno = JSON.parse(dados_cliente.retorno);

                  if (json_retorno.blocked) {
                    setup_data.visitante_existente = true;
                    setup_data.visitante_nome = json_retorno.nome;

                    //                        console.log("supostoCNPJ", supostoCNPJ )
                    if (supostoCNPJ.tipo === "CNPJ") {
                      const CNPJResponse = await fetch(`https://www.receitaws.com.br/v1/cnpj/${supostoCNPJ.numero}`)
                      //                          console.log( "CNPJResponse", CNPJResponse )

                    }

                    let jBody = JSON.stringify({
                      phone: isLid ? setup_data.chatLid : phone,
                      isGroup: false,
                      isLid: isLid,
                      description: `🤝 ${json_retorno.nome},\nObrigado por se identificar.\nEntretanto, ainda precisa ser liberado.`,
                      buttonText: "✨ ⏮️ Voltar✨",
                      sections: [
                        {
                          title: 'Clique aqui para voltar ao menu principal',
                          rows: [
                            {
                              "rowId": "99",
                              "title": "⏮️ Voltar ao Menu",
                              "description": ""
                            }]
                        }], 
                        options: { markIsRead: false} ,
                      delayMessage: "1"
                    });
                    await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
                  }

                }

              } else if (supostoCNPJ.numero && (supostoCNPJ.tipo === "CNPJ" || supostoCNPJ.tipo === "CPF") && !supostoCNPJ.validado) {
                let jBody = JSON.stringify({
                  "phone": isLid ? setup_data.chatLid : phone,
                  "isLid": isLid,
                  "message": `😞 *Uhm.. parece que o CPF/CNPJ digitado está errado...*\n_\`${formatarCpfCnpj(supostoCNPJ.numero) || ""}\`_\n\n_Digite novamente ou *Menu* para voltar_`, 
                  options: { markIsRead: false} ,
                  "delayMessage": "1"
                });
                await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
              }

            } else {
              const supostoCNPJ = fn.extrairCpfCnpj(messagem);
              //                console.log( " >>supostoCNPJ", supostoCNPJ)


            }
          }


          let replyMessage;

          // Verifica se está em Plantão
          // Pega a data e hora atual em São Paulo

          const now = new Date();
          const options = { timeZone: "America/Sao_Paulo", hour12: false };
          //const data_hora = new Intl.DateTimeFormat("pt-BR", { ...options }).format(now);
          const hours = new Intl.DateTimeFormat("pt-BR", { ...options, hour: "numeric" }).format(now);
          const dayOfWeek = new Intl.DateTimeFormat("pt-BR", { ...options, weekday: "short" }).format(now);
          const isAfterHours = formata.checkAfterHours(dayOfWeek, parseInt(hours));
          //console.log( `H:${hours} Dia: ${dayOfWeek} isAfterHours: ${isAfterHours}`);


          /*
          // Verifica se a mensagem é para o atendente virtual
          if (messagem.includes(MESSAGES.menuOptions[7].title.trim())) {
            // Mensagem de boas-vindas ao atendente virtual

            let jBody = JSON.stringify({
              "phone": `${phone}`,
              "message": `👩‍💻 *O que gostaria de saber?*\nColoque "??" antes da sua pergunta que a inteligência artificial irá tentar responder.\n⚠️ _As respostas podem conter erros. Considere verificar informações importantes._⚠️`,
              "delayMessage": "1"
            });
            await wpp.sendZapiResponse(phone, jBody, 'send-text', setup_data, env);

            // Retorna a resposta padrão, mas agora esperando por mensagens subsequentes
            return new Response("Mensagem processada e resposta enviada.", { status: 200 });
          }
          */


          //          console.log("whatsapp", setup_data.whatsapp)
          if (phone === "555555555511986169000" && setup_data.whatsapp === "5511992076486") {
            const messageLower = messagem.toLowerCase();

            let jBody = JSON.stringify({
              "phone": isLid ? setup_data.chatLid : phone,
              "isLid": isLid,
              "message": `Oi ${senderName}, é você?! Então, envie "desligar bot" ou "ligar bot" para ligar/desligar "manualmente". Horários prevalecem\n`, 
              options: { markIsRead: false} ,
              "delayMessage": "1"
            });
            await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);

            let query;
            if (messageLower.startsWith("desligar bot")) {
              query = `UPDATE Whatsapp_setup SET Liga_desl_Bot = 0 where whatsapp = ?`;
              await env.MENU_STORAGE.put(`tipo-servico:${setup_data.app_key}`, 1);
              let jBody = JSON.stringify({
                "phone": isLid ? setup_data.chatLid : phone,
                "isLid": isLid,
                "message": `${senderName},\nO Bot agora parou de atender automaticamente. Para ligar novamente, basta enviar "ligar bot", ok?\n`, 
                options: { markIsRead: false} ,
                "delayMessage": "1"
              });
              await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
            }
            if (messageLower.startsWith("ligar bot")) {

              query = `UPDATE Whatsapp_setup SET Liga_desl_Bot = 1 where whatsapp = ?`;
              await env.MENU_STORAGE.put(`tipo-servico:${setup_data.app_key}`, 3);

              let jBody = JSON.stringify({
                "phone": isLid ? setup_data.chatLid : phone,
                "isLid": isLid,
                "message": `${senderName},\nAgora, todas as mensagens que chegarem o BOT irá atender. Para desligar, basta enviar "desligar bot", ok?\n`, 
                options: { markIsRead: false} ,
                "delayMessage": "1"
              });
              await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
            }

            if (query) {
              // Executa a query no ambiente do banco de dados do Worker
              let result = await env.db.prepare(query).bind(setup_data.whatsapp_cliente).run();
            }
          }



          // Verifica se é a primeira mensagem do dia do WhatsApp do visitante. Se for, envia "Menu" implicitamente
          const dData_ult_msg = await env.whatsapp_menu_session.get(`${phone}`) || "1990-01-01";
          //console.log("Última mensagem registrada:", dData_ult_msg);

          // Obter a data atual no formato "YYYY-MM-DD" no fuso horário de São Paulo
          const dHoje = new Date().toLocaleDateString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });

          // A data atual no formato "YYYY-MM-DD"
          const currentDate = dHoje.split('/').reverse().join('-'); // "YYYY-MM-DD"
          //console.log("currentDate", currentDate);

          if (dData_ult_msg !== currentDate) {
            await env.whatsapp_menu_session.put(`${phone}`, currentDate.toString());
            //   messagem = "Menu"; // Envia "Menu" caso seja a primeira mensagem do dia
          }
          //////////////////////






          //messagem = tipo_atendimento === 2 || tipo_atendimento === 3 ? messagem = `?? ${messagem}` : messagem

          //          console.log( "messagem: ", messagem.trim().toLowerCase())

          const chave_gpt = `${phone}_${setup_data.token}`
          //digitou apenas menu ou primeira mensagem do dia da sessao(Token)
          if ((messagem.trim().toLowerCase().split(/\s+/).length === 1 && messagem.trim().toLowerCase() === "menu") ||
            (messagem.trim().toLowerCase() === "⏮️ voltar ao menu")
          ) {
            await wpp.sendTyping(phone, true, setup_data) // liga o "digitando..." (Typing)
            await fn.whatsapp_liga_desl_GPT("0", chave_gpt, env);
            
            // lbot = 0;
          }
          else {

            // await whatsapp_liga_desl_GPT( "2", `${phone}_${setup_data.app_key}`, env); 

            //Foi colocado no setup_data
            //const lrespPorChatGPT= await env.Whatsapp_chatgpt.get(chave_gpt) ;  // << está falhando aqui !!!!
            
            const respViaChatGPT = await fn.whatsapp_liga_desl_GPT(null, chave_gpt, env); //Le o parametro se o ChatGPT responde ou não (valor 1 = chatGPT)

            console.log(`messagem (antes) ==> Parametros: respViaChatGPT=${respViaChatGPT}, tipo_atendimento=${tipo_atendimento} )  => `, messagem)
        

            if (( respViaChatGPT && respViaChatGPT === "1") || messagem.startsWith("💬") || messagem.startsWith("📵") ||  tipo_atendimento === 3  ) {   // GPT para Mensagens pelo atendente virtual
           // if (( messagem.startsWith("📵") )  ) {   // GPT para Mensagens pelo atendente virtual
            
              // messagem = `💬${messagem.replace("💬","")}`;
             messagem = `💬${messagem.replace("💬","")}`;
              console.log("Atribuido 💬 para a mensagem", messagem)
            }
            if (( respViaChatGPT && respViaChatGPT) === "2" || messagem.startsWith("📖")) {
              messagem = `📖${messagem.replace("📖","").replace("💬","")}`;
              console.log("Atribuido 📖 para a mensagem", messagem)
            } 
            
            console.log( "messagem (depois)", messagem )


          }



          if ((messagem.toLowerCase().trim() === "🤖 Clique aqui para saber tudo 😉".toLowerCase().trim())) {
            let jBody = JSON.stringify({
              "phone": isLid ? setup_data.chatLid : phone,
              "isLid": isLid,
              "message": `🤖✨ Você está sendo atendido(a) por uma _inteligência artificial especializada_, treinada para oferecer respostas rápidas, precisas e personalizadas, como se estivesse conversando com um dos nossos especialistas reais! 🎯\n\n💡 _Quer sair deste modo?_\nDigite _*Menu*_ e envie a mensagem 👇 que retornaremos ao início.\n\n *Faça qualquer pergunta que tentarei te ajudar:*`, 
              options: { markIsRead: false} ,
              "delayMessage": "1"
            });

            await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);


            const ret_base64 = await ia.Text_to_Speech(`Oi ${senderName}, tudo bem? Sou uma inteligência artificial especializada, treinada para oferecer respostas rápidas, precisas e personalizadas para você, como se estivesse conversando com um dos nossos especialistas mesmo... Bom, para sair deste modo de IA, a qualquer momento, digite a palavra Menu, ok? Mas vamos lá, envie qualquer pergunta agora que queira saber, que eu tentarei te ajudar. O que gostaria de saber?`, phone, setup_data, env, '', false)
            await fn.whatsapp_liga_desl_GPT("1", `${phone}_${setup_data.app_key}`, env);    //. <<<<<<<==== Liga o atendimento por ChatGPT

            return new Response("Mensagem processada e resposta enviada.", { status: 200 });
            //messagem = `?? ${messagem}` 
          }

          // 📖confirmado
          /*
          if ( (messagem.toLowerCase().trim() === `📖 Responder formulário...`.toLowerCase().trim()) 
             ) {
              await whatsapp_liga_desl_GPT( "2", `${phone}_${setup_data.app_key}`, env);
              let jBody = JSON.stringify({
                "phone": `${phone}`,
                "message": `🤖✨ Vou te guiar para o preenchimento do formulário.\n\n💡 _Quer sair deste modo?_\nDigite _*Menu*_ e envie a mensagem 👇 que retornaremos ao início.\n\n *Vamos lá...*`,
                "delayMessage": "1"
              });
              
              await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
            
              return new Response("Mensagem processada e resposta enviada.", { status: 200 });
              //messagem = `?? ${messagem}` 
          }
          */


          //          console.log( `Tipo atendimento: ${tipo_atendimento} - Fora de horario cml: ${isAfterHours} GPTLigado: ${lbot} - Mensagem considerada: ${messagem}`);


          //Gravando como a ultima mensagem
          const lastmessage = (messagem.startsWith("💬") ? messagem.replace("💬", "") : (messagem.startsWith("🎤")) ? "(audio)" : messagem)


          //Verifica se é responsta do atendente:
          const regex = /🗣️ Responder prot\.: \[(\d+)\].*?Responder o chamado do contato (\d+)/s;
          const match = lastmessage.match(regex);
          if (match) {
            const protocolo = match[1]; // "1745978446"
            const numeroContato = match[2]; // "5511988704877"
            //            console.log(`Protocolo: ${protocolo}, Número: ${numeroContato}`);
            env.whatsapp_chathook.put(`resp.${paranToken}:${phone}`, lastmessage);
          } else {
            //console.log("Nenhum padrão encontrado");
          }




          console.log("chegando como: ", messagem)

          // Se a mensagem começa com os EMOJIS abaixo, processa com o ChatGPT

          if (messagem.startsWith("💬") || messagem.startsWith("🎤") || messagem.startsWith("📖")) {

            /*
                💬 <=> pergunta por texto para IA
                🎤 <=> pergunta por audio para IA
                📖 <=> abre perguntas sobre formulário de cadastro ( functions e function_call do OpenAI )

            */

            const userMessage = //"💬" + 
              messagem  // messagem.replace("AI->", "").trim(); // Remove o prefixo "AI->"
            let prompt_system = "";

            if (messagem.startsWith("🎤") && !audio_only) {
              audio_only = true
            }


            // Enviar a mensagem para a OpenAI API
            const prompt = userMessage.replace("💬", "");

            let virtualResponse
            try {
              // Log da mensagem no banco de dados

              if (audio_only) {
                await wpp.sendRecording(phone, true, setup_data) // Desliga o "gravando..." (audio)
              } else {
                //await wpp.sendTyping(phone, true, setup_data) // Desliga o "digitando..." (Typing)
              }
              const mesmaData = await formata.getGreetingIfNoMessageToday(env, phone, setup_data);

              let functions
              let virtualResponse
              let chave = `${phone}_{$paranToken}`
              let tipoResp = setup_data.respViaChatGPT // String(await env.Whatsapp_chatgpt.get(chave)) // 0 = Menu, 1 = Audio tirar duvidas e 2 = Respondendo formulário
              //Verifica se é Audio do Formulário ou não
              if (tipoResp === "2" && audio_only) { //Audio dentro do contexto formulário

                // 📖 <=> Formulário  | 🎤 consulta IA simples
                console.log("Audio dentro do contexto formulário",)
              }

              if (messagem.startsWith("📖")) {       //respondendo o formulário já escolhido
  
                console.log("Entrou aqui...", messagem)

                const kvValue = await env.Forms_KV.get(`${phone}_${setup_data.app_key}`);
                if (!kvValue) {
                  console.error("Nenhum valor encontrado no KV");
                } else {
                  // Parse do wrapper
                
                  const parsed = JSON.parse(kvValue);

                  //const parsedArray = Object.values(kvValue);
                  // agora você tem acesso separado
                  const formId = parsed.rowId; //Id do formulário
                  const formDefinition = parsed.formDefinition; //Campos do Formulário
                
                  console.log("formId do formulário:", formId);
                  //console.log("formDefinition:", formDefinition);
                  
                  // se quiser usar sua regex nas descrições:
                  //const descricoes = formDefinition.map(campo => campo.descricao || "");
                  //console.log("descricoes", descricoes);
                
                  // depois segue seu fluxo normalmente
                  const messageResponse = messagem.replace("📖", "");
                  virtualResponse = await forms.fetchOpenAI_V2_forms(
                    messageResponse,
                    senderName,
                    env,
                    phone,
                    messageId,
                    setup_data,
                    formDefinition, // aqui passa só os campos
                    formId
                  );
                  console.log("Resposta OpenAI para Formulario", virtualResponse[0]);
                }


              } else {

                console.log( `chegando na função fetchOpenAI_V2`, 
                    {prompt: prompt, prompt_system: prompt_system, senderName: senderName, mesmaData: mesmaData, phone: phone, messageId: messageId, audio_only: audio_only })
                virtualResponse = await ia.fetchOpenAI_V2(prompt, prompt_system, senderName, mesmaData, env, phone, messageId, setup_data, audio_only);
                console.log( `Retorno de virtualResponse = fetchOpenAI_V2()`, virtualResponse)
              }



              return new Response('Resposta enviada com sucesso.', { status: 200 });

            } catch (error) {
              console.error(`buscar dados do OpenAI: ${error.message}`);
              let jBody = JSON.stringify({
                "phone": isLid ? setup_data.chatLid : phone,
                "isLid": isLid,
                "message": `🤖✨\n${senderName}, não entendi bem o que perguntou 🤔,\nRefaça a pergunta por gentileza?`, 
                options: { markIsRead: false} ,
                    //`${setup_data.nome_fantasia}\nO contato ${phone} para o whatsapp server ${setup_data.whatsapp} enviou a mensagem, mas ocorreu um erro ao processar sua solicitação.\n${error.message}`,
                "delayMessage": "1"
              });
              await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
              return new Response('Erro ao processar a interação.', { status: 200 });
            }
          }


          //Grava a mensagem como sendo a ultima mensagem



          // Processa outras mensagens conforme necessário
          if ((tipo_atendimento == 1 || tipo_atendimento == 2)
          ) {
            //            console.log(`Entrando no processMessageV2() de ${phone}`);
            await wpp.sendTyping(phone, false, setup_data) // Desliga o "digitando..." (Typing)
            replyMessage = await menu.processMessageV2(phone, messagem, senderName, env, setup_data);

            return replyMessage;
          }
          // descontinuando o processMessage(). 
          else {
            //            console.log(`Entrando em modo OpenAI para: ${phone}`);
            //replyMessage = await processMessage(phone, messagem, senderName, env.db, setup_data);
            //return new Response(replyMessage, { status: 200 });
            await wpp.sendTyping(phone, false, setup_data) // Desliga o "digitando..." (Typing)

            return new Response(`Entrando em modo OpenAI para: ${phone}`, { status: 200 });
          }

        } else if (messageData.status === "SENT") {
          // Quando entramos para atender
          if ((messagem.trim().toLowerCase().split(/\s+/).length === 1 && messagem.trim().toLowerCase() === "🤗") || messagem.includes("🏕️🏕️") || messagem.includes("🤗🤗")) {
            console.log("🤗🤗🤗🤗🤗>>>>>>>>>> Desligando IA se for o caso <<<<<<<<<<<<🤗🤗🤗🤗🤗")
            //desliga o especialista virtual
            await wpp.sendTyping(phone, false, setup_data) // Desliga o "digitando..." (Typing)
            await fn.whatsapp_liga_desl_GPT("0", `${phone}_${setup_data.app_key}`, env);
          } else if (// messagem.trim().toLowerCase().split(/\s+/).length === 1 && messagem.trim().toLowerCase() === "🤖🤖"
                      messagem.includes("🤖🤖")) { // Ligando IA manualmente
            console.log("🤖🤖🤖🤖🤖🤖>>>>>>>>>> Forçando liga IA se for o caso <<<<<<<<<<<<🤖🤖🤖🤖🤖🤖")
            await fn.whatsapp_liga_desl_GPT("1", `${phone}_${setup_data.app_key}`, env);
          } else 
          {
            console.log("Em Sent, message:", messagem)
            //Se o cliente enviou audio, mas entramos para atender, desliga a resposta por audio temporariamente.

            /*
            if (messagem) {
              console.log( "O atendente respondendo", messagem)
              let audioTimeKey = `delay_${phone}_${setup_data.app_key}` 
              const timestampAtual = Math.floor(Date.now() / 1000);
              if ( !await env.Whatsapp_chatgpt_audio.get(audioTimeKey) ) {
                    await env.Whatsapp_chatgpt_audio.put(audioTimeKey, timestampAtual )
              } else {
                const timestempCrono = await env.Whatsapp_chatgpt_audio.get(audioTimeKey) 
                console.log( "Tempo transcorrido desde a ultima mensagem", timestampAtual - timestempCrono )
                if (timestampAtual - timestempCrono <= 600) { // 10min
                    await whatsapp_liga_desl_GPT_audio( 0, `${phone}_${setup_data.app_key}`, env);   //Desabilita audio
                } else {
                    await whatsapp_liga_desl_GPT_audio( 1, `${phone}_${setup_data.app_key}`, env);   //Habilita audio 
                }
              }
            }
            */

                if (messagem && !messagem.toLowerCase().includes("audio transcrito")) {    //Se a resposta foi automática da transcrição, não considerar como operador
                  console.log("O atendente respondendo", messagem);
                  // Use 'chave' aqui para consistência

                  let chave = `delay_${phone}_${setup_data.app_key}`; // Nome da chave consistente e descritivo

                  const timeDelay = 960
                  const timestampAtual = Math.floor(Date.now() / 1000); // Timestamp atual em segundos

                  // Sempre desabilita o áudio e redefine o timestamp no KV com TTL
                  // await whatsapp_liga_desl_GPT_audio(0, chave, env); // Desabilita áudio na sua função externa
                  await env.Whatsapp_chatgpt_audio.put(chave, timestampAtual, { expirationTtl: timeDelay }); // Armazena com TTL de 16 minutos
                  // O valor do KV não precisa ser um número se você só verifica a existência.
                  // Usei .toString() para garantir que seja armazenado como string no KV.

                  console.log(`Áudio desabilitado por 10 minutos (chave: ${chave}) a partir desta mensagem.`);
                }

          }
          return new Response(`Saindo do modo OpenAI para: ${phone}`, { status: 200 });
        }


      } catch (e) {
        console.error('Erro durante a execução do Worker:', e);
        return new Response(`Erro interno do servidor - whatsapp \nErro: ${e}`, { status: 500 });
      }
    } else {
      return new Response("Método não permitido", { status: 405 });
    }
  }
}






function fn_ParaFunctionChatGPT(camposArrayString, nome, descricao) {
  const properties = {};
  const required = [];
  const camposArray = JSON.parse(camposArrayString);
  //  console.log("camposArray", camposArray )
  camposArray.forEach(campo => {
    // Mapear tipo 'datetime' para 'string' (pois JSON Schema não tem datetime direto)
    let tipo = campo.tipo;
    if (tipo === "datetime") tipo = "string";

    properties[campo.id] = {
      type: tipo,
      description: campo.descricao || campo.rotulo || campo.id,
    };

    if (campo.obrigatorio) {
      required.push(campo.id);
    }
  });

  const functionSchema = {
    name: nome,
    description: descricao,
    strict: true,
    parameters: {
      type: "object",
      properties: properties,
      additionalProperties: false,
      required: required,
    }
  };

  return functionSchema;
}



function formatarCpfCnpj(valor) {
  // Remove tudo que não for dígito
  const numeros = valor.replace(/\D/g, '');

  if (numeros.length === 11) {
    // Formata CPF: xxx.xxx.xxx-xx
    return numeros.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  } else if (numeros.length === 14) {
    // Formata CNPJ: yy.yyy.yyy/yyyy-yy
    return numeros.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  } else {
    // Retorna valor original se não for CPF nem CNPJ
    return valor;
  }
}


export async function obter_setup(env, idCliente) {
  try {
    //const query = `SELECT a.*, b.name, b.email FROM Whatsapp_setup a join Whatsapp_users b on a.app_key = b.token WHERE a.app_key = ? `;
    const query = `SELECT a.*,
                      COALESCE(b.name, d.name) AS user_name,
                      COALESCE(b.email, d.email) AS user_email
                  FROM Whatsapp_setup a
                    LEFT JOIN Whatsapp_users b ON a.app_key = b.token
                    LEFT JOIN whatsapp_users_token c ON a.app_key = c.whatsapp_token
                    LEFT JOIN Whatsapp_users d ON c.user_token = d.token
                  WHERE a.app_key = ?;`

    const result = await env.db.prepare(query).bind(idCliente).all();



    if (result && result.results && result.results.length > 0) {

     // console.log("result.results[0].Assistant_ID ", result.results[0].Assistant_ID)

      //Verificando se há AssistantID no token do cliente
      try {

        if (!result.results[0].Assistant_ID || result.results[0].Assistant_ID === "" ) {
          const assistant_result = await ia.verifica_assistant(idCliente,null, env) // result.results[0].nome_fantasia  );
          const assistant_id = assistant_result.id
          if (assistant_id) {
            console.log("assistant_id", assistant_id)
            let query = `update whatsapp_setup set Assistant_ID = ? where app_key = ? and ( Assistant_ID = "" or Assistant_ID is null)`;
            let result_upd = await env.db.prepare(query).bind(assistant_id, idCliente).run();

            query = `update whatsapp_users set assistant_id = ? where token = ? and (assistant_id = "" or assistant_id is null) `;
            result_upd = await env.db.prepare(query).bind(assistant_id, idCliente).run();

            result.results[0].Assistant_ID = assistant_id;
            result.results[0].have_instructions = ((assistant_result.instructions || '').trim() !== '')
          }
        } else {
          const assistant_result = await ia.verifica_assistant(idCliente,result.results[0].Assistant_ID, env )
          result.results[0].have_instructions = ((assistant_result.instructions || '').trim() !== '')
        }

      } catch (error) {
        console.error("obter_setup:: Erro na criaçao/obtenção do Assistant da OpenAI", error);
      }

      // console.log("Whatsapp_setup : obter_setup :: Results", result.results);

      return { success: true, data: result.results };
    } else {
      console.log(`Token inválido ou nenhum registro encontrado: ${idCliente}`);
      return { success: false, error: "Token inválido ou nenhum registro encontrado." };
    }
  } catch (error) {
    console.error(`Erro na obtenção dos dados do cliente: ${idCliente}`, error);
    return { success: false, error: `Erro ao consultar o banco de dados: ${error.message}` };
  }
}


function determineUrlType(url) {
  // Verifica se a URL corresponde a um arquivo
  const fileUrlRegex = /\.(jpg|jpeg|pdf|png|gif|bmp|svg|webp|zip|tiff|ico)$/i;
  const videoUrlRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/|youtu\.be\/|vimeo\.com\/)(.*)$/i;
  const websiteRegex = /^(https?:\/\/)?(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i;


  if (fileUrlRegex.test(url)) {
    return 'send-file';
  }

  // Verifica se a URL é um link de vídeo (por exemplo, do YouTube, Vimeo, etc.)
  if (videoUrlRegex.test(url)) {
    return 'send-link-preview'; // Ou qualquer outro tipo de 'preview' para vídeos
  }

  // Verifica se a URL é um link para um site (qualquer página web)
  if (websiteRegex.test(url)) {
    return 'send-link-preview'; // Para qualquer link de site, como um blog, por exemplo
  }

  // Se for um link desconhecido, retornar outro valor
  return 'unknown';
}


export async function verifica_fim_plano(setup_data, env) {
  const now = new Date();
  const query = `SELECT name, email, token, data_cadastro, data_limite FROM whatsapp_users WHERE token = ?`;

  // Executa a consulta com os parâmetros
  const selectResult = await env.db.prepare(query).bind(setup_data.id_zapi).first();  //Pegar o Master_Token para validar a assinatura

  if (!selectResult) {
    console.log("Usuário não encontrado para setup_data.token:", setup_data.token);
    return false; // Retorna false se o usuário não existe
  }

  const { name, email, data_limite } = selectResult;
  const dataLimiteDate = new Date(data_limite); // data_limite no formato "2025-05-09T18:13:29.000Z"

  // Verifica se dataLimiteDate é uma data válida
  if (isNaN(dataLimiteDate.getTime())) {
    console.log("Data limite inválida para setup_data.token:", setup_data.token, "data_limite:", data_limite);
    return false; // Retorna false se a data for inválida
  }

  // Calcula a diferença em milissegundos
  const diffTime = dataLimiteDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Diferença em dias

  let msg = "";
  console.log(`diferença em dias do plano de assinatura/Demonstração, com a data atual Dias: ${diffDays}`, diffTime)
  // Verifica se a assinatura está a 3 dias ou menos de vencer, ou já venceu
  if (diffDays <= 3 && diffDays > 0) {
    msg = `😊 Aqui é o Softset - Whatszaip\n\n📢 Olá ${name},\nPassando para avisar que seu plano vence em ${formata.formatarDataBRUTC3(data_limite)}.\n✨ Se você possui uma assinatura renovável mensalmente, as funcionalidades continuarão funcionando normalmente.`;
  } else if (diffDays === 0) {
    msg = `😊 Aqui é o Softset - Whatszaip\n\n📢 Olá ${name},\nSua assinatura vence hoje, ${formata.formatarDataBRUTC3(data_limite)}.\n📅 Renove sua assinatura mensal ou anual para continuar aproveitando todas as funcionalidades.\n\n✨ Acesse: www.whatszaip.com.br e vá em "planos & Preços ✨"`;
  } else if (diffDays < 0) {
    msg = `😊 Aqui é o Softset - Whatszaip\n\n📢 Olá ${name},\nSua assinatura venceu em ${formata.formatarDataBRUTC3(data_limite)}.\n📅 Renove sua assinatura mensal ou anual para ter todas as funcionalidades novamente.\n\n✨ Acesse: www.whatszaip.com.br e vá em "planos & Preços ✨`;
  }



  // Se não há mensagem, não é necessário enviar notificação
  if (!msg) {
    return true; // Retorna true porque o plano ainda não está perto de vencer
  }
  console.log("Analise da verificação msg:", msg)

  // Verifica se já foi enviado um aviso hoje
  const ultimoAviso = await env.Whatsapp_aviso_assinatura.get(setup_data.id_zapi);
  const hoje = now.toISOString().split('T')[0]; // Formato: YYYY-MM-DD
  console.log(`ultimoAviso  para setup_data.token: ${setup_data.token}: Hoje: ${hoje} ultimo aviso: ${ultimoAviso}`, setup_data)

  if (ultimoAviso && ultimoAviso === hoje) {
    console.log("Aviso já enviado hoje para setup_data.token:", setup_data.id_zapi);
    return diffTime >= 0; // Retorna true se ainda não venceu, false se venceu
  }

  // Prepara a mensagem para envio
  const responseBody = {
    "phone": setup_data.whatsappServer,
    "isGroup": false,
    "isLid": setup_data.isLid,
    "message": msg, 
    options: { markIsRead: false} ,
    "delayMessage": "1"
  };

  // Envia a notificação

  // URL da API Softset
  const zApiUrl = `${setup_data.server_api}/api/${setup_data.token}/send-message`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${setup_data.ConnectionTokenAPI}`
  };
  console.log("VerificaSeQrCode/sendZapiResponse/responseBody", responseBody);


  const body = JSON.stringify(responseBody)

  const response = await fetch(zApiUrl, { method: 'POST', headers, body });

  if (!response.ok) {
    throw new Error(`Erro ao enviar resposta: ${response.status} - ${response.statusText}`);
  }
  //const zapiResponse = await wpp.sendZapiResponse(whatsapp, responseBody, 'send-text', setup_data);
  // Registra a data do aviso
  await env.Whatsapp_aviso_assinatura.put(setup_data.token, hoje);

  // Retorna true se o plano ainda não venceu, false se já venceu
  return diffTime >= 0;
}



 async function fn_markdown_old(messagemNormalizada) {
  let textoProcessado = messagemNormalizada;
  console.log(`function fn_markdown() param:`, textoProcessado)
  // 1ª Passada: Regex para o formato Markdown ![descricao](url)
  const markdownImageRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)/g;
  const midiasMarkdown = [...textoProcessado.matchAll(markdownImageRegex)].map(match => ({
    caption: match[1] || 'Midia', // Usa a descrição do Markdown como legenda
    url: match[2],
  }));
  // Remove o Markdown do texto
  textoProcessado = textoProcessado.replace(markdownImageRegex, '');

  // 2ª Passada: Regex para URLs diretas no texto restante
  const urlRegex = /((?:https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11})|(?:https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|pdf)(?:\?[^\s]*)?))/gi;
  const midiasUrlPura = [...textoProcessado.matchAll(urlRegex)].map(match => {
    const url = match[0];
    const filename = url.split('/').pop().split('?')[0];
    return {
      url: url,
      caption: filename // Usa o nome do arquivo como legenda padrão
    };
  });
  // Remove as URLs puras do texto
  textoProcessado = textoProcessado
    .replace(urlRegex, '')
    .replace(/\n-\s*/g, '')


  // Combina as mídias encontradas em ambas as passadas
  const midiasEncontradas = [...midiasMarkdown, ...midiasUrlPura];

  // Limpa o texto final
  const retorna = {
    "textoMensagem": textoProcessado,
    "midiasEncontradas": midiasEncontradas
  }
  console.log("retorno da função fn_markdown:", retorna)
  return retorna
}

/**
 * Função auxiliar para determinar o MIME type de um arquivo baseado na sua extensão na URL.
 * @param {string} url - A URL do arquivo.
 * @returns {string} O MIME type correspondente ou um padrão.
 */
function getMimeTypeFromUrl(url) {
  const extension = url.split('.').pop().toLowerCase().split('?')[0];
  const mimeTypes = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif',
    'webp': 'image/webp', 'svg': 'image/svg+xml', 'bmp': 'image/bmp', 'ico': 'image/x-icon',
    'pdf': 'application/pdf',
  };
  return mimeTypes[extension] || 'application/octet-stream';
}





async function whatsapp_liga_desl_GPT_audio(nLiga, chave, env) {
  try {
    let lAudio = await env.Whatsapp_chatgpt_audio.get(chave) // == 1 ? 1 : 0;  // Tenta obter o valor associado à chave do KV
    if (lAudio !== nLiga) {
      // Se o valor existente for diferente de lLiga, delete e insira o novo valor
      await env.Whatsapp_chatgpt_audio.delete(chave);        // Exclui a chave atual no KV
      await env.Whatsapp_chatgpt_audio.put(chave, nLiga);    // Insere o novo valor
    }
  } catch (error) {
    // Caso ocorra um erro (como a chave não existir), insere o valor
    await env.Whatsapp_chatgpt_audio.put(chave, nLiga);    // Cria a chave com o valor lLiga
  }
}

export async function fn_attrib_label(phone, add_label_id_api, remove_label_id_api, setup_data) {
  // 1. Validações iniciais
  if (!phone) {
    console.error('[fn_attrib_label] Parâmetro phone inválido:', phone);
    throw new Error('Parâmetro "phone" é obrigatório');
  }
  const { server_api, ConnectionTokenAPI, token } = setup_data;
  if (!server_api || !ConnectionTokenAPI) {
    console.error('[fn_attrib_label] setup_data incompleto:', setup_data);
    throw new Error('setup_data.server_api e setup_data.ConnectionTokenAPI são obrigatórios');
  }

  // 2. Monta URL e headers
  const url = `${server_api}/api/${token}/add-or-remove-label`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ConnectionTokenAPI}`,
    // ...corsHeaders // supondo que corsHeaders já exista no escopo
  };

  // 3. Monta corpo com inclusão condicional
  const options = [];
  if (add_label_id_api != null) {
    options.push({ labelId: add_label_id_api, type: 'add' });
    console.log('[fn_attrib_label] irá ADICIONAR etiqueta:', add_label_id_api);
  }
  if (remove_label_id_api != null) {
    options.push({ labelId: remove_label_id_api, type: 'remove' });
    console.log('[fn_attrib_label] irá REMOVER etiqueta:', remove_label_id_api);
  }
  if (options.length === 0) {
    console.warn('[fn_attrib_label] nenhum label para adicionar ou remover — operação cancelada');
    return { success: false, message: 'Nenhuma ação de label definida' };
  }

  const body = {
    chatIds: [phone],
    options
  };

  // 4. Executa fetch com try/catch
  try {
    console.log('[fn_attrib_label] Enviando requisição para', url);
    console.log('[fn_attrib_label] Headers:', headers);
    console.log('[fn_attrib_label] Body:', JSON.stringify(body));

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[fn_attrib_label] Erro na resposta: status=${response.status}, body=${errorText}`
      );
      throw new Error(`fn_attrib_label falhou: ${response.status} — ${errorText}`);
    }

    const data = await response.json();
    console.log('[fn_attrib_label] Sucesso:', data);
    return data;

  } catch (err) {
    console.error('[fn_attrib_label] Exceção capturada:', err);
    throw err;
  }
}

//===========================================//




export async function fn_self_messageAlert(text, setup_data, env) {     
  let jBody = JSON.stringify({
    phone: setup_data.whatsapp, //Enviando Self-message
    isGroup: false,
    isLid: setup_data.isLid,
    message: `⚠️ _AVISO_:  \`${text}\`\n` , 
    options: { markIsRead: false} ,
    delayMessage: "1"
  });
  await wpp.sendZapiResponse(setup_data.whatsapp, jBody, 'send-message', setup_data, env);

}



async function processarConversaoWhatsApp(textoMensagem) {
    // 1. Extrai o orcamento_id (procura por "Ref: " seguido de 6 caracteres alfanuméricos)
    const match = textoMensagem.match(/Ref:\s*([a-zA-Z0-9]{6})/);
    if (!match) return null;

    const orcamentoId = match[1];
    const apiKey = '3202354@Id';

    // 2. Consulta o FraudGuard
    const response = await fetch(`https://fraudguard.softset.com.br/api/v1/external/clicks?per_page=10&orcamento_id=${orcamentoId}`, {
        headers: { 'X-API-Key': apiKey }
    });

    const result = await response.json();

    if (result.ok && result.data.length > 0) {
        // 3. Pega o registro que NÃO foi bloqueado (ou o mais recente)
        // Isso evita enviar conversão de robô para o Google
        const leadValido = result.data.find(c => c.blocked === false) || result.data[0];

        return {
            gclid: leadValido.gclid,
            timestamp: leadValido.timestamp,
            orcamento_id: orcamentoId
        };
    }
    
    return null;
}

async function efetivarConversao(foneNormalizado) {
    console.log(`[FraudGuard] Efetivando conversão: ${foneNormalizado}`);

    try {
        const resp = await fetch(
            `https://fraudguard.softset.com.br/api/v1/external/registryconvertion`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": "3202354@Id",
                },
                body: JSON.stringify({
                    foneNormalizado,
                    value_min: 50.0,
                    value_max: 150.0,
                }),
            }
        );

        // 1. Verifica se a resposta foi bem-sucedida antes de parsear
        if (!resp.ok) {
            const errorText = await resp.text();
            console.error(`[FraudGuard] ❌ Erro HTTP ${resp.status}:`, errorText);
            return null;
        }

        const data = await resp.json();

        // 2. Verifica a lógica de negócio (se o seu backend retorna 'ok')
        if (data && data.ok) {
            console.log(`[FraudGuard] ✅ Resultado:`, {
                foneNormalizado,
                efetivado:    data.efetivado,
                ja_existia:   data.ja_existia,
                evento_valor: data.evento_valor,
                processed_at: data.processed_at,
            });
            return data; 
        }

        console.error(`[FraudGuard] ❌ API retornou erro lógico:`, data);
        return data; // Retornar data mesmo com erro pode ajudar a debugar lá fora

    } catch (err) {
        // Captura erros de rede ou DNS
        console.error(`[FraudGuard] Erro fatal na requisição:`, err.message);
        return null;
    }
}

function normalizarTelefone(tel) {
    if (!tel) return "";

    // 1. Remove tudo que não for dígito
    let n = tel.replace(/\D/g, "");

    // 2. Remove DDI 55
    if (n.startsWith("55")) {
        n = n.substring(2);
    }

    // 3. Remove zero à esquerda do DDD: 011... → 11...
    if (n.length === 12 && n.startsWith("0")) {
        n = n.substring(1);
    }

    // 4. Se tiver 10 dígitos, força o 9 após o DDD
    if (n.length === 10) {
        const ddd = n.substring(0, 2);
        const num = n.substring(2);
        n = ddd + "9" + num;
    }

    // 5. Retorna apenas se tiver 11 dígitos (DDD + 9 dígitos)
    if (n.length === 11) {
        return n;
    }

    // 6. Fallback: retorna o que tiver truncado em 11
    return n.slice(0, 11);
}
