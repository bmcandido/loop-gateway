# Plano por app

## Levantamento (02/11/2026)

| | Link | Delivery | Expense | Stok |
|---|---|---|---|---|
| Licença no app | não tem | não tem | tela antiga, sem domínio | não tem |
| Gateway | não usa | não usa | `expense-gateway` | não usa |
| `LicencaLoop` no add-on | não | não | não | não |
| Arquivos do app com credencial | 9 | 5 | 4 | 4 |
| Arquivos com serviços nativos | 5 | 8 | não medido | 19 |
| Serviços do add-on usados pelo app | 4 | 18 | não medido | 25 |
| Controllers no add-on | 6 | 24 | 16 | 36 |
| Clientes cadastrados | 13 | 12 | 2 | 2 + 3 + 3 |
| Estado do código | `main` | app na `main`; add-on em ramo, 3 commits à frente | 9 e 102 alterações não commitadas | ramos 51 e 94 commits à frente |

As contagens vêm de busca por texto e servem para dimensionar, não como inventário final.

## Ordem

1. **Link:** menor e sem produção; detalhes em [04-LINK-DE-PAGAMENTO.md](04-LINK-DE-PAGAMENTO.md).
2. **Delivery:** 12 clientes; libera o teste do WhatsApp.
3. **Expense:** falta pouco; depende de commitar o trabalho em andamento.
4. **Stok:** o maior; melhor depois de levar os ramos para a `main`.

## Etapas de todo app

1. Levantamento mostrado ao usuário.
2. Add-on: `LicencaLoop` no ponto de entrada, com testes.
3. Add-on: serviços próprios para o que hoje é SQL ou serviço nativo no app.
4. Gateway: produto, contexto e regras de cada serviço, com testes.
5. App: licença por domínio, colunas públicas e chamadas pelo gateway.
6. App: retirar credenciais, login direto e SMTP.
7. App: carregamento padrão, identidade visual e ícone.
8. Testes locais e `deployAddon`.
9. Documentos: `05-APPS-WEB.md`, skill e esta pasta.

**Pronto quando:** nenhum segredo no site, nenhum código de produto morto, testes verdes, tela conferida.

## Delivery

- **Modelo (04/11):** o mesmo do Stok, depois dele; ver [08-MODELO-GATEWAY-DE-APP.md](08-MODELO-GATEWAY-DE-APP.md). Confirmar se há clientes em produção: são 12 cadastrados.
- **Hoje:** login direto no Sankhya; 8 arquivos com serviços nativos e 18 serviços próprios chamados com `gatewaySlug`.
- **Decisão pendente:** versão web por domínio e celular pelo usuário logado.
- **Atenção:** o add-on está em `simulador-frete-modelos`. Resolver antes de começar.
- **WhatsApp:** já vai pelo Hub, mas o teste depende do login novo.
- **Produto:** confirmar o id em `"LOOP".loop_produtos_contratos`.

## Expense

- **Hoje:** o app já chama `GatewayExpense`; o gateway confere a licença de `LoopExpense` pelo CNPJ do usuário.
- **Falta:** `LicencaLoop` no add-on, retirar a tela antiga e conferir se ainda há credencial no app.
- **Atenção:** não misturar com as alterações em andamento. Commitar antes ou trabalhar em worktree.
- **Produto:** confirmar o id em `"LOOP".loop_produtos_contratos`.

## Stok

- **Modelo (04/11):** gateway próprio, como Expense e LoopFactory; passo a passo em [08-MODELO-GATEWAY-DE-APP.md](08-MODELO-GATEWAY-DE-APP.md) e situação em `loop_stok/docs/gateway/01-migracao-para-stok-gateway.md`. Sem produção: pode alterar sem transição.
- **Hoje:** app único, web e celular; 19 arquivos com serviços nativos e 25 serviços próprios.
- **Código do produto:** só `LoopStok`. O app ainda cita `LoopConferencia` e `LoopSeparacao`.
- **Dados:** 3 clientes usam os códigos antigos. A migração só ocorre com aprovação.
- **Ramos:** levados para a `main` em 04/11. A migração segue em `feat/stok-gateway` (app e add-on) e `stok-gateway` (gateway).
- **Web por domínio; celular** mantém `licenca_status`, salvo decisão contrária.
