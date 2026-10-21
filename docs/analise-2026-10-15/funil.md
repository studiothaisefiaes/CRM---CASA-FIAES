# Funil, etapas e por que o Atendimento está cheio

O Atendimento tem 92 deals abertos e quase nenhum deles é conversa em andamento. Isso acontece porque a etapa só anda para a frente quando alguém mexe na mão: arquivar a conversa, o horário marcado no Avec e o comparecimento não mudam a etapa. E há um problema mais urgente: ao longo de 15/10 as automações ligadas devem disparar cerca de 180 avisos de uma vez.

Tudo foi feito só com SELECT no banco oficial, sem editar o repositório e sem enviar mensagem. A tela foi aberta em modo headless, com o tempo real bloqueado.

## 1. Como está hoje no código

**Etapas.** Estão em `src/server/db/seed-data.ts:3-13` e o banco oficial está igual:

| key | nome | kind | prazo de resposta | limite parado |
|---|---|---|---|---|
| `lead` | Lead | lead | 2 min | 1 dia |
| `atendimento` | Atendimento | atendimento | 3 min | 1 dia |
| `agendado` | Agendado | agendado | 3 min | — |
| `followup_1` a `followup_4` | Follow-up 1 a 4 | followup | 3 min | 1 dia |
| `fechado` | Fechado | fechado | — | — |
| `perdido` | Perdido | perdido | — | — |

**Limites para mudar o funil:**
- Os tipos de etapa são fixos no banco (`schema.ts:7`). Uma etapa de tipo novo exige migration.
- A tela "Etapas e prazos" (`components/config/stages.tsx`) só renomeia e muda prazo, limite parado, cor e ordem. Não cria nem apaga etapa.
- As chaves das etapas estão escritas direto em cerca de 40 arquivos (por exemplo `components/pipeline/board.tsx` com 14, `queue/client-pane.tsx` com 9, `domain/deals.ts` com 7).

**O que move a etapa sozinho hoje:**
- Lead vira Atendimento quando a Casa responde (`deals.ts:306`).
- Follow-up volta para Atendimento quando a cliente escreve (`deals.ts:189`).
- A automação `followup_diario` (`engine.ts:53-59` e `124-126`) passa Atendimento para Follow-up 1, depois 2, 3 e 4. O Follow-up 4 é um beco sem saída: nada leva a Perdido.
- `sweepOverdueWaits` (`overdue-waits.ts:17-41`) leva Lead/Atendimento para Follow-up 1 quando a **cliente** esperou e ninguém respondeu até o fim do dia. O sentido fica invertido: a etapa diz "cliente não respondeu", mas quem está devendo resposta é a Casa.
- "Retomar depois" (`resume-later.ts:20`) também leva para Follow-up 1.
- Agendar, Perdido e Fechar venda são ações próprias (`updates.ts:152`, `:173`, `:228`; `stage-move.ts:7`).

**O que não move a etapa:**
- **Compareceu/Faltou** (`updates.ts:269-291`) só grava o comparecimento e exige que o deal esteja em Agendado. O deal fica em Agendado para sempre.
- **A importação do Avec** não mexe em nenhum deal (em `domain/avec/*` não há nenhum update em `deals`).
- **Arquivar conversa** tira da Fila (`queue.ts:253-254`) mas mantém a etapa. O Quadro e a Jornada não filtram conversa arquivada (`board.ts:37`).
- **A importação do histórico do WhatsApp** (`deals.ts:377-383`) põe o deal em Atendimento quando a última mensagem é da Casa, e marca a entrada na etapa como agora.

**Automações ligadas no banco:** `lead_2min`, `atendimento_3min`, `gestao_10min`, `followup_diario`, `parado_1dia`, `aniversario_7d`, `cobranca` e `recontato`. Desligadas: `lembrete_agendamento` e `confirmacao_d1`.

Disparos em `automation_runs`, todos em 14/10:

| Automação | Disparos |
|---|---|
| `gestao_10min` | 61 |
| `atendimento_3min` | 51 |
| `lead_2min` | 32 |
| `aniversario_7d` | 1 |
| `followup_diario` e `parado_1dia` | 0 |

