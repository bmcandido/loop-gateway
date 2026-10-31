import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPublicKey, verify } from 'node:crypto';
import { assinadorV2, chavePrivadaGateway, mensagemV2 } from '../src/core/assinatura.ts';
import { GATEWAY_TESTE } from './fixtures.ts';
import { type DependenciasGateway, processar } from '../src/core/gateway.ts';
import { ErroGateway, type EventoGateway, type ModuloSankhya, type PortaSankhya } from '../src/core/tipos.ts';

const ASSINAR = assinadorV2(await chavePrivadaGateway(GATEWAY_TESTE.privada), GATEWAY_TESTE.kid);
const CNPJ_A = '36841880000176';
const CNPJ_B = '26314062000161';
/** Licenças "já conferidas" (a conferência da assinatura tem teste próprio em licenca-app.test.ts). */
const LICENCAS: Record<string, string> = { 'LIC-A': CNPJ_A, 'LIC-B': CNPJ_B };
const TOKEN_OK = 'token-valido-de-teste-1234567890';

interface Chamada {
  serviceName: string;
  modulo: ModuloSankhya;
  body: Record<string, unknown>;
}

function montar(extra: Partial<DependenciasGateway> = {}) {
  const chamadas: Chamada[] = [];
  const eventos: EventoGateway[] = [];
  const cnpjs: string[] = [];
  const sankhya: PortaSankhya = {
    async chamar(serviceName, modulo, body) {
      chamadas.push({ serviceName, modulo, body });
      return { status: '1', responseBody: { success: true } };
    },
  };
  const deps: DependenciasGateway = {
    sankhya: (cnpj) => {
      cnpjs.push(cnpj);
      return sankhya;
    },
    licencaDoApp: async (jws) => {
      const cnpj = jws ? LICENCAS[jws] : undefined;
      if (!cnpj) throw new ErroGateway(401, 'LICENCA_AUSENTE', 'Licença do app não enviada. Atualize a página.');
      return { cnpj };
    },
    licenca: async () => {},
    assinar: ASSINAR,
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
  return { deps, chamadas, eventos, cnpjs, porta: sankhya };
}

const servico = (serviceName: string, requestBody: unknown, authorization?: string, licenca: string | null = 'LIC-A') => ({
  metodo: 'POST',
  caminho: '/servico',
  authorization,
  licenca,
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
  const auth = body._portalAuth as Record<string, string | number>;
  assert.deepEqual({ ...auth, sig: '' }, {
    v: 2,
    kid: 'loop-gateway-teste',
    cnpj: CNPJ_A,
    origem: 'FIREBASE',
    uid: 'uidTeste123',
    email: 'ana@loop.com.br',
    ts: 1760000000,
    sig: '',
  });
  const publica = createPublicKey({ key: GATEWAY_TESTE.jwk, format: 'jwk' });
  const msg = mensagemV2(CNPJ_A, 'FIREBASE', 'uidTeste123', 'ana@loop.com.br', 1760000000);
  assert.ok(verify('sha256', Buffer.from(msg), { key: publica, dsaEncoding: 'ieee-p1363' }, Buffer.from(String(auth.sig), 'base64url')));
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
  assert.equal(chamadas[0].modulo, 'loop-portal', 'serviço de add-on vai no contexto do add-on');
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

test('sem licença no cabeçalho (ou licença inválida) nada passa', async () => {
  const { deps, chamadas } = montar();
  for (const lic of [null, 'LIC-FORJADA']) {
    const r = await processar(servico('LoopPortalVisualSP.doConsultar', {}, undefined, lic), deps);
    assert.equal(r.status, 401);
    assert.equal((r.corpo as { codigoGateway: string }).codigoGateway, 'LICENCA_AUSENTE');
  }
  assert.equal(chamadas.length, 0);
});

test('gateway único: o cliente vem da licença (Sankhya, licença e identidade do CNPJ certo)', async () => {
  const conferidos: string[] = [];
  const { deps, chamadas, cnpjs, eventos } = montar({ licenca: async (c) => void conferidos.push(c) });
  await processar(servico('LoopPortalSacSP.consultarSac', {}, `Bearer ${TOKEN_OK}`, 'LIC-A'), deps);
  await processar(servico('LoopPortalSacSP.consultarSac', {}, `Bearer ${TOKEN_OK}`, 'LIC-B'), deps);
  assert.deepEqual(conferidos, [CNPJ_A, CNPJ_B]);
  assert.deepEqual(cnpjs, [CNPJ_A, CNPJ_B]);
  assert.deepEqual(chamadas.map((c) => (c.body._portalAuth as { cnpj: string }).cnpj), [CNPJ_A, CNPJ_B]);
  assert.deepEqual(eventos.map((e) => e.cnpj), [CNPJ_A, CNPJ_B]);
});

test('erro inesperado não vaza detalhes; evento sem dados pessoais', async () => {
  const { deps, eventos, porta } = montar();
  porta.chamar = async () => {
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

test('resposta do add-on com {"members"}/{"elements"} (Gson de outro classloader) chega normal ao app', async () => {
  const { deps, porta } = montar();
  porta.chamar = async () => ({
    status: '1',
    responseBody: { success: true, data: { members: { codCfg: 1, banners: { elements: [{ members: { id: 7 } }] }, nada: null } } },
  });
  const r = await processar(servico('LoopPortalAppSP.consultarConfig', {}), deps);
  assert.deepEqual((r.corpo as { responseBody: unknown }).responseBody, { success: true, data: { codCfg: 1, banners: [{ id: 7 }], nada: null } });
});
