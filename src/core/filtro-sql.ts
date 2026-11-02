/**
 * Filtro do SQL que a força de vendas envia ao DbExplorerSP, que roda com o usuário técnico.
 * Lista de permissão: só um SELECT, só as tabelas que o app usa, sem colunas de senha, token ou
 * chave, sem `*` direto em tabela e sem funções que executem SQL ou acessem a rede.
 *
 * É uma barreira sobre o texto do SQL e não limita as linhas: um vendedor ainda alcança dados de
 * outro vendedor. O destino é trocar cada consulta por um serviço próprio no Add-on.
 */

/** Tabelas e visões lidas pelo app (levantadas no código). */
const TABELAS: ReadonlySet<string> = new Set([
  'DUAL',
  'LOOPB2BB2CUSERS',
  'LOOPB2BB2CVISITA',
  'LOOPPAYMENTLINK',
  'LOOPPAYMENTLINKCONFIG',
  'LOOPPAYMENTLINKLOG',
  'LOOPPAYMENTLINKPAGTO',
  'LOOPSTATUSPEDIDO',
  'TCSCON',
  'TCSPRJ',
  'TDDCAM',
  'TDDOPC',
  'TGFCAB',
  'TGFCPL',
  'TGFEMP',
  'TGFEST',
  'TGFEXC',
  'TGFFIN',
  'TGFGRU',
  'TGFITE',
  'TGFLOC',
  'TGFMET',
  'TGFNAT',
  'TGFPAL',
  'TGFPAR',
  'TGFPPG',
  'TGFPRO',
  'TGFSER',
  'TGFTAB',
  'TGFTIT',
  'TGFTOP',
  'TGFTPV',
  'TGFVCS',
  'TGFVEN',
  'TGMCFG',
  'TSIBAI',
  'TSICID',
  'TSICOT',
  'TSICUS',
  'TSIEMP',
  'TSIEND',
  'TSIMOE',
  'TSIPAR',
  'TSIUFS',
  'TSIUSU',
  'VGFTAB',
]);

/** Colunas com segredo, conferidas na base (ALL_TAB_COLUMNS). */
const COLUNA_SEGREDO =
  /SENHA|SECRET|TOKEN|APIKEY|SMTPPASS|PRIVATEKEY|CERTIFICADO|^INTERNO$|^KEY(ADD)?(PRODUCAO|SANDBOX)|^CHAVEPIX|^CHAVEACESS|^CHAVEDIGITAL|CHAVECLIENTE/;

/** Comandos que não cabem em uma consulta. */
const COMANDOS: ReadonlySet<string> = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'TRUNCATE',
  'EXECUTE', 'EXEC', 'CALL', 'BEGIN', 'DECLARE', 'LOCK', 'COMMIT', 'ROLLBACK',
]);

/**
 * Funções aceitas: as que o app usa e as comuns do Oracle que só calculam. Qualquer outra chamada é
 * recusada, porque pacotes e tipos do banco podem executar SQL em texto, ler arquivos ou sair para a rede.
 */
const FUNCOES: ReadonlySet<string> = new Set([
  'ABS', 'ADD_MONTHS', 'AVG', 'CAST', 'CEIL', 'COALESCE', 'CONCAT', 'COUNT', 'DECODE', 'DENSE_RANK', 'EXTRACT',
  'FC_LOOP_SEAR_FORMPAYMENT', 'FC_LOOP_SEAR_TYPPAYMENT', 'FLOOR', 'GREATEST', 'INITCAP', 'INSTR', 'LAST_DAY', 'LEAST',
  'LENGTH', 'LISTAGG', 'LOWER', 'LPAD', 'LTRIM', 'MAX', 'MIN', 'MOD', 'MONTHS_BETWEEN', 'NULLIF', 'NVL', 'NVL2', 'RANK',
  'REPLACE', 'ROUND', 'ROW_NUMBER', 'RPAD', 'RTRIM', 'SUBSTR', 'SUM', 'TO_CHAR', 'TO_DATE', 'TO_NUMBER', 'TO_TIMESTAMP',
  'TRIM', 'TRUNC', 'UPPER',
]);

/** Palavras do SQL que podem vir antes de "(" sem serem chamada de função. */
const ANTES_DE_PARENTESE: ReadonlySet<string> = new Set([
  'ALL', 'AND', 'ANY', 'AS', 'BETWEEN', 'BY', 'CASE', 'DISTINCT', 'ELSE', 'EXISTS', 'FROM', 'GROUP', 'HAVING', 'IN', 'INTERSECT',
  'JOIN', 'LIKE', 'MINUS', 'NOT', 'ON', 'OR', 'OVER', 'SELECT', 'SOME', 'THEN', 'UNION', 'USING', 'WHEN', 'WHERE',
]);

