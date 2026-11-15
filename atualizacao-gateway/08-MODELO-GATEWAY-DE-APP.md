# Modelo: gateway próprio de app

Como levar um app Loop ao modelo do Loop Expense e do LoopFactory. É o caminho decidido para o **Stok** (04/11/2026) e para o **Delivery** depois dele.

**Para quem:** quem for executar a migração de um app, pessoa ou IA. Siga na ordem. Se algo do app não couber aqui, pare e pergunte em vez de improvisar.

Referências implementadas:

| Parte | Expense | LoopFactory |
|---|---|---|
| Gateway | `loop-gateway/src/expense/gateway.ts` | `loop-gateway/src/producao/gateway.ts` |
| Cliente no app | `loop-expense/lib/services/expense/gateway_expense.dart` | `loop-producao/loopfactory/lib/services/producao/gateway_producao.dart` |
| Identidade no add-on | `.../expense/seguranca/IdentidadeApp.java` | `.../producao/seguranca/IdentidadeApp.java` |
| Texto explicativo | `loop-expense/docs/07_API_E_CONTRATOS.md` | `loop-producao/docs/implementacoes/03-identidade-pelo-login.md` e `04-app-pelo-gateway.md` |

Use o LoopFactory como ponto de partida: é o mais recente e tem lista fechada.

## Por que este modelo

A migration 175 fechou as credenciais de `clientes` e `loopapp` para a chave pública. O app não consegue mais ler token, senha nem `clienteSecret`, então não consegue mais falar direto com o Sankhya. Reabrir a permissão expõe as credenciais de todos os clientes.

```text
App ── login do usuário ──▶ <app>-gateway ── credenciais do cliente ──▶ Sankhya ── Add-on do app
```

| Pergunta | Resposta neste modelo |
|---|---|
| De onde vem a empresa? | Da conta verificada (`usuarios.cpfCnpj`), no servidor. Nunca do que o app informa |
| Quem é o usuário? | O add-on confirma o token do login no Supabase e usa o e-mail devolvido. O `codUsu` do corpo é ignorado |
| Onde fica a licença? | O gateway confere o produto em toda chamada |
| O que o app pode chamar? | Só os serviços da lista do gateway |
| SQL no app? | **Não existe mais.** Nem filtrado: toda consulta vira serviço do add-on |
| Serviço nativo no app? | **Não existe mais.** `CACSP`, `DatasetSP` e afins rodam dentro do add-on |
| Celular precisa de domínio? | Não. Por isso este modelo serve a app único, web e celular |
| E a versão web? | Pode manter a licença por domínio como aviso na abertura, como o Stok. As chamadas continuam usando a empresa da conta |

### Diferença para o gateway único (`portal-gateway`)

O gateway único identifica o cliente pela licença assinada do domínio, e por isso exige `X-Loop-Licenca`. Ele aceita SQL filtrado para o Ecommerce. **Não leve esse filtro para cá:** Expense e LoopFactory não têm SQL pelo gateway.

## Regra que mais gera erro

Pelo gateway, a sessão do Sankhya é a do **usuário técnico do cliente, que pode ser administrador**. Toda checagem do add-on baseada em `AuthenticationInfo` (`isAdmin`, `isSUP`, `getUserID`) passa a olhar esse usuário, e não a pessoa do app.

Consequências:

- Use **lista fechada** de serviços, nunca regra por prefixo. O Expense usa prefixo; o LoopFactory fechou a lista justamente por isso.
- Serviço de tela do Sankhya (configuração, SMTP, usuários, reprocessamento) fica **fora** da lista.
- Serviço liberado confere a pessoa pelo `sessaoToken`, não pela sessão.
- Chamada nativa roda em nome da pessoa, para o Sankhya gravar o autor certo (`comoOperador` no LoopFactory).

## Passo a passo

### Atalho se o app precisa funcionar antes do fim

