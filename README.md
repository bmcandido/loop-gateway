# Gateway ÚNICO do Portal do Cliente

> Arquitetura completa, chaves e modelo para os outros apps:
> `loop-central/loop-admin/docs/licenciamento/` (README, 01 a 06).

O app deixa de falar direto com o Sankhya. Ele chama este gateway com o token de
login do cliente **e a licença assinada pelo Loop Mais** (`X-Loop-Licenca`); o
gateway confere a licença (é dela que sai o CNPJ do cliente — um gateway para
todos os clientes), confere o token, chama o Sankhya daquele cliente e envia ao
Add-on a identidade assinada **v2 (ES256)**: o Add-on confere com a chave
pública embarcada no pacote, sem nada configurado no servidor Sankhya.

Login no Sankhya só por OAuth (client_credentials). As credenciais vêm do
Supabase, como no app: `clientes` (pelo CNPJ da licença: `token` = X-Token e
`tipoIntegracao`) e `loopapp` (CNPJ da Loop + o mesmo `tipoIntegracao`:
`clienteId`, `clienteSecret`, `urlBase`). Trocar o cliente de produção para
teste é mudar `clientes.tipoIntegracao`. Erros de configuração aparecem no log
com o código (`CLIENTE_NAO_CADASTRADO`, `LOOPAPP_NAO_CADASTRADO`,
`CREDENCIAIS_INCOMPLETAS`, `SUPABASE_RECUSOU`, `SUPABASE_INDISPONIVEL`).

```
App ──(token de login)──▶ Gateway ──(sessão técnica + _portalAuth assinado)──▶ Sankhya / Add-on
```

- Só passam os serviços listados em `src/core/servicos.ts`. SQL livre
  (`DbExplorerSP`) e CRUD genérico são recusados.
- O Add-on (`PortalAutenticacao`) confere a assinatura e troca o `codUsuPortal`
  enviado pelo app pelo usuário do portal com o mesmo e-mail do login.
- Nenhum corpo, cabeçalho, e-mail ou CPF vai para o log. Só serviço, status,
  tempo e o uid do provedor.
- Licença (`src/core/licenca.ts`): antes de qualquer serviço, confere no
  Supabase `clientes.dataExpiracao` (vence no início do dia, horário de
  Brasília) e o produto `PORTAL_PRODUTO` (padrão `LoopPortal`) em
  `clientesProdutos`. Recusa com `LICENCA_INATIVA` ou `LICENCA_EXPIRADA`
  (403). Supabase fora: vale o último OK por até 10 dias; sem ele,
  `LICENCA_INDISPONIVEL` (503). É a mesma regra do app, que também confere o
  `licenca.json` assinado pelo LoopMais; aqui é a trava que o navegador não
  contorna. `/saude` não passa pela licença.

## Rotas

| Método | Caminho    | Corpo                                  | Login           |
|--------|------------|----------------------------------------|-----------------|
| GET    | `/saude`   | —                                      | não             |
| POST   | `/servico` | `{serviceName, requestBody}`           | conforme serviço |

Não há download por chave (`visualizadorArquivos`): a sessão do ERP é a do
usuário técnico, compartilhada por todos os clientes, e quem tivesse a chave
baixaria o documento de outro. Boleto, nota, recibos e relatórios vêm de
`LoopPortalDocumentoSP.gerar`, com o PDF na própria resposta.

Login: cabeçalho `Authorization: Bearer <ID token do Firebase>`.
Erros saem no envelope do Sankhya: `{status: "0", statusMessage, codigoGateway}`.

## Implantação (versão de teste primeiro)

**Uma vez só** (não existe passo por cliente):

1. **Chave do gateway**: gerada no Loop Mais com
   `node scripts/gerar-chave-gateway.js <arquivo.pem> loop-gateway-AAAA-MM`
   (fora do repositório). A chave pública impressa vai em
   `GatewayAssinatura.CHAVES_GATEWAY` de cada Add-on (já está a
   `loop-gateway-2026-11`). Publicar o Add-on novo.
2. **Firebase** (plano Blaze):
   - `firebase functions:secrets:set PORTAL_GATEWAY_CHAVE_PRIVADA --data-file <arquivo.pem>`;
   - `firebase functions:secrets:set PORTAL_SUPABASE_SECRET_KEY` (chave
     secreta do projeto Supabase, leitura de `clientes`/`loopapp`);
   - `.env.<id-do-projeto>` com `PORTAL_SUPABASE_URL` e `PORTAL_GATEWAY_KID`
     (ver `.env.example`; CNPJ e origens NÃO são configurados);
   - `npm install && npm test`;
   - `npm run deploy`.

**Cliente novo**: emitir a licença no Loop Mais. Só isso.
4. **Conferir**:
   - `GET .../portalGateway/saude` → `{"ok":true}`;
   - `POST .../portalGateway/servico` com `DbExplorerSP.executeQuery` → 403.
5. O corte (fechar o Firestore, trocar senhas) só depois do teste do app.
   Ver "Corte para o gateway".

