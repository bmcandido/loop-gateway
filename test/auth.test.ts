import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { exigirEmailConfirmado, usuarioDoPayload } from '../src/auth/firebase.ts';
import { validadorSupabase } from '../src/auth/supabase.ts';

const URL_SUPA = 'https://abcdefgh.supabase.co';
const SEGREDO_JWT = 'segredo-jwt-legado-do-projeto-supabase-123456';

async function tokenSupabase(claims: Record<string, unknown>, opcoes: { segredo?: string; iss?: string; exp?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(opcoes.iss ?? `${URL_SUPA}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(opcoes.exp ?? '1h')
    .sign(new TextEncoder().encode(opcoes.segredo ?? SEGREDO_JWT));
}

test('payload: normaliza e-mail e exige uid/e-mail válidos', () => {
  assert.deepEqual(usuarioDoPayload('FIREBASE', { sub: 'AbC123', email: ' Ana@Loop.com.BR ' }), {
    origem: 'FIREBASE',
    uid: 'AbC123',
    email: 'ana@loop.com.br',
    emailVerificado: false,
  });
  assert.throws(() => usuarioDoPayload('FIREBASE', { sub: 'AbC123' }), /e-mail/);
  assert.throws(() => usuarioDoPayload('FIREBASE', { sub: 'a\nb', email: 'a@b.com' }));
  assert.throws(() => usuarioDoPayload('FIREBASE', { sub: 'abc', email: 'a@b.com\nFIREBASE' }));
});

test('firebase: e-mail não confirmado é recusado (conta criada com e-mail alheio)', () => {
  assert.throws(() => exigirEmailConfirmado({ email: 'a@b.com' }, true), /Confirme seu e-mail/);
  assert.throws(() => exigirEmailConfirmado({ email: 'a@b.com', email_verified: false }, true), /Confirme/);
  assert.throws(() => exigirEmailConfirmado({ email: 'a@b.com', email_verified: 'true' }, true), /Confirme/);
  exigirEmailConfirmado({ email: 'a@b.com', email_verified: true }, true);
  exigirEmailConfirmado({ email: 'a@b.com' }, false);
});

test('supabase (HS256): aceita token do projeto', async () => {
  const v = validadorSupabase(URL_SUPA, SEGREDO_JWT);
  const t = await tokenSupabase({ sub: '1b2c3d4e-0000-4000-8000-000000000000', email: 'ana@loop.com.br' });
  assert.deepEqual(await v.validar(t), {
    origem: 'SUPABASE',
    uid: '1b2c3d4e-0000-4000-8000-000000000000',
    email: 'ana@loop.com.br',
  });
});

test('supabase: recusa segredo, emissor ou validade errados', async () => {
  const v = validadorSupabase(URL_SUPA, SEGREDO_JWT);
  const claims = { sub: 'u1', email: 'ana@loop.com.br' };
  await assert.rejects(v.validar(await tokenSupabase(claims, { segredo: 'outro-segredo-qualquer-0000000000000' })), /Sessão/);
  await assert.rejects(v.validar(await tokenSupabase(claims, { iss: 'https://outro.supabase.co/auth/v1' })), /Sessão/);
  await assert.rejects(v.validar(await tokenSupabase(claims, { exp: '-1m' })), /Sessão/);
});
