
import * as formata from './formatacoes.js';
import * as fn from './funcoes-genericas.js';
import * as ia from './IA.js';
import * as wpp from './wppconnect.js';

/**
 * Envia respostas através da Z-API com lógica híbrida e roteamento inteligente.
 * A função segue uma ordem de prioridade:
 * 1. Verifica se a mensagem é um Menu de Opções (JSON).
 * 2. Se não for, busca por mídias em dois formatos:
 * a) Prioridade 1: Markdown ![legenda](url)
 * b) Prioridade 2: URLs diretas (YouTube, Imagens, PDFs)
 * 3. Envia o texto restante e, em seguida, processa cada mídia encontrada com seu endpoint e payload corretos.
 */
export async function sendZapiResponse(phone, messagem, tipo, setup_data, env, clearText = '') {
    console.log(`Iniciando sendZapiResponse tipo: ${tipo} com a mensagem:`, messagem);

    
    let textoMensagem = messagem, midiasEncontradas, linksEncontrados, extractedContent = []
    let l_fn_envia_markdown = false;
    //console.log(`${tipo}`, messagem)
  
    const zApiBaseUrl = `${setup_data.server_api}/api/${setup_data.app_key}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${setup_data.ConnectionTokenAPI}`
    };
  
  
    if (tipo !== "send-voice-base64") {
      //console.log( "tipo !== 'send-voice-base64' :: messagem", messagem)
      const mensagemObj = JSON.parse(messagem);
      
      let textoProcessado = mensagemObj?.message || mensagemObj?.description || '';
  
      console.log( "tipo !== 'send-voice-base64 (entrada)'", textoProcessado  )
  
      const retorna_fn_markdown = await fn_markdown(textoProcessado)
  
      if ((Array.isArray(retorna_fn_markdown.midiasEncontradas) && retorna_fn_markdown.midiasEncontradas.length > 0) || (Array.isArray(retorna_fn_markdown.linksEncontrados) && retorna_fn_markdown.linksEncontrados.length > 0)) {
  
        textoMensagem = retorna_fn_markdown.textoMensagem
        const regex = /\n{3,}/g;   //Removar 3 ou mais saltos de linha 
        textoMensagem = textoMensagem.replace(regex, '');
  
        midiasEncontradas = retorna_fn_markdown.midiasEncontradas || []
        linksEncontrados = retorna_fn_markdown.linksEncontrados || []
        //console.log(`sendZapiResponse:${tipo}:midiasEncontradas:`, midiasEncontradas)
        //console.log(`sendZapiResponse:${tipo}:linksEncontrados:`, linksEncontrados)
  
       
        if ((Array.isArray(midiasEncontradas) && midiasEncontradas.length > 0) || (Array.isArray(linksEncontrados) && linksEncontrados.length > 0)) {
          l_fn_envia_markdown = true
          //console.log("l_fn_envia_markdown", l_fn_envia_markdown)
        }
        messagem = retorna_fn_markdown.newMessage || "";
        //console.log( "tipo !== 'send-voice-base64 (Saida)'", messagem   )
      }
    }
    let messagemNormalizada = messagem.replace(/\r/g, '') || " ";
    

    console.log("Conteúdo da variável 'messagemNormalizada' ",tipo, messagemNormalizada)
  
    if (tipo === "send-voice-base64") {
      //try {
      const textApiUrl = `${zApiBaseUrl}/send-voice-base64`;
      //const body = JSON.stringify( messagem ) 
      const { midiasEncontradas } = messagem
      //console.log("Send-voice-base64, midias encontradas:", midiasEncontradas)
      const mensagemObj = JSON.parse(messagem); 
      let hasBase64Ptt = mensagemObj.base64Ptt ? true : false
      let body = JSON.stringify(mensagemObj);
      body = messagem.replace(`\n\n`, ``)
      
      //messagemNormalizada = messagem.message
  
      if (setup_data.plano_ass_ok) {
        if ( hasBase64Ptt ) {
            if (clearText && clearText.trim() !== '') {
              console.log( `phone: ${phone} - Whatsapp: ${setup_data.whatsapp} `, clearText)
            }

            const response = await fetch(textApiUrl, { method: 'POST', headers, body });
            if (!response.ok)
              console.error(`Erro ao enviar audio: ${response.statusText}`);
            else {
              //const retorna_fn_markdown = await fn_markdown( messagem.textoMensagem 
              console.log("Parte do texto enviada com sucesso.");
            }
        }
      } else {
        //await sendTyping(phone, false, setup_data);
        //await sendMensagemLida(phone, false, setup_data) //Envia marca como "false = nao lida" | "true = lida"
        console.log("Sem licença. Envio de texto bloqueado.");
      }
      //}
      //catch (error) {
      //  console.log("Erro envio do audio. Audio nao enviado para a API Whatsapp", error );
      // }
    }
  
  
    // ----- VERIFICAÇÃO PRIORITÁRIA 1: MENUS DE OPÇÕES (LIST MESSAGES) -----
    try {
      // messagemNormalizada = Array.isArray(messagemNormalizada) ? messagemNormalizada : []
      console.log( "messagemNormalizada", messagemNormalizada)
      const parsedMessage = JSON.parse(messagemNormalizada);
      console.log( "Conteúdo de 'parsedMessage'", parsedMessage, messagemNormalizada)
      if (parsedMessage.buttonText && parsedMessage.sections) {
        // (A lógica para enviar menus de opções permanece a mesma)
        //console.log("Detectado: Mensagem de Lista (menu de opções).");
        if (!setup_data.plano_ass_ok) {
          await sendTyping(phone, false, setup_data);
          //await sendMensagemLida(phone, false, setup_data) //Envia marca como "false = nao lida" | "true = lida"
          return new Response(JSON.stringify(
            {
              error: true,
              message: "Sem licença."
            }
          ),
            { status: 200 });
        }
        const listApiUrl = `${zApiBaseUrl}/send-list-message`;
        console.log( listApiUrl, {
            method: 'POST',
            headers,
            body: messagemNormalizada
          } )

        const response = await fetch(listApiUrl,
          {
            method: 'POST',
            headers,
            body: messagemNormalizada
          });

        if (!response.ok) throw new Error(`Erro ao enviar lista: ${response.statusText}`,  );
          await sendTyping(phone, false, setup_data);
        //await sendMensagemLida(phone, false, setup_data) //Envia marca como "false = nao lida" | "true = lida"
        return new Response(JSON.stringify({ success: true, message: "Menu enviado." }), { status: 200 });
      }
    } catch (e) {
  
  
      console.log("Mensagem não é um menu. Prosseguindo com a lógica de mídia/texto. Erro: ", e, messagem);
    }
  
    // ----- VERIFICAÇÃO 2: LÓGICA HÍBRIDA DE EXTRAÇÃO DE MÍDIA E TEXTO -----
  
    // Envia a parte do texto, se houver
    if (textoMensagem && tipo !== "send-voice-base64") {
      try {
        
        // Lógica para tratar texto que pode ser um JSON
        const cMessageJSON = JSON.parse(textoMensagem);
  
        //console.log( "textoMensagem", textoMensagem)
  
        let cMessage = cMessageJSON.message || textoMensagem;
        cMessage = cMessage
          .replace(/\n-\s*/g, '')
          .replace(/;/g, '')
  
        //console.log("messagem original:", messagem);
        //console.log( "textoMensagem Markdown", textoMensagem)
  
        const textApiUrl = `${zApiBaseUrl}/${tipo}`;
        //const body = JSON.stringify(messagem);
        if (setup_data.plano_ass_ok) {
          //console.log( `Antes fetch() : Tipo: ${tipo}`,  (tipo === "send-reply" ? textoMensagem.replace(`\n\n`,``) : messagem))
          const response = await fetch(textApiUrl,
            {
              method: 'POST',
              headers,
              body: (tipo === "send-reply" ? textoMensagem.replace(`\n\n`, ``) : messagem)
            });
          //console.log( `response.statusText: ${response.statusText}`)
  
          if (!response.ok) {
            console.error(`Erro ao enviar texto: ${response.statusText}`);
          }
          else {
            console.log(`${tipo} ->Texto enviado com sucesso.`, textoMensagem);
            //await sendTyping(phone, false, setup_data);
            //await sendMensagemLida(phone, false, setup_data) //Envia marca como "false = nao lida" | "true = lida"
          }
        } else {
          console.log("Sem licença. Envio de texto bloqueado.");
        }
        console.log(`textoMensagem && tipo !== "send-voice-base64" ==> midiasEncontradas`)
  
      } catch (error) {
        // Se não for um JSON, envia como texto normal
        //console.log("Enviando a parte do texto (texto puro):", textoMensagem)
        const textApiUrl = `${zApiBaseUrl}/send-message`;
        const body = JSON.stringify({ phone: setup_data.isLid ? setup_data.chatLid : phone, message: textoMensagem, 
              options: { markIsRead: false} 
        });
  
        if (setup_data.plano_ass_ok) {
          const response = await fetch(textApiUrl, { method: 'POST', headers, body: body });
          if (!response.ok) {
            console.error(`Erro ao enviar texto: ${response.statusText}`);
          }
          else {
            console.log(`${tipo} ->Texto enviado com sucesso.`, textoMensagem);
            //await sendTyping(phone, false, setup_data);
            //await sendMensagemLida(phone, false, setup_data) //Envia marca como "false = nao lida" | "true = lida"
          }
        } else {
          console.log("Sem licença. Envio de texto bloqueado.");
        }
      }
  
      if (l_fn_envia_markdown) {
        extractedContent = [...midiasEncontradas, ...linksEncontrados]
        //console.log ( "l_fn_envia_markdown: true.   midiasEncontradas:", midiasEncontradas)
        //console.log ( "l_fn_envia_markdown: true.   linksEncontrados:", linksEncontrados)
        //console.log ( "l_fn_envia_markdown: true.   extractedContent:", extractedContent)
  
        await fn_envia_markdown(phone, setup_data, extractedContent, env, headers, zApiBaseUrl)
      }
  
  
    }
  
    // ----- Lógica Final -----
    await sendTyping(phone, false, setup_data);

    const url_unseen = `${setup_data.server_api}/api/${setup_data.token}/mark-unseen`;
    let bodyUnSeen =  {phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone,
                          isLid: setup_data.isLid 
                      }


    console.log(`Debug - ${url_unseen}`, bodyUnSeen )
    const body = JSON.stringify(bodyUnSeen);
    try {
        console.log(`==> ${url_unseen}`,body)
        const response = await fetch(url_unseen, { method: 'POST', headers, body });
        if (!response.ok) {
          console.log(`Erro ao enviar,  [mark-unseen]: ${response.status} - ${response.statusText}`)
        }
        const data = await response.json();
        console.log("result de /mark-unseen", data)
    } catch (error) {
        console.log(`Erro ao enviar url: ${url_unseen} o sendMensagemLida [mark-unseen]: ${error.message}`); 
    }
  

    //await sendMensagemLida(phone, false, setup_data) //Envia marca como "false = nao lida" | "true = lida"
    if (!setup_data.plano_ass_ok && !textoMensagem && midiasEncontradas.length === 0) {
      return new Response(JSON.stringify({ error: true, message: "Sem licença. Plano vencido ou inexistente" }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, message: "Processamento concluído." }), { status: 200 });
  }
  
    
  async function getSetupToken(env, appKey) {
    return await env.db.prepare(`
      SELECT app_key, Assistant_ID, ConnectionTokenAPI, server_api
      FROM whatsapp_setup 
      WHERE app_key = ?`)
      .bind(appKey).first();
  }
  
