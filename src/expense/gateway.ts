import { desembrulhar } from '../core/desembrulhar.ts';
import { credenciaisDoSupabase } from '../core/credenciais.ts';
import { licencaDoSupabase } from '../core/licenca.ts';
import { porCliente } from '../core/por-cliente.ts';
import { SankhyaCliente } from '../core/sankhya.ts';
import {
  ErroGateway,
  type EventoGateway,
  type ModuloSankhya,
  type PortaSankhya,
  type RespostaGateway,
  type UsuarioAutenticado,
  type ValidadorToken,
} from '../core/tipos.ts';

// Gateway do Loop Expense: o app deixa de ler credenciais e de falar direto com o Sankhya. O Add-on
// continua conferindo o login pelo sessaoToken (JWT do Supabase) e decide o que cada um pode fazer.
// Docs: loop-expense/docs/07_API_E_CONTRATOS.md e loop-admin/docs/licenciamento/06-MODELO-PARA-OUTROS-APPS.md.

export const MODULO_EXPENSE: ModuloSankhya = 'loop-expense';
export const PRODUTO_EXPENSE = 'LoopExpense';
/** Aprovar com nota espera o Sankhya gravar e confirmar: o prazo padrão não basta. */
const TIMEOUT_SANKHYA_MS = 90_000;
const CACHE_USUARIO_MS = 5 * 60 * 1000;
const CACHE_TOKEN_MS = 60 * 1000;
/** Serviço público: limite por origem, por instância da função. */
const PUBLICO_LIMITE = 10;
/** Por empresa: acima do limite por origem, para vários colaboradores se cadastrarem ao mesmo tempo. */
const PUBLICO_LIMITE_EMPRESA = 40;
const PUBLICO_JANELA_MS = 60_000;
const PUBLICO_INDISPONIVEL = 'Não foi possível confirmar o cadastro nesta empresa. Tente novamente mais tarde.';

/** Só os serviços do Add-on do Expense. Nada de SQL livre, CRUD genérico ou serviço nativo do Sankhya. */
const SERVICO_EXPENSE = /^LoopExpense[A-Za-z]+SP\.do[A-Za-z]+$/;
/** Antes de existir a conta: confere se o e-mail está cadastrado na empresa escolhida. */
const PUBLICOS = new Set(['LoopExpenseSessaoSP.doVerificarCadastro']);

export interface DependenciasExpense {
  validador: ValidadorToken;
  /** CNPJ da empresa da conta, lido no servidor (`usuarios`). */
  cnpjDoUsuario: (uid: string) => Promise<string | undefined>;
  licenca: (cnpj: string) => Promise<void>;
  /** Licença no caminho sem login: cache separado, para CNPJ de quem não entrou não tirar os clientes da memória. */
  licencaPublica?: (cnpj: string) => Promise<void>;
  /** Devolve false quando a origem passou do limite do serviço público. */
  permitirPublico?: (origem: string) => boolean;
  /** O mesmo, por empresa: trocar de IP não libera a consulta de e-mails de um cliente. */
  permitirEmpresa?: (cnpj: string) => boolean;
  sankhya: (cnpj: string) => PortaSankhya;
  registrar?: (e: EventoGateway) => void;
}

export interface RequisicaoExpense {
  metodo: string;
  caminho: string;
  authorization?: string | null;
  /** Empresa escolhida na tela de cadastro; só vale para os serviços públicos. */
  cnpj?: string | null;
  /** IP de quem chamou, para o limite do serviço público. */
  origem?: string | null;
  corpo: unknown;
}

export async function processarExpense(req: RequisicaoExpense, deps: DependenciasExpense): Promise<RespostaGateway> {
  const inicio = Date.now();
  const evento: EventoGateway = { rota: req.caminho, status: 200, ms: 0 };
  let resposta: RespostaGateway;
  try {
    resposta = await rotear(req, deps, evento);
  } catch (e) {
    const erro = e instanceof ErroGateway ? e : new ErroGateway(500, 'ERRO_INTERNO', 'Não foi possível concluir a operação. Tente novamente.');
    evento.codigo = erro.codigo;
    resposta = { status: erro.status, corpo: { status: '0', statusMessage: erro.message, codigoGateway: erro.codigo } };
  }
  evento.status = resposta.status;
  evento.ms = Date.now() - inicio;
  deps.registrar?.(evento);
  return resposta;
}

