import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { sha256Hex } from '../src/acesso/comum.ts';
import { assinarV2, CONTEXTO_ASSINATURA, criarHandlerLoopSignIntegracao } from '../src/loopsign-integracao/handler.ts';

// LoopSign vinculado a outro produto do contrato (loop-admin/.melhorias/loopsign-vinculado/PLANO.md):
// o add-on busca a chave do LoopSign com a chave da instalação (lpk_) aprovada pela Loop.

const CHAVE = 'lpk_' + 'k'.repeat(40);
const CNPJ = '12345678000195';
const SEGREDO = 'segredo-de-teste-integracao-vinculada-32b';
const AGORA = Date.parse('2026-11-20T12:00:00Z');

interface Chamada { url: URL; metodo: string; headers: Record<string, string>; corpo: any }

function ambiente({
  chave = { id: 'c1', cpf_cnpj: '12.345.678/0001-95', status: 'aprovada' } as Record<string, string> | null,
  loopsign = (_c: Chamada) => ({ status: 200, corpo: { success: true, data: { chave: 'ls_live_abc', prefixo: 'ls_live_ab', escopo: 'integracao_delivery', expira_em: '2027-11-20T12:00:00.000Z' } } as unknown }),
  semRede = false,
} = {}) {
  const chamadas: Chamada[] = [];
  const http = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const c: Chamada = { url, metodo: init?.method ?? 'GET', headers, corpo: init?.body ? JSON.parse(String(init.body)) : undefined };
    chamadas.push(c);
    if (url.hostname === 'x.supabase.co') {
      assert.equal(url.pathname, '/rest/v1/loop_addon_chaves');
      assert.equal(url.searchParams.get('chave_hash'), `eq.${await sha256Hex(CHAVE)}`);
      return new Response(JSON.stringify(chave ? [chave] : []), { status: 200 });
    }
    if (semRede) throw new TypeError('fetch failed');
    const r = loopsign(c);
    return new Response(JSON.stringify(r.corpo), { status: r.status });
  }) as typeof fetch;
  const registros: unknown[] = [];
  const handler = criarHandlerLoopSignIntegracao({
    supabaseUrl: 'https://x.supabase.co',
    supabaseChave: 'service',
    loopsignUrl: 'https://sign.loopapp.com.br/',
    segredo: SEGREDO,
    http,
    limitar: () => true,
    agoraMs: () => AGORA,
    novoNonce: () => 'nonce-fixo-12345',
    registrar: (e) => registros.push(e),
  });
  return { handler, chamadas, registros, doLoopSign: () => chamadas.filter((c) => c.url.hostname === 'sign.loopapp.com.br') };
}

const pedido = (corpo: unknown, chave: string | null = CHAVE, metodo = 'POST') =>
  new Request('https://x/functions/v1/loopsign-integracao', {
    method: metodo,
    headers: chave ? { 'x-loop-cliente-chave': chave } : {},
    body: metodo === 'POST' ? JSON.stringify(corpo) : undefined,
  });

test('assinatura v2 igual à do LoopSign (utils/hmac-contexto.util.js)', async () => {
  const esperado = 'v2=' + createHmac('sha256', SEGREDO).update(['v2', CONTEXTO_ASSINATURA, '1763640000', 'nonce-1234', CNPJ, 'LoopDelivery'].join('|')).digest('hex');
  assert.equal(await assinarV2(SEGREDO, CONTEXTO_ASSINATURA, '1763640000', 'nonce-1234', [CNPJ, 'LoopDelivery']), esperado);
  assert.equal(CONTEXTO_ASSINATURA, 'loopgateway.loopsign.integracao.chave');
});

