# Casa Fiaes CRM: documento de desenho "um sistema só" (ChatGuru + Avec)

Este documento serve para o dono aprovar. Depois de aprovado, vira spec e plano. Os números vêm das 5 auditorias somente leitura de 15/10, feitas às 00h40 de Salvador, no banco de produção e no código da branch `rodada-2`. Dados de cliente estão anonimizados.

---

## 1. Entendimento do pedido

| O que ele disse | O que estamos assumindo |
|---|---|
| "Um sistema ChatGuru junto com o Avec" | O CRM passa a ser o lugar onde a equipe responde o WhatsApp **e** marca, confere e cobra os horários. Primeiro chegamos à paridade do que a Casa usa de verdade. Não é para copiar tudo dos dois. |
| "Aparecer as etiquetas certinho de quem está atendendo" | Em toda tela (Fila, Quadro, Jornada, conversa, Agenda, ficha) aparece **quem é a dona** e **quem respondeu por último**, mesmo quando a resposta saiu do celular ou do ChatGuru. |
| "Todos os avisos, sem exceção, perfeitamente explicados" | Cada seção, chip, cor e alerta do sino diz em uma frase o que aconteceu e o que fazer. Cada um ganha um "?" com legenda, e existe uma página "O que cada aviso quer dizer". |
| "Quem é sem dono, quem tá fazendo as coisas" | "Sem dono" só aparece quando é verdade. Existe um painel "Equipe agora". |
| "Em Atendimento tem muita gente" | Hoje a etapa Atendimento serve como "qualquer conversa". Ela precisa ser esvaziada por regra e por migração. |
| "Marcar como aguardando, mais partes no funil" | Criar a etapa **Aguardando cliente**, que entra sozinha ou pelo botão. Criar etapas novas (Orçamento enviado, Atendida, Retorno sugerido). Mais tarde, permitir criar etapas pela tela. |
| "Configurar tudo, relatórios" | Relatórios do salão: faturamento, profissional, serviço, comparecimento. Configurações divididas em "dia a dia" e "sistema". |
| "Contatos: clicar e ver mais informação, como está atualmente" | O nome da cliente abre a ficha em qualquer tela. A ficha mostra uma frase de situação atual e usa os dados do Avec (visitas, ritmo, profissional, observações, crédito e dívida). |
| "Testando com o Avec, veja as funções do ChatGuru" | Uma lista de paridade em lotes. Comanda, caixa e agenda viva vêm depois do dia a dia do atendimento. |

**Premissa que muda tudo:** hoje **ninguém responde pelo CRM**.
- Nenhuma mensagem tem autora registrada: 0 de 4.467 enviadas, `sent_by_user_id` vazio em todas.
- Nos últimos 7 dias saíram 767 mensagens, todas pelo ChatGuru ou pelo celular.
- Em 30 dias, 86% das enviadas levam assinatura: `*SARA - CASA FIAES:*` (1.388) ou `*CATI - CASA FIAES:*` (766).

O desenho precisa funcionar **durante a transição**. Isso quer dizer ler as assinaturas do celular agora e só depois passar a equipe para o CRM.

---

## 2. Diagnóstico com números

### 2.1 "Sem dono" é quase sempre falso

- **155 de 185 leads abertos (84%) aparecem "Sem dono".** Pela assinatura da última resposta:
  - Sara responde 89 deles;
  - Cati responde 51;
  - 15 não têm assinatura.
  - Ou seja, **cerca de 140 têm dona de fato**.
- Entre os 30 leads da Sara, **10 foram respondidos por último pela Cati**.
- **Causas:**
  - 162 eventos `responsavel_alterado` em 14/10 tiraram o Joaquim de dono e deixaram vazio.
  - Gestão nunca recebe conversa (`deals.ts:50`), e a Cati tem perfil Gestão.
  - Resposta pelo celular só conta para quem já é dona (`deals.ts:280`).
  - A distribuição está desligada (não existe a configuração `distribuicao`).
  - Os 4 usuários aparecem como "Ausente".
  - Há 0 aparelhos inscritos para push.
- **Rótulo "Você:" errado** (`queue-item.tsx:163`, `deal-card.tsx:49`): aparece "Você: *SARA - CASA FIAES:*" para quem não é a Sara.
- **Hoje a equipe descobre quem atendeu lendo a assinatura dentro do balão.** Na Jornada a dona não aparece. Na Agenda, horário vindo de conversa mostra "atende: sem dono", e isso se confunde com a profissional.

### 2.2 Avisos que não explicam e que disparam errado

- **Nenhuma seção da Fila explica o que significa** (`queue-list.tsx:123`).
- Há três nomes parecidos: "Aguardando resposta", "Aguardando a cliente" e "Prazo estourado".
  - "Prazo estourado" é um estado técnico de menos de 1 minuto.
