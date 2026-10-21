# Lista da Cati (20/10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 35 itens que a Cati e o Joaquim pediram entre 15 e 20/10, sem mudar as telas já aprovadas (Conversas, Hoje, grade da Agenda).

**Architecture:** Mudanças pequenas por tela, cada uma com teste. O Quadro ganha só uma visão nova (não muda a etapa de ninguém). Nada força recarregar a tela do usuário. Toda ação nova respeita as permissões existentes.

**Tech Stack:** Next.js (App Router, server actions), Drizzle + Postgres, vitest, Evolution API (WhatsApp).

**Spec:** `docs/superpowers/specs/2026-10-20-cati-lista-completa.md` (a lista numerada; os números `#N` abaixo são os dela).

## Global Constraints

- Português do Brasil em tudo que a equipe lê; sem MAIÚSCULAS em rótulo; sem telefone cru na tela (use `formatPhoneClient`).
- Deploy só entre 17h e 9h de Salvador (pedido da Cati, 20/10). Backup antes (`ops/deploy-crm.sh`). Nunca reiniciar a tela do usuário à força.
- Migration: `when` do journal maior que `1792640000000` (a 0088 já usa esse); conferir com `npx tsx scripts/checar-journal.ts`.
- Nunca enviar WhatsApp real sem aprovação; a IA nunca envia sozinha.
- Telas aprovadas que não mudam: Conversas (Fila/painel), Hoje (Resumo/Recepção/Ao vivo), grade da Agenda.
- Rodar vitest completo uma vez no fim; por tarefa, só os arquivos tocados. `.env` e `node_modules` vêm da worktree `ia-sugestao`.

## Review Focus

- Cliente agendada que escreve e depois a equipe marca "Veio/Faltou": o Veio/Faltou não pode quebrar (por isso a etapa não muda).
- Conversa resolvida em que a cliente escreve de novo volta para a Fila (Aberto), com a mensagem contada como não lida.
- Contato "pessoa a mais" no número da filha ganhar WhatsApp próprio sem apagar o histórico dela.
- Atualização do sistema com a atendente no meio de uma mensagem: o texto digitado volta.
- Ligação de número oculto de uma cliente que já tem cadastro: não abre conversa nova.

---

## Já pronto na branch `cati-2010` (só subir depois das 17h)

