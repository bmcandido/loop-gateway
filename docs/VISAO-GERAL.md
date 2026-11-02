# Loop Gateway: para que serve

O Loop Gateway é o **intermediário seguro entre os apps Loop e o Sankhya de cada cliente**. O app não fala direto com o Sankhya: fala com o gateway, que confere quem está pedindo e faz a chamada usando credenciais que só ele conhece.

Existe um único gateway para todos os clientes. Ele roda no Supabase, como Edge Function, no projeto de produção `loopappConfig` (`zvncvdlfyeyktnuzxvlc`). Publicar uma versão muda o comportamento de **todos os clientes na hora**.

## O problema que ele resolve

Sem o gateway, o navegador precisava ter o token e a senha do Sankhya, e qualquer pessoa conseguiria extraí-los. O mesmo vale para o token único da Loop API. Com o gateway, esses segredos ficam só no servidor.

```text
App ──(login + licença assinada)──▶ Gateway ──(credenciais do cliente)──▶ Sankhya / Add-on
Add-on do WhatsApp ──(chave do cliente)──▶ Gateway ──(token único)──▶ Loop API
```

## O que acontece em cada chamada

1. **Licença:** o cliente (CNPJ) vem da licença assinada pelo Loop Mais, no cabeçalho `X-Loop-Licenca`. O gateway confere a assinatura e se o produto está ativo.
2. **Login:** valida o token do usuário. No Ecommerce, confere também se ele é um vendedor ativo.
3. **Filtro:** só passam os serviços da lista fechada em `src/core/servicos.ts`. As consultas SQL livres passam pelo filtro de `src/core/filtro-sql.ts`.
4. **Chamada:** busca as credenciais daquele cliente no Supabase e chama o Sankhya dele.
5. **Resposta:** retira campos sensíveis, como a senha de SMTP, antes de devolver ao app.

## Quem usa

| Projeto | Para quê | Como |
|---|---|---|
| Portal do Cliente | Login, financeiro, documentos e relatórios | `POST /servico`, identidade assinada para o Add-on |
| Ecommerce | Abertura da loja, vendedor, pedidos, PDF e relatórios | `POST /servico` |
| Dev Manager | Ícone do cliente ao publicar o site | `POST /icone`, `POST /icone/ecommerce` |
| Add-on do WhatsApp (Hub) | Falar com a Loop API sem expor o token único | `/loopapi/*` |
| Loop Expense | Gateway próprio do app | Função `expense-gateway` |

Link de Pagamento, Stok e Delivery ainda não passam pelo gateway.

## Rotas de `portal-gateway`

| Rota | Função | Quem pode chamar |
|---|---|---|
| `GET /saude` | Conferir se está no ar | Qualquer um |
| `POST /servico` | Chamar um serviço do Sankhya | Licença válida; login conforme o serviço |
| `POST /icone`, `POST /icone/ecommerce` | Devolver o ícone do cliente | Domínio com licença |
| `/loopapi/instance/*`, `/loopapi/message/*` | Repassar à Loop API só as operações que o Add-on usa | Chave do cliente, licença `LoopWhatsApp` e instância terminada em `_<cnpj>` |
| `POST /loopapi/entregar` | Gravar a chave do cliente no Sankhya dele | Qualquer um, mas a resposta não traz a chave. Limite de um pedido por CNPJ a cada 30 s |

## Loop API

O token da Loop API é único para todos os clientes e fica só nos segredos do gateway. O Loop Mais gera uma chave para todo cliente, com ou sem o produto, na tabela fechada `public.clientes_chaves_loopapi`.

Quando o Add-on não tem chave, ele chama `/loopapi/entregar`. O gateway grava a chave assinada no Sankhya daquele CNPJ, pelo serviço `LoopWhatsappChaveSP`, usando as credenciais do próprio cliente. A chave nunca pode ir para a licença, porque `licenca_status` é pública por CNPJ.

## Estrutura

