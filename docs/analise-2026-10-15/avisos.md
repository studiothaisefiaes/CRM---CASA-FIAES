## Avisos, sinais e "quem está fazendo o quê": análise do CRM Casa Fiaes (só leitura)

Prints e consultas estão em `/private/tmp/claude-501/-Users-joaquimsalles/1d859e91-de4e-47e9-bde3-8a64964253fe/scratchpad/analise/avisos/`: telas `01-hoje` … `13-aguardando-cliente` (.png e .txt) e as consultas `a1.sql` … `b2.sql`. Banco consultado em 15/10, 00:40 de Salvador, com a sessão em modo só leitura.

**Duas coisas sobre as regras de hoje:**
- **Violei a regra de não escrever no servidor.** Por engano, copiei com `scp` um arquivo de texto com SQL para `/tmp/q1_readonly_analise.sql` no servidor. Apaguei logo em seguida e confirmei que sumiu. Nada mais foi escrito lá; o resto das consultas foi enviado pela entrada padrão.
- **Abrir uma conversa no CRM manda o "visto azul" para a cliente no WhatsApp.** Isso acontece com qualquer pessoa que abra, inclusive a gestão (`conversation-pane.tsx:121` → `send.ts:226-244`). No navegador headless bloqueei tudo que não fosse leitura e liberei só a ação que carrega a conversa (`getConversationAction`). O "visto" foi bloqueado 3 vezes e nenhum foi enviado.

---

### 1. A causa raiz de "quem está fazendo o quê"

- **A equipe ainda responde pelo ChatGuru ou pelo celular.**
  - Nos últimos 4 dias saíram 501 mensagens, e **nenhuma foi enviada por alguém logado no CRM** (`sent_by_user_id` vazio em todas).
  - As 64 respostas a cliente esperando de 14/10 vieram todas do celular.
- **A informação de quem respondeu está no texto e o CRM ignora.** Nos últimos 7 dias, 417 mensagens começam com `*SARA - CASA FIAES:*`, 258 com `*CATI - CASA FIAES:*` e 92 não têm assinatura.
- **84% das conversas abertas estão "Sem dono" (155 de 185), e isso é falso.**

| Dona no CRM | Quem respondeu por último (pela assinatura) | Leads |
|---|---|---|
| Sem dono | Sara | 89 |
| Sem dono | Cati | 51 |
| Sem dono | ninguém / sem assinatura | 15 |
| Sara | Sara | 16 |
| Sara | **Cati** | 10 |
| Sara | ninguém | 4 |

- **Por que fica sem dono:**
  - A gestão nunca recebe conversa sozinha (`deals.ts:50`), e a Cati tem perfil de Gestão.
  - Resposta pelo celular só conta para quem já é dona (`deals.ts:280`).
  - Os 162 "Sem dono" foram feitos à mão pelo Joaquim em 14/10.
- **A Sara aparece como dona de 30 leads, mas nunca escreveu pelo CRM.**
- **Presença e distribuição hoje não dizem nada:**
  - A distribuição automática está **desligada**: não existe a configuração `distribuicao` no banco, então vale o padrão `enabled:false`.
  - Os 4 usuários estão "Ausente". A Sara aparece Ausente porque usa o ChatGuru e não deixa o CRM aberto.
  - **Nenhum aparelho está inscrito para receber push** (0 inscrições).

**Como a equipe sabe hoje quem está atendendo cada cliente:**
- Na Fila, o primeiro nome da dona aparece na linha cinza (`queue-item.tsx:169`), e "Sem dono" aparece em dourado.
- No Quadro aparecem as iniciais num círculo com dica ao passar o mouse (`deal-card.tsx:43`). Sem dono, não aparece nada.
- No painel da cliente há "Responsável".
- Na Jornada, nada.
- A presença (Disponível/Pausa/Ausente) só aparece em Configurações › Distribuição e no menu "Transferir para…".
- Não existe "quem está atendendo agora" nem "Equipe agora".
- **Na prática, a equipe descobre quem atendeu lendo a assinatura dentro do balão da conversa.**

---

### 2. Números do banco

- **Alertas abertos (sem resolver), por tipo e público:**
  - `tarefa_vencendo`, gestão, nível 1: 34 abertos, 34 não lidos. São tarefas sem responsável; nenhuma pessoa recebe.
  - `tarefa_vencendo`, responsável: 12, todos da Sara e não lidos.
  - `aniversario_em_dias`, gestão: 1, já lido.
  - Atraso de espera (`sem_resposta_minutos`): **0 abertos.** A varredura da meia-noite resolveu todos.
