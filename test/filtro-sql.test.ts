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
  'SELECT A.CODPARC FROM TGFPAR A JOIN TSICID B ON B.CODCID = A.CODCID, TSIUFS C WHERE C.CODUF = B.UF',
  "SELECT TRIM(BOTH ' ' FROM P.NOMEPARC), NVL(P.CODPARC, 0) FROM TGFPAR P",
  'SELECT C.VLRNOTA * C.VLRDESC FROM TGFCAB C',
  'WITH A (X, Y) AS (SELECT 1, 2 FROM DUAL), B AS (SELECT X FROM A) SELECT B.X FROM B',
  'SELECT MAX(C.NUNOTA) FROM TGFCAB C WHERE C.CODPARC IN (SELECT P.CODPARC FROM TGFPAR P)',
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
  ['UNIQUE com estrela', 'SELECT UNIQUE * FROM TSIUSU'],
  ['DISTINCT com estrela', 'SELECT DISTINCT U.* FROM TSIUSU U'],
  ['estrela entre parênteses', 'SELECT JSON_OBJECT(*) FROM TSIUSU'],
  ['estrela em JSON_ARRAYAGG', 'SELECT JSON_ARRAYAGG(U.*) FROM TSIUSU U'],
  ['estrela no fim', 'SELECT 1, U.* FROM TSIUSU U WHERE 1 = 1'],
  ['CROSS APPLY em tabela', 'SELECT 1 FROM DUAL CROSS APPLY LOOPWHATSAPPCONFIG'],
  ['OUTER APPLY em subconsulta', 'SELECT 1 FROM DUAL OUTER APPLY (SELECT 1 FROM DUAL)'],
  ['LATERAL', 'SELECT 1 FROM DUAL, LATERAL (SELECT 1 FROM DUAL)'],
  ['vírgula depois de JOIN', 'SELECT 1 FROM DUAL D JOIN TGFPAR P ON 1 = 1, LOOPWHATSAPPCONFIG W'],
  ['vírgula depois de USING', 'SELECT 1 FROM DUAL D JOIN TGFPAR P USING (CODPARC), LOOPWHATSAPPCONFIG'],
  ['vírgula depois de SAMPLE', 'SELECT 1 FROM TGFPAR SAMPLE (10), LOOPWHATSAPPCONFIG'],
  ['vírgula depois de AS OF', "SELECT 1 FROM TGFPAR AS OF SCN 1, LOOPWHATSAPPCONFIG"],
  ['JOIN depois de vírgula', 'SELECT 1 FROM DUAL, TGFPAR P JOIN LOOPWHATSAPPCONFIG W ON 1 = 1'],
  ['CTE aninhada liberando tabela', 'SELECT 1 FROM (WITH LOOPWHATSAPPCONFIG AS (SELECT 1 X FROM DUAL) SELECT X FROM LOOPWHATSAPPCONFIG), LOOPWHATSAPPCONFIG'],
  ['tabela usada antes da CTE', 'WITH A AS (SELECT 1 X FROM LOOPWHATSAPPCONFIG), LOOPWHATSAPPCONFIG AS (SELECT 1 X FROM DUAL) SELECT X FROM A'],
  ['CTE citando a si mesma', 'WITH LOOPWHATSAPPCONFIG AS (SELECT 1 X FROM LOOPWHATSAPPCONFIG) SELECT X FROM LOOPWHATSAPPCONFIG'],
  ['WITH FUNCTION', 'WITH FUNCTION F RETURN NUMBER IS BEGIN RETURN 1; END; SELECT F FROM DUAL'],
  ['arquivo do servidor', "SELECT BFILENAME('D', 'f') FROM DUAL"],
  ['outro leitor de arquivo', "SELECT TO_CLOB(BFILENAME('D', 'f')) FROM DUAL"],
  ['função desconhecida', 'SELECT MINHA_FUNCAO(1) FROM DUAL'],
  ['CURSOR', 'SELECT CURSOR(SELECT 1 FROM DUAL) FROM DUAL'],
  ['FROM em outra função', 'SELECT NVL(1 FROM LOOPWHATSAPPCONFIG) FROM DUAL'],
  ['vazio', '   '],
];
for (const [nome, sql] of recusa) {
  test(`recusa ${nome}`, () => assert.notEqual(motivoRecusaSql(sql), null));
}

test('SQL que não é texto é recusado', () => {
  assert.notEqual(motivoRecusaSql(undefined), null);
  assert.notEqual(motivoRecusaSql({ sql: 'SELECT 1 FROM DUAL' }), null);
});
