// Gera a chave da Loop API de um cliente (a mesma conta de gerarChaveLoopApi em src/core/loopapi.ts).
//
//   LOOPAPI_SEGREDO_CHAVES=<segredo do gateway> node scripts/chave-loopapi.mjs 37647026000136
//
// A chave vai em LOOPWHATSAPPCONFIG.TOKEN, na linha EVOLUTION da empresa desse CNPJ.
import { createHmac } from 'node:crypto';

const segredo = process.env.LOOPAPI_SEGREDO_CHAVES ?? '';
const cnpj = (process.argv[2] ?? '').replace(/\D/g, '');

if (!segredo) {
  console.error('Informe LOOPAPI_SEGREDO_CHAVES no ambiente.');
  process.exit(1);
}
if (cnpj.length !== 14) {
  console.error('Informe o CNPJ com 14 dígitos.');
  process.exit(1);
}

const assinatura = createHmac('sha256', segredo).update(`loopapi\n${cnpj}`).digest('base64url');
console.log(`${cnpj}.${assinatura}`);
