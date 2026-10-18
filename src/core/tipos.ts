// Tipos do núcleo do gateway. Nada aqui depende de Node, Deno ou Firebase:
// o mesmo núcleo roda na Cloud Function (Firebase) e na Edge Function (Supabase).

export type OrigemLogin = 'FIREBASE' | 'SUPABASE';

/** Cliente final autenticado pelo provedor de login. */
export interface UsuarioAutenticado {
  origem: OrigemLogin;
  uid: string;
  /** E-mail do token, já em minúsculas. */
  email: string;
}

export interface ValidadorToken {
  /** Lança ErroGateway(401) quando o token não é válido. */
  validar(token: string): Promise<UsuarioAutenticado>;
}

/** Credenciais do Sankhya do cliente. Ficam só no servidor. */
export type CredenciaisSankhya =
  | { modo: 'OAUTH'; xToken: string; clientId: string; clientSecret: string }
  | { modo: 'LOGIN'; xToken: string; appKey: string; usuario: string; senha: string };

export type FonteCredenciais = () => Promise<CredenciaisSankhya>;

export type ModuloSankhya = 'mge' | 'mgecom' | 'mgefin';

/** Envelope devolvido pelo Sankhya ({status, statusMessage, responseBody}). */
export type EnvelopeSankhya = Record<string, unknown>;

export interface PortaSankhya {
  chamar(serviceName: string, modulo: ModuloSankhya, requestBody: Record<string, unknown>): Promise<EnvelopeSankhya>;
}

export interface RespostaGateway {
  status: number;
  corpo: unknown;
}

/** Registro de uma chamada, sem dados pessoais (uid é pseudônimo do provedor). */
export interface EventoGateway {
  rota: string;
  servico?: string;
  status: number;
  ms: number;
  uid?: string;
  codigo?: string;
}

export class ErroGateway extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}
