# Roteiro de homologação da nota fiscal na Produção Restrita

Este roteiro serve para testar a NFS-e do CRM na Produção Restrita da Sefin Nacional, que é o ambiente de teste do governo, antes de ligar a chave em Produção.

Ninguém executou este roteiro ainda, porque não há certificado de teste. Anote o resultado de cada passo no PR ou na tarefa. A chave só vai para **Produção** depois que os 5 passos derem certo **e** o contador der o OK.

A fonte oficial de cada valor está em `.superpowers/sdd/2026-10-18-fase-d-financeiro-nota/fiscal-conferencia.md`, conferida em 18/10/2026.

**Onde rodar: no CRM de produção, com a chave em Teste.** A troca da chave para **Produção** só é aceita quando existe, **neste mesmo banco**, uma nota daquele tipo autorizada no modo Teste (Configurações › Nota fiscal recusa com "Antes da produção, emita e confira uma nota no modo Teste."). Por isso a homologação não roda numa cópia com outro banco: roda no banco de produção, em **comandas de teste**:
- use uma cliente de teste (por exemplo "Teste Nota Fiscal"), sem CPF de cliente de verdade, e valores pequenos;
- as notas de Teste vão para a Produção Restrita (`tpAmb = 2`, "SEM VALIDADE JURÍDICA") e têm numeração própria: não gastam número da série de Produção;
- uma nota de Teste só segura a comanda enquanto a chave está em Teste. Com a chave em Produção (ou Desligada), ela não impede reabrir nem cancelar a comanda e não ocupa o lugar da nota de Produção;
- **no fim, nada fica autorizado nem aberto** (veja "Fechamento da homologação", depois do Passo 5).

---

## Pré-requisitos

1. **Certificado e-CNPJ A1 da Casa (.pfx) no servidor de produção.** No `.env` do servidor, e nunca no repositório nem no banco, preencha:
   - `FISCAL_CERT_PATH=` com o caminho do arquivo `.pfx` no servidor;
   - `FISCAL_CERT_PASSWORD=` com a senha do certificado.

   O certificado tem de ser ICP-Brasil, do CNPJ da Casa. Um A3 em token não funciona no servidor.
