// Chaves e licenças SÓ DE TESTE (nunca usadas em produção).
import { createPrivateKey, sign } from 'node:crypto';

/** Par de chaves de teste do gateway (v2). O mesmo vetor está em GatewayAssinaturaTest.java. */
export const GATEWAY_TESTE = {
  kid: 'loop-gateway-teste',
  privada:
    '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgbkG/JuQTdQhpEiWe\n2+yTpcYH10ZvDEUfLnB1JhwXV4GhRANCAAQPE9ryXtNBPdukneW1AdHzAlCyfMlB\nBvcg46mnerdKncHvNVz4+gLRUzflq/gGW3wmt5qQWFyUqtGz9lNAeb1j\n-----END PRIVATE KEY-----\n',
  jwk: { kty: 'EC', crv: 'P-256', x: 'DxPa8l7TQT3bpJ3ltQHR8wJQsnzJQQb3IOOpp3q3Sp0', y: 'we81XPj6AtFTN-Wr-AZbfCa3mpBYXJSq0bP2U0B5vWM' },
  /** Assinatura fixa de mensagemV2('36841880000176','FIREBASE','uidTeste123','ana@loop.com.br',1760000000). */
  sigReferencia: '3WOyRR9CcmwmOT4LLIGWj2F7CANXOoOeT31Voko0OOcdj4XCgglPpT4SvF0Zej3ioKheFJqJfizAdnn1RjRckQ',
};

/** "Loop Mais" de teste: usa a mesma chave para assinar licenças nos testes do gateway. */
export const LICENCA_TESTE = { kid: 'loop-licenca-teste', x: GATEWAY_TESTE.jwk.x, y: GATEWAY_TESTE.jwk.y };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** JWS de licença como o Loop Mais gera (ES256, typ loop-licenca+jws). */
export function licencaAssinada(conteudo: Record<string, unknown>, kid = LICENCA_TESTE.kid): string {
  const cab = b64({ alg: 'ES256', typ: 'loop-licenca+jws', kid });
  const corpo = b64({ ver: 1, ...conteudo });
  const sig = sign('sha256', Buffer.from(`${cab}.${corpo}`), { key: createPrivateKey(GATEWAY_TESTE.privada), dsaEncoding: 'ieee-p1363' });
  return `${cab}.${corpo}.${sig.toString('base64url')}`;
}

export const PORTAL = { active: true, titulo: 'Loop Portal', produto_id: 'dbd544b3-0bc2-40f3-9001-639ce339541e' };

export const licencaDe = (cnpj: string, produtos: unknown[] = [PORTAL], status = 'ativo') =>
  licencaAssinada({ empresa: { cnpj }, licenca: { status, produtos } });
