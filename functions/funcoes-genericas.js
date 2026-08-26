
export async function whatsapp_liga_desl_GPT(novoValor, chave, env) {
  
    // Tenta obter o valor atual da chave no armazenamento KV
    try {
      const valorAtual = await env.Whatsapp_chatgpt.get(chave);
      
      // Se o novoValor for null, a função apenas retorna o valor atual (pode ser null se a chave não existir)
      if (novoValor === null) {
        console.log(`Função whatsapp_liga_desl_GPT('${chave}') retornando =>`, valorAtual);
        return valorAtual;
      }
      
      // Se o valor atual for diferente do novo valor, atualiza a chave
      if (valorAtual !== novoValor) {
        await env.Whatsapp_chatgpt.put(chave, novoValor, { expirationTtl: 7200 });
        console.log(`Função whatsapp_liga_desl_GPT('${chave}') => valor atualizado para ${novoValor}`);
      } else {
        console.log(`Função whatsapp_liga_desl_GPT('${chave}') => valor inalterado (${novoValor})`);
      }
  
    } catch (error) {
      // Caso ocorra um erro (geralmente porque a chave não existe), cria uma nova chave.
      // Esta parte do código garante que a função funcione mesmo se a chave não tiver sido criada.
      console.log(`ERRO na leitura! Chave '${chave}' não encontrada ou outro erro. Criando...`);
      await env.Whatsapp_chatgpt.put(chave, novoValor, { expirationTtl: 7200 });
      console.log(`Função whatsapp_liga_desl_GPT('${chave}') => valor criado com ${novoValor}`);
    }
  }

  
export async function sendNotification(phone, token, cTextNotify, cTitulo, photo) {

    // --- CORREÇÃO APLICADA AQUI ---
    // Garante que o título seja uma única linha, removendo quaisquer quebras de linha.
    const cleanedTitulo = (cTitulo || "WhatszAIp") //.replace(/(\r\n|\n|\r)/gm, " ");
  
    const headers_ = {
      // Usamos o título "limpo" para evitar o erro.
      'Title': cleanedTitulo,
      'Content-Type': 'text/plain; charset=utf-8',
      // Usar 'undefined' é a forma mais limpa de omitir um cabeçalho se a condição for falsa.
      'Actions': photo ? `view, Avatar, ${photo}` : undefined
    };
  
    const body = cTextNotify;
  
    //console.log("Enviando notificação com os seguintes dados:");
    //console.log("Body:", body);
    //console.log("Headers:", headers_);
  
    try {
      const response_ntfy = await fetch(`https://ntfy.sh/${token}`, {
        method: 'POST',
        headers: headers_,
        body: body
      });
  
      // Tratamento de erros de resposta HTTP (ex: 400, 404, 500)
      if (!response_ntfy.ok) {
        console.error(`Erro ao enviar notificação: ${response_ntfy.status} ${response_ntfy.statusText}`);
        const errorBody = await response_ntfy.text();
        console.error(`Corpo do Erro retornado pelo ntfy: ${errorBody}`);
        return null;
      }
  
      const rest = await response_ntfy.json();
      //console.log("Retorno de SendNotification:", rest);
      return rest;
  
    } catch (error) {
      // Tratamento de erros de rede ou falhas na própria requisição fetch.
      // O seu erro "TypeError" seria capturado aqui.
      console.error("Falha na requisição fetch para o ntfy.sh:", error.message);
      return null;
    }
  }
  
  
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const length = bytes.length;
  
    for (let i = 0; i < length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
  
    return btoa(binary); // btoa() converte a string binária para Base64
  }
  


export async function sha256(str) {
    const textEncoder = new TextEncoder();
    const data = textEncoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256Hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return sha256Hash;
  }
  
  

