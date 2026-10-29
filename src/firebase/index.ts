import { logger } from 'firebase-functions';
import { defineBoolean, defineSecret, defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { validadorFirebase } from '../auth/firebase.ts';
import { credenciaisDoSupabase } from '../core/credenciais.ts';
import { processar } from '../core/gateway.ts';
import { SankhyaCliente } from '../core/sankhya.ts';

/** Mesmo valor configurado no servidor Sankhya em LOOPPORTAL_GATEWAY_SECRET. */
const SEGREDO = defineSecret('PORTAL_GATEWAY_SECRET');
/** CNPJ do cliente (linha de `clientes` no Supabase). */
const CNPJ = defineString('PORTAL_CNPJ');
/** Projeto Supabase com as tabelas `clientes` e `loopapp`. */
const SUPABASE_URL = defineString('PORTAL_SUPABASE_URL');
/** Chave secreta do Supabase (service_role / sb_secret_), só para leitura das credenciais. */
const SUPABASE_CHAVE = defineSecret('PORTAL_SUPABASE_SECRET_KEY');
/** Origens web autorizadas (CORS), separadas por vírgula. Apps nativos não enviam Origin. */
const ORIGENS_WEB = defineString('PORTAL_ORIGENS_WEB', { default: '' });
/** Só desligar em teste controlado: sem isso, conta com e-mail alheio acessa os dados do dono. */
const EXIGE_EMAIL_VERIFICADO = defineBoolean('PORTAL_EXIGE_EMAIL_VERIFICADO', { default: true });

let sankhya: SankhyaCliente | undefined;

export const portalGateway = onRequest(
  {
    region: 'southamerica-east1',
    secrets: [SEGREDO, SUPABASE_CHAVE],
    maxInstances: 10,
    concurrency: 40,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    const origem = req.get('origin');
    if (origem) {
      const permitidas = ORIGENS_WEB.value().split(',').map((o) => o.trim()).filter(Boolean);
      if (!permitidas.includes(origem)) {
        res.status(403).json({ status: '0', statusMessage: 'Origem não autorizada.' });
        return;
      }
      res.set('Access-Control-Allow-Origin', origem);
      res.set('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, POST');
        res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).end();
        return;
      }
    }

    // Uma sessão Sankhya por instância, reaproveitada entre requisições.
    sankhya ??= new SankhyaCliente(
      credenciaisDoSupabase({ url: SUPABASE_URL.value(), chave: SUPABASE_CHAVE.value(), cnpj: CNPJ.value() }),
    );

    const resposta = await processar(
      {
        metodo: req.method,
        caminho: req.path.replace(/\/+$/, '') || '/',
        authorization: req.get('authorization'),
        corpo: req.body,
      },
      {
        validador: validador(),
        sankhya,
        segredo: SEGREDO.value(),
        // só metadados: nunca corpo, cabeçalhos, e-mail ou CPF
        registrar: (e) => (e.status >= 500 ? logger.error('portal-gateway', e) : logger.info('portal-gateway', e)),
      },
    );
    res.set('Cache-Control', 'no-store');
    res.status(resposta.status).json(resposta.corpo);
  },
);

let validadorCache: ReturnType<typeof validadorFirebase> | undefined;
function validador() {
  const projeto = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? '';
  validadorCache ??= validadorFirebase(projeto, { exigirEmailVerificado: EXIGE_EMAIL_VERIFICADO.value() });
  return validadorCache;
}
