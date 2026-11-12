import {
  type ConfigApp,
  criarHandlerApp,
  type DependenciasApp,
  type PerfilApp,
  processarApp,
  type RequisicaoApp,
} from '../core/gateway-app.ts';
import type { RespostaGateway } from '../core/tipos.ts';

// Gateway do Loop Check (checklists de visita e inspeção). Lista fechada, como o LoopFactory: por aqui a sessão do
// Sankhya é a do usuário técnico do cliente, que pode ser administrador. Os serviços das telas do Sankhya
// (LoopCheckConfigSP, cadastros de modelo/unidade/usuário, identidade visual e push) ficam fora; os liberados
// conferem a pessoa pelo sessaoToken. Docs: loop-check/docs/implementacoes/2026-11-12-addon-java.md (§4).

export const PRODUTO_CHECK = 'LoopCheck';

/** Antes de existir a conta: confere se o e-mail está cadastrado na empresa escolhida. */
const PUBLICOS = new Set(['LoopCheckSessaoSP.doVerificarCadastro']);

const LIBERADOS = new Set([
  ...PUBLICOS,
  'LoopCheckSessaoSP.doContexto',
  'LoopCheckSessaoSP.doEnviarCodigoEmail',
  'LoopCheckSessaoSP.doConfirmarCodigoEmail',
  'LoopCheckCadastrosSP.doListarModelos',
  'LoopCheckCadastrosSP.doObterModelo',
  'LoopCheckVisitaSP.doListar',
  'LoopCheckVisitaSP.doObter',
  'LoopCheckVisitaSP.doIniciar',
  'LoopCheckVisitaSP.doSalvar',
  'LoopCheckVisitaSP.doAnexarFoto',
  'LoopCheckVisitaSP.doBaixarFoto',
  'LoopCheckVisitaSP.doRemoverFoto',
  'LoopCheckVisitaSP.doConcluir',
  'LoopCheckVisitaSP.doRegistrarAceite',
  'LoopCheckVisitaSP.doCancelar',
  'LoopCheckVisitaSP.doPendenciasAnteriores',
  'LoopCheckPendenciaSP.doListar',
  'LoopCheckPendenciaSP.doResolver',
  'LoopCheckPainelSP.doResumo',
  'LoopCheckIdentidadeSP.doLogos',
  'LoopCheckIdentidadeSP.doBannersAtivos',
  'LoopCheckIdentidadeSP.doImagemBanner',
  'LoopCheckMensagensSP.doInbox',
  'LoopCheckMensagensSP.doDetalhe',
  'LoopCheckMensagensSP.doContador',
  'LoopCheckMensagensSP.doMarcarLida',
  'LoopCheckMensagensSP.doRegistrarDispositivo',
  'LoopCheckMensagensSP.doDesativarDispositivo',
]);

const PERFIL: PerfilApp = {
  funcao: 'check-gateway',
  modulo: 'loop-check',
  produto: PRODUTO_CHECK,
  servicoPermitido: (serviceName) => LIBERADOS.has(serviceName),
  publicos: PUBLICOS,
  // Concluir recalcula a nota e grava as pendências; foto vai inteira (até 1 MB) numa chamada.
  timeoutMs: 60_000,
};

export function processarCheck(req: RequisicaoApp, deps: DependenciasApp): Promise<RespostaGateway> {
  return processarApp(PERFIL, req, deps);
}

export function criarHandlerCheck(cfg: ConfigApp): (req: Request) => Promise<Response> {
  return criarHandlerApp(PERFIL, cfg);
}
