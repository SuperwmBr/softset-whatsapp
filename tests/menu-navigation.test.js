// Teste de integração do fluxo completo de navegação do menu (processMessageV2),
// cobrindo os cenários pedidos nos critérios de aceite: níveis profundos de
// "Valores por diárias" (incluindo "8 diárias ou mais"), uma lista simples
// ("Campings homologados"), o filtro da "Área Restrita" e o comando "Menu".
//
// As dependências externas (D1, KV, chamada HTTP da Z-API) são substituídas
// por fakes simples em memória, para exercitar o processMessageV2 real sem
// bater em serviços externos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as menu from '../functions/menu.js';
import { BACK_OPTION_ID, BACK_OPTION_TITLE } from '../functions/menu-trigger.js';

function createFakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix, limit } = {}) {
      const keys = [...store.keys()]
        .filter(k => !prefix || k.startsWith(prefix))
        .slice(0, limit || 1000)
        .map(name => ({ name }));
      return { keys, cursor: null };
    },
    _store: store,
  };
}

function buildSampleMenuTree() {
  return [
    {
      id: 'valores', title: 'Valores por diárias', text: 'Selecione a temporada',
      children: [
        {
          id: 'alta', title: 'Alta temporada', text: 'Selecione a faixa de diárias',
          children: [
            {
              id: '8ouMais', title: '8 diárias ou mais', text: 'Selecione a quantidade',
              children: [
                { id: 'qtd8', title: '8 diárias', text: 'Valor para 8 diárias: R$ 100', children: [] },
                { id: 'qtd9', title: '9 diárias', text: 'Valor para 9 diárias: R$ 110', children: [] },
              ],
            },
            { id: 'ate7', title: 'Até 7 diárias', text: 'Valor até 7 diárias: R$ 90', children: [] },
          ],
        },
      ],
    },
    {
      id: 'campings', title: 'Campings homologados', text: 'Selecione o camping',
      children: [
        { id: 'campingA', title: 'Camping A', text: 'Informações do Camping A', children: [] },
      ],
    },
    {
      id: 'arearestrita', title: '🔐 Area Restrita 🔐', text: '',
      children: [
        {
          id: 'origemInformado', title: 'Informado', text: 'Área restrita (Informado)',
          children: [{ id: 'docA', title: 'Documento A', text: 'Conteúdo do documento A', children: [] }],
        },
        {
          id: 'origemTeste', title: 'Teste', text: 'Área restrita (Teste)',
          children: [{ id: 'docB', title: 'Documento B', text: 'Conteúdo do documento B', children: [] }],
        },
      ],
    },
  ];
}

function createFakeDb() {
  const chain = {
    bind() { return chain; },
    async all() { return { results: [] }; },
    async run() { return { success: true }; },
    async first() { return null; },
  };
  return { prepare() { return chain; } };
}

function createEnv(token, whatsappInstance) {
  return {
    db: createFakeDb(),
    Whatsapp_Calendar: createFakeKv(),
    // O menu do gestor é armazenado por instância/token — exatamente como processMessageV2 lê.
    MENU_STORAGE: createFakeKv({ [`menu:${token}`]: JSON.stringify(buildSampleMenuTree()) }),
    Whatsapp_chatgpt: createFakeKv(),
    Forms_KV: createFakeKv(),
    whatsapp_lastmessage: createFakeKv(),
    whatsapp_chathook: createFakeKv(),
    Whatsapp_Clients: createFakeKv({
      // whatsapp (instância) + contato => origem do contato, usado no filtro da Área Restrita.
      [`${whatsappInstance}_5511888888888`]: JSON.stringify({ origem: 'Informado' }),
    }),
  };
}

function createSetupData(token) {
  return {
    app_key: token,
    token,
    phone: '5511888888888',
    isLid: false,
    chatLid: '',
    senderName: 'Visitante Teste',
    nome_fantasia: 'Pousada Teste',
    wellcome_menu: '',
    textoMenuPrincipal: '',
    visitante_existente: true,
    visitante_blocked: false,
    visitante_cpf_cnpj: '',
    visitante_nome: '',
    cnpj: {},
    etiquetas: '',
    lastmessage: '',
    server_api: 'https://fake.api.local',
    ConnectionTokenAPI: 'fake-token',
    whatsapp: whatsappInstanceNumber(token),
    whatsappServer: whatsappInstanceNumber(token),
    liga_desl_bot: 0,
    have_instructions: false,
    plano_ass_ok: true,
    photo: '',
  };
}

// Mesmo número usado como "instância" (whatsapp do gestor) em todos os testes.
function whatsappInstanceNumber() { return '5511999999999'; }

