import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SankhyaCliente } from '../src/core/sankhya.ts';
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

const LEGADO: CredenciaisSankhya = { modo: 'LOGIN', xToken: 'xt', appKey: 'ak', usuario: 'u', senha: 's' };
const OAUTH: CredenciaisSankhya = { modo: 'OAUTH', xToken: 'xt', clientId: 'cid', clientSecret: 'cs' };

test('login legado: cabeçalhos do API Gateway e sessão reaproveitada', async () => {
  let logins = 0;
  const { http, pedidos } = fetchFalso((p) => {
    if (p.url.endsWith('/login')) {
      logins++;
      return json({ bearerToken: `sess${logins}` });
    }
    return json({ status: '1', responseBody: { ok: true } });
  });
  const c = new SankhyaCliente(async () => LEGADO, { http });
  await c.chamar('LoopPortalSacSP.consultarSac', 'mge', { a: 1 });
  await c.chamar('LoopPortalSacSP.consultarSac', 'mge', { a: 2 });

  assert.equal(logins, 1);
  assert.deepEqual(pedidos[0].headers, { 'Content-Type': 'application/json', token: 'xt', appkey: 'ak', username: 'u', password: 's' });
  assert.equal(pedidos[1].url, 'https://api.sankhya.com.br/gateway/v1/mge/service.sbr?serviceName=LoopPortalSacSP.consultarSac&outputType=json');
  assert.equal(pedidos[1].headers.Authorization, 'Bearer sess1');
  assert.deepEqual(JSON.parse(pedidos[2].body!), { serviceName: 'LoopPortalSacSP.consultarSac', requestBody: { a: 2 } });
});

test('OAuth: client_credentials com X-Token', async () => {
  const { http, pedidos } = fetchFalso((p) =>
    p.url.endsWith('/authenticate') ? json({ access_token: 'oa', expires_in: 300 }) : json({ status: '1' }),
  );
  await new SankhyaCliente(async () => OAUTH, { http }).chamar('X', 'mge', {});
  assert.equal(pedidos[0].headers['X-Token'], 'xt');
  assert.equal(pedidos[0].body, 'grant_type=client_credentials&client_id=cid&client_secret=cs');
  assert.equal(pedidos[1].headers.Authorization, 'Bearer oa');
});

test('sessão recusada: refaz login uma vez', async () => {
  let logins = 0;
  const { http } = fetchFalso((p) => {
    if (p.url.endsWith('/login')) return json({ bearerToken: `s${++logins}` });
    return p.headers.Authorization === 'Bearer s1' ? json({ status: '3', statusMessage: 'Não autorizado.' }) : json({ status: '1' });
  });
  const r = await new SankhyaCliente(async () => LEGADO, { http }).chamar('X', 'mge', {});
  assert.equal(r.status, '1');
  assert.equal(logins, 2);
});

test('chamadas simultâneas compartilham um único login', async () => {
  let logins = 0;
  const { http } = fetchFalso((p) => (p.url.endsWith('/login') ? json({ bearerToken: `s${++logins}` }) : json({ status: '1' })));
  const c = new SankhyaCliente(async () => LEGADO, { http });
  await Promise.all([1, 2, 3, 4, 5].map(() => c.chamar('X', 'mge', {})));
  assert.equal(logins, 1);
});

test('sessão vencida é renovada', async () => {
  let agora = 0;
  let logins = 0;
  const { http } = fetchFalso((p) => (p.url.endsWith('/login') ? json({ bearerToken: `s${++logins}` }) : json({ status: '1' })));
  const c = new SankhyaCliente(async () => LEGADO, { http, agora: () => agora });
  await c.chamar('X', 'mge', {});
  agora = 10 * 60 * 1000;
  await c.chamar('X', 'mge', {});
  assert.equal(logins, 2);
});

test('falha de login não expõe credenciais', async () => {
  const { http } = fetchFalso(() => json({ error: 'invalid appkey ak / senha s' }, 401));
  await assert.rejects(new SankhyaCliente(async () => LEGADO, { http }).chamar('X', 'mge', {}), (e: Error) => {
    assert.doesNotMatch(e.message, /appkey|senha|\bak\b/);
    return true;
  });
});