Quando há muito SQL no app, como no Stok, dá para colocar uma ponte temporária no add-on: ver `loop_stok/docs/gateway/02-ponte-temporaria.md`. Só serve sem clientes em produção, e a decisão é do dono do produto.

### 0. Levantamento

Mostre ao usuário antes de alterar. Responda com números e caminhos:

1. Branch e alterações pendentes do app e do add-on.
2. Código do produto em `clientesProdutos`, e se há códigos antigos para migrar.
3. Serviços do add-on e, entre eles, quais o app usa. Separe os de tela do Sankhya.
4. Chamadas de SQL no app e os arquivos delas.
5. Chamadas de serviço nativo e de gravação genérica.
6. PDF, anexo e outros binários.
7. Como o add-on descobre o usuário hoje.
8. Telas que dependem de colunas que a migration 175 fechou.

### 1. Add-on: identidade

1. Copiar `IdentidadeApp.java` e adaptar o pacote.
2. Copiar de `model/build.gradle` a geração do `supabase.properties`, que lê `SUPABASE_URL` e `SUPABASE_ANON_KEY` do `.env` do app. **Sem o `.env` preenchido o build só avisa e o add-on recusa todo login.**
3. Definir o cadastro que liga e-mail a usuário. No LoopFactory é `LOOPPRDCONFIGUSU`. Valide antes se o app já tem uma tabela equivalente.
4. Criar `doVerificarCadastro` (público, responde só `habilitado`) e `doMeuCadastro` (só os dados de quem pediu).
5. Ignorar `codUsu` do corpo em todo serviço liberado.
6. Rodar nativos como a pessoa que fez a operação.
7. Tratar recusa de login como `loginNaoValidado` em operação com UUID, para o app repetir com o mesmo UUID.

Novo `@Service` precisa de entrada no `service-providers.xml`, e métodos não privados viram endpoint.

Compare o e-mail normalizando os dois lados: o Stok grava em maiúsculas e o Supabase devolve em minúsculas. Confira onde o add-on grava o build antes de procurar resultados: no Stok é `model/buildGradle`, não `model/build`.

### 2. Add-on: licença

Copiar `LicencaLoop` e o teste, conforme `loop-admin/docs/licenciamento/06-MODELO-PARA-OUTROS-APPS.md`.

Expense e LoopFactory ainda não têm essa camada (P-56 do Expense). O roteiro a trata como obrigatória: faça no app novo e registre se decidir adiar.

### 3. Add-on: serviços no lugar do SQL e dos nativos

- Um módulo por vez, com teste. Comece pelo que abre o app: configuração, usuário, empresas.
- A regra sai do widget e do provider e vai para o serviço. Não basta mover o texto do SQL.
- Filtre sempre por empresa e por permissão da pessoa. SQL recebido do app continua proibido.
- Confira tabelas e campos no schema real do Sankhya. Não invente.
- PDF e anexo: o cliente do gateway lê a resposta como texto. Devolva base64 dentro do envelope e meça o tamanho.
- Prazo: operação que grava nota pode precisar de `timeoutMs` alto (90 s no LoopFactory, 100 s no app).

### 4. Gateway

Em ramo, porque **push na `main` publica todos os gateways para todos os clientes**.

1. `src/<app>/gateway.ts`, copiando `src/producao/gateway.ts`: `funcao`, `modulo`, `produto`, `PUBLICOS`, `LIBERADOS`, `timeoutMs`.
2. Acrescentar o contexto em `ModuloSankhya` (`src/core/tipos.ts`).
3. `supabase/functions/<app>-gateway/` com `index.ts` e `deno.json`.
4. Entrada em `supabase/config.toml` com `verify_jwt = false`.
5. Acrescentar a função nos dois laços de `.github/workflows/publicar.yml`.
6. `test/<app>-gateway.test.ts`, copiando o do LoopFactory. Inclua: serviço fora da lista recusado, `sessaoToken` do corpo descartado, empresa vinda da conta.
7. `npm test` verde. Atualizar `docs/VISAO-GERAL.md` e `README.md`.

