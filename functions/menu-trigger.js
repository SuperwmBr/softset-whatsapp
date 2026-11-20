// Acionadores são mensagens completas, sem diferenciar maiúsculas ou espaços externos.

// ID estável da opção "Voltar" (um nível acima na hierarquia do menu).
// É um identificador interno, não depende do título (que pode ser reconfigurado
// no gestor) e nunca deve ser confundido com o comando explícito "Menu".
export const BACK_OPTION_ID = '⏮️_voltar';
export const BACK_OPTION_TITLE = '⏮️ Voltar';

// Texto antigo do botão de retorno (antes desta mudança ele sempre levava
// direto ao menu principal). Mantido apenas como alternativa de compatibilidade,
// para listas já enviadas antes do deploy ou provedores que só repassam o título.
const LEGACY_BACK_OPTION_TITLE = '⏮️ voltar ao menu';

export function isMenuTrigger(message, wellcomeMenu) {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'menu') return true;
  return String(wellcomeMenu || '').split('|')
    .map(keyword => keyword.trim().toLowerCase())
    .some(keyword => keyword && keyword === normalized);
}

// Reconhece a opção/comando "Voltar" (retornar à lista imediatamente anterior).
// Dá prioridade ao ID estável da opção, quando o provedor o informa na resposta
// da lista (ex.: `listResponseMessage.selectedRowId`); usa o título apenas como
// alternativa de compatibilidade, já que títulos podem ser reconfigurados.
export function isBackOption(message, rowId) {
  if (rowId !== undefined && rowId !== null && String(rowId).trim() !== '') {
    if (String(rowId).trim() === BACK_OPTION_ID) return true;
  }
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === BACK_OPTION_TITLE.toLowerCase() || normalized === LEGACY_BACK_OPTION_TITLE;
}