export async function sendMensagemLida(phone, true_false, setup_data) {
    //console.log("setup_data: Typing", true_false );
    //Softset API
  
    
    const seen = true_false ? 'send-seen' : 'mark-unseen'
  
    const zApiUrl = `${setup_data.server_api}/api/${setup_data.app_key}/${seen}`
  
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${setup_data.ConnectionTokenAPI}`
    };

    let bodyUnSeen =  {phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone,
                          isLid: setup_data.isLid 
                      }

    const body = JSON.stringify(bodyUnSeen);

    try {
      //      console.log( "url chamada fetch: ", zApiUrl);
      const response = await fetch(zApiUrl, { method: 'POST', headers, body });
      if (!response.ok) {
        console.log(`Erro ao enviar, resposta de sendMensagemLida [${seen}]: ${response.status} - ${response.statusText}`)
        const x = await fn.sendNotification(phone, '3C9E8C57317B308727BBD604DAF2BCF1', `Contato do cliente: ${setup_data.nome_fantasia}\nErro em ${zApiUrl}: \n${seen}`, `Erro Whatsapp Worker`)
        //  throw new Error(`Erro ao enviar, resposta: ${response.status} - ${response.statusText}`);
      }
      const data = await response.json();
      //return data.zaapId 
      return new Response(JSON.stringify(data), { status: 200 }); // Aqui, você retorna um Response válido
    } catch (error) {
      console.log(`Erro ao enviar o sendMensagemLida [${seen}]: ${error.message}`);
      console.log("url chamada: ", zApiUrl);
      return new Response(`Erro ao ao enviar o sendMensagemLida [${seen}]:: ${error.message}`, { status: 200 });
    }
  }
  
  
  export async function sendTyping(phone, true_false, setup_data) {
    //console.log("setup_data: Typing", true_false );
    //Softset API
  
    let isLidFallback = true;
    if(  phone.startsWith('55') && 
                (phone.length === 12 || phone.length === 13) ) {
        isLidFallback = false
    }

    const zApiUrl = `${setup_data.server_api}/api/${setup_data.app_key}/typing`
  
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${setup_data.ConnectionTokenAPI}`
    };
  
 
    const body = JSON.stringify({
      "phone": setup_data.isLid ? setup_data.chatLid : setup_data.phone, //  setup_data.isLid ? setup_data.chatLid : setup_data.phone,
      "value": true_false,
      "isLid": setup_data.isLid || isLidFallback
    });
    try {
      //console.log("url chamada fetch: ", zApiUrl);
      const response = await fetch(zApiUrl, { method: 'POST', headers, body });
      console.log(`chamada`, zApiUrl, { method: 'POST', headers, body } )
      if (!response.ok) {
        console.log(`Erro ao enviar, resposta de Typing: ${response.status} - ${response.statusText}`)
        //  throw new Error(`Erro ao enviar, resposta: ${response.status} - ${response.statusText}`);
      }
      const data = await response.json();
      //return data.zaapId 
      console.log("Retorno de sendTyping ", data)
      return new Response(JSON.stringify(data), { status: 200 }); // Aqui, você retorna um Response válido

    } catch (error) {
      console.log(`Erro ao enviar o typing: ${error.message}`);
      console.log("url chamada: ", zApiUrl);
      const x = await fn.sendNotification(phone, '3C9E8C57317B308727BBD604DAF2BCF1', `Contato do cliente: ${setup_data.nome_fantasia}\nErro em ${zApiUrl}: \n${error.message}`, `Erro Whatsapp Worker`)
  
      return new Response(`Erro ao ao enviar o typing:: ${error.message}`, { status: 200 });
    }
  }
  
  export async function sendRecording(phone, true_false, setup_data) {
    //console.log("setup_data: Typing", true_false );
    //Softset API
    let isLidFallback = true;
    if(  phone.startsWith('55') && 
                (phone.length === 12 || phone.length === 13) ) {
        isLidFallback = false
    }

    const zApiUrl = `${setup_data.server_api}/api/${setup_data.app_key}/recording`
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${setup_data.ConnectionTokenAPI}`
    };

  
    const body = JSON.stringify({
      "phone": setup_data.isLid ? setup_data.chatLid : setup_data.phone, //  setup_data.isLid ? setup_data.chatLid : setup_data.phone,
      "value": true_false,
      "isLid": setup_data.isLid || isLidFallback
    });

    try {
      const response = await fetch(zApiUrl, { method: 'POST', headers, body });
      if (!response.ok) throw new Error(`Erro ao enviar, resposta: ${response.status} - ${response.statusText}`);
      const data = await response.json();
      //return data.zaapId 
      return new Response(JSON.stringify(data), { status: 200 }); // Aqui, você retorna um Response válido
    } catch (error) {
      console.log(`Erro ao enviar o recording: ${error.message}`);
      console.log("url chamada: ", zApiUrl);
      const x = await fn.sendNotification(phone, '3C9E8C57317B308727BBD604DAF2BCF1', `Contato do cliente: ${setup_data.nome_fantasia}\nErro em ${zApiUrl}: \n${error.message}`, `Erro Whatsapp Worker`)
  
      return new Response(`Erro ao ao enviar o recording:: ${error.message}`, { status: 200 });
    }
  }
  

/*
export async function fn_markdown(messagemNormalizada) {
  // Parseia a string JSON para objeto JS
  //const mensagemObj = JSON.parse(messagemNormalizada);

  // Texto a ser processado: campo description com Markdown
  let textoProcessado = messagemNormalizada // mensagemObj.description;
  console.log( "fn_markdown (entrada):: textoProcessado", textoProcessado)
  // 1. Extrai imagens em Markdown ![desc](url)
  const markdownImageRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  const midiasMarkdownImages = [...textoProcessado.matchAll(markdownImageRegex)].map(match => ({
    caption: match[1] || 'Imagem',
    url: match[2],
  }));

  // Remove imagens Markdown do texto
  textoProcessado = textoProcessado.replace(markdownImageRegex, '');

  // 2. Extrai links em Markdown [desc](url) — para PDFs, YouTube, etc
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const midiasMarkdownLinks = [...textoProcessado.matchAll(markdownLinkRegex)].filter(match => {
    const url = match[2];
    return url.match(/\.(pdf)$/i) || url.match(/youtube\.com|youtu\.be/i);
  }).map(match => ({
    caption: match[1],
    url: match[2],
  }));

  // Remove links Markdown de mídias (pdf, youtube) do texto
  textoProcessado = textoProcessado.replace(markdownLinkRegex, '');

  // 3. Extrai URLs puras no texto (imagens, pdf)
  const urlRegex = /https?:\/\/[^\s)]+/gi;
  const midiasUrlPura = [...textoProcessado.matchAll(urlRegex)].filter(match => {
    const url = match[0];
    return url.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|pdf)$/i);
  }).map(match => ({
    url: match[0],
    caption: match[0].split('/').pop().split('?')[0],
  }));

  // Remove URLs puras do texto
  textoProcessado = textoProcessado.replace(urlRegex, '');

  // Remove marcações tipo "- " seguidas de quebra de linha (opcional)
  textoProcessado = textoProcessado.replace(/\n-\s*   /g, '').trim();

  // Combina todas as mídias encontradas
  const midiasEncontradas = [...midiasMarkdownImages, ...midiasMarkdownLinks, ...midiasUrlPura];

  // Atualiza o campo description no objeto original com texto limpo
 // mensagemObj.description = textoProcessado;

 console.log( "fn_markdown (saida):: textoProcessado", textoProcessado)
  // Monta o retorno
  return {
    textoMensagem: textoProcessado,   // texto limpo, sem mídias
    midiasEncontradas,                // array com objetos de mídias extraídas
    newMessage: textoProcessado,          // objeto JSON atualizado (parsed)
  };
}
*/
export async function fn_markdown(messagemNormalizada) {
    let textoProcessado = messagemNormalizada;
    //console.log("fn_markdown (entrada):: textoProcessado", textoProcessado);
  
    const midiasEncontradas = [];
    const linksEncontrados = [];
  
    // Regex para identificar extensões de imagem ou PDF
    const mediaExtensionsRegex = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|pdf)$/i;
    // Regex para identificar URLs do YouTube
    const youtubeRegex = /youtube\.com|youtu\.be/i;
  
    // --- 1. Extrai APENAS URLs Markdown (Imagem ou Link) ---
    // A regex combinada agora só pega padrões de Markdown: ![alt](url) OU [text](url)
    const markdownOnlyLinksRegex = /(?:!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\))|(?:\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
    const allMatches = [...textoProcessado.matchAll(markdownOnlyLinksRegex)];
  
    const extractedItems = [];
  
    allMatches.forEach(match => {
      let url = '';
      let caption = '';
      let isImageMarkdown = false;
  
      // Determine o tipo de match e extraia URL/caption
      if (match[1] && match[2]) { // Pattern: ![alt](url)
        caption = match[1] || 'Imagem';
        url = match[2];
        isImageMarkdown = true;
      } else if (match[3] && match[4]) { // Pattern: [text](url)
        caption = match[3];
        url = match[4];
      }
      // A parte que lidava com 'match[5]' (URL pura) foi removida,
      // garantindo que apenas Markdown seja processado.
  
      if (url) { // Garante que uma URL válida foi extraída do Markdown
        extractedItems.push({
          url: url,
          caption: caption,
          isImageMarkdown: isImageMarkdown,
          originalMatch: match[0] // Guarda o texto original para remoção
        });
      }
    });
    console.log("fn_markdown :: extractedItems", extractedItems )
    // --- 2. Classifica os itens extraídos (somente Markdown) e remove-os do texto ---
    extractedItems.forEach(item => {
      const { url, caption, isImageMarkdown, originalMatch } = item;
      let classified = false;
      console.log("fn_markdown :: url", url )
      // Prioriza mídias diretas (imagens por extensão, PDF, YouTube)
      if (url.match(mediaExtensionsRegex)) {
        midiasEncontradas.push({
          url: url,
          caption: caption,
          type: url.match(/\.(pdf)$/i) ? 'pdf' : (isImageMarkdown ? 'image' : 'image_url')
        });
        classified = true;
      } else if (url.match(youtubeRegex)) {
        midiasEncontradas.push({
          url: url,
          caption: caption,
          type: 'youtube'
        });
        classified = true;
      }
  
      // Se não foi classificado como mídia direta, vai para linksEncontrados
      if (!classified) {
        linksEncontrados.push({
          url: url,
          caption: caption,
          // Usamos 'isImageMarkdown' para distinguir a origem se necessário para o tipo
          type: isImageMarkdown ? 'web_link_from_image_markdown' : 'web_link'
        });
      }
  
      // Remove o item do texto processado
      textoProcessado = textoProcessado.replace(originalMatch, '');
    });
  
    // --- Limpeza final do texto ---
    // Remove marcações tipo "- " seguidas de quebra de linha (opcional)
    textoProcessado = textoProcessado.replace(/\n-\s*/g, '').trim();
  
    console.log("fn_markdown (saida):: textoProcessado", textoProcessado);
    console.log("fn_markdown (saida):: midiasEncontradas", midiasEncontradas);
    console.log("fn_markdown (saida):: linksEncontrados", linksEncontrados);
  
    return {
      textoMensagem: textoProcessado,
      midiasEncontradas,
      linksEncontrados,
      newMessage: textoProcessado,
    };
  }
  
  
  
  export async function fn_envia_markdown(phone, setup_data, extractedContent, env, headers, zApiBaseUrl) {
    // A função agora recebe 'extractedContent' que contém 'midiasEncontradas' e 'linksEncontrados'
    const { midiasEncontradas, linksEncontrados } = extractedContent;
  

    let isLidFallback = true;
    if(  phone.startsWith('55') && 
                (phone.length === 12 || phone.length === 13) ) {
          isLidFallback = false
    }
  
    let allItemsToProcess = [
      ...(midiasEncontradas || []), // Garante que é um array, mesmo se estiver vazio/nulo
      ...(linksEncontrados || [])
    ];
    allItemsToProcess = extractedContent
  
    //console.log("allItemsToProcess", allItemsToProcess )
    if (allItemsToProcess.length > 0) {
      //console.log(`Encontrados ${allItemsToProcess.length} itens (mídias e links) para processar.`);
  
      for (const item of allItemsToProcess) {
        let endpoint = '';
        let payload = {};
        let isMediaProcessing = false; // Flag para indicar se é uma mídia que precisa de conversão Base64
        
        try {
          // --- ROTEADOR DE TIPOS DE ITEM ---
          if (item.type === 'youtube') {
            //console.log(`URL de YouTube detectada: ${item.url}`);
            endpoint = '/send-link-preview';
            payload = { phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone, url: item.url, caption: item.caption || 'Veja este vídeo! 🎥', isLid: setup_data.isLid || isLidFallback  };
  
          } else if (item.type === 'web_link' || item.type === 'web_link_url' || item.type === 'web_link_from_image_markdown') {
            //console.log(`URL de link de página detectada: ${item.url}`);
            endpoint = '/send-link-preview'; // Endpoint para pré-visualização de links
            payload = { phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone, url: item.url, caption: item.caption || 'Confira este link!', isLid: setup_data.isLid || isLidFallback  }; // Caption genérica se não houver
  
          } else if (item.type === 'image' || item.type === 'image_url' || item.type === 'pdf' || item.type === 'pdf_url') {
            // Lógica para arquivos (IMAGEM ou PDF) - que precisam de conversão Base64
            isMediaProcessing = true; // Define a flag para processamento de mídia
            //console.log(`URL de arquivo detectada: ${item.url}`);
  
            const isPdf = (item.type === 'pdf' || item.type === 'pdf_url');
            endpoint = isPdf ? '/send-file' : '/send-image';
  
            if (!setup_data.token) throw new Error("Token para o serviço de conversão não encontrado.");
  
            const converterUrl = `https://whatsapp-webhook.softset.workers.dev/urlToBase64?token=${setup_data.token}&url=${encodeURIComponent(item.url)}`;
            const base64Response = await env.base64.fetch(converterUrl);
            if (!base64Response.ok) throw new Error(`Conversor falhou com status ${base64Response.status}`);
  
            const data = await base64Response.json();
            const base64 = data.xbase64;
            if (!base64) throw new Error("Resposta do conversor não continha os dados em Base64.");
  
            const filename = encodeURIComponent(item.url.split('/').pop().split('?')[0]);
            payload = { phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone, base64, filename, caption: item.caption || filename, isLid: setup_data.isLid || isLidFallback  };
  
          } else {
            console.warn(`Tipo de item desconhecido, pulando: ${item.type} - URL: ${item.url}`);
            continue; // Pula para o próximo item
          }
  
          // --- DISPARO PARA A API ---
          if (setup_data.plano_ass_ok) {
            if (!endpoint) { // Garante que um endpoint foi definido
              console.warn(`Endpoint não definido para o item: ${JSON.stringify(item)}. Pulando envio.`);
              continue;
            }
            const apiUrl = `${zApiBaseUrl}${endpoint}`;
            //console.log(`Enviando para o endpoint: ${endpoint}`);

           
            const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
  
            if (!response.ok) {
              console.log(`Erro ao enviar item ${item.url} para ${endpoint}: ${response.status} - ${response.statusText}`);
              // Log do corpo da resposta de erro para depuração
              
              try {
                const errorBody = await response.json();
                console.log('Detalhes do erro:', errorBody);
              } catch (jsonError) {
                console.log('Erro ao parsear detalhes do erro:', jsonError);
              }
            } else {
              // Ações pós-envio, apenas se a requisição foi bem-sucedida
              await sendTyping(phone, false, setup_data);
              await sendMensagemLida(phone, false, setup_data);
              console.log(`Item ${item.url} (${item.type}) enviado com sucesso.`);
            }

          } else {
            console.log(`Sem licença. Envio do item ${item.url} bloqueado.`);
          }
  
          // Pequeno delay entre os envios para evitar sobrecarga ou limites de taxa
          await new Promise(resolve => setTimeout(resolve, 500));
  
        } catch (error) {
          console.error(`Falha fatal ao processar o item ${item.url}:`, error);
        }
      }
    } else {
      console.log("Nenhum item (mídia ou link) encontrado para processar.");
    }
  }
  
  

