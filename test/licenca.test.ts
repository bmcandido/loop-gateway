import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataExpiracao, licencaDoSupabase, TOLERANCIA_SEM_SUPABASE_MS } from '../src/core/licenca.ts';
import { ErroGateway } from '../src/core/tipos.ts';

const CNPJ = '36841880000176';
const T0 = Date.parse('2026-10-30T12:00:00-03:00');
const MIN = 60_000;

type Tabelas = { clientes?: Record<string, unknown>[]; clientesProdutos?: Record<string, unknown>[] };

/**
 * PostgREST falso: filtra coluna=eq.valor; `fora` simula Supabase indisponível. `rpc` emula
 * public.licenca_status a partir das tabelas; false = função ainda não criada (404).
 */
function supabase(tabelas: Tabelas, op: { rpc?: boolean } = {}) {
  const estado = { fora: false, pedidos: 0, rpc: 0, tabelas: 0 };
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    estado.pedidos++;
    if (estado.fora) throw new TypeError('fetch failed');
    const u = new URL(String(url));
    if (u.pathname.endsWith('/rpc/licenca_status')) {
      estado.rpc++;
      if (op.rpc === false) return new Response('{"code":"PGRST202"}', { status: 404 });
      const { p_cnpj, p_produto } = JSON.parse(String(init?.body));
      const c = (tabelas.clientes ?? []).find((l) => l.cpfCnpj === p_cnpj);
      const linhas = c
        ? [{
            contratado: (tabelas.clientesProdutos ?? []).some((l) => l.cpfCnpj === p_cnpj && l.codigoProduto === p_produto),
            dataExpiracao: c.dataExpiracao ?? null,
          }]
        : [];
      return new Response(JSON.stringify(linhas), { status: 200 });
    }
    estado.tabelas++;
    const tabela = u.pathname.split('/').pop() as keyof Tabelas;
    const linhas = (tabelas[tabela] ?? []).filter((l) =>
      [...u.searchParams].every(([k, v]) => k === 'select' || k === 'limit' || `eq.${l[k]}` === v),
    );
    return new Response(JSON.stringify(linhas), { status: 200 });
  }) as typeof fetch;
  return { http, estado };
}

const ATIVO: Tabelas = {
  clientes: [{ cpfCnpj: CNPJ, dataExpiracao: '2027-01-31' }],
  clientesProdutos: [{ cpfCnpj: CNPJ, codigoProduto: 'LoopPortal' }],
};

function montar(tabelas: Tabelas, op: { rpc?: boolean } = {}) {
  const s = supabase(tabelas, op);
  const relogio = { t: T0 };
  const verificar = licencaDoSupabase({ url: 'https://ref.supabase.co', chave: 'jwt', cnpj: CNPJ, http: s.http, agoraMs: () => relogio.t });
  return { verificar, relogio, ...s };
}

async function codigo(p: Promise<void>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    assert.ok(e instanceof ErroGateway);
    return e.codigo;
  }
}

test('licença ativa passa e fica 5 min em cache', async () => {
  const { verificar, relogio, estado } = montar(ATIVO);
  assert.equal(await codigo(verificar()), 'OK');
  const pedidos = estado.pedidos;
  relogio.t += 4 * MIN;
  assert.equal(await codigo(verificar()), 'OK');
  assert.equal(estado.pedidos, pedidos);
  relogio.t += 2 * MIN;
  await verificar();
  assert.ok(estado.pedidos > pedidos);
});

test('cliente sem cadastro ou sem o produto: LICENCA_INATIVA', async () => {
  assert.equal(await codigo(montar({ clientesProdutos: ATIVO.clientesProdutos }).verificar()), 'LICENCA_INATIVA');
  assert.equal(await codigo(montar({ clientes: ATIVO.clientes, clientesProdutos: [{ cpfCnpj: CNPJ, codigoProduto: 'LoopWhatsApp' }] }).verificar()), 'LICENCA_INATIVA');
});

