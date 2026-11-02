import { desembrulhar } from './desembrulhar.ts';
import { ErroGateway, type PortaSankhya } from './tipos.ts';

const CACHE_MS = 60 * 1000;
const EMAIL = /^[^\s@']{1,64}@[^\s@']{1,190}$/;

/**
 * Vendedor ativo pelo e-mail do login, na mesma regra do Add-on (VendedorSessao): usuário ativo do
 * Loop Ecommerce com vendedor ativo em TSIUSU.CODVEND. Resultado guardado por 1 min, por cliente.
 * Falha na consulta não vira "não é vendedor": o erro volta como indisponibilidade.
 */
export function vendedorPorEmail(sankhyaDe: (cnpj: string) => PortaSankhya, agora: () => number = Date.now) {
  const cache = new Map<string, { ate: number; ativo: boolean }>();
  return async (cnpj: string, email: string): Promise<boolean> => {
    const normalizado = email.trim().toUpperCase();
    if (!EMAIL.test(normalizado)) return false;
    const chave = `${cnpj}|${normalizado}`;
    const c = cache.get(chave);
    if (c && agora() < c.ate) return c.ativo;

    const sql =
      'SELECT 1 AS OK FROM TSIUSU U INNER JOIN LOOPB2BB2CUSERS US ON US.CODUSU = U.CODUSU ' +
      'INNER JOIN TGFVEN V ON V.CODVEND = U.CODVEND LEFT JOIN TGFPAR P ON P.CODPARC = NVL(V.CODPARC, U.CODPARC) ' +
      `WHERE '${normalizado}' IN (UPPER(US.EMAIL), UPPER(U.EMAIL), UPPER(V.EMAIL), UPPER(P.EMAIL)) ` +
      "AND V.ATIVO = 'S' AND NVL(US.ATIVO, 'N') = 'S' AND U.CODUSU <> 0 AND ROWNUM = 1";
    const r = desembrulhar(await sankhyaDe(cnpj).chamar('DbExplorerSP.executeQuery', 'mge', { sql })) as {
      status?: unknown;
      responseBody?: { rows?: unknown };
    };
    if (String(r?.status ?? '') !== '1') {
      throw new ErroGateway(502, 'VENDEDOR_INDISPONIVEL', 'Não foi possível confirmar o vendedor. Tente novamente.');
    }
    const ativo = Array.isArray(r.responseBody?.rows) && r.responseBody.rows.length > 0;
    if (cache.size >= 2000) cache.delete(cache.keys().next().value as string);
    cache.set(chave, { ate: agora() + CACHE_MS, ativo });
    return ativo;
  };
}
