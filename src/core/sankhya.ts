import {
  type CredenciaisSankhya,
  type EnvelopeSankhya,
  ErroGateway,
  type FonteCredenciais,
  type ModuloSankhya,
  type PortaSankhya,
} from './tipos.ts';

const MARGEM_MS = 60 * 1000;
const TIMEOUT_MS = 25_000;

export interface OpcoesSankhya {
  http?: typeof fetch;
  agora?: () => number;
}

/**
 * Cliente do API Gateway do Sankhya com a sessão técnica guardada no
 * servidor. Reaproveita a sessão entre chamadas, refaz o login uma vez se o
 * Sankhya recusar a sessão e nunca registra credenciais ou corpos.
 */
export class SankhyaCliente implements PortaSankhya {
  private readonly http: typeof fetch;
  private readonly agora: () => number;
  private sessao?: { token: string; baseUrl: string; validaAte: number };
  private loginEmAndamento?: Promise<{ token: string; baseUrl: string }>;

  constructor(
    private readonly credenciais: FonteCredenciais,
    opcoes: OpcoesSankhya = {},
  ) {
    this.http = opcoes.http ?? fetch;
    this.agora = opcoes.agora ?? Date.now;
  }

  async chamar(serviceName: string, modulo: ModuloSankhya, requestBody: Record<string, unknown>): Promise<EnvelopeSankhya> {
    const corpo = JSON.stringify({ serviceName, requestBody });

    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const { token, baseUrl } = await this.sessaoValida();
      const url = `${baseUrl}/gateway/v1/${modulo}/service.sbr?serviceName=${encodeURIComponent(serviceName)}&outputType=json`;
      const r = await this.enviar(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: corpo,
      });
      const json = (await lerJson(r)) as EnvelopeSankhya | undefined;
      if (sessaoRecusada(r.status, json) && tentativa === 0) {
        this.invalidar(token);
        continue;
      }
      if (!r.ok || !json) {
        throw new ErroGateway(502, 'SANKHYA_INDISPONIVEL', 'O ERP não respondeu como esperado. Tente novamente.');
      }
      return json;
    }
    throw new ErroGateway(502, 'SANKHYA_SESSAO', 'Não foi possível abrir sessão no ERP.');
  }

  private async sessaoValida(): Promise<{ token: string; baseUrl: string }> {
    if (this.sessao && this.agora() < this.sessao.validaAte - MARGEM_MS) {
      return this.sessao;
    }
    // Várias chamadas simultâneas compartilham o mesmo login.
    this.loginEmAndamento ??= this.login().finally(() => {
      this.loginEmAndamento = undefined;
    });
    return this.loginEmAndamento;
  }

  private invalidar(token: string): void {
    if (this.sessao?.token === token) this.sessao = undefined;
  }

  private async login(): Promise<{ token: string; baseUrl: string }> {
    const c = await this.credenciais();
    const baseUrl = c.baseUrl.replace(/\/+$/, '');
    const { token, validadeMs } = await this.loginOAuth(c, baseUrl);
    this.sessao = { token, baseUrl, validaAte: this.agora() + validadeMs };
    return this.sessao;
  }

  private async loginOAuth(c: CredenciaisSankhya, baseUrl: string) {
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret });
    const r = await this.enviar(`${baseUrl}/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Token': c.xToken },
      body: form.toString(),
    });
    const json = (await lerJson(r)) as { access_token?: string; expires_in?: number } | undefined;
    if (!r.ok || !json?.access_token) throw erroLogin();
    const segundos = Number(json.expires_in) > 0 ? Number(json.expires_in) : 300;
    return { token: json.access_token, validadeMs: segundos * 1000 };
  }

  private async enviar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      // sem detalhes: a mensagem do fetch pode carregar a URL com parâmetros
      throw new ErroGateway(504, 'SANKHYA_TEMPO', 'O ERP demorou a responder. Tente novamente.');
    }
  }
}

function erroLogin(): ErroGateway {
  return new ErroGateway(502, 'SANKHYA_LOGIN', 'Não foi possível abrir sessão no ERP. Verifique as credenciais do servidor.');
}

/** Sessão expirada ou recusada: HTTP 401/403 ou status "3" no envelope. */
function sessaoRecusada(http: number, json: EnvelopeSankhya | undefined): boolean {
  return http === 401 || http === 403 || String(json?.status ?? '') === '3';
}

async function lerJson(r: Response): Promise<unknown> {
  try {
    const t = decodificar(new Uint8Array(await r.arrayBuffer()));
    return t ? JSON.parse(t) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * O Sankhya responde em ISO-8859-1 (padrão dos serviços), às vezes sem
 * charset ou com um charset que não bate com o corpo; r.text() decodifica
 * sempre como UTF-8 e troca os acentos por "�" ("Situa��o"). Texto acentuado
 * em ISO-8859-1 quase nunca é UTF-8 válido: tenta UTF-8 estrito e, se falhar,
 * lê como windows-1252 (superconjunto do ISO-8859-1).
 */
export function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
