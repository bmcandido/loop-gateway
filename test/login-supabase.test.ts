import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validadorCombinado } from '../src/auth/combinado.ts';
import { validadorPeloAuth } from '../src/auth/supabase-auth.ts';
import { ErroGateway, type UsuarioAutenticado, type ValidadorToken } from '../src/core/tipos.ts';

const URL_PROJETO = 'https://projeto.supabase.co';

function token(iss: string, alg = 'HS256'): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg, typ: 'JWT' })}.${b64({ iss, sub: 'x' })}.assinatura-qualquer`;
}

function auth(resposta: { status: number; corpo?: unknown }) {
  const chamadas: { url: string; headers: Record<string, string> }[] = [];
  const http = (async (url: string, init: { headers: Record<string, string> }) => {
    chamadas.push({ url, headers: init.headers });
    return new Response(JSON.stringify(resposta.corpo ?? {}), { status: resposta.status });
  }) as unknown as typeof fetch;
  return { http, chamadas };
}

const CONTA = { id: 'abc-123', email: 'Cliente@Loop.com', email_confirmed_at: '2026-01-01T00:00:00Z' };

test('login do Supabase em HS256 é conferido no Auth, pelo validador do gateway único', async () => {
  const a = auth({ status: 200, corpo: CONTA });
  const v = validadorCombinado(validadorPeloAuth({ url: URL_PROJETO, chave: 'chave', http: a.http }));
  const t = token(`${URL_PROJETO}/auth/v1`);
  const u = await v.validar(t);
  assert.deepEqual(u, { origem: 'SUPABASE', uid: 'abc-123', email: 'cliente@loop.com' });
  assert.equal(a.chamadas[0].url, `${URL_PROJETO}/auth/v1/user`);
  assert.equal(a.chamadas[0].headers.Authorization, `Bearer ${t}`);
});

test('token recusado pelo Auth continua TOKEN_INVALIDO, inclusive com assinatura forjada', async () => {
  const a = auth({ status: 401 });
  const v = validadorCombinado(validadorPeloAuth({ url: URL_PROJETO, chave: 'chave', http: a.http }));
  await assert.rejects(v.validar(token(`${URL_PROJETO}/auth/v1`)), (e: ErroGateway) => e.codigo === 'TOKEN_INVALIDO' && e.status === 401);
});

test('conta sem e-mail confirmado não entra', async () => {
  const a = auth({ status: 200, corpo: { ...CONTA, email_confirmed_at: null } });
  const v = validadorPeloAuth({ url: URL_PROJETO, chave: 'chave', http: a.http });
  await assert.rejects(v.validar(token(`${URL_PROJETO}/auth/v1`)), (e: ErroGateway) => e.codigo === 'EMAIL_NAO_VERIFICADO');
});

test('Auth fora do ar não vira sessão expirada', async () => {
  const a = auth({ status: 500 });
  const v = validadorPeloAuth({ url: URL_PROJETO, chave: 'chave', http: a.http });
  await assert.rejects(v.validar(token(`${URL_PROJETO}/auth/v1`)), (e: ErroGateway) => e.codigo === 'SUPABASE_INDISPONIVEL' && e.status === 503);
});

test('login legado do Firebase não passa pelo Supabase Auth', async () => {
  const a = auth({ status: 200, corpo: CONTA });
  const firebase: ValidadorToken = {
    validar: async (): Promise<UsuarioAutenticado> => ({ origem: 'FIREBASE', uid: 'f1', email: 'f@loop.com', emailVerificado: true }),
  };
  const v = validadorCombinado(validadorPeloAuth({ url: URL_PROJETO, chave: 'chave', http: a.http }), firebase);
  const u = await v.validar(token('https://securetoken.google.com/projeto', 'RS256'));
  assert.equal(u.origem, 'FIREBASE');
  assert.equal(a.chamadas.length, 0);
});
