import assert from 'node:assert/strict';
import { test } from 'node:test';
import { credenciaisDoFirestore, type LeitorFirestore } from '../src/firebase/credenciais.ts';

const CNPJ = '36.841.880/0001-76';

function fakeDb(docs: Record<string, Record<string, unknown>>, apiKey?: Record<string, unknown>) {
  const lidos: string[] = [];
  const db: LeitorFirestore = {
    doc(caminho) {
      return {
        async get() {
          lidos.push(caminho);
          return { data: () => docs[caminho] };
        },
      };
    },
    collection(caminho) {
      return {
        limit() {
          return {
            async get() {
              lidos.push(caminho);
              return { empty: !apiKey, docs: apiKey ? [{ data: () => apiKey }] : [] };
            },
          };
        },
      };
    },
  };
  return { db, lidos };
}

const LOGIN = { token: ' xtok ', appKey: 'ak', userName: 'tecnico', password: 'senha' };

test('documento privado tem prioridade e dispensa os documentos que o app lê', async () => {
  const { db, lidos } = fakeDb({ 'portalPrivado/36841880000176': LOGIN });
  const c = await credenciaisDoFirestore(db, CNPJ)();
  assert.deepEqual(c, { modo: 'LOGIN', xToken: 'xtok', appKey: 'ak', usuario: 'tecnico', senha: 'senha' });
  assert.deepEqual(lidos, ['portalPrivado/36841880000176']);
});

test('sem documento privado usa empresas/{cnpj} + apiKey (versão de teste antes do corte)', async () => {
  const { db, lidos } = fakeDb(
    { 'empresas/36841880000176': { token: 'xtok', oautAuthetication: true } },
    { clienteIdProducao: 'cid', clienteSecretProducao: 'csec' },
  );
  const c = await credenciaisDoFirestore(db, CNPJ)();
  assert.deepEqual(c, { modo: 'OAUTH', xToken: 'xtok', clientId: 'cid', clientSecret: 'csec' });
  assert.ok(lidos.includes('apiKey'));
});

test('credencial faltando é erro, sem expor valores', async () => {
  const { db } = fakeDb({ 'portalPrivado/36841880000176': { ...LOGIN, password: '' } });
  await assert.rejects(credenciaisDoFirestore(db, CNPJ)(), (e: Error) => {
    assert.match(e.message, /incompletas/);
    assert.doesNotMatch(e.message, /tecnico|xtok/);
    return true;
  });
});

test('cache evita nova leitura dentro de 5 minutos', async () => {
  const { db, lidos } = fakeDb({ 'portalPrivado/36841880000176': LOGIN });
  const fonte = credenciaisDoFirestore(db, CNPJ);
  await fonte();
  await fonte();
  assert.equal(lidos.length, 1);
});

test('CNPJ inválido é recusado na configuração', () => {
  assert.throws(() => credenciaisDoFirestore(fakeDb({}).db, '123'), /PORTAL_CNPJ/);
});