As duas últimas ainda não dispararam porque toda a base teve a etapa reiniciada em 14/10 ou depois.

## 2. Números do banco oficial (15/10, 00h40 em Salvador)

**Deals abertos: 185**

| Etapa | Abertos | Conversa arquivada | Sem dono | Já é cliente | Com horário futuro |
|---|---|---|---|---|---|
| Lead | 8 | 5 | 7 | 5 | 0 |
| Atendimento | **92** | **41** | 68 | 60 | 7 |
| Agendado | 29 | 0 | 28 | 28 | 25 |
| Follow-up 1 | 56 | 1 | 52 | 44 | 0 |
| Follow-up 2 a 4 | 0 | | | | |
| Perdido | 7 (fechados) | | | | |

**O Atendimento por dentro (92 deals):**
- **Quem falou por último:** a Casa em 87, a cliente em 5. Nenhum tem espera aberta.
- **Há quanto tempo foi a última mensagem:** menos de 1 dia em 41, de 1 a 3 dias em 9, de 3 a 7 dias em 12, de 7 a 30 dias em 30.
- **Próxima ação:** 21 têm (só 6 com data futura; 19 vencidas).
- **Avec:**
  - 56 já compareceram alguma vez; 40 compareceram nos últimos 30 dias.
  - 7 têm horário futuro no Avec.
  - 6 têm pacote ativo.
- Nenhum tem data marcada (`scheduled_at`) nem data de recontato no próprio deal.
- **De onde vieram:** 63 do histórico importado (já entraram em Atendimento) e 29 de leads novos.
- **Dono:** 68 sem dono e 24 com uma atendente.

**Classificação do Atendimento** (sem sobreposição; a 3ª coluna diz quantos estão com a conversa arquivada):

| Situação real | Deals | Conversa arquivada | Para onde deveria ir |
|---|---|---|---|
| Tem horário futuro (Avec) | 7 | 3 | Agendado |
| Compareceu nos últimos 30 dias, sem horário | 32 | 25 | Pós-atendimento |
| Pacote ativo | 1 | 0 | Retorno/pacote |
| Casa falou por último há 1 dia ou mais | 15 | 10 | Aguardando cliente |
| Casa falou por último há menos de 1 dia | 32 | 1 | Aguardando cliente |
| Cliente falou por último (agradeceu/encerrou) | 5 | 2 | Em conversa ou encerrar |

**Conclusão:** nenhum dos 92 está esperando a Casa. São clientes que já vieram (33), conversas em que a bola está com a cliente (47), agendados que não foram puxados do Avec (7) e conversas que só fecharam com um "obrigada" (5).

**As outras etapas pelo mesmo critério:**
- **Follow-up 1 (56):** 41 a Casa falou por último (correto); **9 a cliente falou por último** (efeito do `sweepOverdueWaits`: é a Casa que deve resposta); 6 compareceram nos últimos 30 dias.
- **Agendado (29):** todos têm data marcada no deal, mas só 25 têm horário futuro no Avec, ou seja, **4 divergem**.

**O Avec contra o funil:**
- Contatos com horário futuro no Avec: 40 sem deal aberto, 25 em Agendado e 7 em Atendimento. A coluna Agendado mostra 29, mas a agenda real dos próximos 60 dias tem 136 horários.
- Compareceram nos últimos 7 dias: 47 sem deal aberto, 13 em Atendimento, 4 em Agendado e 2 em Lead.
- Há 3 horários com data absurda (um deles no ano 4676, vindo do Avec). Qualquer regra de "horário futuro" precisa de janela máxima, por exemplo 180 dias.

**Quem está atendendo.** Nos últimos 5 dias foram 559 mensagens da Casa, **todas pelo celular** e nenhuma pelo CRM com autor. Mesmo assim, a assinatura no texto identifica quem respondeu: nos últimos 7 dias, "*SARA - CASA FIAES:*" aparece 417 vezes, "*CATI - CASA FIAES:*" 258 vezes, e 92 mensagens não têm assinatura.
- Nos deals abertos, a última resposta foi de SARA em 105 e de CATI em 61, mas 152 estão sem dono.
- Os "sem dono" vêm de 14/10: 162 eventos `responsavel_alterado` tiraram o usuário Joaquim de dono e deixaram vazio.
- A Cati está no perfil Gestão, que não recebe distribuição.

