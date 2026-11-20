import { base64Url } from '../core/assinatura.ts';
import { limitadorPublico } from '../core/gateway-app.ts';
import { dataExpiracao } from '../core/licenca.ts';

// Consulta de licença do ADD-ON (LicencaLoop v2), com resposta ASSINADA.
// Docs: loop-admin/docs/licenciamento/13-PADRAO-UNICO-E-GESTAO.md, seções 5.2, 5.3 e 6.
//
// POST { cnpjs: string[], produto: string, nonce: string, versao?: string, diagnostico?: boolean }
//   diagnostico = true: usado pelo "Verificar agora" do Loop Mais; responde igual, mas não conta como uso do add-on.
//   200 → JWS compacto (ES256, kid do gateway, typ "loop-licenca-status+jwt")
//   400 entrada inválida · 405 método · 429 muitas tentativas · 503 Supabase indisponível
//
// A assinatura usa a chave privada do gateway (a mesma da identidade v2). O add-on confere com a chave
// pública que já vai embarcada para a GatewayAssinatura; o `typ` próprio impede trocar uma resposta de
// licença por uma identidade de usuário, ou o contrário. O `nonce` amarra a resposta à pergunta e o
// `valeAte` (5 min) impede reaproveitar uma resposta antiga.
//
// `loop`: dados da Loop para a tela de licença do add-on (razão social, CNPJ, e-mail de suporte, endereço),
// lidos de public.loopapp (linha tipoIntegracao = 'producao'). Só colunas públicas, escolhidas uma a uma: a
// tabela também guarda senhas e tokens, que nunca saem daqui. Guardado 10 min por instância; se a leitura
// falhar, a resposta sai sem `loop` e a licença segue normal (o add-on mantém o último que recebeu).

export const TYP_LICENCA_STATUS = 'loop-licenca-status+jwt';
/** Por quanto tempo a resposta assinada pode ser apresentada (o add-on guarda o OK por 5 min). */
export const VALIDADE_RESPOSTA_SEG = 5 * 60;
const TIMEOUT_MS = 15_000;
/** Servidor Sankhya com muitas empresas (TSIEMP) manda todos os CNPJs: 20 barrava grupos grandes (20/11/2026). */
const MAX_CNPJS = 200;
/** Consultas ao Supabase em paralelo por pedido (um RPC por CNPJ). */
const CONSULTAS_EM_PARALELO = 10;
/** Um servidor consulta no máximo a cada 5 min por produto; 30/min por IP sobra para vários add-ons. */
const LIMITE_POR_MINUTO = 30;
/** Dados da Loop mudam raramente: uma leitura de public.loopapp a cada 10 min por instância basta. */
export const CACHE_DADOS_LOOP_MS = 10 * 60_000;
const TIMEOUT_DADOS_LOOP_MS = 5_000;
/** Colunas públicas de public.loopapp. NUNCA incluir password, appKey, clienteSecret, tokens ou WhatsApp. */
const COLUNAS_DADOS_LOOP = 'razaoSocial,fantasia,cpfCnpj,emailSuporte,cep,logradouro,numero,bairro,cidade,uf';