**Serviço novo que o app usar precisa entrar em `LIBERADOS`.** Em migração por cortes, só acrescente o serviço depois que ele identificar a pessoa pelo `sessaoToken`.

### 5. App

1. `lib/services/<app>/gateway_<app>.dart`, copiando `gateway_producao.dart`, com `FalhaGateway`.
2. URL em `ConfigApp` com `String.fromEnvironment`, tendo a de produção como padrão.
3. Token no cabeçalho `Authorization`, nunca no corpo nem em log.
4. `clientes` e `loopapp` só com as colunas públicas, sem `select=*`.
5. Sem repetição automática no cliente. Quem repete é o comando, com o mesmo UUID.
6. Só é recusa definitiva o que o add-on recusou. Erro do gateway (`codigoGateway`) e login não validado mantêm o comando.
7. Retirar `AuthSankhyaProvider`, serviço de requisições, helpers e modelos que só eles usavam, e os campos de credencial dos modelos.
8. Enum de produto só com códigos válidos.

### 6. Dados do produto

1. Confirmar o id em `"LOOP".loop_produtos_contratos` e cadastrar o produto no catálogo e no contrato. Sem isso o gateway recusa pela licença.
2. Código antigo em `clientesProdutos` muda por migração no Loop Admin. Precedente: `V20261104_191`, de `LoopProducao` para `LoopFactory`.

### 7. Ordem de publicação

1. Merge do ramo do gateway na `main`. Conferir `/functions/v1/<app>-gateway/saude`.
2. Confirmar o contexto no gateway da Sankhya: `/gateway/v1/<contexto>/service.sbr`.
3. Publicar o Loop Admin, se o catálogo mudou, e cadastrar o produto no contrato.
4. Gerar o add-on com o `.env` preenchido e instalar. O servidor Sankhya precisa alcançar o Supabase.
5. Publicar o app.

Publicar em produção continua sendo decisão do usuário (decisão de 02/11).

### 8. Testes

| Camada | O que conferir |
|---|---|
| Gateway | `npm test` |
| Add-on | `./gradlew --offline :model:test` e Sankhya local |
| App | `flutter analyze`, `flutter test` e fluxo no aparelho |
| Segurança | Serviço fora da lista, nativo e SQL recusados; sem login recusado; `sessaoToken` forjado no corpo descartado; empresa de outra conta inalcançável |
| Falha | Tempo esgotado no Sankhya mantém o UUID e a repetição não duplica a operação |
| Busca final | Nenhum `clienteSecret`, `appKey`, `password`, `DbExplorerSP` ou `CACSP` em `lib/` |

### 9. Documentos

Atualizar esta pasta (`01`, `03`, `05`, `README`), `loop-gateway/docs/VISAO-GERAL.md` e os documentos do próprio app.

## Pronto quando

- [ ] O app abre, faz login e opera pelo gateway, testado de ponta a ponta.
- [ ] Nenhuma credencial, SQL ou serviço nativo no app.
- [ ] Lista fechada no gateway, com testes verdes.
- [ ] O add-on identifica a pessoa pelo token, e o `codUsu` do corpo é ignorado.
- [ ] Nativos gravam o autor certo.
- [ ] Produto no catálogo e no contrato, sem código antigo.
- [ ] Documentos atualizados.

## Por app

| App | Situação | Plano |
|---|---|---|
| Expense | Implementado | `loop-expense/docs/` |
| LoopFactory | Código pronto; gateway ainda sem teste de ponta a ponta quando escrito | `loop-producao/docs/implementacoes/04-app-pelo-gateway.md` |
| Stok | Em andamento: corte 1 pronto em ramo | `loop-expedicao/loop_stok/docs/gateway/01-migracao-para-stok-gateway.md` |
| Delivery | Próximo, depois do Stok | Ver [03-PLANO-POR-APP.md](03-PLANO-POR-APP.md); o add-on está no ramo `simulador-frete-modelos` |
