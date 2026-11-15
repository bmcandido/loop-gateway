# Situação atual

Posição em 02/11/2026. Confira com `git log` antes de confiar em um commit.

## Gateway

Repositório próprio em `D:\workspace-loop\loop-gateway` (`bmcandido/loop-gateway`, hoje **público**). Saiu de dentro do `loopPortal` em `cf1e468`.

| Commit | O que fez |
|---|---|
| `bd1078e` | Repositório próprio, com `docs/VISAO-GERAL.md` |
| `f74fa35` / `233c9d8` | Chave da Loop API vem do Loop Mais e é entregue assinada |
| `1c60bb0` | Rota `/loopapi/*` |
| `3d6bd24` | Erro de rede só com categoria, sem texto bruto |
| `67a50d6` | Vendedor envia WhatsApp pelo Hub do cliente |
| `f2b8b4b` | Publicação automática pelo GitHub Actions |

**No ar:** `portal-gateway` e `expense-gateway` respondem em `/saude`. A publicação da `f2b8b4b` terminou com sucesso. O segredo `SUPABASE_ACCESS_TOKEN` está cadastrado no repositório.

**Produtos aceitos hoje:** `LoopPortal` e `LoopEcommerce`. Cada app novo precisa entrar em `ProdutoGateway`, `PRODUTOS_ACEITOS` e `SERVICOS`.

## Portal e Ecommerce (referência)

Já têm licença por domínio, colunas públicas, identidade visual vinda do add-on e chamadas pelo gateway.

| Repositório | Commits principais |
|---|---|
| Ecommerce app | `d3cb8be` licença e colunas; `3e6e3af` loja pelo gateway; `ea65bc5` e `3c7f896` vendedor; `5394588` ícone; `e8fcc82` documentos; `a962f49` pesquisa em relatórios; `259df11` sem token do WhatsApp |
| Ecommerce add-on | `2bcc3da`, `195bbde`, `65e5a22`, `1d7da6b`, `5ad4a43` |
| Portal app | `418a31f` pesquisa em relatórios; `f1ba0d6` sem token do WhatsApp |
| Portal add-on | `61ca81f`, `647c264`, `5b518c9` |

## WhatsApp: token fora dos apps

O token da Loop API é único para todos os clientes e fica só nos segredos do gateway. Cada cliente tem uma chave própria, gerada no Loop Mais (migration `V20261102_181`) e entregue assinada ao Sankhya.

| App | Antes | Agora | Commit |
|---|---|---|---|
| Hub | Gravava em `clientes` (fechada) | Só em `LOOPWHATSAPPCONFIG`; passou a enviar PDF | `b5c1786`, `5232c79` |
| Ecommerce | Token no site | Pelo gateway e pelo Hub | `259df11`, `5ad4a43` |
| Delivery | Token no site, instância `LOOP_COMERCIAL` | Pelo Hub, com a instância da empresa | `a6cbb7b` |
| Link | Lia `clientes` e gravava o token no log | Add-on usa a chave do Hub, pelo gateway | `b22b99c`, `35575f8` |
| Portal | Só declarava | Removido | `f1ba0d6`, `5b518c9` |
| Stok, Expense | Não tinham | Nada a fazer | - |

## Outras entregas desta fase

- **Relatórios com `NOMETABELA`:** o filtro vira pesquisa na tabela e envia a PK. Ecommerce e Portal na `main`; Stok em ramo (`3635927`, `69f0dee`).
- **`TGFTOP`/`TGFTPV`:** pesquisa agrupada pela última versão.
- **Tabelas `TIM*` no Portal:** lista fechada de 10 cadastros.
- **`DECVLR` nulo:** tratado como 0, sem casas decimais e sem update em massa.

## O que falta publicar

| Item | Quem | Estado |
|---|---|---|
| Add-ons (`publishAddon`): Hub, Link, Ecommerce, Portal | Usuário | Instalados só na base local |
| Sites: Ecommerce, Delivery, Link, Portal | Usuário, pelo Dev Manager | Publicados ainda têm o token antigo |

## Levantamento do banco

`clientesProdutos`, lido em 02/11/2026:

| Produto | Clientes | | Produto | Clientes |
|---|---|---|---|---|
| `LoopSign` | 15 | | `LoopEcommerce` | 6 |
| `LoopWhatsApp` | 14 | | `LoopHub` | 5 |
| `LoopPaymentLink` | 13 | | `LoopPortal` | 3 |
| `LoopDelivery` | 12 | | `LoopConferencia` | 3 |
| `LoopExpense` | 2 | | `LoopSeparacao` | 3 |
| `LoopStok` | 2 | | `LoopFinanceiro` | 1 |

Também aparecem `LoopProducao` (2), `LoopComex` (2), `LoopOrdemServico` (1) e `LoopMais` (1).
