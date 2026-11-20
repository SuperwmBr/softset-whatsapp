// Histórico de navegação do menu (hierarquia de listas/submenus), usado para
// que o botão "Voltar" reabra exatamente a lista exibida imediatamente antes,
// em vez de ir direto ao menu principal.
//
// O histórico é guardado no KV MENU_STORAGE (mesmo binding já usado para
// armazenar o menu do gestor), em uma chave isolada por instância (token/app_key)
// e contato (telefone), para que navegações de usuários/números diferentes nunca
// se misturem. Guardamos apenas o necessário para reconstruir a posição atual:
// a pilha (stack) de IDs dos itens ancestrais e se a última tela exibida foi a
// resposta final de um item (onLeaf) ou uma lista de opções.

import { BACK_OPTION_ID, BACK_OPTION_TITLE } from './menu-trigger.js';

const LEGACY_BACK_OPTION_TITLE = '⏮️ voltar ao menu';

// Histórico abandonado expira em 24 horas de inatividade. Se o contato voltar
// a escrever depois disso sem um histórico válido, o fallback de getMenuHistory
// (null) faz a navegação cair em segurança no menu principal.
export const MENU_HISTORY_TTL_SECONDS = 24 * 60 * 60;

export function menuHistoryKey(token, phone) {
  return `nav:${token}:${phone}`;
}

// Lê o histórico salvo no KV. Qualquer valor ausente, corrompido ou em um
// formato inesperado resulta em `null` — o chamador deve então cair em
// segurança no menu principal. Histórico ausente/inválido/expirado nunca pode
// travar o atendimento.
export async function getMenuHistory(env, token, phone) {
  try {
    const raw = await env.MENU_STORAGE.get(menuHistoryKey(token, phone));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.stack)) return null;
    return { stack: parsed.stack.map(String), onLeaf: Boolean(parsed.onLeaf) };
  } catch (error) {
    console.log('[menu-history] Histórico inválido/corrompido; aplicando fallback para o menu principal.', error);
    return null;
  }
}

export async function saveMenuHistory(env, token, phone, state) {
  try {
    const payload = JSON.stringify({
      stack: Array.isArray(state?.stack) ? state.stack.map(String) : [],
      onLeaf: Boolean(state?.onLeaf),
    });
    await env.MENU_STORAGE.put(menuHistoryKey(token, phone), payload, { expirationTtl: MENU_HISTORY_TTL_SECONDS });
  } catch (error) {
    // Falha ao salvar não deve interromper o atendimento: na pior hipótese o
    // próximo "Voltar" cai no fallback do menu principal.
    console.log('[menu-history] Falha ao salvar o histórico de navegação.', error);
  }
}

export async function clearMenuHistory(env, token, phone) {
  try {
    await env.MENU_STORAGE.delete(menuHistoryKey(token, phone));
  } catch (error) {
    console.log('[menu-history] Falha ao limpar o histórico de navegação.', error);
  }
}

// Localiza um item em qualquer nível da árvore do menu, pelo ID estável.
export function findItemById(items, id) {
  if (id === undefined || id === null || String(id).trim() === '') return null;
  for (const item of items || []) {
    if (item?.id !== undefined && String(item.id) === String(id)) return item;
    if (Array.isArray(item?.children) && item.children.length > 0) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Reconstrói a cadeia de IDs dos itens ancestrais de `targetId` (sem incluir o
// próprio item). Retorna `null` quando o item não é encontrado na árvore.
export function findAncestorPath(items, targetId, trail = []) {
  for (const item of items || []) {
    if (item?.id !== undefined && String(item.id) === String(targetId)) return trail;
    if (Array.isArray(item?.children) && item.children.length > 0) {
      const found = findAncestorPath(item.children, targetId, [...trail, item.id]);
      if (found) return found;
    }
  }
  return null;
}

// Resolve, a partir da raiz do menu, a lista de itens (children) e o item
// correspondente ao final de uma pilha de IDs. Retorna `null` quando algum ID
// da pilha não existe mais na árvore (ex.: opção removida/alterada no gestor),
// para que o chamador caia em segurança no menu principal em vez de travar.
export function resolveStack(menuBase, stack) {
  let items = Array.isArray(menuBase) ? menuBase : [];
  let currentItem = null;
  for (const id of stack || []) {
    const found = items.find(it => it?.id !== undefined && String(it.id) === String(id));
    if (!found) return null;
    currentItem = found;
    items = Array.isArray(found.children) ? found.children : [];
  }
  return { items, currentItem };
}

// Monta as opções de uma lista a partir dos filhos configurados no gestor,
// garantindo uma única opção de retorno ("Voltar") — sem duplicá-la quando a
// própria lista já tiver uma opção equivalente configurada.
export function buildOptionsWithBack(children) {
  const options = (children || []).map(child => ({
    rowId: child.id,
    title: child.title,
    description: ''
  }));

  const jaTemOpcaoDeVoltar = options.some(opt => {
    const idNormalizado = String(opt.rowId ?? '').trim();
    const tituloNormalizado = String(opt.title ?? '').trim().toLowerCase();
    return idNormalizado === BACK_OPTION_ID
      || tituloNormalizado === BACK_OPTION_TITLE.toLowerCase()
      || tituloNormalizado === LEGACY_BACK_OPTION_TITLE;
  });

  if (!jaTemOpcaoDeVoltar) {
    options.push({ rowId: BACK_OPTION_ID, title: BACK_OPTION_TITLE, description: '' });
  }
  return options;
}
