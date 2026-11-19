# Validação: rotas novas do Portal do Cliente (novembro/2026)

Data: 19/11/2026. Oito serviços do add-on do portal foram liberados em `src/core/servicos.ts`, todos com `usuario()` (exigem login do portal; o add-on recebe a identidade assinada e confere o dono do título ou do chamado):

| Serviço | Para quê | Documento no portal |
|---|---|---|
| `LoopPortalPagamentoSP.consultarCartao` | situação do último pagamento com cartão do título | `loop-portal-cliente/loopPortal/docs/implementacoes/pagamentos-cartao-gateways.md` |
| `LoopPortalPagamentoSP.gerarPix` | cria a cobrança PIX Itaú | `.../implementacoes/pix-itau-qrcode.md` |
| `LoopPortalPagamentoSP.consultarPix` | consulta a cobrança PIX Itaú | idem |
| `LoopPortalSacSP.anexarArquivo` | anexa arquivo ao chamado | `.../implementacoes/sac-anexos-verificacoes-build.md` |
| `LoopPortalSacSP.consultarAnexos` | lista anexos do chamado | idem |
| `LoopPortalSacSP.baixarAnexo` | baixa um anexo | idem |
| `LoopPortalDocumentoSP.declaracaoQuitacao` | dados da declaração anual de quitação | `.../implementacoes/declaracao-quitacao-demonstrativo-repasse.md` |
| `LoopPortalDocumentoSP.demonstrativoRepasse` | dados do demonstrativo de repasse (proprietário) | idem |

## Publicação

Junto com (ou depois de) o add-on do portal na base do cliente. Publicar o gateway antes é inofensivo: o add-on antigo responde que o serviço não existe. Push na `main` publica pelo GitHub Actions e vale para **todos os clientes**.

## Como validar

| # | Caso | Esperado |
|---|---|---|
| G1 | `npm test` | todos passando (239 em 19/11/2026) |
| G2 | Chamar cada serviço **sem** login | 401 |
| G3 | Chamar logado como usuário do portal | chega ao add-on (não volta `403 SERVICO_NAO_PERMITIDO`) |
| G4 | `anexarArquivo` com arquivo de ~5 MB | o corpo passa pelo gateway (conferir limite de tamanho da Edge Function) e o add-on responde |
| G5 | Logs da função | sem conteúdo de arquivo, cartão ou credencial |

Os roteiros funcionais ficam no portal: `loop-portal-cliente/loopPortal/docs/testes/validacao-pagamentos.md` e `validacao-sac-documentos.md`.
