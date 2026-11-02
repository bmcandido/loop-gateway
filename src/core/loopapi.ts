import { base64Url } from './assinatura.ts';
import { ErroGateway } from './tipos.ts';

// Intermediário da Loop API (Evolution). O token da API é único para todos os clientes e não pode
// ficar no servidor de nenhum deles: só o gateway conhece. Cada cliente tem uma chave própria, gerada
// no Loop Mais (public.clientes_chaves_loopapi), e só opera as instâncias do próprio CNPJ, cujo nome
// termina em _<cnpj> (gerarNomeInstancia no Hub). O Add-on chama os mesmos caminhos da API: muda só a
// URL e a chave.
//
// A chave chega ao Add-on por POST /entregar: qualquer um pode pedir, mas o gateway a grava, assinada,
// no Sankhya daquele CNPJ (credenciais do próprio cliente) e a resposta não a contém.

const TIMEOUT_MS = 30_000;
const CACHE_CHAVE_MS = 60_000;
const INTERVALO_ENTREGA_MS = 30_000;
const CNPJ = /^\d{14}$/;
const INSTANCIA = /^[A-Za-z0-9_.@-]{1,100}$/;
const texto = new TextEncoder();

export interface ConfigLoopApi {
  url: string;
  token: string;
}

export interface RequisicaoLoopApi {
  metodo: string;
  /** Caminho depois de /loopapi: /instance/connect/nome. */
  caminho: string;
  /** Cabeçalho apikey: a chave do cliente. */
  chave?: string | null;
  corpo?: string;
}

export interface DependenciasLoopApi {
  config: ConfigLoopApi;
  /** Lança ErroGateway quando o cliente não tem licença do produto. */
  licenca: (cnpj: string) => Promise<void>;
  /** Chave cadastrada para o CNPJ; null quando não há. */
  chaveDoCliente: (cnpj: string) => Promise<string | null>;
  /** Grava a chave no Sankhya do CNPJ. Lança ErroGateway quando não consegue. */
  entregar: (cnpj: string, chave: string) => Promise<void>;
  /** Limita os pedidos de entrega por CNPJ. Devolve false quando é cedo para outro. */
  podeEntregar: (cnpj: string) => boolean;
  http?: typeof fetch;
  /** Só metadados: nunca corpo, chave ou número de telefone. */
  registrar?: (e: { rota: string; status: number; ms: number; cnpj?: string; codigo?: string }) => void;
}

export interface RespostaLoopApi {
  status: number;
  corpo: string;
}

/** Operações que o Add-on usa. O resto da API (como listar todas as instâncias) fica de fora. */
const OPERACOES: ReadonlyArray<{ metodo: string; caminho: RegExp }> = [
  { metodo: 'POST', caminho: /^\/instance\/create$/ },
  { metodo: 'GET', caminho: /^\/instance\/connect\/([^/]+)$/ },
  { metodo: 'GET', caminho: /^\/instance\/connectionState\/([^/]+)$/ },
  { metodo: 'PUT', caminho: /^\/instance\/restart\/([^/]+)$/ },
  { metodo: 'DELETE', caminho: /^\/instance\/logout\/([^/]+)$/ },
  { metodo: 'DELETE', caminho: /^\/instance\/delete\/([^/]+)$/ },
  { metodo: 'POST', caminho: /^\/message\/sendText\/([^/]+)$/ },
  { metodo: 'POST', caminho: /^\/message\/sendMedia\/([^/]+)$/ },
  { metodo: 'POST', caminho: /^\/message\/sendLocation\/([^/]+)$/ },
];

const recusa = (status: number, codigo: string, mensagem: string) => new ErroGateway(status, codigo, mensagem);

/** Comparação sem atalho: o tempo não revela até onde a chave estava certa. */
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

/** CNPJ da chave, ou null quando ela não é a cadastrada para esse CNPJ. */
export async function cnpjDaChave(
  chave: string | null | undefined,
  chaveDoCliente: (cnpj: string) => Promise<string | null>,
): Promise<string | null> {
  const limpa = (chave ?? '').trim();
  const cnpj = limpa.split('.')[0];
  if (!CNPJ.test(cnpj)) return null;
  const cadastrada = await chaveDoCliente(cnpj);
  return cadastrada && iguais(cadastrada, limpa) ? cnpj : null;
}