- A regra de "perto do prazo" é **50%** na Fila (`queue.ts:27`) e **60%** no cabeçalho, no Quadro e no WhyLate (`timer.tsx:45`).
  - O anel do "ok" é verde na Jornada e cinza na Fila.
- **14/10:**
  - 76 alertas de espera em 36 leads, sendo **61 escalados para a gestão**;
  - entre 6 e 12 alertas por hora, das 11h às 18h;
  - mediana real de resposta de **11,7 min**, contra prazo de 2 a 3 min;
  - só 21 de 64 respostas saíram em até 3 min.
- **O horário da Casa nunca foi salvo.** Vale o padrão seg–sex 8–20h e sáb 8–17h (`business-hours.ts:5`), mas a Casa funciona ter–sáb 9–18h. **Segunda-feira e o período das 18h às 20h contam como atraso falso.**
- **Tarefas:**
  - 84 próximas ações abertas, **72 sem responsável** e 50 vencidas;
  - 34 alertas `tarefa_vencendo` estão na gestão sem ninguém ler;
  - "Minhas próximas ações" (`today.ts:26`) mostra "Nenhuma ação vencida" para a gestão, com 50 vencidas sem dono. **É uma falha silenciosa.**
- **Textos errados ou enganosos:**
  - "Retomar contato com X — X" repete o nome ou mostra o telefone cru. 7 deles nasceram às 00:00.
  - "Aniversário de X em 7 dias. A mensagem está pronta no card": **não existe mensagem pronta**.
  - "Compareceu?" aparece **antes** do horário.
  - "Pediu preço" continua depois da Casa mandar o preço.
  - O chip "Responde rápido" é ruído. Uma linha chegou a mostrar 6 chips.
  - "Cliente" aparece em 74% das linhas, então não informa nada.
  - "Não identificada" aparece em quase tudo.
  - Arquivar (`pane-header.tsx:91`) e "Encerrar conversa" (`client-pane.tsx:257`) são a mesma ação com nomes diferentes.
  - O Histórico mostra códigos crus: `conversa_arquivada` (53), `contato_mesclado` (33), `espera_virou_followup` (8) e outros.
- **Abrir uma conversa manda o "visto azul" para a cliente**, inclusive quando quem abre é a gestão só olhando (`conversation-pane.tsx:121` → `send.ts:226-244`).

### 2.3 Atendimento lotado

Das 92 conversas em Atendimento, **nenhuma está esperando a Casa**:

| Situação real | Conversas | Com conversa arquivada |
|---|---|---|
| Tem horário futuro no Avec | 7 | 3 |
| Compareceu nos últimos 30 dias, sem horário | 32 | 25 |
| Pacote ativo | 1 | 0 |
| Casa falou por último há 1 dia ou mais | 15 | 10 |
| Casa falou por último há menos de 1 dia | 32 | 1 |
| Cliente falou por último (agradeceu ou encerrou) | 5 | 2 |

**Por que acontece:** a etapa só anda quando alguém mexe na mão.
- Compareceu/Faltou não move a conversa (`updates.ts:269-291`).
- A importação do Avec não toca nenhuma conversa.
- Arquivar tira da Fila, mas o Quadro e a Jornada continuam mostrando (`board.ts:37`).
- A importação do histórico jogou 63 conversas direto em Atendimento.

**Outros sintomas:**
- **Follow-up 1:** 9 das 56 conversas estão lá porque a **cliente** esperou e a Casa não respondeu. O `sweepOverdueWaits` (`overdue-waits.ts:17-41`) inverte o sentido.
- **Agendado:** a coluna mostra 29, mas a agenda real dos próximos 60 dias tem **136 horários**.
  - 40 contatos com horário futuro não têm conversa aberta.
  - 4 Agendados não batem com o Avec.
  - 3 datas são absurdas: 2923, 4676 e uma em 2029.

**Risco imediato em 15/10:** com `followup_diario` e `parado_1dia` ligados, a simulação prevê **cerca de 180 avisos ao longo do dia**:
- 86 movimentos de etapa até 19h55: 44 de Atendimento para Follow-up 1 e 42 de Follow-up 1 para Follow-up 2;
- mais 93 avisos de "parado";
- quase todos caem na gestão;
- o aviso de "parado" se repete todo dia (`engine.ts:100`).

### 2.4 A ficha e os contatos não mostram a cliente

- **"Total gasto" absurdo.** `import-sales.ts:106` multiplica valor × quantidade, mas no Avec o "Valor" já é o total da linha (e no mega hair a "Qtd." é em gramas).
  - 140 itens somam **R$ 70,6 milhões, contra R$ 459 mil reais**.
  - Uma ficha mostra "Total gasto R$ 4.147.677,30".
  - 71 contatos aparecem com mais de R$ 50 mil gastos.
