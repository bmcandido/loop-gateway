import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SankhyaCliente, decodificar, repararDuplaCodificacao } from '../src/core/sankhya.ts';
import type { CredenciaisSankhya } from '../src/core/tipos.ts';

interface Pedido {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function fetchFalso(responder: (p: Pedido, n: number) => Response) {
  const pedidos: Pedido[] = [];
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    const p: Pedido = {
      url: String(url),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body as string | undefined,
    };
    pedidos.push(p);
    return responder(p, pedidos.length);
  }) as typeof fetch;
  return { http, pedidos };
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const OAUTH: CredenciaisSankhya = { baseUrl: 'https://api.sankhya.com.br/', xToken: 'xt', clientId: 'cid', clientSecret: 'cs' };
const ehLogin = (p: Pedido) => p.url.endsWith('/authenticate');

test('OAuth: client_credentials com X-Token e sessão reaproveitada', async () => {
  let logins = 0;
  const { http, pedidos } = fetchFalso((p) =>
    ehLogin(p) ? json({ access_token: `oa${++logins}`, expires_in: 300 }) : json({ status: '1', responseBody: { ok: true } }),
  );
  const c = new SankhyaCliente(async () => OAUTH, { http });
  await c.chamar('LoopPortalSacSP.consultarSac', 'mge', { a: 1 });
  await c.chamar('LoopPortalSacSP.consultarSac', 'mge', { a: 2 });

  assert.equal(logins, 1);
  assert.equal(pedidos[0].url, 'https://api.sankhya.com.br/authenticate');
  assert.equal(pedidos[0].headers['X-Token'], 'xt');
  assert.equal(pedidos[0].body, 'grant_type=client_credentials&client_id=cid&client_secret=cs');
  assert.equal(pedidos[1].url, 'https://api.sankhya.com.br/gateway/v1/mge/service.sbr?serviceName=LoopPortalSacSP.consultarSac&outputType=json');
  assert.equal(pedidos[1].headers.Authorization, 'Bearer oa1');
  assert.deepEqual(JSON.parse(pedidos[2].body!), { serviceName: 'LoopPortalSacSP.consultarSac', requestBody: { a: 2 } });
});

test('URL base vem das credenciais (ambiente de teste)', async () => {
  const { http, pedidos } = fetchFalso((p) => (ehLogin(p) ? json({ access_token: 'oa' }) : json({ status: '1' })));
  await new SankhyaCliente(async () => ({ ...OAUTH, baseUrl: 'https://api.sandbox.sankhya.com.br' }), { http }).chamar('X', 'mgecom', {});
  assert.equal(pedidos[0].url, 'https://api.sandbox.sankhya.com.br/authenticate');
  assert.ok(pedidos[1].url.startsWith('https://api.sandbox.sankhya.com.br/gateway/v1/mgecom/'));
});

test('sessão recusada: refaz login uma vez', async () => {
  let logins = 0;
  const { http } = fetchFalso((p) => {
    if (ehLogin(p)) return json({ access_token: `s${++logins}` });
    return p.headers.Authorization === 'Bearer s1' ? json({ status: '3', statusMessage: 'Não autorizado.' }) : json({ status: '1' });
  });
  const r = await new SankhyaCliente(async () => OAUTH, { http }).chamar('X', 'mge', {});
  assert.equal(r.status, '1');
  assert.equal(logins, 2);
});

test('chamadas simultâneas compartilham um único login', async () => {
  let logins = 0;
  const { http } = fetchFalso((p) => (ehLogin(p) ? json({ access_token: `s${++logins}` }) : json({ status: '1' })));
  const c = new SankhyaCliente(async () => OAUTH, { http });
  await Promise.all([1, 2, 3, 4, 5].map(() => c.chamar('X', 'mge', {})));
  assert.equal(logins, 1);
});

test('sessão vencida é renovada', async () => {
  let agora = 0;
  let logins = 0;
  const { http } = fetchFalso((p) => (ehLogin(p) ? json({ access_token: `s${++logins}`, expires_in: 300 }) : json({ status: '1' })));
  const c = new SankhyaCliente(async () => OAUTH, { http, agora: () => agora });
  await c.chamar('X', 'mge', {});
  agora = 5 * 60 * 1000;
  await c.chamar('X', 'mge', {});
  assert.equal(logins, 2);
});

test('falha de login não expõe credenciais', async () => {
  const { http } = fetchFalso(() => json({ error: 'invalid client cid / secret cs' }, 401));
  await assert.rejects(new SankhyaCliente(async () => OAUTH, { http }).chamar('X', 'mge', {}), (e: Error) => {
    assert.doesNotMatch(e.message, /\bcid\b|\bcs\b|secret/);
    return true;
  });
});

test('resposta em ISO-8859-1 do Sankhya chega com acentos corretos', async () => {
  const latin1 = Uint8Array.from([0x53, 0x69, 0x74, 0x75, 0x61, 0xe7, 0xe3, 0x6f]); // "Situação" em ISO-8859-1
  assert.equal(decodificar(latin1), 'Situação');
  assert.equal(decodificar(new TextEncoder().encode('Situação')), 'Situação');

  const corpo = Uint8Array.from([...new TextEncoder().encode('{"status":"1","responseBody":{"rotulo":"Situa'), 0xe7, 0xe3, ...new TextEncoder().encode('o"}}')]);
  const { http } = fetchFalso((p) =>
    ehLogin(p) ? json({ access_token: 'oa' }) : new Response(corpo, { status: 200, headers: { 'content-type': 'application/json;charset=ISO-8859-1' } }),
  );
  const r = (await new SankhyaCliente(async () => OAUTH, { http }).chamar('X', 'loop-portal', {})) as { rotulo?: string; responseBody?: { rotulo?: string } };
  assert.equal(r.rotulo ?? r.responseBody?.rotulo, 'Situação');
});

test('texto convertido duas vezes no Sankhya ("ConfiguraÃ§Ã£o") volta ao normal', () => {
  assert.equal(repararDuplaCodificacao('ConfiguraÃ§Ã£o retornada'), 'Configuração retornada');
  assert.equal(repararDuplaCodificacao('Este e-mail estÃ¡ em mais de um cadastro'), 'Este e-mail está em mais de um cadastro');
  assert.equal(repararDuplaCodificacao('Configuração já certa'), 'Configuração já certa');
  assert.equal(repararDuplaCodificacao('Ação € e Ã§'), 'Ação € e Ã§', 'misto: não mexe');
  const duplo = new TextEncoder().encode('{"m":"SituaÃ§Ã£o"}');
  assert.equal(decodificar(duplo), '{"m":"Situação"}');
});
