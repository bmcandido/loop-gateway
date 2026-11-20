import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CACHE_DADOS_LOOP_MS,
  criarHandlerLicencaStatus,
  dadosLoopDaLinha,
  lerPergunta,
  TYP_LICENCA_STATUS,
  VALIDADE_RESPOSTA_SEG,
} from '../src/licenca-status/handler.ts';

const A = '36841880000176';
const B = '11222333000181';
const T0 = Date.parse('2026-11-17T12:00:00-03:00');
const NONCE = 'abcdefghijklmnopqrstuvwxyz012345';

type Linha = { contratado: boolean; dataExpiracao: string | null };

async function chaves() {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
}

// Linha de public.loopapp como o PostgREST devolve (o select já filtra as colunas).
const LOOPAPP = {
  razaoSocial: 'VYENNA CONSULTORIA E TECNOLOGIA LTDA',
  fantasia: 'VYENNA CONSULTORIA E TECNOLOGIA',
  cpfCnpj: '37647026000136',
  emailSuporte: 'suporte@exemplo.com.br',
  cep: '74265220',
  logradouro: 'R. C32 - Sala 228',
  numero: '229',
  bairro: 'Jardim América',
  cidade: 'Goiânia',
  uf: 'GO',
};

function supabase(por: Record<string, Linha | undefined>) {
  const estado = {
    fora: false,
    status: 200,
    corpos: [] as Record<string, unknown>[],
    loopapp: [LOOPAPP] as unknown[],
    loopappStatus: 200,
    urlsLoopapp: [] as string[],
  };
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    if (estado.fora) throw new TypeError('fetch failed');
    if (String(url).includes('/rest/v1/loopapp')) {
      estado.urlsLoopapp.push(String(url));
      return new Response(JSON.stringify(estado.loopapp), { status: estado.loopappStatus });
    }
    const corpo = JSON.parse(String(init?.body));
    estado.corpos.push(corpo);
    if (estado.status !== 200) return new Response('{}', { status: estado.status });
    const l = por[corpo.p_cnpj];
    return new Response(JSON.stringify(l ? [l] : []), { status: 200 });
  }) as typeof fetch;
  return { http, estado };
}

async function montar(por: Record<string, Linha | undefined>, extra: { limitar?: (o: string) => boolean } = {}) {
  const par = await chaves();
  const sb = supabase(por);
  const relogio = { ms: T0 };
  const h = criarHandlerLicencaStatus({
    supabaseUrl: 'https://x.supabase.co',
    supabaseChave: 'service-role',
    chave: par.privateKey,
    kid: 'loop-gateway-teste',
    http: sb.http,
    agoraMs: () => relogio.ms,
    limitar: extra.limitar ?? (() => true),
  });
  return { h, sb, publica: par.publicKey, relogio };
}

const pedido = (corpo: unknown, metodo = 'POST') =>
  new Request('https://x/functions/v1/licenca-status', { method: metodo, body: metodo === 'POST' ? JSON.stringify(corpo) : undefined });

const dec = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

async function conferir(jws: string, publica: CryptoKey) {
  const [h, p, s] = jws.split('.');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publica, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
  return { ok, header: dec(h), payload: dec(p) };
}