export async function enviarMensagemWhatsapp(env, mensagem, phone, setup_data, audio_only, messageId) {
    console.log("fetchOpenAI_V2 => Data", mensagem)
  
    let isLid = true;
    if(  phone.startsWith('55') && 
                (phone.length === 12 || phone.length === 13) ) {
        isLid = false
    }

    const thread_mensagem = mensagem
    const thread_messageId = messageId
    const currentTimestamp = Math.floor(Date.now() / 1000);
    let message_body = `🤖✨\n ${thread_mensagem}\n`
  
    const get_showByWhatszaip = await env.Whatsapp_show_ByWhatszAIp.get(`${phone}_${setup_data.token}`)
    const showByWhatszaip = get_showByWhatszaip && get_showByWhatszaip > 0 ? false : true
    console.log(`showByWhatszaip = ${get_showByWhatszaip}`, showByWhatszaip)
    if (showByWhatszaip) {
      message_body = message_body + `\n⚠️ _Considere verificar as informações importantes com nossos especialistas._\n\`By WhatszAIp v2\` `
    }
    message_body = message_body + `\n_Caso queira voltar para a lista de opções, basta simplesmente enviar:_\n*Menu* `
  
    if (thread_mensagem) {
  
      if (!audio_only) {
  
        console.log("fetchOpenAI_V2 :: message_body", message_body)
        let responseBody = JSON.stringify({
          "phone": setup_data.isLid ? setup_data.chatLid : setup_data.phone,
          "isGroup": false,
          "isLid": setup_data.isLid,
          "message": message_body,
          "messageId": thread_messageId,
              options: { markIsRead: false},
          "delayMessage": "1"
        });
        // Enviamos a resposta usando a função `sendZapiResponse`
  
        let zapiResponse
  
        /*   if (phone === "5511986169000") {
              zapiResponse =  await sendZapiResponse_new(phone, responseBody, 'send-reply', setup_data, env);
  
          } else {
        */
        console.log("responseBody", responseBody)
        zapiResponse = await wpp.sendZapiResponse(phone, responseBody, 'send-reply', setup_data, env);
        await env.Whatsapp_show_ByWhatszAIp.put(`${phone}_${setup_data.token}`, currentTimestamp, { expirationTtl: 64800 }); // Armazena com TTL de 18 horas
  
        //   }
  
  
  
        if (zapiResponse.ok) {
  
          let updateResult;
          let updateQuery;
          console.log("Resposta enviada para o Whatsapp com sucesso");
  
          /*
          const jBody = JSON.stringify({
            phone: phone,
            isGroup: false,
            description: "_Digite abaixo, ou clique aqui:_",
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
            delayMessage: "1"
          });
          await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
  
          */
  
          return new Response("Resposta enviada para o Whatsapp com sucesso", { status: 200 });
        } else {
          await sendTyping(phone, false, setup_data) // desliga o "digitando..." (Typing)
          console.log("Erro ao enviar a resposta para o Whatsapp");
          return new Response("Erro ao enviar a resposta para o Whatsapp", { status: 500 });
        }
      } else {
  
        // AUDIO !
        //console.log(`Chamando Text_to_Speech(${thread_mensagem}`)
  
        const retorna_fn_markdown = await fn_markdown(thread_mensagem)
        console.log("fetchOpenAI_V2 >> fn_markdown:", retorna_fn_markdown)
        const textoMensagem = retorna_fn_markdown.textoMensagem
        const midiasEncontradas = retorna_fn_markdown.midiasEncontradas || []
  
        console.log("textoMensagem", textoMensagem)
        console.log("midiasEncontradas", midiasEncontradas)
  
        //const ret = await Text_to_Speech(thread_mensagem, phone, setup_data, env) 
        const ret = await ia.Text_to_Speech(textoMensagem, phone, setup_data, env, midiasEncontradas, messageId, true)
  
        console.log(`retorno Text_to_Speech: ${JSON.stringify(ret)}`)
  
      }
    }
  
  
  }


  export async function updatewhatsapp_contatos_archive_picture(env, setup_data, token, phone, body, headers, fast) {
    //console.log("chegando em updatewhatsapp_contatos_archive_picture");
    let tokenAPI;
    let urlbase = `${setup_data.server_api}/api/${token}`;
    tokenAPI = setup_data.ConnectionTokenAPI;
  
  
    let user_id
    let labels
    let timestamp
    let contact_name
    let contact_pushname
    let contact_profilePicThumbObj
  
    let data = null;
    // Verifica se o tipo de conteúdo é JSON
    let responseData = JSON.parse(body)
    setup_data.photo = responseData.contact_profilePicThumbObj || ""
    //console.log("updatewhatsapp_contatos_archive_picture :: responseData ", responseData )
  
    if (fast) {
      
      // Verifica se o registro já existe na tabela whatsapp_contatos
      const selectQuery = `SELECT * FROM whatsapp_contatos WHERE user_id = ? and token = ?`;
      const selectResult = await env.db.prepare(selectQuery).bind(responseData.phone, token).all();
      // console.log( "SELECT * FROM whatsapp_contatos WHERE user_id = ? and token = ?", selectResult)
      if ((selectResult.results.length === 0)) {
        const insertQuery = `
                  INSERT INTO whatsapp_contatos (user_id, name, labels, timestamp, profilePic, token)
                  VALUES (?, ?, ?, ?, ?, ?)`;
        try {
          await env.db.prepare(insertQuery).bind(responseData.phone, responseData.contact_pushname, "", responseData.timestamp, responseData.contact_profilePicThumbObj || "", token).run();
          console.log(`Registro inserido: ${phone}, ${responseData.contact_pushname}`);
        } catch (insertError) {
          console.log(`Erro ao inserir novo contato: ${phone}, ${responseData.contact_pushname}, ${token}`, insertError);
        }
      } else {
        const updateQuery = `UPDATE whatsapp_contatos SET timestamp = ?, name = ?, profilePic = ? WHERE user_id = ? and token = ?  `;
        try {
          // Executando o update no banco de dados para cada contato
          await env.db.prepare(updateQuery).bind(responseData.timestamp, responseData.contact_pushname, responseData.contact_profilePicThumbObj || "", responseData.phone, token).run();
          // console.log(`Contato ${phone} atualizado com sucesso.`);
        } catch (updateError) {
          console.log(`Erro ao atualizar registro do contato ${phone}:`, updateError);
        }
      }
  
  
  
    } else {
  
      //=================================================================================//
      // Para qualquer conexão, verificamos se devemos prever se o contato foi arquivado
  
      const chatArchive = await fetch(`${urlbase}/all-chats-archived`, {
        method: 'GET',
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${tokenAPI}`,
        },
      });
  
      if (chatArchive.ok) {
        // Retornando a resposta com os dados processados
        try {
          let responsechatArchive = await chatArchive.json();
          // console.log("responsechatArchive:", responsechatArchive);
  
          // Passando por todos os contatos do chat arquivado
          for (const chat of responsechatArchive) {
            const archived_time = chat.t || 0;
            const archiveFlag = chat.archive || false;
            const archiveId = chat.contact?.id?.user || false; // Verificando se o ID do contato existe
  
            if (archiveFlag && archiveId) { // Contato foi arquivado no Whatsapp e tem ID válido
              const updateQuery = `
                                UPDATE whatsapp_contatos
                                SET arquivado = 1, timestamp = ?
                                WHERE token = ? AND user_id = ?`;
  
              try {
                // Executando o update no banco de dados para cada contato
                await env.db.prepare(updateQuery).bind(archived_time, token, archiveId).run();
                console.log(`Contato ${archiveId} atualizado com sucesso.`);
              } catch (updateError) {
                console.log(`Erro ao atualizar registro do contato ${archiveId}:`, updateError);
              }
            }
          }
  
        } catch (error) {
          console.error(`Erro ao processar resposta de ${urlbase}/all-chats-archived`, error);
  
        }
      } else {
        console.log(`Erro na requisição para ${urlbase}/all-chats-archived com token ${tokenAPI}`);
  
      }
      //=================================================================================//
  
  
  
      // Parse do JSON
      let responseData_por_id = await chatArchive.json();
      console.log("responseData de chat-by-id", responseData_por_id);
  
      labels = "" //responseData.labels ? responseData.labels.join(', ') : ""; // Converte o array de labels em uma string ou usa string vazia se undefined
      timestamp = responseData.timestamp || 0;
      contact_name = responseData.contact_name ? responseData.contact_name : user_id; // Verifica se 'contact' existe
      contact_pushname = responseData.contact_pushname ? responseData.contact_pushname : contact_name; // Verifica se 'pushname' existe
      contact_profilePicThumbObj = responseData.contact_profilePicThumbObj ? responseData.contact_profilePicThumbObj : ""; // Verifica a existência de 'profilePicThumbObj'
  
      // user_id = responseData.phone;
      console.log(`responseData por ID: ${user_id}`, responseData);
      user_id = phone
  
      const mensagens_etiquetas = [];
  
      try {
        // Verifica o conteúdo de responseData
  
  
        console.log(`variaveis : ${user_id}, ${contact_name}, ${contact_pushname}, ${labels}, ${timestamp}, ${contact_profilePicThumbObj}, ${token}`);
  
        // Verifica se o registro já existe na tabela whatsapp_contatos
        const selectQuery = `SELECT * FROM whatsapp_contatos WHERE user_id = ? and token = ?`;
        const selectResult = await env.db.prepare(selectQuery).bind(user_id, token).all();
  
  
        if ((selectResult.results.length === 0)) {
          // Não existe, insere novo registro
          console.log(`contato inexistente : ${user_id}, ${contact_pushname}, ${labels}, ${timestamp}, ${contact_profilePicThumbObj}, ${token}`);
          const insertQuery = `
                          INSERT INTO whatsapp_contatos (user_id, name, labels, timestamp, profilePic, token)
                          VALUES (?, ?, ?, ?, ?, ?)`;
          try {
            await env.db.prepare(insertQuery).bind(user_id, contact_pushname, labels, timestamp, contact_profilePicThumbObj || "", token).run();
            console.log(`Registro inserido: ${user_id}, ${contact_pushname}`);
          } catch (insertError) {
            console.log(`Erro ao inserir novo contato: ${user_id}, ${contact_pushname}, (${labels}), ${timestamp}, ${contact_profilePicThumbObj}, ${token}`, insertError);
          }
        } else {
          // Existe, atualiza o registro
          const existingRecord = selectResult.results;
          console.log()
          if (existingRecord && existingRecord.profilePic !== contact_profilePicThumbObj && existingRecord.profilePic === "") {
            // Atualiza o campo profilePic somente se houver mudança e se não for um valor em branco
            console.log(`contato Existente (atualizando Picture) : ${user_id}, ${contact_pushname}, ${labels}, ${timestamp}, ${contact_profilePicThumbObj}, ${token}`);
  
            const updateQuery = `
                              UPDATE whatsapp_contatos
                              SET name = ?, labels = ?, timestamp = ?, profilePic = ?, token = ?
                              WHERE user_id = ? and token = ?`;
            try {
              await env.db.prepare(updateQuery).bind(contact_pushname, labels, timestamp, contact_profilePicThumbObj || "", token, user_id, token).run();
            } catch (updateError) {
              console.log(`Erro ao atualizar registro: ${user_id}, ${contact_pushname}`, updateError);
            }
          } else {
            // Atualiza os outros campos (sem tocar no profilePic se estiver em branco)
            if (existingRecord.name !== contact_pushname || existingRecord.labels !== labels || timestamp !== existingRecord.timestamp) {
              console.log(`contato Existente (name or labels) : ${user_id}, ${existingRecord.name}<=>${contact_pushname}, ${existingRecord.labels}<=>${labels}, ${timestamp}, ${contact_profilePicThumbObj}, ${token}`);
  
              const updateQuery = `
                                  UPDATE whatsapp_contatos
                                  SET name = ?, labels = ?, timestamp = ?, token = ?
                                  WHERE user_id = ? and token = ? `;
              try {
                await env.db.prepare(updateQuery).bind(contact_pushname, labels, timestamp, token, user_id, token).run();
                console.log(`Registro atualizado (sem alteração de photo): ${user_id}, ${contact_pushname}`);
              } catch (updateError) {
                console.log(`Erro ao atualizar (sem profilePic): ${user_id}, ${contact_pushname}`, updateError);
              }
            }
          }
        }
  
        // Adicionando as informações processadas ao array
        mensagens_etiquetas.push({
          user_id,
          labels,
          timestamp,
          contact_name,
          contact_pushname,
          contact_profilePicThumbObj
        });
  
  
        // Agora, vamos atualizar os registros onde o campo profilePic está em branco
        const emptyProfilePicQuery = `SELECT * FROM whatsapp_contatos WHERE profilePic = "" and user_id = ? and token = ?`;
        const emptyProfilePicRecords = await env.db.prepare(emptyProfilePicQuery).bind(user_id, token).all();
  
        if (emptyProfilePicRecords && emptyProfilePicRecords.results && emptyProfilePicRecords.results.length > 0) {
          const profilePicResponse = await fetch(`${urlbase}/profile-pic/${user_id}`, {
            method: 'GET',
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${tokenAPI}`,
            },
          });
  
          // Verifique se a resposta foi bem-sucedida
          if (!profilePicResponse.ok) {
            console.log(`Erro em: ${urlbase}/profile-pic/${user_id}`);
            // Retornando a resposta com os dados processados
            return new Response(JSON.stringify({ success: false, mensagem: profilePicResponse.text }), {
              headers: headers
            });
          }
  
          // Parse do JSON
          let responseDataPic = await profilePicResponse.json();
          console.log("responseDataPic", responseDataPic);
  
          // Verifica se a estrutura esperada existe
          if (responseDataPic && responseDataPic.response) {
            const newProfilePic = responseDataPic.response?.eurl || "";
  
            // Atualiza o campo profilePic se encontrado
            if (newProfilePic) {
              const updateProfilePicQuery = `
                                  UPDATE whatsapp_contatos
                                  SET profilePic = ?
                                  WHERE user_id = ? and token = ? `;
              try {
                await env.db.prepare(updateProfilePicQuery).bind(newProfilePic, user_id, token).run();
                console.log(`ProfilePic atualizado para: ${user_id}`);
              } catch (updateError) {
                console.log(`Erro ao atualizar profilePic para o user_id: ${user_id}`, updateError);
              }
            }
          } else {
            console.log(`Nenhuma foto de perfil encontrada para o user_id: ${user_id}`);
          }
        }
  
  
        // Retornando a resposta com os dados processados
        return new Response(JSON.stringify(mensagens_etiquetas), {
          headers: headers
        });
  
      } catch (error) {
        console.error("Erro ao processar o endpoint get-labels:", error);
        return new Response(
          JSON.stringify({ error: "Erro ao processar a requisição", details: error.message }),
          {
            status: 500,
            headers: headers
          })
      }
  
    }
  }

  
  