- **O painel da conversa ignora o Avec.**
  - Em 122 dos 185 leads aparece "Visitas: nenhuma registrada".
  - Em 109 aparece "Primeira conversa com a Casa", inclusive para cliente desde 2020 (`client-context.ts:30-39`).
- **Junções de contato aparecem como "Não é cliente".** São 33 casos (`contatos/[id]/page.tsx:29`).
- **Não existe link da conversa para a ficha** (`client-pane.tsx:211`, `pane-header.tsx`). Sino, Hoje, Jornada e Relatórios levam para a conversa, nunca para a ficha.
- **Aniversariantes:** a tela Hoje mostra 2, mas são **60 nos próximos 7 dias**. A consulta exige lead (`today.ts:55`). Quem nasceu nos dias 29 a 31 cai no dia 28.
- **O que a ficha não mostra:**
  - aniversário (3.714 contatos têm);
  - "Como conheceu" (891 contatos);
  - horários passados (13.441 comparecimentos, 960 faltas, 6.001 cancelamentos);
  - 13.563 observações de horário;
  - crédito e dívida (1.692 e 196 lançamentos);
  - as anotações dos leads (109).
- **Lista de Contatos:**
  - só tem 2 filtros, e eles quase não filtram (5.979 dos 6.083 contatos estão marcados como cliente);
  - a ordem é arbitrária, porque 6.082 contatos foram criados no mesmo dia;
  - não exporta.

### 2.5 Relatórios e configurações

- **Os relatórios do CRM não leem nada do Avec.**
  - "Financeiro" diz "Nenhuma venda fechada no período (n = 0)", com cerca de R$ 3,1 milhões vendidos em 2026.
  - "Retorno por coorte" diz que depende de uma exportação que **já está no banco**.
- **Configurações são tudo ou nada.** Uma única permissão, `config.editar`, cobre desde respostas prontas até desconectar o WhatsApp.
- **Não dá para criar etapa.** Os tipos são fixos (`schema.ts:7`) e a sequência de follow-up está no código (`engine.ts:125`).
- **Etiquetas** não têm tela nem cor. Só existe uma ("Uso de imagem", 38 contatos).
- **Profissionais:** 101 cadastros, 18 deles ativos.
  - Há 0 vínculos entre profissional e serviço. Por isso o "Agendar" mostra a lista de profissionais **vazia** (`schedule-sheet.tsx:34`).
  - A página tem 88.162 px de altura.
- **Serviços:** 0 de 55 têm duração, 0 têm ciclo de retorno.

---

## 3. Lotes de construção, em ordem

### Lote 0: Estancar (hoje, antes de qualquer código). Tamanho P

**Objetivo:** parar os avisos falsos e os valores absurdos.

1. **Desligar `followup_diario` e `parado_1dia`** até o Lote 1C entrar. Isso evita cerca de 180 avisos por dia e o pulo de 41 conversas para Follow-up 2 sem nenhuma tentativa de contato.
2. **Salvar o horário real:** ter–sáb, 9h às 18h.
3. **Prazos de transição:** Lead 10 min, demais etapas 15 min, escala para a gestão em 30 min.
   - Agendado sem prazo de resposta automático, ou 30 min.
   - Voltar a apertar quando a equipe estiver respondendo pelo CRM.
4. **Corrigir `import-sales.ts:106`:** total = valor − desconto. Recalcular `total_cents`; os pagamentos de 2025 (R$ 2,88 milhões) servem de conferência.
5. **Datas absurdas:** descartar ou ignorar horários com mais de 180 dias no futuro em toda regra de "horário futuro".

**Dados:** os itens 1 a 3 são configuração. O item 4 é script com backup antes e conferência por ano: 2024 ≈ R$ 2,57 milhões, 2025 ≈ R$ 3,06 milhões, 2026 ≈ R$ 3,12 milhões.

**Como testar:**
- `automation_runs` sem `followup_diario` nem `parado_1dia` no dia seguinte;
- nenhum alerta de espera numa segunda-feira;
- nenhuma ficha com total acima de R$ 1 milhão;
- 0 itens com total maior que valor.

### Lote 1A: Quem está atendendo. Tamanho M

**Objetivo:** "Sem dono" só quando for verdade, e o nome de quem respondeu em todas as telas.

**Regras:**
- **Ler a assinatura** `^\*([A-ZÇÃÉÍ ]+) - CASA FIAES:\*` em toda mensagem que sai pelo celular ou pelo ChatGuru.
  - O nome é ligado ao usuário por um campo novo, **"Assinatura"**, em Configurações › Equipe › Pessoas (SARA → Sara, CATI → Caticilene).
  - Preenche `sent_by_user_id` e um novo `sent_via = celular|crm`.
- **Dona automática:** se a conversa está sem dono e chega resposta assinada, a dona passa a ser quem assinou.
  - Vale também para quem tem perfil Gestão: muda `deals.ts:50` e `:280`.
  - Se já tem dona e outra pessoa respondeu, a dona **não muda**. A conversa ganha o selo "Respondida por Cati" e a dona recebe um aviso. A gestão decide se transfere.
