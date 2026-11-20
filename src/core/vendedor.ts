import { desembrulhar } from './desembrulhar.ts';
import { ErroGateway, type PortaSankhya } from './tipos.ts';

const CACHE_MS = 60 * 1000;
/** Uma nova tentativa antes de responder "não foi possível confirmar o vendedor". */
const TENTATIVAS = 2;

/** Motivo do Sankhya para o log: sem e-mail, sem texto entre aspas (trecho do SQL) e curto. */
export function motivoSankhya(r: unknown): string {
  const o = (r && typeof r === 'object' ? r : {}) as { status?: unknown; statusMessage?: unknown };
  const msg = String(o.statusMessage ?? '')
    .replace(/[^\s@'"]+@[^\s@'"]+/g, '<email>')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return `status ${String(o.status ?? '?')}${msg ? `: ${msg}` : ''}`;
}
/**
 * Só ASCII: em maiúsculas, "ı" e "ſ" viram "I" e "S", e um domínio parecido (lınk.com) casaria com o
 * e-mail de um vendedor de link.com. Também impede aspas no SQL.
 */
const EMAIL = /^[\x21-\x26\x28-\x3f\x41-\x7e]{1,64}@[\x21-\x26\x28-\x3f\x41-\x7e]{1,190}$/;

/**
 * Vendedor ativo pelo e-mail do login, na mesma regra do Add-on (VendedorSessao): usuário ativo do
 * Loop Ecommerce com vendedor ativo em TSIUSU.CODVEND. Resultado guardado por 1 min, por cliente.
 * Falha na consulta não vira "não é vendedor": o erro volta como indisponibilidade.
 */
export function vendedorPorEmail(sankhyaDe: (cnpj: string) => PortaSankhya, agora: () => number = Date.now) {
  const cache = new Map<string, { ate: number; ativo: boolean }>();
  // Telas que disparam várias consultas juntas (ex.: detalhe do produto) dividem a mesma conferência.
  const emAndamento = new Map<string, Promise<boolean>>();
  return async (cnpj: string, email: string): Promise<boolean> => {
    const limpo = email.trim();
    if (!EMAIL.test(limpo)) return false;
    const normalizado = limpo.toUpperCase();
    const chave = `${cnpj}|${normalizado}`;
    const c = cache.get(chave);
    if (c && agora() < c.ate) return c.ativo;
    const andamento = emAndamento.get(chave);
    if (andamento) return andamento;
    const consulta = conferir(cnpj, normalizado, chave).finally(() => emAndamento.delete(chave));
    emAndamento.set(chave, consulta);
    return consulta;
  };

  async function conferir(cnpj: string, normalizado: string, chave: string): Promise<boolean> {

    const sql =
      'SELECT 1 AS OK FROM TSIUSU U INNER JOIN LOOPB2BB2CUSERS US ON US.CODUSU = U.CODUSU ' +
      'INNER JOIN TGFVEN V ON V.CODVEND = U.CODVEND LEFT JOIN TGFPAR P ON P.CODPARC = NVL(V.CODPARC, U.CODPARC) ' +
      `WHERE '${normalizado}' IN (UPPER(US.EMAIL), UPPER(U.EMAIL), UPPER(V.EMAIL), UPPER(P.EMAIL)) ` +
      "AND V.ATIVO = 'S' AND NVL(US.ATIVO, 'N') = 'S' AND U.CODUSU <> 0 AND ROWNUM = 1";
    type Resposta = { status?: unknown; statusMessage?: unknown; responseBody?: { rows?: unknown } };
    let r: Resposta | undefined;
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      r = desembrulhar(await sankhyaDe(cnpj).chamar('DbExplorerSP.executeQuery', 'mge', { sql })) as Resposta;
      if (String(r?.status ?? '') === '1') break;
    }
    if (String(r?.status ?? '') !== '1') {
      throw new ErroGateway(
        502,
        'VENDEDOR_INDISPONIVEL',
        'Não foi possível confirmar o vendedor. Tente novamente.',
        `conferência do vendedor: ${motivoSankhya(r)}`,
      );
    }
    const ativo = Array.isArray(r!.responseBody?.rows) && (r!.responseBody!.rows as unknown[]).length > 0;
    if (cache.size >= 2000) cache.delete(cache.keys().next().value as string);
    cache.set(chave, { ate: agora() + CACHE_MS, ativo });
    return ativo;
  }
}
