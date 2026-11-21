// Edge Function do Supabase: o Add-on cadastra e administra os usuarios dos apps (Acesso Unificado).
// Autenticada pela chave da instalacao do Add-on (x-loop-cliente-chave); a service_role fica so aqui.
//
//   supabase functions deploy acesso-admin --no-verify-jwt --project-ref zvncvdlfyeyktnuzxvlc
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao fornecidos pela propria plataforma.
// Docs: loop-expedicao/loop_stok/docs/acesso-unificado/
import { criarHandlerAcessoAdmin } from '../../../src/acesso/admin.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

const handler = criarHandlerAcessoAdmin({
  supabaseUrl: env('SUPABASE_URL'),
  supabaseChave: env('SUPABASE_SERVICE_ROLE_KEY'),
  esquemaQr: env('ACESSO_ESQUEMA_QR') || 'loopacesso://qr',
  // Central de Acesso Loop: convite e redefinicao de senha saem por ela (padrao https://acesso.loopapp.com.br)
  centralUrl: env('ACESSO_CENTRAL_URL') || undefined,
  // so metadados: nunca e-mail, senha, token ou chave
  registrar: (e) => (e.status >= 500 ? console.error('acesso-admin', JSON.stringify(e)) : console.log('acesso-admin', JSON.stringify(e))),
});

Deno.serve(handler);