test('responde JWS assinado com nonce, produto, typ e validade de 5 min', async () => {
  const { h, publica, sb } = await montar({ [A]: { contratado: true, dataExpiracao: '2027-01-10' } });
  const r = await h(pedido({ cnpjs: ['36.841.880/0001-76'], produto: 'LoopPaymentLink', nonce: NONCE, versao: '2.0.1' }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/jose');
  const { ok, header, payload } = await conferir(await r.text(), publica);
  assert.ok(ok, 'assinatura confere com a chave pública');
  assert.deepEqual(header, { alg: 'ES256', kid: 'loop-gateway-teste', typ: TYP_LICENCA_STATUS });
  assert.equal(payload.contratado, true);
  assert.equal(payload.dataExpiracao, '2027-01-10');
  assert.equal(payload.nonce, NONCE);
  assert.equal(payload.produto, 'LoopPaymentLink');
  assert.deepEqual(payload.cnpjs, [A]);
  assert.equal(payload.valeAte - payload.emitidoEm, VALIDADE_RESPOSTA_SEG);
  assert.deepEqual(sb.estado.corpos[0], { p_cnpj: A, p_produto: 'LoopPaymentLink', p_origem: 'addon', p_versao: '2.0.1' });
});

test('vários CNPJs: vale o maior vencimento entre os contratados', async () => {
  const { h, publica } = await montar({
    [A]: { contratado: true, dataExpiracao: '2026-12-01' },
    [B]: { contratado: true, dataExpiracao: '2027-05-01' },
  });
  const r = await h(pedido({ cnpjs: [A, B, '99999999000199'], produto: 'LoopPortal', nonce: NONCE }));
  const { payload } = await conferir(await r.text(), publica);
  assert.equal(payload.contratado, true);
  assert.equal(payload.dataExpiracao, '2027-05-01');
});

test('servidor com muitas empresas (60 CNPJs): consulta todos, em lotes, e libera pelo contratado', async () => {
  // New Line (20/11/2026): TSIEMP com mais de 20 empresas recebia 400 e o add-on mostrava "Sem comunicação".
  const muitos = Array.from({ length: 60 }, (_, i) => String(10000000000100 + i * 1000).padStart(14, '0'));
  const { h, publica, sb } = await montar({ [muitos[42]]: { contratado: true, dataExpiracao: '2099-12-31' } });
  const r = await h(pedido({ cnpjs: muitos, produto: 'LoopWhatsApp', nonce: NONCE }));
  assert.equal(r.status, 200);
  const { ok, payload } = await conferir(await r.text(), publica);
  assert.ok(ok);
  assert.equal(payload.contratado, true);
  assert.equal(payload.dataExpiracao, '2099-12-31');
  assert.equal(payload.cnpjs.length, 60);
  assert.equal(sb.estado.corpos.length, 60);
});

test('sem contrato: responde assinado com contratado=false (o add-on decide a recusa)', async () => {
  const { h, publica } = await montar({ [A]: { contratado: false, dataExpiracao: '2027-01-10' } });
  const r = await h(pedido({ cnpjs: [A], produto: 'LoopPortal', nonce: NONCE }));
  assert.equal(r.status, 200);
  const { ok, payload } = await conferir(await r.text(), publica);
  assert.ok(ok);
  assert.equal(payload.contratado, false);
  assert.equal(payload.dataExpiracao, null);
});

test('Supabase fora ou com erro: 503, sem resposta assinada', async () => {
  const { h, sb } = await montar({ [A]: { contratado: true, dataExpiracao: '2027-01-10' } });
  sb.estado.fora = true;
  let r = await h(pedido({ cnpjs: [A], produto: 'LoopPortal', nonce: NONCE }));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).erro, 'LICENCA_INDISPONIVEL');
  sb.estado.fora = false;
  sb.estado.status = 500;
  r = await h(pedido({ cnpjs: [A], produto: 'LoopPortal', nonce: NONCE }));
  assert.equal(r.status, 503);
});

test('entrada inválida: 400', async () => {
  const { h } = await montar({});
  for (const corpo of [
    {},
    { cnpjs: [], produto: 'LoopPortal', nonce: NONCE },
    { cnpjs: ['123'], produto: 'LoopPortal', nonce: NONCE },
    { cnpjs: [A], produto: 'Loop Portal; drop', nonce: NONCE },
    { cnpjs: [A], produto: 'LoopPortal', nonce: 'curto' },
    { cnpjs: Array.from({ length: 201 }, () => A), produto: 'LoopPortal', nonce: NONCE },
  ]) {
    const r = await h(pedido(corpo));
    assert.equal(r.status, 400, JSON.stringify(corpo));
  }
  const r = await h(new Request('https://x', { method: 'POST', body: 'nao-e-json' }));
  assert.equal(r.status, 400);
});

test('método diferente de POST: 405; acima do limite: 429', async () => {
  let r = await (await montar({})).h(pedido(null, 'GET'));
  assert.equal(r.status, 405);
  r = await (await montar({}, { limitar: () => false })).h(pedido({ cnpjs: [A], produto: 'LoopPortal', nonce: NONCE }));
  assert.equal(r.status, 429);
});

test('lerPergunta normaliza, ordena e remove CNPJs repetidos; versão vazia vira null', () => {
  const p = lerPergunta({ cnpjs: [B, '36.841.880/0001-76', A], produto: 'LoopPortal', nonce: NONCE, versao: '  ' });
  assert.deepEqual(p.cnpjs, [B, A].sort());
  assert.equal(p.versao, null);
});

