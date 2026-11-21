import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarHandlerAcessoAdmin, lerPedido } from '../src/acesso/admin.ts';
import { senhaTemporaria, sha256Hex, tokenAleatorio } from '../src/acesso/comum.ts';
import { criarHandlerAcessoContexto } from '../src/acesso/contexto.ts';
import { criarHandlerAcessoQr } from '../src/acesso/qr.ts';
import { ErroGateway } from '../src/core/tipos.ts';

// Supabase falso: responde por rota e registra cada chamada (método, caminho, corpo).
type Rota = (corpo: any, url: URL) => { status?: number; corpo?: unknown } | undefined;
function supabaseFalso(rotas: Record<string, Rota>) {
  const chamadas: { metodo: string; caminho: string; corpo: any; url: URL; headers: Record<string, string> }[] = [];
  const http = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const metodo = init?.method ?? 'GET';
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    const caminho = url.pathname.replace(/^\/(rest|auth)\/v1\//, '');
    chamadas.push({ metodo, caminho, corpo, url, headers: (init?.headers ?? {}) as Record<string, string> });
    const rota = rotas[`${metodo} ${caminho}`] ?? rotas[`${metodo} ${caminho.replace(/[0-9a-f-]{36}$/, ':id')}`];
    const r = rota?.(corpo, url) ?? { status: 200, corpo: [] };
    return new Response(r.corpo === undefined ? '' : JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { http, chamadas, de: (m: string, c: string) => chamadas.filter((x) => x.metodo === m && x.caminho === c) };
}

const CHAVE = 'k'.repeat(40);
const CENTRAL = '/api/v1/service/password-resets';
const CNPJ = '11111111000111';
const FILIAL = '22222222000122';
const ID = '00000000-0000-0000-0000-000000000003';
const LINHA = {
  cpfCnpj: CNPJ, email: 'ana@a.com', nomeCompleto: 'Ana', apps: ['LoopStok'], situacao: 'convidado', auth_user_id: ID,
  idUsuario: ID, codusu_sankhya: 7, ultimo_acesso_em: null, convite_enviado_em: null, trocar_senha: false,
};

function rotasBase(extra: Record<string, Rota> = {}, chave = { id: 'c1', cpf_cnpj: CNPJ, status: 'aprovada' }): Record<string, Rota> {
  return {
    'GET loop_addon_chaves': () => ({ corpo: [chave] }),
    'POST rpc/acesso_contrato_do_cnpj': () => ({ corpo: [{ cnpjs: [CNPJ, FILIAL] }] }),
    'POST rpc/acesso_auth_id_por_email': () => ({ corpo: null }),
    'POST admin/users': () => ({ corpo: { id: ID } }),
    'POST rpc/acesso_usuario_gravar': () => ({ corpo: { ok: true, codigo: 'OK', situacao: 'convidado', novo: true } }),
    'GET usuarios': () => ({ corpo: [LINHA] }),
    'PUT admin/users/:id': () => ({ corpo: {} }),
    'POST /api/v1/service/password-resets': () => ({ status: 202, corpo: { message: 'ok' } }),
    'POST rpc/acesso_conta_exclusiva': () => ({ corpo: true }),
    ...extra,
  };
}

const admin = (sb: ReturnType<typeof supabaseFalso>) =>
  criarHandlerAcessoAdmin({ supabaseUrl: 'https://x.supabase.co', supabaseChave: 'service', http: sb.http, limitar: () => true });
const pedido = (corpo: unknown, chave: string | null = CHAVE) =>
  new Request('https://x/functions/v1/acesso-admin', {
    method: 'POST',
    headers: chave ? { 'x-loop-cliente-chave': chave } : {},
    body: JSON.stringify(corpo),
  });

test('lerPedido: valida ação, app, e-mail e usa o CNPJ da chave por padrão', () => {
  const p = lerPedido({ acao: 'cadastrar', app: 'LoopStok', email: ' Ana@A.com ' }, CNPJ);
  assert.equal(p.cnpj, CNPJ);
  assert.equal(p.email, 'ana@a.com');
  assert.throws(() => lerPedido({ acao: 'apagar_tudo', app: 'LoopStok' }, CNPJ), /Ação inválida/);
  assert.throws(() => lerPedido({ acao: 'cadastrar', app: 'LoopMais', email: 'a@b.com' }, CNPJ), /Aplicativo inválido/);
  assert.throws(() => lerPedido({ acao: 'cadastrar', app: 'LoopStok', email: 'sem-arroba' }, CNPJ), /E-mail inválido/);
  assert.throws(() => lerPedido({ acao: 'excluir', app: 'LoopStok', emails: ['a@b.com', 'c@d.com'] }, CNPJ), /E-mails demais/);
  assert.equal(lerPedido({ acao: 'redefinir_senha', app: 'LoopStok', emails: ['a@b.com', 'c@d.com'] }, CNPJ).emails.length, 2);
});

test('acesso-admin: sem chave 401, chave pendente 423, recusada 401', async () => {
  let r = await admin(supabaseFalso(rotasBase()))(pedido({ acao: 'listar', app: 'LoopStok' }, null));
  assert.equal(r.status, 401);
  r = await admin(supabaseFalso(rotasBase({}, { id: 'c', cpf_cnpj: CNPJ, status: 'pendente' })))(pedido({ acao: 'listar', app: 'LoopStok' }));
  assert.equal(r.status, 423);
  r = await admin(supabaseFalso(rotasBase({}, { id: 'c', cpf_cnpj: CNPJ, status: 'recusada' })))(pedido({ acao: 'listar', app: 'LoopStok' }));
  assert.equal(r.status, 401);
});

test('acesso-admin: a chave procura pelo SHA-256, nunca pela chave em claro', async () => {
  const sb = supabaseFalso(rotasBase());
  await admin(sb)(pedido({ acao: 'listar', app: 'LoopStok' }));
  const q = sb.de('GET', 'loop_addon_chaves')[0].url.searchParams.get('chave_hash');
  assert.equal(q, `eq.${await sha256Hex(CHAVE)}`);
  assert.ok(!sb.chamadas.some((c) => c.url.href.includes(CHAVE)));
});

test('acesso-admin cadastrar: cria a conta confirmada, grava pelo banco, marca metadados e envia o código', async () => {
  const sb = supabaseFalso(rotasBase());
  const r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'Ana@a.com', nome: 'Ana', codusu: 7, ator: 'SUP' }));
  const corpo = await r.json();
  assert.equal(r.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.situacao, 'convidado');
  assert.equal(corpo.conviteEnviado, true);
  const criar = sb.de('POST', 'admin/users')[0].corpo;
  assert.equal(criar.email, 'ana@a.com');
  assert.equal(criar.email_confirm, true);
  assert.equal(criar.password, undefined, 'conta nasce sem senha');
  const g = sb.de('POST', 'rpc/acesso_usuario_gravar')[0].corpo;
  assert.deepEqual([g.p_cpf_cnpj, g.p_auth_user_id, g.p_apps, g.p_codusu, g.p_ator], [CNPJ, ID, ['LoopStok'], 7, 'SUP']);
  assert.deepEqual(sb.de('PUT', `admin/users/${ID}`)[0].corpo, { app_metadata: { loop_acesso: { cnpj: CNPJ, apps: ['LoopStok'] } } });
  const env = sb.de('POST', CENTRAL)[0];
  assert.deepEqual(env.corpo, { identifier: 'ana@a.com', app: 'LoopStok', motivo: 'convite' });
  assert.equal(env.url.origin, 'https://acesso.loopapp.com.br');
  assert.ok(sb.de('PATCH', 'usuarios')[0].corpo.convite_enviado_em);
});

