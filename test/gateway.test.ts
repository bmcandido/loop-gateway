import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assinar, mensagem } from '../src/core/assinatura.ts';
import { type DependenciasGateway, processar } from '../src/core/gateway.ts';
import { ErroGateway, type EventoGateway, type ModuloSankhya, type PortaSankhya } from '../src/core/tipos.ts';

const SEGREDO = 'segredo-de-teste-com-32-caracteres!!';
const TOKEN_OK = 'token-valido-de-teste-1234567890';

interface Chamada {
  serviceName: string;
  modulo: ModuloSankhya;
  body: Record<string, unknown>;
}

function montar(extra: Partial<DependenciasGateway> = {}) {
  const chamadas: Chamada[] = [];
  const eventos: EventoGateway[] = [];
  const sankhya: PortaSankhya = {
    async chamar(serviceName, modulo, body) {
      chamadas.push({ serviceName, modulo, body });
      return { status: '1', responseBody: { success: true } };
    },
  };
  const deps: DependenciasGateway = {
    segredo: SEGREDO,
    sankhya,
    licenca: async () => {},
    agoraSeg: () => 1760000000,
    registrar: (e) => eventos.push(e),
    validador: {
      async validar(token) {
        if (token !== TOKEN_OK) throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão expirada. Entre novamente.');
        return { origem: 'FIREBASE', uid: 'uidTeste123', email: 'ana@loop.com.br' };
      },
    },
    ...extra,
  };
  return { deps, chamadas, eventos };
}

const servico = (serviceName: string, requestBody: unknown, authorization?: string) => ({
  metodo: 'POST',
  caminho: '/servico',
  authorization,
  corpo: { serviceName, requestBody },
});

test('recusa SQL livre e qualquer serviço fora da lista', async () => {
  const { deps, chamadas } = montar();
  for (const s of ['DbExplorerSP.executeQuery', 'CRUDServiceProvider.loadRecords', 'MobileLoginSP.login', 'toString', '']) {
    const r = await processar(servico(s, { sql: 'SELECT 1 FROM DUAL' }, `Bearer ${TOKEN_OK}`), deps);
    assert.equal(r.status, 403, s);
  }
  assert.equal(chamadas.length, 0);
});

test('renegociação: nativos e gravação pelo app saem; serviço novo recebe a identidade', async () => {
  const { deps, chamadas } = montar();
  for (const s of [
    'ParcelamentoSP.parcelar',
    'RenegociacaoSP.renegociar',
    'AluguelSP.gravaJurosMulta',
    'LoopPortalRenegociacaoSP.confirmarRenegociacao',
  ]) {
    const r = await processar(servico(s, { reneg: {} }, `Bearer ${TOKEN_OK}`), deps);
    assert.equal(r.status, 403, s);
  }
  assert.equal(chamadas.length, 0);

  const r = await processar(
    servico('LoopPortalRenegociarSP.simular', { codCfg: 1, nufins: [10, 11], qtdParcelas: 3 }, `Bearer ${TOKEN_OK}`),
    deps,
  );
  assert.equal(r.status, 200);
  assert.equal(chamadas.length, 1);
  assert.ok(chamadas[0].body._portalAuth, 'identidade assinada');
  assert.deepEqual(chamadas[0].body.nufins, [10, 11]);
});

test('serviço do cliente exige login', async () => {
  const { deps, chamadas } = montar();
  const r = await processar(servico('LoopPortalFinanceiroSP.consultarTitulos', { codCfg: 1, codUsuPortal: 9 }), deps);
  assert.equal(r.status, 401);
  assert.deepEqual(r.corpo, {
    status: '0',
    statusMessage: 'Sessão expirada. Entre novamente.',
    codigoGateway: 'LOGIN_NECESSARIO',
  });
  assert.equal(chamadas.length, 0);
});

test('token inválido é recusado mesmo em serviço público', async () => {
  const { deps, chamadas } = montar();
  const r = await processar(servico('LoopPortalVisualSP.doConsultar', {}, 'Bearer token-forjado-qualquer-xxxxxxxx'), deps);
  assert.equal(r.status, 401);
  assert.equal(chamadas.length, 0);
});

test('injeta identidade assinada e descarta a enviada pelo app', async () => {
  const { deps, chamadas } = montar();
  const forjada = { v: 1, origem: 'FIREBASE', uid: 'x', email: 'outro@x.com', ts: 1, sig: 'x' };
  const r = await processar(
    servico(
      'LoopPortalFinanceiroSP.consultarTitulos',
      { codCfg: 1, codUsuPortal: 999, _portalAuth: forjada, _portalEmail: 'outro@x.com' },
      `Bearer ${TOKEN_OK}`,
    ),
    deps,
  );
  assert.equal(r.status, 200);
  const body = chamadas[0].body;
  assert.equal(body._portalEmail, undefined);
  assert.deepEqual(body._portalAuth, {
    v: 1,
    origem: 'FIREBASE',
    uid: 'uidTeste123',
    email: 'ana@loop.com.br',
    ts: 1760000000,
    sig: await assinar(SEGREDO, mensagem('FIREBASE', 'uidTeste123', 'ana@loop.com.br', 1760000000)),
  });
  // o codUsuPortal segue, mas o Add-on o substitui pelo do e-mail assinado
  assert.equal(body.codUsuPortal, 999);
});

