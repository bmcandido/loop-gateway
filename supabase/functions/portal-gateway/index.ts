// Edge Function do Supabase: gateway ÚNICO dos apps Loop (padrão). Docs: loop-admin/docs/licenciamento/.
//
//   supabase secrets set --env-file <arquivo> --project-ref zvncvdlfyeyktnuzxvlc   (PORTAL_GATEWAY_CHAVE_PRIVADA etc.)
//   supabase functions deploy portal-gateway --no-verify-jwt --project-ref zvncvdlfyeyktnuzxvlc
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidos pela própria plataforma.
// verify_jwt desligado: visitantes não têm token e o login legado (Firebase) não é JWT do Supabase;
// o gateway confere licença e token por conta própria.
import { criarHandler } from '../../../src/http/handler.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const lista = (k: string) => env(k).split(',').map((s) => s.trim()).filter(Boolean);

const handler = criarHandler({
  supabaseUrl: env('SUPABASE_URL'),
  supabaseChave: env('SUPABASE_SERVICE_ROLE_KEY'),
  chavePrivada: env('PORTAL_GATEWAY_CHAVE_PRIVADA'),
  kid: env('PORTAL_GATEWAY_KID') || 'loop-gateway-2026-11',
  projetosFirebase: lista('PORTAL_FIREBASE_PROJETOS'),
  origensWeb: lista('PORTAL_ORIGENS_WEB'),
  exigirEmailVerificado: env('PORTAL_EXIGE_EMAIL_VERIFICADO') !== 'false',
  // só metadados: nunca corpo, cabeçalhos, e-mail ou CPF
  registrar: (e) => (e.status >= 500 ? console.error('portal-gateway', JSON.stringify(e)) : console.log('portal-gateway', JSON.stringify(e))),
});

Deno.serve(handler);