test('acesso-admin cadastrar: conta que já existe (LoopMais, outro app) é reaproveitada', async () => {
  const sb = supabaseFalso(rotasBase({ 'POST rpc/acesso_auth_id_por_email': () => ({ corpo: ID }) }));
  const r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal(r.status, 200);
  assert.equal(sb.de('POST', 'admin/users').length, 0);
});

test('acesso-admin cadastrar: limite de licenças recusa e apaga a conta recém-criada', async () => {
  const sb = supabaseFalso(
    rotasBase({
      'POST rpc/acesso_usuario_gravar': () => ({
        corpo: { ok: false, codigo: 'LIMITE_LICENCAS', limite: 10, em_uso: 10, mensagem: 'Limite de licenças atingido (10 de 10).' },
      }),
    }),
  );
  const r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com' }));
  const corpo = await r.json();
  assert.equal(r.status, 409);
  assert.equal(corpo.codigo, 'LIMITE_LICENCAS');
  assert.equal(corpo.limite, 10);
  assert.equal(sb.de('DELETE', `admin/users/${ID}`).length, 1);
  assert.equal(sb.de('POST', CENTRAL).length, 0);
});

test('acesso-admin cadastrar: conta existente não é apagada quando a gravação recusa', async () => {
  const sb = supabaseFalso(
    rotasBase({
      'POST rpc/acesso_auth_id_por_email': () => ({ corpo: ID }),
      'POST rpc/acesso_usuario_gravar': () => ({ corpo: { ok: false, codigo: 'EMAIL_EM_OUTRA_EMPRESA', mensagem: 'x' } }),
    }),
  );
  const r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal(r.status, 409);
  assert.equal(sb.chamadas.filter((c) => c.metodo === 'DELETE').length, 0);
});

