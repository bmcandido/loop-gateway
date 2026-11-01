import type { ModuloSankhya } from './tipos.ts';

/**
 * PUBLICO: chamado antes do login (tela de entrada). O codUsuPortal é
 *          removido do corpo, então o Add-on trata como visitante.
 * USUARIO: exige token de login válido.
 */
export type Acesso = 'PUBLICO' | 'USUARIO';

export interface RegraServico {
  acesso: Acesso;
  modulo: ModuloSankhya;
}

/** Contexto do Add-on do Portal (rootProject.name de loopPortal-sankhya-addon/settings.gradle). */
export const CONTEXTO_ADDON: ModuloSankhya = 'loop-portal';

const usuario = (modulo: ModuloSankhya = CONTEXTO_ADDON): RegraServico => ({ acesso: 'USUARIO', modulo });
const publico: RegraServico = { acesso: 'PUBLICO', modulo: CONTEXTO_ADDON };

/**
 * Lista FECHADA do que o app pode chamar. Tudo fora daqui é recusado,
 * inclusive DbExplorerSP (SQL livre), CRUDServiceProvider e os serviços
 * nativos do Sankhya (boleto, relatórios, notas, renegociação): esses só
 * rodam dentro do Add-on, depois de conferir a posse.
 */
export const SERVICOS: Readonly<Record<string, RegraServico>> = Object.freeze({
  // Antes do login
  'LoopPortalVisualSP.doConsultar': publico,
  'LoopPortalBannerSP.doListarAtivos': publico,
  'LoopPortalBannerSP.doImagem': publico,
  'LoopPortalAppSP.consultarConfig': publico,
  'LoopPortalAppSP.validarCadastro': publico,

  // Cliente logado (antes era SQL livre no app)
  'LoopPortalAppSP.meuUsuario': usuario(),
  'LoopPortalAppSP.consultarAvisos': usuario(),
  // Foto do próprio usuário: o Add-on usa a identidade assinada, não o corpo.
  'LoopPortalAppSP.minhaFoto': usuario(),
  'LoopPortalAppSP.salvarFoto': usuario(),
  'LoopPortalAppSP.removerFoto': usuario(),

  // Atividade do app
  'LoopPortalAtividadeSP.iniciarSessao': usuario(),
  'LoopPortalAtividadeSP.pulso': usuario(),
  'LoopPortalAtividadeSP.encerrarSessao': usuario(),

  // Contratos e financeiro
  'LoopPortalContratoSP.consultarContratos': usuario(),
  'LoopPortalContratoSP.consultarAnexos': usuario(),
  'LoopPortalContratoSP.obterAnexo': usuario(),
  'LoopPortalFinanceiroSP.consultarPainel': usuario(),
  'LoopPortalFinanceiroSP.contarTitulos': usuario(),
  'LoopPortalFinanceiroSP.consultarTitulos': usuario(),
  'LoopPortalFinanceiroSP.consultarDetalhamentos': usuario(),

  // SAC
  'LoopPortalSacSP.consultarSac': usuario(),
  'LoopPortalSacSP.consultarHistorico': usuario(),
  'LoopPortalSacSP.consultarApoios': usuario(),
  'LoopPortalSacSP.abrirSac': usuario(),
  'LoopPortalSacSP.responderSac': usuario(),
  'LoopPortalSacSP.encerrarSac': usuario(),

  // Campanhas e renegociação
  'LoopPortalCampanhaSP.doConsultarCampanhas': usuario(),
  // Renegociação: regras, valores e efetivação decididos no Add-on.
  // (LoopPortalRenegociacaoSP gravava o que o app mandava: fora do gateway.)
  'LoopPortalRenegociarSP.titulosAptos': usuario(),
  'LoopPortalRenegociarSP.simular': usuario(),
  'LoopPortalRenegociarSP.consultarSimulacao': usuario(),
  'LoopPortalRenegociarSP.confirmar': usuario(),
  'LoopPortalRenegociarSP.minhasRenegociacoes': usuario(),

  // Pagamentos. Registrar, confirmar e cancelar ficam fora: o estado do
  // pagamento não é gravado pelo cliente (o PIX ainda não passa pelo gateway).
  'LoopPortalPagamentoConfigV2SP.consultarStatusPortal': usuario(),
  'LoopPortalPagamentoSP.consultarPagamentos': usuario(),
  'LoopPortalPagamentoSP.enviarComprovante': usuario(),
  'LoopPortalPagamentoSP.processarCartao': usuario(),

  // Documentos (boleto, nota, recibos, relatórios): o PDF volta na resposta.
  'LoopPortalDocumentoSP.gerar': usuario(),
  // Relatórios cadastrados no portal, já filtrados pelo perfil (sem o arquivo do relatório).
  'LoopPortalDocumentoSP.relatorios': usuario(),
});

export function regraDoServico(serviceName: string): RegraServico | undefined {
  return Object.prototype.hasOwnProperty.call(SERVICOS, serviceName) ? SERVICOS[serviceName] : undefined;
}