- **Histórico de 14/10:**
  - 76 alertas de espera em 36 leads, sendo **61 escalados para a gestão** (nível 2).
  - Mediana de 40 min até resolver. Os alertas vão das 11h às 18h, de 6 a 12 por hora.
  - 11 alertas `mensagem_sem_numero` foram criados por um código que já não existe no repositório.
- **Por que tanta coisa atrasa:**
  - Mediana de resposta real em 14/10: **11,7 min**. Só 21 de 64 respostas saíram em até 3 min.
  - O prazo das etapas é 2 min (Lead) e 3 min (as demais), inclusive Agendado.
  - O horário da Casa **não está configurado** (não há `business_hours`). Vale o padrão seg–sex 8–20h e sáb 8–17h (`business-hours.ts:5`), mas a própria Casa diz "terça a sábado, das 9h às 18h". **Segunda-feira e o horário das 18h às 20h contam como atraso falso.**
- **Leads abertos por etapa:**

| Etapa | Abertos | Sem dono | Sara | Conversa arquivada |
|---|---|---|---|---|
| Lead | 8 | 7 | 1 | 5 |
| Atendimento | 92 | 68 | 24 | 41 |
| Agendado | 29 | 28 | 1 | 0 |
| Follow-up 1 | 56 | 52 | 4 | 1 |

- **Fila agora (138 visíveis):**
  - Próximas ações de hoje: 73 (65 sem dono, **45 com tarefa vencida**).
  - Aguardando a cliente: 65.
  - Atrasados, Prazo estourado, Perto, Aguardando e Parados: 0.
  - Conferir comparecimento: 0.
  - Arquivadas: 47.
- **Tarefas:**
  - 84 próximas ações abertas: **72 sem responsável**, 50 vencidas.
  - 32 de comparecimento (28 sem responsável).
  - 104 tarefas abertas são de leads sem dono.
- **Etiquetas:** só existe uma, "Uso de imagem" (38 contatos). O selo "Cliente" aparece em 137 de 185 leads (74%).

---

### 3. Tabela de avisos

Colunas: texto exato, quando aparece (arquivo:linha), se a tela explica, o problema e o texto proposto para a equipe.

**Fila: cabeçalhos de seção**

`queue-list.tsx:123` só mostra o nome e o número. **Nenhuma seção explica o que significa nem o que fazer.**

| Texto | Quando aparece | Explica? | Problema | Proposta |
|---|---|---|---|---|
| **Atrasados** | Há alerta de espera aberto (`queue.ts:286`, `late-count.ts:17`) | Não | Bom, mas some à meia-noite (`overdue-waits.ts:17`) e vira tarefa | "Atrasados: a cliente escreveu e ninguém respondeu no prazo. Responda primeiro." |
| **Prazo estourado** | Passou do prazo, mas o motor ainda não criou o alerta (`queue.ts:286`) | Não | Detalhe técnico, dura menos de 1 min. Fica dourado na Fila e vermelho no Quadro | Juntar com Atrasados. |
| **Perto do prazo** | 50% do prazo (`queue.ts:27`). Cabeçalho, Quadro e WhyLate usam 60% (`timer.tsx:45`) | Não | Duas regras diferentes | "Quase no prazo: responda em X min." Uma regra só. |
| **Aguardando resposta** | Cliente esperando, dentro do prazo | Não | Confunde com "Aguardando a cliente" | "Esperando a Casa responder" |
| **Próximas ações de hoje** | Tarefa vencida ou de hoje (`queue.ts:286`) | Não | Mistura tarefas vencidas de ontem (45) com as de hoje. "venceu 13:00" sem dia | "Combinado para hoje e atrasados", com "venceu ontem 13:00" |
| **Parados** | Sem próxima ação e além do limite da etapa | Não | O limite é 1 dia em quase todas as etapas: amanhã quase tudo vira Parado | "Parados: há X dias sem ninguém decidir o próximo passo. Marque Agendar, Retomar depois ou Encerrar." |
| **Aguardando a cliente (65)** | O resto | Não. Começa recolhido, com "Mostrar" | Nome parecido com o de cima | "Bola com a cliente: a Casa respondeu, agora é com ela." |
| **Arquivadas** / "arquivada · volta se alguém escrever" | `queue-item.tsx:94` | Sim | Mesma ação se chama Arquivar (`pane-header.tsx:91`) e Encerrar conversa (`client-pane.tsx:257`) | Usar só "Encerrar conversa". |
| **Para reengajar** / "sem contato há N d" | Visão "Sem contato há 90 dias" | Parcial | Ok | — |
| **Conferir comparecimento (N)** | Agendado cujo horário já passou e sem Compareceu/Faltou (`queue.ts:209`) | Não. Começa recolhido | Recolhido esconde a pendência | "Já passou do horário: ela veio? Toque em Compareceu ou Faltou." |
| Resumo: "N esperando resposta · N atrasados · N agendados hoje" (+ reclamações, eventos/noivas) | `queue-summary.tsx:15-20` | Não | Ok, mas falta "sem dono" e "tarefas vencidas" | Acrescentar "12 sem dono" e "45 combinados vencidos". |

