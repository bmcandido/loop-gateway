// Edge Function do Supabase: o add-on (LoopDelivery, LoopEcommerce) busca a chave do LoopSign quando o LoopSign está
// vinculado ao produto dele no contrato. Autenticada pela chave da instalação do add-on (x-loop-cliente-chave).
// Plano: loop-admin/.melhorias/loopsign-vinculado/PLANO.md
//
//   supabase functions deploy loopsign-integracao --no-verify-jwt --project-ref zvncvdlfyeyktnuzxvlc
//
// Segredos (gravados pelo responsável, nunca no repositório):
//   LOOPSIGN_URL                 base do LoopSign (ex.: https://sign.loopapp.com.br)
//   LOOPSIGN_INTEGRACAO_SECRET   mesmo valor do LOOPSIGN_INTEGRACAO_SECRET do servidor do LoopSign
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidos pela própria plataforma.
import { criarHandlerLoopSignIntegracao } from '../../../src/loopsign-integracao/handler.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

const handler = criarHandlerLoopSignIntegracao({
  supabaseUrl: env('SUPABASE_URL'),
  supabaseChave: env('SUPABASE_SERVICE_ROLE_KEY'),
  loopsignUrl: env('LOOPSIGN_URL') || 'https://sign.loopapp.com.br',
  segredo: env('LOOPSIGN_INTEGRACAO_SECRET'),
  // só metadados: nunca chave, CNPJ ou corpo
  registrar: (e) => (e.status >= 500 ? console.error('loopsign-integracao', JSON.stringify(e)) : console.log('loopsign-integracao', JSON.stringify(e))),
});

Deno.serve(handler);
