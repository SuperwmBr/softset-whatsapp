import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMenuTrigger } from '../functions/menu-trigger.js';

test('reconhece o comando e o botão de retorno sem depender da configuração', () => {
  assert.equal(isMenuTrigger(' Menu ', ''), true);
  assert.equal(isMenuTrigger('⏮️ Voltar ao Menu', undefined), true);
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
