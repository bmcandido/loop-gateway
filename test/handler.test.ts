import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validadorCombinado } from '../src/auth/combinado.ts';
import { criarHandler, exigenciaDeEmailPorCliente, rota } from '../src/http/handler.ts';
import { ErroGateway, type ModuloSankhya } from '../src/core/tipos.ts';
import { GATEWAY_TESTE, LICENCA_TESTE, licencaDe } from './fixtures.ts';

const jwt = (iss: string) => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss })).toString('base64url')}.x`;

function montar(origensWeb: string[] = []) {
  const chamadas: { servico: string; modulo: ModuloSankhya; body: Record<string, unknown>; cnpj: string }[] = [];
  const handler = criarHandler({
    supabaseUrl: 'https://ref.supabase.co',
    supabaseChave: 'chave',
    chavePrivada: GATEWAY_TESTE.privada,
    kid: GATEWAY_TESTE.kid,
    origensWeb,
    chavesLicenca: [LICENCA_TESTE],
    sobrescrever: {
      licenca: async () => {},
      validador: {
        async validar(t) {
          if (t !== 'token-supabase-valido-123456') throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão expirada. Entre novamente.');
          return { origem: 'SUPABASE', uid: 'u1', email: 'ana@cliente.com' };
        },
      },
      sankhya: (cnpj) => ({
        async chamar(servico, modulo, body) {
          chamadas.push({ servico, modulo, body, cnpj });
          return { status: '1', responseBody: {} };
        },
      }),
    },
  });
  return { handler, chamadas };
}

const post = (licenca: string | null, corpo: unknown, extra: Record<string, string> = {}) =>
  new Request('https://ref.supabase.co/functions/v1/portal-gateway/servico', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(licenca ? { 'X-Loop-Licenca': licenca } : {}), ...extra },
    body: JSON.stringify(corpo),
  });

test('rota tira o prefixo do Supabase e do Firebase', () => {
  assert.equal(rota('/functions/v1/portal-gateway/servico'), '/servico');
  assert.equal(rota('/portal-gateway/saude/'), '/saude');
  assert.equal(rota('/portalGateway/servico'), '/servico');
  assert.equal(rota('/portal-gateway'), '/');
});

test('Edge (HTTP padrão): licença real assinada → Sankhya do CNPJ da licença, identidade v2', async () => {
  const { handler, chamadas } = montar();
  const r = await handler(
    post(licencaDe('36841880000176'), { serviceName: 'LoopPortalSacSP.consultarSac', requestBody: {} }, { Authorization: 'Bearer token-supabase-valido-123456' }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(chamadas[0].cnpj, '36841880000176');
  assert.equal((chamadas[0].body._portalAuth as { v: number; cnpj: string; origem: string }).cnpj, '36841880000176');
  assert.equal((chamadas[0].body._portalAuth as { origem: string }).origem, 'SUPABASE');
});

test('Edge: sem licença 401; saúde 200; CORS aberto por padrão e travável', async () => {
  const { handler } = montar();
  assert.equal((await handler(post(null, { serviceName: 'LoopPortalVisualSP.doConsultar' }))).status, 401);
  assert.equal((await handler(new Request('https://x/functions/v1/portal-gateway/saude'))).status, 200);
  const pre = await handler(new Request('https://x/functions/v1/portal-gateway/servico', { method: 'OPTIONS', headers: { Origin: 'https://app.cliente.com.br' } }));
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /X-Loop-Licenca/);
  const travado = montar(['https://so-este.com']);
  assert.equal((await travado.handler(new Request('https://x/portal-gateway/saude', { headers: { Origin: 'https://outro.com' } }))).status, 403);
});

test('login combinado: emissor Firebase só com projeto legado configurado; resto vai ao Supabase', async () => {
  const usados: string[] = [];
  const v = (nome: string) => ({ validar: async () => (usados.push(nome), { origem: 'SUPABASE' as const, uid: 'u', email: 'a@b.com' }) });
  const so = validadorCombinado(v('supabase'));
  await so.validar(jwt('https://ref.supabase.co/auth/v1'));
  await assert.rejects(so.validar(jwt('https://securetoken.google.com/portal-financeiro-c18b7')));
  const com = validadorCombinado(v('supabase'), v('firebase'));
  await com.validar(jwt('https://securetoken.google.com/portal-financeiro-c18b7'));
  await com.validar('lixo');
  assert.deepEqual(usados, ['supabase', 'firebase', 'supabase']);
});

test('exigência de e-mail por cliente: lê EXIGECONFEMAIL do add-on, com cache e padrão seguro', async () => {
  let chamadas = 0;
  let resposta: unknown = { status: '1', responseBody: { data: { members: { exigeConfEmail: 'N' } } } };
  let agora = 0;
  const exige = exigenciaDeEmailPorCliente(() => ({
    async chamar(serviceName: string) {
      chamadas++;
      assert.equal(serviceName, 'LoopPortalAppSP.consultarConfig');
      if (resposta instanceof Error) throw resposta;
      return resposta as any;
    },
  }), () => agora);
  assert.equal(await exige('1'), false);
  assert.equal(await exige('1'), false);
  assert.equal(chamadas, 1, 'cache de 5 min');
  agora = 6 * 60 * 1000;
  resposta = { status: '1', responseBody: { data: { exigeConfEmail: 'S' } } };
  assert.equal(await exige('1'), true);
  resposta = new Error('ERP fora');
  assert.equal(await exige('2'), true, 'falha = exige');
});
