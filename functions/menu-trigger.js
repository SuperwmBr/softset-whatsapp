// Acionadores são mensagens completas, sem diferenciar maiúsculas ou espaços externos.
export function isMenuTrigger(message, wellcomeMenu) {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'menu' || normalized === '⏮️ voltar ao menu') return true;
  return String(wellcomeMenu || '').split('|')
    .map(keyword => keyword.trim().toLowerCase())
    .some(keyword => keyword && keyword === normalized);
}
