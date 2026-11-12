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
  // Avisos e push: o Add-on identifica o motorista pelo sessaoToken (codUsu do corpo é ignorado)
  'LoopDeliveryMensagensSP.doInbox',
  'LoopDeliveryMensagensSP.doContador',
  'LoopDeliveryMensagensSP.doDetalhe',
  'LoopDeliveryMensagensSP.doMarcarLida',
  'LoopDeliveryMensagensSP.doMarcarTodasLidas',
  'LoopDeliveryMensagensSP.doRegistrarDispositivo',
  'LoopDeliveryMensagensSP.doDesativarDispositivo',
  // Viagem. O Add-on confere o dono pelo sessaoToken: ordem/nota/cliente de outro motorista é recusado
  'LoopDeliveryTrackingSP.doRegistrarPosicoes',
  'LoopDeliveryAnexoNotaSP.doAnexarArquivo',
  'LoopDeliveryAnexoNotaSP.doListarAnexos',
  'LoopDeliveryGeocodificacaoSP.doGarantirCoordenadas',
  'LoopDeliveryFormacaoCargasSP.doRevisaoApp',
  'LoopDeliveryFormacaoCargasSP.doMapaCargaApp',
  'LoopDeliveryFormacaoCargasSP.doPosicaoCargaApp',
  'LoopDeliveryFormacaoCargasSP.doResponderRevisao',
  'LoopDeliveryAdiantamentoSP.doSolicitarAdiantamento',
  'LoopDeliveryAdiantamentoSP.doListarAdiantamentos',
  // Fila da entrega (status, conferência, recebedor, anexo, recebimento e devolução), idempotente
  'LoopDeliveryEntregaAppSP.doAppRegistrarEvento',
  'LoopDeliveryEntregaAppSP.doAppConferenciaLote',
  'LoopDeliveryEntregaAppSP.doAppAnexar',
  'LoopDeliveryEntregaAppSP.doAppRecebimento',
  'LoopDeliveryEntregaAppSP.doAppFaturarDevolucao',
  // Nota de faturamento da conferencia (produto incluido ou a mais): TOP e cliente decididos no Add-on, idempotente por UUID
  'LoopDeliveryEntregaAppSP.doAppIncluirNotaConferencia',
  // Prestação de contas da viagem (reabrir é da gestão e fica fora)
  'LoopDeliveryAdiantamentoSP.doConsultarPrestacaoDespesa',
  'LoopDeliveryAdiantamentoSP.doIniciarEnvioPrestacao',
  'LoopDeliveryAdiantamentoSP.doConcluirEnvioPrestacao',
  // Checklist, apoio e pânico
  'LoopDeliveryChecklistSP.doAppChecklistsDaViagem',
  'LoopDeliveryChecklistSP.doAppAutorizacao',
  'LoopDeliveryChecklistSP.doAppEnviarFoto',
  'LoopDeliveryChecklistSP.doAppEnviar',
  'LoopDeliveryChecklistSP.doAppMeusRelatos',
  'LoopDeliveryChecklistSP.doAppCiencia',
  'LoopDeliveryChecklistSP.doAppAbrirOcorrencia',
  'LoopDeliveryChecklistSP.doAppApoio',
  'LoopDeliveryChecklistSP.doAppPanico',
  'LoopDeliveryChecklistSP.doAppCancelarPanico',
  'LoopDeliveryChecklistSP.doAppSolicitarLiberacao',
  'LoopDeliveryChecklistSP.doAppExecucao',
  // Documentos do motorista
  'LoopDeliveryDocumentosSP.doAppTipos',
  'LoopDeliveryDocumentosSP.doAppDocumentos',
  'LoopDeliveryDocumentosSP.doAppDossie',
  'LoopDeliveryDocumentosSP.doAppSalvarDocumento',
  'LoopDeliveryDocumentosSP.doAppArquivo',
  // Pneus
  'LoopDeliveryPneusSP.doAppMapaViagem',
  'LoopDeliveryPneusSP.doAppChecagem',
  'LoopDeliveryPneusSP.doAppMedir',
  // Mecânico (usuário da Oficina): mapa do veículo da OS, pneus em estoque, troca e retirada
  'LoopDeliveryPneusSP.doAppMapa',
  'LoopDeliveryPneusSP.doAppPneus',
  'LoopDeliveryPneusSP.doAppMovimentar',
  'LoopDeliveryPneusSP.doAppPneu',
  // Oficina (técnico, almoxarife, totem): o Add-on identifica o usuário pelo sessaoToken (e-mail do operador da
  // oficina -> usuário do Sankhya) e confere a função e a oficina de cada ação
  'LoopDeliveryOficinaSP.doAppPerfil',
  'LoopDeliveryOficinaSP.doAppTarefas',
  'LoopDeliveryOficinaSP.doAppTarefa',
  'LoopDeliveryOficinaSP.doAppApontar',
  'LoopDeliveryOficinaSP.doAppBuscar',
  'LoopDeliveryOficinaSP.doAppAbrirOs',
  'LoopDeliveryOficinaSP.doAppImprimirOs',
  'LoopDeliveryOficinaSP.doAppAlmoxarifado',
  'LoopDeliveryOficinaSP.doAppCracha',
  'LoopDeliveryOficinaSP.doAppEntregar',
  'LoopDeliveryOficinaSP.doAppReceberDevolucao',
  'LoopDeliveryOficinaSP.doTotemEntrar',
  'LoopDeliveryOficinaSP.doTotemSair',
  // Carregamento e conferência (carregador pelo token, permissão por empresa)
  'LoopDeliveryFormacaoCargasSP.doPerfilCarregamento',
  'LoopDeliveryFormacaoCargasSP.doOrdensParaCarregar',
  'LoopDeliveryFormacaoCargasSP.doCarregamento',
  'LoopDeliveryFormacaoCargasSP.doIniciarCarregamento',
  'LoopDeliveryFormacaoCargasSP.doMarcarItem',
  'LoopDeliveryFormacaoCargasSP.doDesfazerItem',
  'LoopDeliveryFormacaoCargasSP.doFinalizarCarregamento',
  'LoopDeliveryFormacaoCargasSP.doConferencia',
  'LoopDeliveryFormacaoCargasSP.doDecidirDivergencia',
  'LoopDeliveryFormacaoCargasSP.doConcluirConferencia',
  // Doca pelo app (motorista na doca) e mapa das docas: carregador pelo token, permissao por empresa
  'LoopDeliveryFormacaoCargasSP.doNaDocaCarregamento',
  // Chamar o motorista para a doca pelo app (como o Chamar da Portaria)
  'LoopDeliveryFormacaoCargasSP.doChamarCarregamento',
  'LoopDeliveryFormacaoCargasSP.doDocasCarregamento',
  // Mudanca de posicao no bau (pedido e autorizacao do conferente; permissao por empresa no Add-on)
  'LoopDeliveryFormacaoCargasSP.doAjustarPosicaoCarga',
  'LoopDeliveryFormacaoCargasSP.doDecidirPosicaoCarga',
  // Montagem 2.5D do bau: consulta e ajuste do carregador na doca (permissao CARREGAR por empresa no Add-on)
  'LoopDeliveryFormacaoCargasSP.doLayoutBau',
  'LoopDeliveryFormacaoCargasSP.doSalvarLayoutBau',
  // Despesas da viagem: nota/título, confirmação e comprovante no servidor, idempotente pelo id da despesa
  'LoopDeliveryDespesaAppSP.doEnviar',
  'LoopDeliveryDespesaAppSP.doConfirmarNota',
  // WhatsApp ao cliente (link de pagamento, nota em PDF): o Add-on confere o cliente da carga e repassa ao Hub
  'LoopDeliveryWhatsappSP.doEnviar',
  'LoopDeliveryWhatsappSP.doNumerosParceiro',
  // LoopSign (sessão confere a nota do motorista; o token não vai ao LoopSign)
  'LoopDeliveryConfigSP.doCriarSessaoLoopSign',
  'LoopDeliverySignWebhookSP.doConsultarStatusAnexoPorNota',
  'LoopDeliverySignWebhookSP.doObterPdfAssinado',
  'LoopDeliverySignWebhookSP.doConfirmarAnexoOficial',
  'LoopDeliverySignWebhookSP.doSincronizarAssinaturasLoopSign',
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
