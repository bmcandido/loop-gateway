import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CNPJ_LOOP, credenciaisDoSupabase } from '../src/core/credenciais.ts';
import { ErroGateway } from '../src/core/tipos.ts';

const CNPJ = '36.841.880/0001-76';

type Tabelas = { clientes?: Record<string, unknown>[]; loopapp?: Record<string, unknown>[] };

function supabaseFalso(tabelas: Tabelas, status = 200) {
  const pedidos: { url: URL; headers: Record<string, string> }[] = [];
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    pedidos.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    const tabela = u.pathname.split('/').pop() as keyof Tabelas;
    // filtra como o PostgREST: coluna=eq.valor
    const linhas = (tabelas[tabela] ?? []).filter((l) =>
      [...u.searchParams].every(([k, v]) => k === 'select' || k === 'limit' || `eq.${l[k]}` === v),
    );
    return new Response(JSON.stringify(linhas), { status });
  }) as typeof fetch;
  return { http, pedidos };
}

const APPS = [
  { cpfCnpj: CNPJ_LOOP, tipoIntegracao: 'producao', clienteId: 'cid-p', clienteSecret: 'cs-p', urlBase: 'https://api.sankhya.com.br' },
  { cpfCnpj: CNPJ_LOOP, tipoIntegracao: 'teste', clienteId: 'cid-t', clienteSecret: 'cs-t', urlBase: 'https://api.sandbox.sankhya.com.br' },
];

const opcoes = (http: typeof fetch, chave = 'jwt-service-role') => ({ url: 'https://ref.supabase.co/', chave, cnpj: CNPJ, http });

test('produção: X-Token do cliente + app OAuth de produção', async () => {
  const { http, pedidos } = supabaseFalso({
    clientes: [{ cpfCnpj: '36841880000176', token: ' xt ', tipoIntegracao: 'producao' }],
    loopapp: APPS,
  });
  const c = await credenciaisDoSupabase(opcoes(http))();
  assert.deepEqual(c, { baseUrl: 'https://api.sankhya.com.br', xToken: 'xt', clientId: 'cid-p', clientSecret: 'cs-p' });
  assert.equal(pedidos[0].url.origin + pedidos[0].url.pathname, 'https://ref.supabase.co/rest/v1/clientes');
  assert.equal(pedidos[0].headers.apikey, 'jwt-service-role');
  assert.equal(pedidos[0].headers.Authorization, 'Bearer jwt-service-role');
});

test('teste: tipoIntegracao do cliente escolhe o app OAuth de teste', async () => {
  const { http } = supabaseFalso({
    clientes: [{ cpfCnpj: '36841880000176', token: 'xt', tipoIntegracao: 'teste' }],
    loopapp: APPS,
  });
  const c = await credenciaisDoSupabase(opcoes(http))();
  assert.equal(c.clientId, 'cid-t');
  assert.equal(c.baseUrl, 'https://api.sandbox.sankhya.com.br');
});

test('teste: X-Token do sandbox quando preenchido; vazio cai no token principal', async () => {
  const comSandbox = supabaseFalso({
    clientes: [{ cpfCnpj: '36841880000176', token: 'xt', tokenSandbox: ' xt-sb ', tipoIntegracao: 'teste' }],
    loopapp: APPS,
  });
  assert.equal((await credenciaisDoSupabase(opcoes(comSandbox.http))()).xToken, 'xt-sb');
  const semSandbox = supabaseFalso({
    clientes: [{ cpfCnpj: '36841880000176', token: 'xt', tokenSandbox: '', tipoIntegracao: 'teste' }],
    loopapp: APPS,
  });
  assert.equal((await credenciaisDoSupabase(opcoes(semSandbox.http))()).xToken, 'xt');
  const producao = supabaseFalso({
    clientes: [{ cpfCnpj: '36841880000176', token: 'xt', tokenSandbox: 'xt-sb', tipoIntegracao: 'producao' }],
    loopapp: APPS,
  });
  assert.equal((await credenciaisDoSupabase(opcoes(producao.http))()).xToken, 'xt');
});

test('chave sb_secret_ vai só no cabeçalho apikey', async () => {
  const { http, pedidos } = supabaseFalso({ clientes: [{ cpfCnpj: '36841880000176', token: 'xt' }], loopapp: APPS });
  await credenciaisDoSupabase(opcoes(http, 'sb_secret_x'))();
  assert.equal(pedidos[0].headers.apikey, 'sb_secret_x');
  assert.equal(pedidos[0].headers.Authorization, undefined);
});

test('cliente ausente, app ausente e campo vazio têm códigos próprios, sem expor valores', async () => {
  const casos: [Tabelas, string][] = [
    [{ loopapp: APPS }, 'CLIENTE_NAO_CADASTRADO'],
    [{ clientes: [{ cpfCnpj: '36841880000176', token: 'xt', tipoIntegracao: 'teste' }], loopapp: [APPS[0]] }, 'LOOPAPP_NAO_CADASTRADO'],
    [{ clientes: [{ cpfCnpj: '36841880000176', token: '' }], loopapp: APPS }, 'CREDENCIAIS_INCOMPLETAS'],
  ];
  for (const [tabelas, codigo] of casos) {
    await assert.rejects(credenciaisDoSupabase(opcoes(supabaseFalso(tabelas).http))(), (e: ErroGateway) => {
      assert.equal(e.codigo, codigo);
      assert.doesNotMatch(e.message, /cid|cs-|xt/);
      return true;
    });
  }
});

test('Supabase recusando a leitura', async () => {
  const { http } = supabaseFalso({}, 401);
  await assert.rejects(credenciaisDoSupabase(opcoes(http))(), (e: ErroGateway) => e.codigo === 'SUPABASE_RECUSOU');
});

test('cache evita nova leitura dentro de 5 minutos', async () => {
  const { http, pedidos } = supabaseFalso({ clientes: [{ cpfCnpj: '36841880000176', token: 'xt' }], loopapp: APPS });
  const fonte = credenciaisDoSupabase(opcoes(http));
  await fonte();
  await fonte();
  assert.equal(pedidos.length, 2);
});

test('configuração inválida é recusada', () => {
  assert.throws(() => credenciaisDoSupabase({ url: 'https://x', chave: 'k', cnpj: '123' }), /PORTAL_CNPJ/);
  assert.throws(() => credenciaisDoSupabase({ url: '', chave: '', cnpj: CNPJ }), /Supabase/);
});
