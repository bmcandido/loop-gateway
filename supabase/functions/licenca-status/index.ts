// Edge Function do Supabase: consulta de licença do ADD-ON (LicencaLoop v2), com resposta assinada.
// Docs: loop-admin/docs/licenciamento/13-PADRAO-UNICO-E-GESTAO.md (seções 5.2 e 6).
//
//   supabase functions deploy licenca-status --no-verify-jwt --project-ref zvncvdlfyeyktnuzxvlc
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidos pela própria plataforma. A chave de assinatura é a
// do gateway (PORTAL_GATEWAY_CHAVE_PRIVADA / PORTAL_GATEWAY_KID), segredo do projeto já usado pelo portal-gateway:
// o add-on confere com a chave pública que já vai embarcada para a GatewayAssinatura.
// verify_jwt desligado: o add-on não tem login no Supabase; a função só devolve a situação da licença, assinada.
import { chavePrivadaGateway } from '../../../src/core/assinatura.ts';
import { criarHandlerLicencaStatus } from '../../../src/licenca-status/handler.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

const handler = criarHandlerLicencaStatus({
  supabaseUrl: env('SUPABASE_URL'),
  supabaseChave: env('SUPABASE_SERVICE_ROLE_KEY'),
  chave: await chavePrivadaGateway(env('PORTAL_GATEWAY_CHAVE_PRIVADA')),
  kid: env('PORTAL_GATEWAY_KID') || 'loop-gateway-2026-11',
  // só metadados: nunca corpo, CNPJs ou nonce
  registrar: (e) => (e.status >= 500 ? console.error('licenca-status', JSON.stringify(e)) : console.log('licenca-status', JSON.stringify(e))),
});

Deno.serve(handler);
