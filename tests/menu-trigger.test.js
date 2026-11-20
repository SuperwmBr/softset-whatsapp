import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMenuTrigger, isBackOption, BACK_OPTION_ID, BACK_OPTION_TITLE } from '../functions/menu-trigger.js';

test('reconhece o comando "Menu" sem depender da configuração', () => {
  assert.equal(isMenuTrigger(' Menu ', ''), true);
});

test('reconhece palavras e frases completas configuradas', () => {
  const triggers = 'oi|Olá! Posso ter mais informações sobre isso?|bom dia';
  assert.equal(isMenuTrigger(' OI ', triggers), true);
  assert.equal(isMenuTrigger('olá! posso ter mais informações sobre isso?', triggers), true);
  assert.equal(isMenuTrigger('Bom dia', triggers), true);
});

test('ignora trechos, entradas vazias e mensagens normais', () => {
  assert.equal(isMenuTrigger('oi, preciso de ajuda', 'oi|bom dia'), false);
  assert.equal(isMenuTrigger('boiada', 'oi'), false);
  assert.equal(isMenuTrigger('preços', 'oi|'), false);
  assert.equal(isMenuTrigger('', '||'), false);
  assert.equal(isMenuTrigger('preços', null), false);
});

test('o botão "Voltar" não é mais tratado como o comando "Menu" (vai um nível, não para a raiz)', () => {
  assert.equal(isMenuTrigger(BACK_OPTION_TITLE, ''), false);
  assert.equal(isMenuTrigger('⏮️ Voltar ao Menu', ''), false);
});

test('isBackOption reconhece o ID estável da opção, mesmo com título diferente/ausente', () => {
  assert.equal(isBackOption('qualquer coisa', BACK_OPTION_ID), true);
  assert.equal(isBackOption('', BACK_OPTION_ID), true);
  assert.equal(isBackOption(undefined, BACK_OPTION_ID), true);
});

test('isBackOption reconhece o título do botão quando o ID não é informado (compatibilidade)', () => {
  assert.equal(isBackOption(BACK_OPTION_TITLE, null), true);
  assert.equal(isBackOption(' ⏮️ voltar ', undefined), true);
});

test('isBackOption mantém compatibilidade com o texto antigo do botão', () => {
  assert.equal(isBackOption('⏮️ Voltar ao Menu', null), true);
});

test('isBackOption não confunde o comando "Menu" ou mensagens comuns com o botão "Voltar"', () => {
  assert.equal(isBackOption('menu', null), false);
  assert.equal(isBackOption('oi, preciso de ajuda', null), false);
  assert.equal(isBackOption('', null), false);
  assert.equal(isBackOption('99', '99'), false); // rowId de outros botões (ex.: encerrar chamado) não é o de "Voltar"
});