test('chave aprovada + LoopSign vinculado: devolve a chave do LoopSign, sem cache, e pede com o CNPJ da chave', async () => {
  const a = ambiente();
  const r = await a.handler(pedido({ produto: 'LoopDelivery', cnpj: '99999999000199' }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const corpo = await r.json();
  assert.deepEqual(corpo, {
    ok: true, codigo: 'OK', chave: 'ls_live_abc', prefixo: 'ls_live_ab', escopo: 'integracao_delivery',
    expiraEm: '2027-11-20T12:00:00.000Z', url: 'https://sign.loopapp.com.br/api/loopsign',
  });
  const [c] = a.doLoopSign();
  assert.equal(c.url.pathname, '/api/loopsign/integracoes/loop/vinculado/chave');
  assert.deepEqual(c.corpo, { cnpj: CNPJ, produto: 'LoopDelivery' }); // CNPJ da chave, nunca o do corpo
  const ts = String(Math.floor(AGORA / 1000));
  assert.equal(c.headers['x-loop-gateway-timestamp'], ts);
  assert.equal(c.headers['x-loop-gateway-nonce'], 'nonce-fixo-12345');
  assert.equal(c.headers['x-loop-gateway-signature'], await assinarV2(SEGREDO, CONTEXTO_ASSINATURA, ts, 'nonce-fixo-12345', [CNPJ, 'LoopDelivery']));
  assert.doesNotMatch(JSON.stringify(a.registros), /ls_live|lpk_|12345678000195/);
});

test('chave do add-on: ausente/curta, desconhecida, recusada e pendente não chegam ao LoopSign', async () => {
  for (const [amb, chave, status, codigo] of [
    [ambiente(), null, 401, 'CHAVE_INVALIDA'],
    [ambiente(), 'curta', 401, 'CHAVE_INVALIDA'],
    [ambiente({ chave: null }), CHAVE, 401, 'CHAVE_INVALIDA'],
    [ambiente({ chave: { id: 'c1', cpf_cnpj: CNPJ, status: 'recusada' } }), CHAVE, 401, 'CHAVE_INVALIDA'],
    [ambiente({ chave: { id: 'c1', cpf_cnpj: CNPJ, status: 'pendente' } }), CHAVE, 423, 'CHAVE_PENDENTE'],
  ] as const) {
    const r = await amb.handler(pedido({ produto: 'LoopDelivery' }, chave));
    assert.equal(r.status, status, codigo);
    assert.equal((await r.json()).codigo, codigo);
    assert.equal(amb.doLoopSign().length, 0);
  }
});

test('pedido: só POST e só LoopDelivery/LoopEcommerce', async () => {
  const a = ambiente();
  assert.equal((await a.handler(pedido(null, CHAVE, 'GET'))).status, 405);
  for (const produto of ['LoopPortal', '', undefined, 'loopdelivery']) {
    const r = await a.handler(pedido({ produto }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).codigo, 'PEDIDO_INVALIDO');
  }
  assert.equal(a.doLoopSign().length, 0);
});

test('recusas do LoopSign viram códigos próprios, sem repassar texto interno', async () => {
  const casos: [number, unknown, number, string][] = [
    [403, { success: false, message: 'interno', error: { code: 'SEM_VINCULO' } }, 403, 'SEM_VINCULO'],
    [403, { success: false, message: 'interno', error: { code: 'LICENSE_EXPIRED' } }, 403, 'SEM_LICENCA'],
    [409, { success: false, message: 'interno', error: { code: 'MATRIZ' } }, 409, 'EMPRESA_LOOP'],
    [401, { success: false, message: 'Assinatura inválida.' }, 503, 'LOOPSIGN_INDISPONIVEL'],
    [404, null, 503, 'LOOPSIGN_INDISPONIVEL'],
    [500, { success: false, message: 'Erro interno' }, 503, 'LOOPSIGN_INDISPONIVEL'],
    [200, { success: true, data: {} }, 503, 'LOOPSIGN_INDISPONIVEL'],
  ];
  for (const [statusLs, corpoLs, status, codigo] of casos) {
    const a = ambiente({ loopsign: () => ({ status: statusLs, corpo: corpoLs }) });
    const r = await a.handler(pedido({ produto: 'LoopEcommerce' }));
    assert.equal(r.status, status, `${statusLs} -> ${codigo}`);
    const corpo = await r.json();
    assert.equal(corpo.codigo, codigo);
    assert.doesNotMatch(JSON.stringify(corpo), /interno|Erro interno/);
  }
});

test('LoopSign fora do ar ou função sem segredo: 503 sem chamar com assinatura vazia', async () => {
  const fora = ambiente({ semRede: true });
  assert.equal((await fora.handler(pedido({ produto: 'LoopDelivery' }))).status, 503);
  const semSegredo = criarHandlerLoopSignIntegracao({
    supabaseUrl: 'https://x.supabase.co', supabaseChave: 'service', loopsignUrl: 'https://sign.loopapp.com.br', segredo: '',
    http: ambiente().chamadas && (async () => new Response(JSON.stringify([{ id: 'c1', cpf_cnpj: CNPJ, status: 'aprovada' }]))) as typeof fetch,
    limitar: () => true,
  });
  const r = await semSegredo(pedido({ produto: 'LoopDelivery' }));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).codigo, 'LOOPSIGN_INDISPONIVEL');
});

test('limite de tentativas por chave', async () => {
  let n = 0;
  const a = criarHandlerLoopSignIntegracao({
    supabaseUrl: 'https://x.supabase.co', supabaseChave: 'service', loopsignUrl: 'https://sign.loopapp.com.br', segredo: SEGREDO,
    http: (async () => new Response('[]')) as typeof fetch,
    limitar: () => (n += 1) <= 1,
  });
  assert.equal((await a(pedido({ produto: 'LoopDelivery' }))).status, 401);
  const r = await a(pedido({ produto: 'LoopDelivery' }));
  assert.equal(r.status, 429);
});
