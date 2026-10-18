import type { Firestore } from 'firebase-admin/firestore';
import type { CredenciaisSankhya, FonteCredenciais } from '../core/tipos.ts';

const CACHE_MS = 5 * 60 * 1000;

/** Documento só do servidor: as regras do Firestore negam qualquer acesso do app. */
export const COLECAO_PRIVADA = 'portalPrivado';

type Doc = Record<string, unknown>;

/** O mínimo do Firestore que a leitura usa (facilita o teste). */
export interface LeitorFirestore {
  doc(caminho: string): { get(): Promise<{ data(): Doc | undefined }> };
  collection(caminho: string): { limit(n: number): { get(): Promise<{ empty: boolean; docs: { data(): Doc }[] }> } };
}

/**
 * Credenciais do Sankhya, lidas no servidor pelo Admin SDK.
 *
 * Primeiro em `portalPrivado/{cnpj}` (campos token, oautAuthetication,
 * appKey, userName, password, clienteIdProducao, clienteSecretProducao).
 * Sem esse documento, nos lugares que a versão antiga do app usa (apiKey e
 * empresas/{cnpj}), para a versão de teste rodar antes do corte. No corte, os
 * campos vão para o documento privado e saem dos documentos que o app lê.
 */
export function credenciaisDoFirestore(db: Firestore | LeitorFirestore, cnpj: string): FonteCredenciais {
  const cnpjLimpo = cnpj.replace(/\D/g, '');
  if (cnpjLimpo.length !== 14) throw new Error('PORTAL_CNPJ inválido.');
  const leitor = db as LeitorFirestore;

  let cache: { valor: CredenciaisSankhya; ate: number } | undefined;

  return async () => {
    if (cache && Date.now() < cache.ate) return cache.valor;

    const privado = (await leitor.doc(`${COLECAO_PRIVADA}/${cnpjLimpo}`).get()).data();
    let empresa: Doc;
    let chaves: Doc;
    if (privado) {
      empresa = privado;
      chaves = privado;
    } else {
      const [e, k] = await Promise.all([
        leitor.doc(`empresas/${cnpjLimpo}`).get(),
        leitor.collection('apiKey').limit(1).get(),
      ]);
      empresa = e.data() ?? {};
      chaves = k.empty ? {} : k.docs[0].data();
    }

    const valor = montar(empresa, chaves);
    const faltando = Object.entries(valor).some(([, v]) => v === '');
    if (faltando) throw new Error('Credenciais do Sankhya incompletas no Firestore.');

    cache = { valor, ate: Date.now() + CACHE_MS };
    return valor;
  };
}

function montar(e: Doc, k: Doc): CredenciaisSankhya {
  const xToken = txt(e.token);
  return e.oautAuthetication === true
    ? { modo: 'OAUTH', xToken, clientId: txt(k.clienteIdProducao), clientSecret: txt(k.clienteSecretProducao) }
    : { modo: 'LOGIN', xToken, appKey: txt(k.appKey), usuario: txt(k.userName), senha: txt(k.password) };
}

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
