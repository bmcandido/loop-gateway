import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assinar, identidadeAssinada, mensagem } from '../src/core/assinatura.ts';

const SEGREDO = 'segredo-de-teste-com-32-caracteres!!';

test('assina igual ao Add-on (mesmo vetor do GatewayAssinaturaTest.java)', async () => {
  const m = mensagem('FIREBASE', 'uidTeste123', 'ana@loop.com.br', 1760000000);
  assert.equal(await assinar(SEGREDO, m), 'FGCCwpraIiCXRLN3Ag_qHjw--UhcQFk9Jyf1V7xUp_s');
});

test('identidade assinada usa segundos inteiros', async () => {
  const a = await identidadeAssinada({ origem: 'FIREBASE', uid: 'uidTeste123', email: 'ana@loop.com.br' }, SEGREDO, 1760000000.9);
  assert.equal(a.ts, 1760000000);
  assert.equal(a.v, 1);
  assert.equal(a.sig, 'FGCCwpraIiCXRLN3Ag_qHjw--UhcQFk9Jyf1V7xUp_s');
});
