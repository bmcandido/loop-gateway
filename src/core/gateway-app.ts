import { validadorPeloAuth } from '../auth/supabase-auth.ts';
import { credenciaisDoSupabase } from './credenciais.ts';
import { desembrulhar } from './desembrulhar.ts';
import { licencaDoSupabase } from './licenca.ts';
import { porCliente } from './por-cliente.ts';
import { SankhyaCliente } from './sankhya.ts';
import {
  ErroGateway,
  type EventoGateway,
  type ModuloSankhya,
  type PortaSankhya,
  type RespostaGateway,
  type ValidadorToken,
} from './tipos.ts';

// Núcleo dos gateways de app com login do Supabase (Expense, Produção): a empresa sai da conta verificada, o
// app não recebe credencial e o Add-on confere o login pelo sessaoToken. Cada produto informa só o seu perfil.

const CACHE_USUARIO_MS = 5 * 60 * 1000;
/** Serviço público: limite por origem, por instância da função. */
const PUBLICO_LIMITE = 10;
/** Por empresa: acima do limite por origem, para vários colaboradores se cadastrarem ao mesmo tempo. */
const PUBLICO_LIMITE_EMPRESA = 40;
const PUBLICO_JANELA_MS = 60_000;
const PUBLICO_INDISPONIVEL = 'Não foi possível confirmar o cadastro nesta empresa. Tente novamente mais tarde.';

export interface PerfilApp {
  /** Nome da Edge Function, parte do caminho da URL. */
  funcao: string;
  modulo: ModuloSankhya;
  produto: string;
  servicoPermitido: (serviceName: string) => boolean;
  /** Serviços chamados antes de existir a conta. */
  publicos: ReadonlySet<string>;
  timeoutMs: number;
}

export interface DependenciasApp {
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

export interface RequisicaoApp {
  metodo: string;
  caminho: string;
  authorization?: string | null;
  /** Empresa escolhida na tela de cadastro; só vale para os serviços públicos. */
  cnpj?: string | null;
  /** IP de quem chamou, para o limite do serviço público. */
  origem?: string | null;
  corpo: unknown;
}

export async function processarApp(perfil: PerfilApp, req: RequisicaoApp, deps: DependenciasApp): Promise<RespostaGateway> {
  const inicio = Date.now();
  const evento: EventoGateway = { rota: req.caminho, status: 200, ms: 0 };
  let resposta: RespostaGateway;
  try {
    resposta = await rotear(perfil, req, deps, evento);
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

async function rotear(perfil: PerfilApp, req: RequisicaoApp, deps: DependenciasApp, evento: EventoGateway): Promise<RespostaGateway> {
  if (req.caminho === '/saude' && req.metodo === 'GET') return { status: 200, corpo: { ok: true } };
  if (req.metodo !== 'POST') throw new ErroGateway(405, 'METODO', 'Método não permitido.');
  if (req.caminho !== '/servico') throw new ErroGateway(404, 'ROTA', 'Rota não encontrada.');

  const corpo = objeto(req.corpo);
  const serviceName = typeof corpo?.serviceName === 'string' ? corpo.serviceName : '';
  evento.servico = serviceName || undefined;
  if (!perfil.servicoPermitido(serviceName)) {
    throw new ErroGateway(403, 'SERVICO_NAO_PERMITIDO', 'Serviço não disponível para o aplicativo.');
  }
  const requestBody = corpo?.requestBody === undefined ? {} : objeto(corpo.requestBody);
  if (!requestBody) throw new ErroGateway(400, 'CORPO_INVALIDO', 'Requisição inválida.');

  const body: Record<string, unknown> = { ...requestBody };
  // Sem isto, o Add-on trataria a chamada como sessão do usuário de integração.
  delete body.sessaoToken;

  if (perfil.publicos.has(serviceName)) return publico(perfil, serviceName, body, req, deps, evento);

  const token = tokenDe(req.authorization);
  const usuario = await deps.validador.validar(token);
  evento.uid = usuario.uid;
  const cnpj = ((await deps.cnpjDoUsuario(usuario.uid)) ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) throw new ErroGateway(403, 'USUARIO_SEM_EMPRESA', 'Sua conta não está ligada a uma empresa. Procure o administrador.');
  body.sessaoToken = token;
  evento.cnpj = cnpj;

  // Licença inativa: nada passa, nem o serviço público.
  await deps.licenca(cnpj);
  const envelope = await deps.sankhya(cnpj).chamar(serviceName, perfil.modulo, body);
  return { status: 200, corpo: desembrulhar(envelope) };
}

/**
 * Sem login: resposta mínima e o mesmo erro para licença ou empresa inexistente, para não servir de
 * consulta de quem é cliente. O e-mail cadastrado só é confirmado com `habilitado`.
 */
async function publico(
  perfil: PerfilApp,
  serviceName: string,
  body: Record<string, unknown>,
  req: RequisicaoApp,
  deps: DependenciasApp,
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
    const envelope = desembrulhar(await deps.sankhya(cnpj).chamar(serviceName, perfil.modulo, body)) as Record<string, any>;
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

export interface ConfigApp {
  supabaseUrl: string;
  supabaseChave: string;
  registrar?: (e: EventoGateway) => void;
  /** Só testes. */
  sobrescrever?: Partial<Pick<DependenciasApp, 'validador' | 'sankhya' | 'licenca' | 'cnpjDoUsuario'>>;
}

export function criarHandlerApp(perfil: PerfilApp, cfg: ConfigApp): (req: Request) => Promise<Response> {
  const supabase = { url: cfg.supabaseUrl, chave: cfg.supabaseChave };
  const licenca = porCliente((cnpj) => licencaDoSupabase({ ...supabase, cnpj, produto: perfil.produto }));
  const licencaPublica = porCliente((cnpj) => licencaDoSupabase({ ...supabase, cnpj, produto: perfil.produto }), 100);
  const sankhya = porCliente((cnpj) => new SankhyaCliente(credenciaisDoSupabase({ ...supabase, cnpj }), { timeoutMs: perfil.timeoutMs }));
  const deps: DependenciasApp = {
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
    const resposta = await processarApp(
      perfil,
      {
        metodo: req.method,
        caminho: rotaDaFuncao(perfil.funcao, new URL(req.url).pathname),
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
export function rotaDaFuncao(funcao: string, pathname: string): string {
  const p = pathname.replace(/\/+$/, '');
  const m = new RegExp(`/${funcao}(/.*)?$`).exec(p);
  return (m ? m[1] : p) || '/';
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
