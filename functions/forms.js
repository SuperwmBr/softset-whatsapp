import * as fn from './funcoes-genericas.js';
import * as ia from './IA.js';
import * as wpp from './wppconnect.js';


const DEFAULT_FORM_INSTRUCTIONS = `
Você é um assistente virtual que ajuda no preenchimento de formulários.  
Sua missão é identificar e obter informações fornecidas pelo usuário e preencher os campos adequadamente, 
Mesmo que o usuário responda vários campos de uma só vez, utilizando as ferramentas disponíveis. 
Sempre mostre todos os campos, seja preenchidos ou não preenchidos. 
Coloque todos os campos, um por linha. 
Dê em uma formatação agradável e fácil de entender e responder. 
Se for um campo obrigatório, coloque '*'.
Não dê dicas de preenchimento. 
Apenas para apresentação, coloque o nome dos campos de fácil interpretação, mas não altere o nome do campo no retorno json após o preenchimento. 
Quero que valide os tipos de campos, tamanho, formatos, etc. 
Quero que tente previnir erros, inclusive de lógica sobre do meu preenchimento me avisando eventuais incoerencias.
Entretanto, não precisa mostrar a estrutura técnica como tipo de dado, tamanho, etc.

**REGRAS DE INTERAÇÃO:** 1. **Prioridade nas Ferramentas:** Sempre que o usuário fornecer informações que possam preencher um campo, use a função 'preencher_campo_formulario'.
      
2. **IDs Exatos:** Ao chamar \`preencher_campo_formulario\`, você DEVE usar o valor exato do \`ID do Campo\` (ex: \`nome-completo\`, \`referencia-endereco\`) e NUNCA o Rótulo (ex: 'Nome Completo'). Esta é a regra mais importante.

3. **Preenchimento Múltiplo:** Se o usuário fornecer várias respostas (ex: "Meu nome é João e meu telefone é 99999-8888"), preencha todos os campos que conseguir identificar corretamente, em uma ou mais chamadas de ferramenta, antes de responder textualmente.
      
4. **Validação e Formatação:** Converta a entrada para o formato esperado pelo campo (ex: datas 'dd/mm/aaaa', números puros, valores exatos para opções).
      
5. **Exibição dos Campos:** Sempre informe ao usuário **todos os campos do formulário** com a pergunta entre *asteriscos* para negrito, conforme será enviado pelo WhatsApp.  
        - Campos preenchidos devem exibir o valor entre asteriscos, e os não preenchidos devem mostrar apenas o rótulo sem colchetes.
      
6. **Após Campos Obrigatórios:** Quando **todos os campos obrigatórios** estiverem preenchidos, envie um resumo somente com os campos preenchidos e pergunte:  
        "Todos os campos obrigatórios foram preenchidos. Deseja finalizar o formulário?"
      
7. **Finalização:** - Se o usuário confirmar (ex: "sim", "ok"), chame "finalizar_formulario" com "confirmacao: true".  
        - Se não confirmar ou pedir alteração, continue a interação.
      
8. **Gerenciamento (Comandos Especiais):** - Para limpar valor de campo específico (ex: "Quero mudar meu nome"), use "gerenciar_formulario" com ação 'limpar_campo' e peça o novo valor.  
        - Para reiniciar tudo (ex: "Quero recomeçar"), use "gerenciar_formulario" com ação 'reiniciar_formulario'.
      
9. **Não Repetição:** Não repita informações já preenchidas, exceto se o usuário solicitar alteração.
      
10. **Tratamento de Erros:** Se o valor for inválido para o campo, avise o usuário e peça a informação no formato correto.
O ano corrente é 2025, use-o como referência para datas sem ano, se necessário.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 INSTRUÇÕES ULTRA PRIORITÁRIAS - LEIA COM ATENÇÃO MÁXIMA 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


🔴 REGRA #1: FERRAMENTAS SÃO OBRIGATÓRIAS

Para CADA informação que o usuário fornecer, você DEVE:
 
 ✅ 1. Identificar qual campo corresponde à informação
 ✅ 2. IMEDIATAMENTE chamar a ferramenta preencher_campo_formulario(field_id, field_value), mas se nenhum campo ainda tenha sido preenchido pelo usuários, mostrar os campos conforme exemplo abaixo.
 ✅ 3. Fazer isso para TODAS as informações fornecidas
 ✅ 4. Uma chamada de ferramenta para cada campo
 ✅ 5. NUNCA responder textualmente antes de executar TODAS as ferramentas necessárias



 🔴 REGRA #2 — FORMATO DE PERGUNTAS E RESPOSTAS (para TOOL)

 Regras de apresentação (obrigatórias)
 Mostrar **todos os campos**, sempre, na ordem recebida.
 
 Para cada campo:
 - Se **preenchido**, prefixe com ✅ e mostre o valor formatado entre asteriscos:
   '✅ {Rótulo}: *{ValorFormatado}*'
 - Se **não preenchido**, prefixe com ⬜ e mostre apenas o rótulo:
   '⬜ {Rótulo}:'
 
 **Proibições:**
 - Nunca use "[não preenchido]", "—", "N/A" ou similares.
 - Nunca mostre colchetes em valores vazios.
 - Nunca use ✅ em campos vazios.
 
 **Exemplo correto:**
 ✅ Nome Completo: *João da Silva*  
 ⬜ Estado Civil:  
 ⬜ Tem Filhos?  
 ✅ Idade: *32*  
 
 📝 Próximos campos a preencher:
 - Estado Civil  
 - Tem Filhos?
 
---

**EXEMPLO OBRIGATÓRIO DE EXECUÇÃO:**

❌ **ERRADO** (apenas texto):
 Usuário: "Meu nome é João Silva e tenho 30 anos"
 Você: "Perfeito! Registrei seu nome como João Silva e idade como 30 anos."
 [ERRO: Nenhuma ferramenta foi chamada!"

✅ **CORRETO** (ferramentas + texto):
 Usuário: "Meu nome é João Silva e tenho 30 anos"
 Você: [CHAMA preencher_campo_formulario("nome_completo", "João Silva")]
 Você: [CHAMA preencher_campo_formulario("idade_field_id", "30")]
 Você: "Perfeito! Registrei seu nome e idade. Agora, qual seu estado civil?"

🔴 REGRA #3: IDENTIFICAÇÃO DE CAMPOS

(Memorize os IDs reais dos campos conforme a lista ao final.)


🔴 REGRA #4: APRESENTAÇÃO DE RESPOSTAS

Depois de executar as ferramentas, mostre TODOS os campos:

🤖✨ Perfeito! Atualizei as informações:

✅ Nome Completo: *Wagner Marques*
✅ Estado Civil: *Solteiro*
✅ Tem Filhos?: *Sim*
✅ Quantos Filhos?: *2*
✅ Idade de Cada Filho: *21,27*
⬜ Quantas Pessoas Moram na Casa?:
⬜ Nomes dos Moradores:
... (todos os demais campos)

📝 Próximos campos a preencher:
- Quantas pessoas moram na sua casa?
- Nomes completos dos moradores



  🔴 REGRA #5: CONVERSÃO DE VALORES
  
**Boolean (true/false):**
- Usuário diz: "sim", "s", "yes", "tenho" → você passa: true
- Usuário diz: "não", "n", "no", "não tenho" → você passa: false
- Exemplo: preencher_campo_formulario("tem_filhos", true)

**Number (números puros):**
- Usuário diz: "2 filhos", "duas crianças" → você passa: "2"
- Usuário diz: "R$ 10000", "dez mil reais" → você passa: "10000"
- Exemplo: preencher_campo_formulario("quantos_filhos", "2")

**Text (strings):**
- Mantenha como fornecido
- Exemplo: preencher_campo_formulario("nome_completo", "João Silva")

**Idades separadas por vírgula:**
- Usuário: "21 e 27 anos" → você passa: "21,27"
- Usuário: "10, 12 e 15" → você passa: "10,12,15"

🔴 REGRA #6: PARALLEL TOOL CALLING

Se o usuário fornecer MÚLTIPLAS informações em uma mensagem:
preencher_campo_formulario(id, value)
exemplo:
// Faça TODAS as chamadas juntas (parallel):
preencher_campo_formulario("nome_completo", "Wagner Marques")
preencher_campo_formulario("estado_civil", "Solteiro")  
preencher_campo_formulario("tem_filhos", true)
preencher_campo_formulario("quantos_filhos", "2")
preencher_campo_formulario("idade_de_cada_filho", "21,27")

Não aguarde a resposta de uma ferramenta antes de chamar a próxima.
➤ Execute todas as ferramentas necessárias simultaneamente, sem bloqueios ou esperas sequenciais


🔴 REGRA #7: REINICIALIZAR FORMULÁRIO:
Quando o formulário for reiniciado:
➤ A resposta deve começar com o aviso:
"👩‍💻 Formulário reiniciado. Responda novamente a todos os campos".

🔴 REGRA #8 — EVITAR CHAMADAS DESNECESSÁRIAS DE FERRAMENTA
Se todos os campos obrigatórios já estiverem preenchidos e o usuário não tiver solicitado alteração ou reinício, NÃO chame preencher_campo_formulario.
Nesse caso, mostre apenas o resumo dos campos preenchidos e pergunte:
“Todos os campos obrigatórios foram preenchidos. Deseja finalizar o formulário?”
Chame finalizar_formulario somente se o usuário confirmar (ex.: “sim”, “ok”).

🔴 REGRA #9 — CHAMADAS SOMENTE QUANDO HOUVER MUDANÇA DE VALOR
Antes de chamar preencher_campo_formulario(id, valor), verifique se o valor informado é diferente do que já está armazenado.
Se for igual, não chame a ferramenta novamente.
Se for diferente, chame normalmente para atualizar o campo.
Caso todos os campos obrigatorios já estiverem sido preenchidos, não chamar preencher_campo_formulario(id, valor) e sim apresentar todos os campos, preenchidos ou não.

Se o usuário pedir para alterar algo (ex.: “Quero mudar meu nome”), use primeiro
gerenciar_formulario com { acao: "limpar_campo", field_id: "..." },
depois solicite o novo valor e então use preencher_campo_formulario com o valor atualizado.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

/**
 * Gera a seção dinâmica "📋 CAMPOS DO FORMULÁRIO" contendo apenas a
 * estrutura dos campos (id, tipo, obrigatório), sem valores.
 * @param {Array<Object>} fieldsArray - array de campos normalizados (cada item deve ter { id, tipo, obrigatorio })
 * @returns {string}
 */
function buildFieldsInstructionSection(fieldsArray = []) {
  try {
    if (!Array.isArray(fieldsArray) || fieldsArray.length === 0) {
      return `## 📋 CAMPOS DO FORMULÁRIO\n\n*(Nenhum campo definido no formulário atual)*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    }

    const linhas = fieldsArray.map((f) => {
      const id = f?.id ?? '(sem-id)';
      const tipo = f?.tipo ?? '(sem-tipo)';
      const obrig = (typeof f?.obrigatorio === 'boolean')
        ? (f.obrigatorio ? 'sim' : 'não')
        : '(indef)';
      return `- **ID:** \`${id}\` — tipo: **${tipo}**, obrigatório: **${obrig}**`;
    });

    return [
      `## 📋 CAMPOS DO FORMULÁRIO`,
      ``,
      ...linhas,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n');
  } catch (e) {
    console.error('[INSTRUCTIONS:ERROR] Falha ao montar seção de campos:', e.message);
    return `## 📋 CAMPOS DO FORMULÁRIO\n\n*(Erro ao montar a lista de campos)*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }
}

/**
 * Concatena o DEFAULT_FORM_INSTRUCTIONS com a seção dinâmica no FINAL do texto.
 * (Modo A — enriquecimento sem valores, só estrutura)
 * @param {Array<Object>} normalizedFields
 * @returns {string}
 */
function composeFinalInstructions(normalizedFields = []) {
  const section = buildFieldsInstructionSection(normalizedFields);
  return `${DEFAULT_FORM_INSTRUCTIONS}\n${section}`;
}

export async function RespondeOPENAI_forms_prepare(
  phone,
  userMessage,
  formDefinition,
  setup_data,
  env,
  messageId, 
  formId
) {
  console.log(`--- INICIANDO FLUXO RespondeOPENAI_forms_prepare --- formId: ${formId}, Phone: ${phone}`);

  // --- Configuração e Helpers Base ---
    const OPENAI_ASSISTANTS_BASE = 'https://api.openai.com/v1/assistants';
    const OPENAI_HEADERS = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
    };
  
    // Helper: Obtém Assistant por ID (Mantido)
     async function getAssistantById(assistantId) {
        console.log(`[ASSISTANT] Tentando buscar Assistant ID: ${assistantId}`);
        try {
            if (!assistantId) return null;
            const res = await fetch(`${OPENAI_ASSISTANTS_BASE}/${assistantId}`, { headers: OPENAI_HEADERS });
            if (!res.ok) {
                const errText = await res.text();
                console.warn(`[ASSISTANT:WARN] Falha ao buscar Assistant ou inválido: ${assistantId}:`, errText);
                return null;
            }
            console.log(`[ASSISTANT:INFO] Assistant ID ${assistantId} encontrado com sucesso.`);
            return await res.json();
        } catch (e) {
            console.error('[ASSISTANT:ERROR] Erro em getAssistantById:', e);
            return null;
        }
    }
  
    // Helper: Cria Assistant (Mantido)
     async function createAssistant(name, instructions, tools, env) {
        console.log(`[ASSISTANT] Tentando criar novo Assistant com nome: ${name}`);
        try {
            const res = await fetch('https://api.openai.com/v1/assistants', {
                method: 'POST',
                headers: OPENAI_HEADERS,
                body: JSON.stringify({
                    name: name,
                    model: "gpt-4o-mini",
                    instructions: instructions,
                    tools: tools,
                })
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error('[ASSISTANT:ERROR] Falha na criação do Assistant:', errText);
                return null;
            }
            const assistantData = await res.json();
            console.log(`[ASSISTANT:SUCCESS] Novo Assistant criado. ID: ${assistantData.id}`);
            return assistantData;
        } catch (e) {
            console.error('[ASSISTANT:ERROR] Erro em createAssistant:', e);
            return null;
        }
    }
  
    // Helper: Atualiza Assistant (CORRIGIDO para incluir as tools)
     async function updateAssistant(assistantId, metadataPatch, instructionsPatch, toolsPatch) {
    console.log(`[ASSISTANT] Tentando atualizar Assistant ID: ${assistantId}`);
    try {
      if (!assistantId) return null;
      const body = {};
  
      // --- METADATA ---
      if (metadataPatch) {
        const finalMetadata = { ...metadataPatch };
        // Evita enviar o form_definition bruto
        if (finalMetadata.form_definition) {
          delete finalMetadata.form_definition;
        }
        body.metadata = finalMetadata;
      }
  
      // --- INSTRUÇÕES ---
      if (instructionsPatch) {
        body.instructions = instructionsPatch;
      }
  
      // --- TOOLS + CAMPOS PENDENTES ---
      if (toolsPatch && Array.isArray(toolsPatch)) {
        // Tenta obter a definição do formulário, se disponível
        const formDef = metadataPatch?.form_definition
          ? (typeof metadataPatch.form_definition === "string"
              ? JSON.parse(metadataPatch.form_definition)
              : metadataPatch.form_definition)
          : null;
  
        let camposPendentes = [];
  
        if (formDef && typeof formDef === "object") {
          try {
            // Se vier como objeto de campos ou dentro de "campos"
            const campos = formDef.campos || formDef;
            for (const [id, campo] of Object.entries(campos)) {
              const valor = campo?.valor;
              const vazio =
                valor === "" ||
                valor === null ||
                valor === undefined ||
                (typeof valor === "number" && valor === 0) ||
                (typeof valor === "boolean" && valor === false);
              if (vazio && campo?.obrigatorio) {
                camposPendentes.push(id);
              }
            }
          } catch (err) {
            console.warn("[ASSISTANT] Erro ao mapear campos pendentes:", err);
          }
        }
  
        // Atualiza a função "continuar_formulario" dentro do toolsPatch
        toolsPatch = toolsPatch.map(tool => {
          if (tool?.function?.name === "continuar_formulario") {
            const updatedTool = { ...tool };
            // Insere os campos pendentes como valor padrão
            if (updatedTool.function?.parameters?.properties?.campos_pendentes) {
              updatedTool.function.parameters.properties.campos_pendentes.default = camposPendentes;
              updatedTool.function.parameters.properties.campos_pendentes.example = camposPendentes;
            }
            console.log(`[ASSISTANT] Campos pendentes detectados:`, camposPendentes);
            return updatedTool;
          }
          return tool;
        });
  
        body.tools = toolsPatch;
      }
  
      console.log(
        '[ASSISTANT] Body de atualização (truncado):',
        JSON.stringify(body).substring(0, 180) + '...'
      );
  
      // --- ENVIO PARA API ---
      const res = await fetch(`${OPENAI_ASSISTANTS_BASE}/${assistantId}`, {
        method: 'POST',
        headers: OPENAI_HEADERS,
        body: JSON.stringify(body)
      });
  
      if (!res.ok) {
        const err = await res.text();
        console.warn('[ASSISTANT:WARN] Falha na atualização do Assistant:', err);
        return null;
      }
  
      console.log('[ASSISTANT:SUCCESS] Assistant atualizado com sucesso.');
      return await res.json();
    } catch (e) {
      console.error('[ASSISTANT:ERROR] Erro em updateAssistant:', e);
      return null;
    }
  }
  
      /**
       * Anexa os dados dinâmicos (campos, estado atual) às instruções base vindas do D1.
       */

      const getInitialSystemMessage = (baseInstructions, fieldsForPrompt, formName) => { 
        console.log(`[LOG] Anexando dados dinâmicos às instruções base para o formulário: ${formName}`);
        
        // 1. Geração do JSON de Dados Atuais (com valores)
        // Certifique-se de que os dados (fieldsForPrompt) sejam serializados corretamente.
        // Usamos JSON.stringify(..., null, 2) para formatação legível, mas o LLM pode lidar com JSON puro.
        const serializedCurrentData = JSON.stringify(fieldsForPrompt, null, 2); 
        
        // 2. Mapeamento ID → Rótulo (para a Regra 3)
        const mapeamentoIDs = fieldsForPrompt.map(f => 
            `   "${f.id}" = ${f.rotulo} (${f.tipo})`
        ).join('\n');
        
        // 3. Descrição dos campos (para a Regra de Estrutura)
        const fieldDescriptions = fieldsForPrompt.map(field => {
            // Nota: Assume-se que 'obrigatorio' é booleano (true/false) no array fieldsForPrompt
            const obrigatorio = field.obrigatorio ? ' **(OBRIGATÓRIO)**' : '';
            return `- **ID: \`${field.id}\`** → ${field.rotulo}${obrigatorio} (${field.tipo}): ${field.descricao}`;
        }).join('\n');
        
        // 4. Concatenação de todas as partes no System Prompt Final
        return `
      ${baseInstructions}
      O ano corrente é 2025, use-o como referência para datas sem ano, se necessário.
      
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      
      Você DEVE memorizar e usar EXATAMENTE estes IDs conforme REGRAS ACIMA:
      
      ${mapeamentoIDs}
      
      
      ## 📋 ESTRUTURA E DADOS ATUAIS DO FORMULÁRIO "${formName}":
      
      Isto é o **estado completo e ATUAL** do formulário.
      SEMPRE use o valor contido neste objeto JSON para saber o que já foi preenchido.
      A seção 'valor' deve ser usada para aplicar as regras de formatação (✅ e ⬜) na sua resposta.
      
      ${serializedCurrentData}
      
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      
      ## 🗒️ DESCRIÇÃO DOS CAMPOS (E REGRAS DE ESTRUTURA):
      
      ${fieldDescriptions}
      
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      
      ## 🎯 COMECE AGORA!
      
      Siga RIGOROSAMENTE as regras acima. 
      
      LEMBRE-SE: 
      - A ferramenta preencher_campo_formulario EXISTE e está DISPONÍVEL
      - Você DEVE usá-la
      - Não basta apenas mencionar no texto
      - Use SEMPRE antes de responder textualmente
      
      Vamos começar! 🚀
      `;
      };

      /*
      const getInitialSystemMessage = (baseInstructions, fieldsForPrompt, formName, currentFields, FINAL_FORM_INSTRUCTIONS) => { 
        console.log(`[LOG] Anexando dados dinâmicos às instruções base para o formulário: ${formName}`);
        
        let ano = new Date().getFullYear();
        
        // ==================================================
        // Gera a descrição dos campos com IDs visíveis
        // ==================================================
        const fieldDescriptions = fieldsForPrompt.map(field => {
            const obrigatorio = field.obrigatorio ? ' **(OBRIGATÓRIO)**' : '';
            return `- **ID: \`${field.id}\`** → ${field.rotulo}${obrigatorio} (${field.tipo}): ${field.descricao}`;
        }).join('\n');
        
        // ==================================================
        // Gera lista de campos preenchidos vs vazios
        // ==================================================
        const camposPreenchidos = fieldsForPrompt
            .filter(f => f.valor !== "" && f.valor !== null && f.valor !== undefined)
            .map(f => `✅ ${f.rotulo}: [${f.valor}]`)
            .join('\n');
        
        const camposVazios = fieldsForPrompt
            .filter(f => f.valor === "" || f.valor === null || f.valor === undefined)
            .map(f => `⬜ ${f.rotulo}${f.obrigatorio ? ' *' : ''}`)
            .join('\n');
        
        const camposJaPreenchidos = camposPreenchidos 
            ? `### ✅ Campos já preenchidos:\n${camposPreenchidos}\n\n### ⬜ Campos pendentes:\n${camposVazios || 'Nenhum!'}`
            : `Nenhum campo preenchido ainda.\n\n### ⬜ Todos os campos:\n${fieldsForPrompt.map(f => `⬜ ${f.rotulo}${f.obrigatorio ? ' *' : ''}`).join('\n')}`;
        
        // ==================================================
        // Mapeamento ID → Rótulo para referência rápida
        // ==================================================
        const mapeamentoIDs = fieldsForPrompt.map(f => 
            `   "${f.id}" = ${f.rotulo} (${f.tipo})`
        ).join('\n');
        
        // ==================================================
        // INSTRUÇÕES ULTRA-ASSERTIVAS
        // ==================================================
        
        return `
  ${baseInstructions}
  O ano corrente é 2025, use-o como referência para datas sem ano, se necessário.
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Você DEVE memorizar e usar EXATAMENTE estes IDs conforme REGRAS ACIMA:
  
  ${mapeamentoIDs}
  
  
  ## 📋 CAMPOS DO FORMULÁRIO "${formName}":
  
  ${fieldDescriptions}
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  ## 🎯 COMECE AGORA!
  
  Siga RIGOROSAMENTE as regras acima. 
  
  LEMBRE-SE: 
  - A ferramenta preencher_campo_formulario EXISTE e está DISPONÍVEL
  - Você DEVE usá-la
  - Não basta apenas mencionar no texto
  - Use SEMPRE antes de responder textualmente
  
  Vamos começar! 🚀
  `;
  };
*/




  // ==============================================================
  // 1. LOG de entrada e verificação de tipo de formDefinition
  // ==============================================================
  console.log('[DEBUG:START] Tipo de formDefinition:', typeof formDefinition);
  if (typeof formDefinition === 'string') {
    console.log('[DEBUG:START] Conteúdo inicial (string, truncado 200):', formDefinition.substring(0,200));
  } else {
    console.log('[DEBUG:START] Conteúdo inicial (objeto ou array):', Array.isArray(formDefinition) ? `Array(${formDefinition.length})` : 'Objeto');
  }

  // ==============================================================
  // 2. Parse do formDefinition
  // ==============================================================
  let parsedFormDefinition = formDefinition;
  if (typeof formDefinition === 'string') {
      try {
          parsedFormDefinition = JSON.parse(formDefinition);
      } catch (e) {
          console.error("[ERRO FATAL] Erro ao fazer parse de formDefinition:", e);
          return [{ response_text: "Definição inválida.", messageId }];
      }
  }
  console.log('[DEBUG:PARSE] Tipo após parse:', Array.isArray(parsedFormDefinition) ? 'Array' : typeof parsedFormDefinition);

  // ==============================================================
  // 3. Conversão para array (se vier objeto)
  // ==============================================================
  if (!Array.isArray(parsedFormDefinition)) {
    console.warn('[DEBUG:WARN] formDefinition NÃO é array. Convertendo objeto → array...');
    const tempArray = [];
    for (const key in parsedFormDefinition) {
      const f = parsedFormDefinition[key];
      if (!f.id) f.id = key;
      tempArray.push(f);
    }
    parsedFormDefinition = tempArray;
  } else if (
    Array.isArray(parsedFormDefinition) &&
    parsedFormDefinition.length === 1 &&
    typeof parsedFormDefinition[0] === "object" &&
    !Array.isArray(parsedFormDefinition[0])
  ) {
    console.warn('[DEBUG:WARN] formDefinition é array de um único objeto. Normalizando...');
    const onlyItem = parsedFormDefinition[0];
    const fixedArray = [];
    for (const key in onlyItem) {
      const f = onlyItem[key];
      if (!f.id) f.id = key;
      fixedArray.push(f);
    }
    parsedFormDefinition = fixedArray;
  }
  
  console.log('[DEBUG:PARSE] Primeiros campos:', parsedFormDefinition.slice(0,3));

  const submissionId = `${phone}_${formId}`;   // <<<=== avalie aqui se podre ser o CPF, ou seja, fazer o cadastro em nome de outra pessoa
  console.log(`[DEBUG:INFO] submissionId: ${submissionId}`);
  const tools = generateFormToolDefinitions(parsedFormDefinition); 

  // ==============================================================
  // 4. Consulta form template
  // ==============================================================
  const { results } = await env.db.prepare(`
      SELECT b.id, b.nome, b.descricao, b.whatsappReceiver, b.assistantId, b.instrucoes, layout_json, instructions_b64, campos 
      FROM wpp_forms_saved b 
      WHERE b.token = ? 
        AND b.id = ?
        AND b.active = 1
  `).bind(setup_data.token, formId).all();

  //console.log('[DEBUG:DB] formTemplate resultado:', results.length, results[0]);

  // ==============================================================
  // 5. Estado inicial
  // ==============================================================
  let baseInstructions = ""; 
  const savedForm = results[0];
  baseInstructions = savedForm.instrucoes || ""
  //const formName = savedForm.nome;
  //const formDesc = savedForm.descricao
  const instructions_b64 = savedForm.instructions_b64

  let formState = {
      currentFieldIndex: 0,
      fields: JSON.parse(JSON.stringify(parsedFormDefinition)),
      campos: savedForm.campos,
      isComplete: false,
      formId: formId,
      status: 'in_progress',
      whatsappReceiver: savedForm.whatsappReceiver,
      assistantId: savedForm.assistantId,
      formName: savedForm.nome,
      formDesc: savedForm.descricao,
      layout_json: savedForm.layout_json,
      token: setup_data.token,  
      preenchimento_status: 'empty'
      

  };

  if (!formState?.layout_json && formState?.campos) {
    console.log('[DEBUG:layout_json] Campos layout_json (Formulario):');

     // Busca os campos salvos na tabela
    // Gera dinamicamente o layout_json
    const layout_json = gerarLayoutJson(formState.campos);
    // Atualiza no banco
    await env.db.prepare("UPDATE wpp_forms_saved SET layout_json = ? WHERE token = ? and id = ?")
      .bind(JSON.stringify(layout_json), setup_data.token, formId )
      .run();

    await env.DB.prepare(`
      UPDATE wpp_form_submission
      SET layout_json = ?
      WHERE token = ?
        AND form_id_hash = ( SELECT id FROM wpp_forms_saved WHERE token = ? AND id = ?)
      `)
      .bind(
        JSON.stringify(layout_json),
        setup_data.token,
        setup_data.token,
        formId
      )
      .run();
  


  }

  console.log('[DEBUG:FIELDS_INIT] Campos iniciais (IDs):', formState.fields.map(f => f.id));

  // ==============================================================
  // 6. Leitura de submissão existente
  // ==============================================================
  try {
      const { results } = await env.db.prepare(`
                SELECT b.id, a.*, CASE
                                      WHEN COUNT(
                                            CASE 
                                              WHEN TRIM(COALESCE(json_extract(je.value, '$.valor'), '')) != ''
                                                    OR json_type(je.value, '$.valor') IN ('number','boolean')
                                              THEN 1
                                            END
                                          ) = 0
                                        THEN 'empty'
                                      WHEN COUNT(
                                            CASE 
                                              WHEN TRIM(COALESCE(json_extract(je.value, '$.valor'), '')) = ''
                                                    OR json_extract(je.value, '$.valor') IS NULL
                                              THEN 1
                                            END
                                          ) > 0
                                        THEN 'partial'
                                      ELSE 'complete'
                                    END AS preenchimento_status
          FROM wpp_form_submission a
          INNER JOIN wpp_forms_saved b  ON a.form_id_hash = b.id  AND a.token       = b.token
          LEFT JOIN json_each(a.form_data_json) AS je  ON TRUE
          WHERE a.id = ? AND b.token = ? AND b.id = ? AND b.active = 1
          GROUP BY a.id;
        
      `).bind(submissionId, setup_data.token, formId).all();

      console.log(`[DEBUG:D1_READ] Submissão existente: ${results.length}`);
  
      if (results.length > 0) {
          const savedSubmission = results[0];
          const obj = JSON.parse(savedSubmission.form_data_json);
          console.log( "[DEBUG:D1_READ] JSON atual no D1 (obj):", obj)
          console.log('[DEBUG:D1_READ] JSON atual no D1 (keys):', Object.keys(obj));

          const arr = [];
          for (const fieldId in obj) {
            const campo = obj[fieldId];
            if (!campo.id) campo.id = fieldId;
            // preserva estrutura sem valores extras
            arr.push({ id: fieldId, ...campo });
          }
          formState.fields = arr;
          formState.preenchimento_status = savedSubmission.preenchimento_status


          
      }
  } catch (e) {
      console.error('[D1:ERROR] Erro ao ler submissão:', e.message);
  }

  // ==============================================================
  // 7. INSTRUÇÕES DINÂMICAS — Modo A (adição AO FINAL)
  // ==============================================================
  // Não altera funcionalidades; apenas cria o texto enriquecido e loga.
  const FINAL_FORM_INSTRUCTIONS = composeFinalInstructions(formState.fields);
  console.log('[INSTRUCTIONS:FINAL][preview 700]:', FINAL_FORM_INSTRUCTIONS.substring(0, 700));

  /*
  if (!baseInstructions || baseInstructions.trim() === "") {
    console.warn("[ASSISTANT:WARN] Nenhuma instrução encontrada no D1 (campo 'instrucoes'). Usando instruções padrão (DEFAULT_FORM_INSTRUCTIONS).");
    baseInstructions = DEFAULT_FORM_INSTRUCTIONS;
  }
  */
