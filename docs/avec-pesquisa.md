# Avec: pesquisa para substituição e importação de dados

Pesquisa feita em 14/10/2026. Fontes principais:

- Site comercial: https://negocios.avec.app (páginas de cada funcionalidade e a de planos, https://negocios.avec.app/avec-planos). O endereço avec.app é o marketplace do consumidor e manda para esse site.
- Central de ajuda oficial: https://negocios.avec.app/central-de-ajuda/home. Baixei os **95 artigos** que estão no sitemap (https://negocios.avec.app/sitemap.xml) e li todos.
- **Documentação oficial da "AVEC - API de Relatórios"**: https://doc.api.avec.beauty (feita no Apidog). Baixei o índice (https://doc.api.avec.beauty/llms.txt) e as 278 páginas, uma por relatório.
- Lojas de apps: Avec PRO (https://play.google.com/store/apps/details?id=br.com.salaovip.terminal) e Avec cliente (https://play.google.com/store/apps/details?id=com.avec).
- Fontes de terceiros, marcadas como tal: tutorial de exportação da Belle Software, um script público no GitHub que lê a API do Avec e o JavaScript público do agendamento online (https://agendamento.avec.beauty).

Legenda usada no texto:
- **[DOC]**: confirmado no site, na central de ajuda ou na documentação oficial do Avec.
- **[TESTE]**: conferi eu mesmo, com uma requisição sem login.
- **[3º]**: visto em código ou tutorial de terceiros, sem documentação oficial.
- **[INF]**: inferência minha, que precisa ser confirmada.

> Contexto: o Avec (empresa "Avec by Hyperlocal") é o antigo **Salão VIP**. Os domínios antigos (`salaovip.com.br`, `avec.beauty`) continuam no ar e os campos internos ainda usam nomes do Salão VIP **[DOC/TESTE]**.

---

## 1. Funcionalidades do Avec e o que nosso CRM já tem

Comparei com o que o CRM tem hoje: fila multiatendente por WhatsApp, transferir, distribuição automática, respostas prontas, etiquetas, funil, Agenda (dia/semana, compareceu/faltou), profissionais por serviço com escolha ao agendar e aviso de conflito, fechar venda (valor, forma de pagamento, serviço), relatórios com PDF e perfis de acesso. Conferi também o `docs/backlog.md` e o código: automações de lembrete com enquete de confirmação, aniversário, ciclo de retorno por serviço e importação de contatos por CSV.

Valores da coluna "Nosso CRM":
- **Tem**: está pronto.
- **Parcial**: cobre parte do recurso.
- **Falta**: não existe.
- **n/a**: não se aplica à Casa.

Tudo da coluna "O que faz" é **[DOC]**, salvo quando vem marcado de outro jeito.

### Agenda

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Agenda em colunas por profissional | Escolhe o dia, clica no horário livre na coluna da profissional e abre a "Reserva" | **Parcial** (temos dia/semana; não há coluna por profissional) |
| Só serviços habilitados | A reserva mostra apenas os serviços que aquela profissional faz | **Tem** |
| Duração bloqueia a agenda | O horário fica ocupado pela duração do serviço. A duração pode ser diferente por profissional | **Falta** (serviço não tem duração no nosso cadastro) |
| Vários serviços na mesma reserva | Mais de um serviço por agendamento, ou "Adicionar serviço" num outro horário | **Falta** (o lead tem um serviço só) |
| Serviços simultâneos | Mão e pé ao mesmo tempo com profissionais diferentes ("agendamento paralelo") | **Falta** |
| Horário de trabalho por profissional | Dias e horas de cada profissional, mais o intervalo da grade (ex.: 15 em 15 min) | **Falta** |
| Bloquear horário | Bloqueio por profissional, data e faixa de horas | **Falta** |
| Etiquetas no agendamento | Cria na hora (ex.: "cliente nova", origem) e aparecem na agenda | **Parcial** (etiqueta na conversa/contato) |
| Status e cancelamento | Agendado/cancelado etc.; com recorrência, cancela um ou todos | **Parcial** (compareceu/faltou; sem recorrência) |
| Agendamento recorrente | Repetir o horário | **Falta** |
| Salas e equipamentos | Só agenda se a sala ou o aparelho estiver livre | **Falta** (provavelmente n/a) |
| Horário de funcionamento | É obrigatório; a agenda e o agendamento online dependem dele | **Tem** (expediente das automações) |
| Histórico de agendamentos da cliente | Todos os agendamentos dela, vistos no cadastro | **Parcial** |
| Mapa de calor | Dias e horários cheios e vazios | **Falta** |

### Agendamento online (pela cliente)

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Link/página de agendamento 24 h | Para Instagram, Google e campanhas. Regras: antecedência mínima, cancelamento, até quantos dias no futuro, aviso por e-mail. Só aparecem profissionais e serviços marcados para isso | **Falta** |
| Widget no site | Script `agenda_integracao/{slug}` que abre `agendamento.avec.beauty` num pop-up **[3º/TESTE]** | **Falta** |
| Pagamento online no agendamento | A cliente paga ao reservar | **Falta** |
| App Avec (marketplace) | App de consumidor (100 mil+ downloads) com busca de salões, agendamento, pagamento, pacotes, fidelidade e "Avec+" (assinatura de descontos) | n/a |
| Avec IA (WhatsApp) | Assistente que entende texto **e áudio**, consulta a agenda, marca, remarca e cancela sozinha, 24 h. Funciona pela **API oficial da Meta (WABA)** com templates aprovados. É vendida à parte ("add-on") | **Falta** (temos fila humana e sinais; nada agenda sozinho) |
| App próprio white label | App com a marca do salão ("em breve") | n/a |

### Comanda (atendimento → pagamento)

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Abrir comanda pela agenda | Já vem com a cliente, a profissional e o serviço | **Parcial** ("fechar venda" no lead) |
| Abrir comanda avulsa | Pelo Financeiro, sem agendamento | **Falta** |
| Vários itens e profissionais | Serviços e produtos, cada um com a sua profissional, numa comanda só | **Falta** |
| Importar agendamento para a comanda | Junta um serviço marcado depois | **Falta** |
| Assistente na comanda | Registra quem ajudou, com comissão própria | **Falta** |
| Editar itens e valores | Enquanto a comanda está aberta | **Falta** |
| Várias formas de pagamento | Dinheiro + cartão etc. na mesma comanda | **Parcial** (uma forma por venda) |
| Fiado (dívida) | Finaliza com dívida, que vai para o cadastro da cliente. Escolhe se a comissão sai agora ou só quando pagar | **Falta** |
| Troco como crédito e crédito/débito | Saldo a favor ou contra no cadastro da cliente | **Falta** |
| Vale-presente | Vende e depois aceita como pagamento; tem comissão própria | **Falta** |
| Pré-venda | Paga hoje, usa depois; tem comissão de quem vendeu | **Falta** |
| Usar pacote na comanda | Abate a sessão do pacote em vez de cobrar | **Falta** |
| Comandas pendentes | Comandas com itens que não foram pagas | **Falta** |
| Regras da comanda | Bloqueia o fechamento se o caixa estiver fechado; numeração das comandas | **Falta** |
| Excluir comanda finalizada | Com auditoria (relatórios 0090 "Comandas deletadas" e 0093 "Itens excluídos") | **Falta** |
| Caixinha e cortesia | Gorjeta da profissional e itens grátis, com relatório próprio | **Falta** |
| Observações da comanda | Texto livre com relatório (0182) | **Parcial** (observação no lead) |
| Prontuário pela comanda | Preenche a ficha do atendimento dentro da comanda | **Falta** |

### Caixa e financeiro

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Abrir e fechar caixa | No fechamento informa o que apurou; dá para reabrir o caixa | **Falta** |
| Sangria e suprimento | Valor + motivo obrigatório; pode lançar como saída/entrada no financeiro, descontar da profissional ou dar bônus | **Falta** |
| Comanda vinculada ao caixa | A venda entra no caixa aberto | **Falta** |
| Entradas e saídas | Despesas e receitas fora de comanda, com categorias e subcategorias | **Falta** |
| Contas bancárias e transferências | Cadastro das contas e transferência entre elas | **Falta** |
| Taxas de cartão | % por bandeira, crédito e débito, conta e prazo | **Falta** |
| Extrato, conciliação bancária e fluxo de caixa | Filtros por competência, vencimento ou quitação; projeção de saldo | **Falta** |
| Avec Pay | Maquininha e conta digital; conciliação do recebimento com a comanda; PIX conciliado | **Falta** |
| Split de pagamentos | Divide na hora, na maquininha, a parte do salão e a da profissional (Lei do Salão-Parceiro 13.352/2016) e liquida na "Avec Conta" da profissional | **Falta** |
| Relatórios de faturamento | Por dia, por forma de pagamento, por categoria, ticket médio etc. | **Parcial** (vendas nos relatórios) |

### Comissões

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| % por profissional × serviço | Na aba "Serviço e Comissão" da profissional, com tempo próprio do serviço | **Falta** |
| Comissão de produto, pacote, pré-venda e vale-presente | Cada uma configurada à parte | **Falta** |
| Comissão de assistente | % própria quando atua como assistente | **Falta** |
| Descontos na comissão | Taxa de cartão, antecipação, administração, custo do serviço e produto usado | **Falta** |
| Data de recebimento | Quando a comissão vale, conforme a forma de pagamento (cartão, cheque, boleto) | **Falta** |
| Pagar comissão | Filtra por profissional/período/status, paga, guarda histórico e gera recibo personalizável | **Falta** |
| Recálculo retroativo | Até 45 dias | **Falta** |
| Vale Rápido | A profissional antecipa as comissões pelo app (análise da Sinc.Finance); o salão paga uma fatura consolidada | n/a |

### Estoque

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Produtos | Código de barras, local, categoria, custo, preço, comissão, dados fiscais e desconto na comissão | **Falta** |
| Uso interno × revenda | Separa o que vai para o lavatório do que é vendido no balcão | **Falta** |
| Baixa automática por serviço | Liga produto e quantidade ao serviço (g, ml) e dá baixa ao lançar na comanda | **Falta** |
| Fornecedores e pedidos de compra | Pedido manual por fornecedor | **Falta** |
| Entrada por XML da NF-e | Lê a nota, atualiza quantidade e preço | **Falta** |
| Solicitação de saída com aprovação | A saída só desconta depois de aprovada | **Falta** |
| Inventário, estoque mínimo, validade, locais | Contagem, alerta de reposição, validade e vários locais | **Falta** |
| Relatórios | Posição, custo médio, curva ABC, uso por profissional, lucro por produto | **Falta** |

### Pacotes, assinaturas e fidelidade

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Pacotes de serviços | Serviços × quantidade, validade, preço com desconto e tipo de comissão. O uso aparece no cadastro da cliente (feitas × restantes) | **Falta** |
| Clube de assinaturas | Planos como "Escova ilimitada", cobrança recorrente no cartão por link, até 3 tentativas e depois cancela sozinho. Comissão por "técnica do pote" | **Falta** |
| Programa de fidelidade | Pontos por serviço, valor ou pontos, com campanhas e resgate. O resgate é subsidiado pelo split | **Falta** |
| Cashback | **Não encontrado** no Avec (o "Avec+" é desconto no app do consumidor) | n/a |
| Promoções | Valor promocional por serviço e promoção por dia da semana **[TESTE/3º]**; relatórios 0108 e 0185 | **Falta** |

### Cadastro da cliente, ficha e anamnese

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Cadastro | Mínimo: nome, sobrenome e celular. Também e-mail, aniversário, CPF, gênero, bairro e "Como conheceu?" (pelos relatórios) | **Tem** (nome, telefone, e-mail, Instagram, aniversário, origem, notas) |
| Anamnese | Perguntas personalizadas (texto ou múltipla escolha), iguais para todas as clientes, preenchidas no cadastro | **Falta** |
| Prontuário | Campos personalizados preenchidos a cada atendimento, pela comanda, guardados no histórico | **Falta** (importante para tricologia **[INF]**) |
| Anexos | Fotos e documentos no cadastro | **Falta** (só mídia da conversa) |
| Avisos | Alerta que aparece ao selecionar a cliente na agenda ou na comanda, para uma cliente ou um grupo (ex.: aniversariantes) | **Falta** |
| Unificar duplicados | Botão de unificar; relatórios de celular, e-mail e CPF duplicados | **Falta** |
| Retorno recomendado | "Dias para retorno" no serviço, com relatório de quem passou do prazo | **Tem** (ciclo por serviço + automação) |

### Lembretes, confirmações e marketing por WhatsApp

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Confirmação automática | Mensagem antes do horário. Se a cliente desmarcar, a IA oferece outra data e libera o horário | **Tem** (lembrete + enquete "Confirmo/Preciso remarcar"; sem remarcação automática) |
| Aniversário | Mensagem automática | **Tem** |
| Convite de retorno | IA chama quem passou do ciclo do serviço, no dia da semana que a cliente prefere | **Parcial** (automação por ciclo, sem "dia preferido") |
| Campanhas de reativação | Disparo segmentado por histórico e preferências (Marketing IA) | **Falta** (backlog) |
| Templates Meta | Templates da WABA aprovados pela Meta, com botão "Parar de receber" | n/a (usamos Evolution) |
| SMS | Relatório 0101 "Consumo de SMS" (lembrete por SMS, provavelmente legado **[INF]**) | n/a |

### Avaliação / NPS

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Avaliação pelo app | A cliente avalia o atendimento/comanda no app (relatórios 0104, 0204, 0224, 0324; rota `cliente/comanda/{id}/avalia…` no app **[3º]**) | **Falta** (backlog: pesquisa de satisfação) |
| Avaliação manual da profissional | Nota + comentário lançados no cadastro da profissional | **Falta** |
| NPS formal (0–10) | **Não encontrado** | **Falta** |

### Relatórios e dados

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Biblioteca de relatórios | **230 relatórios** de unidade + 48 de franquia (lista na seção 3). No relatório aparece o botão **"Excel"** **[3º]** | **Parcial** (nossos relatórios + PDF) |
| Produtividade/ocupação | Taxa de ocupação por profissional (0126), dias trabalhados, agendado × realizado | **Falta** |
| Relatórios do Avec IA | Conversão dos agendamentos feitos pela IA | n/a |
| Avec Lake | "Banco de dados inteligente" com **12 tabelas** para Power BI, Looker, Tableau e Metabase; CLV, retorno e curva ABC. Feito para redes ("BI e gestão de múltiplas unidades" é add-on) | n/a |

### App do profissional (Avec PRO)

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Agenda própria em tempo real | Avisa quando entra horário novo e libera o horário quando a cliente cancela | **Falta** (profissional não é usuária no CRM) |
| Comissão em tempo real | Serviços, produtos, descontos (cartão, material) e quanto vai receber | **Falta** |
| Histórico da cliente | Preferências e recorrência | **Falta** |
| Split, Avec Conta e Vale Rápido | Recebe direto e antecipa | n/a |
| Atalho no celular | A plataforma web também vira "app" pela tela inicial | **Tem** (nosso sistema é web/PWA) |

### Notas fiscais

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| NFS-e (serviço) e NFC-e (produto) | Emite na finalização da venda com certificado A1; PDF e XML enviados à cliente | **Falta** |
| Multiempresa | Cadastra o CNPJ/MEI de cada profissional parceira e emite a nota de cada uma (NFS-e Nacional, Salão-Parceiro). Relatórios comparam comissão × nota por empresa | **Falta** |

### Acessos e plataforma

| Recurso Avec | O que faz | Nosso CRM |
|---|---|---|
| Grupos de acesso | Grupos com permissões marcadas uma a uma (ex.: Recepção, Financeiro, Gestão) | **Parcial** (perfis fixos) |
| Login | E-mail → "Buscar unidade" → senha | **Tem** |
| Franquias/multiunidade | Gestão central de várias lojas | n/a |
| Suporte | Chat com a "Bella", franqueados que dão suporte presencial e canal no YouTube | n/a |

### Integrações citadas pelo Avec

| Integração | Para que serve | Fonte |
|---|---|---|
| WhatsApp API oficial (Meta/WABA) | Avec IA, lembretes e campanhas | **[DOC]** guia https://negocios.avec.app/guia/avec-ia-whatsapp-oficial |
| Avec Pay / Avec Conta / Split | Maquininha, conta digital e repasse | **[DOC]** |
| Asaas | Cobrança de pacotes e recorrência (aviso de taxas na página de planos) | **[DOC]**, sem detalhes |
| Sinc.Finance | Análise de risco do Vale Rápido | **[DOC]** |
| ContaAzul e ZeroPaper | Relatórios 0072 e 0071 geram **Excel no formato de importação** de cada ferramenta. É exportação, não integração em tempo real | **[DOC]** API de Relatórios |
| Power BI, Looker, Tableau, Metabase | Pelo Avec Lake | **[DOC]** |
| Certificado A1 / prefeituras | Emissão de NFS-e e NFC-e | **[DOC]** |
| Google / Instagram | Só o link de agendamento colado nesses canais. Não há "Reserve com o Google" documentado | **[DOC]** link; Reserve **não encontrado** |

**Planos [DOC]:** por número de profissionais. "Começando" (1–2) custa R$ 88,90/mês. As faixas 3–5, 6–10, 11–20 e 21+ são "valor a consultar". A Casa tem 11 pessoas, faixa 11–20 **[INF]**. Avec IA, WhatsApp/marketing automatizado, Avec Pay, Split, emissão de NF e BI são **add-ons** em todas as faixas.

---

## 2. Proposta: o que trazer primeiro para substituir o Avec

Critério: o que a recepção e as profissionais usam **a cada cliente**, todo dia, vem antes do que se usa uma vez por mês. O WhatsApp (ChatGuru) já está coberto pelo CRM. Agora o gargalo é o **balcão**: a cliente chega, é atendida, paga, e a profissional quer saber quanto ganhou.

### Onda 1: o balcão do dia (sem isso não dá para desligar o Avec)

| # | Entrega | Por quê |
|---|---|---|
| 1 | **Serviços com preço e duração**, e tempo próprio por profissional quando for diferente | Base de tudo: agenda, comanda e comissão. Hoje o serviço só tem nome e ciclo |
| 2 | **Agenda em colunas por profissional**, com horário de trabalho, bloqueios, duração ocupando a grade e vários serviços na mesma reserva | É a tela que a recepção mais olha. Hoje a nossa agenda é por lead, não por cadeira |
| 3 | **Comanda**: abrir pelo agendamento ou avulsa; itens de serviço e produto, cada um com a sua profissional; desconto; várias formas de pagamento; fiado e crédito da cliente | Substitui o "fechar venda" de um item só. O pagamento de todo atendimento passa por aqui |
| 4 | **Caixa do dia**: abrir, fechar, sangria e suprimento com motivo; a comanda entra no caixa aberto | É a rotina de abertura e fechamento da recepção; sem isso a gestão não confere o dinheiro |
| 5 | **Comissão calculada na comanda** (% por profissional × serviço e produto) e relatório de fechamento por profissional | Principal motivo de conflito no salão; é o número que as profissionais cobram |
| 6 | **Ficha da cliente com histórico** de atendimentos, valores e profissional (importado do Avec, seção 4) | A recepção precisa ver "o que ela fez da última vez" ao marcar e ao atender |

### Onda 2: fechar o mês e cuidar da cliente

| # | Entrega | Por quê |
|---|---|---|
| 7 | **Pagar comissão** com recibo, descontos (taxa de cartão, produto usado, assistente) e histórico do que foi pago | Fecha o ciclo da Onda 1; substitui o fechamento quinzenal/mensal |
| 8 | **Anamnese e prontuário** (campos configuráveis; o prontuário preenchido no atendimento; fotos anexadas) | A Casa é de **tricologia**: a evolução do couro cabeludo é o histórico mais valioso **[INF]** |
| 9 | **Pacotes de sessões** (venda, saldo, abater na comanda) e **vale-presente/pré-venda** | Muito comum em tratamento capilar; precisa vir com a importação dos pacotes ativos |
| 10 | **Entradas e saídas + fluxo de caixa** com categorias e taxas de cartão | Gestão sai da planilha e o resultado do mês fica visível |
| 11 | **Visão da profissional** (login dela, no celular): a própria agenda do dia e a comissão acumulada | Equivale ao Avec PRO, que as profissionais já usam; reduz as perguntas na recepção |
| 12 | **Estoque básico**: produtos, entrada, baixa na venda e por serviço, estoque mínimo | Controla custo do lavatório e revenda; pode esperar até a comanda estar firme |

### Onda 3: crescer e automatizar (onde podemos ser melhores que o Avec)

| # | Entrega | Por quê |
|---|---|---|
| 13 | **Agendamento online** (link para Instagram/Google) com regras de antecedência e cancelamento | Agenda 24 h sem a recepção; depende da agenda da Onda 1 |
| 14 | **IA que agenda pelo WhatsApp**, dentro da fila que já temos (sugere horário livre e a atendente confirma com um clique, ou agenda sozinha com aprovação) | Equivale ao Avec IA, que é add-on pago; nós já temos a conversa no mesmo lugar |
| 15 | **Campanhas de retorno** e avaliação/NPS pós-atendimento | Retenção; o backlog já pede |
| 16 | **Nota fiscal** (NFS-e/NFC-e) por um emissor terceirizado, inclusive por profissional parceira (Salão-Parceiro) | Obrigatório se a Casa emite hoje pelo Avec. A complexidade fiscal e a prefeitura de Salvador pedem um provedor pronto **[INF]** |
| 17 | Estoque completo (XML da NF-e, pedidos de compra, inventário), mapa de calor, ocupação e fidelidade/assinatura | Valor de gestão, uso menos frequente |
| — | Maquininha integrada / split | Só se a Casa usar Avec Pay hoje. Depende de adquirente; fica fora do escopo inicial **[INF]** |

**Atenção para a transição:** se a Casa usa NF, Avec Pay/split, pacotes ativos ou Avec IA hoje, cada um vira uma dependência. Perguntar antes (seção 4) e, até a Onda 2/3 chegar, manter o Avec só para esse pedaço.

---

## 3. API, integrações e exportação

### 3.1 Existe API pública?

**Existe uma API oficial de LEITURA de relatórios. Não existe API de escrita, nem CRUD de clientes/agendamentos, nem webhook.**

| Item | O que foi achado | Status |
|---|---|---|
| Documentação | **"AVEC - API de Relatórios"** em https://doc.api.avec.beauty (Apidog, projeto 1051992). Índice: https://doc.api.avec.beauty/llms.txt | **[DOC]** |
| O que tem | **278 endpoints `GET /reports/{código}`**: 230 em "Relatórios unidades" e 48 em "Relatórios franquias". São os mesmos relatórios do menu Relatórios do sistema | **[DOC]**; igual ao menu **[INF]** |
| Parâmetros | `page` e `limit` (exemplo 250) obrigatórios em todos. A maioria pede `inicio` e `fim` em **dd/mm/aaaa** (exemplo `01/date('m/Y')`). Alguns pedem filtros: `profissional_id`, `servico_id`, `categoria_id`, `status`, `tipo`, `codigo`, `idStart` | **[DOC]** |
| Autenticação | Header `Authorization: {{token}}`. **A doc não diz como obter o token** (não há página de introdução) | **[DOC]** |
| URL base | A doc traz o modelo `https://prod.your-api-server.com`. Na prática, `GET https://api.avec.beauty/reports/0004?page=1&limit=1` responde **401 `{"code":401,"message":"Não autenticado"}`**, e `api.salaovip.com.br` responde igual. A raiz dos dois responde `{"message":"Avec API"}` | **[TESTE]** |
| Formato da resposta | **Não documentado** (schema vazio `{}` em todas as 278). No endpoint público abaixo o envelope é `{"code":200,"data":{…}}` | **[DOC]** vazio; envelope **[TESTE]** |
| Escrita (criar cliente, agendar) | Não existe na doc | **[DOC]**, ausência |
| Webhooks | Nada encontrado (doc, central de ajuda ou site) | ausência |
| Limites de uso | Não documentados | ausência |

**Como conseguir o token [INF]:** pedir ao suporte/gerente de conta do Avec o **token da API de Relatórios** da unidade, citando a documentação pública. É o caminho limpo. Talvez o token seja o mesmo da sessão de um usuário logado no painel, mas usar isso sem autorização formal **não é recomendado**.

### 3.2 Endpoints sem login (do agendamento online)

O agendamento online e o widget usam a mesma `api.avec.beauty` com rotas públicas por salão. Um script público no GitHub (`arturgarcia13/SandraLourencoBeauty`, arquivo `scripts/sync-avec.mjs`) lê estas três **[3º]**, e eu conferi a estrutura **[TESTE]**:

| Rota | O que traz |
|---|---|
| `GET /salao/{salao_id}/servicos/online?status=1` | Serviços **com agendamento online ligado**: `id`, `servico`, `categoria`, `descricao`, `valor`, `tipo_valor` ("apartirde" etc.), **`tempo` (duração em min)**, `comissao`, `custo`, `retorno` (dias para retorno), `agendamento_paralelo`, `valor_promocional`, dados fiscais (`iss_aliquota`, `cnae`…) |
| `GET /salao/{salao_id}/profissionais?status=1&status_agenda_online=1` | Profissionais visíveis online: `id`, `nome`, `apelido`, `cargo`, `especialidade`, `intervalo_agenda`, `assistente`, `split_transacao`, `tipo_contratacao`, **`importacao_id`**… |
| `GET /salao/{salao_id}/avaliacoes?page=N` | Avaliações públicas (estrelas, texto, nome, data) |

O JavaScript do agendamento (`https://agendamento.avec.beauty/js/services.js`) mostra também as rotas **da cliente logada**: `cliente/signin`, `cliente/agendamentos`, `cliente/comandas`, `cliente/pacote/comprar`, `cliente/fidelidade`, `cliente/cartoes` **[3º]**. Não servem para exportar a base do salão.

**Uso para nós:** dá para puxar **serviços (preço + duração) e profissionais** sem senha, mas só os que estão no agendamento online da Casa. Precisa do `salao_id` ou do slug da Casa. Não é documentado: serve como atalho de importação, não como integração permanente **[INF]**.

### 3.3 Exportar pela tela (sem API)

**[3º]** Tutorial da Belle Software (https://ajuda.bellesoftware.com.br/exportacao-avec/, imagens de 2020): **menu Relatórios → escolher o relatório → "Ver relatório" → botão "Excel"**. O exemplo usa "Lista de dados de todos os clientes" e "Tabela de preços dos serviços". O site do Avec também cita "1 clique para exportar e validar o fechamento" de comissões **[DOC]**. A central de ajuda atual **não tem artigo de exportação**.

Relatórios que interessam para a migração. Os códigos e as descrições são da doc oficial **[DOC]**; as colunas exatas só aparecem quando o relatório é aberto **[INF]**:

| Dado | Relatório (código: nome) | O que traz, segundo a descrição oficial |
|---|---|---|
| **Clientes (base toda)** | 0004: Lista de dados de todos os clientes | E-mail, telefone, celular e aniversário de **todas** as clientes |
| | 0012: Clientes cadastrados no período | Clientes por data de cadastro (usar período longo) |
| | 0019: Clientes cadastrados por "Como conheceu" | Origem da cliente |
| | 0105: Clientes deletados | Para não reimportar quem foi apagado |
| **Histórico de atendimentos** | 0129: Clientes atendidos por profissional | Por profissional: nome, e-mail, telefones, **valor total gasto, data de cadastro, última visita, nº de visitas** |
| | 0002: Clientes atendidos | Visitas por cliente e **o que cada cliente consumiu** no período |
| | 0180: Todos os serviços e produtos vendidos | Cada venda de serviço e produto no período |
| | 0186: Todos os itens das comandas e comissões | Item a item das comandas com a comissão gerada (sem descontos de cartão/produto/assistente) |
| | 2187: Comandas agrupadas por cliente e forma de pagamento | Inclui uso de crédito e de pacote |
| | 0213: Comandas com dívidas acumuladas | Valor da comanda, pagamentos e ajuste de dívida/crédito |
| | 0182: Observações nas comandas | Texto livre das comandas |
| **Agendamentos** | 0051: Clientes com agendamentos / 0155: Agendamentos por quem agendou / 0248: Agendamentos por status / 0052: Cancelados / 0056: Origem da reserva | Agenda passada e **futura** (para não perder os horários já marcados) |
| **Serviços** | 0033: Tabela de preços dos serviços (e 2033 com custos) | Serviço, categoria e valor. **A descrição não cita a duração** |
| | 0024: Serviços por profissional / 0025: Profissionais por serviço | Quem fez o quê (quantidade e faturamento), útil para montar "quem faz cada serviço" |
| | 0163: Tabela de preços dos pacotes | Pacotes e valores |
| **Profissionais** | 0229: Lista de Profissionais | Todas as profissionais cadastradas |
| **Comissões** | 0123 / 8123: Profissionais e todas as comissões por período | Comissões geradas, **com dados cadastrais e bancários** das profissionais |
| | 0028: Comissões pagas / 0226: Recibos das comissões pagas | O que já foi pago |
| **Saldos em aberto** | 0063: Clientes com pacotes ativos / 0064: Pacotes utilizados | Sessões restantes que precisam continuar valendo |
| | 0006: Clientes com crédito e/ou débito | Fiado e créditos |
| | 0087 / 0181 / 0202: Vales-presentes vendidos, consumidos e vencidos | Vales em aberto |
| | 0113: Pontos de fidelidade acumulados | Se a Casa usa fidelidade |
| **Ficha técnica** | 0115 (e 2115): Ficha de anamnese por cliente | Campos preenchidos por cliente |
| | 0116: Fichas de prontuário por data | Prontuário por período |
| **Estoque** | 0149: Posição de estoque / 0043: Valores dos produtos / 0045: Produtos com custo | Produtos, quantidades e preços |
| **Avaliações** | 0104: Avaliações dos clientes no app | Notas e comentários |
| **Financeiro (contador)** | 0072: Integração ContaAzul / 0071: ZeroPaper / 0387: Entradas e saídas analítico | Excel pronto para importar em outra ferramenta |

**O que provavelmente NÃO sai em relatório [INF]:** a **% de comissão configurada** por profissional × serviço, a **duração por profissional**, o **horário de trabalho** de cada uma, as perguntas da anamnese e a configuração dos pacotes. Isso é configuração, não movimento. Vai por print/cópia da tela ou pela rota pública da 3.2 (duração e comissão padrão do serviço).

### 3.4 Pedir ao suporte (portabilidade)

Os termos de uso do sistema não abriram (a página carrega por JavaScript) **[ausência]**. Pela **LGPD (art. 18, V, portabilidade)**, a Casa, como controladora dos dados das clientes, pode pedir a exportação completa **[INF jurídica]**. O relatório 0073 ("Consulta cliente pelo código de importação") prova que o Avec **faz importação** de outros sistemas na entrada **[DOC]**. Pedir o caminho inverso: um **dump completo** (clientes, comandas com itens, agendamentos, anamneses, prontuários, anexos/fotos, pacotes, créditos) em planilha/CSV.

**Atenção [3º]:** o Reclame Aqui tem queixas de **cobrança depois do cancelamento** e de suporte difícil (ex.: https://www.reclameaqui.com.br/avec-by-hyperlocal/avec-salao-vip_oXe4o7OU1lvBpGa8/). **Exportar tudo antes de pedir o cancelamento** e cancelar por escrito, com protocolo.

---

## 4. O que pedir à Casa Fiaes para importar os dados

**Acesso e situação da conta**
1. **Login de administrador** do Avec (usuário "master" ou com permissão total), ou alguém da Casa para fazer as exportações por videochamada.
2. **Plano e add-ons contratados:** Avec IA, WhatsApp/marketing, Avec Pay, Split, emissão de NF, fidelidade, clube de assinaturas. Também data de renovação e fidelidade/multa. Cada add-on em uso é uma dependência da transição.
3. O **link de agendamento online** da Casa (para descobrir o slug e o `salao_id`), se existir.
4. Pedido formal ao suporte do Avec, **feito pela titular**, do **token da "API de Relatórios"** (https://doc.api.avec.beauty) e da **exportação completa** pela LGPD. Pedir antes de cancelar.

**Exportações em Excel (menu Relatórios → Ver relatório → Excel)**. Os períodos longos devem ser exportados **mês a mês ou ano a ano** se o relatório travar.

5. **Clientes:** 0004 (base toda), 0012 (cadastro desde o início), 0019 (como conheceu), 0105 (deletados).
6. **Histórico de atendimentos**, desde quando a Casa usa o Avec: 0180 (serviços e produtos vendidos), 0186 (itens das comandas com profissional e comissão), 0129 de **cada** profissional (última visita, nº de visitas, total gasto), 0002 e 0182 (observações).
7. **Agenda:** 0051/0155/0248 com período **de hoje até o fim dos horários já marcados** (agenda futura) e dos últimos 12 meses.
8. **Serviços:** 0033 (tabela de preços) e 0163 (pacotes). Mais uma **lista com a duração de cada serviço** e as exceções por profissional (ex.: "Bia faz mechas em 2h30"), se a planilha não trouxer a duração.
9. **Profissionais:** 0229 (lista) e 0024 de cada uma (quais serviços faz).
10. **Comissões:** print ou cópia da aba **"Serviço e Comissão"** de cada profissional (% por serviço, % como assistente, comissão de produto). Também as regras gerais de **descontos** da comissão (taxa de cartão, produto, administração) e a **data de recebimento**. Para referência do último fechamento: 0123 do último mês e 0028/0226 (o que já foi pago).
11. **Saldos que precisam continuar valendo:** 0063 (pacotes ativos e sessões restantes), 0006 (créditos e débitos das clientes), vales-presentes em aberto (0087/0202) e pontos de fidelidade (0113), se usados.
12. **Ficha técnica:** 0115 (anamnese) e 0116 (prontuário, desde o início), mais a **lista das perguntas** da anamnese e dos campos do prontuário. Perguntar se há **fotos/anexos** nas fichas; não existe relatório para eles, então entram no pedido formal (item 4).
13. **Estoque** (se for migrar na Onda 2): 0149 (posição hoje) e 0043 (preços).

**Perguntas de operação (para decidir as ondas)**

14. A Casa **emite nota fiscal pelo Avec**? NFS-e, NFC-e ou as duas? Usa **multiempresa** (nota da profissional parceira/MEI)?
15. Usa **Avec Pay**, **split** ou **Vale Rápido**? Qual maquininha?
16. As profissionais usam o **Avec PRO** no dia a dia? Para quê (agenda, comissão)?
17. O Avec manda **lembrete/confirmação por WhatsApp** hoje? Por qual número? Se for o Avec IA com WABA, é preciso desligar para não duplicar com as nossas automações.
18. **Como é o fechamento de comissão** (semanal, quinzenal, mensal)? Há descontos de taxa de cartão ou de produto?
19. Vendem **pacotes**, **vale-presente** ou **pré-venda**? Deixam **fiado**?
20. Abrem e fecham **caixa** no Avec todo dia? Quem faz?
21. **Autorização (LGPD):** a Casa, como controladora, autoriza levar os dados das clientes para o CRM próprio.

**Chave de junção entre as fontes [INF]:** o **celular** (normalizado com DDI 55) junta a cliente do Avec com o contato do WhatsApp/CRM. Quando houver, o **CPF** e o nome completo servem de reforço. Antes de importar, rodar os relatórios de duplicados (0010 celular, 0018 e-mail, 0210 CPF).

---

## Fontes consultadas

- Site comercial e planos:
  - https://negocios.avec.app/
  - https://negocios.avec.app/avec-planos
  - https://negocios.avec.app/avec-full
  - https://negocios.avec.app/lpavec-360
- Funcionalidades:
  - https://negocios.avec.app/avec-ia
  - https://negocios.avec.app/marketing-com-ia-para-beleza
  - https://negocios.avec.app/avec-fidelidade
  - https://negocios.avec.app/clube-de-assinaturas-para-beleza
  - https://negocios.avec.app/relatorios-e-indicadores-para-beleza
  - https://negocios.avec.app/avec-mapa-de-calor
  - https://negocios.avec.app/banco-de-dados-inteligente-avec-lake
  - https://negocios.avec.app/avec-pagamento-de-comissao
  - https://negocios.avec.app/avec-estoque-e-produtos
  - https://negocios.avec.app/avec-fluxo-de-caixa
  - https://negocios.avec.app/split-de-pagamentos-para-salao-e-clinica
  - https://negocios.avec.app/antecipacao-de-comissao-para-beleza
  - https://negocios.avec.app/emissao-de-notas-fiscais-avec
  - https://negocios.avec.app/avec-pro
  - https://negocios.avec.app/app-para-profissionais-de-beleza-avec-pro
  - https://negocios.avec.app/app-white-label-para-salao-e-clinica
  - https://negocios.avec.app/sistema-gestao-beleza
- Central de ajuda (95 artigos): https://negocios.avec.app/central-de-ajuda/home. Os mais usados aqui:
  - https://negocios.avec.app/central-de-ajuda/post/agendar-servico-na-avec
  - https://negocios.avec.app/central-de-ajuda/post/como-ativar-o-agendamento-online
  - https://negocios.avec.app/central-de-ajuda/post/como-abrir-uma-nova-comanda
  - https://negocios.avec.app/central-de-ajuda/post/como-finalizar-uma-comanda-com-divida-na-avec
  - https://negocios.avec.app/central-de-ajuda/post/como-configurar-servicos-e-comissoes-do-profissional
  - https://negocios.avec.app/central-de-ajuda/post/como-configurar-os-descontos-das-comissoes-dos-profissionais
  - https://negocios.avec.app/central-de-ajuda/post/como-realizo-o-pagamento-dos-profissionais
  - https://negocios.avec.app/central-de-ajuda/post/como-realizo-a-abertura-e-o-fechamento-de-um-caixa-na-avec
  - https://negocios.avec.app/central-de-ajuda/post/onde-visualizar-as-entradas-e-saidas-do-financeiro-na-avec
  - https://negocios.avec.app/central-de-ajuda/post/como-configurar-a-baixa-automatica-de-produtos-no-estoque-na-avec
  - https://negocios.avec.app/central-de-ajuda/post/o-que-e-anamnese-e-como-configura-la-no-cadastro-do-cliente
  - https://negocios.avec.app/central-de-ajuda/post/como-configurar-o-prontuario-e-adiciona-lo-ao-cadastro-do-cliente
  - https://negocios.avec.app/central-de-ajuda/post/como-cadastrar-pacotes-na-avec
  - https://negocios.avec.app/central-de-ajuda/post/como-cadastrar-grupos-de-acesso-na-avec
  - https://negocios.avec.app/central-de-ajuda/post/como-adicionar-uma-mensagem-de-aviso-na-avec
  - https://negocios.avec.app/central-de-ajuda/post/como-unificar-cadastros-duplicados-de-clientes-na-avec
  - https://negocios.avec.app/central-de-ajuda/post/boas-praticas-para-criar-sua-conta-bm-do-meta
  - https://negocios.avec.app/guia/avec-ia-whatsapp-oficial
- API de Relatórios:
  - https://doc.api.avec.beauty
  - Índice: https://doc.api.avec.beauty/llms.txt
  - Exemplos: https://doc.api.avec.beauty/0024-servi%C3%A7os-por-profissional-20770773e0 e https://doc.api.avec.beauty/0129-clientes-atendidos-por-profissional-20770860e0
- Testes sem login (14/10/2026): `https://api.avec.beauty/` e `https://api.salaovip.com.br/` (raiz e `/reports/0004`), além de `https://api.avec.beauty/salao/{id}/servicos/online` e `/profissionais`.
- Agendamento online e widget: https://agendamento.avec.beauty (`js/services.js`) e https://admin.avec.beauty/agenda_integracao/bellasul
- Código de terceiros: https://github.com/arturgarcia13/SandraLourencoBeauty (`scripts/sync-avec.mjs`)
- Exportação (terceiros): https://ajuda.bellesoftware.com.br/exportacao-avec/
- Apps:
  - https://play.google.com/store/apps/details?id=br.com.salaovip.terminal (Avec PRO, 100 mil+, atualizado em 01/10/2026)
  - https://play.google.com/store/apps/details?id=com.avec (Avec cliente)
- Reclame Aqui: https://www.reclameaqui.com.br/avec-by-hyperlocal/avec-salao-vip_oXe4o7OU1lvBpGa8/
