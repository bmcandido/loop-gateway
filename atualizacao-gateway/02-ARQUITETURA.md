# Arquitetura

## Visão geral

```text
Loop Mais ── assina a licença do domínio ──▶ Supabase (licenca_do_dominio)
                                                   │
App no navegador ── busca a licença pelo domínio ──┘
      │
      │ X-Loop-Licenca + login, quando o serviço exige
      ▼
Gateway (Edge Function no Supabase)
      │ credenciais do cliente, lidas pelo CNPJ da licença
      ▼
Sankhya do cliente ── add-on do produto
```

O navegador nunca recebe `token`, `clienteSecret`, senha, SMTP ou token de WhatsApp.

## O que o gateway faz em cada chamada

1. Lê o CNPJ da licença assinada e confere se ela vale para o produto do serviço. A licença de um produto não abre outro.
2. Valida o login. Vendedor do Ecommerce também é conferido como vendedor ativo.
3. Aceita só os serviços de `src/core/servicos.ts`. Serviços nativos e SQL livre ficam fora, salvo as exceções filtradas.
4. Chama o Sankhya com as credenciais do cliente, no contexto do add-on (`/gateway/v1/<contexto>/service.sbr`).
5. Retira campos sensíveis da resposta.

Níveis de acesso: `PUBLICO`, `USUARIO` e `VENDEDOR`.

| App | Contexto do add-on | Produto |
|---|---|---|
| Portal | `loop-portal` | `LoopPortal` |
| Ecommerce | `loop-b2bb2c` | `LoopEcommerce` |
| Hub | `loop-whatsapp` | `LoopWhatsApp` no add-on |
| Link | `loop-link-pagamento` | `LoopPaymentLink` |
| Delivery | `loop-delivery` | `LoopDelivery`, em gateway próprio (a criar) |
| Stok | `loop-stock` | `LoopStok`, no `stok-gateway` (a criar) |
| Expense | `loop-expense` | `LoopExpense`, no `expense-gateway` |

## Licença em três camadas

| Camada | Onde | Papel |
|---|---|---|
| 1 | App | Busca pelo domínio e confere a assinatura; mostra a tela de licença |
| 2 | Add-on | `LicencaLoop.exigir()`, com RPC `licenca_status` e cache |
| 3 | Gateway | Recusa a chamada sem licença válida |

Regras:
- Uma licença por contrato, com todos os produtos; um contrato pode ter vários domínios.
- O Dev Manager não trata licença e o app não leva `licenca.json`.
- **Publicar o site antes de cadastrar o domínio tira o site do ar.**

## Migration 175

`anon` e `authenticated` só leem as colunas liberadas de `clientes` e `loopapp`. `select=*` é recusado e coluna nova nasce fechada. Por isso Link, Delivery, Stok e Expense ficaram parados: leem credenciais dessas tabelas pelo navegador.

## WhatsApp

```text
App ─▶ Gateway /servico ─▶ Hub (LoopHubMensageriaSP.doEnviarMensagem)
                              │ chave do cliente + instância da empresa
                              ▼
                          Gateway /loopapi ─▶ Loop API (token único)
```

- O gateway só repassa operações liberadas e só para instâncias terminadas em `_<CNPJ>` da chave.
- Add-on sem chave pede em `/loopapi/entregar`: o gateway grava a chave assinada no Sankhya daquele CNPJ e a resposta não a contém.
- O Hub envia texto e PDF (até 5 MB). PDF não fica gravado e não pode ser reenviado pela Central. Na Meta, só texto por enquanto.
- O add-on do Link lê a chave e a instância direto de `LOOPWHATSAPPCONFIG` e chama `/loopapi`.

## Publicação do gateway

Push na `main` que altere `src/`, `supabase/functions/`, `supabase/config.toml`, `package.json`, `package-lock.json` ou `tsconfig.json`:

1. Roda os testes; se falharem, não publica.
2. Publica `portal-gateway` e `expense-gateway`.
3. Confere `/saude` dos dois.

Arquivo: `loop-gateway/.github/workflows/publicar.yml`. Segredos da função continuam no Supabase.

## Padrão de cada app

| Parte | O que copiar | Observação |
|---|---|---|
| Licença | `licenca_assinatura`, `licenca_config`, `licenca_verificacao`, provider | Ajustar `_slugPorProdutoId` e o produto |
| Tela de licença | `licenca_estado_page`, `licenca_estado_vista` | Marca Loop, igual em todos |
| Colunas | `lib/services/supa_base/colunas_publicas.dart` | Sem `select=*` |
| Gateway | `gateway_ecommerce.dart` como modelo | Nada de credencial no app |
| Add-on | `LicencaLoop` + teste | Consulta atrás de `LicencaLoop.Consulta` |
| Build | `loop-build.json` com `PORTAL_GATEWAY_URL` | Sem parâmetro manual |
| Carregamento | `web/index.html`, `web/splash`, `LoadingPage` | Marca Loop |
| Ícone | Neutro no app; `iconeCliente` no `loop-build.json` | Rota do produto no gateway |