/** Só estas funções têm FROM entre os argumentos: EXTRACT(ANO FROM data), TRIM(x FROM y). */
const FUNCOES_COM_FROM: ReadonlySet<string> = new Set(['EXTRACT', 'TRIM']);

/** Palavras que encerram a cláusula FROM. */
const FIM_DO_FROM: ReadonlySet<string> = new Set([
  'WHERE', 'GROUP', 'ORDER', 'HAVING', 'UNION', 'MINUS', 'INTERSECT', 'CONNECT', 'START', 'FETCH', 'OFFSET', 'FOR', 'MODEL',
]);

/** Comandos e formas de junção que trazem origens que não conferimos. */
const PROIBIDAS: ReadonlySet<string> = new Set(['APPLY', 'LATERAL', 'TABLE', 'CURSOR', 'MULTISET', 'CONTAINERS', 'SHARDS', 'FUNCTION', 'PROCEDURE']);

type Token = { t: 'id' | 'num' | 'txt' | 'sim'; v: string };

/** null = aceito; texto = motivo da recusa (vai para o log, sem o SQL). */
export function motivoRecusaSql(sql: unknown): string | null {
  if (typeof sql !== 'string' || !sql.trim()) return 'SQL ausente';
  if (sql.length > 200_000) return 'SQL grande demais';

  const tokens = tokenizar(sql);
  if (typeof tokens === 'string') return tokens;
  if (tokens.length === 0 || !['SELECT', 'WITH'].includes(tokens[0].v)) return 'não começa com SELECT';

  for (let i = 0; i < tokens.length; i++) {
    const { t, v } = tokens[i];
    if (t !== 'id') continue;
    if (COMANDOS.has(v)) return `comando ${v}`;
    if (PROIBIDAS.has(v)) return `palavra ${v}`;
    if (COLUNA_SEGREDO.test(v)) return `coluna ${v}`;
    if (tokens[i + 1]?.v === '.' && tokens[i + 2]?.t === 'id' && tokens[i + 3]?.v === '(') return `função ${v}.${tokens[i + 2].v}`;
  }

  const fim = fechamentos(tokens);
  if (typeof fim === 'string') return fim;
  const ctes = lerCtes(tokens, fim);
  if (typeof ctes === 'string') return ctes;
  return conferirFuncoes(tokens, ctes) ?? conferirOrigens(tokens, fim, ctes) ?? conferirEstrelas(tokens, fim);
}

function tokenizar(sql: string): Token[] | string {
  // Só as letras ASCII: toUpperCase() transformaria "ı" em "I" e esconderia o caractere.
  const s = sql.replace(/[a-z]/g, (c) => c.toUpperCase());
  const r: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    // Só os espaços que o Oracle reconhece; NBSP e afins caem como caractere fora do padrão.
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f') {
      i++;
    } else if (c === "'") {
      i++;
      for (;;) {
        if (i >= s.length) return 'texto sem fechamento';
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      r.push({ t: 'txt', v: '' });
    } else if (c === '"') {
      return 'identificador entre aspas';
    } else if (c === ';') {
      if (s.slice(i + 1).trim()) return 'mais de um comando';
      i++;
    } else if (c === '@') {
      return 'acesso a outro banco';
    } else if (c === '-' && s[i + 1] === '-') {
      // A tela de vendas comenta as colunas. Termina na primeira quebra de qualquer tipo: se o
      // Oracle ler mais como comentário, aqui só foi conferido texto a mais, nunca a menos.
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
    } else if (c === '/' && s[i + 1] === '*') {
      return 'comentário de bloco no SQL';
    } else if (/[A-Z_]/.test(c)) {
      const m = /^[A-Z_][A-Z0-9_$#]*/.exec(s.slice(i, i + 128))!;
      // q'[...]' muda o delimitador de texto e confundiria a leitura.
      if (['Q', 'NQ'].includes(m[0]) && s[i + m[0].length] === "'") return 'texto com delimitador alternativo';
      r.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9.]+/.exec(s.slice(i, i + 64))!;
      r.push({ t: 'num', v: m[0] });
      i += m[0].length;
    } else if (c.charCodeAt(0) > 126) {
      return 'caractere fora do padrão';
    } else {
      r.push({ t: 'sim', v: c });
      i++;
    }
  }
  return r;
}

