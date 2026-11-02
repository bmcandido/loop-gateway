import type { ModuloSankhya } from './tipos.ts';

/**
 * PUBLICO: chamado antes do login (tela de entrada). O codUsuPortal é
 *          removido do corpo, então o Add-on trata como visitante.
 * USUARIO: exige token de login válido.
 */
export type Acesso = 'PUBLICO' | 'USUARIO';

/** Produto que o serviço exige na licença (código em `clientesProdutos`). */
export type ProdutoGateway = 'LoopPortal' | 'LoopEcommerce';

export interface RegraServico {
  acesso: Acesso;
  modulo: ModuloSankhya;
  produto: ProdutoGateway;
}

/** Contexto do Add-on do Portal (rootProject.name de loopPortal-sankhya-addon/settings.gradle). */
export const CONTEXTO_ADDON: ModuloSankhya = 'loop-portal';

/** Contexto do Add-on do E-commerce. O nome antigo continua no Add-on de propósito. */
export const CONTEXTO_ECOMMERCE: ModuloSankhya = 'loop-b2bb2c';

const usuario = (modulo: ModuloSankhya = CONTEXTO_ADDON): RegraServico => ({ acesso: 'USUARIO', modulo, produto: 'LoopPortal' });
const publico: RegraServico = { acesso: 'PUBLICO', modulo: CONTEXTO_ADDON, produto: 'LoopPortal' };
const publicoEcommerce: RegraServico = { acesso: 'PUBLICO', modulo: CONTEXTO_ECOMMERCE, produto: 'LoopEcommerce' };

/**
 * Lista FECHADA do que o app pode chamar. Tudo fora daqui é recusado,
 * inclusive DbExplorerSP (SQL livre), CRUDServiceProvider e os serviços
 * nativos do Sankhya (boleto, relatórios, notas, renegociação): esses só
 * rodam dentro do Add-on, depois de conferir a posse.
 */
export const SERVICOS: Readonly<Record<string, RegraServico>> = Object.freeze({
  // E-commerce: conferência do carrinho, sem gravar (visitante também usa)
  'LoopEcommerceConsumidorAppSP.doConferirCarrinho': publicoEcommerce,

  // E-commerce: abertura da loja e vitrine. LoopEcommerceConfigSP.doConsultar fica fora:
  // devolve dados internos e a senha de SMTP. doLojaPublica traz só o que o visitante vê.
  // Catálogo e imagens de produto também ficam fora até o Add-on ter serviço próprio para o
  // visitante: os atuais trazem campos internos e não conferem os produtos liberados.
  'LoopEcommerceConfigSP.doLojaPublica': publicoEcommerce,
  'LoopEcommerceVitrinesSP.doConfiguracaoLoja': publicoEcommerce,
  'LoopEcommerceConsultaProdutosSP.doConsultarGrupos': publicoEcommerce,
  'LoopEcommerceBannersSP.doListarAtivos': publicoEcommerce,
  'LoopEcommerceBannersSP.doImagem': publicoEcommerce,
  'LoopEcommerceConsumidorAppSP.doAvaliacoesProduto': publicoEcommerce,

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
