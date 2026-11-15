# Pendências e riscos

## Segurança

| Item | Situação |
|---|---|
| Trocar o token da Loop API antes da produção | Está no histórico do git e apareceu em saída de terminal e na conversa |
| Trocar a senha do usuário `SUP`, se usada em outro lugar | Foi informada na conversa |
| Chave em `loop-admin/config/.env` e `loopsign/config/.env` | Fora do escopo pedido; não alterado |
| Cópia `loop-ecommece-addon-licenca` com a chave | Não alterada |
| Usuário usar a chave de outra empresa do mesmo Sankhya (`codEmp` no Hub) | Em aberto; restrito ao próprio cliente |
| `TOKEN` de `LOOPWHATSAPPCONFIG` em texto | Avaliar criptografia |
| Chave privada em `test/fixtures.ts` do gateway | Só de teste; repositório público |
| Build da Pentágono em produção | Só deixa de ser risco ao publicar a versão com gateway e trocar credenciais |
| Link com `DADOSENCRIPTADOS = N`: credenciais da operadora no navegador | Risco aceito por enquanto; usar `S` antes da produção |
| Link: registro de pagamento vem do navegador | Melhoria posterior |
| Vendedor pode enviar mensagem a qualquer número pelo Hub | Igual a antes; avaliar limite |

## Funcional

- **Ecommerce:** verificar `excluirItemNota`, `excluirNotas`, `cancelarNota` e `LookupSP.doConsultar`, fora do gateway.
- **Ecommerce:** lista de pedidos do perfil `S` pode gerar SQL inválido.
- **Ecommerce:** testar consumidor e afiliado, que dependem de `USARB2C = S` e contas de teste.
- **Relatórios:** testar pela tela; o Portal precisa de um relatório com `NOMETABELA`; relatório 122 depende de dados em `TGFCOM`; abertura leva cerca de 4 s.
- **Hub:** exemplo do campo de telefone induz ao erro; erro falso ao selecionar empresa sem cadastro.
- **Hub:** PDF pela Meta não disponível.
- **Instâncias antigas** fora do padrão `_<CNPJ>` são recusadas pelo gateway; a consulta passada ao usuário não teve retorno.
- **Dev Manager:** conferir o aviso de ícone na próxima compilação.
- **`loop-licence`:** Central de Licenças ainda não integrada.

## Riscos do plano

| Risco | Como tratar |
|---|---|
| Publicar site antes de cadastrar o domínio tira o site do ar | Seguir a ordem de implantação |
| Add-ons com a mesma instância geram "Erro ao criar DAO" | Prefixo do produto; conferir `TDDINS` |
| `service-providers.xml` antigo deixa serviços fora do pacote | Apagar antes do build |
| Push na `main` do gateway vai direto a todos os clientes | Mudança arriscada fica em ramo até a hora |
| Serviço público novo vira porta de enumeração | Token de 128 bits, resposta única e limite por origem |
| Outra pessoa trabalhando no Expense e no Loop Mais | Worktree próprio; commit só dos próprios arquivos |
| Sankhya local pode atender site publicado | `deployAddon` pode mudar `portal.loopapp.com.br` na hora |