- **Envio pelo CRM** acrescenta a assinatura da pessoa logada (`send.ts:80`). As clientes estão acostumadas a ela.
- **"Visto" só é enviado quando quem abre é a dona**, ou quando ela clica em responder. A gestão "espiando" não envia visto (G27).

**Telas:**
- **Balão:** "Cati · pelo celular · 14:02" no lugar de "pelo celular ·".
- **Linha da Fila e card do Quadro:** "Sara" ou "Cati:" antes da última mensagem, no lugar de "Você:". Mostra "Dona: Sara · respondida por Cati" quando forem diferentes.
- **Jornada:** passa a mostrar as iniciais da dona.
- **Agenda:** "Conversa com: Sara" no lugar de "atende: sem dono", que hoje se confunde com a profissional.
- **"Equipe agora"**, no topo da Fila e no Hoje: cada pessoa com estado, quantas conversas esperam resposta dela, última resposta ("há 4 min, pelo celular") e quantas são dela.
- **Na conversa:** o aviso "Fulana está nesta conversa" quando outra pessoa estiver com ela aberta.

**Dados e migração:**
- Preencher para trás o autor das mensagens dos últimos 30 dias (cerca de 2.154 com assinatura).
- Dar dona aos cerca de 140 leads sem dono que têm assinatura na última resposta. Os 15 sem assinatura continuam "Sem dono".
- Backup em JSON antes, no padrão de `organizacao-2026-10-14-antes.json`.

**Como testar:**
- fixtures de mensagens com e sem assinatura, nome desconhecido e assinatura no meio do texto;
- um ensaio que gere a tabela dona × quem respondeu e bata com a auditoria (89/51/15/16/10/4);
- após aplicar, "Sem dono" ≤ 15 + leads novos.

### Lote 1B: Avisos explicados. Tamanho M

**Objetivo:** cada aviso diz o que aconteceu, de quem é e o que fazer.

**Regras únicas:**
- "Perto do prazo" = 60% em todas as telas.
- Vermelho só quando existe alerta.
- O mesmo anel e as mesmas cores na Fila, no Quadro, na Jornada e no cabeçalho.
- "Prazo estourado" deixa de existir como seção e entra em Atrasados.

**Seções da Fila** (cada uma com "?" e a frase abaixo do título):

| Hoje | Novo título | Frase fixa |
|---|---|---|
| Atrasados + Prazo estourado | **Atrasados** | "A cliente escreveu e ninguém respondeu no prazo. Responda primeiro." |
| Perto do prazo | **Quase no prazo** | "Responda em até X min." |
| Aguardando resposta | **Esperando a Casa responder** | "A cliente escreveu; ainda está no prazo." |
| Próximas ações de hoje | **Combinados para hoje e atrasados** | Na linha: "venceu ontem 13:00" (sempre com o dia) |
| Parados | **Parados** | "Há X dias sem ninguém decidir o próximo passo. Marque Agendar, Aguardar cliente ou Encerrar." |
| Aguardando a cliente | **Bola com a cliente** | "A Casa respondeu; agora é com ela." |
| Conferir comparecimento | **Ela veio?** (começa aberta) | "Já passou do horário. Toque em Compareceu ou Faltou." |
| Arquivadas | **Encerradas** | "Voltam sozinhas se a cliente escrever." Uma só ação: "Encerrar conversa". |

**Resumo do topo:** "N esperando resposta · N atrasados · N sem dono · N combinados vencidos · N agendados hoje".

**Linha da conversa:**
- **Um texto de prazo só:** "Responder agora: 4 min além do prazo" ou "Responda em 1 min".
- **"Sem dono"** com dica: "Ninguém assumiu. Toque em Assumir se for você."
- **Retirar:** o selo "Cliente" (vai para o painel), "Tarefa atrasada" (duplicado), "Parado" (fica "parado há 3 dias") e a origem quando ela for "Não identificada".
- **Sinais automáticos:**
  - só contam enquanto não respondidos ("Pediu preço" some quando a Casa manda um valor);
  - tirar "Responde rápido";
  - no máximo 2 por linha;
  - ficam separados das **etiquetas da equipe**.
- "Transferida por Fulana" vira "Fulana te passou esta conversa".

**Cabeçalho e painel:**
- **Relógio:** "Esperando há 12 min (prazo 15)".
- **WhyLate** passa a dizer quem e quando: "Cati respondeu ontem 13:15 pelo celular; agora é a vez da cliente."
- **Responsável:** "Sara está cuidando. Assumir tira dela."
- **"Compareceu?"** só aparece depois do horário.

**Sino:**
- agrupado por tipo;
- filtros "Para mim" e "Para a gestão";
- botão **Resolver**, além de "Marcar como lido";
- legenda das cores.

