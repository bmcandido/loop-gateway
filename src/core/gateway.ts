import type { AssinadorIdentidade } from './assinatura.ts';
import { desembrulhar } from './desembrulhar.ts';
import { iconeDoDominio } from './icone.ts';
import type { LicencaDoApp } from './licenca-app.ts';
import { type ProdutoGateway, regraDoServico } from './servicos.ts';
import {
  ErroGateway,
  type EventoGateway,
  type PortaSankhya,
  type RespostaGateway,
  type UsuarioAutenticado,
  type ValidadorToken,
} from './tipos.ts';

export { desembrulhar };

export interface DependenciasGateway {
  validador: ValidadorToken;
  /** Confere o JWS da licença enviado pelo app (X-Loop-Licenca) e devolve o CNPJ do cliente. */
  licencaDoApp: (jws: string | null | undefined, produto?: ProdutoGateway) => Promise<LicencaDoApp>;
  /** Situação da licença do CNPJ no Supabase; sem ela nenhum serviço é atendido. */
  licenca: (cnpj: string, produto?: ProdutoGateway) => Promise<void>;
  /** Sankhya do cliente (credenciais do CNPJ no Supabase). */
  sankhya: (cnpj: string) => PortaSankhya;
  /** Assina a identidade do usuário para o Add-on (v2, ES256). */
  assinar: AssinadorIdentidade;
  /**
   * O cliente (CNPJ) exige e-mail confirmado? Vem da configuração do Add-on
   * (Exigir confirmação de e-mail no login). Ausente = exige.
   */
  exigeEmailConfirmado?: (cnpj: string, produto?: ProdutoGateway) => Promise<boolean>;
  /** O e-mail é de um vendedor ativo no Sankhya do cliente? */
  vendedorAtivo?: (cnpj: string, email: string) => Promise<boolean>;
  /** Empresa principal do cliente (rota /icone/ecommerce). */
  codEmpDoCliente?: (cnpj: string) => Promise<number | null>;
  /** JWS da licença do domínio do site (rota /icone). */
  jwsDoDominio?: (dominio: string) => Promise<string | null>;
  agoraSeg?: () => number;
  registrar?: (e: EventoGateway) => void;
}

export interface Requisicao {
  metodo: string;
  /** Caminho já sem prefixo da função: /servico, /saude. */
  caminho: string;
  authorization?: string | null;
  /** Cabeçalho X-Loop-Licenca: o JWS do licenca.json do app. */
  licenca?: string | null;
  corpo: unknown;
}

/** Campos que só o gateway/Add-on podem preencher. */
const CAMPOS_RESERVADOS = ['_portalAuth', '_portalEmail'];

export async function processar(req: Requisicao, deps: DependenciasGateway): Promise<RespostaGateway> {
  const inicio = Date.now();
  const evento: EventoGateway = { rota: req.caminho, status: 200, ms: 0 };
  let resposta: RespostaGateway;
  try {
    resposta = await rotear(req, deps, evento);
  } catch (e) {
    resposta = respostaDeErro(e, evento);
  }
  evento.status = resposta.status;
  evento.ms = Date.now() - inicio;
  deps.registrar?.(evento);
  return resposta;
}

async function rotear(req: Requisicao, deps: DependenciasGateway, evento: EventoGateway): Promise<RespostaGateway> {
  if (req.caminho === '/saude' && req.metodo === 'GET') {
    return { status: 200, corpo: { ok: true } };
  }
  if (req.metodo !== 'POST') {
    throw new ErroGateway(405, 'METODO', 'Método não permitido.');
  }
  if (req.caminho === '/servico') return servico(req, deps, evento);
  if (req.caminho === '/icone' || req.caminho === '/icone/ecommerce') {
    const produto = req.caminho === '/icone' ? 'LoopPortal' : 'LoopEcommerce';
    const { cnpj, ...resposta } = await iconeDoDominio(req.corpo, deps, produto);
    evento.cnpj = cnpj;
    return resposta;
  }
  throw new ErroGateway(404, 'ROTA', 'Rota não encontrada.');
}

