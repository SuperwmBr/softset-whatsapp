import * as chamados from './chamados.js';
import * as formata from './formatacoes.js';
import * as fn from './funcoes-genericas.js';
import * as ia from './IA.js';
import * as wpp from './wppconnect.js';

export async function fn_chamando_menu(message, setup_data) {
    return (
      setup_data.wellcome_menu
        .toLowerCase()
        .split('|')                    // Divide o menu por vírgulas
        .some(keyword =>
          message.trim().toLowerCase() === keyword.trim().toLowerCase() // Compara diretamente
        )
    )
  }
  

export async function processMessageV2(phone, message, senderName, env, setup_data) {
    // Carregar o menu do KV storage
    const token = setup_data.app_key;
    const timestampAtual = Math.floor(Date.now() / 1000);
    //    console.log("timestampAtual: ",timestampAtual);  // Exemplo: 1674523586   
  
    if (message.toLowerCase() === "menu") {
      //  const ret_base64 = await Text_to_Speech( `Oi ${senderName},  selecione uma opcao aqui no menu. dê uma navegada que você e verá que você tem tudo o que gostaria de saber neste momento. Experimente!`,  phone, setup_data, env  )
    }
    //======= Montando o menu de atendentes/Setores =======//
  
    let _menu_atendentes = [];
    let setoresProcessados = [];
    let nAtendentes = []
    let _menu_disponibilidades = []
    let eventosProcessados = [];
    let _menu_links = [];
    let linksProcessados = [];
    let _menuFormulario = [];
    let menu_arearestrita = [];
  
  
    // Leituras independentes da montagem do menu. Em paralelo, elas não alteram
    // os dados nem a ordem de composição e reduzem a espera acumulada por I/O.
    const [result, kv_disponibilidades, result_form, storedMenuItems_] = await Promise.all([
      env.db.prepare(`
        SELECT id, nome || IFNULL(' [' || setor || ']', '') AS name, whatsapp
        FROM whatsapp_atendentes_setores
        WHERE token = ?
        ORDER BY nome;
      `).bind(token).all(),
      env.Whatsapp_Calendar.get(setup_data.app_key),
      env.db.prepare(`SELECT * FROM wpp_forms_saved WHERE token = ? and active = 1 ORDER BY atualizadoEm DESC`).bind(token).all(),
      env.MENU_STORAGE.get(`menu:${token}`),
    ]);
    //    console.log( `Atendentes: [${result.results.length}] : ok? [${result.ok}]`, result.results)
  
    if (result.results.length > 0) {
      nAtendentes = result.results; // Usando diretamente os resultados da consulta
  
  
      if (nAtendentes.length > 0) {
        //          console.log("nAtendentes.length", nAtendentes.length);
        //const atendSetores = JSON.parse(kv_setores);
        //  const atendSetores = nAtendentes 
  
        setoresProcessados = [
          {
            id: "ate_r8l2vpxwmh",
            title: `🗓️ Setores/Atendentes`,
            text: '⚠️ Selecione a area (Atendente/Setor) que deseja informações',
            children: []
          }];
  
        // Loop para processar cada item da lista de disponibilidades
        nAtendentes.forEach(evento => {
          const { id, name, whatsapp, setor } = evento;
  
          // Adiciona o evento processado ao novo array
          const uuid = timestampAtual
          let menu_name = `ℹ️ ${name}`
  
          setoresProcessados[0].children.push({
            id: `${whatsapp}`,
            title: menu_name,
            text: `${senderName},\n👤 Agora você está sendo atendido por [\`${name}\`]\n🎫 Seu protocolo de atendimento:\n${uuid}\n\n⚠️ *O que gostaria de saber?*`,
            children: []
            //children: [{id: phone, title: `${uuid} [${senderName}]`, text: '', children: []}] // O array 'children' de cada evento ainda pode ser usado se necessário
          });
  
        });
  
  
  
      }
    }
    _menu_atendentes = setoresProcessados
    //  console.log( "_menu_atendentes", _menu_atendentes)
  
    //======= Montando o menu de disponibilidades =======//
  
    /*
    let _menu_disponibilidades 
    let eventosProcessados = [];
    let _menu_links = [];
    let linksProcessados = [];
    let _menuFormulario = []
    */
  
    //  console.log("kv_disponibilidades",kv_disponibilidades )
    let disponibilidades
  
    // Verifica se os dados retornados não são nulos
    if (kv_disponibilidades) {
      // Converte a string JSON em um array de objetos
      let parsedData = kv_disponibilidades ? JSON.parse(kv_disponibilidades) : []; // Garante que `data` seja um array ou vazio
  
      // console.log("parsedData",parsedData )
      // Verifica se `parsedData` é um objeto e o transforma em array, se necessário
      if (!Array.isArray(parsedData)) {
        disponibilidades = [parsedData];
      } else {
        disponibilidades = parsedData
      }
  
      // const disponibilidades = JSON.parse(kv_disponibilidades);
      //     console.log("disponibilidades",disponibilidades )
      // Novo array para armazenar os eventos processados
  
      eventosProcessados = [
        {
          id: "r8l2vpxwmh",
          title: `🗓️ Disponibilidade(s) especiais`,
          text: '⚠️ Contate e confirme se ainda há esta(s) disponibilidade(s) 👇.\nEsta informação ainda não assegura que a disponibilidade não foi ocupada.',
          children: []
        }];
  
      // Loop para processar cada item da lista de disponibilidades
      if (disponibilidades.length > 0) {
        disponibilidades.forEach(evento => {
          const { id, title, start, end, allDay } = evento;
          if (start >= timestampAtual) {
            const inicioFormatado = formata.formatarData(start, allDay, 'inicio');
            const fimFormatado = formata.formatarData(end, allDay, 'fim');
            let iEvento
            if (allDay) {
              iEvento = `📆 ${title} - de ${inicioFormatado} até ${fimFormatado}`
            } else {
              iEvento = `📆 ${title} - ${inicioFormatado} ${fimFormatado}`
            }
  
            // Adiciona o evento processado ao novo array
  
            eventosProcessados[0].children.push({
              id: id,
              title: iEvento,
              text: '⚠️ Agora, contate e confirme se ainda há esta(s) disponibilidade(s).',
              children: [] // O array 'children' de cada evento ainda pode ser usado se necessário
            });
  
  
          }
        });
  
      }
      if (eventosProcessados[0].children.length > 0) {
        _menu_disponibilidades = eventosProcessados; //JSON.stringify(eventosProcessados, null, 2);
      } else {
        _menu_disponibilidades = [];
      }
    }
    // Agora 'eventosProcessados' contém todos os eventos formatados
  
    //   console.log( "_menu_disponibilidades", _menu_disponibilidades)
  
  
    //======= Montando o menu de links específicos (Area Autorizada) =======//
  
  
    /*
    try {
        const kv_links = await env.whatsappwebhook.fetch(`https://whatsapp-webhook.softset.workers.dev/visitantes_conhecidos?token=${token}`);
        const kv_matriz = await kv_links.json();  // Corrigido o uso do fetch e json()
        console.log("kv_matriz", JSON.stringify(kv_matriz));
        const kv_matriz_links = kv_matriz[0].valor.links
        console.log( "kv_matriz_links", kv_matriz_links)
  
        // Verifica se os dados retornados não são nulos
        if (kv_matriz && kv_matriz_links) {
          // Aqui, a chave links é diretamente acessada, pois não é um array de objetos
          const links = kv_matriz_links;
          console.log( "kv_matriz.links", links)
          // Inicializando o array de links processados
          linksProcessados = [
            {
              id: "r8l2vpxwmh",
              title: `🔗 Links disponibilizados`,
              text: '',
              children: [] 
            }
          ];
  
          // Loop para processar cada link da lista de links
          links.forEach(link => {
  
            const id_rnd = `r8l2vpxwmh_${Math.floor(Math.random() * 9000) + 1000}`;
  
            linksProcessados[0].children.push({
              id: id_rnd,
              title: link,  // Agora o link é um valor direto (não é mais um array)
              text: '',
              children: [] // O array 'children' de cada evento ainda pode ser usado se necessário
            });
            });
        }
    } catch (error) {
      console.log( `Provavelmente não há links disponibilizados`, error)
    }
    */
  
    // Agora 'linksProcessados' contém todos os links formatados
    ; // Não precisa mais de JSON.stringify aqui, a variável já é um objeto
    //console.log("linksProcessados", linksProcessados);
  
  
  
    const formResult = result_form.results || [];
  
    console.log(`Resultado do SELECT * FROM wpp_forms_saved WHERE token = ${token} `, result_form.results);
  
    if (formResult.length > 0) {
      _menuFormulario = [
        {
          "id": "b2r3xpfrm",
          "title": "🧾 Formulário...",
          "text": `📖 Olá, clique abaixo para selecionar o formulário.\nAgradecemos a sua resposta. \nClique em *_Selecione abaixo_*`,
          "children": [],
        }
      ];
  
      const chaveKV = `${phone}_${setup_data.app_key}`;
      /*
      formResult.forEach(forms => {
        console.log(`Formulário: ${forms.nome} - ${forms.descricao}`, forms);
        _menuFormulario[0].children.push({
          id: String(forms.id).substring(0, 7),
          title: `📖 Poderia me ajudar responder sobre ${forms.descricao || "Formulário "}`,
          text: forms.descricao || "Por gentileza, responda os questionamentos. Obrigado.",
          children: forms.campos,
        });
        //console.log(chaveKV, forms.campos)
        //env.Forms_KV.put(chaveKV, forms.campos )
        console.log(`Formulário: ${forms.nome} - ${forms.descricao}: `, _menuFormulario);
      });
      */
  
      formResult.forEach(forms => {
        //        console.log(`Formulário: ${forms.nome} - ${forms.descricao}`, forms);
  
        // Parse da string JSON para array/objeto JS
        let camposObj = [];
        try {
          camposObj = JSON.parse(forms.campos);
  
        } catch (err) {
          console.log("Erro ao fazer parse do campo 'campos':", err);
        }
  
        _menuFormulario[0].children.push({
          id: String(forms.id),
          title: `📖 Visualizar e responder: ${forms.nome}`,
          text: forms.descricao || "Por gentileza, responda os questionamentos. Obrigado.",
          children: [camposObj],  // já em formato objeto/array, não string
        });
        

        //       console.log(`Formulário: _menuFormulario : ${forms.nome} - ${forms.descricao}: `, _menuFormulario);
      });
  
  
  
  
  
      //      console.log("Formulários carregados e adicionados ao menu.", _menuFormulario);
  
    } else {
      console.log("Nenhum formulário encontrado para o token fornecido.");
    }
  
    let _menuEspecialista = []
     
      //const inst_resp = await get_assistant(setup_data.Assistant_ID)
      //const have_instructions = ((inst_resp.instructions || '').trim() !== '')
  
     if (setup_data.have_instructions) {
      _menuEspecialista = [
      {
        "id": "b2r3xpedf",
        "title": "🤖 Clique aqui para saber tudo 😉",
        "description": "Pergunte-me, o que quer saber ?",
        "text": `🤖✨ Você está sendo atendido(a) por uma _inteligência artificial especializada_, treinada para oferecer respostas rápidas, precisas e personalizadas, como se estivesse conversando com um dos nossos especialistas reais! 🎯\n\n💡 _Quer sair deste modo?_\nDigite _*Menu*_ e envie a mensagem 👇 que retornaremos ao início.\n\n *Faça qualquer pergunta que tentarei te ajudar:*`,
        "children": []
      }];
    }
    
    const _menuIdentif = [
      {
        "id": "r8l2vpxdr",
        "title": `🔐 Area Restrita 🔐`,  //🪪
        "text": "Informe o seu *CPF* ou *CNPJ* (_somente numeros: ex.:_)\n_CPF: 12345678990_\n_ou_\n_CNPJ: 11222333000199_",
        "children": []
      }
    ];
    const _menuIdentif_wait = [
      {
        "id": "r8l2vpxwm",
        "title": `🔐 (aguardando liberação) 🔐`,  //🪪
  
        "text": (setup_data.cnpj.nome ? `${senderName}, aguarde até que seja liberado o seu CNPJ informado:\n\n\`${setup_data.cnpj.nome}\`\n\`CNAE: ${setup_data.cnpj.atividade_principal[0].text}\`\n\`Situação: ${setup_data.cnpj.situacao}\`\n\`Email: ${setup_data.cnpj.email}\`\n\`Status: ${setup_data.cnpj.status}\`\n\`Abertura: ${setup_data.cnpj.abertura}\`\n\`CNPJ: ${setup_data.cnpj.cnpj}\`` : `${senderName}, aguarde até que seja liberado o seu CPF/CNPJ informado \`${setup_data.visitante_cpf_cnpj}\``),
        "children": []
      }
    ];
  
  
  
    //    console.log(`phone: ${phone}, M: ${message}, ${senderName}, token: ${token}`);
    const storedMenuItems = JSON.parse(storedMenuItems_)
    let storedMenu
    if (storedMenuItems && storedMenuItems.items) {
      // console.log("storedMenuItems", storedMenuItems );
      storedMenu = storedMenuItems.items;
    } else {
      storedMenu = storedMenuItems;
    }
  
  
    //console.log("storedMenu", storedMenu );
  
    if (!storedMenu) {
      const jBody = JSON.stringify({
        phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone,
        isLid: setup_data.isLid,
        message: "Menu não configurado", 
        options: { markIsRead: false} ,
        delayMessage: "1"
      });
      //Nao precisa informar o cliente que o menu não está configurado
     // await wpp.sendZapiResponse(phone, jBody, 'send-message', setup_data, env);
      console.log("Menu não encontrato");
      return new Response('Menu não encontrato', { status: 200 });
      
    }
  
    //let menu_base = JSON.parse(storedMenu);
    let menu_base = storedMenu
    if (_menu_disponibilidades.length > 0) {
      //      console.log("_menu_disponibilidades",_menu_disponibilidades )
      menu_base = [...menu_base, ..._menu_disponibilidades]
    }
    if (_menu_atendentes.length > 0) {
      //      console.log("_menu_atendentes",_menu_atendentes )
      menu_base = [...menu_base, ..._menu_atendentes]
    }
    if (_menuFormulario.length > 0) {
      //      console.log("_menuFormulario",_menuFormulario )
      menu_base = [...menu_base, ..._menuFormulario]
    }
    let menu_tmp = [];
    let tituloParaExcluir = `🔐 Area Restrita 🔐`;
    let ligaBot = setup_data.liga_desl_bot
  
    // ATENCAO::: Mesmo tirando a etiqueta do contato, permanece na mensagem inicial (original).Nao identificado o motivo. Retirando o tratamento
    if (false && (setup_data.etiquetas.includes(":AI:") || setup_data.etiquetas.includes(":IA:"))) {
      menu_base = [..._menuEspecialista] // Quem está etiquetado no whatsapp para ser atendido exclusivamente por Intel.Artif.
    } else {
      // Título do item que você deseja excluir
      if (ligaBot === 1) {
        menu_base = [..._menuEspecialista, ...menu_base]
      }
    }
  
  
    //Verifica se o contato tem a etiqueta "AI:" para responsta pelo GPT automaticamente:
    menu_arearestrita = menu_base.filter(item => item.title.toLowerCase() === tituloParaExcluir.toLowerCase());  // Obter somente a area restrita
  
    /*
        {
          "whatsapp": "5511992076486",
          "Origem": {
            "Informado": ["5511988704877", "5511986169001"],
            "Teste": ["5511986169000"]
          }
        }
    */
  
  
        try {
          if (menu_arearestrita.length > 0) {
  
            menu_arearestrita[0].text = `Olá ${setup_data.visitante_nome || ""} 🤝\nOpções no qual você tem acesso. Selecione.`;
            // Acessando diretamente o primeiro item
            const areaRestrita = menu_arearestrita[0];  
            console.log( "areaRestrita Original: ", areaRestrita)
  
            // Se 'children' não é um array ou é undefined, inicializamos
            if (!Array.isArray(areaRestrita.children)) {
              areaRestrita.children = [];
            }
  
            const origens = await fn.listarNumerosPorOrigem(env.Whatsapp_Clients, setup_data.whatsapp);
            console.log( "Origens: ", origens)
  
            // 1. Identifica a origem do usuário (ex: "Equipe Interna")
            let origemDoUsuario = null;
            Object.entries(origens.Origem).forEach(([origem, contatos]) => {
              if (contatos.includes(phone)) {
                origemDoUsuario = origem;
              }
            });
            
            // 2. Filtra o array 'children' para manter somente a origem do usuário
            //    e os links processados (que não possuem a propriedade 'contatos').
            areaRestrita.children = areaRestrita.children.filter(item => {
                // Mantém as opções de menu que correspondem à origem do usuário
                const eOpcaoDeMenu = item.title && item.title === origemDoUsuario;
                // Mantém os links processados, que não têm a propriedade 'title' ou 'contatos'
                const eLinkProcessado = !item.title && !item.contatos;
                return eOpcaoDeMenu || eLinkProcessado;
            });
  
            // 3. Adiciona os links processados ao menu filtrado.
            //    Isso garante que links gerais não associados a uma origem
            //    específica sejam sempre incluídos.
            if (linksProcessados.length > 0) {
              areaRestrita.children.push(...linksProcessados);
            }
  
            console.log( "areaRestrita filtrada: ", areaRestrita)
          }
        } catch (error) {
          const err = await error.json
          console.log( `Erro: `, err )
        }
  
    menu_tmp = menu_base.filter(item => item.title.toLowerCase() !== tituloParaExcluir.toLowerCase());
  
    // Removendo agora, mas necessario colocar no whatsapp_setup parametro se liga ou não area restrita.
    if (setup_data.visitante_existente && setup_data.visitante_blocked) {
      menu_tmp = [...menu_tmp, ..._menuIdentif_wait]
    } else if (setup_data.visitante_existente && !setup_data.visitante_blocked) {
      menu_tmp = [...menu_tmp, ...menu_arearestrita]
  
    } else if (!setup_data.visitante_existente) {
      menu_tmp = [...menu_tmp, ..._menuIdentif]    // Removendo agora, mas necessario colocar no whatsapp_setup parametro se liga ou não area restrita.
  
    }
  
  
    // console.log( `menu_tmp:  Visitante: visitante_existente = ${setup_data.visitante_existente} - visitante_blocked = ${setup_data.visitante_blocked} `, menu_tmp)
  
  
    menu_base = menu_tmp;
  
  
    // Função auxiliar para encontrar um item no menu
    const findMenuItem = (items, message) => {
      for (const item of items) {
        if (item.title === message) return item;
        if (Array.isArray(item.children) && item.children.length > 0) {
          //console.log( `${message}`, item );
          const found = findMenuItem(item.children, message);
          if (found) {
            console.log("return found:", found)
            return found;
          }
  
        }
      }
      return null;
    };
  
  
    // Função para enviar mensagem via API
    const sendMessage = async (content, type = 'send-message') => {
      //      console.log( "sendMessage", content)
      const jBody = JSON.stringify({
        phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone,
        isLid: setup_data.isLid,
        message: content.replace("🔔🔔", "").replace("🤖🤖", ""), 
        options: { markIsRead: false} ,
        delayMessage: "1"
      });
      console.log("No menu, entrando em sendZapiResponse", jBody)
      await wpp.sendZapiResponse(phone, jBody, type, setup_data, env);
      return new Response('Mensagem enviada com sucesso', { status: 200 });
    };
  
  
  
  
    const sendMessageV2 = async (content) => {
                console.log( "entrou em sendMessageV2",content )
      const jBody = JSON.stringify({
        phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone,
        isGroup: false,
        isLid: setup_data.isLid,
        //se houver um 🔔🔔  (2 sinos), envia uma notificação para o admin. (quem tem o ntfy instalado e participando do tópido (Token))
        description: content.replace("🔔🔔", "").replace("🤖🤖", ""),
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
  
      //          console.log("jBody em sendMessageV2 ", jBody)
      await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
  
      if (content.includes("🔔🔔")) {
        const cTitulo = `WhatszAIp ${formata.formatarNumeroWhatsApp(setup_data.whatsappServer)}\n`
        const lastmessage = await env.whatsapp_lastmessage.get(`${setup_data.app_key}:${setup_data.phone}`) || ""
        const cTextNotify = `Contato: ${formata.formatarNumeroWhatsApp(phone)}\nNome: ${setup_data.senderName}\nSolicita ou Informa:\n${lastmessage}`; // setup_data.lastmessage // content.replace("🔔🔔", "") 
        //Avisar o admin via NTFY app para o tópico (token)
        //            console.log(`Chamando a funçao para notificação: sendNotification(${phone}, ${token}) `)
        const ret = await fn.sendNotification(phone, token, cTextNotify, cTitulo, setup_data.photo)
  
      }
  
      if (content.includes("🤖🤖")) {
        console.log( "No corpo da mensagem enviada, tem 🤖🤖, logo ligando a IA")
        //Enviando a notificação para os envolvidos ( NTFY )
        const cTitulo = `WhatszAIp ${formata.formatarNumeroWhatsApp(setup_data.whatsappServer)}\n`
        const lastmessage = await env.whatsapp_lastmessage.get(`${setup_data.app_key}:${setup_data.phone}`) || ""
        const cTextNotify = `Contato: ${formata.formatarNumeroWhatsApp(phone)}\nNome: ${setup_data.senderName}\nSolicita ou Informa:\n${lastmessage}`; // setup_data.lastmessage // content.replace("🔔🔔", "") 
        //Avisar o admin via NTFY app para o tópico (token)
        //              console.log(`Chamando a funçao para notificação: sendNotification(${phone}, ${token}) `)
        const ret = await fn.sendNotification(phone, token, cTextNotify, cTitulo, setup_data.photo)
  
        //Abrindo IA para responder o proximo texto do sender
        await fn.whatsapp_liga_desl_GPT("1", `${phone}_${setup_data.app_key}`, env);
      }
  
      if ((content.includes("🤗🤗") || content.includes("🏕️🏕️"))) {
        //Fechando a IA para responder o proximo texto do sender
        await fn.whatsapp_liga_desl_GPT("0", `${phone}_${setup_data.app_key}`, env);
      }
  
      if (content.startsWith("🎤")) {
        const text = `Oi ${setup_data.senderName}, tudo bem? ` + content.replace("🎤", "")
        const midiasEncontradas = []
        //              console.log( "Text_to_Speech", text )
        const ret = await ia.Text_to_Speech(text, phone, setup_data, env, midiasEncontradas, '', false)
  
      }
  
      //if (content === "")
  
      return new Response('Mensagem enviada com sucesso', { status: 200 });
    };
  
  
    // Processar mensagens do menu
    // Bom dia!, Olá! Tudo bem? .... 
    //    console.log("No menu, entrando em sendMessage" , menu_base )
    //
    setup_data.wellcome_menu.replace(",", "|")
  
    /*
      console.log(`No menu, entrando em sendMessage (message: ${message})` , setup_data.wellcome_menu
      .toLowerCase()
      .split('|')                    // Divide o menu por vírgulas
      .some(keyword => 
        message.trim().toLowerCase() === keyword.trim().toLowerCase() // Compara diretamente
      ) )
    */
  
  
  
    if (
      // Verifica se a mensagem tem apenas uma palavra e a palavra faz parte do menu
      (message.trim().toLowerCase().split(/\s+/).length === 1 &&
        setup_data.wellcome_menu
          .toLowerCase()                // Converte o menu para minúsculas
          .split('|')                    // Divide o menu por vírgulas
          .some(keyword => message
            .toLowerCase()               // Converte a 'message' para minúsculas
            .includes(keyword.trim())    // Verifica se a palavra aparece na mensagem, após remoção de espaços extras
          )
      ) ||
      // Verifica se a mensagem contém uma frase composta exata do menu e não há mais palavras após a frase
      setup_data.wellcome_menu
        .toLowerCase()
        .split('|')                    // Divide o menu por vírgulas
        .some(keyword =>
          message.trim().toLowerCase() === keyword.trim().toLowerCase() // Compara diretamente
        ) ||
      message.trim().toLowerCase() === '⏮️ voltar ao menu' // Caso especial de "voltar ao menu"
    ) {
  
      //  if ((message.trim().toLowerCase().split(/\s+/).length === 1 &&  message.trim().toLowerCase() === "menu") || message.trim().toLowerCase() === '⏮️ voltar ao menu') {
  
      //Se a pessoa chamou o menu ou palavras de inicio de conversa, desliga o WhatsappAI se ativado
  
  
      console.log(` Entrou menu: Tipo GPT para: ${phone}_${setup_data.app_key}`)
      await fn.whatsapp_liga_desl_GPT("0", `${phone}_${setup_data.app_key}`, env);
  
      // Criar lista de opções do menu principal
      const options = menu_base.map(item => ({
        rowId: item.id,
        title: item.title,
        description: ""
      }));
  
      let descMenu = ""
      if (setup_data.textoMenuPrincipal) {
        descMenu = setup_data.textoMenuPrincipal.replace('[nomeContato]', senderName).replace('[nomeEmpresa]', setup_data.nome_fantasia)
      } else {
        descMenu = `\n👩‍🦰 Olá ${senderName} !\n\n😃 Somos *${setup_data.nome_fantasia}*\n\n_Para mostrar esta mensagem novamente, envie:_\n*_Menu_*\n\n👩‍🦰 *Informe abaixo como podemos te ajudar* 👇`
      }
  
  
      const jBody = JSON.stringify({
        phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone,
        isGroup: false,
        isLid: setup_data.isLid,
        description: descMenu,
        buttonText: "✨Selecione uma opção✨",
        sections: [
          {
            title: "🙎‍♀️ O que gostaria de saber?",
            rows: options // Aqui você passa diretamente as opções
          }
        ], 
        options: { markIsRead: false} ,
        delayMessage: "1"
      });
      await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
      return new Response('Menu enviado com sucesso', { status: 200 });
    }
  
  
    // Procurar item selecionado no menu
    const selectedItem = findMenuItem(menu_base, message);
  
    if (selectedItem) {
      if (selectedItem.children.length > 0) {
        // É um submenu (option-list)
  
        const options = selectedItem.children.map(child => ({
          rowId: child.id,
          title: child.title,
          description: ""
        }));
  
        // Adiciona a opção "Voltar ao menu" ao final do array options
        options.push({
          rowId: '⏮️ Voltar ao Menu',
          title: '⏮️ Voltar ao Menu',
          description: ''
        });
  
  
        if (selectedItem && selectedItem.text.startsWith("📖")) {     // Escolhendo formulários
  
          //const Form_escolhido_filhos = selectedItem.children[0].children;
          //console.log("selectedItem do formulario", selectedItem)
  
          const formDefinitionForAI = selectedItem.children[0].children;
          console.log("formDefinitionForAI", formDefinitionForAI )
          // Verificação de segurança (opcional, mas recomendado):
          if (Array.isArray(formDefinitionForAI) && formDefinitionForAI.length > 0) {
          ///if (formDefinitionForAI && Object.keys(formDefinitionForAI).length > 0) {
            const formDefinitionString = JSON.stringify(formDefinitionForAI);
            const payloadToSave = {
              rowId: selectedItem.children[0].id,
              formDefinition: formDefinitionForAI
            };
          
            const chave = `${phone}_${setup_data.app_key}`;
            const ArrayPayload = JSON.stringify(payloadToSave);
            await env.Forms_KV.put(chave, ArrayPayload);
          
            console.log(`Formulário ${selectedItem.title} salvo no KV:`, payloadToSave);
  
            // 💡 Sugestão para melhorar a experiência do usuário:
            // Envie uma mensagem informando que o formulário foi iniciado.
            // Isso é opcional e não afeta outras funcionalidades.
            //const firstQuestion = formDefinitionForAI[0]?.label || "Qual é a sua primeira informação?";
            //await wpp.sendZapiResponse(phone, JSON.stringify({ message: `Vamos iniciar o formulário de "${selectedItem.title.replace('📖 Clique aqui para 👇 \n', '')}". Para começar, ${firstQuestion}` }), 'send-message', setup_data, env);
            await fn.whatsapp_liga_desl_GPT("2", `${phone}_${setup_data.app_key}`, env); // Ativa o modo formulário
  

            // a partir de agora, qualquer resposa é para o formulário.

          } else {
            console.error("Erro: A definição do formulário selecionado está vazia ou não é um array.");
            await wpp.sendZapiResponse(phone, JSON.stringify({ isLid: setup_data.isLid, message: "Desculpe, houve um problema ao carregar este formulário. Por favor, tente novamente ou escolha outra opção.", options: { markIsRead: false}  }), 'send-message', setup_data, env);
          }
          /*
          console.log("Form_escolhido_filhos:: Options do menu ", options);
          const filhosStr = JSON.stringify(Form_escolhido_filhos);
          await env.Forms_KV.put(`${phone}_${setup_data.app_key}`, filhosStr);
          console.log(`formulário:  ${phone}_${setup_data.app_key}`, filhosStr )
          await fn.whatsapp_liga_desl_GPT( "2", `${phone}_${setup_data.app_key}`, env);   // <<<==== ATIVA O MODO FORMULÁRIO 
          */
        }
  
  
        const jBody = JSON.stringify({
          phone: setup_data.isLid ? setup_data.chatLid : setup_data.phone,
          isGroup: false,
          isLid: setup_data.isLid,
          description: selectedItem.text || `Selecione uma opção em ${selectedItem.title}:`,
          buttonText: "👉 Selecione 👈",
          sections: [
            {
              title: selectedItem.title,
              rows: options
            }], 
          options: { markIsRead: false} ,
          delayMessage: "1"
        });
  
        await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
      } else {
  
        // >>>>> aqui é o trecho onde o usuario selecionou o item do menu ( Item selecionado )<<<<<
        // É um item final (text)
        // Gravar ultima mensagem automática respondida
  
        await sendMessageV2(selectedItem.text);
  
        const datahora = new Date(new Date().getTime() - (3 * 60 * 60 * 1000)).toISOString()
        const insquery = `  Insert into wpp_menu_stats ( token, phone , item , id , data )
                                Values ( ?, ?, ?, ?, ?);
            `;
        const insresult = await env.db.prepare(insquery).bind(token, phone, selectedItem.title, selectedItem.id, datahora).run();
  
        //          console.log( "sendMessageV2(selectedItem.id)", selectedItem.id )
  
  
        //Verificando se deve ser atendido por um setor, mas se já estiver um setor  assinalado, exclui e cria um novo KV
        //const kv_setores = await env.MENU_STORAGE.get(`setor:${token}`);
  
  
  
        // verifica se o usuario selecionou algum atendente para um chamado
        let chamadoProt = await chamados.fn_verifica_se_abre_chamado('abre', selectedItem.id, phone, selectedItem.text, token, env)
        setup_data.chamado_aberto = chamadoProt
        if (setup_data.chamado_aberto) {
          //              console.log( `Chamado aberto: ${chamadoProt}` )
        }
  
        if (selectedItem.text === '🔐 Area Restrita 🔐') {
          //            console.log( `Entrando no modo [ 🔐 Area Restrita 🔐 ]` ) 
  
        }
  
        console.log("selectedItem.text =======>>. ", selectedItem.text)
  
  
        if (selectedItem.text === `👩‍💻 Enviar dados p/ atendente\nEnviar os dados para um atendente`) {
          await fn.whatsapp_liga_desl_GPT("0", `${phone}_${setup_data.app_key}`, env);
          console.log(`👩‍💻 Enviar dados p/ atendente`)
  
        }
  
        console.log("Selecionado o item: ", selectedItem.text)
      }
  
  
  
      return new Response('Opção processada com sucesso', { status: 200 });
    }
  
    return new Response('Mensagem não reconhecida', { status: 200 });
  }
  

  