**Textos dos alertas:**

| Tipo | Texto novo |
|---|---|
| Espera nível 1 (unificar as 2 automações) | "Fulana espera resposta desde 14:02 (prazo 15 min). Dona: Sara." |
| Escalado (nível 2) | "Escalado: Fulana sem resposta desde 14:02. Dona: Sara / sem dono." |
| Tarefa vencendo | "Combinado vencendo: retomar contato (Fulana)." Nunca dispara fora do horário da Casa. |
| Oferta | "A dona não respondeu. Pode assumir Fulana?" |
| Assumiu ou transferiu | "Cati assumiu a conversa de Fulana" / "Cati te passou a conversa de Fulana", sem o artigo "a". |
| Aniversário | "Aniversário de Fulana dia 17/10. Que tal mandar um parabéns?" |
| Envio automático falhou | "Mensagem automática para Fulana não saiu. Abra a conversa e envie manualmente." Telefone cru só como último recurso. |

**Tarefas e Hoje:**
- Tarefa sem responsável vai para a dona do lead; sem dona, para quem respondeu por último. Isso resolve as 72 tarefas sem responsável.
- "Minhas próximas ações" para a gestão ganha a aba "Sem responsável".
- Aniversários do Hoje deixam de exigir lead (60 na semana) e o dia 29, 30 ou 31 fica no dia certo.

**Histórico:** traduzir os 5 códigos crus. Exemplo: `contato_mesclado` vira "Contatos juntados (mesmo número)".

**Ajuda:** página **"O que cada aviso quer dizer"**, gerada a partir das mesmas frases, para treinar a equipe.

**Push:** tarefas e transferências passam a gerar push. Pedir a inscrição nos aparelhos no primeiro login (hoje são 0).

**Como testar:**
- teste de textos com nome masculino, nome ausente e telefone;
- teste da regra de 60% compartilhada (uma função só);
- prints da Fila antes e depois;
- conferir que "Combinados" mostra os 45 vencidos com o dia.

### Lote 1C: Funil novo e saída do Atendimento lotado. Tamanho G

**Objetivo:** o funil reflete a jornada da cliente, e o status da conversa (de quem é a vez) fica separado, como no ChatGuru.

**Etapas** (os nomes para confirmar estão na Decisão 2):

| # | Etapa | Tipo | Entra quando | Sai quando |
|---|---|---|---|---|
| 0 | **Novo contato** | `lead` | Número novo escreve | A Casa responde → 1 |
| 1 | **Em conversa** | `atendimento` | A Casa responde; a cliente escreve estando em 2, 3, 6 ou 7 | Casa falou por último + 4 h de expediente → 2; marcou horário → 4 |
| 2 | **Aguardando cliente** | `followup` (substitui Follow-up 1 a 4) | Regra acima; botão **"Marcar como aguardando cliente"**, com "retomar em" opcional; Faltou ou cancelou sem novo horário, com a tarefa "Remarcar" | Cliente escreve → 1; 3 tentativas sem resposta (D+1, D+3, D+7, contador 1/3 no card) → Perdido "Não respondeu mais", com recontato em 30 dias |
| 3 | **Orçamento enviado** | novo `proposta` | Botão "Enviei orçamento/projeção" | Igual à 2, com prazo de 2 dias |
| 4 | **Agendado** | `agendado` | Qualquer horário futuro (até 180 dias) no Avec ou no CRM. A data vem do horário mais próximo | Compareceu → 5; faltou ou cancelou → 2 |
| 5 | **Atendida** | novo `atendido` | Compareceu (Avec ou CRM). Abre a tarefa de pós: agradecer, foto, avaliação | 3 dias ou "Encerrar conversa" → Fechado (ganho) |
| 6 | **Retorno sugerido** | novo `retorno` | Entra no Lote 2 (precisa do ritmo da cliente) | Marcou → 4; escreveu → 1 |
| 7 | Fechado / Perdido | já existem | — | — |

O pacote **não é etapa**. Vira o selo "Pacote 3/10" no card.

**Mudanças técnicas:**
1. Migration acrescentando `proposta`, `atendido` e `retorno` ao enum. Desativar `followup_2` a `followup_4`, que estão vazias. Renomear `followup_1` para "Aguardando cliente" e criar o contador de tentativas.
2. `markAttendance` (`updates.ts:269-291`) passa a mover para Atendida.
3. A importação do Avec (`import-agenda.ts`) chama o movimento de etapa: horário futuro leva a Agendado, comparecimento leva a Atendida, falta leva a Aguardando.
4. `sweepOverdueWaits` para de mandar para Follow-up quando quem espera é a cliente. Nesse caso a conversa continua em Em conversa como Atrasada.
5. Gatilho "Casa falou por último há X horas úteis" no motor. Substitui `followup_diario`, que segue desligado.
6. `parado_1dia` volta só com limite por etapa (sugestão: Em conversa 2 dias; Aguardando é controlado pelas tentativas) e com **um** aviso por conversa, sem repetir todo dia.
7. Quadro e Jornada respeitam conversa encerrada (`board.ts:37`).
8. As cerca de 40 referências diretas às chaves das etapas (`board.tsx` 14, `client-pane.tsx` 9, `deals.ts` 7…) passam a usar o tipo da etapa.