/** Para cada "(", o índice do ")" correspondente. */
function fechamentos(tokens: Token[]): Map<number, number> | string {
  const fim = new Map<number, number>();
  const pilha: number[] = [];
  tokens.forEach((k, i) => {
    if (k.v === '(' && k.t === 'sim') pilha.push(i);
    if (k.v === ')' && k.t === 'sim' && pilha.length) fim.set(pilha.pop()!, i);
  });
  return pilha.length || tokens.filter((k) => k.t === 'sim' && k.v === ')').length !== fim.size ? 'parênteses sem par' : fim;
}

/**
 * WITH só no início da consulta. Cada nome vale depois da própria definição, e o escopo é conferido
 * pela posição: um WITH aninhado poderia liberar o nome de uma tabela real em outra parte do SQL.
 * Devolve nome -> índice a partir do qual o nome vale.
 */
function lerCtes(tokens: Token[], fim: Map<number, number>): Map<string, number> | string {
  const ctes = new Map<string, number>();
  const comWith = tokens.findIndex((k, i) => i > 0 && k.t === 'id' && k.v === 'WITH');
  if (comWith >= 0) return 'WITH fora do início';
  if (tokens[0].v !== 'WITH') return ctes;
  let i = 1;
  for (;;) {
    const nome = tokens[i];
    if (nome?.t !== 'id') return 'WITH inválido';
    i++;
    if (tokens[i]?.v === '(') {
      // lista de colunas: só nomes
      const f = fim.get(i)!;
      for (let j = i + 1; j < f; j++) {
        if (tokens[j].t !== 'id' && tokens[j].v !== ',') return 'WITH inválido';
      }
      i = f + 1;
    }
    if (tokens[i]?.v !== 'AS' || tokens[i + 1]?.v !== '(' || tokens[i + 2]?.v !== 'SELECT') return 'WITH inválido';
    if (ctes.has(nome.v)) return 'WITH repetido';
    const f = fim.get(i + 1)!;
    ctes.set(nome.v, f);
    i = f + 1;
    if (tokens[i]?.v === ',') {
      i++;
      continue;
    }
    return tokens[i]?.v === 'SELECT' ? ctes : 'WITH inválido';
  }
}

/** Toda chamada precisa estar na lista de funções; nome de CTE com colunas não é chamada. */
function conferirFuncoes(tokens: Token[], ctes: Map<string, number>): string | null {
  for (let i = 0; i < tokens.length - 1; i++) {
    const k = tokens[i];
    if (k.t !== 'id' || tokens[i + 1].v !== '(' || tokens[i + 1].t !== 'sim') continue;
    if (ANTES_DE_PARENTESE.has(k.v) || FUNCOES.has(k.v)) continue;
    // cabeçalho da CTE: WITH nome (colunas) ou , nome (colunas)
    if (ctes.has(k.v) && (tokens[i - 1]?.v === 'WITH' || tokens[i - 1]?.v === ',') && i < (ctes.get(k.v) as number)) continue;
    return `função ${k.v}`;
  }
  return null;
}

/** FROM que é argumento de EXTRACT ou TRIM, e não origem de dados. */
function ehFromDeFuncao(tokens: Token[], i: number): boolean {
  let profundidade = 0;
  for (let j = i - 1; j >= 0; j--) {
    if (tokens[j].t !== 'sim' && tokens[j].v !== 'SELECT') continue;
    if (tokens[j].v === ')') profundidade++;
    if (tokens[j].v === '(') {
      if (profundidade === 0) return FUNCOES_COM_FROM.has(tokens[j - 1]?.v ?? '');
      profundidade--;
    }
    if (profundidade === 0 && tokens[j].v === 'SELECT') return false;
  }
  return false;
}

/**
 * Percorre a cláusula FROM inteira, no mesmo nível de parênteses, até o fim dela: a primeira origem,
 * cada origem depois de vírgula e cada uma depois de JOIN. Vírgula depois de ON, SAMPLE ou de um
 * apelido também abre origem, e nenhuma passa sem conferência.
 */
