import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assinarEntrega,
  chaveDoSupabase,
  cnpjDaChave,
  instanciaDoCliente,
  motivoDaFalha,
  limiteDeEntrega,
  mensagemEntrega,
  processarLoopApi,
  type DependenciasLoopApi,
} from '../src/core/loopapi.ts';
import { ErroGateway } from '../src/core/tipos.ts';

const CNPJ = '37647026000136';
const OUTRO = '11222333000181';
const CHAVE = `${CNPJ}.aleatorio-do-cliente`;
const INSTANCIA = `jm_${CNPJ}`;
const buscar = async (cnpj: string) => (cnpj === CNPJ ? CHAVE : null);

function montar(extra: Partial<DependenciasLoopApi> = {}) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const entregas: string[][] = [];
  const eventos: unknown[] = [];
  const deps: DependenciasLoopApi = {
    config: { url: 'https://api.loop/', token: 'TOKEN-UNICO' },
    licenca: async () => {},
    chaveDoCliente: buscar,
    entregar: async (cnpj, chave) => {
      entregas.push([cnpj, chave]);
    },
    podeEntregar: () => true,
    http: (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new Response('{"ok":true}', { status: 201 });
    }) as unknown as typeof fetch,
    registrar: (e) => eventos.push(e),
    ...extra,
  };
  return { deps, chamadas, entregas, eventos };
}

