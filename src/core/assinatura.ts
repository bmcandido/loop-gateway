import type { UsuarioAutenticado } from './tipos.ts';

// Identidade assinada que o Add-on confere (businesRules.acesso.GatewayAssinatura).
// Formato e mensagem precisam ser idênticos nas duas pontas.

export const TAMANHO_MINIMO_SEGREDO = 32;

export interface PortalAuth {
  v: 1;
  origem: string;
  uid: string;
  email: string;
  ts: number;
  sig: string;
}

const texto = new TextEncoder();

export function mensagem(origem: string, uid: string, email: string, ts: number): string {
  return `v1\n${origem}\n${uid}\n${email}\n${ts}`;
}

export async function assinar(segredo: string, msg: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', texto.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', chave, texto.encode(msg)));
  return base64Url(sig);
}

export async function identidadeAssinada(u: UsuarioAutenticado, segredo: string, agoraSeg: number): Promise<PortalAuth> {
  const ts = Math.floor(agoraSeg);
  return {
    v: 1,
    origem: u.origem,
    uid: u.uid,
    email: u.email,
    ts,
    sig: await assinar(segredo, mensagem(u.origem, u.uid, u.email, ts)),
  };
}

export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
