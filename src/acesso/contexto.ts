import { validadorPeloAuth } from '../auth/supabase-auth.ts';
import { ErroGateway, type ValidadorToken } from '../core/tipos.ts';
import { appValido, clienteSupabase, lerCorpo, Recusa, responder, respostaDeErro, type OpcoesSupabase } from './comum.ts';

// acesso-contexto: o app logado descobre empresa, perfil, situação, licença e se precisa criar senha.
// Substitui o CNPJ digitado no app. Chamado após o login e quando o app volta para o primeiro plano.
//
// POST { app, evento? }  Authorization: Bearer <sessão do usuário>
//   evento 'senha_criada': depois da tela "Crie sua senha" (encerra a obrigação; convidado → ativo).
//   200 { ok, codigo, mensagem?, cnpj, empresa, email, nome, perfil, apps, situacao, trocarSenha, licenca }
//     ok=false com codigo SEM_CADASTRO | APP_NAO_LIBERADO | USUARIO_INATIVO | LICENCA_VENCIDA | LIMITE_LICENCAS:
//     o app mostra a mensagem e não libera o uso.
//   401 sessão inválida · 503

export interface OpcoesAcessoContexto extends OpcoesSupabase {
  validador?: ValidadorToken;
  agoraMs?: () => number;
  registrar?: (e: { status: number; app?: string; codigo?: string; ms: number }) => void;
}

export function criarHandlerAcessoContexto(op: OpcoesAcessoContexto): (req: Request) => Promise<Response> {
  const sb = clienteSupabase(op);
  const agora = op.agoraMs ?? Date.now;
  const validador = op.validador ?? validadorPeloAuth({ url: op.supabaseUrl, chave: op.supabaseChave, http: op.http });

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
      const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
      if (!m) throw new Recusa(401, 'LOGIN_NECESSARIO', 'Entre novamente.');
      let uid: string;
      try {
        uid = (await validador.validar(m[1])).uid;
      } catch (e) {
        if (e instanceof ErroGateway) throw new Recusa(e.status, e.codigo, e.message);
        throw e;
      }
      const o = await lerCorpo(req, 1024);
      if (!appValido(o.app)) throw new Recusa(400, 'PEDIDO_INVALIDO', 'Aplicativo inválido.');
      app = o.app;
      const evento = o.evento === 'senha_criada' ? 'senha_criada' : null;
      const ctx = await sb.rpc<Record<string, unknown>>('acesso_contexto', { p_auth_user_id: uid, p_app: app, p_evento: evento });
      return fim(responder(200, ctx ?? { ok: false, codigo: 'SEM_CADASTRO' }, true), String(ctx?.codigo ?? 'SEM_CADASTRO'));
    } catch (e) {
      if (!(e instanceof Recusa)) console.error('acesso-contexto', (e as Error)?.message);
      return fim(respostaDeErro(e, true), e instanceof Recusa ? e.codigo : 'ERRO');
    }
  };
}
