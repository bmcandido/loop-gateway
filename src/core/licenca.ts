import { ErroGateway } from './tipos.ts';

const TIMEOUT_MS = 15_000;
/** Licença confirmada vale por 5 min antes de nova consulta. */
const CACHE_OK_MS = 5 * 60 * 1000;
/** Recusa fica 1 min em cache: reativar no LoopMais vale logo, sem martelar o Supabase. */
const CACHE_RECUSA_MS = 60 * 1000;
/** Mesma política do app e da central: sem Supabase, vale o último OK por 10 dias. */
export const TOLERANCIA_SEM_SUPABASE_MS = 10 * 24 * 60 * 60 * 1000;

/** Lança ErroGateway quando a licença do cliente não permite usar o portal. */
export type VerificadorLicenca = () => Promise<void>;

export interface OpcoesLicenca {
  /** URL do projeto (https://<ref>.supabase.co). */
  url: string;
  /** Chave secreta (service_role ou sb_secret_...). Só no servidor. */
  chave: string;
  /** CNPJ do cliente (linha de `clientes`). */
  cnpj: string;
  /** codigoProduto em `clientesProdutos`. O portal é LoopPortal. */
  produto?: string;
  http?: typeof fetch;
  agoraMs?: () => number;
}

type Linha = Record<string, unknown>;

/**
 * Mesma regra do app (licenca_verificacao.dart), agora no servidor, onde o
 * cliente não mexe: `clientes.dataExpiracao` não vencida e o produto em
 * `clientesProdutos`. O app confere o licenca.json; aqui vale o Supabase.
 */
export function licencaDoSupabase(op: OpcoesLicenca): VerificadorLicenca {
  const cnpj = op.cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) throw new Error('PORTAL_CNPJ inválido.');
  if (!op.url || !op.chave) throw new Error('Supabase do gateway não configurado.');
  const produto = op.produto || 'LoopPortal';
  const base = `${op.url.replace(/\/+$/, '')}/rest/v1`;
  const http = op.http ?? fetch;
  const agora = op.agoraMs ?? Date.now;

  const headers: Record<string, string> = { apikey: op.chave, Accept: 'application/json' };
  if (!op.chave.startsWith('sb_')) headers.Authorization = `Bearer ${op.chave}`;

  async function primeira(tabela: string, filtros: Record<string, string>, campos: string): Promise<Linha | undefined> {
    const qs = new URLSearchParams({ select: campos, limit: '1' });
    for (const [k, v] of Object.entries(filtros)) qs.set(k, `eq.${v}`);
    const r = await http(`${base}/${tabela}?${qs}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const linhas = (await r.json()) as unknown;
    return Array.isArray(linhas) ? (linhas[0] as Linha | undefined) : undefined;
  }

  /** false depois que o Supabase disse que a RPC não existe (migration V20261031_171 não aplicada). */
  let rpcDisponivel = true;

  /**
   * public.licenca_status: uma chamada, só {contratado, dataExpiracao}. Devolve undefined quando
   * a função ainda não existe no banco; aí vale a leitura das tabelas, como antes.
   */
  async function viaRpc(): Promise<{ cliente?: Linha; contratado?: Linha } | undefined> {
    if (!rpcDisponivel) return undefined;
    const r = await http(`${base}/rpc/licenca_status`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_cnpj: cnpj, p_produto: produto }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status === 404) {
      rpcDisponivel = false;
      return undefined;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const linhas = (await r.json()) as unknown;
    const linha = Array.isArray(linhas) ? (linhas[0] as Linha | undefined) : undefined;
    if (!linha) return {};
    return { cliente: { dataExpiracao: linha.dataExpiracao }, contratado: linha.contratado === true ? linha : undefined };
  }

  let decisao: { erro?: ErroGateway; ate: number } | undefined;
  let ultimoOk: { em: number; expira: number } | undefined;

  return async () => {
    const t = agora();
    if (decisao && t < decisao.ate) {
      if (decisao.erro) throw decisao.erro;
      return;
    }

    let cliente: Linha | undefined;
    let contratado: Linha | undefined;
    try {
      const rpc = await viaRpc();
      if (rpc) {
        ({ cliente, contratado } = rpc);
      } else {
        cliente = await primeira('clientes', { cpfCnpj: cnpj }, 'dataExpiracao');
        contratado = cliente && (await primeira('clientesProdutos', { cpfCnpj: cnpj, codigoProduto: produto }, 'codigoProduto'));
      }
    } catch {
      // Supabase fora: só o último OK, dentro dos 10 dias e da expiração. A
      // decisão fica 1 min em cache para não esperar o timeout a cada chamada.
      if (ultimoOk && t < ultimoOk.em + TOLERANCIA_SEM_SUPABASE_MS && t < ultimoOk.expira) {
        decisao = { ate: Math.min(t + CACHE_RECUSA_MS, ultimoOk.em + TOLERANCIA_SEM_SUPABASE_MS, ultimoOk.expira) };
        return;
      }
      const erro = new ErroGateway(503, 'LICENCA_INDISPONIVEL', 'Não foi possível confirmar a licença do portal. Tente novamente mais tarde.');
      decisao = { erro, ate: t + CACHE_RECUSA_MS };
      throw erro;
    }

    const expira = dataExpiracao(cliente?.dataExpiracao);
    let erro: ErroGateway | undefined;
    if (!cliente || !contratado) {
      erro = new ErroGateway(403, 'LICENCA_INATIVA', 'Portal sem licença ativa. Entre em contato com a administradora.');
    } else if (expira === undefined || expira <= t) {
      erro = new ErroGateway(403, 'LICENCA_EXPIRADA', 'A licença do portal expirou. Entre em contato com a administradora.');
    }

    if (erro) {
      ultimoOk = undefined;
      decisao = { erro, ate: t + CACHE_RECUSA_MS };
      throw erro;
    }
    ultimoOk = { em: t, expira: expira! };
    decisao = { ate: Math.min(t + CACHE_OK_MS, expira!) };
  };
}

/**
 * `dataExpiracao` é data (AAAA-MM-DD). Como no app, vence no início do dia,
 * no horário de Brasília.
 */
export function dataExpiracao(v: unknown): number | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const s = v.trim();
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00-03:00` : s);
  return Number.isNaN(ms) ? undefined : ms;
}