async function rotear(req: RequisicaoExpense, deps: DependenciasExpense, evento: EventoGateway): Promise<RespostaGateway> {
  if (req.caminho === '/saude' && req.metodo === 'GET') return { status: 200, corpo: { ok: true } };
  if (req.metodo !== 'POST') throw new ErroGateway(405, 'METODO', 'Método não permitido.');
  if (req.caminho !== '/servico') throw new ErroGateway(404, 'ROTA', 'Rota não encontrada.');

  const corpo = objeto(req.corpo);
  const serviceName = typeof corpo?.serviceName === 'string' ? corpo.serviceName : '';
  evento.servico = serviceName || undefined;
  if (!SERVICO_EXPENSE.test(serviceName)) {
    throw new ErroGateway(403, 'SERVICO_NAO_PERMITIDO', 'Serviço não disponível para o aplicativo.');
  }
  const requestBody = corpo?.requestBody === undefined ? {} : objeto(corpo.requestBody);
  if (!requestBody) throw new ErroGateway(400, 'CORPO_INVALIDO', 'Requisição inválida.');

  const body: Record<string, unknown> = { ...requestBody };
  // Sem isto, o Add-on trataria a chamada como sessão do usuário de integração.
  delete body.sessaoToken;

  if (PUBLICOS.has(serviceName)) return publico(serviceName, body, req, deps, evento);

  const token = tokenDe(req.authorization);
  const usuario = await deps.validador.validar(token);
  evento.uid = usuario.uid;
  const cnpj = ((await deps.cnpjDoUsuario(usuario.uid)) ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) throw new ErroGateway(403, 'USUARIO_SEM_EMPRESA', 'Sua conta não está ligada a uma empresa. Procure o administrador.');
  body.sessaoToken = token;
  evento.cnpj = cnpj;

  // Licença inativa: nada passa, nem o serviço público.
  await deps.licenca(cnpj);
  const envelope = await deps.sankhya(cnpj).chamar(serviceName, MODULO_EXPENSE, body);
  return { status: 200, corpo: desembrulhar(envelope) };
}

/**
 * Sem login: resposta mínima e o mesmo erro para licença ou empresa inexistente, para não servir de
 * consulta de quem é cliente. O e-mail cadastrado só é confirmado com `habilitado`.
 */
