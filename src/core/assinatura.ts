import type { UsuarioAutenticado } from './tipos.ts';

// Identidade assinada que o Add-on confere (businesRules.acesso.GatewayAssinatura).
// Formato e mensagem precisam ser idênticos nas duas pontas.
//
// v2: ES256 com a chave privada ÚNICA do gateway; o Add-on confere com a chave pública que vai
// embarcada no pacote. Nenhum segredo por cliente. O CNPJ (tirado da licença assinada pelo Loop Mais)
// entra na mensagem: identidade emitida para o cliente A não serve no Sankhya do cliente B.
// (A v1, HMAC com LOOPPORTAL_GATEWAY_SECRET por servidor, não é mais emitida.)

export interface PortalAuthV2 {
  v: 2;
  kid: string;
  cnpj: string;
  origem: string;
  uid: string;
  email: string;
  ts: number;
  sig: string;
}

const texto = new TextEncoder();

export function mensagemV2(cnpj: string, origem: string, uid: string, email: string, ts: number): string {
  return `v2\n${cnpj}\n${origem}\n${uid}\n${email}\n${ts}`;
}

/** Importa a chave privada (PKCS#8 PEM, EC P-256) guardada no Secret Manager. */
export async function chavePrivadaGateway(pem: string): Promise<CryptoKey> {
  const corpo = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  if (!corpo) throw new Error('Chave privada do gateway vazia.');
  const der = Uint8Array.from(atob(corpo), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export type AssinadorIdentidade = (u: UsuarioAutenticado, cnpj: string, agoraSeg: number) => Promise<PortalAuthV2>;

/** Assinador v2. A assinatura sai no formato JOSE (r||s, 64 bytes), base64url sem padding. */
export function assinadorV2(chave: CryptoKey, kid: string): AssinadorIdentidade {
  return async (u, cnpj, agoraSeg) => {
    const ts = Math.floor(agoraSeg);
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, texto.encode(mensagemV2(cnpj, u.origem, u.uid, u.email, ts))),
    );
    return { v: 2, kid, cnpj, origem: u.origem, uid: u.uid, email: u.email, ts, sig: base64Url(sig) };
  };
}

export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
