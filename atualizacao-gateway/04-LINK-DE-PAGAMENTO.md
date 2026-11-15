# Link de Pagamento

Pastas: `loop-link-pagamento/loop-link` (app) e `loop-link-pagamento/loop-link-sankhya-addon` (contexto `loop-link-pagamento`). Produto: `LoopPaymentLink` (id `fd989b99-b8fd-4a99-b710-aa7b2f100998`). O usuário confirmou que não há produção, então links antigos não precisam continuar valendo.

## Andamento

Ramo `feat/link-gateway` no app e no add-on. A `main` só recebe quando estiver completo.

| # | Etapa | Situação |
|---|---|---|
| 1 | Token e `doAbrirLink` | **Feito** (`ecfee9a`), instalado na base local |
| 2 | Consumidores do link | **Feito** (`ecfee9a`): invalidação, botão manual e WhatsApp |
| 3 | `LicencaLoop` | **Feito** (`ecfee9a`): página pública e pagamento |
| 4 | Leituras | **Feito** (`20f73e6`, `8aa6b4e`): consultas fixas no add-on, pedido vindo do token |
| 6 | Gateway | **Parte feita** (`bf69579`, publicado): produto e `doAbrirLink`/`doConsultar`. Faltam os serviços de pagamento |
| 7 | App: licença | **Parte feita** (`7fa105d`): domínio, colunas públicas e `loop-build.json`. Falta a tela de licença padrão |
| 8 | App: gateway | **Parte feita** (`7fa105d`): abertura e consultas. Faltam as gravações |
| 5 | Gravações | **Falta**: tentativa, TEF, log, adiantamento e baixa |
| - | Pagamento pelo gateway | **Feito** (`399229e`, `04e12a6`): modo, processamento, Pix e imagens conferem o token. Cartão aprovado em sandbox pelo Gateway da Cielo; pós-pagamento no servidor; Pix aguarda afiliação |
| - | Proxy | **Falta**: e-mail, PDF e Bradesco do canal antigo |
| 9 | App: visual | **Parte feita** (`c54e39b`, `2e10b83`, `72bc664`): identidade ao abrir, favicon na tela, `/icone/link`. Faltam acentos roxos fixos e a tela de licença padrão |
| 10 | Ecommerce | **Falta**: geração do link no servidor |
| 11 | Testes e documentos | **Falta** |

### Testado de ponta a ponta em 02/11/2026

Build local, gateway de produção e Sankhya local, com o pedido de teste 195 (dados de teste revertidos):

- A URL leva só o token; a página mostra comprador, produtos e total.
- Link invalidado não mostra o pedido, mas a situação do pagamento continua consultável.
- Token inexistente, formato antigo, SQL no lugar do nome da consulta e chamada sem token são recusados.
- Credenciais da operadora: 4 preenchidas com `DADOSENCRIPTADOS = N`; nenhuma com `S`.

**Ainda não testado:** geração do link por um pedido real, porque não há forma de pagamento com cartão na base local, e o pagamento, que depende das gravações. O domínio configurado para o Link (`frutospagamentos.loopapp.com.br`) não tem licença cadastrada; o teste usou a licença de outro domínio do mesmo contrato.

### Defeitos corrigidos no teste de ponta a ponta

| Defeito | Efeito | Commit |
|---|---|---|
| Link não acompanhava a URL da configuração | Pedido gerado antes da troca ficava com o domínio antigo | `506dea2` |
| `V002.xml` sem `CREATE VIEW` | `VW_LOOP_RECORRENCIA` não era criada e o agendamento de recorrência falhava | `506dea2` |
| Botão manual consultava `VW_LOOPRECORRENCIA` | Nome inexistente | `506dea2` |
| `LOOPPAYMENTLINKCRYPTO` com colunas de 100 posições | Chave do canal seguro não era gerada | `082510c` (V004) |
| Mesma `idempotencyKey` em toda tentativa | Cartão recusado nunca podia tentar de novo | `cfefb89` |
| Motivo da Cielo descartado | Só "rejeitado" no registro | `3c90cdf` |
| `data` vazio no `PaymentRequest` | Canal seguro enviava pedido sem `Payment` à Cielo (erro 119) | `6c547ea` |
| Identidade aplicada só ao pagar | Página abria sempre com o tema padrão | `2e10b83` |

