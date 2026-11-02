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

/** Pacotes e tipos do Oracle que executam SQL montado em texto ou saem para a rede. */
const FUNCAO_PERIGOSA = /^(DBMS_|UTL_|SYS_|XML|ORA_|OWA_|CTX_|DBURI|XDBURI|HTTPURI|URITYPE|ANYDATA|ANYTYPE)|^(SYS|SYSTEM|HTP|HTF)$/;

/** Palavras que encerram a lista de origens de um FROM. */
const FIM_DE_ORIGENS: ReadonlySet<string> = new Set([
  'WHERE', 'GROUP', 'ORDER', 'HAVING', 'UNION', 'MINUS', 'INTERSECT', 'CONNECT', 'START', 'FETCH', 'OFFSET',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'ON', 'USING', 'PIVOT', 'UNPIVOT', 'MODEL', 'SAMPLE',
]);

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
    if (FUNCAO_PERIGOSA.test(v)) return `função ${v}`;
    if (COLUNA_SEGREDO.test(v)) return `coluna ${v}`;
    if (tokens[i + 1]?.v === '.' && tokens[i + 2]?.t === 'id' && tokens[i + 3]?.v === '(') return `função ${v}.${tokens[i + 2].v}`;
  }

  const fim = fechamentos(tokens);
  if (typeof fim === 'string') return fim;
  const ctes = nomesDeCte(tokens);
  return conferirOrigens(tokens, fim, ctes) ?? conferirEstrelas(tokens, fim);
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

function nomesDeCte(tokens: Token[]): Set<string> {
  const nomes = new Set<string>();
  tokens.forEach((k, i) => {
    if (k.t === 'id' && tokens[i + 1]?.v === 'AS' && tokens[i + 2]?.v === '(' && ['SELECT', 'WITH'].includes(tokens[i + 3]?.v)) nomes.add(k.v);
  });
  return nomes;
}

/** Em qual "(" está cada token: EXTRACT(YEAR FROM x) não é origem de dados. */
function ehFromDeFuncao(tokens: Token[], i: number): boolean {
  let profundidade = 0;
  for (let j = i - 1; j >= 0; j--) {
    if (tokens[j].v === ')' && tokens[j].t === 'sim') profundidade++;
    if (tokens[j].v === '(' && tokens[j].t === 'sim') {
      if (profundidade === 0) return !['SELECT', 'WITH'].includes(tokens[j + 1]?.v);
      profundidade--;
    }
    if (profundidade === 0 && tokens[j].v === 'SELECT') return false;
  }
  return false;
}

function conferirOrigens(tokens: Token[], fim: Map<number, number>, ctes: Set<string>): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const v = tokens[i].v;
    if (tokens[i].t !== 'id' || (v !== 'FROM' && v !== 'JOIN')) continue;
    if (v === 'FROM' && ehFromDeFuncao(tokens, i)) continue;

    let j = i + 1;
    for (;;) {
      const k = tokens[j];
      if (!k) return 'origem ausente';
      if (k.v === '(') {
        // subconsulta: as origens dela são conferidas na mesma varredura
        if (!['SELECT', 'WITH'].includes(tokens[j + 1]?.v)) return 'origem entre parênteses';
        j = fim.get(j)! + 1;
      } else if (k.t === 'id') {
        if (tokens[j + 1]?.v === '.') return `tabela de outro esquema (${k.v})`;
        if (tokens[j + 1]?.v === '(') return `origem por função (${k.v})`;
        if (!TABELAS.has(k.v) && !ctes.has(k.v)) return `tabela ${k.v}`;
        j++;
      } else {
        return 'origem inválida';
      }
      if (tokens[j]?.v === 'AS') j++;
      if (tokens[j]?.t === 'id' && !FIM_DE_ORIGENS.has(tokens[j].v)) j++;
      if (v === 'FROM' && tokens[j]?.v === ',') {
        j++;
        continue;
      }
      break;
    }
  }
  return null;
}

/** `*` e `apelido.*` só sobre uma única subconsulta: as colunas dela já foram conferidas. */
function conferirEstrelas(tokens: Token[], fim: Map<number, number>): string | null {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].v !== 'SELECT' || tokens[i].t !== 'id') continue;
    const from = proximoNoNivel(tokens, fim, i + 1, (k) => k.t === 'id' && k.v === 'FROM');
    if (from < 0) continue;
    let temEstrela = false;
    for (let j = i + 1; j < from; j++) {
      if (tokens[j].v === '(' && tokens[j].t === 'sim') {
        j = fim.get(j)!;
        continue;
      }
      if (tokens[j].v !== '*' || tokens[j].t !== 'sim') continue;
      const antes = tokens[j - 1];
      if (antes.v === '.' || antes.v === ',' || antes.v === 'SELECT' || antes.v === 'DISTINCT' || antes.v === 'ALL') temEstrela = true;
    }
    if (!temEstrela) continue;
    if (tokens[from + 1]?.v !== '(') return 'SELECT * direto em tabela';
    const depois = fim.get(from + 1)! + 1;
    const juncao = proximoNoNivel(tokens, fim, depois, (k) => k.t === 'id' && k.v === 'JOIN');
    const fimOrigens = proximoNoNivel(tokens, fim, depois, (k) => k.t === 'id' && ['WHERE', 'GROUP', 'ORDER', 'HAVING', 'UNION', 'MINUS', 'INTERSECT'].includes(k.v));
    const virgula = proximoNoNivel(tokens, fim, depois, (k) => k.t === 'sim' && k.v === ',');
    if (juncao >= 0 && (fimOrigens < 0 || juncao < fimOrigens)) return 'SELECT * com junção';
    if (virgula >= 0 && (fimOrigens < 0 || virgula < fimOrigens)) return 'SELECT * com junção';
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
