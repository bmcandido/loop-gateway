import { ErroGateway, type UsuarioAutenticado, type ValidadorToken } from '../core/tipos.ts';

/**
 * Login aceito pelo gateway único: Supabase Auth (padrão Loop) e, só para clientes legados,
 * Firebase Auth dos projetos listados. O emissor do token decide o validador; a assinatura é
 * sempre conferida pelo validador escolhido.
 */
export function validadorCombinado(supabase: ValidadorToken, firebase?: ValidadorToken): ValidadorToken {
  return {
    async validar(token: string): Promise<UsuarioAutenticado> {
      const iss = emissor(token);
      if (iss.startsWith('https://securetoken.google.com/')) {
        if (!firebase) throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão expirada. Entre novamente.');
        return firebase.validar(token);
      }
      return supabase.validar(token);
    },
  };
}

/** `iss` do JWT sem conferir (só para escolher o validador). */
function emissor(token: string): string {
  try {
    const corpo = token.split('.')[1] ?? '';
    const b = corpo.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4)));
    return typeof json.iss === 'string' ? json.iss : '';
  } catch {
    return '';
  }
}
