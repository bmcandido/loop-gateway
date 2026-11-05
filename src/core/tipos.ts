// Tipos do núcleo do gateway. Nada aqui depende de Node, Deno ou Firebase:
// o mesmo núcleo roda na Cloud Function (Firebase) e na Edge Function (Supabase).

export type OrigemLogin = 'FIREBASE' | 'SUPABASE';

/** Cliente final autenticado pelo provedor de login. */
export interface UsuarioAutenticado {
  origem: OrigemLogin;
  uid: string;
  /** E-mail do token, já em minúsculas. */
  email: string;
  /** Firebase: e-mail confirmado no token. Ausente = não se aplica (Supabase). */
  emailVerificado?: boolean;
}

export interface ValidadorToken {
  /** Lança ErroGateway(401) quando o token não é válido. */
  validar(token: string): Promise<UsuarioAutenticado>;
}

/**
 * Credenciais OAuth do Sankhya do cliente. Ficam só no servidor.
 * [baseUrl] muda entre produção e teste (ex.: https://api.sankhya.com.br).
 */
export interface CredenciaisSankhya {
  baseUrl: string;
  xToken: string;
  clientId: string;
  clientSecret: string;
}

export type FonteCredenciais = () => Promise<CredenciaisSankhya>;

/**
 * Contexto do Sankhya na URL /gateway/v1/<contexto>/service.sbr. Serviços de ADD-ON respondem no
 * contexto do próprio add-on (= rootProject.name do settings.gradle); em /mge/ dão "Nenhum provedor".
 */
export type ModuloSankhya = 'mge' | 'mgecom' | 'mgefin' | 'loop-portal' | 'loop-b2bb2c' | 'loop-expense' | 'loop-producao' | 'loop-stock' | 'loop-whatsapp' | 'loop-link-pagamento';

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
  /** CNPJ da empresa cliente (da licença); não é dado pessoal. */
  cnpj?: string;
  codigo?: string;
  /** Motivo da recusa, sem dados da requisição. */
  detalhe?: string;
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
