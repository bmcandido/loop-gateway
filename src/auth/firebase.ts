import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';
import { ErroGateway, type UsuarioAutenticado, type ValidadorToken } from '../core/tipos.ts';

const JWKS_GOOGLE = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface OpcoesFirebase {
  /**
   * Exige e-mail confirmado (padrão: sim). O Firebase deixa criar conta com
   * qualquer e-mail; como o portal identifica o cliente pelo e-mail, conta
   * não confirmada poderia se passar por outro cliente.
   */
  exigirEmailVerificado?: boolean;
}

/**
 * ID token do Firebase Auth: RS256 assinado pelo Google, emissor e audiência
 * do projeto. As chaves públicas ficam em cache (jose respeita a rotação).
 */
export function validadorFirebase(projeto: string | string[], opcoes: OpcoesFirebase = {}): ValidadorToken {
  // Gateway único: aceita login de mais de um projeto Firebase (apps de clientes diferentes).
  const projetos = (Array.isArray(projeto) ? projeto : [projeto]).filter(Boolean);
  if (!projetos.length) throw new Error('Projeto Firebase não informado.');
  const chaves = createRemoteJWKSet(new URL(JWKS_GOOGLE));
  const exigirVerificado = opcoes.exigirEmailVerificado ?? true;
  return {
    async validar(token: string): Promise<UsuarioAutenticado> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, chaves, {
          issuer: projetos.map((p) => `https://securetoken.google.com/${p}`),
          audience: projetos,
          algorithms: ['RS256'],
        }));
        // emissor e audiência do MESMO projeto
        if (payload.iss !== `https://securetoken.google.com/${payload.aud}`) throw new Error('iss/aud');
      } catch {
        throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão expirada. Entre novamente.');
      }
      exigirEmailConfirmado(payload, exigirVerificado);
      return usuarioDoPayload('FIREBASE', payload);
    },
  };
}

export function exigirEmailConfirmado(payload: JWTPayload, exigir: boolean): void {
  if (exigir && payload.email_verified !== true) {
    throw new ErroGateway(403, 'EMAIL_NAO_VERIFICADO', 'Confirme seu e-mail pelo link que enviamos para acessar o portal.');
  }
}

export function usuarioDoPayload(origem: UsuarioAutenticado['origem'], payload: JWTPayload): UsuarioAutenticado {
  const uid = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) {
    // conta sem e-mail (ex.: telefone/anônima) não identifica cliente do portal
    throw new ErroGateway(401, 'TOKEN_SEM_EMAIL', 'Esta conta não tem e-mail válido para o portal.');
  }
  return { origem, uid, email };
}
