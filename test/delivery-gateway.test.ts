import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DependenciasApp } from '../src/core/gateway-app.ts';
import { ErroGateway, type ModuloSankhya, type PortaSankhya } from '../src/core/tipos.ts';
import { criarHandlerDelivery, LIBERADOS, processarDelivery, PRODUTO_DELIVERY } from '../src/delivery/gateway.ts';

const TOKEN = 'token-valido-do-supabase-1234567890';
const CNPJ = '36841880000176';
const PUBLICO = 'LoopDeliveryMotoristaSP.doVerificarCadastro';

function montar(extra: Partial<DependenciasApp> = {}) {
  const chamadas: { servico: string; modulo: ModuloSankhya; corpo: Record<string, unknown>; cnpj: string }[] = [];
  const deps: DependenciasApp = {
    validador: {
      async validar(t: string) {
        if (t !== TOKEN) throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão expirada.');
        return { origem: 'SUPABASE', uid: 'uid-1', email: 'a@b.com' };
      },
    },
    cnpjDoUsuario: async () => CNPJ,
    licenca: async () => undefined,
    sankhya: (cnpj): PortaSankhya => ({
      async chamar(servico, modulo, corpo) {
        chamadas.push({ servico, modulo, corpo, cnpj });
        return { status: '1', responseBody: { success: true, data: { habilitado: true, interno: 'x' } } };
      },
    }),
    ...extra,
  };
  return { deps, chamadas };
}

function servico(serviceName: string, requestBody: unknown = {}, authorization: string | null = `Bearer ${TOKEN}`, cnpj?: string) {
  return { metodo: 'POST', caminho: '/servico', authorization, cnpj, origem: '1.1.1.1', corpo: { serviceName, requestBody } };
}

test('a licença exigida é a do LoopDelivery', () => {
  assert.equal(PRODUTO_DELIVERY, 'LoopDelivery');
});

test('a lista só tem serviços do Add-on do Delivery, nomeados um a um', () => {
  for (const nome of LIBERADOS) {
    assert.match(nome, /^LoopDelivery[A-Za-z]+SP\.do[A-Z][A-Za-z]+$/, nome);
  }
});

test('libera os serviços do app, no contexto do add-on, com o token conferido', async () => {
  for (const nome of LIBERADOS) {
    if (nome === PUBLICO) continue;
    const { deps, chamadas } = montar();
    const r = await processarDelivery(servico(nome, { sessaoToken: 'de-outra-pessoa', motoristaToken: 'x' }), deps);
    assert.equal(r.status, 200, nome);
    assert.equal(chamadas[0].modulo, 'loop-delivery');
    assert.equal(chamadas[0].corpo.sessaoToken, TOKEN, nome);
    assert.equal(chamadas[0].cnpj, CNPJ);
  }
});

test('serviços das telas do Sankhya, nativos e SQL não passam, mesmo com login', async () => {
  for (const nome of [
    'LoopDeliveryUsersSP.doSalvar',
    'LoopDeliveryUsersSP.doExcluir',
    'LoopDeliveryUsersSP.doConsultar',
    'LoopDeliveryUsersSP.doExcluirSupabase',
    'LoopDeliveryConfigSP.doSalvar',
    'LoopDeliveryConfigSP.doSalvarIdentidadeVisual',
    'LoopDeliveryConfigSP.doConsultarAppMotorista',
    'LoopDeliverySmtpSP.doSalvar',
    'LoopDeliveryFormacaoCargasSP.doConfirmar',
    'LoopDeliveryMotoristaSP.doQualquerCoisa',
    'DbExplorerSP.executeQuery',
    'CACSP.incluirNota',
    'CACSP.confirmarNota',
    'DatasetSP.save',
    'CRUDServiceProvider.saveRecord',
    'SelecaoDocumentoSP.faturar',
    'MobileLoginSP.login',
    'LoopProducaoFilaSP.doListar',
    'LoopStokConsultaSP.doExecutar',
  ]) {
    const { deps, chamadas } = montar();
    const r = await processarDelivery(servico(nome), deps);
    assert.equal(r.status, 403, nome);
    assert.equal((r.corpo as Record<string, unknown>).codigoGateway, 'SERVICO_NAO_PERMITIDO');
    assert.equal(chamadas.length, 0);
  }
});

