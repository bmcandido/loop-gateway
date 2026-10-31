import { logger } from 'firebase-functions';
import { defineBoolean, defineSecret, defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { validadorFirebase } from '../auth/firebase.ts';
import { assinadorV2, chavePrivadaGateway, type AssinadorIdentidade } from '../core/assinatura.ts';
import { credenciaisDoSupabase } from '../core/credenciais.ts';
import { processar } from '../core/gateway.ts';
import { verificadorLicencaDoApp } from '../core/licenca-app.ts';
import { licencaDoSupabase } from '../core/licenca.ts';
import { porCliente } from '../core/por-cliente.ts';
import { SankhyaCliente } from '../core/sankhya.ts';

// Gateway ÚNICO: atende todos os clientes. O cliente (CNPJ) vem da licença assinada pelo Loop Mais
// que o app envia em X-Loop-Licenca. Nada aqui é configurado por cliente.
// Documentação: loop-admin/docs/licenciamento/.

/** Projeto Supabase com `clientes`, `clientesProdutos`, `loopapp` e a RPC `licenca_status`. */
const SUPABASE_URL = defineString('PORTAL_SUPABASE_URL');
/** Chave secreta do Supabase (service_role / sb_secret_). Uma só para todos os clientes. */
const SUPABASE_CHAVE = defineSecret('PORTAL_SUPABASE_SECRET_KEY');
/** Chave privada (PKCS#8 PEM, EC P-256) que assina a identidade para o Add-on. Uma só. */
const CHAVE_GATEWAY = defineSecret('PORTAL_GATEWAY_CHAVE_PRIVADA');
/** kid da chave acima; o Add-on precisa ter a chave pública com esse kid. */
const KID_GATEWAY = defineString('PORTAL_GATEWAY_KID', { default: 'loop-gateway-2026-11' });
/** Projetos Firebase cujo login é aceito, separados por vírgula. Vazio = só o projeto do gateway. */
const PROJETOS_FIREBASE = defineString('PORTAL_FIREBASE_PROJETOS', { default: '' });
/** Opcional: travar origens web (CORS). Vazio = qualquer origem (o gateway não usa cookie). */
const ORIGENS_WEB = defineString('PORTAL_ORIGENS_WEB', { default: '' });
/** Só desligar em teste controlado: sem isso, conta com e-mail alheio acessa os dados do dono. */
const EXIGE_EMAIL_VERIFICADO = defineBoolean('PORTAL_EXIGE_EMAIL_VERIFICADO', { default: true });
/** codigoProduto do portal em `clientesProdutos`. */
const PRODUTO = defineString('PORTAL_PRODUTO', { default: 'LoopPortal' });

const supabase = () => ({ url: SUPABASE_URL.value(), chave: SUPABASE_CHAVE.value() });
const licencaDoApp = verificadorLicencaDoApp();
const licenca = porCliente((cnpj) => licencaDoSupabase({ ...supabase(), cnpj, produto: PRODUTO.value() }));
// Uma sessão Sankhya por cliente e por instância, reaproveitada entre requisições.
const sankhya = porCliente((cnpj) => new SankhyaCliente(credenciaisDoSupabase({ ...supabase(), cnpj })));
let assinar: Promise<AssinadorIdentidade> | undefined;

export const portalGateway = onRequest(
  {
    region: 'southamerica-east1',
    secrets: [SUPABASE_CHAVE, CHAVE_GATEWAY],
    maxInstances: 10,
    concurrency: 40,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    const origem = req.get('origin');
    if (origem) {
      const permitidas = ORIGENS_WEB.value().split(',').map((o) => o.trim()).filter(Boolean);
      if (permitidas.length && !permitidas.includes(origem)) {
        res.status(403).json({ status: '0', statusMessage: 'Origem não autorizada.' });
        return;
      }
      res.set('Access-Control-Allow-Origin', origem);
      res.set('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, POST');
        res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Loop-Licenca');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).end();
        return;
      }
    }

    assinar ??= chavePrivadaGateway(CHAVE_GATEWAY.value()).then((k) => assinadorV2(k, KID_GATEWAY.value()));
    let assinador: AssinadorIdentidade;
    try {
      assinador = await assinar;
    } catch (e) {
      assinar = undefined;
      logger.error('portal-gateway', { codigo: 'GATEWAY_SEM_CHAVE', erro: String(e) });
      res.status(500).json({ status: '0', statusMessage: 'Gateway do portal não configurado.', codigoGateway: 'GATEWAY_SEM_CHAVE' });
      return;
    }

    const resposta = await processar(
      {
        metodo: req.method,
        caminho: req.path.replace(/\/+$/, '') || '/',
        authorization: req.get('authorization'),
        licenca: req.get('x-loop-licenca'),
        corpo: req.body,
      },
      {
        validador: validador(),
        licencaDoApp,
        licenca: (cnpj) => licenca(cnpj)(),
        sankhya,
        assinar: assinador,
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
  const proprio = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? '';
  const lista = PROJETOS_FIREBASE.value().split(',').map((p) => p.trim()).filter(Boolean);
  validadorCache ??= validadorFirebase(lista.length ? lista : [proprio], { exigirEmailVerificado: EXIGE_EMAIL_VERIFICADO.value() });
  return validadorCache;
}