function conferirOrigens(tokens: Token[], fim: Map<number, number>, ctes: Map<string, number>): string | null {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].t !== 'id' || tokens[i].v !== 'FROM' || ehFromDeFuncao(tokens, i)) continue;

    let j = i + 1;
    let esperaOrigem = true;
    while (j < tokens.length) {
      const k = tokens[j];
      if (k.t === 'sim' && k.v === ')') break;
      if (k.t === 'id' && FIM_DO_FROM.has(k.v) && !esperaOrigem) break;
      if (esperaOrigem) {
        const recusa = conferirOrigem(tokens, j, ctes);
        if (recusa) return recusa;
        esperaOrigem = false;
        j = k.v === '(' ? fim.get(j)! + 1 : j + 1;
        continue;
      }
      if (k.t === 'sim' && k.v === '(') {
        j = fim.get(j)! + 1;
        continue;
      }
      if ((k.t === 'sim' && k.v === ',') || (k.t === 'id' && k.v === 'JOIN')) esperaOrigem = true;
      j++;
    }
    if (esperaOrigem) return 'origem ausente';
  }
  return null;
}

function conferirOrigem(tokens: Token[], j: number, ctes: Map<string, number>): string | null {
  const k = tokens[j];
  if (k.v === '(' && k.t === 'sim') {
    // subconsulta: as origens dela são conferidas na mesma varredura
    return tokens[j + 1]?.v === 'SELECT' ? null : 'origem entre parênteses';
  }
  if (k.t !== 'id') return 'origem inválida';
  if (tokens[j + 1]?.v === '.') return `tabela de outro esquema (${k.v})`;
  if (tokens[j + 1]?.v === '(') return `origem por função (${k.v})`;
  const desde = ctes.get(k.v);
  if (desde !== undefined) return j > desde ? null : `tabela ${k.v}`;
  return TABELAS.has(k.v) ? null : `tabela ${k.v}`;
}

/**
 * Todo "*" é classificado, sem olhar a palavra de antes: COUNT(*) e multiplicação passam; o resto
 * (SELECT *, DISTINCT *, UNIQUE *, apelido.*) só sobre uma única subconsulta, cujas colunas foram conferidas.
 */
function conferirEstrelas(tokens: Token[], fim: Map<number, number>): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const k = tokens[i];
    if (k.t !== 'sim' || k.v !== '*') continue;
    const antes = tokens[i - 1];
    const depois = tokens[i + 1];
    if (antes?.v === '(' && depois?.v === ')') {
      if (tokens[i - 2]?.v === 'COUNT') continue;
      return 'estrela fora do COUNT';
    }
    const ehColunas = antes?.v === '.' || !depois || depois.v === ',' || depois.v === ')' || depois.v === 'FROM';
    if (!ehColunas) continue;

    // SELECT dono desta lista: voltando no mesmo nível de parênteses
    let dono = -1;
    let profundidade = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (tokens[j].t === 'sim' && tokens[j].v === ')') profundidade++;
      if (tokens[j].t === 'sim' && tokens[j].v === '(') {
        if (profundidade === 0) break;
        profundidade--;
      }
      if (profundidade === 0 && tokens[j].t === 'id' && tokens[j].v === 'SELECT') {
        dono = j;
        break;
      }
    }
    if (dono < 0) return 'estrela fora do SELECT';
    const from = proximoNoNivel(tokens, fim, i + 1, (t2) => t2.t === 'id' && t2.v === 'FROM');
    if (from < 0 || tokens[from + 1]?.v !== '(' || tokens[from + 2]?.v !== 'SELECT') return 'SELECT * direto em tabela';
    const depoisDaOrigem = fim.get(from + 1)! + 1;
    const fimDoFrom = proximoNoNivel(tokens, fim, depoisDaOrigem, (t2) => t2.t === 'id' && FIM_DO_FROM.has(t2.v));
    const limite = fimDoFrom < 0 ? Infinity : fimDoFrom;
    const juncao = proximoNoNivel(tokens, fim, depoisDaOrigem, (t2) => (t2.t === 'id' && t2.v === 'JOIN') || (t2.t === 'sim' && t2.v === ','));
    if (juncao >= 0 && juncao < limite) return 'SELECT * com junção';
  }
  return null;
}

/** Próximo token que atende ao teste no mesmo nível de parênteses; para ao sair do nível. */
function proximoNoNivel(tokens: Token[], fim: Map<number, number>, de: number, teste: (k: Token) => boolean): number {
  for (let j = de; j < tokens.length; j++) {
    const k = tokens[j];
    if (k.t === 'sim' && k.v === '(') {
      j = fim.get(j)!;
      continue;
    }
    if (k.t === 'sim' && k.v === ')') return -1;
    if (teste(k)) return j;
  }
  return -1;
}
