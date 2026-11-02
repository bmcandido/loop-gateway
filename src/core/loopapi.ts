import { ErroGateway } from './tipos.ts';

// Intermediário da Loop API (Evolution). O token da API é único para todos os clientes e não pode
// ficar no servidor de nenhum deles: só o gateway conhece. Cada cliente tem uma chave própria, no
// formato <cnpj>.<assinatura>, gerada com o segredo do gateway (scripts/chave-loopapi.mjs), e só opera
// as instâncias do próprio CNPJ, cujo nome termina em _<cnpj> (gerarNomeInstancia no Hub).
// O Add-on continua chamando os mesmos caminhos da API: muda só a URL e a chave.

const TIMEOUT_MS = 30_000;
const CNPJ = /^\d{14}$/;
const INSTANCIA = /^[A-Za-z0-9_.@-]{1,100}$/;
const texto = new TextEncoder();

export interface ConfigLoopApi {
  url: string;
  token: string;
  /** Segredo que assina as chaves dos clientes. */
  segredo: string;
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

async function chaveHmac(segredo: string, uso: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', texto.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, [uso]);
}

function paraBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function deBase64Url(valor: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(valor)) return null;
  try {
    const binario = atob(valor.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const mensagemDaChave = (cnpj: string) => texto.encode(`loopapi\n${cnpj}`);

/** Chave de um cliente. A mesma conta está em scripts/chave-loopapi.mjs. */
export async function gerarChaveLoopApi(segredo: string, cnpj: string): Promise<string> {
  const assinatura = await crypto.subtle.sign('HMAC', await chaveHmac(segredo, 'sign'), mensagemDaChave(cnpj));
  return `${cnpj}.${paraBase64Url(assinatura)}`;
}

/** CNPJ da chave, ou null quando a assinatura não confere. A comparação é feita pelo verify. */
export async function cnpjDaChave(segredo: string, chave: string | null | undefined): Promise<string | null> {
  const partes = (chave ?? '').trim().split('.');
  if (partes.length !== 2 || !CNPJ.test(partes[0])) return null;
  const assinatura = deBase64Url(partes[1]);
  if (!assinatura) return null;
  const valida = await crypto.subtle.verify('HMAC', await chaveHmac(segredo, 'verify'), assinatura, mensagemDaChave(partes[0]));
  return valida ? partes[0] : null;
}

/** A instância é do cliente? O nome precisa terminar em _<cnpj>. */
export function instanciaDoCliente(instancia: string, cnpj: string): boolean {
  return INSTANCIA.test(instancia) && instancia.endsWith(`_${cnpj}`) && instancia.length > cnpj.length + 1;
}

function instanciaDaCriacao(corpo: string | undefined): string {
  try {
    const nome = (JSON.parse(corpo ?? '') as { instanceName?: unknown }).instanceName;
    return typeof nome === 'string' ? nome : '';
  } catch {
    return '';
  }
}

async function encaminhar(req: RequisicaoLoopApi, deps: DependenciasLoopApi, evento: { cnpj?: string }): Promise<RespostaLoopApi> {
  const { url, token, segredo } = deps.config;
  if (!url || !token || !segredo) {
    throw recusa(503, 'LOOPAPI_NAO_CONFIGURADA', 'Loop API não configurada no gateway.');
  }

  const operacao = OPERACOES.map((o) => ({ o, m: o.caminho.exec(req.caminho) })).find((x) => x.o.metodo === req.metodo && x.m);
  if (!operacao) throw recusa(403, 'OPERACAO_NAO_PERMITIDA', 'Operação não disponível na Loop API.');

  const cnpj = await cnpjDaChave(segredo, req.chave);
  if (!cnpj) throw recusa(401, 'CHAVE_INVALIDA', 'Chave da Loop API inválida. Solicite a chave à Loop.');
  evento.cnpj = cnpj;
  await deps.licenca(cnpj);

  const doCaminho = operacao.m?.[1];
  let instancia: string;
  try {
    instancia = doCaminho ? decodeURIComponent(doCaminho) : instanciaDaCriacao(req.corpo);
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
  } catch {
    throw recusa(502, 'LOOPAPI_INDISPONIVEL', 'Loop API indisponível. Tente novamente.');
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
    const resposta = await encaminhar(req, deps, evento);
    deps.registrar?.({ rota, status: resposta.status, ms: Date.now() - inicio, cnpj: evento.cnpj });
    return resposta;
  } catch (e) {
    const erro = e instanceof ErroGateway ? e : recusa(500, 'ERRO_INTERNO', 'Erro interno do gateway.');
    deps.registrar?.({ rota, status: erro.status, ms: Date.now() - inicio, cnpj: evento.cnpj, codigo: erro.codigo });
    return { status: erro.status, corpo: JSON.stringify({ message: erro.message, codigoGateway: erro.codigo }) };
  }
}
