// Edge Function do Supabase: o app troca o token do QR (gerado no Add-on) por uma sessao (Acesso Unificado).
// Sem login: o token e de uso unico, vale 10 min e so o hash fica no banco.
//
//   supabase functions deploy acesso-qr --no-verify-jwt --project-ref zvncvdlfyeyktnuzxvlc
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao fornecidos pela propria plataforma.
// Docs: loop-expedicao/loop_stok/docs/acesso-unificado/
import { criarHandlerAcessoQr } from '../../../src/acesso/qr.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

const handler = criarHandlerAcessoQr({
  supabaseUrl: env('SUPABASE_URL'),
  supabaseChave: env('SUPABASE_SERVICE_ROLE_KEY'),
  // so metadados: nunca e-mail, senha, token ou chave
  registrar: (e) => (e.status >= 500 ? console.error('acesso-qr', JSON.stringify(e)) : console.log('acesso-qr', JSON.stringify(e))),
});

Deno.serve(handler);