let originalFetch;
test.before(() => {
  originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    statusText: 'OK',
    json: async () => ({}),
    text: async () => '',
    clone() { return this; },
  });
});
test.after(() => { global.fetch = originalFetch; });

// Extrai, do corpo da última chamada de "send-option-list" (ignorando outras
// chamadas HTTP intermediárias, como a de "digitando..."), os rowIds/títulos
// das opções enviadas.
function rowsFromLastCall(fetchCalls) {
  for (let i = fetchCalls.length - 1; i >= 0; i -= 1) {
    try {
      const body = JSON.parse(fetchCalls[i].body);
      if (body?.sections?.[0]?.rows) return body.sections[0].rows;
    } catch {
      // corpo não é JSON (ex.: texto puro) — ignora e continua procurando.
    }
  }
  throw new Error('Nenhuma chamada de "send-option-list" encontrada.');
}

function patchFetchRecorder() {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: init?.body });
    return { ok: true, statusText: 'OK', json: async () => ({}), text: async () => '', clone() { return this; } };
  };
  return calls;
}

test('navegação completa em "Valores por diárias", incluindo "8 diárias ou mais", e retorno nível a nível', async () => {
  const token = 'instancia-A';
  const env = createEnv(token, whatsappInstanceNumber());
  const setup_data = createSetupData(token);
  const calls = patchFetchRecorder();

  // 1) Entra no menu principal.
  await menu.processMessageV2(setup_data.phone, 'menu', setup_data.senderName, env, setup_data);
  let rows = rowsFromLastCall(calls);
  assert.ok(rows.some(r => r.rowId === 'valores'));

  // 2) Seleciona "Valores por diárias" -> lista de temporadas.
  await menu.processMessageV2(setup_data.phone, 'Valores por diárias', setup_data.senderName, env, setup_data, 'valores');
  rows = rowsFromLastCall(calls);
  assert.ok(rows.some(r => r.rowId === 'alta'));

  // 3) Seleciona "Alta temporada" -> lista de faixas de diárias.
  await menu.processMessageV2(setup_data.phone, 'Alta temporada', setup_data.senderName, env, setup_data, 'alta');
  rows = rowsFromLastCall(calls);
  assert.ok(rows.some(r => r.rowId === '8ouMais'));
  assert.ok(rows.some(r => r.rowId === 'ate7'));

  // 4) Seleciona "8 diárias ou mais" -> lista de quantidades.
  await menu.processMessageV2(setup_data.phone, '8 diárias ou mais', setup_data.senderName, env, setup_data, '8ouMais');
  rows = rowsFromLastCall(calls);
  assert.deepEqual(rows.map(r => r.rowId), ['qtd8', 'qtd9', BACK_OPTION_ID]);

  // 5) "Voltar" na lista de quantidades deve reabrir a lista da temporada
  //    correspondente (as faixas de diárias), e NÃO o menu principal.
  await menu.processMessageV2(setup_data.phone, BACK_OPTION_TITLE, setup_data.senderName, env, setup_data, BACK_OPTION_ID);
  rows = rowsFromLastCall(calls);
  assert.deepEqual(rows.map(r => r.rowId), ['8ouMais', 'ate7', BACK_OPTION_ID]);

  // 6) "Voltar" de novo: sobe mais um nível, para a lista de temporadas.
  await menu.processMessageV2(setup_data.phone, BACK_OPTION_TITLE, setup_data.senderName, env, setup_data, BACK_OPTION_ID);
  rows = rowsFromLastCall(calls);
  assert.deepEqual(rows.map(r => r.rowId), ['alta', BACK_OPTION_ID]);

  // 7) "Voltar" de novo: agora sim, o nível imediatamente anterior é o menu principal.
  await menu.processMessageV2(setup_data.phone, BACK_OPTION_TITLE, setup_data.senderName, env, setup_data, BACK_OPTION_ID);
  rows = rowsFromLastCall(calls);
  assert.ok(rows.some(r => r.rowId === 'valores'));
  assert.ok(rows.some(r => r.rowId === 'campings'));

  // 8) Ao selecionar uma quantidade final (item-texto), "Voltar" deve reabrir
  //    a lista de quantidades que a contém (o nível imediatamente anterior).
  await menu.processMessageV2(setup_data.phone, 'Valores por diárias', setup_data.senderName, env, setup_data, 'valores');
  await menu.processMessageV2(setup_data.phone, 'Alta temporada', setup_data.senderName, env, setup_data, 'alta');
  await menu.processMessageV2(setup_data.phone, '8 diárias ou mais', setup_data.senderName, env, setup_data, '8ouMais');
  await menu.processMessageV2(setup_data.phone, '8 diárias', setup_data.senderName, env, setup_data, 'qtd8');
  // A resposta final usa o botão fixo de "Voltar" do sendMessageV2 (sem rowId selecionável aqui).
  await menu.processMessageV2(setup_data.phone, BACK_OPTION_TITLE, setup_data.senderName, env, setup_data, BACK_OPTION_ID);
  rows = rowsFromLastCall(calls);
  assert.deepEqual(rows.map(r => r.rowId), ['qtd8', 'qtd9', BACK_OPTION_ID]);
});

