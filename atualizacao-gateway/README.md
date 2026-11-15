# Atualização do Gateway Loop

Plano para levar todos os apps Loop ao mesmo padrão de licença e de acesso ao Sankhya: o navegador não guarda credenciais, a licença vem do Loop Mais pelo domínio e toda chamada passa pelo gateway.

Criado em 02/11/2026. Esta pasta fica fora dos repositórios e não é versionada. Não grave aqui token, senha nem CNPJ de cliente.

## Por onde ler

| Arquivo | Conteúdo |
|---|---|
| [01-SITUACAO-ATUAL.md](01-SITUACAO-ATUAL.md) | O que já foi feito, com commits, e o que está no ar |
| [02-ARQUITETURA.md](02-ARQUITETURA.md) | Como gateway, licença, Hub e publicação funcionam |
| [03-PLANO-POR-APP.md](03-PLANO-POR-APP.md) | Levantamento, ordem e etapas de cada app |
| [04-LINK-DE-PAGAMENTO.md](04-LINK-DE-PAGAMENTO.md) | Plano detalhado do Link, incluindo o link mascarado |
| [05-DECISOES.md](05-DECISOES.md) | Decisões tomadas e decisões em aberto |
| [06-PENDENCIAS-E-RISCOS.md](06-PENDENCIAS-E-RISCOS.md) | O que falta fora do plano principal e os riscos conhecidos |
| [07-TESTES-E-OPERACAO.md](07-TESTES-E-OPERACAO.md) | Como testar e publicar, e o que já foi testado |
| [08-MODELO-GATEWAY-DE-APP.md](08-MODELO-GATEWAY-DE-APP.md) | Passo a passo do gateway próprio de app, usado no Stok e no Delivery |

## Situação em resumo

| App | Licença por domínio | Pelo gateway | Situação |
|---|---|---|---|
| Portal | sim | sim | Pronto; site aguarda recompilação |
| Ecommerce | sim | sim | Pronto; site aguarda recompilação |
| Hub WhatsApp | não se aplica | só a Loop API | Cadastro e QR Code testados na base local; add-on não publicado |
| **Link de Pagamento** | em andamento | não | **Em andamento, em ramo: página e identidade prontas; cartão de ponta a ponta em sandbox, com baixa no servidor; Pix aguarda afiliação** |
| Delivery | não | não | Na fila; mesmo modelo do Stok, depois dele |
| Expense | não | gateway próprio | Na fila |
| Stok | não | não | **Em andamento: gateway próprio, modelo Expense/LoopFactory; login confirmado no aparelho; demais funções pela ponte temporária, em teste** |

## Referências oficiais

- Roteiro de licença: `loop-central/loop-admin/docs/licenciamento/06-MODELO-PARA-OUTROS-APPS.md`
- Licença por domínio: `loop-central/loop-admin/docs/licenciamento/10-LICENCA-POR-DOMINIO.md`
- Gateway: `loop-gateway/docs/VISAO-GERAL.md`
- Publicação segura do Link: `loop-link-pagamento/loop-link/docs/PRODUCAO.md`
