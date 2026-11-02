import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DependenciasGateway, processar } from '../src/core/gateway.ts';
import { verificadorPorProduto } from '../src/core/licenca-app.ts';
import { ErroGateway } from '../src/core/tipos.ts';
import { vendedorPorEmail } from '../src/core/vendedor.ts';
import { regraDoServico } from '../src/core/servicos.ts';
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
const logado = (serviceName: string, deps: DependenciasGateway, requestBody: Record<string, unknown> = {}) =>
  processar({ metodo: 'POST', caminho: '/servico', licenca: 'JWS', authorization: `Bearer ${'x'.repeat(30)}`, corpo: { serviceName, requestBody } }, deps);

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
  assert.equal((await logado('DbExplorerSP.executeQuery', dentro.deps, { sql: 'SELECT 1 FROM DUAL' })).status, 200);
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
    'BaixaFinanceiroSP.baixarTitulo',
    'AdiantamentoEmprestimoSP.gerarAdiantamentoEmprestimo',
    'CACSP.excluirNotas',
    'CACSP.cancelarNota',
    'CRUDServiceProvider.loadRecords',
    'CRUDServiceProvider.loadView',
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

test('SQL recusado e gravação fora das entidades do app não chegam ao Sankhya', async () => {
  const { deps, chamadas } = comVendedor(true);
  const eventos: { codigo?: string; detalhe?: string }[] = [];
  deps.registrar = (ev) => eventos.push(ev);
  const r = await logado('DbExplorerSP.executeQuery', deps, { sql: 'SELECT SMTPPASS FROM LOOPB2BB2CCONFIG' });
  assert.equal(r.status, 403);
  assert.equal(eventos[0].codigo, 'CONSULTA_RECUSADA');
  assert.equal(eventos[0].detalhe, 'coluna SMTPPASS');
  assert.equal((await logado('DatasetSP.save', deps, { entityName: 'TSIUSU' })).status, 403);
  assert.equal((await logado('DatasetSP.removeRecord', deps, { entityName: 'CabecalhoNota' })).status, 403);
  assert.equal((await logado('CRUDServiceProvider.saveRecord', deps, { dataSet: { rootEntity: 'TGFPAR' } })).status, 403);
  assert.equal(chamadas.length, 0);

  assert.equal((await logado('DatasetSP.save', deps, { entityName: 'CabecalhoNota' })).status, 200);
  assert.equal((await logado('DatasetSP.removeRecord', deps, { entityName: 'LOOPB2BB2CVISITA' })).status, 200);
  assert.equal((await logado('CRUDServiceProvider.saveRecord', deps, { dataSet: { rootEntity: 'LOOPB2BB2CVISITA' } })).status, 200);
  assert.equal(chamadas.length, 3);
});

test('envio de WhatsApp do vendedor vai ao Hub do cliente; métodos antigos saem da lista', () => {
  const regra = regraDoServico('LoopHubMensageriaSP.doEnviarMensagem');
  assert.equal(regra?.modulo, 'loop-whatsapp');
  assert.equal(regra?.acesso, 'VENDEDOR');
  assert.equal(regraDoServico('LoopHubMensageriaSP.registrarEnvioExterno'), undefined);
  assert.equal(regraDoServico('LoopHubMensageriaSP.doReenviarMensagem'), undefined);
});

test('página do Link é pública, no contexto do Add-on, e só com token no formato certo', () => {
  for (const servico of [
    'LoopPaymentLinkPublicoSP.doAbrirLink',
    'LoopPaymentLinkPublicoSP.doConsultar',
    'LoopSecurePaymentSP.doConsultarModo',
    'LoopSecurePaymentSP.doProcessar',
    'LoopSecurePaymentSP.doConsultarStatusPix',
    'LoopSecurePaymentSP.doConsultarImagensPedido',
  ]) {
    const regra = regraDoServico(servico);
    assert.equal(regra?.acesso, 'PUBLICO');
    assert.equal(regra?.modulo, 'loop-link-pagamento');
    assert.equal(regra?.produto, 'LoopPaymentLink');
    assert.equal(regra?.conferir?.({ token: 'AbCdEfGhIjKlMnOpQrStUv' }), null);
    assert.ok(regra?.conferir?.({ token: 'curto' }));
    assert.ok(regra?.conferir?.({ token: "' OR 1=1 --aaaaaaaaaaaa" }));
    assert.ok(regra?.conferir?.({}));
  }
  assert.equal(regraDoServico('LoopPaymentLinkPublicoSP.outroServico'), undefined);
  assert.equal(regraDoServico('LoopSecurePaymentSP.doGerarChave'), undefined);
});

const ABRIR_LINK = 'LoopPaymentLinkPublicoSP.doAbrirLink';
const pedirLink = (token: string, deps: DependenciasGateway) =>
  processar({ metodo: 'POST', caminho: '/servico', licenca: 'JWS', corpo: { serviceName: ABRIR_LINK, requestBody: { token } } }, deps);

test('página do Link vai ao Add-on dele; licença de outro produto e token inválido não chegam ao Sankhya', async () => {
  const comLink = montar(['LoopPaymentLink']);
  assert.equal((await pedirLink('AbCdEfGhIjKlMnOpQrStUv', comLink.deps)).status, 200);
  assert.deepEqual(comLink.chamadas, [{ servico: ABRIR_LINK, modulo: 'loop-link-pagamento' }]);
  assert.deepEqual(comLink.conferidos, ['LoopPaymentLink']);

  const soPortal = montar(['LoopPortal']);
  assert.equal((await pedirLink('AbCdEfGhIjKlMnOpQrStUv', soPortal.deps)).status, 403);
  assert.equal(soPortal.chamadas.length, 0);

  const tokenRuim = montar(['LoopPaymentLink']);
  assert.equal((await pedirLink('12345678901234&OP=CIELO', tokenRuim.deps)).status, 403);
  assert.equal(tokenRuim.chamadas.length, 0);
});