test('lista simples ("Campings homologados"): abre e volta direto ao menu principal', async () => {
  const token = 'instancia-B';
  const env = createEnv(token, whatsappInstanceNumber());
  const setup_data = createSetupData(token);
  const calls = patchFetchRecorder();

  await menu.processMessageV2(setup_data.phone, 'menu', setup_data.senderName, env, setup_data);
  await menu.processMessageV2(setup_data.phone, 'Campings homologados', setup_data.senderName, env, setup_data, 'campings');
  let rows = rowsFromLastCall(calls);
  assert.deepEqual(rows.map(r => r.rowId), ['campingA', BACK_OPTION_ID]);

  await menu.processMessageV2(setup_data.phone, BACK_OPTION_TITLE, setup_data.senderName, env, setup_data, BACK_OPTION_ID);
  rows = rowsFromLastCall(calls);
  assert.ok(rows.some(r => r.rowId === 'campings'));
});

test('"Área Restrita": o retorno respeita o filtro por origem do contato', async () => {
  const token = 'instancia-C';
  const env = createEnv(token, whatsappInstanceNumber());
  const setup_data = createSetupData(token);
  const calls = patchFetchRecorder();

  await menu.processMessageV2(setup_data.phone, 'menu', setup_data.senderName, env, setup_data);
  await menu.processMessageV2(setup_data.phone, '🔐 Area Restrita 🔐', setup_data.senderName, env, setup_data, 'arearestrita');
  let rows = rowsFromLastCall(calls);
  // O contato é da origem "Informado": só deve ver essa opção, nunca "Teste".
  assert.ok(rows.some(r => r.rowId === 'origemInformado'));
  assert.ok(!rows.some(r => r.rowId === 'origemTeste'));

  await menu.processMessageV2(setup_data.phone, 'Informado', setup_data.senderName, env, setup_data, 'origemInformado');
  rows = rowsFromLastCall(calls);
  assert.deepEqual(rows.map(r => r.rowId), ['docA', BACK_OPTION_ID]);

  // "Voltar" reabre a lista filtrada da Área Restrita (mesmo filtro, sem o item "Teste").
  await menu.processMessageV2(setup_data.phone, BACK_OPTION_TITLE, setup_data.senderName, env, setup_data, BACK_OPTION_ID);
  rows = rowsFromLastCall(calls);
  assert.ok(rows.some(r => r.rowId === 'origemInformado'));
  assert.ok(!rows.some(r => r.rowId === 'origemTeste'));
});

test('"Menu" sempre vai direto à raiz, mesmo em navegação profunda, e distintas instâncias/contatos não se misturam', async () => {
  const token = 'instancia-D';
  const envA = createEnv(token, whatsappInstanceNumber());
  const setupA = createSetupData(token);
  const callsA = patchFetchRecorder();

  await menu.processMessageV2(setupA.phone, 'menu', setupA.senderName, envA, setupA);
  await menu.processMessageV2(setupA.phone, 'Valores por diárias', setupA.senderName, envA, setupA, 'valores');
  await menu.processMessageV2(setupA.phone, 'Alta temporada', setupA.senderName, envA, setupA, 'alta');

  // "Menu" explícito, mesmo navegado profundamente, volta direto à raiz.
  await menu.processMessageV2(setupA.phone, 'menu', setupA.senderName, envA, setupA);
  let rows = rowsFromLastCall(callsA);
  assert.ok(rows.some(r => r.rowId === 'valores'));

  // Histórico de um contato/instância não deve interferir no de outro contato
  // na mesma instância, nem no de outra instância.
  const outroContato = { ...setupA, phone: '5511777777777' };
  const semHistorico = await menu.processMessageV2(outroContato.phone, BACK_OPTION_TITLE, outroContato.senderName, envA, outroContato, BACK_OPTION_ID);
  rows = rowsFromLastCall(callsA);
  // Sem histórico para este contato: cai em segurança no menu principal.
  assert.ok(rows.some(r => r.rowId === 'valores'));
  assert.equal(semHistorico.status, 200);
});
