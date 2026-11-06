// Edge Function do Supabase: gateway do app Loop Delivery. O núcleo é o do expense-gateway.
//
//   supabase functions deploy delivery-gateway --no-verify-jwt --project-ref zvncvdlfyeyktnuzxvlc
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidos pela própria plataforma.
// verify_jwt desligado: conferir cadastro acontece antes de existir conta; o gateway confere o token por conta própria.
import { criarHandlerDelivery } from '../../../src/delivery/gateway.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

const handler = criarHandlerDelivery({
  supabaseUrl: env('SUPABASE_URL'),
  supabaseChave: env('SUPABASE_SERVICE_ROLE_KEY'),
  // só metadados: nunca corpo, cabeçalhos, e-mail ou CPF
  registrar: (e) => (e.status >= 500 ? console.error('delivery-gateway', JSON.stringify(e)) : console.log('delivery-gateway', JSON.stringify(e))),
});

Deno.serve(handler);