## 3. Problema que acontece em 15/10

Simulei as automações ligadas para 15/10, sem contar mensagens novas:

| Hora (Salvador) | `followup_diario` move e avisa | `parado_1dia` avisa |
|---|---|---|
| 08h05 | 0 | 0 |
| 12h00 | 14 | 19 |
| 16h00 | 59 | 78 |
| 19h55 | **86** (44 Atendimento → FU1, 42 FU1 → FU2) | **93** |

São cerca de **180 avisos num dia**. Como quase todos estão sem dono, todos caem na Gestão. O aviso de "parado" se repete todo dia, porque a janela de disparo é diária (`engine.ts:100`).

Além disso, 41 dos 56 de Follow-up 1 vão para Follow-up 2 sem que ninguém tenha tentado contato. Já existem 34 avisos `tarefa_vencendo` não lidos na Gestão.

**Recomendação antes de abrir:** desligar `parado_1dia` e `followup_diario` até a migração. Essa decisão é sua; eu não mexi em nada.

## 4. Comparação com o ChatGuru

Pelos docs (`docs/chatguru-pesquisa.md:41,78` e `docs/chatguru-engenharia-reversa.md:84,307-308`):
- O ChatGuru separa o **status** do atendimento (Aberto, Em atendimento, Aguardando, Resolvido, Fechado), que muda sozinho ao responder, da **etapa do funil**. Tem vários funis e um chat fica em uma etapa por funil.
- Nós misturamos as duas coisas na etapa. O resultado é "Atendimento" sendo usado como "qualquer conversa".
- O CSV do funil da Casa no ChatGuru ainda não foi exportado (`backlog.md:84,99`), e `chatguru_records` está com 0 linhas. Por isso não dá para copiar as etapas reais de lá.

## 5. Funil proposto para o salão

O status da conversa fica separado do funil, como no ChatGuru. A Fila continua com as seções "Esperando a Casa" e "Aguardando a cliente". O funil passa a ser a jornada da cliente.

| # | Etapa | Tipo | Entra quando (automático) | Sai quando |
|---|---|---|---|---|
| 0 | Novo contato | `lead` | Número novo escreve (já existe) | A Casa responde → 1 |
| 1 | Em conversa | `atendimento` | A Casa responde; ou a cliente escreve em 2, 3, 6 ou 7 | Casa falou por último + 4h de expediente → 2; marcou horário → 4 |
| 2 | Aguardando cliente | `followup` (uma etapa só, com contador de tentativas 1/2/3 e próxima retomada em D+1, D+3, D+7) | Regra acima; "Retomar depois"; Faltou ou cancelou no Avec sem novo horário (com a tarefa "Remarcar") | Cliente escreve → 1; 3 tentativas sem resposta → Perdido "Não respondeu mais", com recontato em 30 dias |
| 3 | Orçamento/avaliação enviada | **novo** `proposta` (manual) | Botão "Enviei orçamento/projeção" (já aparecem tarefas como "Analisar fotos e enviar projeção/orçamento" e "Retomar oferta do voucher") | Igual à etapa 2, mas com prazo de 2 dias |
| 4 | Agendado | `agendado` | **Qualquer horário futuro, em até 180 dias, no Avec ou no CRM para o contato.** A data do deal vem do horário mais próximo | Compareceu → 5; faltou ou cancelou → 2 |
| 5 | Atendida | **novo** `atendido` | Avec com status "compareceu", ou Compareceu marcado no CRM. O valor vem de `sales_items` do dia | Depois de 3 dias, ou quando a conversa é encerrada → Fechado (ganho). Antes disso, abre a tarefa de pós (agradecer, pedir foto, avaliação) |
| 6 | Retorno sugerido | **novo** `retorno` | No dia do ciclo do serviço (`lists.cycle_days`), ou pacote com sessões restantes e sem horário futuro. Abre um deal novo; hoje há 31 pacotes ativos de 18 clientes | Marcou horário → 4; cliente escreve → 1 |
| 7 | Fechado / Perdido | já existem | — | — |