2. **Primeiro acesso da Casa no nfse.gov.br.** Faça o cadastro do CNPJ no Emissor Nacional (https://www.nfse.gov.br), com o mesmo certificado. Sem o cadastro, o governo recusa a DPS por causa do cadastro do prestador.
3. **Dados da Casa completos** em Configurações › Nota fiscal › Dados da Casa:
   - CNPJ da Casa (o mesmo do certificado: o CRM recusa o envio se o certificado for de outro CNPJ);
   - inscrição municipal;
   - regime tributário;
   - alíquota do Simples;
   - endereço;
   - código do serviço na nota (cTribNac `060101`) e a série da DPS.
4. **Parceiras com CNPJ:** em Profissionais, cada parceira precisa estar com o vínculo "parceira", o CNPJ e a razão social.
5. **Prontidão completa:** o bloco "Situação" em Configurações › Nota fiscal não pode listar nada faltando. O certificado precisa abrir e não pode estar vencido.
6. **Chave em Teste:** em Configurações › Nota fiscal › Situação, ligue a chave da NFS-e em **Teste**. No modo Teste, o CRM envia para `https://sefin.producaorestrita.nfse.gov.br/SefinNacional` com `tpAmb = 2`.
7. **Perfil com as permissões:** para os passos 1 a 3, `nota.emitir` e `nota.ver`; para os passos 4 e 5, `nota.cancelar`, que só a Gestão tem.
8. **Worker rodando** (`npm run worker`), para o passo 3 (a fila `nota-fiscal` roda a cada minuto).
9. **Caixa do dia aberto** por quem vai fechar as comandas de teste: no fim, cancelar a comanda estorna os pagamentos, e isso só vale com o caixa em que eles entraram ainda aberto.

---

## Os 5 passos

### Passo 1: serviço de profissional CLT, com CPF → autorizada

**Como fazer:**
1. Abra uma comanda com um serviço de profissional CLT.
2. Preencha o CPF na nota.
3. Receba e finalize a comanda.
4. Na comanda fechada, clique em **Emitir nota**.

**O que conferir:**
- A situação muda para **Autorizada**, com o número 1 (ou o próximo da série).
- **Ver nota no nfse.gov.br** mostra a chave de acesso, que tem 50 números.
- **Baixar XML** traz `<dps>` com a DPS assinada e `<resposta>` com o XML da NFS-e.
- No XML da NFS-e: o CPF e o nome do tomador, o valor e o texto "Serviços de beleza: …".
- Abra a nota no nfse.gov.br pela chave. Ela precisa aparecer com o cabeçalho "NFS-e SEM VALIDADE JURÍDICA", porque é da Produção Restrita.

### Passo 2: serviço de parceira → autorizada, com as cotas no texto

**Como fazer:** monte uma comanda com um serviço feito por uma parceira (com CNPJ), feche e clique em **Emitir nota**.

**O que conferir:**
- A situação muda para **Autorizada**.
- No nfse.gov.br (o PDF/DANFSe de lá) e no XML, a discriminação traz "Salão-parceiro (Lei 13.352/2016): cota-parte do salão R$ …; cota-parte de RAZÃO SOCIAL (CNPJ …) R$ …".
- Os valores das cotas batem com a comissão da comanda.

### Passo 3: derrubar a rede no meio do envio → o worker acha a DPS e não duplica

**Como fazer:**
1. Feche uma comanda com serviço.
2. Clique em **Emitir nota** e, logo em seguida, bloqueie a saída para `sefin.producaorestrita.nfse.gov.br` no firewall do servidor (não derrube a rede do servidor de produção inteiro).
3. Espere a situação ficar **Enviando**, com o erro de "Sem resposta do governo".
4. Volte com a rede e espere o worker (2 minutos depois da primeira falha).

**O que conferir:**
- Antes de reenviar, o worker consulta `GET /dps/{Id}`.
- Se a DPS chegou ao governo, a nota fica **Autorizada** com a chave, sem um segundo envio.
- Se não chegou, o worker reenvia o MESMO XML com o mesmo número.
- No nfse.gov.br existe uma nota só para essa DPS.
- O número da série não pulou.

**Risco do atraso de propagação:** logo depois de um timeout, a consulta `GET /dps/{Id}` pode dizer "não existe" mesmo que a DPS tenha entrado, porque o governo ainda não propagou. Nesse caso, o reenvio volta recusado como DPS repetida. O CRM se protege de dois jeitos:
- recusa cujo texto diz que a DPS **já existe / é duplicada** não vira Rejeitada: vira falha, e a próxima tentativa consulta de novo (constante `DPS_JA_RECEBIDA` em `sefin-client.ts`, NÃO CONFIRMADA: veja a tabela abaixo);
- **Emitir de novo** consulta a nota anterior quando ela está em "Erro no envio" **ou** Rejeitada depois de um envio incerto (mais de uma tentativa). Se ela saiu, fica Autorizada e nenhum número novo é gasto; se não saiu, ela fica "Não saiu no governo (conferido antes de emitir de novo)." e a auditoria registra `nota_conferida` com `de` e `para`.

Mesmo assim:
- **anote** quantos minutos a consulta leva para enxergar uma DPS recém-enviada e **o código e o texto** da recusa de DPS repetida (para confirmar `DPS_JA_RECEBIDA`);
- depois de um "Erro no envio", **espere pelo menos 5 minutos** (ou o tempo medido, se for maior) antes de "Emitir de novo" ou de reabrir a comanda. As duas ações consultam a DPS anterior e, se ela "não existir", gastam um número novo ou encerram a nota.

Se o atraso medido passar de 2 minutos (a primeira espera do worker), registre o caso: o código precisa esperar mais antes da primeira consulta.

### Passo 4: cancelar a nota do passo 1 → cancelada

**Como fazer:** na comanda do passo 1, clique em **Cancelar nota**. Escreva um motivo com pelo menos 15 letras e confirme.

**O que conferir:**
- A situação muda para **Cancelada**.
- No nfse.gov.br, a nota aparece cancelada (evento 101101).
- Na Auditoria aparece `nota_cancelada`.
- Agora a comanda pode ser reaberta. Antes do cancelamento, reabrir dava "Essa comanda tem nota fiscal autorizada: cancele a nota antes.".

### Passo 5: reenviar uma DPS já usada → o governo recusa e o CRM mostra o motivo

**Como fazer:** este passo mexe direto no banco, e **só em linhas de Teste** (`environment = 'teste'`). Nunca toque numa linha nem no contador de `producao`.
1. Escolha uma nota de Teste autorizada.
2. Copie-a para uma linha nova com o mesmo `request_xml`, com `status = 'pendente'`, `attempts = 0`, `environment = 'teste'` e o `comanda_id` de outra comanda de teste.
3. Espere o worker.

Outra forma: zere o contador de Teste em `fiscal_sequences` (`kind = 'nfse' AND environment = 'teste'`, `next_number` de volta a 1) e emita uma nota nova.

**O que conferir:**
- A nota fica **Rejeitada**.
- O motivo do governo aparece na comanda, com o código entre parênteses.
- O worker não tenta de novo.
- **Emitir de novo** cria uma nota com número novo.
- **Anote o código e o texto da recusa.** Se o texto disser que a DPS já existe ou é duplicada, a nota fica em "Enviando" (o CRM trata como "já recebida" e consulta) em vez de Rejeitada: registre o código para confirmar `DPS_JA_RECEBIDA`.

### Fechamento da homologação (nada fica autorizado nem aberto)

1. Deixe **uma** nota de Teste autorizada (a do Passo 2) até trocar a chave: é ela que libera a Produção.
2. Com o contador de acordo, troque a chave da NFS-e para **Produção** em Configurações › Nota fiscal › Situação.
3. Cancele as notas de Teste que ainda estão autorizadas (**Cancelar nota** na comanda; o cancelamento vai para o ambiente da própria nota, a Produção Restrita, mesmo com a chave já em Produção).
4. Cancele as comandas de teste (Gestão, **Cancelar comanda**, com o motivo "homologação da nota fiscal"), com o caixa do dia ainda aberto, para os pagamentos de teste saírem do caixa e do Financeiro.
5. Confira em Relatórios › Notas fiscais que nenhuma nota de Teste ficou Autorizada.

---

## Pontos NÃO CONFIRMADOS: validar no primeiro envio

Estes valores vieram de fontes secundárias ou de fontes oficiais que se contradizem. Confira cada um no primeiro envio.

| Ponto | Como está hoje | O que pode dar errado | Onde trocar |
|---|---|---|---|
| Algoritmo da assinatura | SHA-1 (`rsa-sha1` + digest `sha1`) | O governo recusa com **E0714** ("assinatura inválida") | **Tela:** Configurações › Nota fiscal › Regras e textos › "Assinatura da NFS-e" (SHA-1 ou SHA-256). Troque e emita de novo. |
| Nomes dos campos JSON do envio e da resposta | `dpsXmlGZipB64`; resposta com `chaveAcesso`, `nfseXmlGZipB64` e `erros[{Codigo, Descricao}]` (a leitura não diferencia maiúsculas e aceita `erro` no singular) | O envio sai vazio, ou a nota autorizada fica como "respondeu sem a chave de acesso" | **Constantes** em `src/server/domain/fiscal/sefin-client.ts`: `CAMPO_DPS`, `CAMPO_CHAVE`, `CAMPO_NFSE_XML`, `CAMPO_ERROS`, `CAMPO_ERRO` |
| Campo JSON do evento de cancelamento | `pedidoRegistroEventoXmlGZipB64` | O cancelamento é recusado | **Constante** `CAMPO_EVENTO` em `sefin-client.ts` |
| Consulta de DPS que não existe | `GET /dps/{Id}` devolve **404** ou o erro **E2404** e o CRM entende "não existe" | Outro código: o CRM não reenvia ("Não deu para confirmar…") e a nota vira erro_envio | **Constante** `ERRO_DPS_INEXISTENTE` e a regra do 404 em `consultarDps` (`sefin-client.ts`) |
| `pAliq` (alíquota do ISS) | Não vai na DPS (o Anexo I proíbe para ME/EPP sem retenção em município "Ativo") | Recusa por falta da alíquota | **Tela:** ligue "Informar a alíquota na nota" e preencha "Alíquota do ISS" (Padrão dos serviços). Antes, consulte `GET /parametros_municipais/2927408/convenio`. |
| Prestador sem nome e sem endereço | A DPS manda só CNPJ, IM e o regime (nome e endereço vêm do cadastro nacional) | Recusa pedindo `xNome`/`end` do prestador | **Código:** bloco `prest` em `src/server/domain/fiscal/dps-xml.ts` (os dados já estão em Dados da Casa) |
| Tomador sem nome | Com CPF e sem nome, o tomador vai como "Consumidor" | Recusa ou nota com nome genérico | **Constante** `TOMADOR_SEM_NOME` em `dps-xml.ts`; ou preencha o nome da cliente na comanda |
| DPS repetida (já recebida) | Recusa cujo texto bate com `DPS_JA_RECEBIDA` ("duplic…", "já existe", "já foi gerada"…) vira falha e a próxima tentativa consulta a DPS | Código ou texto diferente: a recusa vira Rejeitada (aí "Emitir de novo" ainda consulta a anterior, porque houve envio incerto) | **Constante** `DPS_JA_RECEBIDA` em `sefin-client.ts`: acrescente o código/texto anotado no Passo 3 ou 5 |
| `totTrib` | Simples com a alíquota preenchida → `pTotTribSN` (alíquota do Simples); sem ela → `indTotTrib 0` | Recusa pedindo outro formato do total de tributos | **Tela:** "Alíquota do Simples (%)" vazia manda `indTotTrib 0`. **Código:** linha `totTrib` em `dps-xml.ts` |

Outros pontos para observar:
- **Cadeia TLS do servidor (vale para a Sefin e para a SVRS):** o CRM confere o certificado do servidor do governo, e o Node não traz as ACs da ICP-Brasil. Se a conexão cair antes da resposta (erro de certificado, como `unable to get local issuer certificate`), **não desligue a verificação**. Faça assim:
  1. Baixe a cadeia da ICP-Brasil (AC Raiz e as intermediárias do servidor) do repositório do ITI e junte tudo num arquivo `.pem`, por exemplo `/etc/casa-fiaes/icp-brasil.pem`. O arquivo fica no servidor, fora do repositório.
  2. Ponha `NODE_EXTRA_CA_CERTS=/etc/casa-fiaes/icp-brasil.pem` no ambiente do processo. No pm2, use o `env` do app e do worker no ecosystem, e reinicie com `pm2 restart <app> --update-env`.
  3. A variável só é lida quando o processo do Node sobe, e vale para as duas notas (o app e o worker `nota-fiscal`).
- **Comanda presa por nota:** sem o certificado no servidor (ou com o A1 vencido), o CRM não consegue conferir uma nota incerta e recusa reabrir com "Para reabrir, o CRM precisa conferir a nota no governo com o certificado digital A1 válido…". A NFC-e autorizada fora do prazo também não se cancela pelo CRM. A saída é a Gestão (`nota.resolver`) conferir no portal e usar **Resolver fora do CRM** no bloco da nota, com o motivo: "a nota NÃO saiu" (vira Rejeitada) ou "a nota saiu e foi resolvida fora do CRM" (vira Cancelada, com a chave se tiver). A auditoria registra `nota_resolvida_fora` com `de` e `para`.
- **Prazo de cancelamento:** o município define. Se o passo 4 for recusado por prazo, anote o prazo de Salvador.
- **PDF (DANFSe):** a API do ADN foi suspensa em 15/07/2026 (NT 008). Por isso o CRM mostra a chave para abrir a nota no nfse.gov.br, e `/api/notas-fiscais/{id}?formato=pdf` responde 501. Gerar o PDF no CRM ficou para depois.

---

## NFC-e

Este bloco testa a NFC-e (nota do produto, modelo 65) na **homologação da SEFAZ**. Para a Bahia, quem atende a NFC-e é a **SVRS** (SEFAZ Virtual do RS), e não os servidores da própria SEFAZ-BA. Ninguém executou este bloco ainda. Anote o resultado de cada passo. A chave da NFC-e só vai para **Produção** depois que os 3 passos derem certo **e** o contador der o OK.

### Pré-requisitos

1. **Inscrição estadual e CNAE de comércio.** A Casa precisa ter IE ativa na SEFAZ-BA e o CNAE **4772-5/00** (comércio varejista de cosméticos e produtos de perfumaria) para vender produto com NFC-e. Isso é a decisão 5 da tabela do plano: o contador confirma. Sem isso, não ligue a chave.
2. **Credenciamento e CSC de homologação.** No portal da SEFAZ-BA (efisc), gere o **CSC** (Código de Segurança do Contribuinte) de homologação e anote o **ID do CSC**. No `.env` do ambiente de teste, e nunca no repositório nem no banco, preencha:
   - `NFCE_CSC=` com o CSC;
   - `NFCE_CSC_ID=` com o ID (só números; o CRM tira os zeros da esquerda no QR Code).

   O CSC de produção é outro. Ele só entra no `.env` de produção, quando a chave for para Produção.
3. **O mesmo certificado A1** da NFS-e (`FISCAL_CERT_PATH` e `FISCAL_CERT_PASSWORD`). Ele precisa ser do CNPJ da Casa.
4. **Dados da Casa** em Configurações › Nota fiscal › Dados da Casa: CNPJ, razão social, **inscrição estadual**, regime **Simples Nacional** (a NFC-e do CRM só sai no Simples: CRT 1 e CSOSN), endereço completo e a **série da NFC-e**.
5. **Produtos com os códigos fiscais** em Serviços e pacotes › Produtos: **NCM** (8 números; produto sem NCM não sai na nota), CFOP, CSOSN e unidade. Os produtos novos nascem com os padrões de Configurações › Estoque (CFOP 5102, CSOSN 102, UN). O CRM aceita os CSOSN 102, 103, 300, 400, 500 e 900. O contador confere o NCM e o CSOSN de cada produto.
6. **Prontidão completa:** a parte "Nota do produto (NFC-e)" do bloco "Situação" não pode listar nada faltando.
7. **Chave em Teste:** em Configurações › Nota fiscal › Situação › "Nota do produto (NFC-e)", ligue em **Teste** (`nfce_modo = teste`). Como na NFS-e, rode no CRM de produção em comandas de teste: a troca para Produção exige uma NFC-e autorizada em Teste neste banco. No modo Teste, o CRM envia para `https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx` com `tpAmb = 2`.
8. **Perfil com as permissões:** `nota.emitir` e `nota.ver` para os passos 1 e 2; `nota.cancelar` (só a Gestão) para o passo 3.

### Passo 1: comanda com produto (e com serviço) → NFC-e autorizada

**Como fazer:**
1. Abra uma comanda com **um serviço e um produto** do catálogo. Pague com duas formas, por exemplo Pix e cartão de crédito com a bandeira, e deixe um troco no dinheiro se quiser.
2. Feche a comanda.
3. No bloco "Nota fiscal", em **Nota de produto (NFC-e)**, clique em **Emitir NFC-e**.

**O que conferir:**
- A linha muda para **NFC-e 1 · Autorizada · R$ …** com o valor **só dos produtos** (o serviço vai na NFS-e, que é outra nota, com o próprio valor).
- **Baixar XML** traz o `nfeProc`, com a `NFe` assinada e o `protNFe` com `cStat 100` e o protocolo (`nProt`, 15 números).
- No XML:
  - o `xProd` do primeiro item é exatamente "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" (sem isso, a SEFAZ recusa com **cStat 373**);
  - o NCM, o CFOP e o CSOSN são os do cadastro do produto;
  - o `vNF` é a soma dos produtos;
  - o `<pag>` tem as formas da comanda rateadas pelo valor dos produtos, sem a cortesia e sem o troco. O cartão vai com `<card><tpIntegra>2</tpIntegra><tBand>…</tBand></card>`, e o Pix com `<card><tpIntegra>2</tpIntegra></card>` (sem isso, **cStat 391**).
- Se a SEFAZ recusar, a linha mostra o motivo com o código (por exemplo, "… (cStat 778)"). Anote o código. **Emitir NFC-e de novo** usa um número novo.

### Passo 2: consultar pelo QR Code

**Como fazer:** na NFC-e autorizada, clique em **Consultar pelo QR Code**. Ou leia o QR Code com o celular, montando o cupom pelo link.

**O que conferir:**
- O link começa com `http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=<chave>|2|2|<ID do CSC>|<hash>`.
- A página da SEFAZ-BA abre a nota com os mesmos itens e o mesmo valor. Se a SEFAZ disser que o hash não confere (**cStat 464** na emissão, ou erro na consulta), o CSC ou o ID do `.env` está errado.
- A consulta por chave (`urlChave`) é `http://hinternet.sefaz.ba.gov.br/nfce/consulta`.
- **Consulta antes de reenviar:** derrube a rede do servidor de teste no meio de um **Emitir NFC-e**. A linha fica **Enviando**. Volte a rede e espere o worker (`npm run worker`, fila `nota-fiscal`, a cada minuto). Ele consulta a chave na SVRS (`NfeConsulta4`, operação `nfeConsultaNF` do NFeConsultaProtocolo4) **antes** de reenviar, e a nota fica **Autorizada** sem duplicar. A operação vem do WSDL e ainda não foi exercitada: se a SVRS recusar a consulta, anote a resposta.
- Uma NFC-e que fica mais de alguns minutos na fila pode voltar recusada por atraso da emissão (**cStat 704**). Isso é esperado, porque a contingência offline ficou fora desta fase: **Emitir NFC-e de novo** emite com número novo.

### Passo 3: cancelar em menos de N minutos

O N vem de Configurações › Nota fiscal › Regras e textos › "Cancelar a NFC-e até" (padrão: **30 minutos**, RICMS-BA art. 107-H).

**Como fazer:**
1. Logo depois do passo 1, ainda dentro do prazo, clique em **Cancelar NFC-e**.
2. Escreva o motivo, com pelo menos 15 letras.
3. Clique em **Cancelar a NFC-e na SEFAZ**.

**O que conferir:**
- A linha mostra "Dá para cancelar na SEFAZ até as HH:MM" antes do cancelamento.
- Depois de cancelar, a linha muda para **Cancelada**. A auditoria registra `nota_cancelada`, com `tipo: nfce`, `de` e `para`.
- O evento enviado é o **110111** com o protocolo da autorização. A SEFAZ responde **cStat 135** (registrado) ou **155** (fora de prazo, homologado).
- A consulta pelo QR Code passa a mostrar a nota cancelada.
- **Fora do prazo:** emita outra NFC-e e tente cancelar depois de N minutos. O CRM recusa sem falar com a SEFAZ: "A NFC-e só pode ser cancelada até N minutos depois de autorizada." A saída é uma nota de devolução, com o contador.

### Fechamento da homologação da NFC-e

O cancelamento da NFC-e só vale até N minutos depois da autorização, então a troca e o cancelamento andam juntos:
1. Emita uma NFC-e de Teste numa comanda de teste.
2. Dentro dos N minutos: troque a chave da NFC-e para **Produção** e, logo depois, cancele essa NFC-e de Teste (**Cancelar NFC-e**; vai para a homologação da SVRS, o ambiente da própria nota).
3. Cancele as comandas de teste, com o caixa do dia aberto.
4. Uma NFC-e de Teste que passou do prazo e ficou autorizada não segura a comanda com a chave em Produção, mas fica listada: anote o número e avise o contador.

### Pontos NÃO CONFIRMADOS da NFC-e

| Ponto | Como está hoje | O que pode dar errado | Onde trocar |
|---|---|---|---|
| Consulta pela chave | `NfeConsulta4.asmx`, ação `NFeConsultaProtocolo4/nfeConsultaNF`, `consSitNFe` 4.00; `217` = não consta | A consulta falha e a nota vira erro_envio em vez de autorizada | `SERVICO.consultar` em `src/server/domain/fiscal/nfce/soap.ts` |
| PIS e COFINS | `PISNT`/`COFINSNT` com CST **07** (padrão do Norte Vendas, autorizado na BA) | O contador pede outro CST | Constante `CST_PIS_COFINS` em `src/server/domain/fiscal/nfce/xml.ts` |
| Código de barras | Vai em `cEAN` só quando o dígito do GTIN confere; senão "SEM GTIN" | A SEFAZ confere o GTIN no Cadastro Centralizado e recusa | Apague o código de barras do produto, ou troque `gtinOrSem` em `xml.ts` |
| Origem da mercadoria | `orig 0` (nacional) para todos os produtos | Produto importado pede outra origem | Constante `ORIGEM_NACIONAL` em `xml.ts` (o cadastro ainda não guarda a origem) |
| Cadeia TLS da SVRS | O CRM confere o certificado do servidor (o Norte Vendas desligou essa verificação) | A conexão cai antes do SOAP | `NODE_EXTRA_CA_CERTS` com a cadeia ICP-Brasil no ambiente do pm2 (ver "Cadeia TLS do servidor" acima). Não desligue a verificação |

Também fica fora desta fase:
- a **contingência offline** (`tpEmis 9`);
- a **inutilização** dos números que ficaram sem nota (rejeitadas);
- o **cupom em PDF** (DANFE NFC-e), porque a consulta é pelo QR Code. `/api/notas-fiscais/{id}?formato=pdf` responde 501.

