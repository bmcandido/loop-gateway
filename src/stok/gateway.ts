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
// Serviço só entra na lista depois de identificar a pessoa pelo sessaoToken: enquanto confiar no codUsu do corpo,
// qualquer usuário da empresa poderia agir em nome de outro.
// Docs: loop_stok/docs/gateway/01-migracao-para-stok-gateway.md.

export const PRODUTO_STOK = 'LoopStok';

/** Antes de existir a conta: confere se o e-mail está cadastrado na empresa escolhida. */
const PUBLICOS = new Set(['LoopStokUsuariosSP.doVerificarCadastro']);

const LIBERADOS = new Set([...PUBLICOS, 'LoopStokUsuariosSP.doBuscarFoto', 'LoopStokUsuariosSP.doMeuCadastro']);

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