```text
src/core/        regras: gateway, serviços liberados, filtro SQL, licença, Loop API, ícone
src/auth/        validação de login (Supabase Auth; Firebase só para o legado)
src/http/        handler HTTP (Request → Response) usado pela Edge Function e pelos testes
src/expense/     gateway do Loop Expense
src/firebase/    versão antiga em Firebase, sem deploy
supabase/        configuração e entrada das Edge Functions
test/            testes (node:test)
scripts/         scripts de apoio
```

## Segredos

Ficam nos segredos do Supabase, nunca no repositório.

| Segredo | Para quê |
|---|---|
| `PORTAL_GATEWAY_CHAVE_PRIVADA` | Assinar a identidade e a entrega de chave. A chave pública vai embarcada nos Add-ons |
| `PORTAL_GATEWAY_KID` | Identificador da chave em uso |
| `PORTAL_FIREBASE_PROJETOS` | Projetos Firebase aceitos (legado) |
| `PORTAL_ORIGENS_WEB` | Origens permitidas (CORS) |
| `PORTAL_EXIGE_EMAIL_VERIFICADO` | Desligar a exigência de e-mail confirmado para todos |
| `LOOPAPI_URL`, `LOOPAPI_TOKEN` | Endereço e token único da Loop API |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos pela plataforma. O log guarda só metadados: nunca corpo, cabeçalhos, e-mail, CPF ou chave.

## Como desenvolver e publicar

**A publicação é automática.** Um push na `main` que altere `src/`, `supabase/functions/`, `supabase/config.toml`, `package.json`, `package-lock.json` ou `tsconfig.json` roda os testes e, se passarem, publica `portal-gateway` e `expense-gateway` e confere `/saude` dos dois (`.github/workflows/publicar.yml`). Teste falhando impede a publicação. Acompanhe em `gh run list -w publicar.yml`.

O workflow usa o segredo `SUPABASE_ACCESS_TOKEN` do repositório. Para cadastrar ou trocar:

```bash
gh secret set SUPABASE_ACCESS_TOKEN -R bmcandido/loop-gateway
```

Para publicar de novo sem alterar código: `gh workflow run publicar.yml -R bmcandido/loop-gateway`. Segredos da função (`LOOPAPI_TOKEN` e outros) continuam no Supabase e não passam pelo workflow.

Publicação manual, se o GitHub estiver fora do ar:

```bash
npm install
npm test
npm run deploy    # roda os testes e publica portal-gateway
```

Para publicar a função do Expense:

```bash
npx supabase functions deploy expense-gateway --project-ref zvncvdlfyeyktnuzxvlc --no-verify-jwt --use-api --yes
```

Depois de publicar, `GET .../portal-gateway/saude` deve responder `{"ok":true}`.

**O Dev Manager não publica mais o gateway junto com o Portal.** Se um app depender de um serviço novo, publique o gateway antes de compilar o app.

## Cuidados ao alterar

- **Serviço novo:** entra em `src/core/servicos.ts`, senão o gateway responde `SERVICO_NAO_PERMITIDO`.
- **Retirar um serviço:** afeta todos os clientes na publicação, inclusive os que têm app ou Add-on antigo.
- **Chave privada:** para trocar, inclua a nova pública nos Add-ons, publique os Add-ons e só depois troque `PORTAL_GATEWAY_CHAVE_PRIVADA` e `PORTAL_GATEWAY_KID`.
- **Chaves de teste:** as chaves em `test/` são só de teste.

## Diferença para o `loop-licence`

| | Loop Gateway | `loop-licence` (Central de Licenças) |
|---|---|---|
| Papel | Intermedia as chamadas dos apps | Gerencia licenças por cliente, produto e instalação |
| Onde roda | Supabase | `licencas.loopapp.com.br`, servidor próprio |
| Situação | Em uso | Publicada, sem produtos integrados |

A licença em uso hoje vem do Loop Mais e do Supabase (`licenca_status`, `licenca_do_dominio`). A documentação de licenciamento está em `loop-central/loop-admin/docs/licenciamento/`.
