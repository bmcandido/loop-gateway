import { ErroGateway } from './tipos.ts';

// Licença que o app envia no cabeçalho X-Loop-Licenca: o JWS (campo "assinatura") do licenca.json
// gerado pelo Loop Mais. Mesma regra do app (lib/config/licenca_assinatura.dart): só ES256, só chave
// conhecida, e só o conteúdo assinado vale. É daqui que o gateway único tira o CNPJ do cliente.

/** Chave pública (EC P-256) do Loop Mais, como embarcada no app. */
export interface ChaveLicenca {
  kid: string;
  x: string;
  y: string;
}

/** Geradas por scripts/gerar-chave-licenca.js no Loop Mais. Nova chave entra aqui ANTES de assinar com ela. */
export const CHAVES_LICENCA: ChaveLicenca[] = [
  { kid: 'loop-licenca-2026-10', x: '181ck9F06IRM0lXmTGeZqbgW6A_gR_NmwVTnQrCZi2A', y: 'tcJ5EKCniSYQBBZk8c56yYh2xUrlJybMEjyRYgadfko' },
];

/** Produto aceito: id em LOOP.loop_produtos_contratos e/ou slug (licenças antigas). */
export interface ProdutoAceito {
  ids: string[];
  slug: string;
}

/** Loop Portal (Portal do Cliente). */
export const PRODUTO_PORTAL: ProdutoAceito = { ids: ['dbd544b3-0bc2-40f3-9001-639ce339541e'], slug: 'LoopPortal' };

export interface LicencaDoApp {
  cnpj: string;
}

const TYP = 'loop-licenca+jws';
const STATUS_INATIVOS = new Set(['cancelado', 'inativo', 'suspenso', 'encerrado']);
const TAMANHO_MAXIMO = 16_384;

const invalida = () => new ErroGateway(403, 'LICENCA_INVALIDA', 'Licença do app inválida. Atualize a página ou fale com a administradora.');

function b64url(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Devolve a função que confere o JWS da licença. Chaves importadas uma vez; resultado por JWS
 * fica em cache (a mesma licença chega em toda chamada do app).
 */
export function verificadorLicencaDoApp(chaves: ChaveLicenca[] = CHAVES_LICENCA, produto: ProdutoAceito = PRODUTO_PORTAL) {
  const importadas = new Map<string, Promise<CryptoKey>>();
  const chave = (c: ChaveLicenca) => {
    let k = importadas.get(c.kid);
    if (!k) {
      k = crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: c.x, y: c.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      importadas.set(c.kid, k);
    }
    return k;
  };
  const cache = new Map<string, LicencaDoApp>();

  return async (jws: string | null | undefined): Promise<LicencaDoApp> => {
    if (!jws) throw new ErroGateway(401, 'LICENCA_AUSENTE', 'Licença do app não enviada. Atualize a página.');
    const texto = jws.trim();
    const pronto = cache.get(texto);
    if (pronto) return pronto;
    if (texto.length > TAMANHO_MAXIMO) throw invalida();

    const partes = texto.split('.');
    if (partes.length !== 3) throw invalida();
    let cabecalho: Record<string, unknown>;
    let conteudo: Record<string, unknown>;
    let sig: Uint8Array;
    try {
      cabecalho = JSON.parse(new TextDecoder().decode(b64url(partes[0])));
      conteudo = JSON.parse(new TextDecoder().decode(b64url(partes[1])));
      sig = b64url(partes[2]);
    } catch {
      throw invalida();
    }
    // Só ES256 e só chave conhecida: nunca o algoritmo que o arquivo pedir.
    if (cabecalho.alg !== 'ES256' || cabecalho.typ !== TYP || sig.length !== 64) throw invalida();
    const c = chaves.find((k) => k.kid === cabecalho.kid);
    if (!c) throw invalida();
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await chave(c),
      sig,
      new TextEncoder().encode(`${partes[0]}.${partes[1]}`),
    );
    if (!ok || conteudo.ver !== 1) throw invalida();

    const empresa = conteudo.empresa as Record<string, unknown> | undefined;
    const cnpj = String(empresa?.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) throw invalida();

    const lic = conteudo.licenca as Record<string, unknown> | undefined;
    const status = String(lic?.status ?? '').trim().toLowerCase();
    const produtos = Array.isArray(lic?.produtos) ? (lic!.produtos as Record<string, unknown>[]) : [];
    const temProduto = produtos.some(
      (p) => p && p.active !== false && (produto.ids.includes(String(p.produto_id ?? '').toLowerCase()) || p.slug === produto.slug),
    );
    if (STATUS_INATIVOS.has(status) || !temProduto) {
      throw new ErroGateway(403, 'LICENCA_INATIVA', 'Portal sem licença ativa. Entre em contato com a administradora.');
    }

    const r = { cnpj };
    if (cache.size > 500) cache.clear();
    cache.set(texto, r);
    return r;
  };
}
