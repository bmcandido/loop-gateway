import {
  type ConfigApp,
  criarHandlerApp,
  type DependenciasApp,
  type PerfilApp,
  processarApp,
  type RequisicaoApp,
} from '../core/gateway-app.ts';
import type { RespostaGateway } from '../core/tipos.ts';

// Gateway do Loop Delivery (app do motorista). Mesmo modelo do LoopFactory: a empresa sai da conta verificada, o
// Add-on identifica o motorista pelo sessaoToken e a lista de serviços é fechada. Os demais serviços do Add-on são
// das telas do Sankhya (configuração, usuários, SMTP, formação de cargas, oficina...) e confiam na sessão do
// administrador; por aqui a sessão é a do usuário técnico do cliente, que pode ser administrador.
//
// Serviço só entra aqui depois de identificar o motorista pelo sessaoToken (IdentidadeMotorista), nunca pelo
// codParc/codUsu do corpo.

export const PRODUTO_DELIVERY = 'LoopDelivery';

/** Antes de existir a conta: confere se o e-mail está no cadastro de motoristas do app na empresa escolhida. */
const PUBLICOS = new Set(['LoopDeliveryMotoristaSP.doVerificarCadastro']);

export const LIBERADOS: ReadonlySet<string> = new Set([
  ...PUBLICOS,
  // Abertura: consultas nomeadas (configuração, entregas, filtros) e identidade visual
  'LoopDeliveryConsultaSP.doExecutar',
  'LoopDeliveryConfigSP.doConsultarIdentidadeVisual',
  // Cadastro do próprio motorista
  'LoopDeliveryMotoristaSP.doMeusDados',
  'LoopDeliveryMotoristaSP.doMeuVeiculo',
  'LoopDeliveryMotoristaSP.doSalvarMinhaFoto',
]);

const PERFIL: PerfilApp = {
  funcao: 'delivery-gateway',
  modulo: 'loop-delivery',
  produto: PRODUTO_DELIVERY,
  servicoPermitido: (serviceName) => LIBERADOS.has(serviceName),
  publicos: PUBLICOS,
  // Finalizar entrega e devolução esperam o Sankhya gravar e faturar a nota.
  timeoutMs: 90_000,
};

export function processarDelivery(req: RequisicaoApp, deps: DependenciasApp): Promise<RespostaGateway> {
  return processarApp(PERFIL, req, deps);
}

export function criarHandlerDelivery(cfg: ConfigApp): (req: Request) => Promise<Response> {
  return criarHandlerApp(PERFIL, cfg);
}
