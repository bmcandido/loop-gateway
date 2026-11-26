import { limitadorPublico } from '../core/gateway-app.ts';
import {
  clienteSupabase,
  lerCorpo,
  Recusa,
  responder,
  respostaDeErro,
  sha256Hex,
  soDigitos,
  tokenAleatorio,
  type OpcoesSupabase,
} from '../acesso/comum.ts';

// loopsign-integracao: o add-on (LoopDelivery, LoopEcommerce) busca sozinho a chave do LoopSign quando o LoopSign
// está VINCULADO ao produto dele no contrato. Sem usuário logado e sem ninguém entrar no LoopSign.
// Plano: loop-admin/.melhorias/loopsign-vinculado/PLANO.md (seção 3.5).
//
// Autenticação: cabeçalho x-loop-cliente-chave (chave lpk_ da instalação do add-on, aprovada pela Loop no contrato;
// só o SHA-256 fica em public.loop_addon_chaves). O CNPJ é o da chave, nunca o do corpo.
// Depois, servidor-a-servidor: POST <LOOPSIGN_URL>/api/loopsign/integracoes/loop/vinculado/chave, assinado com HMAC v2
// (LOOPSIGN_INTEGRACAO_SECRET, o mesmo valor no LoopSign). O LoopSign confere pela licença que o LoopSign está mesmo
// vinculado ao produto, cria a empresa se faltar e emite uma chave nova (revogando a anterior deste caminho).
//
// POST { produto: "LoopDelivery" | "LoopEcommerce" }
// 200 { ok, codigo: "OK", chave, prefixo, escopo, expiraEm, url }   (url = base da API do LoopSign para o add-on)
// Recusas: CHAVE_INVALIDA (401), CHAVE_PENDENTE (423), PEDIDO_INVALIDO (400), SEM_VINCULO (403),
//   SEM_LICENCA (403), EMPRESA_LOOP (409), MUITAS_TENTATIVAS (429), LOOPSIGN_INDISPONIVEL (503).
// A chave do LoopSign só sai nesta resposta (no-store) e nunca vai para o log.

export const PRODUTOS_INTEGRACAO = ['LoopDelivery', 'LoopEcommerce'] as const;
export type ProdutoIntegracao = (typeof PRODUTOS_INTEGRACAO)[number];
/** Contexto da assinatura v2: o mesmo do controller do LoopSign (integracao-vinculada.controller.js). */
export const CONTEXTO_ASSINATURA = 'loopgateway.loopsign.integracao.chave';
/** O add-on só pede quando não tem chave, perto do vencimento ou depois de um 401/403 do LoopSign. */
const LIMITE_POR_MINUTO = 10;
const TIMEOUT_LOOPSIGN_MS = 20_000;

export interface OpcoesLoopSignIntegracao extends OpcoesSupabase {
  /** Base do LoopSign, ex.: https://sign.loopapp.com.br */
  loopsignUrl: string;
  /** LOOPSIGN_INTEGRACAO_SECRET (mesmo valor no LoopSign). */
  segredo: string;
  limitar?: (origem: string) => boolean;
  agoraMs?: () => number;
  novoNonce?: () => string;
  /** Só metadados: nunca a chave do add-on, a chave do LoopSign ou o CNPJ completo. */
  registrar?: (e: { status: number; produto?: string; codigo?: string; ms: number }) => void;
}

interface ChaveAddon {
  id: string;
  cpf_cnpj: string;
  status: string;
}

const produtoValido = (p: unknown): p is ProdutoIntegracao => typeof p === 'string' && (PRODUTOS_INTEGRACAO as readonly string[]).includes(p);

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** v2=hex(HMAC-SHA256(segredo, "v2|<contexto>|<timestamp>|<nonce>|<partes...>")) — utils/hmac-contexto.util.js do LoopSign. */
export async function assinarV2(segredo: string, contexto: string, timestamp: string, nonce: string, partes: string[]): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mensagem = ['v2', contexto, timestamp, nonce, ...partes].join('|');
  return `v2=${hex(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(mensagem)))}`;
}

/** Tradução da recusa do LoopSign para o add-on (sem repassar texto interno). */
function recusaDoLoopSign(status: number, code: string | undefined): Recusa {
  if (status === 403 && code === 'SEM_VINCULO') {
    return new Recusa(403, 'SEM_VINCULO', 'O LoopSign não está vinculado a este módulo no contrato. Fale com a Loop.');
  }
  if (status === 403) return new Recusa(403, 'SEM_LICENCA', 'O LoopSign não está licenciado para esta empresa. Fale com a Loop.');
  if (status === 409 && code === 'MATRIZ') return new Recusa(409, 'EMPRESA_LOOP', 'Empresa Loop: gere a chave no painel do LoopSign.');
  if (status === 400) return new Recusa(400, 'PEDIDO_INVALIDO', 'Pedido inválido.');
  return new Recusa(503, 'LOOPSIGN_INDISPONIVEL', 'LoopSign indisponível. Tente novamente em alguns minutos.');
}

