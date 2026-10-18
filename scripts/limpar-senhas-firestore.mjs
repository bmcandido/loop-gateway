// Remove o campo `pass` (senha em texto) dos usuários em empresas/{cnpj}/usuarios.
// Versões antigas do app gravavam a senha do cliente ali; nada no app lê esse
// campo (o login é pelo Firebase Auth), então a remoção não afeta ninguém.
//
// Simulação (padrão, só conta):  node scripts/limpar-senhas-firestore.mjs <projeto> <cnpj>
// Aplicar:                        node scripts/limpar-senhas-firestore.mjs <projeto> <cnpj> --aplicar
//
// Credenciais: `gcloud auth application-default login` com uma conta que tenha
// acesso ao projeto. O script nunca imprime e-mails nem senhas.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const [projeto, cnpjBruto, flag] = process.argv.slice(2);
const cnpj = (cnpjBruto ?? '').replace(/\D/g, '');
if (!projeto || cnpj.length !== 14) {
  console.error('Uso: node scripts/limpar-senhas-firestore.mjs <projeto> <cnpj> [--aplicar]');
  process.exit(1);
}
const aplicar = flag === '--aplicar';

initializeApp({ credential: applicationDefault(), projectId: projeto });
const db = getFirestore();

const usuarios = await db.collection(`empresas/${cnpj}/usuarios`).get();
const comSenha = usuarios.docs.filter((d) => d.get('pass') !== undefined);
console.log(`Usuários: ${usuarios.size}. Com campo "pass": ${comSenha.length}.`);

if (!aplicar) {
  console.log('Simulação: nada foi alterado. Rode com --aplicar para remover.');
  process.exit(0);
}

let feitos = 0;
for (let i = 0; i < comSenha.length; i += 400) {
  const lote = db.batch();
  for (const d of comSenha.slice(i, i + 400)) lote.update(d.ref, { pass: FieldValue.delete() });
  await lote.commit();
  feitos += Math.min(400, comSenha.length - i);
}
console.log(`Campo "pass" removido de ${feitos} usuário(s).`);