/** A instância é do cliente? O nome precisa terminar em _<cnpj>. */
export function instanciaDoCliente(instancia: string, cnpj: string): boolean {
  return INSTANCIA.test(instancia) && instancia.endsWith(`_${cnpj}`) && instancia.length > cnpj.length + 1;
}

/** O que o gateway assina na entrega. O Add-on confere igual (EntregaChaveLoopApi). */
export function mensagemEntrega(cnpj: string, chave: string, ts: number): string {
  return `loopapi-chave\n${cnpj}\n${chave}\n${ts}`;
}

export interface EntregaAssinada {
  cnpj: string;
  chave: string;
  ts: number;
  kid: string;
  sig: string;
}

export async function assinarEntrega(
  chavePrivada: CryptoKey,
  kid: string,
  cnpj: string,
  chave: string,
  agoraSeg: number,
): Promise<EntregaAssinada> {
  const ts = Math.floor(agoraSeg);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chavePrivada, texto.encode(mensagemEntrega(cnpj, chave, ts))),
  );
  return { cnpj, chave, ts, kid, sig: base64Url(sig) };
}

/** Lê a chave com a service_role, com cache curto: troca de chave vale em até 1 min. */
export function chaveDoSupabase(op: { url: string; chave: string; http?: typeof fetch; agora?: () => number }) {
  const cache = new Map<string, { ate: number; valor: string | null }>();
  const http = op.http ?? fetch;
  const agora = op.agora ?? Date.now;
  const headers: Record<string, string> = { apikey: op.chave, Accept: 'application/json' };
  if (!op.chave.startsWith('sb_')) headers.Authorization = `Bearer ${op.chave}`;

  return async (cnpj: string): Promise<string | null> => {
    const c = cache.get(cnpj);
    if (c && agora() < c.ate) return c.valor;
    const qs = new URLSearchParams({ select: 'chave', cpfCnpj: `eq.${cnpj}`, limit: '1' });
    let r: Response;
    try {
      r = await http(`${op.url.replace(/\/+$/, '')}/rest/v1/clientes_chaves_loopapi?${qs}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw recusa(503, 'SUPABASE_INDISPONIVEL', 'Não foi possível conferir a chave. Tente novamente.');
    }
    if (!r.ok) throw recusa(503, 'SUPABASE_RECUSOU', 'Não foi possível conferir a chave. Tente novamente.');
    const linhas = (await r.json()) as { chave?: unknown }[];
    const valor = typeof linhas?.[0]?.chave === 'string' ? linhas[0].chave : null;
    if (cache.size >= 2000) cache.delete(cache.keys().next().value as string);
    cache.set(cnpj, { ate: agora() + CACHE_CHAVE_MS, valor });
    return valor;
  };
}

/** Um pedido de entrega por CNPJ a cada 30 s: o pedido é aberto e aciona o Sankhya do cliente. */
export function limiteDeEntrega(agora: () => number = Date.now) {
  const ultimos = new Map<string, number>();
  return (cnpj: string): boolean => {
    const ultimo = ultimos.get(cnpj);
    if (ultimo !== undefined && agora() - ultimo < INTERVALO_ENTREGA_MS) return false;
    if (ultimos.size >= 5000) ultimos.clear();
    ultimos.set(cnpj, agora());
    return true;
  };
}

function campoDoCorpo(corpo: string | undefined, campo: string): string {
  try {
    const valor = (JSON.parse(corpo ?? '') as Record<string, unknown>)[campo];
    return typeof valor === 'string' ? valor : '';
  } catch {
    return '';
  }
}

/** Causa da falha de rede para o diagnóstico, nunca com o token. Só chega a quem tem chave válida. */
export function motivoDaFalha(e: unknown, token: string): string {
  const erro = e as { message?: unknown; cause?: { message?: unknown } } | null;
  const texto = String(erro?.cause?.message ?? erro?.message ?? 'falha de conexão');
  return (token ? texto.split(token).join('[oculto]') : texto).slice(0, 200);
}

async function entregarChave(req: RequisicaoLoopApi, deps: DependenciasLoopApi, evento: { cnpj?: string }): Promise<RespostaLoopApi> {
  if (req.metodo !== 'POST') throw recusa(403, 'OPERACAO_NAO_PERMITIDA', 'Operação não disponível na Loop API.');
  const cnpj = campoDoCorpo(req.corpo, 'cnpj');
  if (!CNPJ.test(cnpj)) throw recusa(400, 'CNPJ_INVALIDO', 'CNPJ inválido.');
  evento.cnpj = cnpj;
  if (!deps.podeEntregar(cnpj)) {
    throw recusa(429, 'ENTREGA_RECENTE', 'A chave acabou de ser solicitada. Aguarde 30 segundos e tente novamente.');
  }
  await deps.licenca(cnpj);
  const chave = await deps.chaveDoCliente(cnpj);
  if (!chave) throw recusa(404, 'CLIENTE_SEM_CHAVE', 'Este CNPJ não tem chave da Loop API no Loop Mais.');
  await deps.entregar(cnpj, chave);
  return { status: 200, corpo: JSON.stringify({ entregue: true }) };
}

async function encaminhar(req: RequisicaoLoopApi, deps: DependenciasLoopApi, evento: { cnpj?: string }): Promise<RespostaLoopApi> {
  const { url, token } = deps.config;
  if (!url || !token) throw recusa(503, 'LOOPAPI_NAO_CONFIGURADA', 'Loop API não configurada no gateway.');

  const operacao = OPERACOES.map((o) => ({ o, m: o.caminho.exec(req.caminho) })).find((x) => x.o.metodo === req.metodo && x.m);
  if (!operacao) throw recusa(403, 'OPERACAO_NAO_PERMITIDA', 'Operação não disponível na Loop API.');

  const cnpj = await cnpjDaChave(req.chave, deps.chaveDoCliente);
  if (!cnpj) throw recusa(401, 'CHAVE_INVALIDA', 'Chave da Loop API inválida.');
  evento.cnpj = cnpj;
  await deps.licenca(cnpj);

  const doCaminho = operacao.m?.[1];
  let instancia: string;
  try {
    instancia = doCaminho ? decodeURIComponent(doCaminho) : campoDoCorpo(req.corpo, 'instanceName');
  } catch {
    instancia = '';
  }
  if (!instanciaDoCliente(instancia, cnpj)) {
    throw recusa(403, 'INSTANCIA_DE_OUTRO_CLIENTE', 'Esta instância não pertence à empresa da chave.');
  }

  const http = deps.http ?? fetch;
  let r: Response;
  try {
    r = await http(`${url.replace(/\/+$/, '')}${req.caminho}`, {
      method: req.metodo,
      headers: { apikey: token, 'Content-Type': 'application/json' },
      body: req.metodo === 'POST' ? req.corpo ?? '' : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw recusa(502, 'LOOPAPI_INDISPONIVEL', `Loop API indisponível (${motivoDaFalha(e, token)}). Tente novamente.`);
  }
  // A resposta vai como veio: o Add-on já trata os erros da API (instância inexistente ou em uso).
  return { status: r.status, corpo: await r.text() };
}

export async function processarLoopApi(req: RequisicaoLoopApi, deps: DependenciasLoopApi): Promise<RespostaLoopApi> {
  const inicio = Date.now();
  const evento: { cnpj?: string } = {};
  // O nome da instância tem o CNPJ, que já vai no campo próprio.
  const rota = `/loopapi${req.caminho.split('/').slice(0, 3).join('/')}`;
  try {
    const resposta = req.caminho === '/entregar' ? await entregarChave(req, deps, evento) : await encaminhar(req, deps, evento);
    deps.registrar?.({ rota, status: resposta.status, ms: Date.now() - inicio, cnpj: evento.cnpj });
    return resposta;
  } catch (e) {
    const erro = e instanceof ErroGateway ? e : recusa(500, 'ERRO_INTERNO', 'Erro interno do gateway.');
    deps.registrar?.({ rota, status: erro.status, ms: Date.now() - inicio, cnpj: evento.cnpj, codigo: erro.codigo });
    return { status: erro.status, corpo: JSON.stringify({ message: erro.message, codigoGateway: erro.codigo }) };
  }
}