async function publico(
  serviceName: string,
  body: Record<string, unknown>,
  req: RequisicaoExpense,
  deps: DependenciasExpense,
  evento: EventoGateway,
): Promise<RespostaGateway> {
  if (deps.permitirPublico && !deps.permitirPublico(req.origem || 'sem-origem')) {
    throw new ErroGateway(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um minuto e tente de novo.');
  }
  const cnpj = (req.cnpj ?? '').replace(/\D/g, '');
  if (!cnpjValido(cnpj)) throw new ErroGateway(400, 'EMPRESA_INVALIDA', 'Selecione a empresa.');
  evento.cnpj = cnpj;
  let habilitado = false;
  try {
    await (deps.licencaPublica ?? deps.licenca)(cnpj);
    // Depois da licença: CNPJ inventado não ocupa o limitador. O erro é o mesmo de sem licença, para não revelar quem é cliente.
    if (deps.permitirEmpresa && !deps.permitirEmpresa(cnpj)) {
      throw new ErroGateway(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um minuto e tente de novo.');
    }
    const envelope = desembrulhar(await deps.sankhya(cnpj).chamar(serviceName, MODULO_EXPENSE, body)) as Record<string, any>;
    const resposta = envelope?.responseBody;
    if (envelope?.status?.toString() !== '1' || resposta?.success !== true) {
      throw new ErroGateway(502, 'CADASTRO_INDISPONIVEL', PUBLICO_INDISPONIVEL);
    }
    habilitado = resposta.data?.habilitado === true;
  } catch (e) {
    evento.codigo = e instanceof ErroGateway ? e.codigo : 'ERRO_INTERNO';
    throw new ErroGateway(502, 'CADASTRO_INDISPONIVEL', PUBLICO_INDISPONIVEL);
  }
  return { status: 200, corpo: { status: '1', responseBody: { success: true, data: { habilitado } } } };
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (n: number) => {
    let soma = 0;
    let peso = n - 7;
    for (let i = 0; i < n; i++) {
      soma += Number(cnpj[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(cnpj[12]) && dv(13) === Number(cnpj[13]);
}

/** Janela fixa em memória. Não substitui um limite na borda, mas barra a varredura de uma origem. */
export function limitadorPublico(limite = PUBLICO_LIMITE, janelaMs = PUBLICO_JANELA_MS, agora: () => number = Date.now): (origem: string) => boolean {
  const mapa = new Map<string, { ate: number; n: number }>();
  return (origem) => {
    const t = agora();
    const e = mapa.get(origem);
    if (!e || t >= e.ate) {
      if (mapa.size >= 5000) {
        // Encher o mapa não pode zerar todos nem recusar todos: saem as vencidas e, se faltar, a mais antiga.
        for (const [k, v] of mapa) if (t >= v.ate) mapa.delete(k);
        if (mapa.size >= 5000) mapa.delete(mapa.keys().next().value as string);
      }
      mapa.set(origem, { ate: t + janelaMs, n: 1 });
      return true;
    }
    e.n++;
    return e.n <= limite;
  };
}

function tokenDe(authorization: string | null | undefined): string {
  if (!authorization) throw new ErroGateway(401, 'LOGIN_NECESSARIO', 'Sessão expirada. Entre novamente.');
  const m = /^Bearer\s+(\S{20,4096})$/.exec(authorization.trim());
  if (!m) throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão inválida. Entre novamente.');
  return m[1];
}

function objeto(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

// ---------------------------------------------------------------- HTTP

export interface ConfigExpense {
  supabaseUrl: string;
  supabaseChave: string;
  registrar?: (e: EventoGateway) => void;
  /** Só testes. */
  sobrescrever?: Partial<Pick<DependenciasExpense, 'validador' | 'sankhya' | 'licenca' | 'cnpjDoUsuario'>>;
}

export function criarHandlerExpense(cfg: ConfigExpense): (req: Request) => Promise<Response> {
  const supabase = { url: cfg.supabaseUrl, chave: cfg.supabaseChave };
  const licenca = porCliente((cnpj) => licencaDoSupabase({ ...supabase, cnpj, produto: PRODUTO_EXPENSE }));
  const licencaPublica = porCliente((cnpj) => licencaDoSupabase({ ...supabase, cnpj, produto: PRODUTO_EXPENSE }), 100);
  const sankhya = porCliente((cnpj) => new SankhyaCliente(credenciaisDoSupabase({ ...supabase, cnpj }), { timeoutMs: TIMEOUT_SANKHYA_MS }));
  const deps: DependenciasExpense = {
    validador: cfg.sobrescrever?.validador ?? validadorPeloAuth(supabase),
    cnpjDoUsuario: cfg.sobrescrever?.cnpjDoUsuario ?? cnpjDoUsuarioNoSupabase(supabase),
    licenca: cfg.sobrescrever?.licenca ?? ((cnpj) => licenca(cnpj)()),
    licencaPublica: cfg.sobrescrever?.licenca ?? ((cnpj) => licencaPublica(cnpj)()),
    permitirPublico: limitadorPublico(),
    permitirEmpresa: limitadorPublico(PUBLICO_LIMITE_EMPRESA),
    sankhya: cfg.sobrescrever?.sankhya ?? sankhya,
    registrar: cfg.registrar,
  };

  return async (req) => {
    const origem = req.headers.get('origin');
    const cors: Record<string, string> = origem ? { 'Access-Control-Allow-Origin': origem, Vary: 'Origin' } : {};
    if (origem && req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Loop-Cnpj, apikey, x-client-info',
          'Access-Control-Max-Age': '3600',
        },
      });
    }
    let corpo: unknown = null;
    if (req.method === 'POST') {
      try {
        corpo = await req.json();
      } catch {
        corpo = null;
      }
    }
    const resposta = await processarExpense(
      {
        metodo: req.method,
        caminho: rotaExpense(new URL(req.url).pathname),
        authorization: req.headers.get('authorization'),
        cnpj: req.headers.get('x-loop-cnpj'),
        origem: origemDe(req.headers),
        corpo,
      },
      deps,
    );
    return new Response(JSON.stringify(resposta.corpo), {
      status: resposta.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
    });
  };
}

/** IP informado pela plataforma. O começo do x-forwarded-for vem de quem chama e não serve para limitar. */
export function origemDe(headers: Headers): string {
  const plataforma = (headers.get('cf-connecting-ip') ?? '').trim();
  if (plataforma) return plataforma;
  const encaminhados = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return encaminhados[encaminhados.length - 1] ?? '';
}

/** /functions/v1/expense-gateway/servico → /servico. */
export function rotaExpense(pathname: string): string {
  const p = pathname.replace(/\/+$/, '');
  const m = /\/expense-gateway(\/.*)?$/.exec(p);
  return (m ? m[1] : p) || '/';
}

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

/** A empresa sai da conta verificada, nunca do que o app informa. O Add-on ainda exige o e-mail cadastrado nela. */
export function cnpjDoUsuarioNoSupabase(op: { url: string; chave: string; http?: typeof fetch }): (uid: string) => Promise<string | undefined> {
  const base = `${op.url.replace(/\/+$/, '')}/rest/v1`;
  const http = op.http ?? fetch;
  const headers: Record<string, string> = { apikey: op.chave, Accept: 'application/json' };
  if (!op.chave.startsWith('sb_')) headers.Authorization = `Bearer ${op.chave}`;
  const cache = new Map<string, { cnpj: string; ate: number }>();

  return async (uid) => {
    const c = cache.get(uid);
    if (c && Date.now() < c.ate) return c.cnpj;
    const qs = new URLSearchParams({ select: 'cpfCnpj', idUsuario: `eq.${uid}`, limit: '1' });
    let r: Response;
    try {
      r = await http(`${base}/usuarios?${qs}`, { headers, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ErroGateway(503, 'SUPABASE_INDISPONIVEL', 'Serviço indisponível. Tente novamente.');
    }
    if (!r.ok) throw new ErroGateway(502, 'SUPABASE_RECUSOU', 'Serviço indisponível. Tente novamente.');
    const linhas = (await r.json()) as unknown;
    const cnpj = Array.isArray(linhas) ? String((linhas[0] as Record<string, unknown> | undefined)?.cpfCnpj ?? '') : '';
    if (!cnpj) return undefined;
    if (cache.size >= 2000) cache.delete(cache.keys().next().value as string);
    cache.set(uid, { cnpj, ate: Date.now() + CACHE_USUARIO_MS });
    return cnpj;
  };
}