test('chave: só vale a cadastrada para o CNPJ', async () => {
  assert.equal(await cnpjDaChave(CHAVE, buscar), CNPJ);
  assert.equal(await cnpjDaChave(` ${CHAVE} `, buscar), CNPJ);
  for (const invalida of [null, undefined, '', 'x', CNPJ, `${CNPJ}.outra`, `${CHAVE}x`, `${OUTRO}.aleatorio-do-cliente`]) {
    assert.equal(await cnpjDaChave(invalida, buscar), null, String(invalida));
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
  const r = await processarLoopApi(
    { metodo: 'POST', caminho: `/message/sendText/${INSTANCIA}`, chave: CHAVE, corpo: '{"number":"55"}' },
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
  const ok = await processarLoopApi(
    { metodo: 'POST', caminho: '/instance/create', chave: CHAVE, corpo: JSON.stringify({ instanceName: INSTANCIA }) },
    deps,
  );
  assert.equal(ok.status, 201);
  for (const corpo of [JSON.stringify({ instanceName: `jm_${OUTRO}` }), '{}', 'nao-e-json', undefined]) {
    const r = await processarLoopApi({ metodo: 'POST', caminho: '/instance/create', chave: CHAVE, corpo }, deps);
    assert.equal(r.status, 403, String(corpo));
  }
  assert.equal(chamadas.length, 1);

  await processarLoopApi({ metodo: 'GET', caminho: `/instance/connect/${INSTANCIA}`, chave: CHAVE }, deps);
  assert.equal(chamadas[1].init.body, undefined);
});

test('instância de outro cliente e caminho malicioso são recusados sem chamar a API', async () => {
  const { deps, chamadas } = montar();
  for (const caminho of [
    `/instance/connect/jm_${OUTRO}`,
    `/instance/delete/jm_${OUTRO}`,
    `/instance/connect/..%2F..%2Fx_${CNPJ}`,
  ]) {
    const metodo = caminho.includes('delete') ? 'DELETE' : 'GET';
    const r = await processarLoopApi({ metodo, caminho, chave: CHAVE }, deps);
    assert.equal(r.status, 403, caminho);
  }
  assert.equal(chamadas.length, 0);
});

test('operação fora da lista é recusada, mesmo com chave válida', async () => {
  const { deps, chamadas } = montar();
  for (const [metodo, caminho] of [
    ['GET', '/instance/fetchInstances'],
    ['POST', `/webhook/set/${INSTANCIA}`],
    ['GET', `/message/sendText/${INSTANCIA}`],
    ['POST', `/instance/connect/${INSTANCIA}/extra`],
    ['POST', `/chat/find/${INSTANCIA}`],
  ]) {
    const r = await processarLoopApi({ metodo, caminho, chave: CHAVE }, deps);
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
  const r = await processarLoopApi({ metodo: 'GET', caminho, chave: CHAVE }, semLicenca.deps);
  assert.equal(r.status, 403);
  assert.match(r.corpo, /Licença inativa/);
  assert.equal(semLicenca.chamadas.length, 0);
});

test('sem configuração responde 503 e falha de rede 502, sem expor o token', async () => {
  const caminho = `/instance/connect/${INSTANCIA}`;
  const semConfig = montar({ config: { url: '', token: '' } });
  assert.equal((await processarLoopApi({ metodo: 'GET', caminho, chave: CHAVE }, semConfig.deps)).status, 503);

  const fora = montar({
    http: (async () => {
      throw new Error('falha com TOKEN-UNICO');
    }) as unknown as typeof fetch,
  });
  const r = await processarLoopApi({ metodo: 'GET', caminho, chave: CHAVE }, fora.deps);
  assert.equal(r.status, 502);
  assert.doesNotMatch(r.corpo, /TOKEN-UNICO/);
  assert.match(r.corpo, /falha de conexão/);
  assert.doesNotMatch(r.corpo, /falha com/);
});

test('entrega: grava no Sankhya do CNPJ e a resposta nunca traz a chave', async () => {
  const { deps, entregas } = montar();
  const r = await processarLoopApi({ metodo: 'POST', caminho: '/entregar', corpo: JSON.stringify({ cnpj: CNPJ }) }, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(entregas, [[CNPJ, CHAVE]]);
  assert.doesNotMatch(r.corpo, /aleatorio/);
});

test('entrega recusada: CNPJ inválido, sem chave, sem licença, repetida ou com outro método', async () => {
  const corpo = JSON.stringify({ cnpj: CNPJ });
  const pedir = (deps: DependenciasLoopApi, c = corpo, metodo = 'POST') =>
    processarLoopApi({ metodo, caminho: '/entregar', corpo: c }, deps);

  const base = montar();
  assert.equal((await pedir(base.deps, '{"cnpj":"123"}')).status, 400);
  assert.equal((await pedir(base.deps, 'nao-e-json')).status, 400);
  assert.equal((await pedir(base.deps, corpo, 'GET')).status, 403);
  assert.equal((await pedir(base.deps, JSON.stringify({ cnpj: OUTRO }))).status, 404);
  assert.equal(base.entregas.length, 0);

  const semLicenca = montar({
    licenca: async () => {
      throw new ErroGateway(403, 'LICENCA_INATIVA', 'Licença inativa.');
    },
  });
  assert.equal((await pedir(semLicenca.deps)).status, 403);
  assert.equal(semLicenca.entregas.length, 0);

  const repetida = montar({ podeEntregar: () => false });
  assert.equal((await pedir(repetida.deps)).status, 429);
  assert.equal(repetida.entregas.length, 0);
});

test('falha ao gravar no Sankhya volta como erro, sem a chave', async () => {
  const { deps } = montar({
    entregar: async () => {
      throw new ErroGateway(502, 'ENTREGA_RECUSADA', 'O Sankhya do cliente não recebeu a chave.');
    },
  });
  const r = await processarLoopApi({ metodo: 'POST', caminho: '/entregar', corpo: JSON.stringify({ cnpj: CNPJ }) }, deps);
  assert.equal(r.status, 502);
  assert.doesNotMatch(r.corpo, /aleatorio/);
});

test('limite de entrega: um pedido por CNPJ a cada 30 s', () => {
  let agora = 1000;
  const pode = limiteDeEntrega(() => agora);
  assert.equal(pode(CNPJ), true);
  assert.equal(pode(CNPJ), false);
  assert.equal(pode(OUTRO), true);
  agora += 30_000;
  assert.equal(pode(CNPJ), true);
});

test('chave no Supabase: filtra pelo CNPJ, guarda por 1 min e trata falha', async () => {
  let agora = 0;
  const urls: string[] = [];
  const ler = chaveDoSupabase({
    url: 'https://x.supabase.co/',
    chave: 'service',
    agora: () => agora,
    http: (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify([{ chave: CHAVE }]), { status: 200 });
    }) as unknown as typeof fetch,
  });
  assert.equal(await ler(CNPJ), CHAVE);
  assert.equal(await ler(CNPJ), CHAVE);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/rest\/v1\/clientes_chaves_loopapi\?/);
  assert.match(urls[0], new RegExp(`cpfCnpj=eq\\.${CNPJ}`));
  agora += 61_000;
  await ler(CNPJ);
  assert.equal(urls.length, 2);

  const fora = chaveDoSupabase({
    url: 'https://x',
    chave: 'service',
    http: (async () => new Response('', { status: 500 })) as unknown as typeof fetch,
  });
  await assert.rejects(fora(CNPJ), ErroGateway);
});

test('entrega assinada confere com a chave pública', async () => {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const e = await assinarEntrega(par.privateKey, 'k1', CNPJ, CHAVE, 1000.7);
  assert.equal(e.ts, 1000);
  assert.equal(e.kid, 'k1');
  const sig = Uint8Array.from(atob(e.sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  assert.equal(sig.length, 64);
  const confere = (msg: string) =>
    crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, par.publicKey, sig, new TextEncoder().encode(msg));
  assert.equal(await confere(mensagemEntrega(CNPJ, CHAVE, 1000)), true);
  assert.equal(await confere(mensagemEntrega(OUTRO, CHAVE, 1000)), false);
});

test('o registro não leva o nome da instância nem a chave', async () => {
  const { deps, eventos } = montar();
  await processarLoopApi({ metodo: 'GET', caminho: `/instance/connect/${INSTANCIA}`, chave: CHAVE }, deps);
  assert.deepEqual(Object.keys(eventos[0] as object).sort(), ['cnpj', 'ms', 'rota', 'status']);
  assert.equal((eventos[0] as { rota: string }).rota, '/loopapi/instance/connect');
});

test('motivo da falha: só categoria, sem o texto do erro', () => {
  const erro = (message: string, code?: string) => Object.assign(new Error(message), { cause: { message, code } });
  assert.equal(motivoDaFalha(new TypeError('Invalid URL')), 'endereço inválido');
  assert.equal(motivoDaFalha(erro('invalid peer certificate: UnknownIssuer')), 'certificado ou TLS');
  assert.equal(motivoDaFalha(erro('dns error: failed to lookup address api.interna')), 'DNS');
  assert.equal(motivoDaFalha(erro('Connection refused 10.0.0.1:8080')), 'conexão recusada');
  assert.equal(motivoDaFalha(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'tempo esgotado');
  assert.equal(motivoDaFalha(new Error('qualquer coisa em api.interna')), 'falha de conexão');
  assert.equal(motivoDaFalha(null), 'falha de conexão');
});