test('diagnostico: responde assinado, mas sem registrar uso (p_origem nulo)', async () => {
  const { h, sb, publica } = await montar({ [A]: { contratado: true, dataExpiracao: '2027-01-10' } });
  const r = await h(pedido({ cnpjs: [A], produto: 'LoopPortal', nonce: NONCE, diagnostico: true }));
  assert.equal(r.status, 200);
  assert.ok((await conferir(await r.text(), publica)).ok);
  assert.equal(sb.estado.corpos[0].p_origem, null);
});

test('dados da Loop: vêm de public.loopapp (produção, só colunas públicas) dentro da resposta assinada', async () => {
  const { h, sb, publica } = await montar({ [A]: { contratado: false, dataExpiracao: null } });
  const r = await h(pedido({ cnpjs: [A], produto: 'LoopPortal', nonce: NONCE }));
  const { ok, payload } = await conferir(await r.text(), publica);
  assert.ok(ok);
  assert.deepEqual(payload.loop, {
    razaoSocial: 'VYENNA CONSULTORIA E TECNOLOGIA LTDA',
    fantasia: 'VYENNA CONSULTORIA E TECNOLOGIA',
    cnpj: '37647026000136',
    email: 'suporte@exemplo.com.br',
    cep: '74265220',
    logradouro: 'R. C32 - Sala 228',
    numero: '229',
    bairro: 'Jardim América',
    cidade: 'Goiânia',
    uf: 'GO',
  });
  const url = new URL(sb.estado.urlsLoopapp[0]);
  assert.equal(url.searchParams.get('tipoIntegracao'), 'eq.producao');
  const colunas = String(url.searchParams.get('select')).split(',');
  for (const proibida of ['password', 'appKey', 'userName', 'clienteSecret', 'clienteId', 'tokenWhatsApp', 'whatsAppSuporte', 'whatsAppComercial', 'smtpSecretRef']) {
    assert.ok(!colunas.includes(proibida), `não pode ler ${proibida}`);
  }
});

test('dados da Loop: cache de 10 min; falha na leitura não derruba a licença e mantém o último lido', async () => {
  const { h, sb, publica, relogio } = await montar({ [A]: { contratado: true, dataExpiracao: '2027-01-10' } });
  const consultar = async () => (await conferir(await (await h(pedido({ cnpjs: [A], produto: 'LoopPortal', nonce: NONCE }))).text(), publica)).payload;
  assert.equal((await consultar()).loop.razaoSocial, 'VYENNA CONSULTORIA E TECNOLOGIA LTDA');
  await consultar();
  assert.equal(sb.estado.urlsLoopapp.length, 1, 'segunda consulta usa o cache');

  relogio.ms += CACHE_DADOS_LOOP_MS + 1;
  sb.estado.loopappStatus = 500;
  const p = await consultar();
  assert.equal(p.contratado, true);
  assert.equal(p.loop.cnpj, '37647026000136', 'falhou a leitura: segue com o último lido');
  assert.equal(sb.estado.urlsLoopapp.length, 2);
});

test('dados da Loop: sem linha de produção, a resposta sai sem loop', async () => {
  const { h, sb, publica } = await montar({ [A]: { contratado: true, dataExpiracao: '2027-01-10' } });
  sb.estado.loopapp = [];
  const { payload } = await conferir(await (await h(pedido({ cnpjs: [A], produto: 'LoopPortal', nonce: NONCE }))).text(), publica);
  assert.equal(payload.contratado, true);
  assert.equal('loop' in payload, false);
});

test('dadosLoopDaLinha: apara, limita, tira campos vazios e deixa CNPJ/CEP só com dígitos', () => {
  assert.equal(dadosLoopDaLinha(null), undefined);
  assert.equal(dadosLoopDaLinha({ razaoSocial: '  ' }), undefined);
  assert.deepEqual(dadosLoopDaLinha({ razaoSocial: ' Loop ', cpfCnpj: '37.647.026/0001-36', cep: '74265-220', uf: 'GOX', password: 'x' }), {
    razaoSocial: 'Loop',
    cnpj: '37647026000136',
    cep: '74265220',
    uf: 'GO',
  });
});
