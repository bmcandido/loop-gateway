import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DependenciasGateway, processar } from '../src/core/gateway.ts';
import { jwsDoDominioNoSupabase } from '../src/core/icone.ts';
import { ErroGateway } from '../src/core/tipos.ts';

const PNG = 'data:image/png;base64,AAAA';

function montar(visual: Record<string, unknown> | null, cfg: Record<string, unknown> | null = { codCfg: 7 }) {
  const chamadas: { serviceName: string; body: Record<string, unknown> }[] = [];
  const deps = {
    validador: { validar: async () => { throw new Error('não deve validar token'); } },
    assinar: async () => { throw new Error('não deve assinar'); },
    jwsDoDominio: async (d: string) => (d === 'portal.loopapp.com.br' ? 'JWS-A' : null),
    licencaDoApp: async (jws: string | null | undefined) => {
      if (jws !== 'JWS-A') throw new ErroGateway(401, 'LICENCA_INVALIDA', 'x');
      return { cnpj: '37647026000136' };
    },
    licenca: async () => {},
    sankhya: () => ({
      async chamar(serviceName: string, _modulo: string, body: Record<string, unknown>) {
        chamadas.push({ serviceName, body });
        const data = serviceName.endsWith('consultarConfig') ? cfg : visual;
        return { status: '1', responseBody: { success: true, data } };
      },
    }),
  } as unknown as DependenciasGateway;
  return { deps, chamadas };
}

const pedir = (dominio: unknown, deps: DependenciasGateway) =>
  processar({ metodo: 'POST', caminho: '/icone', corpo: { dominio } }, deps);

test('devolve só o favicon da configuração do cliente', async () => {
  const { deps, chamadas } = montar({ favicon: PNG, logoPrincipal: 'data:image/png;base64,BBBB', corPrimaria: '#000' });
  const r = await pedir('PORTAL.loopapp.com.br', deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { imagem: PNG });
  assert.deepEqual(chamadas.map((c) => c.serviceName), ['LoopPortalAppSP.consultarConfig', 'LoopPortalVisualSP.doConsultar']);
  assert.deepEqual(chamadas[1].body, { codCfg: 7 });
});

test('sem favicon usa a logo reduzida e depois a principal', async () => {
  assert.deepEqual((await pedir('portal.loopapp.com.br', montar({ logoReduzida: PNG }).deps)).corpo, { imagem: PNG });
  assert.deepEqual((await pedir('portal.loopapp.com.br', montar({ logoPrincipal: PNG }).deps)).corpo, { imagem: PNG });
});

test('sem identidade, sem configuração ou imagem de outro tipo: imagem nula', async () => {
  assert.deepEqual((await pedir('portal.loopapp.com.br', montar(null).deps)).corpo, { imagem: null });
  assert.deepEqual((await pedir('portal.loopapp.com.br', montar({ favicon: PNG }, null).deps)).corpo, { imagem: null });
  const svg = montar({ favicon: 'data:image/svg+xml;base64,AAAA', logoPrincipal: 'https://x/y.png' });
  assert.deepEqual((await pedir('portal.loopapp.com.br', svg.deps)).corpo, { imagem: null });
});

test('domínio sem licença não chega ao Sankhya', async () => {
  const { deps, chamadas } = montar({ favicon: PNG });
  const r = await pedir('outro.com.br', deps);
  assert.equal(r.status, 404);
  assert.equal(chamadas.length, 0);
});

test('domínio malformado é recusado antes de consultar a licença', async () => {
  const { deps, chamadas } = montar({ favicon: PNG });
  for (const d of ['', 'https://a.com', 'a.com/x', "a.com'--", 'localhost', 123, null]) {
    assert.equal((await pedir(d, deps)).status, 400, String(d));
  }
  assert.equal(chamadas.length, 0);
});

test('licença recusada não chega ao Sankhya', async () => {
  const { deps, chamadas } = montar({ favicon: PNG });
  deps.licenca = async () => { throw new ErroGateway(403, 'LICENCA_EXPIRADA', 'x'); };
  assert.equal((await pedir('portal.loopapp.com.br', deps)).status, 403);
  assert.equal(chamadas.length, 0);
});

test('a busca do domínio chama a RPC e trata resposta vazia', async () => {
  let pedido: { url: string; corpo: string; apikey: string } | undefined;
  const http = (async (url: string, init: RequestInit) => {
    pedido = { url, corpo: String(init.body), apikey: (init.headers as Record<string, string>).apikey };
    return new Response(JSON.stringify(pedido.corpo.includes('tem.com') ? 'JWS' : null));
  }) as unknown as typeof fetch;
  const buscar = jwsDoDominioNoSupabase({ url: 'https://ref.supabase.co/', chave: 'sb_secret_x', http });
  assert.equal(await buscar('tem.com.br'), 'JWS');
  assert.equal(pedido?.url, 'https://ref.supabase.co/rest/v1/rpc/licenca_do_dominio');
  assert.equal(pedido?.corpo, JSON.stringify({ p_dominio: 'tem.com.br' }));
  assert.equal(await buscar('nao.org'), null);
});

test('ícone do e-commerce: logo da loja, com a licença do e-commerce e a empresa do cliente', async () => {
  const produtos: (string | undefined)[] = [];
  const chamadas: { servico: string; modulo: string; corpo: Record<string, unknown> }[] = [];
  const logo = 'data:image/png;base64,AAAA';
  const deps = {
    validador: { validar: async () => { throw new Error('rota pública'); } },
    assinar: async () => { throw new Error('rota pública'); },
    jwsDoDominio: async () => 'JWS',
    licencaDoApp: async (_j: unknown, p?: string) => { produtos.push(p); return { cnpj: '36841880000176' }; },
    licenca: async (_c: string, p?: string) => { produtos.push(p); },
    codEmpDoCliente: async () => 7,
    sankhya: () => ({
      async chamar(servico: string, modulo: string, corpo: Record<string, unknown>) {
        chamadas.push({ servico, modulo, corpo });
        return { status: '1', responseBody: { success: true, data: { logo, smtpPass: 'x' } } };
      },
    }),
  } as never;
  const r = await processar({ metodo: 'POST', caminho: '/icone/ecommerce', corpo: { dominio: 'loja.exemplo.com.br' } }, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { imagem: logo });
  assert.deepEqual(produtos, ['LoopEcommerce', 'LoopEcommerce']);
  assert.deepEqual(chamadas, [{ servico: 'LoopEcommerceConfigSP.doLojaPublica', modulo: 'loop-b2bb2c', corpo: { codEmp: 7 } }]);
});
