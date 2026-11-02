import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DependenciasGateway, processar } from '../src/core/gateway.ts';
import { verificadorPorProduto } from '../src/core/licenca-app.ts';
import { ErroGateway } from '../src/core/tipos.ts';
import { LICENCA_TESTE, licencaDe } from './fixtures.ts';

const CNPJ = '36841880000176';
const CARRINHO = 'LoopEcommerceConsumidorAppSP.doConferirCarrinho';
const VISUAL = 'LoopPortalVisualSP.doConsultar';

function montar(produtosDaLicenca: string[]) {
  const chamadas: { servico: string; modulo: string }[] = [];
  const conferidos: (string | undefined)[] = [];
  const deps = {
    validador: { validar: async () => { throw new Error('sem token'); } },
    assinar: async () => { throw new Error('visitante não assina'); },
    licencaDoApp: async (_jws: unknown, produto?: string) => {
      if (!produtosDaLicenca.includes(produto ?? '')) throw new ErroGateway(403, 'LICENCA_INATIVA', 'x');
      return { cnpj: CNPJ };
    },
    licenca: async (_cnpj: string, produto?: string) => { conferidos.push(produto); },
    sankhya: () => ({
      async chamar(servico: string, modulo: string) {
        chamadas.push({ servico, modulo });
        return { status: '1', responseBody: { success: true } };
      },
    }),
  } as unknown as DependenciasGateway;
  return { deps, chamadas, conferidos };
}

const pedir = (serviceName: string, deps: DependenciasGateway) =>
  processar({ metodo: 'POST', caminho: '/servico', licenca: 'JWS', corpo: { serviceName, requestBody: {} } }, deps);

test('serviço do e-commerce vai ao contexto do add-on dele e exige o produto dele', async () => {
  const { deps, chamadas, conferidos } = montar(['LoopEcommerce']);
  assert.equal((await pedir(CARRINHO, deps)).status, 200);
  assert.deepEqual(chamadas, [{ servico: CARRINHO, modulo: 'loop-b2bb2c' }]);
  assert.deepEqual(conferidos, ['LoopEcommerce']);
});

test('serviço do portal continua no contexto e no produto do portal', async () => {
  const { deps, chamadas, conferidos } = montar(['LoopPortal']);
  assert.equal((await pedir(VISUAL, deps)).status, 200);
  assert.deepEqual(chamadas, [{ servico: VISUAL, modulo: 'loop-portal' }]);
  assert.deepEqual(conferidos, ['LoopPortal']);
});

test('licença de um produto não abre o outro', async () => {
  const soPortal = montar(['LoopPortal']);
  assert.equal((await pedir(CARRINHO, soPortal.deps)).status, 403);
  assert.equal(soPortal.chamadas.length, 0);
  const soEcommerce = montar(['LoopEcommerce']);
  assert.equal((await pedir(VISUAL, soEcommerce.deps)).status, 403);
  assert.equal(soEcommerce.chamadas.length, 0);
});

test('e-commerce não libera SQL livre nem serviços nativos', async () => {
  const { deps, chamadas } = montar(['LoopEcommerce']);
  for (const s of ['DbExplorerSP.executeQuery', 'CACSP.incluirNota', 'DatasetSP.save', 'MobileLoginSP.login']) {
    assert.equal((await pedir(s, deps)).status, 403, s);
  }
  assert.equal(chamadas.length, 0);
});

test('verificador real: confere o JWS contra o produto do serviço', async () => {
  const verificar = verificadorPorProduto([LICENCA_TESTE]);
  const ecommerce = licencaDe(CNPJ, [{ active: true, produto_id: '5c2a1fe8-aab1-42c3-aa8e-c1e93cd6b6a2' }]);
  assert.deepEqual(await verificar(ecommerce, 'LoopEcommerce'), { cnpj: CNPJ });
  await assert.rejects(verificar(ecommerce, 'LoopPortal'), (e: ErroGateway) => e.codigo === 'LICENCA_INATIVA');
  await assert.rejects(verificar(ecommerce), (e: ErroGateway) => e.codigo === 'LICENCA_INATIVA');
});

test('vitrine pública: configuração interna, catálogo e imagens de produto ficam fora', async () => {
  const { deps, chamadas } = montar(['LoopEcommerce']);
  for (const proibido of [
    'LoopEcommerceConfigSP.doConsultar',
    'LoopEcommerceUsersSP.doConsultar',
    'LoopEcommerceQueryConfigSP.doConsultar',
    'LoopEcommerceConsultaProdutosSP.doConsultar',
    'LoopEcommeceHelperControllerSP.doConsultarImagensProduto',
    'LoopEcommeceHelperControllerSP.doConsultarImagensProdutosLista',
  ]) {
    assert.equal((await pedir(proibido, deps)).status, 403);
  }
  assert.equal(chamadas.length, 0);
  assert.equal((await pedir('LoopEcommerceConfigSP.doLojaPublica', deps)).status, 200);
});
