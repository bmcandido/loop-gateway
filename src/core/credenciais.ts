import { type CredenciaisSankhya, ErroGateway, type FonteCredenciais } from './tipos.ts';

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;

/** CNPJ da Loop: dono dos apps OAuth cadastrados em `loopapp`. */
export const CNPJ_LOOP = '37647026000136';

export interface OpcoesSupabase {
  /** URL do projeto (https://<ref>.supabase.co). */
  url: string;
  /** Chave secreta (service_role ou sb_secret_...). Só no servidor. */
  chave: string;
  /** CNPJ do cliente (linha de `clientes`). */
  cnpj: string;
  cnpjLoop?: string;
  http?: typeof fetch;
}

type Linha = Record<string, unknown>;

/**
 * Credenciais do Sankhya lidas no Supabase, como no app:
 * - `clientes` (pelo CNPJ do cliente): X-Token (`token`) e `tipoIntegracao`;
 * - `loopapp` (pelo CNPJ da Loop e o mesmo `tipoIntegracao`): `clienteId`,
 *   `clienteSecret` e `urlBase` do app OAuth de produção ou de teste.
 */
export function credenciaisDoSupabase(op: OpcoesSupabase): FonteCredenciais {
  const cnpj = op.cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) throw new Error('PORTAL_CNPJ inválido.');
  if (!op.url || !op.chave) throw new Error('Supabase do gateway não configurado.');
  const base = `${op.url.replace(/\/+$/, '')}/rest/v1`;
  const http = op.http ?? fetch;
  const cnpjLoop = op.cnpjLoop ?? CNPJ_LOOP;

  // Chaves novas (sb_secret_) não são JWT e vão só no cabeçalho apikey.
  const headers: Record<string, string> = { apikey: op.chave, Accept: 'application/json' };
  if (!op.chave.startsWith('sb_')) headers.Authorization = `Bearer ${op.chave}`;

  async function primeira(tabela: string, filtros: Record<string, string>, campos: string): Promise<Linha | undefined> {
    const qs = new URLSearchParams({ select: campos, limit: '1' });
    for (const [k, v] of Object.entries(filtros)) qs.set(k, `eq.${v}`);
    let r: Response;
    try {
      r = await http(`${base}/${tabela}?${qs}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw erroConfig('SUPABASE_INDISPONIVEL');
    }
    if (!r.ok) throw erroConfig('SUPABASE_RECUSOU');
    const linhas = (await r.json()) as unknown;
    return Array.isArray(linhas) ? (linhas[0] as Linha | undefined) : undefined;
  }

  let cache: { valor: CredenciaisSankhya; ate: number } | undefined;

  return async () => {
    if (cache && Date.now() < cache.ate) return cache.valor;

    const cliente = await primeira('clientes', { cpfCnpj: cnpj }, 'token,tipoIntegracao');
    if (!cliente) throw erroConfig('CLIENTE_NAO_CADASTRADO');
    const tipo = txt(cliente.tipoIntegracao) || 'producao';

    const app = await primeira('loopapp', { cpfCnpj: cnpjLoop, tipoIntegracao: tipo }, 'clienteId,clienteSecret,urlBase');
    if (!app) throw erroConfig('LOOPAPP_NAO_CADASTRADO');

    const valor: CredenciaisSankhya = {
      baseUrl: txt(app.urlBase),
      xToken: txt(cliente.token),
      clientId: txt(app.clienteId),
      clientSecret: txt(app.clienteSecret),
    };
    if (Object.values(valor).some((v) => v === '')) throw erroConfig('CREDENCIAIS_INCOMPLETAS');

    cache = { valor, ate: Date.now() + CACHE_MS };
    return valor;
  };
}

/** O código vai para o log (diz o que falta); o cliente vê só a mensagem. */
function erroConfig(codigo: string): ErroGateway {
  return new ErroGateway(502, codigo, 'Não foi possível abrir sessão no ERP. Tente novamente mais tarde.');
}

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