**Migração** (script com ensaio antes, backup em JSON e contagem conferida):

| Hoje | Conversas | Vai para |
|---|---|---|
| Atendimento com horário futuro | 7 | Agendado (data do Avec) |
| Atendimento, compareceu nos últimos 30 dias | 32 | Atendida (25 com conversa encerrada → Fechado) |
| Atendimento com pacote ativo | 1 | Aguardando, com selo do pacote (Retorno sugerido no Lote 2) |
| Atendimento, Casa falou por último | 47 | Aguardando cliente, tentativa 1 |
| Atendimento, cliente falou por último | 5 | Em conversa |
| Follow-up 1, Casa falou por último | 41 | Aguardando cliente, mantendo a tarefa |
| Follow-up 1, cliente falou por último | 9 | Em conversa, com a tarefa "Responder" |
| Follow-up 1, compareceu nos últimos 30 dias | 6 | Atendida |
| Lead | 8 | 6 ficam; 1 vai para Atendida; 1 vai para Aguardando |
| Agendado | 29 | 25 ficam; **4 sem horário no Avec vão para revisão manual** |
| Sem conversa, com horário futuro no Avec | 40 contatos | Ver Decisão 5 |

Resultado esperado: **o Atendimento (Em conversa) cai de 92 para cerca de 5**.

**Visibilidade por perfil:**
- **Atendente:** etapas 0 a 4 e 6, as dela e as sem dono.
- **Recepção:** 4, 5 e 6, com foco no dia.
- **Gestão:** tudo.
- Implementar como coluna na etapa com os perfis que a veem.

**Risco:** os dados do Avec são uma foto de 14/10 e não há sincronização. As regras 3 e 4 só valem a cada nova importação. Até a agenda própria existir (Lote 6), é preciso uma rotina diária de envio do relatório de Reservas.

**Como testar:**
- testes de cada transição;
- ensaio da migração produzindo exatamente a tabela acima;
- simular um dia inteiro do motor e ver quantos avisos ele gera;
- o Quadro sem encerradas.

### Lote 2: Ficha da cliente e Contatos clicáveis. Tamanho G

**Objetivo:** clicar no nome em qualquer tela e ver como a cliente está agora.

**Clique:** nome e foto abrem a ficha (ou um painel lateral com "Ver ficha completa") em todos os lugares da tabela de cliques da auditoria de contatos:
- conversa, cabeçalho e faixa;
- Quadro e Jornada;
- Hoje e sino;
- Agenda;
- Relatórios, inclusive as tabelas do Avec.

**Ficha** (`/contatos/[id]`), em ordem:
1. **Cabeçalho:** foto, nome, telefone; botões Conversar, Ligar e WhatsApp; etiquetas editáveis; avisos fixos (alergia, preferência, **dívida ou crédito**).
2. **Situação em uma frase**, montada pelo servidor. Exemplo: "Tem horário amanhã 14h com [profissional] · pacote 3/4 · última visita há 20 dias · conversa aguardando cliente há 2 h com Sara". Estados possíveis: Sem dono, Atrasada, Sumida, Na hora de voltar, Aniversário nesta semana.
3. **Agora:** conversa atual (etapa, dona, quem respondeu, próxima ação) e próximos horários.
4. **Retorno sugerido:** "Volta a cada ~45 dias · prevista 02/11 · atrasada 12 dias", com botões Agendar e Lembrar. Usa o ritmo da cliente quando há 3 ou mais visitas (mediana geral de 62 dias), senão o ciclo do serviço. Aqui entra a **etapa 6 do funil**.
5. **Números:** visitas, desde quando, frequência, faltas e cancelamentos. Ficam visíveis para a atendente. Ticket e total só com a permissão de ver valores.
6. **Preferências:**
   - profissional preferida (calculada: 752 clientes têm 60% ou mais com a mesma; editável);
   - os 3 serviços mais feitos;
   - aniversário;
   - "Como conheceu", tratando o caso "CLIENTE GILVAN" como profissional.
7. **Pacotes** (já existe).
8. **Visitas:** passadas e futuras juntas, com profissional, status e **a observação do horário** (13.563). Junta com "Atendimentos e compras" por dia.
9. **Financeiro** (gestão): pagamentos, crédito e dívida (`getContactAvecData` já busca).
10. **Anotações:** um campo único no contato, juntando as 109 anotações hoje presas nos leads.
11. **Conversa resumida** e o Histórico recolhido.
12. **Leads:** "Mesclado" separado de "Não é cliente".

