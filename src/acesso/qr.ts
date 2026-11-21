import { limitadorPublico } from '../core/gateway-app.ts';
import { appValido, clienteSupabase, lerCorpo, Recusa, responder, respostaDeErro, sha256Hex, type OpcoesSupabase } from './comum.ts';

// acesso-qr: o app troca o token do QR (gerado no Add-on pelo acesso-admin) por uma sessão do Supabase.
// Sem login (o usuário ainda não tem senha). O token é de uso único, vale 10 min, é preso a um usuário e a um
// app, e só o hash fica no banco. Lido uma vez, é invalidado (acesso_token_consumir).
//
// POST { token, app } → 200 { ok, sessao: { accessToken, refreshToken, expiresIn }, trocarSenha: true }
//   401 QR_INVALIDO (vencido, usado, de outro app, usuário inativo) · 429 · 503
// O app grava a sessão (setSession) e abre a tela obrigatória "Crie sua senha".

const LIMITE_POR_MINUTO = 10;

export interface OpcoesAcessoQr extends OpcoesSupabase {
  agoraMs?: () => number;
  limitar?: (origem: string) => boolean;
  registrar?: (e: { status: number; app?: string; codigo?: string; ms: number }) => void;
}

export function criarHandlerAcessoQr(op: OpcoesAcessoQr): (req: Request) => Promise<Response> {
  const sb = clienteSupabase(op);
  const agora = op.agoraMs ?? Date.now;
  const limitar = op.limitar ?? limitadorPublico(LIMITE_POR_MINUTO, 60_000, agora);
  const invalido = () => new Recusa(401, 'QR_INVALIDO', 'QR Code inválido ou vencido. Peça um novo ao administrador.');

  /** Sessão para a conta sem senha: link mágico gerado e verificado no servidor (nunca sai daqui). */
  async function sessaoPara(email: string) {
    const g = await sb.auth('admin/generate_link', 'POST', { type: 'magiclink', email });
    const corpo = (g.corpo ?? {}) as { hashed_token?: string; properties?: { hashed_token?: string } };
    const hash = corpo.properties?.hashed_token ?? corpo.hashed_token;
    if (g.status >= 300 || !hash) throw new Recusa(503, 'SUPABASE_RECUSOU', 'Não foi possível entrar agora. Tente novamente.');
    const v = await sb.auth('verify', 'POST', { type: 'magiclink', token_hash: hash });
    const s = (v.corpo ?? {}) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (v.status >= 300 || !s.access_token || !s.refresh_token) throw new Recusa(503, 'SUPABASE_RECUSOU', 'Não foi possível entrar agora. Tente novamente.');
    return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresIn: s.expires_in ?? 3600 };
  }

  return async (req) => {
    const t0 = agora();
    let app: string | undefined;
    const fim = (res: Response, codigo: string) => {
      op.registrar?.({ status: res.status, app, codigo, ms: agora() - t0 });
      return res;
    };
    try {
      if (req.method === 'OPTIONS') return fim(responder(204, {}, true), 'OPTIONS');
      if (req.method !== 'POST') throw new Recusa(405, 'METODO_INVALIDO', 'Use POST.');
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'sem-ip';
      if (!limitar(ip)) throw new Recusa(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um minuto.');
      const o = await lerCorpo(req, 2048);
      if (!appValido(o.app)) throw invalido();
      app = o.app;
      const token = typeof o.token === 'string' ? o.token.trim() : '';
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw invalido();

      const [dono] = await sb.rpc<{ email: string; auth_user_id: string; cpf_cnpj: string }[]>('acesso_token_consumir', {
        p_token_hash: await sha256Hex(token),
        p_tipo: 'qr',
        p_app: app,
      });
      if (!dono) throw invalido();
      const sessao = await sessaoPara(dono.email);
      return fim(responder(200, { ok: true, codigo: 'OK', sessao, trocarSenha: true }, true), 'OK');
    } catch (e) {
      if (!(e instanceof Recusa)) console.error('acesso-qr', (e as Error)?.message);
      return fim(respostaDeErro(e, true), e instanceof Recusa ? e.codigo : 'ERRO');
    }
  };
}