**Fila: linha da conversa**

| Texto | Quando aparece | Explica? | Problema | Proposta |
|---|---|---|---|---|
| "atrasado · 4 min além do prazo", "prazo estourado há…", "perto do prazo · faltam…", "dentro do prazo" | `queue.ts:57-61` (`lib/queue.ts`) | Parcial | Quatro textos para uma ideia | "Responder agora: 4 min além do prazo" / "Responda em 1 min" |
| Anel em volta da foto (cinza, dourado, vermelho, com pulso) | `queue-item.tsx:26` | Não | Na Jornada, o anel "ok" é verde; na Fila, cinza | Legenda e a mesma cor em todas as telas |
| **"Você: "** antes da última mensagem | `queue-item.tsx:163`, `deal-card.tsx:49` | — | **Errado**: aparece "Você: *SARA - CASA FIAES:*" para quem não é a Sara | "Sara:" lendo a assinatura, ou "Casa:" |
| Primeiro nome da dona / **Sem dono** | `queue-item.tsx:169` | Não | 155 "Sem dono" falsos (ver seção 1) | "Sem dono: ninguém assumiu. Toque em Assumir se for você." Mostrar também "Respondida por Cati (celular)". |
| **Cliente** | `contact.isClient` | Não | Aparece em 74% das linhas, então não informa | Tirar da linha (fica no painel) ou trocar por "Cliente desde 2021" |
| **Novo** | Criado hoje e não importado (`queue.ts:290`) | Não | Ok | "Novo hoje" |
| **Agendado hoje / amanhã** | `queue.ts:291` | Sim | Ok | Mostrar a hora |
| **Tarefa atrasada** | Tarefa vencida (`queue.ts:291`) | Não | Repete o "venceu" da linha de cima | Tirar |
| **Parado** | `queue.ts:291` | Não | Duplica a seção | Só "parado há 3 dias" |
| **Transferida por Fulana** | Última troca de dona feita por outra pessoa, e a nova dona ainda não respondeu (`queue.ts:182`) | Não | 0 casos no banco | "Fulana te passou esta conversa" |
| **Pediu preço**, Pediu horário, Reclamação, Urgente, Sumiu após preço, Quer remarcar/cancelar, Evento/noiva, Pediu desconto, Indicação, Responde rápido | Palavras nas últimas 30 mensagens dela (`signals.ts:7-11`, `:40-51`), no máximo 2 por linha (`QUEUE_SIGNAL_MAX`) | Não | **Não somem depois de atendidos**: "Pediu preço" continua mesmo após a Casa mandar o valor. "Responde rápido" é ruído. Uma linha chegou a 6 chips | Contar só o que ainda não foi respondido; tirar "Responde rápido"; dica em cada chip |
| **Interesse: <serviço>** | Nome de um dos 55 serviços aparece na mensagem | Não | Ok | — |
| Etiquetas da equipe (borda) | `queue-item.tsx:170` | — | Na mesma linha dos sinais automáticos | Separar "etiquetas da equipe" de "sinais do sistema" |
| "Atendimento · Não identificada · Sem dono" | Etapa, origem e dona | Não | "Não identificada" aparece em quase tudo | Esconder a origem quando for desconhecida |

**Cabeçalho da conversa e painel direito**

