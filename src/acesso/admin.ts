import { limitadorPublico } from '../core/gateway-app.ts';
import {
  appValido,
  clienteSupabase,
  emailDe,
  emailValido,
  lerCorpo,
  mascararEmail,
  Recusa,
  responder,
  respostaDeErro,
  senhaTemporaria,
  sha256Hex,
  soDigitos,
  tokenAleatorio,
  type AppAddon,
  type OpcoesSupabase,
} from './comum.ts';

// acesso-admin: o Add-on cadastra e administra os usuários do app. Única porta de criação de usuário de app.
// Docs: loop-expedicao/loop_stok/docs/acesso-unificado/02-implementacao-fase-1.md
//
// Autenticação: cabeçalho x-loop-cliente-chave (chave da instalação do Add-on, só o SHA-256 fica em
// public.loop_addon_chaves; precisa estar aprovada pela Loop). A service_role fica só aqui.
// Escopo: a chave administra o CNPJ dela e os CNPJs do mesmo contrato (filiais) daquele app (`app`), e só pessoas que
// usam esse app. O e-mail é a pessoa: cadastrar soma o app; editar, inativar, reativar e excluir valem para todos os
// apps dela na empresa. Conta usada também no LoopMais/LoopSign/outra empresa não é apagada nem bloqueada: é gerida lá.
//
// POST { acao, app, cpfCnpj?, email?, emails?, nome?, codusu?, ator?, enviarConvite?, senha? }
//   senha (só em cadastrar, opcional): "senha padrão" do gestor para conta nova. A pessoa entra com ela, o app pede a
//   troca no primeiro acesso (trocar_senha) e a Central manda o e-mail de redefinição. Sem senha: convite da Central
//   (código de 6 dígitos, digitado no app em "Primeiro acesso").
// E-mails (convite e redefinição) saem pela Central de Acesso Loop (loop-acess, API de serviço com a mesma chave).
//   acao: listar | cadastrar | reenviar_convite | redefinir_senha | senha_temporaria | gerar_qr | inativar |
//         reativar | excluir
// Resposta: { ok, codigo, mensagem?, ... }. Códigos de recusa: CHAVE_INVALIDA (401), CHAVE_PENDENTE (423),
//   FORA_DO_CLIENTE (403), NAO_ENCONTRADO (404), LIMITE_LICENCAS (409), EMAIL_EM_OUTRA_EMPRESA (409),
//   CONTA_COMPARTILHADA (409), PEDIDO_INVALIDO (400), MUITAS_TENTATIVAS (429), SUPABASE_* (502/503).

export const VALIDADE_QR_MS = 10 * 60_000;
const LIMITE_POR_MINUTO = 120;
const MAX_EMAILS_LOTE = 50;
/** Bloqueio de login para conta só do Add-on inativada (o Auth não tem "desativar"; ban derruba as sessões). */
const BAN_INATIVO = '876000h';
/** Regra mínima da senha padrão, igual à política padrão da Central de Acesso (8 a 72, maiúscula, minúscula e número). */
export function senhaPadraoValida(s: string): boolean {
  return s.length >= 8 && new TextEncoder().encode(s).length <= 72 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s);
}
const CENTRAL_PADRAO = 'https://acesso.loopapp.com.br';
const ACOES = ['listar', 'cadastrar', 'reenviar_convite', 'redefinir_senha', 'senha_temporaria', 'gerar_qr', 'inativar', 'reativar', 'excluir'] as const;
type Acao = (typeof ACOES)[number];

export interface OpcoesAcessoAdmin extends OpcoesSupabase {
  /** Esquema do conteúdo do QR lido pelo app (pacote loop_auth). */
  esquemaQr?: string;
  /** Central de Acesso Loop (envia convite e redefinição pelo SMTP da Loop). */
  centralUrl?: string;
  agoraMs?: () => number;
  limitar?: (origem: string) => boolean;
  /** Só metadados: nunca e-mail completo, senha, token ou chave. */
  registrar?: (e: { status: number; acao?: string; app?: string; codigo?: string; ms: number }) => void;
}

interface Chave {
  id: string;
  cpf_cnpj: string;
  status: string;
  /** Chave em claro, só para repassar à Central no cabeçalho. Nunca logar nem gravar. */
  valor: string;
}

