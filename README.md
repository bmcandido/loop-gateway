# Gateway do Portal do Cliente

O app deixa de falar direto com o Sankhya. Ele chama este gateway com o token de
login do cliente; o gateway confere o token, chama o Sankhya com as credenciais
do servidor e envia ao Add-on a identidade do cliente assinada (HMAC).

Login no Sankhya só por OAuth (client_credentials). As credenciais vêm do
Supabase, como no app: `clientes` (pelo `PORTAL_CNPJ`: `token` = X-Token e
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

1. **Gerar o segredo** (uma vez por cliente):
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
2. **Sankhya**: definir `LOOPPORTAL_GATEWAY_SECRET` com esse valor no processo do
   servidor (variável de ambiente ou `-DLOOPPORTAL_GATEWAY_SECRET=...` no
   `standalone.conf`) e reiniciar. Publicar o Add-on novo.
3. **Firebase** (plano Blaze):
   - `firebase functions:secrets:set PORTAL_GATEWAY_SECRET` (mesmo valor);
   - `firebase functions:secrets:set PORTAL_SUPABASE_SECRET_KEY` (chave
     secreta do projeto Supabase, só leitura de `clientes`/`loopapp`);
   - copiar `.env.example` para `.env.<id-do-projeto>` e preencher
     (`PORTAL_CNPJ`, `PORTAL_SUPABASE_URL`, `PORTAL_ORIGENS_WEB`);
   - `npm install && npm test`;
   - `firebase deploy --only functions:gateway`.
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

- Publicar em um site de teste do Hosting e colocar a origem dele em
  `PORTAL_ORIGENS_WEB` (sem isso o navegador recebe 403).
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
o mesmo vetor de `GatewayAssinaturaTest.java` no Add-on: se um lado mudar o
formato, os dois testes quebram.

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