test('dataExpiracao vencida ou vazia: LICENCA_EXPIRADA', async () => {
  for (const d of ['2026-10-30', null]) {
    const { verificar } = montar({ ...ATIVO, clientes: [{ cpfCnpj: CNPJ, dataExpiracao: d }] });
    assert.equal(await codigo(verificar()), 'LICENCA_EXPIRADA', String(d));
  }
});

test('data vence no início do dia, no horário de Brasília', () => {
  assert.equal(dataExpiracao('2026-10-31'), Date.parse('2026-10-31T03:00:00Z'));
  assert.equal(dataExpiracao('x'), undefined);
});

test('Supabase fora: vale o último OK até 10 dias; sem OK anterior, LICENCA_INDISPONIVEL', async () => {
  const { verificar, relogio, estado } = montar(ATIVO);
  estado.fora = true;
  assert.equal(await codigo(verificar()), 'LICENCA_INDISPONIVEL');
  // a falha fica 1 min em cache: não espera o timeout a cada chamada
  estado.fora = false;
  assert.equal(await codigo(verificar()), 'LICENCA_INDISPONIVEL');

  relogio.t += 2 * MIN;
  await verificar();
  estado.fora = true;
  relogio.t += TOLERANCIA_SEM_SUPABASE_MS - MIN;
  assert.equal(await codigo(verificar()), 'OK');
  relogio.t += 2 * MIN;
  assert.equal(await codigo(verificar()), 'LICENCA_INDISPONIVEL');
});

test('recusa não reaproveita OK antigo e reativação vale em 1 min', async () => {
  const tabelas: Tabelas = structuredClone(ATIVO);
  const { verificar, relogio, estado } = montar(tabelas);
  await verificar();
  tabelas.clientesProdutos = [];
  relogio.t += 6 * MIN;
  assert.equal(await codigo(verificar()), 'LICENCA_INATIVA');
  // depois da recusa, Supabase fora não libera pelo OK antigo
  estado.fora = true;
  relogio.t += 2 * MIN;
  assert.equal(await codigo(verificar()), 'LICENCA_INDISPONIVEL');
  estado.fora = false;
  tabelas.clientesProdutos = ATIVO.clientesProdutos;
  relogio.t += 2 * MIN;
  assert.equal(await codigo(verificar()), 'OK');
});

test('usa a RPC licenca_status quando existe: uma chamada, sem ler tabelas', async () => {
  const { verificar, estado } = montar(ATIVO);
  assert.equal(await codigo(verificar()), 'OK');
  assert.equal(estado.rpc, 1);
  assert.equal(estado.tabelas, 0);
});

test('RPC ainda não criada (404): cai nas tabelas e não insiste na RPC', async () => {
  const { verificar, estado, relogio } = montar(ATIVO, { rpc: false });
  assert.equal(await codigo(verificar()), 'OK');
  assert.equal(estado.rpc, 1);
  assert.equal(estado.tabelas, 2);
  relogio.t += 6 * MIN;
  assert.equal(await codigo(verificar()), 'OK');
  assert.equal(estado.rpc, 1);
  assert.equal(estado.tabelas, 4);
});

test('RPC: produto não contratado e data vencida têm a mesma resposta das tabelas', async () => {
  const semProduto = montar({ clientes: ATIVO.clientes, clientesProdutos: [] });
  assert.equal(await codigo(semProduto.verificar()), 'LICENCA_INATIVA');
  const semCliente = montar({ clientes: [], clientesProdutos: [] });
  assert.equal(await codigo(semCliente.verificar()), 'LICENCA_INATIVA');
  const vencida = montar({ clientes: [{ cpfCnpj: CNPJ, dataExpiracao: '2026-10-01' }], clientesProdutos: ATIVO.clientesProdutos });
  assert.equal(await codigo(vencida.verificar()), 'LICENCA_EXPIRADA');
});