// Função para ler os dados do cliente da KV Store
export async function getClientData(key, env) {
    // Lê os dados da KV Store como JSON
    let currentData = await env.Whatsapp_Clients.get(key, { type: 'json' });
  
    // Se os dados não existirem, retorna uma resposta indicando erro
    if (!currentData) {
      return { success: false, data: {} };
    }
  
    // Verifica se já tem os dados da API da ReceitaWS armazenados
    if (!currentData.cnpj || Object.keys(currentData.cnpj).length === 0) {
      // Extrai CNPJ do CPF/CNPJ do cliente
      const supostoCNPJ = extrairCpfCnpj(currentData.cpf_cnpj);
      console.log("getClientData >> supostoCNPJ", supostoCNPJ);
  
      if (supostoCNPJ.tipo === "CNPJ") {
        // Faz a requisição para a API da ReceitaWS
        const CNPJResponse = await fetch(`https://www.receitaws.com.br/v1/cnpj/${supostoCNPJ.numero}`);
  
        if (!CNPJResponse.ok) {
          console.error(`Erro ao buscar CNPJ ${supostoCNPJ.numero}: ${CNPJResponse.status}`);
          // Retorna os dados básicos sem cnpj detalhado
          return { success: true, data: currentData };
        }
  
        // Converte a resposta para JSON
        const cnpjd = await CNPJResponse.json();
  
        // Monta o objeto cnpjData conforme o retorno esperado
        const cnpjData = {
          nome: cnpjd.nome || "",
          abertura: cnpjd.abertura || "",
          situacao: cnpjd.situacao || "",
          email: cnpjd.email || "",
          atividade_principal: cnpjd.atividade_principal || [],
          cnpj: cnpjd.cnpj || "",
          status: cnpjd.status || "",
        };
  
        // Atualiza o currentData incluindo os dados da API no campo "cnpj"
        currentData.cnpj = cnpjData;
  
        // Salva o objeto atualizado na KV (serializando)
        try {
          await env.Whatsapp_Clients.put(key, JSON.stringify(currentData));
          console.log(`getClientData >> dados da API adicionados e salvos na chave ${key}`);
        } catch (e) {
          console.error("Erro ao salvar dados atualizados na KV:", e);
        }
      }
    } else {
      //console.log("getClientData >> dados da API já presentes no KV");
    }
  
    // Retorna os dados atuais (com ou sem dados da API)
    return { success: true, data: currentData };
  }
  
  
  
  
  // Função para atualizar os dados do cliente e gravar no KV Store
  export async function updateClientData(whatsapp, newData, env) {
    // Construção da chave para a KV Store
    const key = whatsapp;
  
    // Lê os dados da KV Store
    let currentData = await env.Whatsapp_Clients.get(key, { type: 'json' });
    // Se os dados não existirem, inicializa o currentData com um objeto vazio
    if (!currentData) {
      currentData = {}; // Inicializa um objeto vazio
    }
  
    // Atualiza os dados com os novos valores (não sobrescreve campos ausentes)
    currentData.nome = newData.nome || currentData.nome;
    currentData.whatsapp = newData.whatsapp || currentData.whatsapp;
    currentData.cpf_cnpj = newData.cpf_cnpj || currentData.cpf_cnpj;
    currentData.origem = newData.origem || currentData.origem;
    currentData.data_hora_ult_msg = newData.data_hora_ult_msg || currentData.data_hora_ult_msg;
    currentData.blocked = newData.blocked || currentData.blocked;
  
  
  
    // Grava os dados atualizados na KV Store no formato JSON
    await env.Whatsapp_Clients.put(key, JSON.stringify(currentData));
    //console.log( "updateClientData: funcition: " , currentData);
    return { success: true, retorno: JSON.stringify(currentData) };
  }
  