URL: `https://southamerica-east1-<projeto>.cloudfunctions.net/portalGateway`.

## App: versão de teste

O app só usa o gateway quando compilado com a URL; sem ela segue o fluxo
antigo. As duas versões convivem: o Add-on aceita chamadas assinadas (app
novo) e não assinadas (app antigo) até o corte.

```
flutter build web --dart-define=PORTAL_GATEWAY_URL=https://southamerica-east1-<projeto>.cloudfunctions.net/portalGateway
```

- O app envia o JWS do `licenca.json` em `X-Loop-Licenca` (`GatewayPortal.licenca`,
  definido no `main.dart`). Sem licença válida o gateway responde
  `LICENCA_AUSENTE`/`LICENCA_INVALIDA`.
- CORS: qualquer origem por padrão (não há cookie). `PORTAL_ORIGENS_WEB` é
  opcional para travar.
- No modo gateway o app não baixa `apiKey`, não loga no Sankhya, não usa o
  proxy, não lista usuários do Firestore e não grava CPF/telefone lá. O
  usuário do portal vem de `LoopPortalAppSP.meuUsuario`, pelo e-mail do login.
- Para testar, a conta precisa ter o **e-mail confirmado** (o app reenvia o
  link no login) e o mesmo e-mail em `LOOPPORTALUSU.EMAIL`. Clientes atuais
  vão receber o link de confirmação no primeiro login após o corte.
- PIX fica indisponível no modo gateway até o fluxo ir para o servidor (a
  configuração atual entrega o client secret do Bradesco ao app).

## Corte para o gateway

Na ordem, depois de a versão de teste aprovada:

0. No Add-on (Relatórios vinculados), ligar cada relatório ao "Documento no
   portal". Números que o app antigo usava no cliente atual (conferir no
   Sankhya dele antes):

   | Documento no portal         | NURFE |
   |-----------------------------|-------|
   | Boleto                      | 7     |
   | Recibo do inquilino         | 117   |
   | Recibo de repasse           | 52    |
   | Informe de IRRF             | 155   |
   | Imóveis disponíveis         | 181   |
   | Conta corrente do proprietário | 185 |
   | Aluguéis em atraso (proprietário) | 184 |
   | Aluguéis em atraso (inquilino) | 96 |
   | Aluguéis pagos (inquilino)  | 85    |

1. Publicar o app compilado com `PORTAL_GATEWAY_URL` no site de produção.
2. Conferir no Supabase a linha do cliente em `clientes` (`token`,
   `tipoIntegracao`) e as de `loopapp` (produção e teste).
3. Remover o campo `token` de `empresas/{cnpj}` (Firestore).
4. Publicar `../firestore.gateway.rules` (conferir antes com as regras atuais
   do console e o conteúdo de `empresas/{cnpj}/empresa`, que segue legível).
5. **Gerar novo X-Token**: esteve no app (também no código-fonte e no
   histórico do git). Atualizar `clientes.token` no Supabase.
6. Apagar `apiKey` do Firestore (usuário/senha não são mais usados).

A limpeza do campo `pass` (senha em texto gravada por versões antigas) não
depende do corte, pois nada lê esse campo, e pode ser feita já:

```
node scripts/limpar-senhas-firestore.mjs <projeto> <cnpj>            # simula
node scripts/limpar-senhas-firestore.mjs <projeto> <cnpj> --aplicar  # remove
```

## Testes

`npm test`: compila e roda os testes (`test/`). `test/assinatura.test.ts` usa
o mesmo vetor v2 de `GatewayAssinaturaTest.java` no Add-on (chave de teste em
`test/fixtures.ts`): se um lado mudar o formato, os dois testes quebram.
`test/licenca-app.test.ts` cobre a licença enviada pelo app (assinatura,
CNPJ trocado, `alg` diferente, produto ausente).

## Pendências conhecidas

- Documentos (`LoopPortalDocumentoSP`): homologar no Sankhya de teste boleto,
  nota, recibos e cada relatório do imobiliário. Antes, ligar cada relatório
  ao documento no cadastro do Add-on (Relatórios vinculados → "Documento no
  portal"); sem isso o app mostra "não configurado".
- Renegociação: já não passa nativo pelo gateway (`LoopPortalRenegociarSP`).
  Homologar no Sankhya de teste antes do corte: simulação e confirmação de
  parcelamento (juros/multa da faixa, intervalo em dias, primeiro vencimento,
  entrada) e de prorrogação (imobiliário). O Add-on chama os beans nativos
  dentro do servidor; esse caminho não roda fora do Sankhya.
- PIX Bradesco: precisa ir inteiro para o servidor (depende de sandbox).
- Sessão expirada no meio do uso volta como mensagem de erro; o app ainda não
  leva o cliente de volta ao login sozinho.
- Publicação no Supabase (Edge Function): o núcleo (`src/core`, `src/auth`) já
  roda em Deno; falta o ponto de entrada e o login Supabase no app
  (`GatewayPortal.tokenDoLogin`).
