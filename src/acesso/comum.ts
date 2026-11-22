// Acesso Unificado: peças comuns das funções acesso-admin, acesso-qr e acesso-contexto.
// Docs: loop-expedicao/loop_stok/docs/acesso-unificado/ (mapa, proposta e implementação).
//
// Toda regra de banco (licença, troca de filial, exclusão protegida, token de uso único) fica nas funções SQL da
// migration V20261120_248 (loop-admin/database/migrations). Aqui só: autenticar quem chama, falar com o Auth do
// Supabase (que não roda dentro do banco) e responder.

/** Apps do Add-on que podem ter usuário (mesmo código da licença e de public.produtos). */
export const APPS_ADDON = ['LoopStok', 'LoopDelivery', 'LoopFactory', 'LoopEcommerce', 'LoopPortal', 'LoopCheck', 'LoopExpense'] as const;
export type AppAddon = (typeof APPS_ADDON)[number];

const TIMEOUT_MS = 15_000;

export class Recusa extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(mensagem);
  }
}

export interface OpcoesSupabase {
  supabaseUrl: string;
  /** Chave secreta (service_role ou sb_secret_...). Só no servidor. */
  supabaseChave: string;
  http?: typeof fetch;
}

export function responder(status: number, corpo: Record<string, unknown>, cors = false): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (cors) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, apikey, x-client-info';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  }
  return new Response(status === 204 ? null : JSON.stringify(corpo), { status, headers });
}

export function respostaDeErro(e: unknown, cors = false): Response {
  if (e instanceof Recusa) return responder(e.status, { ok: false, codigo: e.codigo, mensagem: e.message, ...e.extra }, cors);
  return responder(500, { ok: false, codigo: 'ERRO', mensagem: 'Não foi possível concluir agora. Tente novamente.' }, cors);
}

export async function lerCorpo(req: Request, max = 8192): Promise<Record<string, unknown>> {
  const texto = await req.text();
  if (texto.length > max) throw new Recusa(400, 'PEDIDO_INVALIDO', 'Pedido grande demais.');
  try {
    const o = JSON.parse(texto || '{}') as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error();
    return o as Record<string, unknown>;
  } catch {
    throw new Recusa(400, 'PEDIDO_INVALIDO', 'JSON inválido.');
  }
}

export const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** CPF (11) ou CNPJ (14) com dígitos verificadores corretos; sequência repetida é inválida. */
export function documentoValido(v: unknown): boolean {
  const d = soDigitos(v);
  if (!/^(\d{11}|\d{14})$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const n = d.split('').map(Number);
  if (d.length === 11) {
    const dv = (len: number) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += n[i] * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === n[9] && dv(10) === n[10];
  }
  const dv = (len: number) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((t, p, i) => t + n[i] * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === n[12] && dv(13) === n[13];
}
export const emailDe = (v: unknown) => String(v ?? '').trim().toLowerCase();
export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
export const appValido = (a: unknown): a is AppAddon => typeof a === 'string' && (APPS_ADDON as readonly string[]).includes(a);

export function mascararEmail(email: string): string {
  const [nome, dominio] = email.split('@');
  return `${(nome ?? '').slice(0, 2)}***@${dominio ?? ''}`;
}

export async function sha256Hex(texto: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Token aleatório (base64url, 32 bytes = 43 caracteres). */
export function tokenAleatorio(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Senha temporária legível (sem 0/O/1/l), 10 caracteres, com letra maiúscula, minúscula e número. */
export function senhaTemporaria(): string {
  const mai = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const min = 'abcdefghijkmnpqrstuvwxyz';
  const num = '23456789';
  const fontes = [mai, min, num, ...Array<string>(7).fill(mai + min + num)];
  const r = crypto.getRandomValues(new Uint32Array(fontes.length));
  const c = fontes.map((f, i) => f[r[i] % f.length]);
  for (let i = c.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c.join('');
}

/** Cliente mínimo do Supabase (PostgREST + Auth admin) com a chave secreta. */
export function clienteSupabase(op: OpcoesSupabase) {
  if (!op.supabaseUrl || !op.supabaseChave) throw new Error('Supabase do Acesso Unificado não configurado.');
  const base = op.supabaseUrl.replace(/\/+$/, '');
  const http = op.http ?? fetch;
  const headers: Record<string, string> = { apikey: op.supabaseChave, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (!op.supabaseChave.startsWith('sb_')) headers.Authorization = `Bearer ${op.supabaseChave}`;

  async function chamar(url: string, init: RequestInit): Promise<{ status: number; corpo: unknown }> {
    let r: Response;
    try {
      r = await http(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new Recusa(503, 'SUPABASE_INDISPONIVEL', 'Serviço indisponível. Tente novamente.');
    }
    const texto = await r.text();
    let corpo: unknown = null;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = texto;
    }
    return { status: r.status, corpo };
  }

  // Onde falhou vai só para o log (nunca para quem chamou: não expor a estrutura do banco).
  const falha = (onde: string, s: number) => {
    console.error('acesso', 'supabase recusou', onde, s);
    throw new Recusa(s >= 500 ? 503 : 502, 'SUPABASE_RECUSOU', 'Serviço indisponível. Tente novamente.');
  };

  return {
    async rpc<T = unknown>(nome: string, args: Record<string, unknown>): Promise<T> {
      const r = await chamar(`${base}/rest/v1/rpc/${nome}`, { method: 'POST', body: JSON.stringify(args) });
      if (r.status >= 300) falha(nome, r.status);
      return r.corpo as T;
    },
    async select<T = Record<string, unknown>>(tabela: string, qs: Record<string, string>): Promise<T[]> {
      const r = await chamar(`${base}/rest/v1/${tabela}?${new URLSearchParams(qs)}`, { method: 'GET' });
      if (r.status >= 300) falha(tabela, r.status);
      return (Array.isArray(r.corpo) ? r.corpo : []) as T[];
    },
    async insert(tabela: string, linha: Record<string, unknown>): Promise<void> {
      const r = await chamar(`${base}/rest/v1/${tabela}`, { method: 'POST', body: JSON.stringify(linha), headers: { Prefer: 'return=minimal' } });
      if (r.status >= 300) falha(tabela, r.status);
    },
    async update(tabela: string, filtro: Record<string, string>, valores: Record<string, unknown>): Promise<void> {
      const r = await chamar(`${base}/rest/v1/${tabela}?${new URLSearchParams(filtro)}`, {
        method: 'PATCH',
        body: JSON.stringify(valores),
        headers: { Prefer: 'return=minimal' },
      });
      if (r.status >= 300) falha(tabela, r.status);
    },
    /** API de Auth (admin e pública) com a chave secreta. Devolve status e corpo; quem chama decide o erro. */
    auth(caminho: string, metodo: string, corpo?: unknown) {
      return chamar(`${base}/auth/v1/${caminho.replace(/^\/+/, '')}`, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    },
  };
}

export type ClienteSupabase = ReturnType<typeof clienteSupabase>;
