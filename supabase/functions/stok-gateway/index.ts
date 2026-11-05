// Edge Function do Supabase: gateway do app Loop Stok. O núcleo é o do expense-gateway.
//
//   supabase functions deploy stok-gateway --no-verify-jwt --project-ref zvncvdlfyeyktnuzxvlc
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidos pela própria plataforma.
// verify_jwt desligado: conferir cadastro acontece antes de existir conta; o gateway confere o token por conta própria.
import { criarHandlerStok } from '../../../src/stok/gateway.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

const handler = criarHandlerStok({
  supabaseUrl: env('SUPABASE_URL'),
  supabaseChave: env('SUPABASE_SERVICE_ROLE_KEY'),
  // só metadados: nunca corpo, cabeçalhos, e-mail ou CPF
  registrar: (e) => (e.status >= 500 ? console.error('stok-gateway', JSON.stringify(e)) : console.log('stok-gateway', JSON.stringify(e))),
});

Deno.serve(handler);
