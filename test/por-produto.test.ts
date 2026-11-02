import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DependenciasGateway, processar } from '../src/core/gateway.ts';
import { verificadorPorProduto } from '../src/core/licenca-app.ts';
import { ErroGateway } from '../src/core/tipos.ts';
import { vendedorPorEmail } from '../src/core/vendedor.ts';
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

const FULANO = { uid: 'u1', email: 'vendedor@loja.com', origem: 'SUPABASE', emailVerificado: true };
const NATIVO = 'CACSP.incluirNota';

function comVendedor(ativo: boolean | null) {
  const m = montar(['LoopEcommerce']);
  m.deps.validador = { validar: async () => FULANO } as never;
  m.deps.vendedorAtivo = ativo === null ? undefined : async () => ativo;
  return m;
}
const logado = (serviceName: string, deps: DependenciasGateway) =>
  processar({ metodo: 'POST', caminho: '/servico', licenca: 'JWS', authorization: `Bearer ${'x'.repeat(30)}`, corpo: { serviceName, requestBody: {} } }, deps);

test('sem login nada da força de vendas passa', async () => {
  const { deps, chamadas } = montar(['LoopEcommerce']);
  for (const s of [NATIVO, 'DbExplorerSP.executeQuery', 'LoopEcommerceConfigSP.doConsultar', 'LoopEcommerceConsultaProdutosSP.doConsultar']) {
    assert.equal((await pedir(s, deps)).status, 401);
  }
  assert.equal(chamadas.length, 0);
});

test('login sem vínculo de vendedor é recusado, e o vendedor entra no contexto certo', async () => {
  const fora = comVendedor(false);
  const r = await logado(NATIVO, fora.deps);
  assert.equal(r.status, 403);
  assert.equal((r.corpo as { codigoGateway: string }).codigoGateway, 'SEM_VINCULO_VENDEDOR');
  assert.equal(fora.chamadas.length, 0);
  assert.equal((await logado(NATIVO, comVendedor(null).deps)).status, 403);

  const dentro = comVendedor(true);
  assert.equal((await logado(NATIVO, dentro.deps)).status, 200);
  assert.equal((await logado('DbExplorerSP.executeQuery', dentro.deps)).status, 200);
  assert.deepEqual(dentro.chamadas, [
    { servico: NATIVO, modulo: 'mgecom' },
    { servico: 'DbExplorerSP.executeQuery', modulo: 'mge' },
  ]);
});

test('segredos, telas administrativas e serviços desconhecidos ficam fora até para o vendedor', async () => {
  const { deps, chamadas } = comVendedor(true);
  for (const s of [
    'LoopEcommerceIntegrationSecretsSP.doSalvar',
    'LoopEcommerceConfigSP.doSalvar',
    'LoopSupaBaseServiceSP.doConsultar',
    'ActionExecutorSP.executeJava',
    'LoopEcommerceUsersSP.do.Consultar',
    'LoopEcommerceUsersSP.doSalvarAcesso',
    'LoopEcommerceUsersSP.doEnviarRedefinicaoSenha',
    'LoopEcommerceQueryConfigSP.doSalvar',
    'LoopEcommerceBannersSP.doSalvar',
    'LoopEcommerceVitrinesSP.doSalvar',
    'LoopEcommerceGoogleMapsSP.doSalvar',
    'LoopEcommerceEmailSP.testarSmtp',
    'LoopEcommerceRelatoriosSP.doExcluir',
    'LoopEcommerceProdutosSP.doSalvar',
  ]) {
    assert.equal((await logado(s, deps)).status, 403, s);
  }
  assert.equal(chamadas.length, 0);
});

test('a senha de SMTP não volta na configuração do vendedor', async () => {
  const { deps } = comVendedor(true);
  deps.sankhya = () => ({
    async chamar() {
      return { status: '1', responseBody: { data: { codEmp: 1, smtpPass: 'x', loopChaveCliente: 'y' } } };
    },
  }) as never;
  const r = await logado('LoopEcommerceConfigSP.doConsultar', deps);
  assert.deepEqual((r.corpo as { responseBody: unknown }).responseBody, { data: { codEmp: 1 } });
});

test('visitante não alcança catálogo e imagens, e lê os dados públicos da loja', async () => {
  const { deps, chamadas } = montar(['LoopEcommerce']);
  for (const s of ['LoopEcommerceConsultaProdutosSP.doConsultar', 'LoopEcommeceHelperControllerSP.doConsultarImagensProduto', 'LoopEcommeceHelperControllerSP.doConsultarImagensProdutosLista']) {
    assert.equal((await pedir(s, deps)).status, 401);
  }
  assert.equal(chamadas.length, 0);
  assert.equal((await pedir('LoopEcommerceConfigSP.doLojaPublica', deps)).status, 200);
});

test('consulta do vendedor: resultado por e-mail, com cache, e falha não vira "não é vendedor"', async () => {
  let consultas = 0;
  let resposta: unknown = { status: '1', responseBody: { rows: [[1]] } };
  const consulta = vendedorPorEmail(() => ({ chamar: async () => { consultas++; return resposta; } }) as never);
  assert.equal(await consulta(CNPJ, 'a@b.com'), true);
  assert.equal(await consulta(CNPJ, 'A@B.COM '), true);
  assert.equal(consultas, 1);
  assert.equal(await consulta(CNPJ, "x'or'1@b.com"), false);
  // "ı" e "ſ" viram "I" e "S" em maiúsculas: domínio parecido não casa com o verdadeiro.
  assert.equal(await consulta(CNPJ, 'vendedor@l\u0131nk.com'), false);
  assert.equal(await consulta(CNPJ, 'vendedor@\u017Fite.com'), false);
  assert.equal(consultas, 1);
  resposta = { status: '1', responseBody: { rows: [] } };
  assert.equal(await consulta(CNPJ, 'c@d.com'), false);
  resposta = { status: '0' };
  await assert.rejects(consulta(CNPJ, 'e@f.com'));
});

test('verificador real: confere o JWS contra o produto do serviço', async () => {
  const verificar = verificadorPorProduto([LICENCA_TESTE]);
  const ecommerce = licencaDe(CNPJ, [{ active: true, produto_id: '5c2a1fe8-aab1-42c3-aa8e-c1e93cd6b6a2' }]);
  assert.deepEqual(await verificar(ecommerce, 'LoopEcommerce'), { cnpj: CNPJ });
  await assert.rejects(verificar(ecommerce, 'LoopPortal'), (e: ErroGateway) => e.codigo === 'LICENCA_INATIVA');
  await assert.rejects(verificar(ecommerce), (e: ErroGateway) => e.codigo === 'LICENCA_INATIVA');
});