// ==============================================================
  // 7.5 ASSISTENTES 
  // ==============================================================

  // --- LOG DE DIAGNÓSTICO (INÍCIO) ---
  /*
console.log("[DIAGNOSTICO:0] --- DADOS CRÍTICOS ANTES DA SERIALIZAÇÃO ---");
const nomeCompletoEstado = formState.fields.find(f => f.id === 'nome_completo')?.valor;
const whatsappEstado = formState.fields.find(f => f.id === 'whatsapp')?.valor;
console.log(`[DIAGNOSTICO:1] Nome Completo Estado (Valor no D1): [${nomeCompletoEstado}]`);
console.log(`[DIAGNOSTICO:2] WhatsApp Estado (Valor no D1): [${whatsappEstado}]`);
console.log("[DIAGNOSTICO:3] --- FIM DOS DADOS CRÍTICOS ---");
*/

// --- INJEÇÃO DE CONTEXTO REFORÇADA ---
const serializedCurrentData = JSON.stringify(formState.fields, null, 2); 
console.log("[DIAGNOSTICO:4] JSON INJETADO (Preview 500):", serializedCurrentData.substring(0, 500));
// --- FIM DA INJEÇÃO ---


  //const currentSystemMessageContent = getInitialSystemMessage(baseInstructions, parsedFormDefinition, formState.formName, formState.fields, FINAL_FORM_INSTRUCTIONS);
  const currentSystemMessageContent = getInitialSystemMessage(baseInstructions, formState.fields, formState.formName);
  console.log(`[LOG] Verificando Assistant. ID (do formState): ${formState.assistantId}`);

  const assistantName = `form_${formState.token}_${formState.formName}`; 
  let assistantFound = null;

  if (formState.assistantId) {
      assistantFound = await getAssistantById(formState.assistantId);
  } 
  if (!assistantFound?.id || !assistantFound) {
      console.log(`[ASSISTANT] ID salvo (${formState.assistantId}) não encontrado/acessível. Criando novo com nome: ${assistantName}`);
      // Usa a função de criação
      assistantFound = await createAssistant(assistantName, currentSystemMessageContent, tools, env);
      console.log(`[LOG] Tools para o assistente ${assistantName} (primeira tool):`, tools.length > 0 ? tools[0].function.name : "NENHUMA TOOL GERADA");
 
      if (!assistantFound.id) {
          console.error('[ASSISTANT:FATAL] Falha crítica ao criar o assistente.');
          return [{ response_text: "Falha ao criar o assistente do formulário. Tente novamente.", messageId: messageId, form_id: null, form_completed: false, form_data: null }];
      }
      const { results } = await env.db.prepare(
              `Update wpp_forms_saved set assistantId = ? where  token = ? and id = ? AND active = 1`)
                .bind(assistantFound.id, formState.token, formState.formId).run();
      formState.assistantId = assistantFound.id; 
  } else {
      // *** LOG ADICIONADO ***
      console.log(`[ASSISTANT] Assistant ${assistantFound.id} encontrado. Verificando/sincronizando definições...`);
      // Usa a função de atualização, passando as tools para garantir que estejam presentes
      const ret = await updateAssistant(assistantFound.id, {
          wpp_form_id: formState.formId,
          wpp_form_name: formState.formName || null,
          wpp_form_desc: formState.formDesc || null,
          form_definition: parsedFormDefinition
      }, currentSystemMessageContent, tools); 
     // console.log( "Retorno de updateAssistant()", ret)
  }


  // ==============================================================
  // 8. Após resposta do assistant (antes de salvar)
  // ==============================================================
  console.log('[DEBUG:PRE-SAVE] Campos antes do INSERT/UPDATE:');
  for (const f of formState.fields) {
    if (!f.id) {
      console.warn('[DEBUG:WARN] Campo sem ID detectado antes do save:', f);
    }
  }

  // ==============================================================
  // 9. Conversão para objeto para salvar no D1
  // ==============================================================
  const objetoDeCampos = {};
  for (const campo of formState.fields) {
      if (!campo?.id || campo.id === 'undefined') {
          console.error('[DEBUG:BUG] Campo com id inválido detectado:', campo);
          continue;
      }
      objetoDeCampos[campo.id] = {
          rotulo: campo.rotulo,
          valor: campo.valor,
          tipo: campo.tipo,
          obrigatorio: campo.obrigatorio,
          descricao: campo.descricao
      };
  }
  const formDataJson = JSON.stringify(objetoDeCampos || {}) ;
  const date = new Date();
  const offset = -3; // UTC-3
  const currentTime = new Date(date.getTime() + offset * 60 * 60 * 1000)
      .toISOString()
      .replace('Z', '');
    
  if (!formState.status) formState.status = 'in_progress';

  console.log('[DEBUG:TO_SAVE] Keys que serão gravadas em form_data_json:', Object.keys(objetoDeCampos));

  // ==============================================================
  // 10. Gravação no D1 (mantido, com logs)
  // ==============================================================
  const { results: existenceCheck } = await env.db.prepare(
      `SELECT id FROM wpp_form_submission WHERE id = ?`
  ).bind(submissionId).all();

  if (existenceCheck.length === 0) {
      console.log(`[DEBUG:INSERT] Nova submissão (${submissionId})`);
      console.log('[DEBUG:D1_BIND_VALUES]', {
        submissionId,
        phone,
        formId: formState.formId,
        status: formState.status,
        current_field_index: 0,
        formDataJson: typeof formDataJson,
        currentTime,
        token: formState.token,
        assistantId: formState?.assistantId || ""
      });
      
      //Enviando o audio de Welcome

      // Envio de audio introdutório  ////
      const responseBodyObjeto = {
        "phone": phone,
        "isLid": setup_data.isLid,
        "base64Ptt": instructions_b64
      };
      console.log(`[LOG] Enviando audio de Welcome (send-voice-base64) para ${phone} ...`);
      let responseBody = JSON.stringify(responseBodyObjeto);
      let zapiResponse = await wpp.sendZapiResponse(phone, responseBody, 'send-voice-base64', setup_data, env);
      ///////////
    



      await env.db.prepare(`
          INSERT INTO wpp_form_submission 
          (id, phone, form_id_hash, status, current_field_index, form_data_json, created_at, updated_at, token, assistantId, layout_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          submissionId,
          phone,
          formState.formId,
          formState.status,
          0,
          formDataJson,
          currentTime,
          currentTime,
          formState.token,
          formState.assistantId,
          formState.layout_json || ""

        ).run();
  } else {
      console.log(`[DEBUG:UPDATE] Atualizando submissão existente (${submissionId})`, formDataJson?.substring(0,300));
      await env.db.prepare(`
          UPDATE wpp_form_submission
          SET status = ?, current_field_index = ?, form_data_json = ?, updated_at = ?, assistantId = ? 
          WHERE id = ? AND token = ?
      `).bind(formState.status, 0, formDataJson, currentTime, formState.assistantId, submissionId, formState.token).run();
  }

  // ==============================================================
  // 11. Confirmação final
  // ==============================================================
  const { results: confirm } = await env.db.prepare(
      `SELECT form_data_json FROM wpp_form_submission WHERE id = ? AND token = ?`
  ).bind(submissionId, formState.token).all();
  console.log('[DEBUG:CONFIRM] JSON salvo (preview 300):', confirm[0]?.form_data_json?.substring(0,300));

  console.log('--- FINALIZANDO FLUXO RespondeOPENAI_forms_prepare ---');

  // ==============================================================
  // 12. RETORNO (restaurado) — evita data[0] undefined no chamador
  //      Não inventa valores; apenas inicia o ciclo de UI.
  // ==============================================================
  return [{
    response_text: "Vamos começar seu formulário. Responda com os dados solicitados que eu vou registrando. 👇",
    messageId,
    final_form_instructions: FINAL_FORM_INSTRUCTIONS,
    form_id: formState.formId,
    form_assistantId: formState.assistantId,
    form_completed: false,
    form_data: formState.fields,   // estrutura atual (sem valores sensíveis novos)
    form_audiob64: instructions_b64,
    form_status: formState?.preenchimento_status || "empty"
  }];
  
}


export async function fetchOpenAI_V2_forms(userMessage, senderName, env, phone, messageId, setup_data, formDefinition, formId) {
  console.log(`[LOG] Iniciando fetchOpenAI_V2_forms para ${phone}. FormID: ${formId}, Mensagem: ${userMessage.substring(0, 50)}...`);
  try {

      await wpp.sendTyping(phone, true, setup_data);   // Liga o digitando...

      console.log(`[LOG] Chamando RespondeOPENAI_forms_prepare...`);
      let data_prepare = await RespondeOPENAI_forms_prepare(phone, userMessage, formDefinition, setup_data, env, messageId, formId);
      console.log( "[RespondeOPENAI_forms_prepare]", data_prepare)
      console.log( "[RespondeOPENAI_forms] - Chamando a função para responder a pergunta: ", userMessage)
      
      
      

      let data = await ia.RespondeOPENAI_forms(phone, userMessage, setup_data, env, messageId, data_prepare[0].form_assistantId, data_prepare[0].form_id); 


      console.log("fetchOpenAI_V2_forms :: fetchOpenAI_V2 Formulario => Data[0] (Resultado):", data[0]);

      const thread_mensagem =       data[0].response_text;
      const thread_messageId =      data[0].messageId;
      const thread_form_id =        data[0].form_id;
      const thread_form_completed = data[0].form_completed;

      const thread_form_data = {};
      if (Array.isArray(data[0].form_data)) {
          for (const campo of data[0].form_data) {
              // Apenas estrutura compactada por rótulo (se existir) → sem valores
              const label = campo?.rotulo || campo?.id || 'campo';
              thread_form_data[label] = (campo?.valor ?? '') === '' ? '' : '[valor]';
          }
      }

      console.log("dadosFormulario (formatados):", thread_form_data);

      if (thread_mensagem) {

        
        const responseBodyObjeto = {
            "phone": phone,
            "isGroup": false,
            "isLid": setup_data.isLid,
            "message": `🤖 \`Agente de formulário:\`\n ${thread_mensagem}\n${thread_form_completed ? "Completado? Sim" : ""}
             `,
            "messageId": thread_messageId, 
            options: { markIsRead: false} ,
            "delayMessage": "1"
        };
        console.log(`[LOG] Enviando resposta (send-reply) para ${phone}: ${responseBodyObjeto.message.substring(0, 100)}...`);
        let responseBody = JSON.stringify(responseBodyObjeto);
        let zapiResponse = await wpp.sendZapiResponse(phone, responseBody, 'send-reply', setup_data, env);
        
        

        if (zapiResponse.ok) {
            console.log(`[LOG] Resposta (send-reply) enviada com sucesso para ${phone}.`);
            const chaveKV = `${phone}_${setup_data.app_key}`;

            let lbot = setup_data.respViaChatGPT === "2";

            /*
            const session_form = [
              { rowId: "01", title: "📖 Quero recomeçar",          description: "Preencher novamente do zero" },
              { rowId: "02", title: "📖 Visualizar Preenchimento", description: "Analise o que já foi preenchido" },
              { rowId: "03", title: "📖 Quero corrigir um campo",  description: "Corrigir informação" },
              { rowId: "04", title: "📖 Finalizar formulário",     description: "Finalizar o formulário" },
              { rowId: "05", title: "📖 Encaminhar formulário",    description: "Enviar pelo Whatsapp" },
              { rowId: "99", title: "⏮️ Voltar ao Menu",           description: "" }
            ];

            const jBody = JSON.stringify({
              phone: phone,
              isGroup: false,
              description: "_👇Comandos do formuário_",
              buttonText: "✨O que gostaria de fazer?✨",
              sections: [{ title: '✨O que gostaria de fazer?✨', rows: session_form }],
              delayMessage: "1"
            });
            
            console.log(`[LOG] Enviando lista de opções (send-option-list) para ${phone}.`);
            await wpp.sendZapiResponse(phone, jBody, 'send-option-list', setup_data, env);
            */


            if (!thread_form_completed) {
                console.log(`[WPP] MODO FORM: Ativando (Status: Incompleto).`);
                await fn.whatsapp_liga_desl_GPT("2", `${phone}_${setup_data.app_key}`, env);
            } else {
                console.log(`[WPP] MODO FORM: Desativando (Status: Completo).`);
                await fn.whatsapp_liga_desl_GPT("0", `${phone}_${setup_data.app_key}`, env);
            }

            console.log(`[LOG] Finalizando fetchOpenAI_V2_forms com sucesso para ${phone}.`);
            await wpp.sendTyping(phone, false, setup_data);
            return new Response("Resposta enviada para o Whatsapp com sucesso", { status: 200 });
        } else {
            await wpp.sendTyping(phone, false, setup_data);
            console.error(`Erro ao enviar a resposta (send-reply) para o Whatsapp: ${zapiResponse.statusText}`, await zapiResponse.text());
            return new Response("Erro ao enviar a resposta para o Whatsapp", { status: 500 });
        }
      } else {
           console.warn(`[WARN] fetchOpenAI_V2_forms: thread_mensagem estava vazia. Nenhuma resposta enviada.`);
           await wpp.sendTyping(phone, false, setup_data);
           return new Response("Nenhuma resposta gerada", { status: 204 });
      }
  } catch (error) {
      await wpp.sendTyping(phone, false, setup_data);
      console.error(`[FATAL] Erro em fetchOpenAI_V2_forms: ${error.message}`, error.stack);
      throw error;
  }
}