async function servico(req: Requisicao, deps: DependenciasGateway, evento: EventoGateway): Promise<RespostaGateway> {
  const corpo = objeto(req.corpo);
  const serviceName = typeof corpo?.serviceName === 'string' ? corpo.serviceName : '';
  evento.servico = serviceName || undefined;

  const regra = regraDoServico(serviceName);
  if (!regra) {
    throw new ErroGateway(403, 'SERVICO_NAO_PERMITIDO', 'Serviço não disponível para o portal.');
  }
  // O cliente é o da licença assinada; licença inativa: nada passa, nem os serviços públicos.
  const { cnpj } = await deps.licencaDoApp(req.licenca, regra.produto);
  evento.cnpj = cnpj;
  await deps.licenca(cnpj, regra.produto);
  const requestBody = corpo?.requestBody === undefined ? {} : objeto(corpo.requestBody);
  if (!requestBody) {
    throw new ErroGateway(400, 'CORPO_INVALIDO', 'Requisição inválida.');
  }

  // Token inválido é recusado mesmo em serviço público: não tratamos como visitante.
  const usuario = await autenticar(req.authorization, deps.validador);
  if (regra.acesso !== 'PUBLICO' && !usuario) {
    throw new ErroGateway(401, 'LOGIN_NECESSARIO', 'Sessão expirada. Entre novamente.');
  }
  evento.uid = usuario?.uid;
  if (usuario?.emailVerificado === false && (deps.exigeEmailConfirmado ? await deps.exigeEmailConfirmado(cnpj, regra.produto) : true)) {
    // conta Firebase sem e-mail confirmado poderia se passar por outro cliente (o portal acha o cliente pelo e-mail)
    throw new ErroGateway(403, 'EMAIL_NAO_VERIFICADO', 'Confirme seu e-mail pelo link que enviamos para acessar o portal.');
  }

  if (regra.acesso === 'VENDEDOR' && !(await deps.vendedorAtivo?.(cnpj, usuario!.email))) {
    throw new ErroGateway(403, 'SEM_VINCULO_VENDEDOR', 'Usuário sem vínculo de vendedor.');
  }

  const recusa = regra.conferir?.(requestBody);
  if (recusa) {
    evento.detalhe = recusa;
    throw new ErroGateway(403, 'CONSULTA_RECUSADA', 'Operação não permitida.');
  }

  const body: Record<string, unknown> = { ...requestBody };
  for (const c of CAMPOS_RESERVADOS) delete body[c];

  // O vendedor é conferido aqui; os serviços dele não leem a identidade assinada.
  if (usuario && regra.acesso !== 'VENDEDOR') {
    const agora = deps.agoraSeg?.() ?? Date.now() / 1000;
    body._portalAuth = await deps.assinar(usuario, cnpj, agora);
  } else if (!usuario) {
    // visitante: o Add-on não pode receber um cliente escolhido pelo app
    delete body.codUsuPortal;
  }

  const envelope = await deps.sankhya(cnpj).chamar(serviceName, regra.modulo, body);
  return { status: 200, corpo: semCampos(desembrulhar(envelope), regra.ocultar) };
}

async function autenticar(
  authorization: string | null | undefined,
  validador: ValidadorToken,
): Promise<UsuarioAutenticado | undefined> {
  if (!authorization) return undefined;
  const m = /^Bearer\s+(\S{20,4096})$/.exec(authorization.trim());
  if (!m) {
    throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão inválida. Entre novamente.');
  }
  return validador.validar(m[1]);
}


function semCampos(v: unknown, campos: readonly string[] | undefined): unknown {
  if (!campos?.length || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((i) => semCampos(i, campos));
  const r: Record<string, unknown> = {};
  for (const [k, valor] of Object.entries(v)) {
    if (!campos.includes(k)) r[k] = semCampos(valor, campos);
  }
  return r;
}

function objeto(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * Erros saem no mesmo envelope do Sankhya ({status: "0", statusMessage}),
 * que o app já sabe exibir. Erro inesperado não expõe detalhes.
 */
function respostaDeErro(e: unknown, evento: EventoGateway): RespostaGateway {
  const erro =
    e instanceof ErroGateway ? e : new ErroGateway(500, 'ERRO_INTERNO', 'Não foi possível concluir a operação. Tente novamente.');
  evento.codigo = erro.codigo;
  return { status: erro.status, corpo: { status: '0', statusMessage: erro.message, codigoGateway: erro.codigo } };
}
