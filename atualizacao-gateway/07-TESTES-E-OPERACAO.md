# Testes e operação

## Já testado

| Teste | Resultado | Quando |
|---|---|---|
| Testes do gateway | 190 passando, local e no GitHub Actions | 02/11 |
| Cadastro no Hub sem aviso do Supabase | OK, inclusive pelo usuário | 02/11 |
| Criação de instância e QR Code | OK depois de corrigir `LOOPAPI_TOKEN` | 02/11 |
| Hub recusa arquivo que não é PDF e envio sem arquivo | OK | 02/11 |
| Envio real de texto e PDF pelo Hub | `ENVIADA`; recebimento a confirmar no celular | 02/11 |
| Serviço novo no gateway publicado sem login | Pede login | 02/11 |
| Serviço antigo `registrarEnvioExterno` | Recusado | 02/11 |
| Publicação automática | Sucesso; `/saude` OK nas duas funções | 02/11 |
| Link: página aberta só com o token, pelo gateway de produção | OK com pedido de teste | 02/11 |
| Link: link invalidado, token inválido, SQL livre e credenciais com `S` | Recusados | 02/11 |

## Falta testar

- Link: cartão de ponta a ponta em sandbox; Pix aguarda afiliação.
- Link: baixa, adiantamento, TEF e e-mail depois do pagamento.
- Link: propagação da URL ao salvar pela tela.
- Ecommerce pela tela: texto e PDF. Depende de compilar e de uma conta de vendedor.
- Delivery: depende do login novo.
- Link: envio pelo agendamento, com nota real.

## Comandos

```bash
# Gateway
cd D:/workspace-loop/loop-gateway
npm test
gh run list -R bmcandido/loop-gateway -w publicar.yml
gh workflow run publicar.yml -R bmcandido/loop-gateway     # publica sem alterar código

# Add-on: testes e instalação local
./gradlew --offline :model:test
rm -f vc/buildGradle/studioGenerated/resources/WEB-INF/resources/service-providers.xml
./gradlew --offline deployAddon

# App: igual ao site publicado
flutter build web --no-pub --no-tree-shake-icons --release \
  --dart-define=PORTAL_GATEWAY_URL=https://zvncvdlfyeyktnuzxvlc.supabase.co/functions/v1/portal-gateway \
  --dart-define=LICENCA_DOMINIO=<dominio>
```

`flutter test --platform chrome` trava neste ambiente: use build local e Playwright.

## Quem faz o quê

| Ação | Quem |
|---|---|
| Commit, merge, push e `deployAddon` local | Agente, sem pedir |
| Publicar o gateway | Automático, ao fazer push |
| `publishAddon` | Usuário |
| Compilar e publicar sites | Usuário, pelo Dev Manager |
| Segredos em produção | Usuário |
| Cadastrar domínio no contrato | Usuário, no Loop Mais |
| Alterar dados de cliente em produção | Só com aprovação |

## Base local

- Sankhya: `http://localhost:8080/mge/`; WildFly em `D:\sankhya-wildfly\wildfly_producao`; log em `standalone/log/server.log`.
- Telas de add-on abertas fora do sistema precisam de `?mgeSession=<JSESSIONID>`.
- Capturas de navegador com login real não vão para o git.