interface LinhaUsuario {
  cpfCnpj: string;
  email: string;
  nomeCompleto: string | null;
  apps: string[];
  situacao: string | null;
  auth_user_id: string | null;
  idUsuario: string | null;
  codusu_sankhya: number | null;
  ultimo_acesso_em: string | null;
  convite_enviado_em: string | null;
  trocar_senha: boolean;
}

interface Pedido {
  acao: Acao;
  app: AppAddon;
  cnpj: string;
  email: string;
  emails: string[];
  nome: string | null;
  codusu: number | null;
  ator: string;
  enviarConvite: boolean;
  senha: string | null;
}

const COLUNAS = 'cpfCnpj,email,nomeCompleto,apps,situacao,auth_user_id,idUsuario,codusu_sankhya,ultimo_acesso_em,convite_enviado_em,trocar_senha';

export function lerPedido(o: Record<string, unknown>, cnpjDaChave: string): Pedido {
  const inval = (m: string) => new Recusa(400, 'PEDIDO_INVALIDO', m);
  const acao = o.acao as Acao;
  if (!(ACOES as readonly string[]).includes(acao as string)) throw inval('Ação inválida.');
  if (!appValido(o.app)) throw inval('Aplicativo inválido.');
  const cnpj = soDigitos(o.cpfCnpj) || cnpjDaChave;
  if (cnpj.length !== 14 && cnpj.length !== 11) throw inval('CNPJ inválido.');
  const email = emailDe(o.email);
  const emails = Array.isArray(o.emails) ? [...new Set(o.emails.map(emailDe))] : email ? [email] : [];
  if (acao !== 'listar') {
    if (emails.length === 0 || emails.some((e) => !emailValido(e))) throw inval('E-mail inválido.');
    if (emails.length > (acao === 'redefinir_senha' ? MAX_EMAILS_LOTE : 1)) throw inval('E-mails demais no pedido.');
  }
  const nome = typeof o.nome === 'string' && o.nome.trim() ? o.nome.trim().slice(0, 120) : null;
  const codusu = Number.isInteger(o.codusu) && (o.codusu as number) > 0 ? (o.codusu as number) : null;
  const ator = typeof o.ator === 'string' && o.ator.trim() ? o.ator.trim().slice(0, 60) : 'addon';
  let senha: string | null = null;
  if (acao === 'cadastrar' && typeof o.senha === 'string' && o.senha !== '') {
    if (!senhaPadraoValida(o.senha)) throw inval('A senha padrão precisa ter de 8 a 72 caracteres, com letra maiúscula, letra minúscula e número.');
    senha = o.senha;
  }
  return { acao, app: o.app, cnpj, email: emails[0] ?? '', emails, nome, codusu, ator, enviarConvite: o.enviarConvite !== false, senha };
}