Nome, e-mail, aniversário, anotação, etiqueta e profissional preferida ficam editáveis na própria ficha.

**Painel da conversa:**
- a mesma frase de situação;
- visitas e "desde" passam a incluir o Avec (corrige 122 e 109 casos errados);
- retorno sugerido e profissional preferida.

**Lista de Contatos:**
- **Filtros em botão, com contagem:** Sumidas (~199), Na hora de voltar (~118), Aniversariantes semana e mês (60/292), Com pacote, Com horário, Sem dono, Nunca voltou (2.363), VIP, Faltosas.
- **Filtros em lista:** profissional, serviço, etiqueta, origem.
- **Colunas:** Nome · Situação · Última visita · Visitas · Próximo horário · Profissional preferida · Pacote · Aniversário · Responsável.
- **Ordenar por:** última visita, mais visitas, nome, chegada no CRM.
- **Ações em massa:** etiquetar, **exportar CSV** e "Não é cliente". "Mandar mensagem em massa" fica para o Lote 5, com confirmação.

**Dados:** uma visão materializada por contato, recalculada após cada importação ou à noite, com visitas, última visita, ritmo, profissional e serviço preferidos e próximo horário.

**Como testar:**
- as contagens dos filtros batem com a auditoria (199, 118, 60, 292, 2.363);
- uma cliente frequente mostra visitas maiores que 0 e "desde" anterior a 2026;
- todos os pontos de clique abrem a ficha.

### Lote 3: Relatórios do salão. Tamanho M

**Depende de:** Lote 0, item 4 (`total_cents` corrigido).

**Painel "Salão"**, ao lado da Visão geral:
- faturamento por dia, mês ou **período livre**, com comparação;
- por profissional (faturado, ticket, comissão depois de importada);
- por serviço e categoria;
- formas de pagamento;
- clientes novas × recorrentes (setembro: 93 × 220);
- comparecimento, faltas e cancelamentos por profissional (setembro: 464, 25, 147);
- **agenda sem desfecho** (78 em setembro);
- funil conversa → horário → compareceu → comprou (225 conversas → 80 → 37 → 47);
- sumidas e retorno sugerido calculados (Lote 2).

**Corrigir textos:**
- "Retorno por coorte" passa a ser calculado de verdade.
- "Financeiro" passa a usar o Avec e o CRM, com a legenda "fonte: Avec até 14/10".
- "Tempo de resposta por atendente" passa a usar o autor vindo da assinatura (Lote 1A). Antes disso, era impossível.

**Importar comissão** de "Itens de comanda" e "Comissão por item" (25.911 linhas).

**Relatórios do Avec (219 em 205 tipos):**
- os 11 principais viram cartões no topo;
- seções recolhíveis por assunto;
- selo "Virou dado no CRM" nos 21 aplicados;
- grupo "Vazios (34)" no fim;
- tipos repetidos juntados.

**Como testar:**
- faturamento por ano bate com os pagamentos (diferença menor que 5%);
- 2 profissionais conferidos à mão com o Avec.

### Lote 4: Configurações. Tamanho M

**Permissões:** dividir `config.editar` em duas.
- **`config.diaadia`** (atendente): Etiquetas, Respostas prontas, Palavras-chave, Profissionais, Serviços, Origens e links, níveis da Distribuição.
- **`config.sistema`** (gestão): WhatsApp, Horário e etapas, Automações, Mensagens automáticas, limites, ligar e desligar a Distribuição.
- Pontos no código: `permissions.ts:66,72`, `config/actions.ts:19`, `config-nav.tsx:13`.

**Telas:**
- **Etiquetas (tela nova):** cor, renomear, juntar, contagem. Filtro por etiqueta na Fila e em Contatos. A tabela `tags` ganha cor.
- **Criar e apagar etapa:** escolhe o tipo, a ordem e quais perfis veem. Na Fila, a sequência de "Aguardando" passa a ser configurável no lugar de `engine.ts:125`.
- **Profissionais:**
  - lista compacta só com as 18 ativas;
  - desativadas recolhidas;
  - vínculos com serviços preenchidos a partir de "Serviços por profissional" (21.937 linhas). Isso destrava o "Agendar".
- **Serviços:** duração (pedir à Casa) e ciclo de retorno.
- **Origens:** juntar as duas listas "Origens" numa só.
- **Mensagens automáticas:** boas-vindas, fora do horário, ausência e encerramento.
- **Assinatura por pessoa** (vem do Lote 1A).

**Como testar:**
- uma atendente com `config.diaadia` não vê a aba WhatsApp;
- criar uma etapa de teste e ver no Quadro;
- o "Agendar" lista profissionais.

### Lote 5: Paridade ChatGuru restante. Tamanho M

