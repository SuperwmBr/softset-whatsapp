

import * as wpp from './wppconnect.js';


export async function fn_verifica_se_abre_chamado(tipo, wpp_atendente, wpp_usuario, protocolo, token, env) {

    const query = `
    SELECT id, nome || IFNULL(' [' || setor || ']', '') AS name, whatsapp
    FROM whatsapp_atendentes_setores
    WHERE token = ? and whatsapp = ?
    ORDER BY nome;
    `;
    const result = await env.db.prepare(query).bind(token, wpp_atendente).all();
    console.log(`Retorno de whatsapp_atendentes_setores: [${result.results.length}]`, result.results[0])
  
    // Se o ID do menu foi de um atendente, prossegue
    if (result.results.length > 0) {
  
      const regex = /🎫\s*Seu\s*protocolo\s*de\s*atendimento:\s*(\d{10,12})/;
      const match = protocolo.match(regex);
      let protocolo_id = null;
  
      if (match && match[1]) {
        protocolo_id = match[1];
      } else {
        console.warn(`[fn_verifica_se_abre_chamado] Protocolo não encontrado na string fornecida: ${protocolo}`);
        return '';
      }
  
      const protocol_map_key = `protocol:${protocolo_id}:${token}`;
      const active_protocol_for_client_key = `active_protocol_for_client:${wpp_usuario}:${token}`;
  
      // Armazena o mapeamento principal do protocolo (cliente <-> atendente)
      const protocol_map_value = JSON.stringify({
        client_phone: wpp_usuario,
        attendant_phone: wpp_atendente
      });
      await env.whatsapp_chathook.put(protocol_map_key, protocol_map_value);
      console.log(`[fn_verifica_se_abre_chamado] Protocolo ${protocolo_id} mapeado: Cliente=${wpp_usuario}, Atendente=${wpp_atendente}.`);
  
      // Cria/Atualiza a chave auxiliar para o cliente, indicando seu protocolo ativo
      await env.whatsapp_chathook.put(active_protocol_for_client_key, protocolo_id);
      console.log(`[fn_verifica_se_abre_chamado] Chave auxiliar criada/atualizada para cliente ${wpp_usuario} com protocolo ${protocolo_id}.`);
  
      return protocolo_id;
    } else {
      console.warn(`[fn_verifica_se_abre_chamado] O telefone ${wpp_atendente} não é um atendente válido para o token ${token}.`);
      return '';
    }
  }
  
  