// O conteúdo desta função (generateFormToolDefinitions) é usado para configurar
// o Assistant na OpenAI e para a validação local.

/**
 * Gera as definições de ferramentas (functions) para a API da OpenAI com base na definição do formulário.
 * Estas ferramentas permitem que o modelo interaja com os campos do formulário.
 * @param {Array<Object>} formDefinition - Um array de objetos, onde cada objeto descreve um campo do formulário.
 * @returns {Array<Object>} Um array de definições de ferramentas no formato da OpenAI.
 */
function generateFormToolDefinitions(formDefinition) {
  console.log(`[LOG] Iniciando generateFormToolDefinitions para ${formDefinition.length} campos.`);

  // Gera o array de IDs
  const fieldIds = formDefinition.map(f => f.id);

  // 🚀 LOG DETALHADO — Verificação de IDs válidos
  console.log("----------------------------------------------------");
  console.log("[DEBUG:FORM_TOOLS] IDs detectados no formulário:");
  fieldIds.forEach((id, i) => {
    if (!id || id === "undefined") {
      console.warn(`[AVISO] Campo ${i + 1} sem ID válido!`);
    } else {
      console.log(`  #${i + 1}: ${id}`);
    }
  });
  console.log("----------------------------------------------------");

  

  const tools = [
    
    {
      type: "function",
      function: {
        name: "preencher_campo_formulario",
        description: "Sempre mostre todos os campos. A exibição de todos os campos e seus estados (⬜ ou ✅) é controlada pelas regras do assistente, não por esta função. Preenche um campo específico do formulário com um valor fornecido pelo usuário. Use para capturar dados como nome, data, números, ou seleções. O campo 'field_value' deve ser formatado conforme o tipo do campo. ",
        parameters: {
          type: "object",
          properties: {
            field_id: {
              type: "string",
              description: `O ID único do campo a ser preenchido (ex: ${fieldIds[0] || 'ID_EXEMPLO'}). Deve ser um dos IDs válidos do formulário.`,
              enum: fieldIds
            },
            field_value: {
              type: "string",
              description: `O valor extraído da mensagem do usuário para o campo.
                          **Regras de Formatação:**
                          - Para campos 'number': O valor deve ser um número puro (ex: '123', '54.5'), sem texto como 'anos' ou 'reais'.
                          - Para campos 'datetime': O valor deve ser formatado como 'dd/mm/aaaa' ou 'dd/mm/aaaa hh:mm' (ex: '26/07/2025', '01/01/2025 14:30').
                          - Para campos 'text' ou 'select': O valor é a string literal fornecida pelo usuário (ex: "Wagner Marques", "Solteiro").
                          - Para campos 'text' que sejam um celular: Formate como '(ddd) 99999-9999'.`
            }
          },
          required: ["field_id", "field_value"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "finalizar_formulario",
        description: "Finaliza o processo de preenchimento do formulário. Chame esta função apenas quando *todos* os campos obrigatórios forem preenchidos e o usuário confirmar a finalização (ex: 'sim', 'pode finalizar', 'ok' ou 'Finalizar o formulário'). Não chame se o usuário não confirmar explicitamente.",
        parameters: {
          type: "object",
          properties: {
            confirmacao: {
              type: "boolean",
              description: "True se o usuário confirma a finalização do formulário, False caso contrário. Se o usuário disser algo como 'ainda não' ou 'não', passe False."
            }
          },
          required: ["confirmacao"]
        }
      }
    },

    {
      type: "function",
      function: {
        name: "enviar_formulario_whatsapp",
        description: "Encaminha um formulário já preenchido. Chame esta função apenas quando *todos* os campos obrigatórios forem preenchidos e o usuário confirmar o envio (ex: 'sim', 'pode enviar', 'ok' ou 'enviar o formulário'). Não chame se o usuário não confirmar explicitamente.",
        parameters: {
          type: "object",
          properties: {
            confirmacao: {
              type: "boolean",
              description: "True se o usuário confirma o envio do formulário, False caso contrário. Se o usuário disser algo como 'ainda não' ou 'não', passe False."
            }
          },
          required: ["confirmacao"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "gerenciar_formulario",
        description: "Realiza ações de gerenciamento no formulário, como limpar um campo específico ou reiniciar todo o formulário. Útil para correções ou para começar um formulário do zero.",
        parameters: {
          type: "object",
          properties: {
            acao: {
              type: "string",
              enum: ["limpar_campo", "reiniciar_formulario"],
              description: "Ação a ser executada no formulário. 'limpar_campo' para apagar um valor de um campo específico, 'reiniciar_formulario' para começar do zero (apaga todos os campos e o histórico da conversa com o formulário)."
            },
            field_id: {
              type: "string",
              description: "O ID do campo a ser limpo (necessário e aplicável apenas para a ação 'limpar_campo'). Deve ser um dos IDs válidos do formulário.",
              enum: fieldIds
            }
          },
          required: ["acao"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "continuar_formulario",
        description:
          "Permite continuar o preenchimento de um formulário parcialmente preenchido, informando ao assistente quais campos (IDs) ainda estão vazios e precisam ser completados. O assistente usará essas informações para solicitar ao usuário os valores correspondentes, dando continuidade natural ao processo.",
        parameters: {
          type: "object",
          properties: {
            acao: {
              type: "string",
              enum: ["continuar_formulario"],
              description:
                "Ação a ser executada. Use 'continuar_formulario' para informar ao assistente que ele deve continuar o preenchimento dos campos pendentes.",
            },
            campos_pendentes: {
              type: "array",
              description:
                "Lista dos IDs dos campos ainda não preenchidos, que devem ser solicitados ao usuário.",
              items: {
                type: "string",
                enum: fieldIds,
                description:
                  "ID de um campo ainda pendente de preenchimento no formulário.",
              },
            },
            mensagem: {
              type: "string",
              description:
                "Mensagem de contexto opcional para o usuário, explicando que o preenchimento continuará pelos campos pendentes.",
            },
          },
          required: ["acao", "campos_pendentes"],
        },
      },
    },

  ];
  console.log(`[LOG] Total de tools geradas: ${tools.length}`);
  return tools;
}
  
export async function fn_form_chat(phone, message, nome_form, setup_data, env) {
  console.log(`[LOG] Iniciando fn_form_chat (Chat Completions) para ${phone}. Form: ${nome_form}, Msg: ${message.substring(0, 50)}...`);
  try {
    const tokenAPI = setup_data.ConnectionTokenAPI;
    const formQuery = `SELECT campos, nome, descricao FROM wpp_forms_saved where nome = ? and token = ?`;
    const formResult = await env.db.prepare(formQuery).bind(nome_form, setup_data.token).first();

    if (!formResult) {
      console.error(`[ERROR] fn_form_chat: Formulário '${nome_form}' não encontrado para o token ${setup_data.token}.`);
      return new Response(JSON.stringify({ error: "Formulário não encontrado" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    console.log(`[LOG] fn_form_chat: Formulário '${nome_form}' encontrado. Gerando tools...`);
    const campos = JSON.parse(formResult.campos);

    const properties = {};
    const required = [];
    campos.forEach(campo => {
      let tipo = "string";
      if (campo.tipo === "number") tipo = "number";
      else if (campo.tipo === "datetime") tipo = "string";

      properties[campo.id] = {
        type: tipo,
        description: campo.descricao
      };

      if (campo.obrigatorio) required.push(campo.id);
    });

    const functions = [
      {
        name: formResult.nome.replace(/\s+/g, "_"),
        description: formResult.descricao || `Preenche o formulário ${formResult.nome}`,
        parameters: {
          type: "object",
          properties,
          required
        }
      }
    ];

    const payload = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: message }],
      functions,
      function_call: "auto"
    };
    
    console.log(`[LOG] fn_form_chat: Enviando payload para OpenAI (Chat Completions) com ${functions.length} function.`);

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!openaiResponse.ok) {
      const errTxt = await openaiResponse.text();
      console.error(`[ERROR] fn_form_chat: Erro OpenAI (${openaiResponse.status}): ${errTxt}`);
      throw new Error(`Erro OpenAI: ${errTxt}`);
    }

    const openaiData = await openaiResponse.json();
    const messageFromGPT = openaiData.choices[0].message;
    
    console.log(`[LOG] fn_form_chat: OpenAI respondeu. Content: ${messageFromGPT.content ? messageFromGPT.content.substring(0, 100) : '[No content]'}. Function call: ${messageFromGPT.function_call ? messageFromGPT.function_call.name : 'No'}`);

    const textoResposta = messageFromGPT.content || "Vamos iniciar seu cadastro. Por favor, responda as perguntas.";
    const jBody = JSON.stringify({
      phone,
      isLid: setup_data.isLid,
      message: textoResposta, 
      options: { markIsRead: false} ,
      delayMessage: "1"
    });
    
    console.log(`[LOG] fn_form_chat: Enviando resposta (send-message) para ${phone}: ${textoResposta.substring(0, 100)}...`);
    await wpp.sendZapiResponse(phone, jBody, "send-message", setup_data, env);

    return new Response(JSON.stringify({ message: "Fluxo iniciado", gpt_response: messageFromGPT }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("[FATAL] Erro em fn_form_chat:", error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}


export async function _createThreadForm(chave_user, headers, env) {
  console.log(`[LOG] Iniciando _createThreadForm para chave: ${chave_user}`);
  let url = 'https://api.openai.com/v1/threads';
  try {
    let criando_new_Thread = await fetch(url, { method: 'POST', headers: headers });
    let dados_new_thread = await criando_new_Thread.json();

    if (!criando_new_Thread.ok) {
      console.error(`[ERROR] Não foi possível criar uma nova Thread para ${chave_user}. API Status: ${criando_new_Thread.status}`, dados_new_thread);
      await env.FORM_ASSISTANTS.delete(chave_user);
    }
    else {
      console.log(`[SUCCESS] Foi criada uma nova Thread ${dados_new_thread.id} para ${chave_user}.`);
      await env.FORM_ASSISTANTS.put(chave_user, dados_new_thread.id);
    }

  } catch (error) {
    console.error(`[FATAL] Erro em _createThreadForm para ${chave_user}:`, error.message, error.cause);
    await env.FORM_ASSISTANTS.delete(chave_user);
  }
  let thread_user = await env.FORM_ASSISTANTS.get(chave_user);
  if (thread_user) {
    return new Response(JSON.stringify(thread_user));
  } else {
    console.warn(`[WARN] _createThreadForm: Thread não encontrada no KV para ${chave_user} imediatamente após a criação.`);
    return new Response(JSON.stringify(""));
  }
}
  
  
export async function _validaThreadForm(chave_user, thread_id, headers, env) {
  console.log(`[LOG] Iniciando _validaThreadForm para chave: ${chave_user}, Thread ID: ${thread_id}`);
  let url = `https://api.openai.com/v1/threads/${thread_id}`;
  const timestampAtual = Math.floor(Date.now() / 1000);

  try {
    let valida_new_Thread = await fetch(url, { method: 'GET', headers: headers });
    let dados_valida_new_thread = await valida_new_Thread.json();

    if ((!(valida_new_Thread.ok && dados_valida_new_thread.id))) {
      console.warn(`[WARN] _validaThreadForm: A Thread ${thread_id} não existe ou não é mais válida na OpenAI. Criando nova...`, dados_valida_new_thread);
      const newthread = await _createThreadForm(chave_user, headers, env);
      console.log(`[LOG] _validaThreadForm: Uma nova thread foi criada:`, newthread.body ? await newthread.text() : 'N/A');
    } else {
      console.log("[_validaThreadForm] Dados da thread:", dados_valida_new_thread)
      if (dados_valida_new_thread.created_at) {
        const threadAgeInSeconds = timestampAtual - dados_valida_new_thread.created_at;
        const maxAge = 86400; // 24 horas
        
        if (threadAgeInSeconds > maxAge) {
          console.log(`[LOG] _validaThreadForm: A Thread ${thread_id} já existia, mas vencida (${threadAgeInSeconds}s > ${maxAge}s). Criando uma nova...`);
          await _createThreadForm(chave_user, headers, env);
        } else {
          console.log(`[LOG] _validaThreadForm: Foi validada a Thread ${dados_valida_new_thread.id} (Idade: ${threadAgeInSeconds}s).`);
          await env.FORM_ASSISTANTS.put(chave_user, dados_valida_new_thread.id);
        }
      } else {
          console.warn(`[WARN] _validaThreadForm: Thread ${thread_id} válida, mas sem 'created_at'. Recriando por segurança.`);
          await _createThreadForm(chave_user, headers, env);
      }
    }

  } catch (error) {
    console.error(`[FATAL] Erro em _validaThreadForm para ${chave_user}:`, error.message, error.cause);
    throw new Error(`Erro ao validar a Thread : ${error.message}`);
  }
  let thread_user = await env.Whatsapp_threads.get(chave_user);
  if (!thread_user) {
      console.warn(`[WARN] _validaThreadForm: Lendo thread do KV (namespace Whatsapp_threads) retornou nulo para ${chave_user}.`);
      thread_user = await env.FORM_ASSISTANTS.get(chave_user);
      if(thread_user) console.log(`[LOG] _validaThreadForm: Lendo do namespace FORM_ASSISTANTS retornou: ${thread_user}`);
  }
  return new Response(JSON.stringify(thread_user));
}


export async function html_form_generate(submissionId, token, env) {
  try {
      // 1. Usar .first() é mais eficiente se você espera apenas 1 resultado
      const row = await env.db.prepare(
          `SELECT b.nome, a.form_data_json, a.layout_json 
              FROM wpp_form_submission a join wpp_forms_saved b on a.token = b.token and a.form_id_hash = b.id
              WHERE a.id = ? AND a.token = ?`
      ).bind(submissionId, token).first();

      // 2. CORREÇÃO DE LÓGICA: Checa se a 'row' foi encontrada
      if (row) {
          
          // 3. CORREÇÃO DE SEGURANÇA: Validar e "Limpar" o JSON
          // Isso previne Injeção de Script garantindo que o que injetamos é
          // um JSON válido e devidamente escapado.
          let dadosClienteString;
          let layoutClienteString;
          let titleClienteString;

          try {
              // Parse: Garante que é um JSON válido (dá erro se não for)
              // Stringify: Converte de volta para uma string segura para ser
              //            colocada dentro de uma variável JavaScript.
              dadosClienteString = JSON.stringify(JSON.parse(row.form_data_json));
              layoutClienteString = JSON.stringify(JSON.parse(row.layout_json));
              titleClienteString = row.nome
          } catch (jsonError) {
              console.error('Erro ao processar JSON do banco:', jsonError.message);
              return new Response('Erro: Dados do formulário estão corrompidos.', { status: 500 });
          }

          // 4. Buscar o molde (template) HTML no R2
          const templateObj = await env.template_form_html.get('html_templates/html_templates.html');
          if (templateObj === null) {
              return new Response('Erro: Template mestre não encontrado no R2.', { status: 500 });
          }
          let templateHtml = await templateObj.text();

          // 5. Injetar os dados agora SEGUROS no molde
          templateHtml = templateHtml.replace('%%JSON_DATA_PLACEHOLDER%%', dadosClienteString);
          templateHtml = templateHtml.replace('%%LAYOUT_DATA_PLACEHOLDER%%', layoutClienteString);
          templateHtml = templateHtml.replaceAll('%%TITLE_PLACEHOLDER%%',titleClienteString)

          // 6. Entregar o HTML final e preenchido
          return new Response(templateHtml, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
      
      } else {
          // 7. CORREÇÃO DE LÓGICA: Retornar 404 se não for encontrado
          return new Response('Ficha não encontrada ou token inválido.', { 
              status: 404,
              headers: { 'Content-Type': 'text/plain' },
          });
      }
  } catch (e) {
      console.error(e);
      return new Response('Erro interno do servidor: ' + e.message, { status: 500 });
  }
}




export function gerarLayoutJson(camposJson) {
  // camposJson é o JSON do campo "campos" vindo da tabela (string ou objeto)

  // Garantir que está parseado
  const campos = typeof camposJson === "string" ? JSON.parse(camposJson) : camposJson;

  // Estrutura dinâmica das seções
  const secoes = {
    principais: {
      titulo: "Dados Principais",
      id: "principais",
      colunas: 3,
      campos: []
    },
    gerais: {
      titulo: "Informações (obrigatórias)",
      id: "gerais",
      colunas: 3,
      campos: []
    },
    quantitativos: {
      titulo: "Opcionais",
      id: "quantitativos",
      colunas: 3,
      campos: []
    },
    datas: {
      titulo: "Datas e Agendamentos",
      id: "datas",
      colunas: 2,
      campos: []
    }
  };

  // Classificação automática
  for (const key in campos) {
    const campo = campos[key];
    
    if (campo.obrigatorio) {
      secoes.principais.campos.push(campo.id);
      continue;
    }

    switch (campo.tipo) {
      case "text":
        secoes.gerais.campos.push(campo.id);
        break;

      case "number":
        secoes.quantitativos.campos.push(campo.id);
        break;

      case "datetime":
        secoes.datas.campos.push(campo.id);
        break;

      default:
        secoes.gerais.campos.push(campo.id);
    }
  }

  // Remover seções vazias
  const layout = Object.values(secoes).filter(sec => sec.campos.length > 0);

  return layout;
}
