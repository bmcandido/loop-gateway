import { codEmpDoClienteNoSupabase, jwsDoDominioNoSupabase } from '../core/icone.ts';
import { validadorCombinado } from '../auth/combinado.ts';
import { validadorFirebase } from '../auth/firebase.ts';
import { validadorPeloAuth } from '../auth/supabase-auth.ts';
import { assinadorV2, chavePrivadaGateway, type AssinadorIdentidade } from '../core/assinatura.ts';
import { credenciaisDoSupabase } from '../core/credenciais.ts';
import { type DependenciasGateway, desembrulhar, processar } from '../core/gateway.ts';
import { type ChaveLicenca, verificadorPorProduto } from '../core/licenca-app.ts';
import { licencaDoSupabase } from '../core/licenca.ts';
import { type ConfigLoopApi, processarLoopApi } from '../core/loopapi.ts';
import { porCliente } from '../core/por-cliente.ts';
import { SankhyaCliente } from '../core/sankhya.ts';
import { type ProdutoGateway, regraDoServico } from '../core/servicos.ts';
import { vendedorPorEmail } from '../core/vendedor.ts';
import type { EventoGateway, PortaSankhya, ValidadorToken } from '../core/tipos.ts';

// Gateway ÚNICO dos apps Loop em HTTP padrão (Request → Response). Roda na Edge Function do
// Supabase (padrão) e nos testes em Node. Nada é configurado por cliente: o cliente vem da licença
// assinada (X-Loop-Licenca). Docs: loop-admin/docs/licenciamento/.

export interface ConfigGateway {
  /** URL do projeto Supabase (na Edge Function: SUPABASE_URL, automático). */
  supabaseUrl: string;
  /** Chave de serviço do Supabase (na Edge Function: SUPABASE_SERVICE_ROLE_KEY, automático). */
  supabaseChave: string;
  /** PKCS#8 PEM da chave do gateway (segredo PORTAL_GATEWAY_CHAVE_PRIVADA). */
  chavePrivada: string;
  kid: string;
  /** Projetos Firebase aceitos (clientes legados). Vazio = só Supabase Auth. */
  projetosFirebase?: string[];
  /** Origens permitidas (CORS). Vazio = qualquer origem (não há cookie). */
  origensWeb?: string[];
  exigirEmailVerificado?: boolean;
  registrar?: (e: EventoGateway) => void;
  /** Loop API (Evolution): token único e segredo das chaves. Vazio = rota responde 503. */
  loopApi?: ConfigLoopApi;
  /** Só testes: chaves públicas de licença (padrão: as de produção). */
  chavesLicenca?: ChaveLicenca[];
  /** Só testes: troca validador/Sankhya. */
  sobrescrever?: Partial<Pick<DependenciasGateway, 'validador' | 'sankhya' | 'licenca'>>;
}

