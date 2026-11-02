import assert from 'node:assert/strict';
import { test } from 'node:test';
import { motivoRecusaSql } from '../src/core/filtro-sql.ts';

const aceita = [
  'SELECT 1 FROM DUAL',
  'select par.codparc, par.nomeparc from tgfpar par where par.ativo = \'S\'',
  'SELECT COUNT(*) FROM TGFPAR',
  'SELECT * FROM (SELECT CODPROD, SERIE FROM TGFSER) WHERE ROWNUM <= 10',
  'SELECT * FROM (SELECT BASE.*, ROW_NUMBER() OVER (ORDER BY NOME) RN FROM (SELECT V.CODVEND, V.APELIDO NOME FROM TGFVEN V) BASE) WHERE RN <= 5',
  'WITH TIP_TABELA AS (SELECT CODTAB FROM TGFTAB) SELECT T.CODTAB FROM TIP_TABELA T',
  'SELECT A.CODPARC FROM TGFPAR A, TSICID B WHERE A.CODCID = B.CODCID',
  'SELECT EXTRACT(YEAR FROM C.DTNEG) ANO, C.VLRNOTA * 2 FROM TGFCAB C',
  'SELECT C.CHAVENFE FROM TGFCAB C',
  "SELECT 'SENHA; DROP' AS TXT FROM DUAL",
  'SELECT V.CODVEND FROM TSIUSU U INNER JOIN TGFVEN V ON V.CODVEND = U.CODVEND LEFT JOIN TSIEND END ON END.CODEND = 1',
  'SELECT 1 FROM DUAL;',
  'SELECT -- 00 - 16 | Produto\n TGFPRO.CODPROD AS idProduto, -- SENHA fica só no comentário\n TGFPRO.DESCRPROD FROM TGFPRO',
];
for (const sql of aceita) {
  test(`aceita: ${sql.slice(0, 60)}`, () => assert.equal(motivoRecusaSql(sql), null));
}

const recusa: [string, string][] = [
  ['coluna de senha', 'SELECT SMTPPASS FROM LOOPPAYMENTLINKCONFIG'],
  ['senha do usuário', 'SELECT U.INTERNO FROM TSIUSU U'],
  ['senha em subconsulta', 'SELECT X FROM (SELECT SENHA X FROM TGFVEN)'],
  ['chave PIX', 'SELECT CHAVEPIX FROM TGFPAR'],
  ['token da empresa', 'SELECT TOKENNFCE FROM TGFEMP'],
  ['chave de produção', 'SELECT KEYPRODUCAO FROM LOOPPAYMENTLINKCONFIG'],
  ['tabela fora da lista', 'SELECT CODUSU FROM LOOPB2BB2CCONFIG'],
  ['tabela de chaves', 'SELECT 1 FROM LOOPPAYMENTLINKCRYPTO'],
  ['tabela depois da vírgula', 'SELECT 1 FROM DUAL, LOOPWHATSAPPCONFIG'],
  ['tabela no join', 'SELECT 1 FROM DUAL D JOIN LOOPPORTALUSU P ON 1 = 1'],
  ['dicionário do Oracle', 'SELECT TABLE_NAME FROM ALL_TAB_COLUMNS'],
  ['outro esquema', 'SELECT 1 FROM SYS.USER$'],
  ['outro banco', 'SELECT 1 FROM DUAL@LINK'],
  ['estrela direto na tabela', 'SELECT * FROM TSIUSU'],
  ['estrela com apelido', 'SELECT U.* FROM TSIUSU U'],
  ['estrela com outra coluna', 'SELECT 1, E.* FROM TGFEMP E'],
  ['estrela em subconsulta', 'SELECT * FROM (SELECT * FROM TGFEMP)'],
  ['estrela com junção', 'SELECT * FROM (SELECT 1 A FROM DUAL) X JOIN TSIUSU U ON 1 = 1'],
  ['estrela com vírgula', 'SELECT * FROM (SELECT 1 A FROM DUAL) X, TSIUSU U'],
  ['SQL em texto pelo pacote', "SELECT DBMS_XMLGEN.GETXML('SELECT SENHA FROM TGFVEN') FROM DUAL"],
  ['XML lendo tabela', "SELECT XMLQUERY('1' RETURNING CONTENT) FROM DUAL"],
  ['saída para a rede', "SELECT UTL_HTTP.REQUEST('http://x') FROM DUAL"],
  ['função de pacote', 'SELECT PACOTE.FUNCAO(1) FROM DUAL'],
  ['tabela por função', 'SELECT 1 FROM TABLE(F())'],
  ['escrita', "UPDATE TSIUSU SET INTERNO = 'x'"],
  ['escrita com WITH', 'WITH A AS (SELECT 1 FROM DUAL) DELETE FROM TGFPAR'],
  ['bloqueio de linhas', 'SELECT 1 FROM TGFPAR FOR UPDATE'],
  ['dois comandos', 'SELECT 1 FROM DUAL; SELECT 2 FROM DUAL'],
  ['coluna depois do comentário', 'SELECT -- x\n SENHA FROM TGFVEN'],
  ['tabela depois de CR no comentário', 'SELECT 1 FROM DUAL -- x\r, LOOPWHATSAPPCONFIG'],
  ['comentário de bloco', 'SELECT /* x */ 1 FROM DUAL'],
  ['aspas no identificador', 'SELECT "INTERNO" FROM TSIUSU'],
  ['delimitador alternativo', "SELECT q'[a]' FROM DUAL"],
  ['texto sem fechar', "SELECT 'a FROM DUAL"],
  ['parênteses sem par', 'SELECT (1 FROM DUAL'],
  ['caractere especial', 'SELECT 1 FROM TSIUSU\u00A0U'],
  ['letra que vira ASCII', 'SELECT 1 FROM TGFPAR WHERE ı = 1'],
  ['vazio', '   '],
];
for (const [nome, sql] of recusa) {
  test(`recusa ${nome}`, () => assert.notEqual(motivoRecusaSql(sql), null));
}

test('SQL que não é texto é recusado', () => {
  assert.notEqual(motivoRecusaSql(undefined), null);
  assert.notEqual(motivoRecusaSql({ sql: 'SELECT 1 FROM DUAL' }), null);
});