export async function fn_encerraProtocolo(phone_requester, paranToken, setup_data, env, quem_solicitou, explicit_protocol_id) {
    if (!explicit_protocol_id) {
      console.warn(`[fn_encerraProtocolo] Chamada para encerramento sem um 'explicit_protocol_id'. Nenhuma ação de encerramento será realizada.`);
      return;
    }
  
    const protocol_to_terminate = explicit_protocol_id;
    const protocol_map_key = `protocol:${protocol_to_terminate}:${paranToken}`;
  
    let client_phone = null;
    let attendant_phone = null;
  
    // 1. Tenta obter o mapeamento principal do protocolo
    const protocol_map_data = await env.whatsapp_chathook.get(protocol_map_key);
  
    if (protocol_map_data) {
      const map_info = JSON.parse(protocol_map_data);
      client_phone = map_info.client_phone;
      attendant_phone = map_info.attendant_phone;
      console.log(`[fn_encerraProtocolo] Mapeamento encontrado para protocolo ${protocol_to_terminate}: Cliente=${client_phone}, Atendente=${attendant_phone}.`);
  
      // Excluir a chave principal do protocolo
      const delete_protocol_map_kv_success = await env.whatsapp_chathook.delete(protocol_map_key);
      console.log(`[fn_encerraProtocolo] Status exclusão (P${protocol_to_terminate}): protocol_map=${delete_protocol_map_kv_success}.`);
  
    } else {
      console.warn(`[fn_encerraProtocolo] Nenhum mapeamento 'protocol:${protocol_to_terminate}:${paranToken}' encontrado. O chamado pode já ter sido encerrado ou o ID é inválido.`);
      // Se o mapeamento principal não foi encontrado, tenta deduzir o `client_phone`
      // para tentar limpar a chave auxiliar.
      if (quem_solicitou === "usuario" && phone_requester) {
        client_phone = phone_requester; // Se o próprio usuário pediu para encerrar, ele é o cliente
      }
      // Não temos como determinar o `attendant_phone` confiavelmente sem o mapeamento.
    }
  
    // 2. Tenta excluir a chave auxiliar `active_protocol_for_client` se o `client_phone` for conhecido.
    // Esta parte é movida para fora do `if (protocol_map_data)` para garantir que a limpeza ocorra.
    if (client_phone) {
      const active_protocol_for_client_key = `active_protocol_for_client:${client_phone}:${paranToken}`;
      const delete_active_client_kv_success = await env.whatsapp_chathook.delete(active_protocol_for_client_key);
      console.log(`[fn_encerraProtocolo] Status exclusão (P${protocol_to_terminate}): active_protocol_for_client=${delete_active_client_kv_success}.`);
    } else {
      console.warn(`[fn_encerraProtocolo] Não foi possível determinar o telefone do cliente para limpar a chave 'active_protocol_for_client'.`);
    }
  
    // Se, após todas as tentativas, ainda não temos telefones para notificação, encerra.
    if (!client_phone && !attendant_phone) {
      console.warn(`[fn_encerraProtocolo] Sem mapeamento e sem telefones para notificação para protocolo ${protocol_to_terminate}. Encerrando execução.`);
      return;
    }
  
    // 3. Enviar mensagens de notificação (apenas se temos os telefones)
    let message_to_client = "";
    let message_to_attendant = "";
  
    if (quem_solicitou === "usuario") {
      message_to_client = `🎫 Protocolo: ${protocol_to_terminate}\n\n📝 Mensagem:\n*Você encerrou o protocolo. Agradecemos!*`;
      message_to_attendant = `🎫 Protocolo: ${protocol_to_terminate}\n👤 Cliente: ${client_phone || 'Desconhecido'}\n\n📝 Mensagem:\n*O cliente ${client_phone || 'Desconhecido'} encerrou o protocolo com sucesso.*`;
    } else if (quem_solicitou === "atendente") {
      message_to_client = `🎫 Protocolo: ${protocol_to_terminate}\n👤 Atendente: ${attendant_phone || 'Desconhecido'}\n\n📝 Mensagem:\n*Você encerrou o protocolo com sucesso.*`;
      message_to_attendant = `🎫 Protocolo: ${protocol_to_terminate}\n\n📝 Mensagem:\n*Você encerrou o protocolo. Agradecemos!*`;
    } else {
      message_to_client = `🎫 Protocolo: ${protocol_to_terminate}\n\n📝 Mensagem:\n*O chamado foi encerrado. Agradecemos!*`;
      message_to_attendant = `🎫 Protocolo: ${protocol_to_terminate}\n\n📝 Mensagem:\n*O chamado foi encerrado.*`;
    }
  
    if (client_phone) {
      await wpp.sendZapiResponse(client_phone, JSON.stringify({ "phone": client_phone, "message": message_to_client, 
      options: { markIsRead: false} , "delayMessage": "1" }), 'send-message', setup_data, env);
    } else {
      console.warn(`[fn_encerraProtocolo] Não foi possível enviar notificação ao cliente pois o telefone não foi determinado.`);
    }
  
    if (attendant_phone) {
      await wpp.sendZapiResponse(attendant_phone, JSON.stringify({ "phone": attendant_phone, "message": message_to_attendant, 
      options: { markIsRead: false} , "delayMessage": "1" }), 'send-message', setup_data, env);
    } else {
      console.warn(`[fn_encerraProtocolo] Não foi possível enviar notificação ao atendente pois o telefone não foi determinado.`);
    }
  
    console.log(`[fn_encerraProtocolo] Processamento de encerramento para protocolo ${protocol_to_terminate} concluído. Solicitado por ${quem_solicitou}.`);
  }
  
