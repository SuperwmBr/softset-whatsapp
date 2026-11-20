import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findItemById,
  findAncestorPath,
  resolveStack,
  buildOptionsWithBack,
  menuHistoryKey,
  getMenuHistory,
  saveMenuHistory,
  clearMenuHistory,
} from '../functions/menu-history.js';
import { BACK_OPTION_ID, BACK_OPTION_TITLE } from '../functions/menu-trigger.js';

// Árvore de exemplo inspirada em "Valores por diárias" -> temporada ->
// "8 diárias ou mais" -> quantidades, além de um item simples e de um filho
// com uma opção de retorno já configurada pelo gestor.
function buildSampleMenu() {
  return [
    {
      id: 'valores',
      title: 'Valores por diárias',
      text: 'Selecione a temporada',
      children: [
        {
          id: 'alta-temporada',
          title: 'Alta temporada',
          text: 'Selecione a faixa de diárias',
          children: [
            {
              id: '8-ou-mais',
              title: '8 diárias ou mais',
              text: 'Selecione a quantidade',
              children: [
                { id: 'qtd-8', title: '8 diárias', text: 'Valor para 8 diárias', children: [] },
                { id: 'qtd-9', title: '9 diárias', text: 'Valor para 9 diárias', children: [] },
              ],
            },
            {
              id: 'ate-7',
              title: 'Até 7 diárias',
              text: 'Valor até 7 diárias',
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: 'campings',
      title: 'Campings homologados',
      text: 'Selecione o camping',
      children: [
        { id: 'camping-1', title: 'Camping A', text: 'Infos do Camping A', children: [] },
      ],
    },
    {
      id: 'area-com-voltar',
      title: 'Lista com opção de retorno própria',
      text: 'Uma lista que já define seu próprio botão de voltar',
      children: [
        { id: 'item-x', title: 'Item X', text: 'Texto X', children: [] },
        { id: BACK_OPTION_ID, title: BACK_OPTION_TITLE, description: '' },
      ],
    },
  ];
}

test('findItemById localiza um item em qualquer nível da árvore', () => {
  const menu = buildSampleMenu();
  assert.equal(findItemById(menu, '8-ou-mais')?.title, '8 diárias ou mais');
  assert.equal(findItemById(menu, 'qtd-9')?.title, '9 diárias');
  assert.equal(findItemById(menu, 'nao-existe'), null);
  assert.equal(findItemById(menu, null), null);
});

test('findAncestorPath reconstrói a cadeia de IDs ancestrais, sem incluir o próprio item', () => {
  const menu = buildSampleMenu();
  assert.deepEqual(findAncestorPath(menu, 'qtd-9'), ['valores', 'alta-temporada', '8-ou-mais']);
  assert.deepEqual(findAncestorPath(menu, 'valores'), []);
  assert.equal(findAncestorPath(menu, 'nao-existe'), null);
});

test('resolveStack retorna a lista e o item correspondentes a uma pilha de IDs', () => {
  const menu = buildSampleMenu();

  // Pilha vazia = nível raiz.
  const raiz = resolveStack(menu, []);
  assert.equal(raiz.currentItem, null);
  assert.equal(raiz.items, menu);

  // Dentro de "8 diárias ou mais": a lista de quantidades.
  const quantidades = resolveStack(menu, ['valores', 'alta-temporada', '8-ou-mais']);
  assert.equal(quantidades.currentItem.id, '8-ou-mais');
  assert.equal(quantidades.items.length, 2);

  // Um nível acima (a lista da temporada correspondente).
  const temporada = resolveStack(menu, ['valores', 'alta-temporada']);
  assert.equal(temporada.currentItem.id, 'alta-temporada');
  assert.deepEqual(temporada.items.map(i => i.id), ['8-ou-mais', 'ate-7']);
});

test('resolveStack retorna null quando algum ID da pilha não existe mais (ex.: removido no gestor)', () => {
  const menu = buildSampleMenu();
  assert.equal(resolveStack(menu, ['valores', 'id-removido']), null);
});

test('buildOptionsWithBack acrescenta a opção "Voltar" ao final, sem duplicar título/ID existentes', () => {
  const menu = buildSampleMenu();

  const semVoltar = buildOptionsWithBack(menu[1].children); // "Campings homologados"
  assert.equal(semVoltar.length, 2);
  assert.equal(semVoltar.at(-1).rowId, BACK_OPTION_ID);
  assert.equal(semVoltar.at(-1).title, BACK_OPTION_TITLE);

  const comVoltarProprio = buildOptionsWithBack(menu[2].children); // já tem BACK_OPTION_ID configurado
  assert.equal(comVoltarProprio.length, 2); // não duplicou
  assert.equal(comVoltarProprio.filter(o => o.rowId === BACK_OPTION_ID).length, 1);
});

// --- KV fake mínimo, apenas para os testes do histórico em memória ---
function createFakeKv() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    _store: store,
  };
}

test('getMenuHistory retorna null quando não há histórico salvo (fallback seguro)', async () => {
  const env = { MENU_STORAGE: createFakeKv() };
  assert.equal(await getMenuHistory(env, 'token1', '5511999999999'), null);
});

test('saveMenuHistory/getMenuHistory fazem round-trip e isolam por instância (token) e contato (phone)', async () => {
  const env = { MENU_STORAGE: createFakeKv() };

  await saveMenuHistory(env, 'token1', '5511111111111', { stack: ['valores', 'alta-temporada'], onLeaf: false });
  await saveMenuHistory(env, 'token1', '5522222222222', { stack: ['campings'], onLeaf: true });
  await saveMenuHistory(env, 'token2', '5511111111111', { stack: ['area-com-voltar'], onLeaf: false });

  const h1 = await getMenuHistory(env, 'token1', '5511111111111');
  const h2 = await getMenuHistory(env, 'token1', '5522222222222');
  const h3 = await getMenuHistory(env, 'token2', '5511111111111');

  assert.deepEqual(h1, { stack: ['valores', 'alta-temporada'], onLeaf: false });
  assert.deepEqual(h2, { stack: ['campings'], onLeaf: true });
  assert.deepEqual(h3, { stack: ['area-com-voltar'], onLeaf: false });
});

test('getMenuHistory trata JSON corrompido/inválido como ausente (fallback para o menu principal)', async () => {
  const env = { MENU_STORAGE: createFakeKv() };
  await env.MENU_STORAGE.put(menuHistoryKey('token1', '5511999999999'), '{ isso não é json válido');
  assert.equal(await getMenuHistory(env, 'token1', '5511999999999'), null);

  await env.MENU_STORAGE.put(menuHistoryKey('token1', '5511999999998'), JSON.stringify({ foo: 'bar' }));
  assert.equal(await getMenuHistory(env, 'token1', '5511999999998'), null);
});

test('clearMenuHistory remove o histórico salvo', async () => {
  const env = { MENU_STORAGE: createFakeKv() };
  await saveMenuHistory(env, 'token1', '5511999999999', { stack: ['valores'], onLeaf: false });
  await clearMenuHistory(env, 'token1', '5511999999999');
  assert.equal(await getMenuHistory(env, 'token1', '5511999999999'), null);
});