- **Nota interna** na conversa (troca de turno; guarda as anotações migradas).
- **Importar a ficha do ChatGuru:** etiquetas, campos, responsável e anotações (`chatguru_records` = 0). **Depende da Casa exportar os CSVs.**
- **Mensagem agendada:** usar o outbox (`outbox.ts:59`) para envio manual programado.
- **Respostas prontas** com anexo, mais variáveis (`{primeiro_nome}`, `{data_horario}`, `{profissional}`) e pastas.
- **Status manual "Resolvido"**, ao lado do "Aguardando" que vem no Lote 1C.
- **Ligações perdidas e reações** aparecem na conversa (hoje são descartadas em `webhook.ts:71-72`).
- **Mensagem em massa** a partir dos filtros de Contatos, com confirmação.

### Lote 6: Paridade Avec (agenda viva, comanda, pacotes). Tamanho G, em sublotes

**6a. Agenda viva:**
- marcar direto na Agenda;
- grade de horas por profissional;
- horário de trabalho por profissional;
- criar bloqueio;
- conflito contra horários do Avec e bloqueios, não só contra conversas (`updates.ts:134-157`);
- cancelar com motivo;
- vários serviços por visita.

**6b. Lembrete D-1 e confirmação** ligados para a agenda própria. Trocar a Avec IA no mesmo dia.

**6c. Comanda e caixa:**
- vários itens, profissional por item, pagamento dividido, "Crédito Cliente";
- caixa do dia;
- comissão por serviço e profissional (0 a 65%).

**6d. Pacotes:** vender, dar baixa em sessão e levar os saldos na virada (31 ativos).

**6e. Perfil "Profissional"** com a tela Hoje no celular.

Até o 6a existir, a rotina diária de importação do Avec é obrigatória.

---

## 4. Decisões confirmadas pelo dono (15/10)

1. **Lote 0 aplicado em produção em 15/10.**
   - `followup_diario` e `parado_1dia` desligadas.
   - Horário ter–sáb 9–18h.
   - Prazos: Novo contato 10 min; demais 15 min; Agendado 30 min.
   - Escala para a gestão em 30 min.
   - Backup em `bkp_lote0_20261015`.
2. **Dona automática pela assinatura.** Vale também para Gestão (Cati) e também para trás. Com dona já definida, a dona não muda e aparece "Respondida por X".
3. **Funil aprovado como está:** Novo contato → Em conversa → Aguardando cliente (3 tentativas: D+1, D+3, D+7, depois Perdido "Não respondeu mais") → Orçamento enviado → Agendado → Atendida (fecha sozinha em 3 dias) → Retorno sugerido → Fechado/Perdido. Follow-up 2 a 4 deixam de existir.
4. **Contatos com horário no Avec e sem conversa:** aparecem só na Agenda e na ficha. Ganham cartão em Agendado só se houve conversa nos últimos 30 dias.
5. **Total do item do Avec corrigido em 15/10:** total = valor − desconto. Backup em `bkp_sales_items_total_20261015`.

## 5. Fora de escopo / depois

- Menu de boas-vindas e departamentos, equipes, pesquisa de satisfação, campanhas e automações de marketing.
- Agendamento online próprio, anamnese, horário recorrente, arrastar para remarcar, uso sem internet.
- Ocupação da agenda: depende de duração dos serviços (0 de 55) e do horário de cada profissional.
- **Estoque:** a Casa vende produto (124 itens em 90 dias), mas **precisa confirmar com a Thaise** se usa o estoque do Avec.
- Salas e recursos, taxas de cartão, contas a pagar.
- Restrição de acesso por horário ou por etiqueta.
- Problema menor para incluir num lote: `nextWaitingId` (`queue.ts:391`) não ignora conversas encerradas.

---

## Notas da auditoria (transparência)

- **Uma regra foi violada:** durante a auditoria de avisos, um arquivo de SQL foi copiado por engano para `/tmp/q1_readonly_analise.sql` no servidor. Ele foi apagado logo em seguida e confirmamos que sumiu. Nenhuma outra escrita no servidor, nenhuma alteração no banco e nenhuma mensagem enviada. O "visto" foi bloqueado no navegador headless 3 vezes.
- **Os números de "sem dono" variam conforme a base de cada auditoria:**
  - 155 = leads abertos sem dono (a base usada neste documento);
  - 152 = auditoria de funil, que usou um recorte um pouco diferente;
  - 108 = conversas abertas não encerradas, auditoria de paridade (106 delas com alguém respondendo).
- **Nenhum CSV do ChatGuru foi exportado ainda.** O funil proposto não copia as etapas reais de lá.

Prints e consultas de cada auditoria estão em `/private/tmp/claude-501/-Users-joaquimsalles/1d859e91-de4e-47e9-bde3-8a64964253fe/scratchpad/analise/`, nas pastas `avisos/`, `funil/`, `contatos/`, `relatorios-config/` e `paridade/`.