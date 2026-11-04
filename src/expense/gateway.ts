import {
  type ConfigApp,
  criarHandlerApp,
  type DependenciasApp,
  type PerfilApp,
  processarApp,
  type RequisicaoApp,
  rotaDaFuncao,
} from '../core/gateway-app.ts';
import type { ModuloSankhya, RespostaGateway } from '../core/tipos.ts';

export { validadorPeloAuth } from '../auth/supabase-auth.ts';
export { cnpjDoUsuarioNoSupabase, cnpjValido, limitadorPublico, origemDe } from '../core/gateway-app.ts';

// Gateway do Loop Expense: o app deixa de ler credenciais e de falar direto com o Sankhya. O Add-on
// continua conferindo o login pelo sessaoToken (JWT do Supabase) e decide o que cada um pode fazer.
// Docs: loop-expense/docs/07_API_E_CONTRATOS.md e loop-admin/docs/licenciamento/06-MODELO-PARA-OUTROS-APPS.md.

export const MODULO_EXPENSE: ModuloSankhya = 'loop-expense';
export const PRODUTO_EXPENSE = 'LoopExpense';

/** Só os serviços do Add-on do Expense. Nada de SQL livre, CRUD genérico ou serviço nativo do Sankhya. */
const SERVICO_EXPENSE = /^LoopExpense[A-Za-z]+SP\.do[A-Za-z]+$/;

const PERFIL: PerfilApp = {
  funcao: 'expense-gateway',
  modulo: MODULO_EXPENSE,
  produto: PRODUTO_EXPENSE,
  servicoPermitido: (serviceName) => SERVICO_EXPENSE.test(serviceName),
  /** Antes de existir a conta: confere se o e-mail está cadastrado na empresa escolhida. */
  publicos: new Set(['LoopExpenseSessaoSP.doVerificarCadastro']),
  /** Aprovar com nota espera o Sankhya gravar e confirmar: o prazo padrão não basta. */
  timeoutMs: 90_000,
};

export type DependenciasExpense = DependenciasApp;
export type RequisicaoExpense = RequisicaoApp;
export type ConfigExpense = ConfigApp;

export function processarExpense(req: RequisicaoExpense, deps: DependenciasExpense): Promise<RespostaGateway> {
  return processarApp(PERFIL, req, deps);
}

export function criarHandlerExpense(cfg: ConfigExpense): (req: Request) => Promise<Response> {
  return criarHandlerApp(PERFIL, cfg);
}

/** /functions/v1/expense-gateway/servico → /servico. */
export function rotaExpense(pathname: string): string {
  return rotaDaFuncao(PERFIL.funcao, pathname);
}
