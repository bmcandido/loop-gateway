import {
  type ConfigApp,
  criarHandlerApp,
  type DependenciasApp,
  type PerfilApp,
  processarApp,
  type RequisicaoApp,
} from '../core/gateway-app.ts';
import type { RespostaGateway } from '../core/tipos.ts';

// Gateway do LoopFactory. A lista é fechada: os demais serviços do Add-on são das telas do
// Sankhya e confiam na sessão do administrador. Por aqui a sessão é a do usuário técnico do cliente, que pode ser
// administrador, então uma regra por prefixo daria a qualquer operador o poder de alterar usuários e reprocessar.

export const PRODUTO_PRODUCAO = 'LoopFactory';

/** Antes de existir a conta: confere se o e-mail está cadastrado na empresa escolhida. */
const PUBLICOS = new Set(['LoopProducaoUsuariosSP.doVerificarCadastro']);

const LIBERADOS = new Set([
  ...PUBLICOS,
  'LoopProducaoConfigSP.doConsultar',
  'LoopProducaoExecucaoSP.doDetalhe',
  'LoopProducaoExecucaoSP.doRegistrar',
  'LoopProducaoFilaSP.doListar',
  'LoopProducaoFilaSP.doResumo',
  'LoopProducaoUsuariosSP.doBuscarFoto',
  'LoopProducaoUsuariosSP.doMeuCadastro',
]);

const PERFIL: PerfilApp = {
  funcao: 'producao-gateway',
  modulo: 'loop-producao',
  produto: PRODUTO_PRODUCAO,
  servicoPermitido: (serviceName) => LIBERADOS.has(serviceName),
  publicos: PUBLICOS,
  // O apontamento espera o Sankhya gravar a nota e movimentar o estoque.
  timeoutMs: 90_000,
};

export function processarProducao(req: RequisicaoApp, deps: DependenciasApp): Promise<RespostaGateway> {
  return processarApp(PERFIL, req, deps);
}

export function criarHandlerProducao(cfg: ConfigApp): (req: Request) => Promise<Response> {
  return criarHandlerApp(PERFIL, cfg);
}