**Bloqueio atual:** Cielo 314 "Invalid Integration" com as credenciais de sandbox (são da Cielo, confirmado pelo usuário em 03/11/2026). URL corrigida para `apisandbox.cieloecommerce.cielo.com.br`.

**Diagnóstico de 03/11/2026, chamando o sandbox direto, com cartão de teste:**

| Teste | Resposta |
|---|---|
| Venda: ID e chave inventados | 401 |
| Venda: ID real, chave inventada | 401 |
| Venda: ID e chave reais, pedido mínimo da documentação | 400, código 314 |
| Venda: ID e chave reais, campos do app adicionados um a um | 400, código 314 em todos |
| Pix: ID e chave reais | 400, código 314 |
| Consulta de venda inexistente: ID e chave reais | 404 (autenticou) |

~~Conclusão inicial: problema na conta sandbox.~~ Corrigida no mesmo dia pelos testes abaixo.

**Teste nos endereços da Braspag (03/11/2026), com as mesmas credenciais:**

| Chamada | Resposta |
|---|---|
| `POST apiquerysandbox.braspag.com.br/v2/sales` | 405 (endereço só de consulta) |
| `POST apisandbox.braspag.com.br/1/sales` | 404 (origem do erro 404 da 1ª tentativa) |
| `POST apisandbox.braspag.com.br/v2/sales` sem `Provider` | 400, código 129 "Affiliation not found" |
| `POST apisandbox.braspag.com.br/v2/sales`, `Provider=Simulado`, campos do app | **201, Status 2 (capturada)** |
| Mesmo POST, cartão de final 2 | 201, Status 3 (recusa simulada) |
| `GET apiquerysandbox.braspag.com.br/v2/sales/{id}` | 200, Status 2 |
| Pix sem `Provider` | 400, código 133 |
| Pix com `Simulado` ou `Cielo2` | 400, código 129 |

Conclusão: as credenciais funcionam na API da Braspag, não na API E-commerce Cielo. A troca de `URLSANDBOX` para `cieloecommerce` foi o que levou ao 314; o erro original era o caminho `/1/sales`. Cartão simulado funciona; Pix depende de afiliação habilitada.