export function criarHandlerAcessoAdmin(op: OpcoesAcessoAdmin): (req: Request) => Promise<Response> {
  const sb = clienteSupabase(op);
  const agora = op.agoraMs ?? Date.now;
  const limitar = op.limitar ?? limitadorPublico(LIMITE_POR_MINUTO, 60_000, agora);
  const esquemaQr = op.esquemaQr ?? 'loopacesso://qr';
  const central = (op.centralUrl || CENTRAL_PADRAO).replace(/\/+$/, '');
  const http = op.http ?? fetch;

  async function chaveDoAddon(valor: string): Promise<Chave> {
    if (valor.length < 32) throw new Recusa(401, 'CHAVE_INVALIDA', 'Chave da instalação inválida.');
    const [c] = await sb.select<Chave>('loop_addon_chaves', {
      select: 'id,cpf_cnpj,status',
      chave_hash: `eq.${await sha256Hex(valor)}`,
      revogada_em: 'is.null',
      limit: '1',
    });
    if (!c || c.status === 'recusada') throw new Recusa(401, 'CHAVE_INVALIDA', 'Chave da instalação inválida.');
    if (c.status !== 'aprovada') throw new Recusa(423, 'CHAVE_PENDENTE', 'A chave desta instalação aguarda a liberação da Loop.');
    return { ...c, valor };
  }

  /** CNPJs que a chave administra neste app: o dela e os do mesmo contrato. */
  async function cnpjsPermitidos(chave: Chave, app: string): Promise<string[]> {
    const [k] = await sb.rpc<{ cnpjs: string[] | null }[]>('acesso_contrato_do_cnpj', { p_cnpj: chave.cpf_cnpj, p_produto: app });
    return [...new Set([soDigitos(chave.cpf_cnpj), ...(k?.cnpjs ?? [])])];
  }

  async function linhaDoUsuario(p: Pedido, email: string): Promise<LinhaUsuario> {
    const [l] = await sb.select<LinhaUsuario>('usuarios', {
      select: COLUNAS,
      cpfCnpj: `eq.${p.cnpj}`,
      email: `eq.${email}`,
      apps: `cs.{${p.app}}`,
      limit: '1',
    });
    if (!l) throw new Recusa(404, 'NAO_ENCONTRADO', 'Usuário não encontrado neste aplicativo.');
    return l;
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /** Conta Auth da linha: auth_user_id; no legado, idUsuario (se for uuid) ou a conta do e-mail. */
  async function idDaConta(l: LinhaUsuario): Promise<string> {
    if (l.auth_user_id) return l.auth_user_id;
    if (l.idUsuario && UUID.test(l.idUsuario)) return l.idUsuario;
    const id = await sb.rpc<string | null>('acesso_auth_id_por_email', { p_email: l.email });
    if (!id) throw new Recusa(409, 'SEM_CONTA', 'Este usuário ainda não tem conta de acesso. Use "Cadastrar".');
    return id;
  }

  async function auditar(acao: string, p: Pedido, chave: Chave, email: string, detalhes: Record<string, unknown> = {}) {
    try {
      await sb.insert('usuarios_auditoria', { acao, email, cpf_cnpj: p.cnpj, apps: [p.app], origem: 'addon', chave_addon_id: chave.id, ator: p.ator, detalhes });
    } catch {
      // Auditoria não derruba a ação já feita; a falha aparece no log da função.
      console.error('acesso-admin', 'auditoria falhou', acao);
    }
  }

  /**
   * E-mail pela Central de Acesso (SMTP e identidade da Loop): 'convite' = boas-vindas com o código de primeiro
   * acesso; 'recuperacao' = código para redefinir a senha. A Central só envia para conta deste cliente (CNPJ da chave).
   * 202 = aceito (a Central não revela se a conta existe).
   */
  async function enviarPelaCentral(email: string, app: string, motivo: 'convite' | 'recuperacao', chave: Chave): Promise<boolean> {
    try {
      const r = await http(`${central}/api/v1/service/password-resets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-loop-cliente-chave': chave.valor },
        body: JSON.stringify({ identifier: email, app, motivo }),
      });
      return r.status === 202;
    } catch {
      console.error('acesso-admin', 'central de acesso indisponível', motivo);
      return false;
    }
  }

  async function contaExclusiva(id: string, cnpj: string): Promise<boolean> {
    return (await sb.rpc<boolean>('acesso_conta_exclusiva', { p_auth_user_id: id, p_cpf_cnpj: cnpj })) === true;
  }

  async function atualizarMetadados(id: string, cnpj: string, apps: string[]) {
    // Chave própria em app_metadata (só o servidor edita): não colide com LoopMais/LoopSign na mesma conta.
    await sb.auth(`admin/users/${id}`, 'PUT', { app_metadata: { loop_acesso: { cnpj, apps } } });
  }

  async function invalidarTokens(id: string, app: string) {
    await sb.update(
      'usuarios_tokens',
      { auth_user_id: `eq.${id}`, app: `eq.${app}`, usado_em: 'is.null', invalidado_em: 'is.null' },
      { invalidado_em: new Date(agora()).toISOString() },
    );
  }

  function recusaDaGravacao(r: Record<string, unknown>): Recusa {
    const codigo = String(r.codigo ?? 'ERRO');
    const status = codigo === 'PEDIDO_INVALIDO' ? 400 : codigo === 'NAO_ENCONTRADO' ? 404 : 409;
    const { ok: _ok, codigo: _c, mensagem, ...extra } = r;
    return new Recusa(status, codigo, String(mensagem ?? 'Não foi possível gravar.'), extra);
  }

  // ---- ações ----

  async function listar(p: Pedido, chave: Chave) {
    const cnpjs = await cnpjsPermitidos(chave, p.app);
    const usuarios = await sb.select<LinhaUsuario>('usuarios', {
      select: COLUNAS,
      cpfCnpj: `in.(${cnpjs.join(',')})`,
      apps: `cs.{${p.app}}`,
      order: 'nomeCompleto.asc.nullslast,email.asc',
    });
    const [uso] = await sb.rpc<{ limite: number | null; em_uso: number; validade: string | null }[]>('acesso_licenca_uso', {
      p_cnpj: chave.cpf_cnpj,
      p_produto: p.app,
    });
    return {
      ok: true,
      codigo: 'OK',
      licenca: { limite: uso?.limite ?? null, emUso: uso?.em_uso ?? 0, ilimitado: uso?.limite == null, validade: uso?.validade ?? null },
      usuarios: usuarios.map((u) => ({
        email: u.email,
        nome: u.nomeCompleto,
        cpfCnpj: u.cpfCnpj,
        apps: u.apps,
        situacao: u.situacao === 'convidado' && u.convite_enviado_em ? 'convidado' : u.situacao,
        nuncaAcessou: !u.ultimo_acesso_em,
        ultimoAcessoEm: u.ultimo_acesso_em,
        conviteEnviadoEm: u.convite_enviado_em,
        codusu: u.codusu_sankhya,
      })),
    };
  }

  async function cadastrar(p: Pedido, chave: Chave, ativar = false) {
    let id = (await sb.rpc<string | null>('acesso_auth_id_por_email', { p_email: p.email })) ?? '';
    let criada = false;
    // Senha padrão só para quem ainda não tem conta Loop: não troca a senha de quem já usa outro app/produto.
    if (id && p.senha) {
      throw new Recusa(409, 'JA_TEM_SENHA', 'Este e-mail já tem acesso aos aplicativos Loop. Cadastre sem senha padrão: a pessoa entra com a senha que já usa.');
    }
    if (!id) {
      const r = await sb.auth('admin/users', 'POST', {
        email: p.email,
        email_confirm: true,
        ...(p.senha ? { password: p.senha } : {}),
        user_metadata: p.nome ? { nome: p.nome } : {},
        app_metadata: { loop_acesso: { cnpj: p.cnpj, apps: [p.app] } },
      });
      const novo = r.corpo as { id?: string } | null;
      if (r.status < 300 && novo?.id) {
        id = novo.id;
        criada = true;
      } else {
        // Corrida: outra chamada criou a conta entre a consulta e a criação.
        id = (await sb.rpc<string | null>('acesso_auth_id_por_email', { p_email: p.email })) ?? '';
        if (!id) throw new Recusa(502, 'SUPABASE_RECUSOU', 'Não foi possível criar o acesso agora.');
      }
    }

    const r = await sb.rpc<Record<string, unknown>>('acesso_usuario_gravar', {
      p_email: p.email,
      p_cpf_cnpj: p.cnpj,
      p_auth_user_id: id,
      p_apps: [p.app],
      p_nome: p.nome,
      p_codusu: p.codusu,
      p_ator: p.ator,
      p_origem: 'addon',
      p_chave_id: chave.id,
      p_ativar: ativar,
    });
    if (r?.ok !== true) {
      if (criada) await sb.auth(`admin/users/${id}`, 'DELETE');
      throw recusaDaGravacao(r ?? {});
    }

    const linha = await linhaDoUsuario(p, p.email);
    await atualizarMetadados(id, p.cnpj, linha.apps);
    if (ativar && (await contaExclusiva(id, p.cnpj))) await sb.auth(`admin/users/${id}`, 'PUT', { ban_duration: 'none' });

    const comSenhaPadrao = criada && p.senha !== null;
    // Senha padrão: o primeiro acesso no app abre a tela de redefinir (uma vez só).
    if (comSenhaPadrao) await sb.update('usuarios', { cpfCnpj: `eq.${p.cnpj}`, email: `eq.${p.email}` }, { trocar_senha: true });

    let conviteEnviado = false;
    if (p.enviarConvite && linha.situacao === 'convidado') {
      conviteEnviado = await enviarPelaCentral(p.email, p.app, comSenhaPadrao ? 'recuperacao' : 'convite', chave);
      if (conviteEnviado) await sb.update('usuarios', { cpfCnpj: `eq.${p.cnpj}`, email: `eq.${p.email}` }, { convite_enviado_em: new Date(agora()).toISOString() });
    }
    if (comSenhaPadrao) await auditar('senha_padrao', p, chave, p.email);
    return { ok: true, codigo: 'OK', situacao: linha.situacao, novo: r.novo === true, apps: linha.apps, conviteEnviado, senhaPadrao: comSenhaPadrao };
  }

  async function reenviarOuRedefinir(p: Pedido, chave: Chave) {
    const resultado: { email: string; enviado: boolean; codigo: string }[] = [];
    for (const email of p.emails) {
      let linha: LinhaUsuario;
      try {
        linha = await linhaDoUsuario(p, email);
      } catch (e) {
        if (e instanceof Recusa && e.codigo === 'NAO_ENCONTRADO' && p.emails.length > 1) {
          resultado.push({ email, enviado: false, codigo: 'NAO_ENCONTRADO' });
          continue;
        }
        throw e;
      }
      if (linha.situacao === 'inativo') {
        if (p.emails.length === 1) throw new Recusa(409, 'USUARIO_INATIVO', 'Usuário inativo. Reative antes de enviar o acesso.');
        resultado.push({ email, enviado: false, codigo: 'USUARIO_INATIVO' });
        continue;
      }
      await invalidarTokens((await idDaConta(linha)), p.app);
      const enviado = await enviarPelaCentral(email, p.app, p.acao === 'reenviar_convite' ? 'convite' : 'recuperacao', chave);
      if (enviado && p.acao === 'reenviar_convite') {
        await sb.update('usuarios', { cpfCnpj: `eq.${p.cnpj}`, email: `eq.${email}` }, { convite_enviado_em: new Date(agora()).toISOString() });
      }
      await auditar(p.acao, p, chave, email, { enviado });
      resultado.push({ email, enviado, codigo: enviado ? 'OK' : 'ENVIO_FALHOU' });
    }
    if (p.emails.length === 1 && !resultado[0].enviado) {
      throw new Recusa(429, 'ENVIO_FALHOU', 'Não foi possível enviar o e-mail agora. Aguarde um minuto e tente de novo.');
    }
    return { ok: true, codigo: 'OK', resultado };
  }

  async function definirSenhaTemporaria(p: Pedido, chave: Chave) {
    const linha = await linhaDoUsuario(p, p.email);
    const id = (await idDaConta(linha));
    if (linha.situacao === 'inativo') throw new Recusa(409, 'USUARIO_INATIVO', 'Usuário inativo. Reative antes de definir a senha.');
    // A mesma conta pode ser usada em outro produto Loop: não trocar a senha dela por fora.
    if (!(await contaExclusiva(id, p.cnpj))) {
      throw new Recusa(409, 'CONTA_COMPARTILHADA', 'Este e-mail também é usado em outro produto Loop. Use "Enviar redefinição de senha".');
    }
    const senha = senhaTemporaria();
    const r = await sb.auth(`admin/users/${id}`, 'PUT', { password: senha });
    if (r.status >= 300) throw new Recusa(502, 'SUPABASE_RECUSOU', 'Não foi possível definir a senha agora.');
    await sb.update('usuarios', { cpfCnpj: `eq.${p.cnpj}`, email: `eq.${p.email}` }, { trocar_senha: true });
    await auditar('senha_temporaria', p, chave, p.email);
    return { ok: true, codigo: 'OK', senhaTemporaria: senha };
  }

  async function gerarQr(p: Pedido, chave: Chave) {
    const linha = await linhaDoUsuario(p, p.email);
    if (linha.situacao !== 'convidado' && linha.situacao !== 'ativo') {
      throw new Recusa(409, 'USUARIO_INATIVO', 'Usuário inativo ou bloqueado. Reative antes de gerar o QR.');
    }
    const id = (await idDaConta(linha));
    // QR dá sessão sem senha: conta usada também no LoopMais, LoopSign ou em outra empresa só entra pelo código
    // enviado ao e-mail do dono (o banco confere de novo ao consumir o token).
    if (!(await contaExclusiva(id, p.cnpj))) {
      throw new Recusa(409, 'CONTA_COMPARTILHADA', 'Este e-mail também é usado em outro produto Loop. Use "Reenviar convite": o acesso chega por código no e-mail.');
    }
    await invalidarTokens(id, p.app);
    const token = tokenAleatorio();
    const expira = new Date(agora() + VALIDADE_QR_MS).toISOString();
    await sb.insert('usuarios_tokens', {
      tipo: 'qr',
      token_hash: await sha256Hex(token),
      email: p.email,
      cpf_cnpj: p.cnpj,
      auth_user_id: id,
      app: p.app,
      expira_em: expira,
      criado_por: p.ator,
    });
    await auditar('gerar_qr', p, chave, p.email);
    // O QR não leva senha, CNPJ nem e-mail: só o token de uso único e o app.
    return { ok: true, codigo: 'OK', expiraEm: expira, validadeSegundos: VALIDADE_QR_MS / 1000, conteudo: `${esquemaQr}?v=1&app=${p.app}&t=${token}` };
  }

  async function inativar(p: Pedido, chave: Chave) {
    const linha = await linhaDoUsuario(p, p.email);
    const r = await sb.rpc<Record<string, unknown>>('acesso_usuario_inativar', {
      p_email: p.email,
      p_cpf_cnpj: p.cnpj,
      p_ator: p.ator,
      p_origem: 'addon',
      p_chave_id: chave.id,
    });
    if (r?.ok !== true) throw recusaDaGravacao(r ?? {});
    // Conta só do Add-on: ban derruba as sessões na hora. Compartilhada: o app recusa no acesso-contexto.
    const id = (await idDaConta(linha));
    const exclusiva = await contaExclusiva(id, p.cnpj);
    if (exclusiva) await sb.auth(`admin/users/${id}`, 'PUT', { ban_duration: BAN_INATIVO });
    return { ok: true, codigo: 'OK', situacao: 'inativo', sessoesEncerradas: exclusiva };
  }

  async function reativar(p: Pedido, chave: Chave) {
    const linha = await linhaDoUsuario(p, p.email);
    return cadastrar({ ...p, nome: p.nome ?? linha.nomeCompleto, codusu: p.codusu ?? linha.codusu_sankhya, enviarConvite: false }, chave, true);
  }

  async function excluir(p: Pedido, chave: Chave) {
    const r = await sb.rpc<Record<string, unknown>>('acesso_usuario_excluir', {
      p_email: p.email,
      p_cpf_cnpj: p.cnpj,
      p_app: p.app,
      p_ator: p.ator,
      p_origem: 'addon',
      p_chave_id: chave.id,
    });
    if (r?.ok !== true) throw recusaDaGravacao(r ?? {});
    let contaApagada = false;
    if (r.conta_exclusiva === true && typeof r.auth_user_id === 'string') {
      const d = await sb.auth(`admin/users/${r.auth_user_id}`, 'DELETE');
      contaApagada = d.status < 300 || d.status === 404;
      if (!contaApagada) console.error('acesso-admin', 'conta Auth não apagada', mascararEmail(p.email), d.status);
    }
    return { ok: true, codigo: 'EXCLUIDO', contaApagada };
  }

  return async (req) => {
    const t0 = agora();
    let acao: string | undefined;
    let app: string | undefined;
    const fim = (res: Response, codigo?: string) => {
      op.registrar?.({ status: res.status, acao, app, codigo, ms: agora() - t0 });
      return res;
    };
    try {
      if (req.method !== 'POST') throw new Recusa(405, 'METODO_INVALIDO', 'Use POST.');
      const valorChave = req.headers.get('x-loop-cliente-chave') ?? '';
      if (!limitar(valorChave.slice(0, 64) || 'sem-chave')) throw new Recusa(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um minuto.');
      const corpo = await lerCorpo(req);
      const chave = await chaveDoAddon(valorChave);
      const p = lerPedido(corpo, soDigitos(chave.cpf_cnpj));
      acao = p.acao;
      app = p.app;
      if (p.acao !== 'listar' && p.cnpj !== soDigitos(chave.cpf_cnpj) && !(await cnpjsPermitidos(chave, p.app)).includes(p.cnpj)) {
        throw new Recusa(403, 'FORA_DO_CLIENTE', 'Esta empresa não pertence à licença desta instalação.');
      }
      const corpoResposta = await {
        listar,
        cadastrar: (x: Pedido, c: Chave) => cadastrar(x, c),
        reenviar_convite: reenviarOuRedefinir,
        redefinir_senha: reenviarOuRedefinir,
        senha_temporaria: definirSenhaTemporaria,
        gerar_qr: gerarQr,
        inativar,
        reativar,
        excluir,
      }[p.acao](p, chave);
      return fim(responder(200, corpoResposta), 'OK');
    } catch (e) {
      if (!(e instanceof Recusa)) console.error('acesso-admin', (e as Error)?.message);
      return fim(respostaDeErro(e), e instanceof Recusa ? e.codigo : 'ERRO');
    }
  };
}
