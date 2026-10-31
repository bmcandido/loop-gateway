import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verificadorLicencaDoApp } from '../src/core/licenca-app.ts';
import { ErroGateway } from '../src/core/tipos.ts';
import { LICENCA_TESTE, licencaAssinada, licencaDe, PORTAL } from './fixtures.ts';

const verificar = verificadorLicencaDoApp([LICENCA_TESTE]);

async function codigo(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    assert.ok(e instanceof ErroGateway);
    return e.codigo;
  }
}

test('licença assinada válida: devolve o CNPJ (só dígitos)', async () => {
  assert.deepEqual(await verificar(licencaDe('36.841.880/0001-76')), { cnpj: '36841880000176' });
  assert.deepEqual(await verificar(licencaDe('26314062000161', [{ slug: 'LoopPortal' }])), { cnpj: '26314062000161' });
});

test('sem licença, malformada, alterada ou de chave desconhecida: recusada', async () => {
  assert.equal(await codigo(verificar(undefined)), 'LICENCA_AUSENTE');
  assert.equal(await codigo(verificar('abc')), 'LICENCA_INVALIDA');
  const boa = licencaDe('36841880000176');
  const [cab, corpo, sig] = boa.split('.');
  // troca o CNPJ no conteúdo mantendo a assinatura
  const outro = Buffer.from(JSON.stringify({ ver: 1, empresa: { cnpj: '11111111000111' }, licenca: { status: 'ativo', produtos: [PORTAL] } })).toString('base64url');
  assert.equal(await codigo(verificar(`${cab}.${outro}.${sig}`)), 'LICENCA_INVALIDA');
  assert.equal(await codigo(verificar(`${cab}.${corpo}.${sig.slice(0, -4)}AAAA`)), 'LICENCA_INVALIDA');
  assert.equal(await codigo(verificar(licencaAssinada({ empresa: { cnpj: '36841880000176' }, licenca: { status: 'ativo', produtos: [PORTAL] } }, 'kid-desconhecido'))), 'LICENCA_INVALIDA');
  // alg diferente de ES256 nunca é aceito
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'loop-licenca+jws', kid: LICENCA_TESTE.kid })).toString('base64url');
  assert.equal(await codigo(verificar(`${none}.${corpo}.${sig}`)), 'LICENCA_INVALIDA');
});

test('licença sem o produto, com produto inativo ou contrato cancelado: LICENCA_INATIVA', async () => {
  assert.equal(await codigo(verificar(licencaDe('36841880000176', [{ active: true, produto_id: 'outro-produto' }]))), 'LICENCA_INATIVA');
  assert.equal(await codigo(verificar(licencaDe('36841880000176', [{ ...PORTAL, active: false }]))), 'LICENCA_INATIVA');
  assert.equal(await codigo(verificar(licencaDe('36841880000176', [PORTAL], 'cancelado'))), 'LICENCA_INATIVA');
});

test('outro produto (padrão para os demais apps): mesmo verificador, produto configurado', async () => {
  const ecommerce = verificadorLicencaDoApp([LICENCA_TESTE], { ids: ['5c2a1fe8-aab1-42c3-aa8e-c1e93cd6b6a2'], slug: 'LoopEcommerce' });
  const lic = licencaDe('36841880000176', [{ active: true, produto_id: '5c2a1fe8-aab1-42c3-aa8e-c1e93cd6b6a2' }]);
  assert.deepEqual(await ecommerce(lic), { cnpj: '36841880000176' });
  assert.equal(await codigo(verificar(lic)), 'LICENCA_INATIVA', 'licença do e-commerce não abre o portal');
});
