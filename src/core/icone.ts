import { desembrulhar } from './desembrulhar.ts';
import { type ProdutoGateway, regraDoServico } from './servicos.ts';
import { ErroGateway, type PortaSankhya, type RespostaGateway } from './tipos.ts';

const DOMINIO = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const IMAGEM = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
const TIMEOUT_MS = 15_000;

export interface OpcoesDominio {
  /** URL do projeto (https://<ref>.supabase.co). */
  url: string;
  /** Chave secreta (service_role ou sb_secret_...). Só no servidor. */
  chave: string;
  http?: typeof fetch;
}

/** JWS da licença cadastrada no Loop Mais para o domínio do site; null se não houver. */
export function jwsDoDominioNoSupabase(op: OpcoesDominio): (dominio: string) => Promise<string | null> {
  const http = op.http ?? fetch;
  const headers: Record<string, string> = { apikey: op.chave, 'Content-Type': 'application/json' };
  if (!op.chave.startsWith('sb_')) headers.Authorization = `Bearer ${op.chave}`;
  return async (dominio) => {
    const r = await http(`${op.url.replace(/\/+$/, '')}/rest/v1/rpc/licenca_do_dominio`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_dominio: dominio }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const jws = (await r.json()) as unknown;
    return typeof jws === 'string' && jws ? jws : null;
  };
}

/** Empresa principal do cliente (clientes.codEmpresaCadastroPrinciapal); null se não houver. */
export function codEmpDoClienteNoSupabase(op: OpcoesDominio): (cnpj: string) => Promise<number | null> {
  const http = op.http ?? fetch;
  const headers: Record<string, string> = { apikey: op.chave, Accept: 'application/json' };
  if (!op.chave.startsWith('sb_')) headers.Authorization = `Bearer ${op.chave}`;
  return async (cnpj) => {
    const qs = new URLSearchParams({ select: 'codEmpresaCadastroPrinciapal', cpfCnpj: `eq.${cnpj}`, limit: '1' });
    const r = await http(`${op.url.replace(/\/+$/, '')}/rest/v1/clientes?${qs}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const linhas = (await r.json()) as { codEmpresaCadastroPrinciapal?: unknown }[];
    const codEmp = Number(linhas?.[0]?.codEmpresaCadastroPrinciapal);
    return Number.isInteger(codEmp) && codEmp > 0 ? codEmp : null;
  };
}

export interface DependenciasIcone {
  jwsDoDominio?: (dominio: string) => Promise<string | null>;
  licencaDoApp: (jws: string | null | undefined, produto?: ProdutoGateway) => Promise<{ cnpj: string }>;
  licenca: (cnpj: string, produto?: ProdutoGateway) => Promise<void>;
  sankhya: (cnpj: string) => PortaSankhya;
  codEmpDoCliente?: (cnpj: string) => Promise<number | null>;
}

/**
 * Ícone da Identidade Visual do cliente, para o Dev Manager gravar no site ao publicar.
 * Rota pública: devolve só a imagem, que o site já mostra a qualquer visitante, e o cliente
 * vem da licença do domínio, nunca do corpo. Mesma ordem do app: favicon, logo reduzida, logo.
 */
export async function iconeDoDominio(
  corpo: unknown,
  deps: DependenciasIcone,
  produto: ProdutoGateway = 'LoopPortal',
): Promise<RespostaGateway & { cnpj?: string }> {
  const bruto = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>).dominio : undefined;
  const dominio = typeof bruto === 'string' ? bruto.trim().toLowerCase() : '';
  if (!DOMINIO.test(dominio)) {
    throw new ErroGateway(400, 'DOMINIO_INVALIDO', 'Domínio inválido.');
  }
  const jws = await deps.jwsDoDominio?.(dominio);
  if (!jws) {
    throw new ErroGateway(404, 'DOMINIO_SEM_LICENCA', 'Este domínio não tem licença no Loop Mais.');
  }
  const { cnpj } = await deps.licencaDoApp(jws, produto);
  await deps.licenca(cnpj, produto);

  const porta = deps.sankhya(cnpj);
  const dados = async (servico: string, body: Record<string, unknown>) => {
    const envelope = desembrulhar(await porta.chamar(servico, regraDoServico(servico)!.modulo, body));
    const resposta = envelope?.responseBody;
    return resposta?.success === true && resposta.data && typeof resposta.data === 'object' ? resposta.data : null;
  };

  if (produto === 'LoopEcommerce') {
    // Logo da loja (LOOPB2BB2CCONFIG), da empresa principal do cliente.
    const codEmp = await deps.codEmpDoCliente?.(cnpj);
    if (!codEmp) return { status: 200, corpo: { imagem: null }, cnpj };
    const loja = await dados('LoopEcommerceConfigSP.doLojaPublica', { codEmp });
    const logo = loja?.logo;
    return { status: 200, corpo: { imagem: typeof logo === 'string' && IMAGEM.test(logo) ? logo : null }, cnpj };
  }

  if (produto === 'LoopPaymentLink') {
    // Favicon ou logo da Identidade Visual (LOOPPAYMENTLINKCONFIG), da empresa principal do cliente.
    const codEmp = await deps.codEmpDoCliente?.(cnpj);
    if (!codEmp) return { status: 200, corpo: { imagem: null }, cnpj };
    const visual = await dados('LoopPaymentLinkPublicoSP.doIcone', { codEmp });
    const imagem = [visual?.favicon, visual?.logo].find((v) => typeof v === 'string' && IMAGEM.test(v));
    return { status: 200, corpo: { imagem: imagem ?? null }, cnpj };
  }

  const config = await dados('LoopPortalAppSP.consultarConfig', {});
  const codCfg = Number(config?.codCfg);
  if (!Number.isInteger(codCfg) || codCfg <= 0) {
    return { status: 200, corpo: { imagem: null }, cnpj };
  }
  const visual = await dados('LoopPortalVisualSP.doConsultar', { codCfg });
  const imagem = [visual?.favicon, visual?.logoReduzida, visual?.logoPrincipal]
    .find((v) => typeof v === 'string' && IMAGEM.test(v));
  return { status: 200, corpo: { imagem: imagem ?? null }, cnpj };
}
