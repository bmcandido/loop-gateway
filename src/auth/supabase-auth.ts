import { ErroGateway, type UsuarioAutenticado, type ValidadorToken } from '../core/tipos.ts';

const CACHE_TOKEN_MS = 60 * 1000;

/**
 * Confere o login no próprio Supabase Auth, como o Add-on. O projeto assina os tokens com HS256 e não
 * publica JWKS; assim não há segredo a guardar aqui e sessão encerrada deixa de valer. Resultado guardado
 * por pouco tempo, pelo resumo do token.
 */
export function validadorPeloAuth(op: { url: string; chave: string; http?: typeof fetch; agora?: () => number }): ValidadorToken {
  const url = `${op.url.replace(/\/+$/, '')}/auth/v1/user`;
  const http = op.http ?? fetch;
  const agora = op.agora ?? Date.now;
  const cache = new Map<string, { usuario: UsuarioAutenticado; ate: number }>();

  return {
    async validar(token: string): Promise<UsuarioAutenticado> {
      const chave = await resumo(token);
      const c = cache.get(chave);
      if (c && agora() < c.ate) return c.usuario;
      let r: Response;
      try {
        r = await http(url, { headers: { apikey: op.chave, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      } catch {
        throw new ErroGateway(503, 'SUPABASE_INDISPONIVEL', 'Serviço indisponível. Tente novamente.');
      }
      if (r.status === 401 || r.status === 403) throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão expirada. Entre novamente.');
      if (!r.ok) throw new ErroGateway(503, 'SUPABASE_INDISPONIVEL', 'Serviço indisponível. Tente novamente.');
      const conta = (await r.json()) as Record<string, unknown>;
      const uid = typeof conta.id === 'string' ? conta.id : '';
      const email = typeof conta.email === 'string' ? conta.email.trim().toLowerCase() : '';
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !email) throw new ErroGateway(401, 'TOKEN_SEM_EMAIL', 'Esta conta não tem e-mail válido.');
      if (!conta.email_confirmed_at) throw new ErroGateway(403, 'EMAIL_NAO_VERIFICADO', 'Confirme seu e-mail pelo link que enviamos para acessar.');
      const usuario: UsuarioAutenticado = { origem: 'SUPABASE', uid, email };
      if (cache.size >= 2000) cache.delete(cache.keys().next().value as string);
      cache.set(chave, { usuario, ate: agora() + CACHE_TOKEN_MS });
      return usuario;
    },
  };
}

async function resumo(texto: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}
