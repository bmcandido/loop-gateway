import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  cnpjDaChave,
  gerarChaveLoopApi,
  instanciaDoCliente,
  processarLoopApi,
  type DependenciasLoopApi,
} from '../src/core/loopapi.ts';
import { ErroGateway } from '../src/core/tipos.ts';

const SEGREDO = 'segredo-de-teste';
const CNPJ = '37647026000136';
const OUTRO = '11222333000181';
const INSTANCIA = `jm_${CNPJ}`;

function montar(extra: Partial<DependenciasLoopApi> = {}) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const eventos: unknown[] = [];
  const deps: DependenciasLoopApi = {
    config: { url: 'https://api.loop/', token: 'TOKEN-UNICO', segredo: SEGREDO },
    licenca: async () => {},
    http: (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new Response('{"ok":true}', { status: 201 });
    }) as unknown as typeof fetch,
    registrar: (e) => eventos.push(e),
    ...extra,
  };
  return { deps, chamadas, eventos };
}

test('chave: é a mesma do script e não serve com outro CNPJ ou segredo', async () => {
  const chave = await gerarChaveLoopApi(SEGREDO, CNPJ);
  const doScript = `${CNPJ}.${createHmac('sha256', SEGREDO).update(`loopapi\n${CNPJ}`).digest('base64url')}`;
  assert.equal(chave, doScript);
  assert.equal(await cnpjDaChave(SEGREDO, chave), CNPJ);
  assert.equal(await cnpjDaChave('outro', chave), null);
  assert.equal(await cnpjDaChave(SEGREDO, chave.replace(CNPJ, OUTRO)), null);
  for (const invalida of [null, undefined, '', 'x', CNPJ, `${CNPJ}.`, `${CNPJ}.%%%`, `123.abc`, `${chave}.x`]) {
    assert.equal(await cnpjDaChave(SEGREDO, invalida), null, String(invalida));
  }
});

test('instância: precisa terminar no CNPJ da chave', () => {
  assert.equal(instanciaDoCliente(INSTANCIA, CNPJ), true);
  assert.equal(instanciaDoCliente(`jm_${OUTRO}`, CNPJ), false);
  assert.equal(instanciaDoCliente(CNPJ, CNPJ), false);
  assert.equal(instanciaDoCliente(`_${CNPJ}`, CNPJ), false);
  assert.equal(instanciaDoCliente(`a/../b_${CNPJ}`, CNPJ), false);
  assert.equal(instanciaDoCliente('', CNPJ), false);
});

test('encaminha com o token único, sem a chave do cliente, e devolve a resposta como veio', async () => {
  const { deps, chamadas } = montar();
  const chave = await gerarChaveLoopApi(SEGREDO, CNPJ);
  const r = await processarLoopApi(
    { metodo: 'POST', caminho: `/message/sendText/${INSTANCIA}`, chave, corpo: '{"number":"55"}' },
    deps,
  );
  assert.equal(r.status, 201);
  assert.equal(r.corpo, '{"ok":true}');
  assert.equal(chamadas[0].url, `https://api.loop/message/sendText/${INSTANCIA}`);
  assert.deepEqual(chamadas[0].init.headers, { apikey: 'TOKEN-UNICO', 'Content-Type': 'application/json' });
  assert.equal(chamadas[0].init.body, '{"number":"55"}');
});

test('criação confere a instância do corpo; GET não leva corpo', async () => {
  const { deps, chamadas } = montar();
  const chave = await gerarChaveLoopApi(SEGREDO, CNPJ);
  const ok = await processarLoopApi(
    { metodo: 'POST', caminho: '/instance/create', chave, corpo: JSON.stringify({ instanceName: INSTANCIA }) },
    deps,
  );
  assert.equal(ok.status, 201);
  for (const corpo of [JSON.stringify({ instanceName: `jm_${OUTRO}` }), '{}', 'nao-e-json', undefined]) {
    const r = await processarLoopApi({ metodo: 'POST', caminho: '/instance/create', chave, corpo }, deps);
    assert.equal(r.status, 403, String(corpo));
  }
  assert.equal(chamadas.length, 1);

  await processarLoopApi({ metodo: 'GET', caminho: `/instance/connect/${INSTANCIA}`, chave }, deps);
  assert.equal(chamadas[1].init.body, undefined);
});

