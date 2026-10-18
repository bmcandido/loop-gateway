import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';
import { ErroGateway, type UsuarioAutenticado, type ValidadorToken } from '../core/tipos.ts';
import { usuarioDoPayload } from './firebase.ts';

/**
 * Access token do Supabase Auth. Projetos com chaves assimétricas usam o JWKS
 * do projeto; projetos antigos (HS256) informam o segredo JWT.
 */
export function validadorSupabase(urlProjeto: string, segredoJwtLegado?: string): ValidadorToken {
  const base = urlProjeto.replace(/\/+$/, '');
  const emissor = `${base}/auth/v1`;
  const chave = segredoJwtLegado
    ? new TextEncoder().encode(segredoJwtLegado)
    : createRemoteJWKSet(new URL(`${emissor}/.well-known/jwks.json`));
  const algoritmos = segredoJwtLegado ? ['HS256'] : ['ES256', 'RS256'];

  return {
    async validar(token: string): Promise<UsuarioAutenticado> {
      let payload: JWTPayload;
      try {
        // overload por tipo de chave: segredo (Uint8Array) ou JWKS remoto
        ({ payload } = await jwtVerify(token, chave as Parameters<typeof jwtVerify>[1] & Uint8Array, {
          issuer: emissor,
          audience: 'authenticated',
          algorithms: algoritmos,
        }));
      } catch {
        throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão expirada. Entre novamente.');
      }
      return usuarioDoPayload('SUPABASE', payload);
    },
  };
}