| Texto | Quando aparece | Explica? | Problema | Proposta |
|---|---|---|---|---|
| Relógio vermelho "Esperando resposta há X · prazo N min" | `pane-header.tsx:33-45`. Vermelho a partir de 100%, dourado a partir de 60% | Só dica ao passar o mouse | Vermelho antes do alerta; regra diferente da Fila | "Esperando há 12 min (prazo 3)" |
| WhyLate: "Cliente escreveu às HH:MM e ninguém respondeu (X no expediente; prazo N min)", "Sem resposta da Casa desde … — Casa fechada até …", "A Casa respondeu às 13:15 e agora é a vez da cliente" | `why-late.ts:54,60,65` | **Sim, é o melhor texto do sistema** | "às 13:15" sem o dia (era ontem); não diz quem respondeu | "Cati respondeu ontem 13:15 pelo celular; agora é a vez da cliente." |
| Responsável: "Sem dono" + "Assumir e responder" | `client-pane.tsx:48`, `primary-action.ts:6` | Não | Para a gestão aparece até em lead da Sara | "Sara está cuidando. Assumir tira dela." |
| **"Compareceu?"** com Compareceu/Faltou | Toda etapa Agendado (`client-pane.tsx:242`) | Não | **Pergunta antes do horário** (vi num agendamento de 17/10) | Mostrar só depois do horário |
| "pelo celular · " no balão | `conversation.tsx:77` | — | Não diz quem foi | "Cati pelo celular" (pela assinatura) |
| Selo "Cliente", Situação (etapa), "Agendado para …" | `client-pane.tsx` | Sim | Ok | — |

**Sino (Alertas)**

- O sino mostra só a mensagem, uma bolinha (vermelha = urgente, dourada = informação, verde = resolvido) e "há X" (`alerts-bell.tsx:128-137`).
- Não tem legenda, não agrupa por tipo, só mostra os últimos 7 dias e no máximo 30 itens.

| Tipo | Texto exato | Origem | Para quem | Problema | Proposta |
|---|---|---|---|---|---|
| `sem_resposta_minutos` nível 1 | "{nome} respondeu e está esperando há {minutos} min" **ou** "{nome} está esperando resposta há {minutos} min" | 2 automações, ambas usando o prazo da etapa (o 2/3 configurado é ignorado). Vence a que roda primeiro | Dona, ou gestão se sem dono | Dois textos para a mesma coisa; o número fica congelado | "Fulana espera resposta (prazo 3 min)" |
| `sem_resposta_minutos` nível 2 | "{nome} está sem resposta há 10 min" | `engine.ts:184` | Gestão (e a dona continua vendo) | 61 de 76 em 14/10; push com o título "Atraso escalado para a gestão" | "Escalado: Fulana sem resposta desde 14:02. Dona: Sara." |
| `tarefa_vencendo` | "{título} — {nome}" | `tasks.ts:151` | Responsável, ou gestão se não houver | **"Retomar contato com X — X"** repete o nome; "Retomar contato com a cliente — +5571…" mostra o telefone cru; 7 deles nasceram às 00:00. Sem push | "Combinado vencendo: retomar contato (Fulana)". Não disparar de madrugada. |
| `oferta` | "Pode assumir a {nome}? Esperando há N min" + botão Assumir | `offers.ts:60` | Próxima pessoa livre | Distribuição desligada, nunca dispara. Push com título "Lead esperando" | "A dona não respondeu. Pode assumir Fulana?" |
| `assumiu_sua_conversa` | "{Pessoa} assumiu a {cliente}" | `assign.ts:31` | Dona anterior | Artigo "a" fica errado com cliente homem | "Cati assumiu a conversa de Edson" |
| `transferido_para_voce` | "{Pessoa} transferiu a {cliente} para você" | `assign.ts:54` | Quem recebe | Sem push | Idem |
| `aniversario_em_dias` | "Aniversário de {nome} em 7 dias. A mensagem está pronta no card" | Automação | Dona ou gestão | **Mentira: não existe mensagem pronta** | "Aniversário de Fulana dia 17/10. Que tal mandar um parabéns?" |
| `parado_dias`, `sem_retorno_cliente_dias`, `data_recontato`, `data_cobranca` | "{nome} está parado em {etapa} há {dias} dia(s)", "{nome} foi para o {etapa}. Hora de retomar o contato", "Dia de recontato com {nome}. O lead voltou para Atendimento", "Hoje é dia de cobrar {nome}" | Automações | Dona ou gestão | Ok, mas sem dona tudo cai na gestão | — |
| `whatsapp_desconectado` / `whatsapp_sem_conexao` | "O WhatsApp "X" desconectou. Leia o QR code de novo em Configurações › WhatsApp." / "… está sem conexão há N min: mensagens novas não estão chegando…" | `webhook.ts:216`, `watchdog.ts:33` | Gestão | **Bom, diz o que fazer** | — |
| `envio_automatico_falhou`, `webhook_falhou` | "Não foi possível enviar a mensagem automática para …", "Uma mensagem do WhatsApp não pôde ser registrada depois de N tentativas. Erro: …" | `outbox.ts:138-195`, `webhook.ts:383` | Gestão | Telefone cru; erro técnico | "Mensagem automática para Fulana não saiu. Abra a conversa e envie manualmente." |

