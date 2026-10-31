import { identidadeAssinada, TAMANHO_MINIMO_SEGREDO } from './assinatura.ts';
import type { VerificadorLicenca } from './licenca.ts';
import { regraDoServico } from './servicos.ts';
import {
  ErroGateway,
  type EventoGateway,
  type PortaSankhya,
  type RespostaGateway,
  type UsuarioAutenticado,
  type ValidadorToken,
} from './tipos.ts';

export interface DependenciasGateway {
  validador: ValidadorToken;
  sankhya: PortaSankhya;
  /** Segredo HMAC compartilhado com o Add-on (LOOPPORTAL_GATEWAY_SECRET). */
  segredo: string;
  /** Licença do cliente no Supabase; sem ela nenhum serviço é atendido. */
  licenca: VerificadorLicenca;
  agoraSeg?: () => number;
  registrar?: (e: EventoGateway) => void;
}

export interface Requisicao {
  metodo: string;
  /** Caminho já sem prefixo da função: /servico, /saude. */
  caminho: string;
  authorization?: string | null;
  corpo: unknown;
}

/** Campos que só o gateway/Add-on podem preencher. */
const CAMPOS_RESERVADOS = ['_portalAuth', '_portalEmail'];

export async function processar(req: Requisicao, deps: DependenciasGateway): Promise<RespostaGateway> {
  const inicio = Date.now();
  const evento: EventoGateway = { rota: req.caminho, status: 200, ms: 0 };
  let resposta: RespostaGateway;
  try {
    if (!deps.segredo || deps.segredo.length < TAMANHO_MINIMO_SEGREDO) {
      throw new ErroGateway(500, 'GATEWAY_SEM_SEGREDO', 'Gateway do portal não configurado.');
    }
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
  // Licença inativa: nada do app passa, nem os serviços públicos da tela de entrada.
  await deps.licenca();
  const requestBody = corpo?.requestBody === undefined ? {} : objeto(corpo.requestBody);
  if (!requestBody) {
    throw new ErroGateway(400, 'CORPO_INVALIDO', 'Requisição inválida.');
  }

  // Token inválido é recusado mesmo em serviço público: não tratamos como visitante.
  const usuario = await autenticar(req.authorization, deps.validador);
  if (regra.acesso === 'USUARIO' && !usuario) {
    throw new ErroGateway(401, 'LOGIN_NECESSARIO', 'Sessão expirada. Entre novamente.');
  }
  evento.uid = usuario?.uid;

  const body: Record<string, unknown> = { ...requestBody };
  for (const c of CAMPOS_RESERVADOS) delete body[c];

  if (usuario) {
    const agora = deps.agoraSeg?.() ?? Date.now() / 1000;
    body._portalAuth = await identidadeAssinada(usuario, deps.segredo, agora);
  } else {
    // visitante: o Add-on não pode receber um cliente escolhido pelo app
    delete body.codUsuPortal;
  }

  const envelope = await deps.sankhya.chamar(serviceName, regra.modulo, body);
  return { status: 200, corpo: envelope };
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