export function criarHandler(cfg: ConfigGateway): (req: Request) => Promise<Response> {
  const supabase = { url: cfg.supabaseUrl, chave: cfg.supabaseChave };
  const licencaDoApp = cfg.chavesLicenca ? verificadorPorProduto(cfg.chavesLicenca) : verificadorPorProduto();
  const licenca = porCliente((chave) => {
    const [cnpj, produto] = chave.split('|');
    return licencaDoSupabase({ ...supabase, cnpj, produto });
  });
  const sankhya = porCliente((cnpj) => new SankhyaCliente(credenciaisDoSupabase({ ...supabase, cnpj })));
  const projetos = (cfg.projetosFirebase ?? []).filter(Boolean);
  // A confirmação de e-mail é decidida por cliente em processar(), com a configuração do Add-on.
  const validador: ValidadorToken = validadorCombinado(
    validadorPeloAuth({ url: cfg.supabaseUrl, chave: cfg.supabaseChave }),
    projetos.length ? validadorFirebase(projetos, { exigirEmailVerificado: false }) : undefined,
  );
  // PORTAL_EXIGE_EMAIL_VERIFICADO=false desliga para todos; senão vale a chave de cada cliente.
  const exigeEmailConfirmado = cfg.exigirEmailVerificado === false
    ? async () => false
    : exigenciaDoPortal(exigenciaDeEmailPorCliente((cnpj) => sankhya(cnpj)));
  const vendedorAtivo = vendedorPorEmail((cnpj) => sankhya(cnpj));
  const jwsDoDominio = jwsDoDominioNoSupabase(supabase);
  const codEmpDoCliente = codEmpDoClienteNoSupabase(supabase);
  const origens = (cfg.origensWeb ?? []).filter(Boolean);
  let assinar: Promise<AssinadorIdentidade> | undefined;

  return async (req) => {
    const origem = req.headers.get('origin');
    const cors: Record<string, string> = {};
    if (origem) {
      if (origens.length && !origens.includes(origem)) return json(403, { status: '0', statusMessage: 'Origem não autorizada.' });
      cors['Access-Control-Allow-Origin'] = origem;
      cors.Vary = 'Origin';
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'Access-Control-Allow-Methods': 'GET, POST',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Loop-Licenca, apikey, x-client-info',
            'Access-Control-Max-Age': '3600',
          },
        });
      }
    }

    // Chamada de servidor para servidor (Add-on do WhatsApp): não usa licença do app nem login.
    const caminho = rota(new URL(req.url).pathname);
    if (caminho.startsWith('/loopapi/')) {
      const r = await processarLoopApi(
        {
          metodo: req.method,
          caminho: caminho.slice('/loopapi'.length),
          chave: req.headers.get('apikey'),
          corpo: req.method === 'POST' ? await req.text() : undefined,
        },
        {
          config: cfg.loopApi ?? { url: '', token: '', segredo: '' },
          licenca: (cnpj) => licenca(`${cnpj}|LoopWhatsApp`)(),
          registrar: cfg.registrar,
        },
      );
      return new Response(r.corpo, { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }

    assinar ??= chavePrivadaGateway(cfg.chavePrivada).then((k) => assinadorV2(k, cfg.kid));
    let assinador: AssinadorIdentidade;
    try {
      assinador = await assinar;
    } catch {
      assinar = undefined;
      cfg.registrar?.({ rota: '-', status: 500, ms: 0, codigo: 'GATEWAY_SEM_CHAVE' });
      return json(500, { status: '0', statusMessage: 'Gateway do portal não configurado.', codigoGateway: 'GATEWAY_SEM_CHAVE' }, cors);
    }

    let corpo: unknown = null;
    if (req.method === 'POST') {
      try {
        corpo = await req.json();
      } catch {
        corpo = null;
      }
    }

    const resposta = await processar(
      {
        metodo: req.method,
        caminho: rota(new URL(req.url).pathname),
        authorization: req.headers.get('authorization'),
        licenca: req.headers.get('x-loop-licenca'),
        corpo,
      },
      {
        validador,
        licencaDoApp,
        jwsDoDominio,
        codEmpDoCliente,
        licenca: (cnpj, produto = 'LoopPortal') => licenca(`${cnpj}|${produto}`)(),
        sankhya,
        assinar: assinador,
        exigeEmailConfirmado,
        vendedorAtivo,
        registrar: cfg.registrar,
        ...cfg.sobrescrever,
      },
    );
    return json(resposta.status, resposta.corpo, cors);
  };
}

const CACHE_EXIGENCIA_MS = 5 * 60 * 1000;

/**
 * Lê "Exigir confirmação de e-mail no login" (LOOPPORTALCFG.EXIGECONFEMAIL) pelo
 * LoopPortalAppSP.consultarConfig do cliente, com cache de 5 min por CNPJ. Qualquer
 * falha ou valor diferente de "N" = exige (padrão seguro).
 */
export function exigenciaDeEmailPorCliente(
  sankhyaDe: (cnpj: string) => PortaSankhya,
  agora: () => number = Date.now,
): (cnpj: string) => Promise<boolean> {
  const cache = new Map<string, { em: number; exige: boolean }>();
  return async (cnpj) => {
    const c = cache.get(cnpj);
    if (c && agora() - c.em < CACHE_EXIGENCIA_MS) return c.exige;
    let exige = true;
    try {
      const envelope = await sankhyaDe(cnpj).chamar('LoopPortalAppSP.consultarConfig', regraDoServico('LoopPortalAppSP.consultarConfig')!.modulo, {});
      exige = valorExigeConfEmail(desembrulhar(envelope)) !== 'N';
    } catch {
      exige = true;
    }
    cache.set(cnpj, { em: agora(), exige });
    return exige;
  };
}

function valorExigeConfEmail(v: unknown, prof = 0): string | undefined {
  if (!v || typeof v !== 'object' || prof > 6) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.exigeConfEmail === 'string') return o.exigeConfEmail.trim().toUpperCase();
  for (const k of Object.keys(o)) {
    const r = valorExigeConfEmail(o[k], prof + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Só o Portal tem a opção no Add-on; nos demais produtos o e-mail confirmado é sempre exigido. */
function exigenciaDoPortal(portal: (cnpj: string) => Promise<boolean>) {
  return (cnpj: string, produto: ProdutoGateway = 'LoopPortal') =>
    produto === 'LoopPortal' ? portal(cnpj) : Promise.resolve(true);
}

/**
 * Caminho sem o prefixo da plataforma: /functions/v1/portal-gateway/servico (Supabase) ou
 * /portalGateway/servico → /servico.
 */
export function rota(pathname: string): string {
  const p = pathname.replace(/\/+$/, '');
  const m = /\/(?:portal-gateway|portalGateway)(\/.*)?$/.exec(p);
  return (m ? m[1] : p) || '/';
}

function json(status: number, corpo: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}