test('visitante em serviço público perde o codUsuPortal', async () => {
  const { deps, chamadas } = montar();
  const r = await processar(servico('LoopPortalBannerSP.doListarAtivos', { codCfg: 1, codUsuPortal: 5, tela: 'LOGIN' }), deps);
  assert.equal(r.status, 200);
  assert.deepEqual(chamadas[0].body, { codCfg: 1, tela: 'LOGIN' });
});

test('documentos: nativos do Sankhya fora; serviço do Add-on recebe a identidade', async () => {
  const { deps, chamadas } = montar();
  for (const s of [
    'BoletoSP.buildPreVisualizacao',
    'VisualizadorRelatorios.visualizarRelatorio',
    'ImpressaoNotasSP.imprimeDocumentos',
    'LoopPortalAppSP.consultarNotaTitulo',
  ]) {
    const r = await processar(servico(s, { nufin: 1 }, `Bearer ${TOKEN_OK}`), deps);
    assert.equal(r.status, 403, s);
  }
  assert.equal(chamadas.length, 0);

  const sem = await processar(servico('LoopPortalDocumentoSP.gerar', { tipo: 'BOLETO', nufin: 1 }), deps);
  assert.equal(sem.status, 401);

  const r = await processar(
    servico('LoopPortalDocumentoSP.gerar', { codCfg: 1, codUsuPortal: 5, tipo: 'BOLETO', nufin: 1 }, `Bearer ${TOKEN_OK}`),
    deps,
  );
  assert.equal(r.status, 200);
  assert.equal(chamadas[0].modulo, 'mge');
  assert.ok(chamadas[0].body._portalAuth, 'identidade assinada');
});

test('corpo inválido e rotas desconhecidas', async () => {
  const { deps } = montar();
  assert.equal((await processar(servico('LoopPortalSacSP.consultarSac', [1, 2], `Bearer ${TOKEN_OK}`), deps)).status, 400);
  assert.equal((await processar({ metodo: 'POST', caminho: '/proxy', corpo: {} }, deps)).status, 404);
  assert.equal((await processar({ metodo: 'GET', caminho: '/servico', corpo: {} }, deps)).status, 405);
  assert.equal((await processar({ metodo: 'GET', caminho: '/saude', corpo: undefined }, deps)).status, 200);
});

test('download por chave saiu (a sessão do ERP é compartilhada)', async () => {
  const { deps } = montar();
  const r = await processar(
    { metodo: 'POST', caminho: '/arquivo', authorization: `Bearer ${TOKEN_OK}`, corpo: { chaveArquivo: 'vRfe_1' } },
    deps,
  );
  assert.equal(r.status, 404);
});

test('pagamento: estado não é gravado pelo cliente; cartão e comprovante seguem', async () => {
  const { deps, chamadas } = montar();
  for (const s of [
    'LoopPortalPagamentoSP.registrarPagamento',
    'LoopPortalPagamentoSP.confirmarPagamento',
    'LoopPortalPagamentoSP.cancelarPagamento',
    'LoopPortalPagamentoSP.negarPagamento',
  ]) {
    const r = await processar(servico(s, { codPag: 1 }, `Bearer ${TOKEN_OK}`), deps);
    assert.equal(r.status, 403, s);
  }
  assert.equal(chamadas.length, 0);

  for (const s of ['LoopPortalPagamentoSP.processarCartao', 'LoopPortalPagamentoSP.enviarComprovante']) {
    const r = await processar(servico(s, { codCfg: 1, nufin: 10 }, `Bearer ${TOKEN_OK}`), deps);
    assert.equal(r.status, 200, s);
  }
  assert.equal(chamadas.length, 2);
});

test('sem segredo configurado nada passa', async () => {
  const { deps, chamadas } = montar({ segredo: 'curto' });
  const r = await processar(servico('LoopPortalVisualSP.doConsultar', {}), deps);
  assert.equal(r.status, 500);
  assert.equal(chamadas.length, 0);
});

test('erro inesperado não vaza detalhes; evento sem dados pessoais', async () => {
  const { deps, eventos } = montar();
  deps.sankhya.chamar = async () => {
    throw new Error('ORA-00942: tabela TGFPAR com senha xyz');
  };
  const r = await processar(servico('LoopPortalSacSP.consultarSac', {}, `Bearer ${TOKEN_OK}`), deps);
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.corpo), /ORA-|senha/);
  const ev = eventos.at(-1)!;
  assert.equal(ev.servico, 'LoopPortalSacSP.consultarSac');
  assert.equal(ev.uid, 'uidTeste123');
  assert.doesNotMatch(JSON.stringify(ev), /ana@loop/);
});

test('licença inativa: nenhum serviço chega ao Sankhya, nem os públicos', async () => {
  const { deps, chamadas } = montar({
    licenca: async () => {
      throw new ErroGateway(403, 'LICENCA_INATIVA', 'Portal sem licença ativa. Entre em contato com a administradora.');
    },
  });
  for (const [s, auth] of [['LoopPortalVisualSP.doConsultar', undefined], ['LoopPortalFinanceiroSP.consultarTitulos', `Bearer ${TOKEN_OK}`]] as const) {
    const r = await processar(servico(s, {}, auth), deps);
    assert.equal(r.status, 403, s);
    assert.equal((r.corpo as { codigoGateway: string }).codigoGateway, 'LICENCA_INATIVA');
  }
  assert.equal(chamadas.length, 0);
  // saúde continua respondendo para monitoramento
  assert.equal((await processar({ metodo: 'GET', caminho: '/saude', corpo: null }, deps)).status, 200);
});