test('acesso-admin: CNPJ fora do contrato da chave é recusado; filial do contrato é aceita', async () => {
  let sb = supabaseFalso(rotasBase());
  let r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com', cpfCnpj: '33333333000133' }));
  assert.equal(r.status, 403);
  assert.equal(sb.de('POST', 'admin/users').length, 0);
  sb = supabaseFalso(rotasBase());
  r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com', cpfCnpj: FILIAL }));
  assert.equal(r.status, 200);
});

test('acesso-admin excluir: apaga a conta só quando é exclusiva do Add-on', async () => {
  let sb = supabaseFalso(rotasBase({ 'POST rpc/acesso_usuario_excluir': () => ({ corpo: { ok: true, codigo: 'OK', auth_user_id: ID, conta_exclusiva: true } }) }));
  let r = await admin(sb)(pedido({ acao: 'excluir', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal((await r.json()).contaApagada, true);
  assert.equal(sb.de('DELETE', `admin/users/${ID}`).length, 1);
  assert.equal(sb.de('POST', 'rpc/acesso_usuario_excluir')[0].corpo.p_app, 'LoopStok');

  sb = supabaseFalso(rotasBase({ 'POST rpc/acesso_usuario_excluir': () => ({ corpo: { ok: true, codigo: 'OK', auth_user_id: ID, conta_exclusiva: false } }) }));
  r = await admin(sb)(pedido({ acao: 'excluir', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal((await r.json()).contaApagada, false);
  assert.equal(sb.chamadas.filter((c) => c.metodo === 'DELETE').length, 0, 'conta do LoopMais/LoopSign preservada');

});

test('acesso-admin gerar_qr: guarda só o hash, invalida o anterior e o QR não leva e-mail nem CNPJ', async () => {
  const sb = supabaseFalso(rotasBase());
  const r = await admin(sb)(pedido({ acao: 'gerar_qr', app: 'LoopStok', email: 'ana@a.com' }));
  const corpo = await r.json();
  assert.equal(r.status, 200);
  const t = new URL(corpo.conteudo.replace('loopacesso://qr', 'https://q/')).searchParams.get('t')!;
  assert.match(corpo.conteudo, /^loopacesso:\/\/qr\?v=1&app=LoopStok&t=/);
  assert.ok(!corpo.conteudo.includes('ana') && !corpo.conteudo.includes(CNPJ));
  const ins = sb.de('POST', 'usuarios_tokens')[0].corpo;
  assert.equal(ins.token_hash, await sha256Hex(t));
  assert.ok(!JSON.stringify(ins).includes(t), 'token em claro não vai ao banco');
  assert.equal(corpo.validadeSegundos, 600);
  assert.equal(sb.de('PATCH', 'usuarios_tokens').length, 1);
});

test('acesso-admin gerar_qr: conta compartilhada (LoopMais/LoopSign) não recebe QR', async () => {
  const sb = supabaseFalso(rotasBase({ 'POST rpc/acesso_conta_exclusiva': () => ({ corpo: false }) }));
  const r = await admin(sb)(pedido({ acao: 'gerar_qr', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal((await r.json()).codigo, 'CONTA_COMPARTILHADA');
  assert.equal(sb.de('POST', 'usuarios_tokens').length, 0);
});

test('acesso-admin: legado sem auth_user_id e idUsuario não-uuid usa a conta do e-mail', async () => {
  const sb = supabaseFalso(
    rotasBase({
      'GET usuarios': () => ({ corpo: [{ ...LINHA, auth_user_id: null, idUsuario: 'legado-1' }] }),
      'POST rpc/acesso_auth_id_por_email': () => ({ corpo: ID }),
    }),
  );
  const r = await admin(sb)(pedido({ acao: 'gerar_qr', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal(r.status, 200);
  assert.equal(sb.de('POST', 'usuarios_tokens')[0].corpo.auth_user_id, ID);
});

test('acesso-admin gerar_qr: usuário inativo não recebe QR', async () => {
  const sb = supabaseFalso(rotasBase({ 'GET usuarios': () => ({ corpo: [{ ...LINHA, situacao: 'inativo' }] }) }));
  const r = await admin(sb)(pedido({ acao: 'gerar_qr', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal(r.status, 409);
});

test('acesso-admin senha_temporaria: recusa conta compartilhada; exclusiva recebe senha e troca obrigatória', async () => {
  let sb = supabaseFalso(rotasBase({ 'POST rpc/acesso_conta_exclusiva': () => ({ corpo: false }) }));
  let r = await admin(sb)(pedido({ acao: 'senha_temporaria', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal((await r.json()).codigo, 'CONTA_COMPARTILHADA');
  assert.equal(sb.de('PUT', `admin/users/${ID}`).length, 0);

  sb = supabaseFalso(rotasBase());
  r = await admin(sb)(pedido({ acao: 'senha_temporaria', app: 'LoopStok', email: 'ana@a.com' }));
  const corpo = await r.json();
  assert.match(corpo.senhaTemporaria, /^[A-Za-z2-9]{10}$/);
  assert.equal(sb.de('PUT', `admin/users/${ID}`)[0].corpo.password, corpo.senhaTemporaria);
  assert.equal(sb.de('PATCH', 'usuarios')[0].corpo.trocar_senha, true);
});

test('acesso-admin inativar: conta exclusiva é bloqueada (sessões caem); compartilhada não', async () => {
  let sb = supabaseFalso(rotasBase({ 'POST rpc/acesso_usuario_inativar': () => ({ corpo: { ok: true, codigo: 'OK' } }) }));
  let r = await admin(sb)(pedido({ acao: 'inativar', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal((await r.json()).sessoesEncerradas, true);
  assert.equal(sb.de('PUT', `admin/users/${ID}`)[0].corpo.ban_duration, '876000h');

  sb = supabaseFalso(rotasBase({ 'POST rpc/acesso_usuario_inativar': () => ({ corpo: { ok: true } }), 'POST rpc/acesso_conta_exclusiva': () => ({ corpo: false }) }));
  r = await admin(sb)(pedido({ acao: 'inativar', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal((await r.json()).sessoesEncerradas, false);
  assert.equal(sb.de('PUT', `admin/users/${ID}`).length, 0);
});

test('acesso-admin reativar: grava com p_ativar, desbloqueia a conta e não reenvia convite', async () => {
  const sb = supabaseFalso(rotasBase({ 'GET usuarios': () => ({ corpo: [{ ...LINHA, situacao: 'ativo' }] }), 'POST rpc/acesso_auth_id_por_email': () => ({ corpo: ID }) }));
  const r = await admin(sb)(pedido({ acao: 'reativar', app: 'LoopStok', email: 'ana@a.com' }));
  assert.equal(r.status, 200);
  assert.equal(sb.de('POST', 'rpc/acesso_usuario_gravar')[0].corpo.p_ativar, true);
  assert.ok(sb.de('PUT', `admin/users/${ID}`).some((c) => c.corpo.ban_duration === 'none'));
  assert.equal(sb.de('POST', CENTRAL).length, 0);
});

test('acesso-admin redefinir_senha em lote: envia para cada e-mail e informa quem não existe', async () => {
  const sb = supabaseFalso(
    rotasBase({ 'GET usuarios': (_c, url) => ({ corpo: url.searchParams.get('email') === 'eq.ana@a.com' ? [LINHA] : [] }) }),
  );
  const r = await admin(sb)(pedido({ acao: 'redefinir_senha', app: 'LoopStok', emails: ['ana@a.com', 'zeca@a.com'] }));
  const corpo = await r.json();
  assert.deepEqual(corpo.resultado.map((x: any) => x.codigo), ['OK', 'NAO_ENCONTRADO']);
  assert.equal(sb.de('POST', CENTRAL).length, 1);
});

test('acesso-admin redefinir_senha e reenviar_convite: e-mail pela Central com o motivo certo e a chave do Add-on', async () => {
  const sb = supabaseFalso(rotasBase());
  await admin(sb)(pedido({ acao: 'redefinir_senha', app: 'LoopStok', email: 'ana@a.com' }));
  await admin(sb)(pedido({ acao: 'reenviar_convite', app: 'LoopStok', email: 'ana@a.com' }));
  const envios = sb.de('POST', CENTRAL);
  assert.deepEqual(envios.map((e) => e.corpo.motivo), ['recuperacao', 'convite']);
  assert.equal(envios[0].headers['x-loop-cliente-chave'], CHAVE);
  assert.equal(sb.de('POST', 'otp').length, 0, 'nada pelo e-mail do Supabase Auth');
});

test('acesso-admin cadastrar com senha padrão: conta nasce com a senha, troca obrigatória e e-mail de redefinição', async () => {
  const sb = supabaseFalso(rotasBase());
  const r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com', senha: 'Inicial2026' }));
  const corpo = await r.json();
  assert.equal(r.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.senhaPadrao, true);
  assert.equal(corpo.senha, undefined, 'a senha não volta na resposta');
  assert.equal(sb.de('POST', 'admin/users')[0].corpo.password, 'Inicial2026');
  assert.ok(sb.de('PATCH', 'usuarios').some((x) => x.corpo.trocar_senha === true));
  assert.equal(sb.de('POST', CENTRAL)[0].corpo.motivo, 'recuperacao');
  const aud = sb.de('POST', 'usuarios_auditoria').map((x) => x.corpo);
  assert.ok(aud.some((a) => a.acao === 'senha_padrao'));
  assert.ok(!JSON.stringify(aud).includes('Inicial2026'), 'senha nunca na auditoria');
});

test('acesso-admin cadastrar com senha padrão: e-mail que já tem conta Loop é recusado sem mexer na senha', async () => {
  const sb = supabaseFalso(rotasBase({ 'POST rpc/acesso_auth_id_por_email': () => ({ corpo: ID }) }));
  const r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com', senha: 'Inicial2026' }));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).codigo, 'JA_TEM_SENHA');
  assert.equal(sb.de('PUT', `admin/users/${ID}`).length, 0);
  assert.equal(sb.de('POST', 'rpc/acesso_usuario_gravar').length, 0);
});

test('acesso-admin cadastrar: senha padrão fraca é recusada; vazia = convite normal', async () => {
  for (const fraca of ['curta1A', 'semnumeroA', 'SEMMINUSCULA1', 'semmaiuscula1']) {
    const r = await admin(supabaseFalso(rotasBase()))(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com', senha: fraca }));
    assert.equal(r.status, 400, fraca);
  }
  const sb = supabaseFalso(rotasBase());
  const r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com', senha: '' }));
  assert.equal(r.status, 200);
  assert.equal(sb.de('POST', 'admin/users')[0].corpo.password, undefined);
  assert.equal(sb.de('POST', CENTRAL)[0].corpo.motivo, 'convite');
});

test('acesso-admin cadastrar: Central fora do ar não desfaz o cadastro (conviteEnviado=false)', async () => {
  const sb = supabaseFalso(rotasBase({ 'POST /api/v1/service/password-resets': () => ({ status: 503, corpo: {} }) }));
  const r = await admin(sb)(pedido({ acao: 'cadastrar', app: 'LoopStok', email: 'ana@a.com' }));
  const corpo = await r.json();
  assert.equal(r.status, 200);
  assert.equal(corpo.conviteEnviado, false);
  assert.equal(sb.de('DELETE', `admin/users/${ID}`).length, 0);
});

test('acesso-admin listar: situação e contador de licenças', async () => {
  const sb = supabaseFalso(rotasBase({ 'POST rpc/acesso_licenca_uso': () => ({ corpo: [{ limite: 10, em_uso: 7, validade: '2027-01-01' }] }) }));
  const r = await admin(sb)(pedido({ acao: 'listar', app: 'LoopStok' }));
  const corpo = await r.json();
  assert.deepEqual(corpo.licenca, { limite: 10, emUso: 7, ilimitado: false, validade: '2027-01-01' });
  assert.equal(corpo.usuarios[0].nuncaAcessou, true);
  assert.equal(sb.de('GET', 'usuarios')[0].url.searchParams.get('cpfCnpj'), `in.(${CNPJ},${FILIAL})`);
});

test('acesso-admin: Supabase fora do ar responde 503 sem detalhes', async () => {
  const http = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const r = await criarHandlerAcessoAdmin({ supabaseUrl: 'https://x', supabaseChave: 's', http, limitar: () => true })(pedido({ acao: 'listar', app: 'LoopStok' }));
  assert.equal(r.status, 503);
});

// ---- acesso-qr ----
const qr = (sb: ReturnType<typeof supabaseFalso>) =>
  criarHandlerAcessoQr({ supabaseUrl: 'https://x.supabase.co', supabaseChave: 'service', http: sb.http, limitar: () => true });
const pedidoQr = (corpo: unknown) => new Request('https://x/functions/v1/acesso-qr', { method: 'POST', body: JSON.stringify(corpo) });

test('acesso-qr: token válido vira sessão; o banco recebe só o hash', async () => {
  const token = tokenAleatorio();
  const sb = supabaseFalso({
    'POST rpc/acesso_token_consumir': () => ({ corpo: [{ email: 'ana@a.com', auth_user_id: ID, cpf_cnpj: CNPJ }] }),
    'POST admin/generate_link': () => ({ corpo: { hashed_token: 'hh' } }),
    'POST verify': () => ({ corpo: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } }),
  });
  const r = await qr(sb)(pedidoQr({ token, app: 'LoopStok' }));
  const corpo = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(corpo.sessao, { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });
  assert.equal(corpo.trocarSenha, true);
  assert.equal(sb.de('POST', 'rpc/acesso_token_consumir')[0].corpo.p_token_hash, await sha256Hex(token));
  assert.deepEqual(sb.de('POST', 'verify')[0].corpo, { type: 'magiclink', token_hash: 'hh' });
});

test('acesso-qr: token usado, vencido ou de outro app = 401 sem criar sessão', async () => {
  const sb = supabaseFalso({ 'POST rpc/acesso_token_consumir': () => ({ corpo: [] }) });
  let r = await qr(sb)(pedidoQr({ token: tokenAleatorio(), app: 'LoopStok' }));
  assert.equal(r.status, 401);
  assert.equal(sb.de('POST', 'admin/generate_link').length, 0);
  r = await qr(sb)(pedidoQr({ token: 'curto', app: 'LoopStok' }));
  assert.equal(r.status, 401);
  r = await qr(sb)(pedidoQr({ token: tokenAleatorio(), app: 'Outro' }));
  assert.equal(r.status, 401);
});

test('acesso-qr: limite por IP', async () => {
  const h = criarHandlerAcessoQr({ supabaseUrl: 'https://x', supabaseChave: 's', http: supabaseFalso({}).http });
  let ultimo = 0;
  for (let i = 0; i < 11; i++) ultimo = (await h(pedidoQr({ token: 'x', app: 'LoopStok' }))).status;
  assert.equal(ultimo, 429);
});

// ---- acesso-contexto ----
test('acesso-contexto: sem sessão 401; com sessão passa o uid do token (nunca CNPJ do app)', async () => {
  const sb = supabaseFalso({ 'POST rpc/acesso_contexto': () => ({ corpo: { ok: true, codigo: 'OK', cnpj: CNPJ, trocarSenha: false } }) });
  const validador = {
    async validar(t: string) {
      if (t !== 'bom') throw new ErroGateway(401, 'TOKEN_INVALIDO', 'Sessão expirada.');
      return { origem: 'SUPABASE' as const, uid: ID, email: 'ana@a.com' };
    },
  };
  const h = criarHandlerAcessoContexto({ supabaseUrl: 'https://x.supabase.co', supabaseChave: 's', http: sb.http, validador });
  const req = (auth: string | null, corpo: unknown) =>
    new Request('https://x/functions/v1/acesso-contexto', { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(corpo) });

  assert.equal((await h(req(null, { app: 'LoopStok' }))).status, 401);
  assert.equal((await h(req('Bearer ruim', { app: 'LoopStok' }))).status, 401);
  const r = await h(req('Bearer bom', { app: 'LoopStok', cnpj: '99999999000199', evento: 'senha_criada' }));
  assert.equal((await r.json()).cnpj, CNPJ);
  assert.deepEqual(sb.de('POST', 'rpc/acesso_contexto')[0].corpo, { p_auth_user_id: ID, p_app: 'LoopStok', p_evento: 'senha_criada' });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
});

test('senha temporária: 10 caracteres sem ambíguos, com maiúscula, minúscula e número', () => {
  for (let i = 0; i < 200; i++) {
    const s = senhaTemporaria();
    assert.match(s, /^[A-HJ-NP-Za-km-np-z2-9]{10}$/);
    assert.ok(/[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s), s);
  }
});