**Outros avisos**

| Onde | Texto | Explica? | Problema |
|---|---|---|---|
| Aba do navegador | "(N) atrasados · Casa Fiaes" + som + anúncio para leitor de tela | Não | Ok (`late.ts:5`, `late-watch.tsx`) |
| Faixas no topo | "O WhatsApp X está desconectado. Enquanto isso, novos leads e mensagens não chegam." + Reconectar / Avise a gestão; "Número recém-conectado: avisos pausados até …" | **Sim** | — (`connection-banner.tsx:37-48`) |
| Hoje | "Esperando resposta agora", "N atrasados · ver na fila", "Minhas próximas ações", "Comparecimentos para conferir", "Parados agora", "Follow-ups" | Parcial | **"Minhas próximas ações" só mostra tarefas com responsável** (`today.ts:26`). Para a gestão aparece "Nenhuma ação vencida" com 50 vencidas sem dono — falha silenciosa |
| Push | "Lead esperando" / "Atraso escalado para a gestão" (`push.ts:57`) | — | 0 aparelhos inscritos; tarefas e transferências não geram push |
| Quadro | **"Sua vez · 3 min"**, "Aguardando cliente · 11 h 53", iniciais da dona | Não | "Sua vez" significa "vez da Casa"; sem dono não aparece nada; vermelho com regra diferente da Fila |
| Jornada | "atrasado · X", "agendado para ter 15h", "com a cliente", "N atrasados" na estação | Não | Não mostra a dona; anel verde diferente da Fila |

---

### 4. O que deveria existir e não existe

1. **Ler a assinatura `*NOME - CASA FIAES:*` das mensagens que chegam pelo celular ou ChatGuru.** Ela diria quem respondeu, mostraria "Respondida por Cati" no balão e na Fila, e poderia oferecer "assumir para quem respondeu". Só isso já acaba com a maioria dos 155 "Sem dono" falsos. Hoje é a única fonte confiável de "quem está fazendo".
2. **"Equipe agora"** no Hoje e no topo da Fila: cada pessoa, o estado, quantas conversas espera responder, qual a última resposta e há quanto tempo.
3. **"Fulana está nesta conversa" ou "está digitando"**, para duas pessoas não responderem a mesma cliente.
4. **Legenda da Fila**: um ícone "?" ao lado de cada seção e de cada chip com o texto curto da tabela acima, mais uma página "O que cada aviso quer dizer" para treinar a equipe.
5. **Filtros da Fila que faltam**: "Sem dono", "Respondidas por mim" e "Combinados vencidos". O "Sem dono" existe como visão, mas não como número no resumo.
6. **Tarefa sem responsável vai para a dona do lead ou para quem respondeu por último.** Hoje 72 tarefas não aparecem para ninguém.
7. **Sino agrupado por tipo**, com filtros "Para mim" e "Para a gestão", e um botão "Resolver", não só "Marcar como lido".
8. **Configurar prazos e horário de verdade**: ter–sáb 9–18h e um prazo realista (por exemplo 10–15 min) até a equipe migrar para o CRM. Sem isso, cerca de 80% das esperas viram escaladas falsas.
9. **"Visto" enviado só quando a dona abre a conversa**, não quando a gestão olha.
10. **Uma regra só de cor e prazo**: mesmos 50% ou 60%, mesmo vermelho, mesmo anel em Fila, Quadro, Jornada e cabeçalho.

Problema menor, fora do tema: `nextWaitingId` (`queue.ts:391`) não ignora conversas arquivadas, então o "Próximo da fila" pode cair numa conversa arquivada.