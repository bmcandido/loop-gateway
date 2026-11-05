import {
  type ConfigApp,
  criarHandlerApp,
  type DependenciasApp,
  type PerfilApp,
  processarApp,
  type RequisicaoApp,
} from '../core/gateway-app.ts';
import type { RespostaGateway } from '../core/tipos.ts';

// Gateway do Loop Stok. A lista é fechada: os demais serviços do Add-on são das telas do Sankhya e confiam na
// sessão do administrador. Por aqui a sessão é a do usuário técnico do cliente, que pode ser administrador.
// Docs: loop_stok/docs/gateway/01-migracao-para-stok-gateway.md e 02-ponte-temporaria.md.

export const PRODUTO_STOK = 'LoopStok';

/** Antes de existir a conta: confere se o e-mail está cadastrado na empresa escolhida. */
const PUBLICOS = new Set(['LoopStokUsuariosSP.doVerificarCadastro']);

/** Identificam a pessoa pelo sessaoToken. A ponte confere SQL e serviços nativos no Add-on. */
const COM_IDENTIDADE = [
  'LoopStokConsultaSP.doExecutar',
  'LoopStokPonteSP.doConsultar',
  'LoopStokPonteSP.doDocumento',
  'LoopStokPonteSP.doEncaminhar',
  'LoopStokUsuariosSP.doBuscarFoto',
  'LoopStokUsuariosSP.doMeuCadastro',
];

/**
 * PONTE TEMPORÁRIA: os serviços que o app já usava. Ainda confiam no codUsu do corpo, então um usuário da mesma
 * empresa poderia agir em nome de outro. Não publicar para clientes antes de cada um usar o sessaoToken.
 */
