// Edge Function do Supabase: o app logado recebe empresa, perfil, situacao e licenca (Acesso Unificado).
// Substitui o CNPJ digitado no app. A sessao do usuario e conferida no proprio Auth.
//
//   supabase functions deploy acesso-contexto --no-verify-jwt --project-ref zvncvdlfyeyktnuzxvlc
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao fornecidos pela propria plataforma.
// Docs: loop-expedicao/loop_stok/docs/acesso-unificado/
import { criarHandlerAcessoContexto } from '../../../src/acesso/contexto.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

const handler = criarHandlerAcessoContexto({
  supabaseUrl: env('SUPABASE_URL'),
  supabaseChave: env('SUPABASE_SERVICE_ROLE_KEY'),
  // so metadados: nunca e-mail, senha, token ou chave
  registrar: (e) => (e.status >= 500 ? console.error('acesso-contexto', JSON.stringify(e)) : console.log('acesso-contexto', JSON.stringify(e))),
});

Deno.serve(handler);