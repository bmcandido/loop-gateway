import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ErroGateway, type ModuloSankhya, type PortaSankhya } from '../src/core/tipos.ts';
import { cnpjDoUsuarioNoSupabase, criarHandlerExpense, type DependenciasExpense, processarExpense, rotaExpense } from '../src/expense/gateway.ts';

const TOKEN = 'token-valido-do-supabase-1234567890';
const CNPJ = '36841880000176';

function montar(extra: Partial<DependenciasExpense> = {}) {
  const chamadas: { servico: string; modulo: ModuloSankhya; corpo: Record<string, unknown>; cnpj: string }[] = [];
  const licencas: string[] = [];
  const deps: DependenciasExpense = {
    validador: {
      async validar(t: string) {
        if (t !== TOKEN) throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão expirada.');
        return { origem: 'SUPABASE', uid: 'uid-1', email: 'a@b.com' };
      },
    },
    cnpjDoUsuario: async () => CNPJ,
    licenca: async (c) => {
      licencas.push(c);
    },
    sankhya: (cnpj): PortaSankhya => ({
      async chamar(servico, modulo, corpo) {
        chamadas.push({ servico, modulo, corpo, cnpj });
        return { status: '1', responseBody: { success: true, data: { ok: 1 } } };
      },
    }),
    ...extra,
  };
  return { deps, chamadas, licencas };
}

const servico = (serviceName: string, requestBody: unknown = {}, authorization?: string, cnpj?: string) => ({
  metodo: 'POST',
  caminho: '/servico',
  authorization,
  cnpj,
  corpo: { serviceName, requestBody },
});

test('recusa o que não é serviço do Expense, sem chamar o Sankhya', async () => {
  for (const nome of ['DbExplorerSP.executeQuery', 'CRUDServiceProvider.saveRecord', 'LoopPortalAppSP.meuUsuario', 'LoopExpenseSessaoSP.doX;drop', '']) {
    const { deps, chamadas } = montar();
    const r = await processarExpense(servico(nome, {}, `Bearer ${TOKEN}`), deps);
    assert.equal(r.status, 403);
    assert.equal((r.corpo as Record<string, unknown>).codigoGateway, 'SERVICO_NAO_PERMITIDO');
    assert.equal(chamadas.length, 0);
  }
});

test('serviço de usuário exige login e não abre sessão de integração sem token', async () => {
  const { deps, chamadas } = montar();
  const r = await processarExpense(servico('LoopExpenseConfigSP.doSalvarUsuario', { sessaoToken: TOKEN }), deps);
  assert.equal(r.status, 401);
  assert.equal(chamadas.length, 0);
  const invalido = await processarExpense(servico('LoopExpenseConfigSP.doSalvarUsuario', {}, 'Bearer token-falso-mas-comprido-o-bastante'), deps);
  assert.equal(invalido.status, 401);
  assert.equal(chamadas.length, 0);
});

test('o token conferido substitui o sessaoToken enviado no corpo', async () => {
  const { deps, chamadas } = montar();
  const r = await processarExpense(servico('LoopExpenseDespesaSP.doListar', { sessaoToken: 'de-outra-pessoa', busca: 'x' }, `Bearer ${TOKEN}`), deps);
  assert.equal(r.status, 200);
  assert.equal(chamadas[0].corpo.sessaoToken, TOKEN);
  assert.equal(chamadas[0].corpo.busca, 'x');
  assert.equal(chamadas[0].modulo, 'loop-expense');
});

test('a empresa vem da conta, não do cabeçalho', async () => {
  const { deps, chamadas } = montar();
  await processarExpense(servico('LoopExpenseDespesaSP.doListar', {}, `Bearer ${TOKEN}`, '11111111000111'), deps);
  assert.equal(chamadas[0].cnpj, CNPJ);
});

test('conta sem empresa é recusada', async () => {
  const { deps, chamadas } = montar({ cnpjDoUsuario: async () => undefined });
  const r = await processarExpense(servico('LoopExpenseDespesaSP.doListar', {}, `Bearer ${TOKEN}`), deps);
  assert.equal(r.status, 403);
  assert.equal((r.corpo as Record<string, unknown>).codigoGateway, 'USUARIO_SEM_EMPRESA');
  assert.equal(chamadas.length, 0);
});