test('sem login, nada além do serviço público chega ao Sankhya', async () => {
  const { deps, chamadas } = montar();
  const r = await processarDelivery(servico('LoopDeliveryMotoristaSP.doMeusDados', { codParc: 1 }, null), deps);
  assert.equal(r.status, 401);
  assert.equal((r.corpo as Record<string, unknown>).codigoGateway, 'LOGIN_NECESSARIO');
  assert.equal(chamadas.length, 0);
});

test('token forjado é recusado antes do Sankhya', async () => {
  const { deps, chamadas } = montar();
  const r = await processarDelivery(servico('LoopDeliveryMotoristaSP.doMeusDados', {}, 'Bearer token-forjado-de-outra-pessoa-123'), deps);
  assert.equal(r.status, 401);
  assert.equal(chamadas.length, 0);
});

test('a empresa sai da conta, e não do cabeçalho', async () => {
  const { deps, chamadas } = montar();
  await processarDelivery(servico('LoopDeliveryMotoristaSP.doMeusDados', {}, `Bearer ${TOKEN}`, '11111111111111'), deps);
  assert.equal(chamadas[0].cnpj, CNPJ);
});

test('licença inativa não chega ao Sankhya', async () => {
  const { deps, chamadas } = montar({
    licenca: async () => {
      throw new ErroGateway(403, 'LICENCA_INATIVA', 'Sem licença.');
    },
  });
  const r = await processarDelivery(servico('LoopDeliveryMotoristaSP.doMeusDados'), deps);
  assert.equal(r.status, 403);
  assert.equal(chamadas.length, 0);
});

test('conferir cadastro não exige login e devolve só habilitado', async () => {
  const { deps, chamadas } = montar();
  const r = await processarDelivery(servico(PUBLICO, { email: 'a@b.com', sessaoToken: 'x' }, null, CNPJ), deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { status: '1', responseBody: { success: true, data: { habilitado: true } } });
  assert.equal(chamadas[0].cnpj, CNPJ);
  assert.equal(chamadas[0].corpo.sessaoToken, undefined);
});

test('a rota usa o nome da função', async () => {
  const { deps } = montar();
  const handler = criarHandlerDelivery({
    supabaseUrl: 'http://x',
    supabaseChave: 'k',
    sobrescrever: { validador: deps.validador, cnpjDoUsuario: deps.cnpjDoUsuario, licenca: deps.licenca, sankhya: deps.sankhya },
  });
  const saude = await handler(new Request('https://x.supabase.co/functions/v1/delivery-gateway/saude'));
  assert.deepEqual(await saude.json(), { ok: true });
  const r = await handler(
    new Request('https://x.supabase.co/functions/v1/delivery-gateway/servico', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ serviceName: 'LoopDeliveryMotoristaSP.doMeusDados', requestBody: {} }),
    }),
  );
  assert.equal(r.status, 200);
});

test('avisos e registro do aparelho para push passam pelo gateway', () => {
  for (const nome of [
    'LoopDeliveryMensagensSP.doInbox',
    'LoopDeliveryMensagensSP.doContador',
    'LoopDeliveryMensagensSP.doRegistrarDispositivo',
    'LoopDeliveryMensagensSP.doDesativarDispositivo',
  ]) {
    assert.ok(LIBERADOS.has(nome), nome);
  }
});

test('a viagem passa pelo gateway; reabrir prestação e consultas da torre ficam fora', () => {
  for (const nome of [
    'LoopDeliveryConsultaSP.doExecutar',
    'LoopDeliveryEntregaAppSP.doAppRegistrarEvento',
    'LoopDeliveryTrackingSP.doRegistrarPosicoes',
    'LoopDeliveryAnexoNotaSP.doAnexarArquivo',
    'LoopDeliveryAdiantamentoSP.doListarAdiantamentos',
    'LoopDeliveryChecklistSP.doAppPanico',
  ]) {
    assert.ok(LIBERADOS.has(nome), nome);
  }
  for (const nome of [
    'LoopDeliveryAdiantamentoSP.doReabrirPrestacaoDespesa',
    'LoopDeliveryAdiantamentoSP.doAprovarAdiantamento',
    'LoopDeliveryTrackingSP.doConsultarTorreOperacao',
    'LoopDeliveryAnexoNotaSP.doObterAnexo',
  ]) {
    assert.ok(!LIBERADOS.has(nome), nome);
  }
});