const AINDA_COM_CODUSU_NO_CORPO = [
  'LoopStokAtividadeSP.doContexto',
  'LoopStokAtividadeSP.doDetalhe',
  'LoopStokAtividadeSP.doIndicadores',
  'LoopStokAtividadeSP.doMapa',
  'LoopStokAtividadeSP.doRegistrar',
  'LoopStokAtividadeSP.doSinal',
  'LoopStokBannersSP.doImagem',
  'LoopStokBannersSP.doListarAtivos',
  'LoopStokConfigSP.doConsultar',
  'LoopStokEsteiraSP.doConfig',
  'LoopStokEsteiraSP.doEstado',
  'LoopStokEsteiraSP.doLocaisEntrada',
  'LoopStokGestaoSP.doCatalogo',
  'LoopStokGestaoSP.doGrade',
  'LoopStokGestaoSP.doPainel',
  'LoopStokLookupSP.doBuscarImagemLocal',
  'LoopStokLotesSP.doConsultar',
  'LoopStokLotesSP.doHistoricoLote',
  'LoopStokMapaIndoorSP.doBaixarApp',
  'LoopStokMapaIndoorSP.doListarApp',
  'LoopStokMensagensSP.doConcluir',
  'LoopStokMensagensSP.doContador',
  'LoopStokMensagensSP.doDesativarDispositivo',
  'LoopStokMensagensSP.doDetalhe',
  'LoopStokMensagensSP.doHome',
  'LoopStokMensagensSP.doInbox',
  'LoopStokMensagensSP.doIniciar',
  'LoopStokMensagensSP.doMarcarLida',
  'LoopStokMensagensSP.doRegistrarDispositivo',
  'LoopStokMissaoEquipeSP.doDetalhe',
  'LoopStokMissaoEquipeSP.doEnviarParteEvidencia',
  'LoopStokMissaoEquipeSP.doIniciarEvidencia',
  'LoopStokMissaoEquipeSP.doMinhas',
  'LoopStokMissaoEquipeSP.doPainel',
  'LoopStokMissaoSP.doConfig',
  'LoopStokMissaoSP.doDetalhe',
  'LoopStokMissaoSP.doListar',
  'LoopStokMissaoSP.doPainel',
  'LoopStokMissaoSP.doSimularColeta',
  'LoopStokPickingSP.doConsultarPonto',
  'LoopStokPickingSP.doDetalhe',
  'LoopStokPickingSP.doFinalizar',
  'LoopStokPickingSP.doIniciar',
  'LoopStokPickingSP.doListar',
  'LoopStokPickingSP.doRegistrarColeta',
  'LoopStokPickingSP.doResolverPonto',
  'LoopStokProdutoDetalheSP.doBuscarImagem',
  'LoopStokProdutoDetalheSP.doConsultar',
  'LoopStokProdutoDetalheSP.doResumoPendencias',
  'LoopStokRelatoriosSP.doConsultarApp',
  'LoopStokRelatoriosSP.doConsultarArquivo',
  'LoopStokRelatoriosSP.doPesquisarLookup',
  'LoopStokReposicaoConfigSP.doConfigApp',
  'LoopStokReposicaoGeracaoSP.doConfirmarPedido',
  'LoopStokReposicaoGeracaoSP.doFalharPedido',
  'LoopStokReposicaoGeracaoSP.doGerarCotacao',
  'LoopStokReposicaoGeracaoSP.doReservarPedido',
  'LoopStokReposicaoSP.doCalcular',
  'LoopStokRequisicoesSP.doBuscarMateriais',
  'LoopStokRequisicoesSP.doCancelar',
  'LoopStokRequisicoesSP.doConfig',
  'LoopStokRequisicoesSP.doDashboard',
  'LoopStokRequisicoesSP.doDetalhe',
  'LoopStokRequisicoesSP.doListar',
  'LoopStokRequisicoesSP.doRegistrarAtendimento',
  'LoopStokRequisicoesSP.doRegistrarSolicitacao',
  'LoopStokRequisicoesSP.doUsuariosFiltro',
  'LoopStokScannerSP.doResolver',
  'LoopStokStatusPedidoSP.doRegistrar',
  'LoopStokTurnoSP.doMinhasAtividades',
  'LoopStokTurnoSP.doResumo',
  'LoopStokEsteiraSP.doAceitar',
  'LoopStokEsteiraSP.doAlterarLocalEntrada',
  'LoopStokEsteiraSP.doBipar',
  'LoopStokEsteiraSP.doCancelar',
  'LoopStokEsteiraSP.doCandidatos',
  'LoopStokEsteiraSP.doConcluirItem',
  'LoopStokEsteiraSP.doConcluirSeparacao',
  'LoopStokEsteiraSP.doConfirmarLocalEntrada',
  'LoopStokEsteiraSP.doDevolverReserva',
  'LoopStokEsteiraSP.doDistribuir',
  'LoopStokEsteiraSP.doFalharLocalEntrada',
  'LoopStokEsteiraSP.doFila',
  'LoopStokEsteiraSP.doFinalizarConferencia',
  'LoopStokEsteiraSP.doIniciar',
  'LoopStokEsteiraSP.doLiberarTrava',
  'LoopStokEsteiraSP.doMapa',
  'LoopStokEsteiraSP.doPainelEsteira',
  'LoopStokEsteiraSP.doParticipante',
  'LoopStokEsteiraSP.doPausar',
  'LoopStokEsteiraSP.doProxima',
  'LoopStokEsteiraSP.doReabrirItem',
  'LoopStokEsteiraSP.doRecusar',
  'LoopStokEsteiraSP.doResolverDivergencia',
  'LoopStokEsteiraSP.doResolverLocalEntrada',
  'LoopStokEsteiraSP.doRetomar',
  'LoopStokEsteiraSP.doSoltarItem',
  'LoopStokMissaoSP.doAcaoArea',
  'LoopStokMissaoSP.doAssociarCarrinho',
  'LoopStokMissaoSP.doCancelarTudo',
  'LoopStokMissaoSP.doColetar',
  'LoopStokMissaoSP.doDevolver',
  'LoopStokMissaoSP.doDevolverFila',
  'LoopStokMissaoSP.doEncerrar',
  'LoopStokMissaoSP.doEntregar',
  'LoopStokMissaoSP.doIniciar',
  'LoopStokMissaoSP.doPausar',
  'LoopStokMissaoSP.doRetomar',
  'LoopStokMissaoSP.doTransferir',
  'LoopStokMissaoEquipeSP.doAceitar',
  'LoopStokMissaoEquipeSP.doApurar',
  'LoopStokMissaoEquipeSP.doBipar',
  'LoopStokMissaoEquipeSP.doConcluir',
  'LoopStokMissaoEquipeSP.doIniciar',
  'LoopStokMissaoEquipeSP.doPausar',
  'LoopStokMissaoEquipeSP.doRecusar',
  'LoopStokMissaoEquipeSP.doRetomar',
  'LoopStokMissaoEquipeSP.doSalvarEvidencia',
  'LoopStokMissaoEquipeSP.doVincularDocumento',
];

const LIBERADOS = new Set([...PUBLICOS, ...COM_IDENTIDADE, ...AINDA_COM_CODUSU_NO_CORPO]);

const PERFIL: PerfilApp = {
  funcao: 'stok-gateway',
  modulo: 'loop-stock',
  produto: PRODUTO_STOK,
  servicoPermitido: (serviceName) => LIBERADOS.has(serviceName),
  publicos: PUBLICOS,
  // Separação, conferência e inventário esperam o Sankhya gravar a nota e movimentar o estoque.
  timeoutMs: 90_000,
};

export function processarStok(req: RequisicaoApp, deps: DependenciasApp): Promise<RespostaGateway> {
  return processarApp(PERFIL, req, deps);
}

export function criarHandlerStok(cfg: ConfigApp): (req: Request) => Promise<Response> {
  return criarHandlerApp(PERFIL, cfg);
}