test('verificar cadastro funciona sem login, na empresa escolhida, e sem sessaoToken', async () => {
  const { deps, chamadas, licencas } = montar();
  const r = await processarExpense(servico('LoopExpenseSessaoSP.doVerificarCadastro', { email: 'a@b.com', sessaoToken: 'x' }, undefined, '36.841.880/0001-76'), deps);
  assert.equal(r.status, 200);
  assert.deepEqual(licencas, [CNPJ]);
  assert.equal(chamadas[0].cnpj, CNPJ);
  assert.equal('sessaoToken' in chamadas[0].corpo, false);
  const sem = await processarExpense(servico('LoopExpenseSessaoSP.doVerificarCadastro', { email: 'a@b.com' }), montar().deps);
  assert.equal(sem.status, 400);
});

test('licença inativa barra antes do Sankhya, inclusive no serviço público', async () => {
  const licenca = async () => {
    throw new ErroGateway(403, 'LICENCA_INATIVA', 'Licença inativa.');
  };
  const u = montar({ licenca });
  assert.equal((await processarExpense(servico('LoopExpenseDespesaSP.doListar', {}, `Bearer ${TOKEN}`), u.deps)).status, 403);
  assert.equal(u.chamadas.length, 0);
  const p = montar({ licenca });
  assert.equal((await processarExpense(servico('LoopExpenseSessaoSP.doVerificarCadastro', {}, undefined, CNPJ), p.deps)).status, 403);
  assert.equal(p.chamadas.length, 0);
});

test('erro inesperado não expõe detalhe e o registro não leva corpo', async () => {
  const eventos: unknown[] = [];
  const { deps } = montar({
    sankhya: () => ({
      async chamar() {
        throw new Error('segredo interno');
      },
    }),
    registrar: (e) => eventos.push(e),
  });
  const r = await processarExpense(servico('LoopExpenseDespesaSP.doListar', { dado: 'sensivel' }, `Bearer ${TOKEN}`), deps);
  assert.equal(r.status, 500);
  assert.equal(JSON.stringify(r.corpo).includes('segredo'), false);
  assert.equal(JSON.stringify(eventos).includes('sensivel'), false);
});

test('rota, saúde e CORS', async () => {
  assert.equal(rotaExpense('/functions/v1/expense-gateway/servico'), '/servico');
  assert.equal(rotaExpense('/expense-gateway'), '/');
  const { deps } = montar();
  const h = criarHandlerExpense({ supabaseUrl: 'https://x.supabase.co', supabaseChave: 'chave', sobrescrever: deps });
  assert.equal((await h(new Request('https://x/functions/v1/expense-gateway/saude'))).status, 200);
  const pre = await h(new Request('https://x/functions/v1/expense-gateway/servico', { method: 'OPTIONS', headers: { origin: 'https://app.exemplo' } }));
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /X-Loop-Cnpj/);
  const r = await h(new Request('https://x/functions/v1/expense-gateway/servico', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ serviceName: 'LoopExpenseDespesaSP.doListar', requestBody: {} }),
  }));
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as Record<string, unknown>).status, '1');
});

test('empresa da conta: lê pelo id, guarda em cache e não aceita linha vazia', async () => {
  const pedidos: string[] = [];
  const http = (async (url: string | URL | Request) => {
    pedidos.push(String(url));
    const uid = new URL(String(url)).searchParams.get('idUsuario');
    return new Response(JSON.stringify(uid === 'eq.uid-1' ? [{ cpfCnpj: CNPJ }] : []), { status: 200 });
  }) as typeof fetch;
  const f = cnpjDoUsuarioNoSupabase({ url: 'https://x.supabase.co', chave: 'chave', http });
  assert.equal(await f('uid-1'), CNPJ);
  assert.equal(await f('uid-1'), CNPJ);
  assert.equal(pedidos.length, 1);
  assert.equal(await f('uid-2'), undefined);
});
