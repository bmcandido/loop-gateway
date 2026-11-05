import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DependenciasApp } from '../src/core/gateway-app.ts';
import { ErroGateway, type ModuloSankhya, type PortaSankhya } from '../src/core/tipos.ts';
import { criarHandlerStok, processarStok, PRODUTO_STOK } from '../src/stok/gateway.ts';

const TOKEN = 'token-valido-do-supabase-1234567890';
const CNPJ = '11222333000181';

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

test('a licença exigida é a do LoopStok', () => {
  assert.equal(PRODUTO_STOK, 'LoopStok');
});

test('libera os serviços do app, no contexto do add-on, com o token conferido', async () => {
  for (const nome of ['LoopStokConfigSP.doConsultar', 'LoopStokConsultaSP.doExecutar', 'LoopStokUsuariosSP.doBuscarFoto', 'LoopStokUsuariosSP.doMeuCadastro']) {
    const { deps, chamadas } = montar();
    const r = await processarStok(servico(nome, { sessaoToken: 'de-outra-pessoa' }), deps);
    assert.equal(r.status, 200, nome);
    assert.equal(chamadas[0].modulo, 'loop-stock');
    assert.equal(chamadas[0].corpo.sessaoToken, TOKEN);
    assert.equal(chamadas[0].cnpj, CNPJ);
  }
});

test('serviços das telas do Sankhya, SQL livre e nativos não passam, mesmo com login', async () => {
  for (const nome of [
    'LoopStokUsuariosSP.doSalvar',
    'LoopStokUsuariosSP.doExcluir',
    'LoopStokUsuariosSP.doConsultar',
    'LoopStokUsuariosSP.doConsultarDisponiveis',
    'LoopStokSmtpSP.doConsultar',
    'LoopStokConfigSP.doSalvar',
    'DbExplorerSP.executeQuery',
    'CACSP.incluirNota',
    'DatasetSP.save',
    'CRUDServiceProvider.removeRecord',
    'LoopExpenseDespesaSP.doListar',
    '',
  ]) {
    const { deps, chamadas } = montar();
    const r = await processarStok(servico(nome), deps);
    assert.equal(r.status, 403, nome);
    assert.equal((r.corpo as Record<string, unknown>).codigoGateway, 'SERVICO_NAO_PERMITIDO');
    assert.equal(chamadas.length, 0);
  }
});

test('sem login, nada além do serviço público chega ao Sankhya', async () => {
  const { deps, chamadas } = montar();
  const r = await processarStok(servico('LoopStokUsuariosSP.doMeuCadastro', {}, null), deps);
  assert.equal(r.status, 401);
  assert.equal((r.corpo as Record<string, unknown>).codigoGateway, 'LOGIN_NECESSARIO');
  assert.equal(chamadas.length, 0);
});

test('a empresa sai da conta, e não do cabeçalho', async () => {
  const { deps, chamadas } = montar();
  await processarStok(servico('LoopStokUsuariosSP.doMeuCadastro', {}, `Bearer ${TOKEN}`, '11444777000161'), deps);
  assert.equal(chamadas[0].cnpj, CNPJ);
});

test('licença inativa não chega ao Sankhya', async () => {
  const { deps, chamadas } = montar({
    licenca: async () => {
      throw new ErroGateway(403, 'LICENCA_INATIVA', 'Sem licença.');
    },
  });
  const r = await processarStok(servico('LoopStokUsuariosSP.doMeuCadastro'), deps);
  assert.equal(r.status, 403);
  assert.equal(chamadas.length, 0);
});

test('conferir cadastro não exige login e devolve só habilitado', async () => {
  const { deps, chamadas } = montar();
  const r = await processarStok(servico('LoopStokUsuariosSP.doVerificarCadastro', { email: 'a@b.com', sessaoToken: 'x' }, null, CNPJ), deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { status: '1', responseBody: { success: true, data: { habilitado: true } } });
  assert.equal(chamadas[0].cnpj, CNPJ);
  assert.equal(chamadas[0].corpo.sessaoToken, undefined);
});

test('a rota usa o nome da função', async () => {
  const { deps } = montar();
  const handler = criarHandlerStok({
    supabaseUrl: 'http://x',
    supabaseChave: 'k',
    sobrescrever: { validador: deps.validador, cnpjDoUsuario: deps.cnpjDoUsuario, licenca: deps.licenca, sankhya: deps.sankhya },
  });
  const saude = await handler(new Request('https://x.supabase.co/functions/v1/stok-gateway/saude'));
  assert.deepEqual(await saude.json(), { ok: true });
  const r = await handler(
    new Request('https://x.supabase.co/functions/v1/stok-gateway/servico', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ serviceName: 'LoopStokUsuariosSP.doMeuCadastro', requestBody: {} }),
    }),
  );
  assert.equal(r.status, 200);
});