A API é o **Gateway da Cielo**, que usa os endereços da Braspag ([documentação](https://docs.cielo.com.br/gateway/reference/debito-api)). O add-on foi ajustado (classe `CieloApi`).

**Teste pela tela em 03/11/2026, pedido 196, sandbox:** `doProcessar` = PAID, tela "Pagamento Realizado!", `LOOPPAYMENTLINKPAGTO` sequência 6 = PAID. Nova tentativa no mesmo link não gera outra venda (mesma chave de idempotência).

**Pós-pagamento no servidor (03/11/2026, `d337d73` e `e080259`):** no canal seguro o add-on grava os detalhes da tentativa, invalida o link e aplica a gestão, sem login do site. Falha fica em `LOOPPAYMENTLINKLOG` e não muda a resposta ao cliente.

| Gestão | O que acontece |
|---|---|
| `GERADTO` | Gera o adiantamento e baixa a receita se `BAIXARCOMPENSACAO = SIM` ou, no cartão, `BAIXARCARTAO = SIM` |
| `ADTOBAIFAT` | Gera o adiantamento |
| `BAIXAFAT` | Baixa os títulos em aberto da nota |
| `NENHUM` | Nada |

Fora `NENHUM`, grava o TEF de cada título da nota. O adiantamento é localizado pelo histórico antes de gerar, então uma nova tentativa não duplica.

**Validade do link:** `TGFCAB.LOOP_LINKVALIDO` (S/N) e `TGFCAB.LOOP_DHEXPLINK` (vazia quando não há `VALIDADELINK`). A abertura recusa link vencido na hora; o job de 5 minutos invalida o que venceu, foi pago ou baixado, e sincroniza o pedido com `LOOPPAYMENTLINK.LINKVALIDO`. Links antigos ficam sem data de expiração.

**Testado na base local, pedido 196:** tentativa com cartão mascarado, adiantamento (títulos 146 e 147, compensação 21), baixa da receita (movimento 33, conta 5 usada só no teste), TEF nos títulos 141 e 142, link inválido nas duas tabelas. Link vencido recusado e invalidado pelo job; link dentro do prazo abre.

**Link aberto x link do pedido:** `doAbrirLink` recebe `url` (endereço aberto) e compara com `TGFCAB.LOOP_LINKPAGAMENTO`: protocolo, domínio, porta, caminho e token precisam bater; parâmetros acrescentados por apps de mensagem não contam. Se não bater, responde `INDISPONIVEL`, sem dizer se o pedido existe ou foi pago. Pagamento e consultas recusam o token que não é o do link gravado no pedido. A URL vem do navegador: a barreira de acesso continua sendo o token. Add-on e site precisam ser publicados juntos. Para testar fora do domínio configurado, ajustar o link do pedido na base de teste.

**Link encerrado:** `doAbrirLink` devolve `motivo` (PAGO, EXPIRADO ou INDISPONIVEL) e o site mostra `/link-encerrado/<situacao>`, sem debug nem nova tentativa. A tela `/erro` fica só para falha ao validar o link. A tela não usa logo nem cores do cliente, porque a configuração só é lida com link válido.

**Falta:**

- Gravar os dois campos ao gerar um link novo: código pronto, sem teste real (o teste usou dados ajustados por SQL).
- Reativação manual do link: sem teste.
- Conta 3 sem saldo inicial em `TGFSBC`: a baixa é recusada com ORA-20101. Cadastro a acertar.
- Pix: erro 129 "Affiliation not found" no sandbox; depende de habilitação na Cielo. Consulta de status e pós-pagamento do Pix sem teste.
- Bradesco: a reconciliação do Pix por job não chama o pós-pagamento.
- Recorrência no canal seguro: envia só `Recurrent`, sem o agendamento que o canal antigo cria.
- Provider de cartão em produção (`Cielo30`), `/1/card` e débito (`ReturnUrl`, `Authenticate`) no Gateway: sem teste.
- Acentos gravados quebrados em `MOTIVO`: o build não define encoding.

**A verificar no Pix:** o cliente consulta `/1/sales/<id>` na mesma URL da venda, e a Cielo tem endereço próprio de consulta (`apiquerysandbox`).

**Propagação da URL:** o SQL foi testado à mão nos pedidos 196 e 198; o salvar pela tela ainda não.

**Bradesco:** usa `CONF.URL` como endereço do proxy. Apontar esse campo para o site do Link quebra esse canal.

## Descobertas de 02/11/2026

**1. Existem dois canais de pagamento**, escolhidos por `LOOPPAYMENTLINKCONFIG.DADOSENCRIPTADOS`:

| Canal | Valor | Como funciona |
|---|---|---|
| Add-on | `S` | Dados do cartão criptografados e processados no servidor (`LoopSecurePaymentSP`) |
| Antigo | `N` | O navegador recebe senha e chaves da operadora por SQL e chama Cielo e Bradesco. A configuração da base local está assim |

**Decisão do dono do produto (02/11/2026): os dois canais continuam, e o parâmetro segue valendo.** Para o canal antigo funcionar pelo gateway, o add-on entrega as credenciais só com `DADOSENCRIPTADOS = N` e só para um link válido da própria empresa. Com `S`, não entrega.

**Risco aceito por enquanto:** com `N`, quem tem um link válido consegue extrair as credenciais da operadora no navegador. Antes da produção, cada cliente deve usar `S`, como pede `docs/PRODUCAO.md`.

**2. Recorrência: sem defeito encontrado.** No canal antigo, `cieloToken` tokeniza o cartão e guarda o token; foi testado pelo usuário e não será alterado. No add-on, o crédito envia `Recurrent` com `SaveCard: false`; não foi verificado se as cobranças seguintes funcionam por esse canal. `TipRecCielo.cieloRecorrente` responde "ainda não implementado".

**3. Depois do pagamento, quem grava é o navegador.** `sumary_widget.dart` grava a tentativa, gera adiantamento, baixa títulos, grava TEF e envia e-mail. Nesta etapa isso passa para serviços com token, com o mesmo comportamento. Quem chama esses serviços ainda pode registrar pagamento sem ter pagado: levar a decisão para a resposta da operadora é melhoria posterior.

**4. `doProcessar` confere empresa e valor, mas o pedido vem do navegador.** Passa a ser conferido contra o token.

**5. Log:** com a depuração ligada, `_processarCreditoComToken` grava o token do cartão. Corrigir.

## Parte 1: link mascarado

### O problema

O link gerado hoje abre tudo:

```text
https://dominio/#/pgo/<CNPJ>&OP=CIELO&TIP=CC&PD=<NUNOTA>&VALID=TRUE
```

| Dado exposto | Risco |
|---|---|
| CNPJ da empresa | Revela o cliente; desnecessário com a licença por domínio |
| Operadora e forma de pagamento | Revela a configuração |
| `NUNOTA` | É sequencial: trocar o número abre o pedido de outra pessoa (IDOR) |
| `VALID=TRUE` | Quem edita o link "revalida" um link vencido, porque o app confia na URL |

Portanto, esconder o texto não basta. O servidor precisa decidir a validade e saber a qual pedido o link pertence. `docs/PRODUCAO.md` já pede isso nos itens 3, 4 e 6.

### A solução: token opaco

```text
https://dominio/#/pgo/x7Kp2mQ9vL3nR8sT1wYb4A
```

- **Token:** aleatório, com 128 bits de `SecureRandom`, em base64url. Não dá para deduzir nem decodificar.
- **Tradução:** o add-on guarda a relação token → pedido e devolve ao app os mesmos dados que hoje ele lê da URL.
- **Validade:** passa para uma coluna no servidor.

Escolhi token aleatório, e não dados criptografados na URL, porque ele pode ser invalidado, não expõe nada mesmo se a chave vazar e deixa a URL curta.

### Fluxo

```text
Gerar (evento da nota ou botão)
  └─ grava TOKENLINK e LINKVALIDO em LOOPPAYMENTLINK
  └─ grava a URL limpa em TGFCAB.LOOP_LINKPAGAMENTO

Abrir
  App lê o token ─▶ Gateway (público, licença do domínio)
      ─▶ LoopPaymentLinkPublicoSP.doAbrirLink { token }
      ◀─ { valido, operadora, tipoPagamento, tipoDocumento, codEmp, pedido }

Depois
  Todo serviço público recebe o token, e o add-on resolve o pedido por ele.
  O app nunca escolhe o NUNOTA.
```

### O que muda

| Lugar | Hoje | Depois |
|---|---|---|
| `PaymentLinkGravarLinkDAO` | Monta a URL com os dados | Gera o token e monta a URL limpa |
| `PaymentLinkInvalidLinkDAO` | Troca `=TRUE` por `=FALSE`; busca `LIKE '%=TRUE'` | Atualiza `LINKVALIDO` |
| `GerarLinkManualWhatsApp` | Troca `=FALSE` por `=TRUE` | Revalida na coluna; usuário segue no mesmo botão |
| `WhatsAppLinkHelper` | `endsWith("=TRUE")` e `LIKE` | Consulta `LINKVALIDO` |
| E-mail e Delivery | Só exibem o link | Sem mudança |
| Ecommerce `link_pagamento_sankhya_provider` | Monta o link com SQL no navegador | Chama serviço do add-on do Link pelo gateway |
| App `loop_app_validate_link_provider` | Lê a URL com expressão regular | Só extrai o token e chama `doAbrirLink` |
| App `config_app.dart` | Rotas de teste com CNPJ real | Rotas removidas |

`linkValid`, `numeroPedido`, `operadora` e `paymentTip` continuam existindo no provider, para o resto do app seguir como está.

### Regras de segurança

1. Token inválido, vencido e pedido inexistente têm a mesma resposta: "Link inválido ou expirado".
2. Log nunca grava o token inteiro.
3. Gateway só aceita token no formato esperado, antes de chamar o Sankhya.
4. Índice único em `TOKENLINK`.
5. `doAbrirLink` devolve só o necessário para a página.

## Parte 2: licença e gateway

### Hoje o app faz pelo navegador

| Operação | Como | Destino |
|---|---|---|
| Login no Sankhya | `clienteSecret`, `token` | Serviço do add-on não precisa de login no app |
| Dados do pedido | SQL (`cart_sankhya_provider`) | `doAbrirLink` / `doPedido` |
| Financeiro, configuração, situação do pagamento | SQL | Serviços públicos com token |
| Informação de pagamento, log de erro, TEF | `CRUDServiceProvider`, `DatasetSP` | Serviços do add-on |
| Baixa e adiantamento | Serviços nativos | Serviços do add-on com token, mesmo comportamento |
| Cartão e Pix, canal `S` | `LoopSecurePaymentSP` (já no add-on) | Mantém; `orderId` conferido contra o token |
| Cartão e Pix, canal `N` | Navegador chama a operadora | Mantém; credenciais vêm de serviço com token |
| Cliente e produtos | `clientes` no Supabase | Licença do domínio |
| E-mail, Bradesco, PDF | `proxy-cors` | Avaliar serviço do add-on |

### Etapas

| # | Etapa | Entrega |
|---|---|---|
| 1 | Token e `doAbrirLink` | Campos, geração, serviço e testes |
| 2 | Consumidores do link | Invalidação, botão manual e WhatsApp |
| 3 | `LicencaLoop` | No ponto de entrada dos serviços públicos e do pagamento |
| 4 | Leituras | Pedido, financeiro, configuração e situação em serviços com token |
| 5 | Gravações | Informação de pagamento, TEF, log; baixa e adiantamento no servidor |
| 6 | Gateway | Produto `LoopPaymentLink`, contexto e regras públicas, com testes |
| 7 | App: licença | Domínio, tela de licença, colunas públicas e `loop-build.json` |
| 8 | App: gateway | Chamadas pelo gateway; retirar login e credenciais |
| 9 | App: visual | Carregamento padrão, identidade e ícone |
| 10 | Ecommerce | Geração do link pelo serviço novo |
| 11 | Testes e documentos | Pagamento em sandbox, IDOR e `05-APPS-WEB.md` |

### Pontos a confirmar na execução

- Baixa e adiantamento rodam no navegador depois do `doProcessar`? Se o orquestrador já cobre parte, não duplicar.
- `requireAuthenticated()` em `LoopSecurePaymentController` aceita a sessão do gateway.
- Tamanho e dicionário de `LOOPPAYMENTLINK`.
- Webhook `webhooks/webhook-link-pagamento` não depende do formato antigo; ele usa `config.json` com chave do Supabase, a conferir.

## Implantação

1. Contrato com o produto e domínio cadastrado no Loop Mais.
2. `publishAddon` com atualização de dicionário.
3. Publicar o site pelo Dev Manager.
4. Pagar um pedido em sandbox, com cartão e Pix.

## Testes obrigatórios

- Link novo abre e mostra o pedido certo; a URL não traz nenhum dado.
- Token inventado, token alterado e token de link invalidado: mesma mensagem.
- Token de um pedido não abre outro; `orderId` diferente no corpo é ignorado ou recusado.
- Reabrir link pago mostra "pagamento já realizado".
- Invalidação, botão manual, envio por WhatsApp e envio por e-mail seguem funcionando.
- Site sem domínio cadastrado mostra `LIC-DOMINIO`.
- Sem credencial no JavaScript publicado.
