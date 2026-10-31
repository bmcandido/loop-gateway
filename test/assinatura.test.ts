import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import { assinadorV2, chavePrivadaGateway, mensagemV2 } from '../src/core/assinatura.ts';
import { GATEWAY_TESTE } from './fixtures.ts';

const ANA = { origem: 'FIREBASE' as const, uid: 'uidTeste123', email: 'ana@loop.com.br' };
const publica = createPublicKey({ key: GATEWAY_TESTE.jwk, format: 'jwk' });
const confere = (msg: string, sig: string) =>
  verify('sha256', Buffer.from(msg), { key: publica, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));

test('v2: mensagem com CNPJ; vetor de referência (o mesmo do GatewayAssinaturaTest.java) confere', () => {
  const m = mensagemV2('36841880000176', 'FIREBASE', 'uidTeste123', 'ana@loop.com.br', 1760000000);
  assert.equal(m, 'v2\n36841880000176\nFIREBASE\nuidTeste123\nana@loop.com.br\n1760000000');
  assert.ok(confere(m, GATEWAY_TESTE.sigReferencia));
});

test('v2: assinador gera identidade que a chave pública confere; segundos inteiros', async () => {
  const assinar = assinadorV2(await chavePrivadaGateway(GATEWAY_TESTE.privada), GATEWAY_TESTE.kid);
  const a = await assinar(ANA, '36841880000176', 1760000000.9);
  assert.deepEqual({ ...a, sig: '' }, { v: 2, kid: 'loop-gateway-teste', cnpj: '36841880000176', ...ANA, ts: 1760000000, sig: '' });
  assert.equal(Buffer.from(a.sig, 'base64url').length, 64);
  assert.ok(confere(mensagemV2(a.cnpj, a.origem, a.uid, a.email, a.ts), a.sig));
  // a mesma assinatura não vale para outro CNPJ
  assert.ok(!confere(mensagemV2('11111111000111', a.origem, a.uid, a.email, a.ts), a.sig));
});

test('chave privada vazia ou inválida é recusada', async () => {
  await assert.rejects(chavePrivadaGateway(''));
  await assert.rejects(chavePrivadaGateway('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'));
});