Apagar só aqui (#12) · Faltou com "Não veio / Cancelou / Marcar para remarcar" (#28) · cartão "trazer pra cá" removido (#14) · apagar/editar/reagir usam o endereço real da mensagem (#13) · WhatsApp editável na ficha (#32) · coluna "Esperando você" no Quadro (#1, #2, #4, #11 parcial). Migration `0088_ocultar_mensagem`.

---

### Task 1: Faltou no app da profissional (#28)

**Files:**
- Modify: `src/server/domain/pro/appointment-actions.ts`, `src/app/(pro)/pro/actions.ts`
- Test: `src/server/domain/pro/appointment-actions.test.ts`

**Interfaces:**
- Consumes: `lerEscolhaFalta(): Promise<FaltaEscolha | null>`, `cancelarNoLugarDaFalta(id, actor)`, `semRemarcarDoHorario(id, userId)` de `src/server/domain/falta-escolha.ts`.
- Produces: o mesmo comportamento das telas da recepção quando a profissional marca "faltou".

- [ ] **Step 1: Test** `profissional marca Faltou com escolha "cancelou": horário vira cancelado (cliente_desmarcou) e não fica como faltou`.
- [ ] **Step 2: Run** `npx vitest run src/server/domain/pro/appointment-actions.test.ts` → FAIL.
- [ ] **Step 3: Implement** em `src/app/(pro)/pro/actions.ts`: antes de marcar "faltou", ler a escolha; aplicar as mesmas 3 saídas de `setAppointmentStatusAction` (`src/app/(app)/agenda/actions.ts`).
- [ ] **Step 4: Run** o teste → PASS. **Step 5: Commit** `feat(pro): Faltou pergunta o que houve também no app da profissional`.

### Task 2: Contador de não lidas igual à lista (#9)

**Files:**
- Modify: `src/server/queries/queue.ts` (`UNREAD`, `countOf`, `naoLidas`)
- Test: `src/server/queries/queue.test.ts`

**Interfaces:**
- Produces: `counts.naoLidas` conta só conversas que a aba "Não lidas" realmente lista (mesmas condições `conds`).

- [ ] **Step 1: Test** `contador "Não lidas" = número de itens da aba`: criar 3 conversas com mensagem da cliente sem leitura, 2 arquivadas/da equipe/"não é cliente"; esperar `counts.naoLidas === 3` e `listQueue({view:"nao-lidas"}).length === 3`.
- [ ] **Step 2: Run** → FAIL (conta as extras). **Step 3: Implement** o contador a partir das mesmas `conds` da lista (uma fonte só). **Step 4: Run** → PASS. **Step 5: Commit** `fix(fila): o contador de não lidas conta só o que a aba mostra`.

### Task 3: Ligação de cliente cadastrada não abre conversa "não identificada" (#10)

**Files:**
- Modify: `src/server/whatsapp/webhook.ts` (tratamento do evento de chamada / `callLogMesssage`), `src/server/domain/deals.ts` (`resolveContact`)
- Test: `src/server/whatsapp/webhook.test.ts`

**Interfaces:**
- Consumes: `lidLookup.phoneForLid(lid): Promise<string | null>` de `src/server/whatsapp/lid-pairs.ts` (confirmar o nome do método no arquivo).
- Produces: chamada com `@lid` cujo número a Evolution conhece cai na conversa do contato que tem esse número.

- [ ] **Step 1: Test** `ligação com @lid de cliente cadastrada entra na conversa dela, sem contato "Número oculto" novo` (mock `lidLookup`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** resolver o `@lid` pelo par conhecido antes de criar contato oculto. **Step 4: Run** → PASS. **Step 5: Commit** `fix(ligacao): chamada de número oculto cai na conversa da cliente cadastrada`.

### Task 4: Categoria "Para retomar" na Fila, com lembrete separado (pedido do Joaquim, 20/10)

**Files:**
- Modify: `src/server/queries/queue.ts` (nova visão `retomar` e contador `counts.retomar`), `src/components/queue/queue-top.tsx` (chip "Para retomar N" ao lado de Todas / Não lidas / Resolvidas)
- Test: `src/server/queries/queue.test.ts`, `src/components/queue/queue-top.test.tsx`

**Interfaces:**
- Consumes: tarefas abertas de retomada (`tasks.kind in ('retorno','proxima_acao')` com `due_at`) criadas por `resumeLater` (`src/server/domain/resume-later.ts`).
- Produces: `listQueue({ view: "retomar" })` lista conversas com retomada aberta, a mais próxima primeiro, mostrando o dia do lembrete; a conversa **não some** da Fila como as resolvidas.

- [ ] **Step 1: Test** `conversa com retomada para sexta aparece em "Para retomar" com o dia, e continua em "Todas"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** a visão e o chip; o lembrete que vence chega à atendente dona pelo sino (já existe para tarefas). **Step 4: Run** → PASS. **Step 5: Commit** `feat(fila): categoria Para retomar com lembrete separado`.

### Task 5: Cliente que volta depois de Resolvida cai em Aberto (#1, #4) — só trava o comportamento

**Files:**
- Test: `src/server/domain/deals.test.ts` (caso novo; `recordInbound` já limpa `conversationArchivedAt`)

- [ ] **Step 1: Test** `cliente escreve depois de Resolvido: volta para a Fila como Aberto, não lida, e a etapa (Agendado) não muda`.
- [ ] **Step 2: Run** → deve PASSAR; se falhar, corrigir `recordInbound` em `src/server/domain/deals.ts`. **Step 3: Commit** `test(fila): cliente que volta depois de resolvida fica em Aberto`.

### Task 6: Mensagens automáticas só como sugestão (#22)

**Files:**
- Modify: `src/server/domain/auto-message-settings.ts` (campo `modo: "enviar" | "sugerir"` por mensagem), `src/server/domain/auto-messages.ts` e `src/server/domain/auto-reply.ts` (em "sugerir", gravar rascunho na conversa em vez de enfileirar o envio), `src/components/config/` (a tela Configurações › Mensagens: seletor "Enviar sozinha / Só sugerir")
- Test: `src/server/domain/auto-messages.test.ts`

**Interfaces:**
- Produces: `type AutoMode = "enviar" | "sugerir"`; com "sugerir", nada vai para a fila de envio; a conversa mostra a sugestão para a atendente usar (mesmo cartão da sugestão da IA, "Nada é enviado sem você").

- [ ] **Step 1: Test** `boas-vindas em modo sugerir: não cria item na fila de envio e cria a sugestão na conversa`; `modo enviar: igual hoje`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(mensagens): cada mensagem automática pode ser só sugestão`.

### Task 7: Sugestão da IA editável direto (#23)

**Files:**
- Modify: o cartão da sugestão na conversa (`src/components/queue/` — localizar com `grep -rn "Nada é enviado sem você" src/components`)
- Test: teste de render ao lado do componente

- [ ] **Step 1: Test** `o texto da sugestão é um campo editável; "Usar" leva o texto editado ao campo de mensagem`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** textarea no lugar do parágrafo. **Step 4: Run** → PASS. **Step 5: Commit** `feat(ia): a sugestão se edita no próprio cartão`.

### Task 8: Lembrete organizado (#17)

**Files:**
- Modify: o montador do texto do lembrete D-1 (`grep -rn "lembrete_d1" src/server/domain src/server/rules`)
- Test: o `.test.ts` ao lado

- [ ] **Step 1: Test** `lembrete tem linhas separadas: saudação, dia e hora em negrito numa linha, serviço e profissional numa linha, pedido de confirmação`; o assistente não aparece no nome.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** o formato. **Step 4: Run** → PASS. **Step 5: Commit** `fix(lembrete): texto organizado em linhas`.

### Task 9: Cancelou sem data fica para retomar e sem lembrete (#26, #31)

**Files:**
- Test: `src/server/domain/agenda/reschedule-cancel.test.ts`
- Modify (se o teste falhar): `src/server/domain/agenda/visits.ts` (`cancelAppointmentsTx`), `src/server/domain/funnel.ts` (`enterMissedTx`)

- [ ] **Step 1: Test** `cancelar o único horário futuro tira a conversa de Agendado, cria "Remarcar" e a cliente não recebe lembrete`.
- [ ] **Step 2: Run** → se PASSAR, só commitar o teste; se falhar, corrigir `cancelAppointmentsTx`. **Step 3: Commit** `fix(agenda): cancelamento sem data deixa a conversa para remarcar`.

### Task 10: Atualização sem perder o que a atendente digitava (#34)

**Files:**
- Modify: `src/components/lead/composer.tsx` (rascunho por conversa em `localStorage`, chave `rascunho:<dealId>`; restaura ao montar; limpa ao enviar), o tratador global de erro de versão (`grep -rn "Server Action" src/app src/components`) para **não recarregar**: mostra um aviso "Nova versão disponível. Atualize quando terminar" com botão.
- Modify: `~/Projects/casa-fiaes/ops/deploy-crm.sh` — recusa rodar entre 09:00 e 17:00 de Salvador sem `FORA_DA_JANELA=1`.
- Test: `src/components/lead/composer.test.tsx`

- [ ] **Step 1: Test** `texto digitado numa conversa volta depois de remontar o composer; depois de enviar, o rascunho some`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** rascunho + aviso sem recarga + trava do deploy. **Step 4: Run** → PASS; rodar `bash ops/deploy-crm.sh 0 x` às 14h e ver a recusa. **Step 5: Commit** `feat(sistema): rascunho guardado, aviso de nova versão sem recarregar, deploy só fora do expediente`.

### Task 11: Comanda e conversa mostram todas as profissionais do dia (#30)

**Files:**
- Modify: o bloco "Próximo passo" do painel (`grep -rn "Próximo passo" src/components/queue`) e `src/server/queries/deal.ts` (a próxima visita com todos os horários)
- Test: teste de render do painel

- [ ] **Step 1: Test** `visita com 4 serviços lista os 4 com a profissional de cada; a assistente aparece como "com assistente X" e nunca como quem atende`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(conversa): a visita do dia mostra todas as profissionais`.

### Task 12: Mãe e filha no mesmo telefone (#11)

**Files:**
- Modify: `src/server/domain/people-on-number.ts` e a lista de pessoas do número no painel
- Test: `src/server/domain/people-on-number.test.ts`

- [ ] **Step 1: Test** `duas pessoas no mesmo número, as duas com horário: a conversa lista as duas e cada horário aparece na ficha de quem é`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `fix(clientes): pessoas no mesmo número aparecem juntas`.

### Task 13: Conferências (sem código até provar o defeito)

Para cada item, reproduzir no banco local; se não reproduzir, registrar "ok" em `ops/pendencias-minhas.md` com a evidência; se reproduzir, abrir tarefa nova com teste.

- [ ] #3 Fila fora de ordem · #5/#6/#7/#35 funcionárias e números novos · #16 notificação em "não é cliente" · #20 mensagem "já agendada" · #21 mensagem demorando · #33 busca por telefone e CPF (o Quadro já busca; conferir a Fila e a lista de Clientes).
- [ ] #24 serviços por profissional: a Thaise informa quem faz o quê; cadastrar em Serviços › por profissional.

### Task 14: Subir tudo (depois das 17h)

- [ ] **Step 1:** vitest completo uma vez (`npx vitest run`), `npx tsc --noEmit`, `npx tsx scripts/checar-journal.ts`.
- [ ] **Step 2:** merge de `cati-2010` em `ia-sugestao`; `ops/deploy-crm.sh 72 ~/Projects/casa-fiaes/wt/ia-sugestao migrar` fora do expediente.
- [ ] **Step 3:** conferir: login 200; abrir uma conversa e ver que o cartão "trazer pra cá" não existe; "Apagar só aqui" aparece no menu da mensagem; Quadro mostra "Esperando você"; Faltou pergunta "O que aconteceu?".

---

## Self-Review

- **Cobertura:** #1 T5+pronto; #2/#4 pronto; #3/#5–7/#16/#20/#21/#33/#35 T13; #8/#12/#13/#14/#28/#32 prontos; #9 T2; #10 T3; #11 T12; #17 T8; #18 já no ar; #19 já no ar (Sai na hora marcada mesmo com a Casa fechada, 16/10); #22 T6; #23 T7; #24 T13; #25 já existe ("Sobre o quê? … Falar"); #26/#31 T9; #27 no ar (r70); #29 T13; #30 T11; #34 T10.
- **Tipos:** `FaltaEscolha`, `lerEscolhaFalta`, `cancelarNoLugarDaFalta`, `semRemarcarDoHorario` definidos em `src/server/domain/falta-escolha.ts` e usados na T1.
- **Proporção:** 14 tarefas para 35 itens; as de conferência não escrevem código antes de provar o defeito.