// Função de validação de CPF
export function validarCPF(cpf) {
    cpf = cpf.replace(/[^\d]/g, ''); // Remove caracteres não numéricos
  
    if (cpf.length !== 11) {
      return false;
    }
  
    // Verifica se todos os dígitos são iguais (ex: "111.111.111-11")
    if (/^(\d)\1{10}$/.test(cpf)) {
      return false;
    }
  
    let soma = 0;
    let resto;
  
    // Validação do primeiro dígito verificador
    for (let i = 1; i <= 9; i++) {
      soma = soma + parseInt(cpf.substring(i - 1, i)) * (11 - i);
    }
    resto = (soma * 10) % 11;
  
    if ((resto === 10) || (resto === 11)) {
      resto = 0;
    }
    if (resto !== parseInt(cpf.substring(9, 10))) {
      return false;
    }
  
    soma = 0;
    // Validação do segundo dígito verificador
    for (let i = 1; i <= 10; i++) {
      soma = soma + parseInt(cpf.substring(i - 1, i)) * (12 - i);
    }
    resto = (soma * 10) % 11;
  
    if ((resto === 10) || (resto === 11)) {
      resto = 0;
    }
    if (resto !== parseInt(cpf.substring(10, 11))) {
      return false;
    }
  
    return true;
  }
  
  
  // Função de validação de CNPJ
  export function validarCNPJ(cnpj) {
    cnpj = cnpj.replace(/[^\d]/g, ''); // Remove caracteres não numéricos
  
    if (cnpj.length !== 14) {
      return false;
    }
  
    // Verifica se todos os dígitos são iguais (ex: "00.000.000/0000-00")
    if (/^(\d)\1{13}$/.test(cnpj)) {
      return false;
    }
  
    let tamanho = cnpj.length - 2;
    let numeros = cnpj.substring(0, tamanho);
    let digitos = cnpj.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
  
    // Validação do primeiro dígito verificador
    for (let i = tamanho; i >= 1; i--) {
      soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
      if (pos < 2) {
        pos = 9;
      }
    }
    let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado !== parseInt(digitos.charAt(0))) {
      return false;
    }
  
    tamanho = tamanho + 1;
    numeros = cnpj.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
  
    // Validação do segundo dígito verificador
    for (let i = tamanho; i >= 1; i--) {
      soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
      if (pos < 2) {
        pos = 9;
      }
    }
    resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado !== parseInt(digitos.charAt(1))) {
      return false;
    }
  
    return true;
  }
 
  export function extrairCpfCnpj(texto) {
    const numerosLimpos = texto.replace(/[^\d]/g, '');
  
    let numero = null;
    let tipo = null;
    let validado = false;
  
    // Tenta extrair e validar CPF (11 dígitos)
    if (numerosLimpos.length === 11) {
      numero = numerosLimpos;
      tipo = 'CPF';
      validado = validarCPF(numero);
    }
    // Tenta extrair e validar CNPJ (14 dígitos)
    else if (numerosLimpos.length === 14) {
      numero = numerosLimpos;
      tipo = 'CNPJ';
      validado = validarCNPJ(numero);
    }
  
    // Retorna o objeto JSON formatado
    return { numero, tipo, validado };
  }
  
  
  export function generateUUID() {
    return crypto.randomUUID().substring(0, 8);
    /*
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    */
  }
  

export async function listarNumerosPorOrigem(kv, whatsappNumber) {
    const resultado = {}; // Objeto para Origem
  
    // Listar todas as chaves que começam com o número fornecido
    let listComplete = await kv.list({ prefix: `${whatsappNumber}_`, limit: 1000 });
  
    // Paginação caso tenha mais de 1000 chaves
    while (listComplete.cursor) {
      const nextPage = await kv.list({ prefix: `${whatsappNumber}_`, limit: 1000, cursor: listComplete.cursor });
      listComplete.keys.push(...nextPage.keys);
      listComplete.cursor = nextPage.cursor;
    }
  
    // Buscar todos os valores em paralelo
    const promises = listComplete.keys.map(async (item) => {
      try {
        const valueStr = await kv.get(item.name);
        if (!valueStr) return null;
  
        const value = JSON.parse(valueStr);
        if (!value.origem) return null;
  
        const [, contato] = item.name.split('_');
        if (!contato) return null;
  
        return { origem: value.origem, contato };
      } catch (err) {
        console.error(`Erro ao processar chave ${item.name}:`, err);
        return null;
      }
    });
  
    const results = await Promise.all(promises);
  
    // Montar o resultado agrupando por origem
    results.forEach((item) => {
      if (!item) return;
  
      if (!resultado[item.origem]) {
        resultado[item.origem] = [];
      }
      resultado[item.origem].push(item.contato);
    });
  
    // Retornar no formato desejado
    return {
      whatsapp: whatsappNumber,
      Origem: resultado
    };
  }
  
  
