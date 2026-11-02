import { motivoRecusaSql } from './filtro-sql.ts';
import type { ModuloSankhya } from './tipos.ts';

/**
 * PUBLICO: chamado antes do login (tela de entrada). O codUsuPortal é
 *          removido do corpo, então o Add-on trata como visitante.
 * USUARIO: exige token de login válido.
 * VENDEDOR: exige login válido e vendedor ativo no Sankhya do cliente. Só o login não basta:
 *           o cadastro no app é aberto a qualquer pessoa.
 */
export type Acesso = 'PUBLICO' | 'USUARIO' | 'VENDEDOR';

/** Produto que o serviço exige na licença (código em `clientesProdutos`). */
export type ProdutoGateway = 'LoopPortal' | 'LoopEcommerce';

export interface RegraServico {
  acesso: Acesso;
  modulo: ModuloSankhya;
  produto: ProdutoGateway;
  /** Campos retirados da resposta antes de voltar ao app. */
  ocultar?: readonly string[];
  /** Confere o corpo antes de chamar o Sankhya: devolve o motivo da recusa ou null. */
  conferir?: (corpo: Record<string, unknown>) => string | null;
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

const vendedor = (modulo: ModuloSankhya, ocultar?: readonly string[], conferir?: RegraServico['conferir']): RegraServico => ({
  acesso: 'VENDEDOR',
  modulo,
  produto: 'LoopEcommerce',
  ...(ocultar ? { ocultar } : {}),
  ...(conferir ? { conferir } : {}),
});

/** Gravações genéricas: só nas entidades que o app grava. */
const so = (entidades: readonly string[], ler: (corpo: Record<string, unknown>) => unknown) => (corpo: Record<string, unknown>) => {
  const entidade = ler(corpo);
  return typeof entidade === 'string' && entidades.includes(entidade) ? null : `entidade ${String(entidade)}`;
};
const entidadeDoDataset = (corpo: Record<string, unknown>) => corpo.entityName;
const entidadeDoCrud = (corpo: Record<string, unknown>) => (corpo.dataSet as { rootEntity?: unknown } | undefined)?.rootEntity;

/** Serviços genéricos, com o corpo conferido: SQL filtrado e gravação só onde o app grava. */
const GENERICOS_VENDEDOR: Readonly<Record<string, RegraServico>> = Object.freeze({
  'DbExplorerSP.executeQuery': vendedor('mge', undefined, (corpo) => motivoRecusaSql(corpo.sql)),
  'CRUDServiceProvider.saveRecord': vendedor('mge', undefined, so(['LOOPPAYMENTLINK', 'LOOPB2BB2CVISITA', 'LOOPDELIVERYERRORLOG'], entidadeDoCrud)),
  'DatasetSP.save': vendedor('mge', undefined, so(['CabecalhoNota'], entidadeDoDataset)),
  'DatasetSP.removeRecord': vendedor('mge', undefined, so(['LOOPB2BB2CVISITA'], entidadeDoDataset)),
});

/**
 * Serviços nativos do Sankhya usados pela força de vendas, cada um no contexto em que responde.
 * Baixa de título, adiantamento e exclusão ou cancelamento de nota ficam fora: o app não os chama.
 */
const NATIVOS_VENDEDOR: Readonly<Record<string, ModuloSankhya>> = Object.freeze({
  'AnexoSistemaSP.salvar': 'mge',
  'CACSP.incluirNota': 'mgecom',
  'CACSP.incluirAlterarCabecalhoNota': 'mgecom',
  'CACSP.incluirAlterarItemNota': 'mgecom',
  'CACSP.confirmarNota': 'mgecom',
  'ConsultaProdutosSP.consultaProdutos': 'mgecom',
  'EdicaoSerieSP.incluirSerie': 'mgecom',
  'SelecaoDocumentoSP.faturar': 'mgecom',
  'ServicosNfeSP.confirmarNota': 'mgecom',
});

/**
 * Métodos do Add-on que a força de vendas chama, um a um (levantados no código do app). Telas
 * administrativas (salvar, excluir, permissões), segredos e conexões ficam fora.
 */
const METODOS_VENDEDOR: ReadonlySet<string> = new Set([
  'LoopEcommeceHelperControllerSP.doConsultarImagensProduto',
  'LoopEcommeceHelperControllerSP.doConsultarImagensProdutosLista',
  'LoopEcommerceCentroResultadoSP.doConsultar',
  'LoopEcommerceClientesVendedorSP.doAssumirCliente',
  'LoopEcommerceClientesVendedorSP.doConsultar',
  'LoopEcommerceConsultaProdutosSP.doConsultar',
  'LoopEcommerceDashboardSP.doConsultarResumo',
  'LoopEcommerceDynamicConfigSP.doConsultarMetadata',
  'LoopEcommerceDynamicConfigSP.doExecutarLookup',
  'LoopEcommerceEmailSP.doEnviarPedido',
  'LoopEcommerceEmpresasSP.doConsultarEmpresaConfig',
  'LoopEcommerceGoogleMapsSP.doGeocodificar',
  'LoopEcommerceAgendaSP.doContexto',
  'LoopEcommerceAgendaSP.doConectar',
  'LoopEcommerceAgendaSP.doConcluirConexao',
  'LoopEcommerceAgendaSP.doDesconectar',
  'LoopEcommerceAgendaSP.doEventos',
  'LoopEcommerceContratosAppSP.doAnexarDocumento',
  'LoopEcommerceContratosAppSP.doAssinaturaIniciar',
  'LoopEcommerceContratosAppSP.doAssinaturaPdf',
  'LoopEcommerceContratosAppSP.doAssinaturaStatus',
  'LoopEcommerceContratosAppSP.doConfig',
  'LoopEcommerceContratosAppSP.doDetalhe',
  'LoopEcommerceContratosAppSP.doDocumentos',
  'LoopEcommerceContratosAppSP.doFormulario',
  'LoopEcommerceContratosAppSP.doGravar',
  'LoopEcommerceContratosAppSP.doListar',
  'LoopEcommerceContratosAppSP.doMarcarVenda',
  'LoopEcommerceContratosAppSP.doModelos',
  'LoopEcommerceContratosAppSP.doPendenciaVenda',
  'LoopEcommerceContratosAppSP.doPesquisar',
  'LoopEcommerceContratosAppSP.doValidar',
  'LoopEcommerceDocumentoSP.doGerarNota',
  'LoopEcommerceDocumentoSP.doGerarRelatorio',
  'LoopEcommerceLeadsSP.doAtualizarEtapa',
  'LoopEcommerceLeadsSP.doAtualizarLead',
  'LoopEcommerceLeadsSP.doCadastrarManual',
  'LoopEcommerceLeadsSP.doConsultar',
  'LoopEcommerceLeadsSP.doConsultarLead',
  'LoopEcommerceLeadsSP.doReconciliarDocumentos',
  'LoopEcommerceLeadsSP.doRegistrarAtividade',
  'LoopEcommerceLeadsSP.doVincularDocumento',
  'LoopEcommerceLeadsSP.doVincularParceiro',
  'LoopEcommerceLeadsSP.doVincularVisita',
  'LoopEcommerceNaturezasSP.doConsultar',
  'LoopEcommerceNegociacoesSP.doConsultar',
  'LoopEcommerceProdutosSP.doConsultar',
  'LoopEcommerceProjetosSP.doConsultar',
  'LoopEcommerceQueryConfigSP.doConsultar',
  'LoopEcommerceRelatoriosSP.doConsultarComArquivo',
  'LoopEcommerceTabelaPrecoSP.doConsultarTabelaPreco',
  'LoopEcommerceTipoOperacaoSP.doConsultar',
  'LoopEcommerceTopFatOrcSP.doConsultar',
  'LoopEcommerceTopFatPedSP.doConsultar',
  'LoopEcommerceUsersSP.doBuscarFoto',
  'LoopEcommerceUsersSP.doConsultar',
  'LoopHubMensageriaSP.consultarPorReferencia',
  'LoopHubMensageriaSP.registrarEnvioExterno',
]);

/** Configuração da loja para o vendedor: a senha de SMTP não sai do servidor. */
const CONFIG_VENDEDOR = vendedor(CONTEXTO_ECOMMERCE, ['smtpPass', 'loopChaveCliente']);

export function regraDoServico(serviceName: string): RegraServico | undefined {
  if (Object.prototype.hasOwnProperty.call(SERVICOS, serviceName)) return SERVICOS[serviceName];
  if (serviceName === 'LoopEcommerceConfigSP.doConsultar') return CONFIG_VENDEDOR;
  if (Object.prototype.hasOwnProperty.call(GENERICOS_VENDEDOR, serviceName)) return GENERICOS_VENDEDOR[serviceName];
  if (Object.prototype.hasOwnProperty.call(NATIVOS_VENDEDOR, serviceName)) return vendedor(NATIVOS_VENDEDOR[serviceName]);
  return METODOS_VENDEDOR.has(serviceName) ? vendedor(CONTEXTO_ECOMMERCE) : undefined;
}