/** Dados da Loop mostrados na tela de licença do add-on. Campo vazio no cadastro não vem. */
export interface DadosLoop {
  razaoSocial?: string;
  fantasia?: string;
  cnpj?: string;
  email?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

/** Converte a linha de public.loopapp nos dados da tela: só texto, aparado e com tamanho limitado. */
export function dadosLoopDaLinha(linha: unknown): DadosLoop | undefined {
  if (!linha || typeof linha !== 'object') return undefined;
  const l = linha as Record<string, unknown>;
  const t = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const d: DadosLoop = {
    razaoSocial: t(l.razaoSocial),
    fantasia: t(l.fantasia),
    cnpj: t(l.cpfCnpj)?.replace(/\D/g, '') || undefined,
    email: t(l.emailSuporte),
    cep: t(l.cep)?.replace(/\D/g, '') || undefined,
    logradouro: t(l.logradouro),
    numero: t(l.numero, 20),
    bairro: t(l.bairro),
    cidade: t(l.cidade),
    uf: t(l.uf, 2),
  };
  for (const k of Object.keys(d) as (keyof DadosLoop)[]) if (d[k] === undefined) delete d[k];
  return Object.keys(d).length ? d : undefined;
}

export interface OpcoesLicencaStatus {
  supabaseUrl: string;
  /** Chave secreta (service_role ou sb_secret_...). Só no servidor. */
  supabaseChave: string;
  /** Chave privada do gateway já importada (ECDSA P-256, uso 'sign'). */
  chave: CryptoKey;
  kid: string;
  http?: typeof fetch;
  agoraMs?: () => number;
  limitar?: (origem: string) => boolean;
  /** Só metadados: nunca o corpo. */
  registrar?: (e: { status: number; produto?: string; cnpjs?: number; contratado?: boolean; ms: number }) => void;
}

export interface PayloadLicencaStatus {
  produto: string;
  cnpjs: string[];
  contratado: boolean;
  dataExpiracao: string | null;
  nonce: string;
  emitidoEm: number;
  valeAte: number;
  loop?: DadosLoop;
}

interface Pergunta {
  cnpjs: string[];
  produto: string;
  nonce: string;
  versao: string | null;
  diagnostico: boolean;
}

class Recusa extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Valida e normaliza o corpo. CNPJ (14) ou CPF (11) só com dígitos, sem repetir. */
export function lerPergunta(corpo: unknown): Pergunta {
  const o = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const invalido = (m: string) => new Recusa(400, 'PEDIDO_INVALIDO', m);

  if (!Array.isArray(o.cnpjs) || o.cnpjs.length === 0 || o.cnpjs.length > MAX_CNPJS) {
    throw invalido(`Informe de 1 a ${MAX_CNPJS} CNPJs.`);
  }
  const cnpjs = [...new Set(o.cnpjs.map((c) => (typeof c === 'string' ? c.replace(/\D/g, '') : '')))].filter(
    (c) => c.length === 14 || c.length === 11,
  );
  if (cnpjs.length === 0) throw invalido('Nenhum CNPJ válido.');

  const produto = typeof o.produto === 'string' ? o.produto.trim() : '';
  if (!/^[A-Za-z][A-Za-z0-9_]{1,59}$/.test(produto)) throw invalido('Produto inválido.');

  const nonce = typeof o.nonce === 'string' ? o.nonce.trim() : '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw invalido('Nonce inválido.');

  const versao = typeof o.versao === 'string' && o.versao.trim() ? o.versao.trim().slice(0, 40) : null;
  return { cnpjs: cnpjs.sort(), produto, nonce, versao, diagnostico: o.diagnostico === true };
}

/** Assina o payload como JWS compacto ES256 (assinatura JOSE r||s). */
export async function assinarJws(chave: CryptoKey, kid: string, payload: PayloadLicencaStatus): Promise<string> {
  const enc = new TextEncoder();
  const b64 = (o: unknown) => base64Url(enc.encode(JSON.stringify(o)));
  const entrada = `${b64({ alg: 'ES256', kid, typ: TYP_LICENCA_STATUS })}.${b64(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, enc.encode(entrada)));
  return `${entrada}.${base64Url(sig)}`;
}

export function criarHandlerLicencaStatus(op: OpcoesLicencaStatus): (req: Request) => Promise<Response> {
  if (!op.supabaseUrl || !op.supabaseChave) throw new Error('Supabase da licenca-status não configurado.');
  if (!op.kid) throw new Error('Kid da chave do gateway não configurado.');
  const http = op.http ?? fetch;
  const agora = op.agoraMs ?? Date.now;
  const limitar = op.limitar ?? limitadorPublico(LIMITE_POR_MINUTO, 60_000, agora);
  const rpcUrl = `${op.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/licenca_status`;
  const headers: Record<string, string> = { apikey: op.supabaseChave, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (!op.supabaseChave.startsWith('sb_')) headers.Authorization = `Bearer ${op.supabaseChave}`;

  /** Uma chamada por CNPJ (registra o uso com origem 'addon'). Qualquer falha = Supabase indisponível. */
  async function situacao(cnpj: string, p: Pergunta): Promise<{ contratado: boolean; expira?: string }> {
    const r = await http(rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_cnpj: cnpj, p_produto: p.produto, p_origem: p.diagnostico ? null : 'addon', p_versao: p.versao }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const linhas = (await r.json()) as unknown;
    const l = Array.isArray(linhas) ? (linhas[0] as Record<string, unknown> | undefined) : undefined;
    if (!l) return { contratado: false };
    return { contratado: l.contratado === true, expira: typeof l.dataExpiracao === 'string' ? l.dataExpiracao.slice(0, 10) : undefined };
  }

  const loopUrl =
    `${op.supabaseUrl.replace(/\/+$/, '')}/rest/v1/loopapp` +
    `?select=${COLUNAS_DADOS_LOOP}&tipoIntegracao=eq.producao&limit=1`;
  let dadosLoop: { valor: DadosLoop; lidoEm: number } | undefined;

  /** Dados da Loop (public.loopapp), com cache. Falha = devolve o último lido (ou nada); nunca derruba a licença. */
  async function lerDadosLoop(): Promise<DadosLoop | undefined> {
    if (dadosLoop && agora() - dadosLoop.lidoEm < CACHE_DADOS_LOOP_MS) return dadosLoop.valor;
    try {
      const r = await http(loopUrl, { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_DADOS_LOOP_MS) });
      if (!r.ok) return dadosLoop?.valor;
      const linhas = (await r.json()) as unknown;
      const valor = dadosLoopDaLinha(Array.isArray(linhas) ? linhas[0] : undefined);
      if (valor) dadosLoop = { valor, lidoEm: agora() };
      return valor ?? dadosLoop?.valor;
    } catch {
      return dadosLoop?.valor;
    }
  }

  return async (req) => {
    const t0 = agora();
    let produto: string | undefined;
    let qtd: number | undefined;
    const fim = (status: number, corpo: string, tipo: string, contratado?: boolean) => {
      op.registrar?.({ status, produto, cnpjs: qtd, contratado, ms: agora() - t0 });
      return new Response(corpo, { status, headers: { 'Content-Type': tipo, 'Cache-Control': 'no-store' } });
    };
    const erro = (e: Recusa) => fim(e.status, JSON.stringify({ erro: e.codigo, mensagem: e.message }), 'application/json; charset=utf-8');

    if (req.method !== 'POST') return erro(new Recusa(405, 'METODO_INVALIDO', 'Use POST.'));
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'sem-ip';
    if (!limitar(ip)) return erro(new Recusa(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um minuto e tente de novo.'));

    let p: Pergunta;
    try {
      const texto = await req.text();
      if (texto.length > 8192) throw new Recusa(400, 'PEDIDO_INVALIDO', 'Pedido grande demais.');
      let corpo: unknown;
      try {
        corpo = JSON.parse(texto);
      } catch {
        throw new Recusa(400, 'PEDIDO_INVALIDO', 'JSON inválido.');
      }
      p = lerPergunta(corpo);
    } catch (e) {
      return erro(e instanceof Recusa ? e : new Recusa(400, 'PEDIDO_INVALIDO', 'Pedido inválido.'));
    }
    produto = p.produto;
    qtd = p.cnpjs.length;

    const loop = lerDadosLoop();
    let respostas: { contratado: boolean; expira?: string }[];
    try {
      respostas = [];
      for (let i = 0; i < p.cnpjs.length; i += CONSULTAS_EM_PARALELO) {
        const lote = p.cnpjs.slice(i, i + CONSULTAS_EM_PARALELO);
        respostas.push(...(await Promise.all(lote.map((c) => situacao(c, p)))));
      }
    } catch {
      return erro(new Recusa(503, 'LICENCA_INDISPONIVEL', 'Não foi possível consultar a licença agora.'));
    }

    // Mesma regra do add-on: vale o maior vencimento entre os CNPJs com o produto contratado.
    let melhor: string | null = null;
    let contratado = false;
    for (const r of respostas) {
      if (!r.contratado) continue;
      contratado = true;
      if (r.expira && dataExpiracao(r.expira) !== undefined && (melhor === null || r.expira > melhor)) melhor = r.expira;
    }

    const dados = await loop;
    const emitidoEm = Math.floor(agora() / 1000);
    const jws = await assinarJws(op.chave, op.kid, {
      produto: p.produto,
      cnpjs: p.cnpjs,
      contratado,
      dataExpiracao: melhor,
      nonce: p.nonce,
      emitidoEm,
      valeAte: emitidoEm + VALIDADE_RESPOSTA_SEG,
      ...(dados ? { loop: dados } : {}),
    });
    return fim(200, jws, 'application/jose', contratado);
  };
}