export function criarHandlerLoopSignIntegracao(op: OpcoesLoopSignIntegracao): (req: Request) => Promise<Response> {
  const sb = clienteSupabase(op);
  const agora = op.agoraMs ?? Date.now;
  const limitar = op.limitar ?? limitadorPublico(LIMITE_POR_MINUTO, 60_000, agora);
  const novoNonce = op.novoNonce ?? (() => tokenAleatorio(16));
  const http = op.http ?? fetch;
  const base = String(op.loopsignUrl || '').replace(/\/+$/, '');

  async function chaveDoAddon(valor: string): Promise<ChaveAddon> {
    if (valor.length < 32) throw new Recusa(401, 'CHAVE_INVALIDA', 'Chave da instalação inválida.');
    const [c] = await sb.select<ChaveAddon>('loop_addon_chaves', {
      select: 'id,cpf_cnpj,status',
      chave_hash: `eq.${await sha256Hex(valor)}`,
      revogada_em: 'is.null',
      limit: '1',
    });
    if (!c || c.status === 'recusada') throw new Recusa(401, 'CHAVE_INVALIDA', 'Chave da instalação inválida.');
    if (c.status !== 'aprovada') throw new Recusa(423, 'CHAVE_PENDENTE', 'A chave desta instalação aguarda a liberação da Loop.');
    return c;
  }

  async function pedirAoLoopSign(cnpj: string, produto: ProdutoIntegracao) {
    if (!base || !op.segredo) {
      console.error('loopsign-integracao', 'LOOPSIGN_URL ou LOOPSIGN_INTEGRACAO_SECRET ausente');
      throw new Recusa(503, 'LOOPSIGN_INDISPONIVEL', 'LoopSign indisponível. Tente novamente em alguns minutos.');
    }
    const timestamp = String(Math.floor(agora() / 1000));
    const nonce = novoNonce();
    const assinatura = await assinarV2(op.segredo, CONTEXTO_ASSINATURA, timestamp, nonce, [cnpj, produto]);
    let r: Response;
    try {
      r = await http(`${base}/api/loopsign/integracoes/loop/vinculado/chave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Loop-Gateway-Timestamp': timestamp,
          'X-Loop-Gateway-Nonce': nonce,
          'X-Loop-Gateway-Signature': assinatura,
        },
        body: JSON.stringify({ cnpj, produto }),
        signal: AbortSignal.timeout(TIMEOUT_LOOPSIGN_MS),
      });
    } catch {
      throw new Recusa(503, 'LOOPSIGN_INDISPONIVEL', 'LoopSign indisponível. Tente novamente em alguns minutos.');
    }
    let corpo: any = null;
    try {
      corpo = await r.json();
    } catch {
      corpo = null;
    }
    if (r.status !== 200 || !corpo?.success || typeof corpo?.data?.chave !== 'string') {
      if (r.status === 401 || r.status === 404) console.error('loopsign-integracao', 'LoopSign recusou a assinatura do gateway', r.status);
      throw recusaDoLoopSign(r.status, corpo?.code ?? corpo?.details?.code ?? corpo?.error?.code);
    }
    return corpo.data as { chave: string; prefixo: string; escopo: string; expira_em: string };
  }

  return async (req) => {
    const t0 = agora();
    let produto: string | undefined;
    const fim = (res: Response, codigo?: string) => {
      op.registrar?.({ status: res.status, produto, codigo, ms: agora() - t0 });
      return res;
    };
    try {
      if (req.method !== 'POST') throw new Recusa(405, 'METODO_INVALIDO', 'Use POST.');
      const valorChave = req.headers.get('x-loop-cliente-chave') ?? '';
      if (!limitar(valorChave.slice(0, 64) || 'sem-chave')) throw new Recusa(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um minuto.');
      const corpo = await lerCorpo(req, 1024);
      if (!produtoValido(corpo.produto)) throw new Recusa(400, 'PEDIDO_INVALIDO', 'Informe o produto: LoopDelivery ou LoopEcommerce.');
      produto = corpo.produto;
      const chave = await chaveDoAddon(valorChave);
      const cnpj = soDigitos(chave.cpf_cnpj);
      if (![11, 14].includes(cnpj.length)) throw new Recusa(401, 'CHAVE_INVALIDA', 'Chave da instalação inválida.');
      const emitida = await pedirAoLoopSign(cnpj, corpo.produto);
      return fim(
        responder(200, {
          ok: true,
          codigo: 'OK',
          chave: emitida.chave,
          prefixo: emitida.prefixo,
          escopo: emitida.escopo,
          expiraEm: emitida.expira_em,
          url: `${base}/api/loopsign`,
        }),
        'OK',
      );
    } catch (e) {
      if (!(e instanceof Recusa)) console.error('loopsign-integracao', (e as Error)?.message);
      return fim(respostaDeErro(e), e instanceof Recusa ? e.codigo : 'ERRO');
    }
  };
}
