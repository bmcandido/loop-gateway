# Decisões

## Tomadas pelo dono do produto

| Data | Decisão |
|---|---|
| 01/11 | Portal, Ecommerce, Link e Stok web buscam a licença pelo domínio |
| 01/11 | Stok usa só `LoopStok`; Conferência e Separação saíram do portfólio |
| 02/11 | Dados da Loop vêm sempre de `public.loopapp` com `tipoIntegracao = producao` |
| 02/11 | Chave da Loop API entregue pelo gateway, sem passo manual por cliente; token único só no gateway |
| 02/11 | Gateway em repositório próprio, publicado automaticamente ao alterar o código |
| 02/11 | Commit, merge e push sem pedir autorização; publicar em produção continua com o usuário |
| 02/11 | Trava de vendedor em `TGFVEN` mantida; `TIM*` em lista fechada no Portal |
| 02/11 | Token antigo não precisa ser trocado agora, porque não há produção |
| 02/11 | Conexão do WhatsApp não é mais gravada em `clientes` |
| 02/11 | Ordem de trabalho começa pelo Link |
| 02/11 | Link deixa de expor pedido, CNPJ e demais dados na URL |
| 02/11 | Link mantém os dois canais de pagamento: `DADOSENCRIPTADOS` segue valendo |
| 02/11 | Recorrência do canal antigo funciona e não será alterada |
| 04/11 | Stok e Delivery vão para gateway próprio, no modelo do Expense e do LoopFactory ([08](08-MODELO-GATEWAY-DE-APP.md)) |
| 04/11 | Stok não tem cliente em produção: pode alterar sem transição |
| 04/11 | Stok web mantém a licença por domínio, como aviso na abertura; as chamadas usam a empresa da conta |
| 04/11 | Ramos do Stok levados para a `main`; a migração segue em `feat/stok-gateway` |
| 04/11 | Stok usa ponte temporária com SQL filtrado no add-on, para funcionar antes do fim da migração; não publicar para clientes enquanto existir |

## Tomadas na execução, reversíveis

| Decisão | Motivo |
|---|---|
| Apps enviam WhatsApp só pelo Hub, sem cair em `LOOP_COMERCIAL` | Clientes finais recebiam mensagens pelo número da Loop |
| Link usa token aleatório, não dados criptografados | Pode ser invalidado e não expõe nada se a chave vazar |
| `GatewayAssinatura` não entra no Link | A página é pública: não há identidade a conferir. Reavaliar se surgir login |
| `.env` versionado teve só as linhas da chave retiradas | Exceção à regra de não commitar o arquivo; pedido explícito de apagar a chave |

## Em aberto

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Repositório do gateway continua público? | Privado |
| 2 | Clientes sem Hub ficam sem WhatsApp nos apps? | Sim |
| 3 | Delivery: web por domínio e celular pelo usuário logado? | Sim |
| 5 | Stok: migrar `LoopConferencia` e `LoopSeparacao` para `LoopStok`? | Sim, altera dados de 3 clientes |
| 6 | Link: quando o link vence? Hoje só por pagamento, faturamento e recorrência | Manter a regra atual |
| 7 | Link: quando exigir `DADOSENCRIPTADOS = S` dos clientes? | Antes da produção |