O pacote **não é etapa**. Vira o selo "Pacote 3/10" no card, e cada sessão segue Agendado → Atendida.

**Etapas que cada perfil vê:**
- Hoje o escopo é só por dono (`board.ts:38-40`): a atendente vê as dela e as sem dono. Como 152 dos 185 estão sem dono, na prática a Sara vê tudo.
- **Proposta:**
  - **Atendente:** 0 a 4 e 6, só as dela e as sem dono.
  - **Recepção:** 4, 5 e 6, com foco no dia.
  - **Gestão:** todas, mais Fechado/Perdido e Jornada.
- **Implementação:** uma permissão `etapas.ver` por etapa no perfil, ou uma coluna com os perfis que veem cada etapa.

**Dono e "quem está fazendo".** Proposta: ler a assinatura `^\*NOME - CASA FIAES` de cada mensagem que sai pelo celular. Ela define quem respondeu (`sent_by`) e, quando o deal está sem dono, quem passa a ser a dona. Isso preenche cerca de 140 dos 152 sem dono. A assinatura CATI precisa ser ligada ao usuário Caticilene.

## 6. Como migrar os deals que já existem

Fazer em lote, com backup antes, ao estilo de `organizacao-2026-10-14-antes.json`:

| Hoje | Deals | Vai para |
|---|---|---|
| Atendimento com horário futuro | 7 | Agendado, com a data vinda do Avec |
| Atendimento: compareceu nos últimos 30 dias | 32 (25 com conversa arquivada) | Atendida, ou Fechado se a conversa estiver arquivada |
| Atendimento com pacote ativo | 1 | Retorno sugerido, com o selo do pacote |
| Atendimento: Casa falou por último | 47 (15 há 1 dia ou mais, 32 hoje) | Aguardando cliente, tentativa 1 |
| Atendimento: cliente falou por último | 5 | Fica em Em conversa |
| Follow-up 1: Casa falou por último | 41 | Aguardando cliente, mantendo a tarefa |
| Follow-up 1: cliente falou por último | 9 | Em conversa (bola com a Casa), com a tarefa "Responder" |
| Follow-up 1: compareceu nos últimos 30 dias | 6 | Atendida |
| Lead | 8 | 6 ficam, 1 vai para Atendida, 1 para Aguardando cliente |
| Agendado | 29 | 25 ficam; **4 sem horário correspondente no Avec** vão para revisão manual |
| Sem deal, com horário futuro no Avec | 40 contatos | Ganham deal em Agendado (ou só aparecem na Agenda; decidir) |

As chaves `followup_2` a `followup_4` são desativadas (estão vazias). A chave `followup_1` passa a se chamar "Aguardando cliente".

**Mudanças técnicas necessárias:**
1. Migration acrescentando os tipos `proposta`, `atendido` e `retorno` ao enum de etapas.
2. Gatilhos novos no motor: "horário criado/alterado no Avec", "comparecimento" e "Casa falou por último há X horas úteis".
3. Fazer a importação do Avec (`import-agenda.ts`) chamar o movimento de etapa.
4. `markAttendance` passar a mover para Atendida.
5. `sweepOverdueWaits` deixar de mandar para Follow-up quando quem espera é a cliente.
6. O Quadro e a Jornada respeitarem conversa arquivada, ou o "Encerrar" passar a fechar o deal.
7. Leitura da assinatura nas mensagens que saem pelo celular.

Os arquivos estão em /private/tmp/claude-501/-Users-joaquimsalles/1d859e91-de4e-47e9-bde3-8a64964253fe/scratchpad/analise/funil/:
- funil.png e funil.txt
- jornada.png e jornada.txt
- etapas.png e etapas.txt
- automacoes.png e automacoes.txt
- q1.sql a q10.sql (as consultas, todas só leitura)