test('instância de outro cliente e caminho malicioso são recusados sem chamar a API', async () => {
  const { deps, chamadas } = montar();
  const chave = await gerarChaveLoopApi(SEGREDO, CNPJ);
  for (const caminho of [
    `/instance/connect/jm_${OUTRO}`,
    `/instance/delete/jm_${OUTRO}`,
    `/instance/connect/..%2F..%2Fx_${CNPJ}`,
  ]) {
    const metodo = caminho.includes('delete') ? 'DELETE' : 'GET';
    const r = await processarLoopApi({ metodo, caminho, chave }, deps);
    assert.equal(r.status, 403, caminho);
  }
  assert.equal(chamadas.length, 0);
});

test('operação fora da lista é recusada, mesmo com chave válida', async () => {
  const { deps, chamadas } = montar();
  const chave = await gerarChaveLoopApi(SEGREDO, CNPJ);
  for (const [metodo, caminho] of [
    ['GET', '/instance/fetchInstances'],
    ['POST', `/webhook/set/${INSTANCIA}`],
    ['GET', `/message/sendText/${INSTANCIA}`],
    ['POST', `/instance/connect/${INSTANCIA}/extra`],
    ['POST', `/chat/find/${INSTANCIA}`],
  ]) {
    const r = await processarLoopApi({ metodo, caminho, chave }, deps);
    assert.equal(r.status, 403, caminho);
  }
  assert.equal(chamadas.length, 0);
});

test('sem chave válida ou sem licença não chama a API', async () => {
  const caminho = `/instance/connect/${INSTANCIA}`;
  const semChave = montar();
  assert.equal((await processarLoopApi({ metodo: 'GET', caminho }, semChave.deps)).status, 401);
  assert.equal(semChave.chamadas.length, 0);

  const semLicenca = montar({
    licenca: async () => {
      throw new ErroGateway(403, 'LICENCA_INATIVA', 'Licença inativa.');
    },
  });
  const chave = await gerarChaveLoopApi(SEGREDO, CNPJ);
  const r = await processarLoopApi({ metodo: 'GET', caminho, chave }, semLicenca.deps);
  assert.equal(r.status, 403);
  assert.match(r.corpo, /Licença inativa/);
  assert.equal(semLicenca.chamadas.length, 0);
});

test('sem configuração responde 503 e falha de rede 502, sem expor o token', async () => {
  const chave = await gerarChaveLoopApi(SEGREDO, CNPJ);
  const caminho = `/instance/connect/${INSTANCIA}`;
  const semConfig = montar({ config: { url: '', token: '', segredo: '' } });
  assert.equal((await processarLoopApi({ metodo: 'GET', caminho, chave }, semConfig.deps)).status, 503);

  const fora = montar({
    http: (async () => {
      throw new Error('falha com TOKEN-UNICO');
    }) as unknown as typeof fetch,
  });
  const r = await processarLoopApi({ metodo: 'GET', caminho, chave }, fora.deps);
  assert.equal(r.status, 502);
  assert.doesNotMatch(r.corpo, /TOKEN-UNICO/);
});

test('o registro não leva o nome da instância nem a chave', async () => {
  const { deps, eventos } = montar();
  const chave = await gerarChaveLoopApi(SEGREDO, CNPJ);
  await processarLoopApi({ metodo: 'GET', caminho: `/instance/connect/${INSTANCIA}`, chave }, deps);
  assert.deepEqual(Object.keys(eventos[0] as object).sort(), ['cnpj', 'ms', 'rota', 'status']);
  assert.equal((eventos[0] as { rota: string }).rota, '/loopapi/instance/connect');
});
