# Importação do Avec sem lixo + "Confirmar por telefone": plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: superpowers:executing-plans (decisão do dono), com TDD (superpowers:test-driven-development). Passos com checkbox (`- [ ]`).

**Objetivo:** a importação do Avec para de deixar horários vivos que não existem mais (remarcação, cancelamento sem hora, data absurda, status desconhecido, "Atendimento" duplicado, visita paga sem baixa), a CLIENTE PADRÃO sai de tudo o que é cliente, e a Agenda › Pendências ganha a lista "Confirmar por telefone". O lixo que já está em produção sai com `scripts/limpar-avec-lixo.ts`.

**Arquitetura:** cada causa é corrigida no importador que a cria (`src/server/domain/avec/*`) e, quando a regra cruza relatórios, num passo do lote em `apply.ts` (`twins.ts` para os gêmeos). O que a recepção precisa decidir aparece em "Conferir com o Avec" (só leitura, como já é). O script de limpeza reusa as mesmas funções, em lotes e transações curtas; `--dry-run` roda tudo e desfaz (ROLLBACK).

**Stack:** Next 16, Drizzle + Postgres, Vitest (banco real), Playwright.

**Base de evidência:** relatório `~/ClaudeGerado/casa-fiaes-analise-2026-10-17.md` (itens 5, 6, 8, 9, 10 e código) e consultas só-leitura em produção de 17/10 (abaixo, em "Causas").

## Restrições globais

- Tudo em PT-BR (código, comentários, textos da tela, mensagens de commit).
- Planilhas reais do Avec (`~/Documentos-Trabalho/Planilhas-Recebidas/casa-fiaes-avec-relatorios/`) NÃO entram no repositório: testes usam planilhas sintéticas com os mesmos cabeçalhos (`H` de `apply.test.ts`).
- Produção: só SELECT, sem PII na saída. O script de limpeza é rodado pelo usuário.
- Migration, se precisar: `0058`, `when` 1792340000000. (Esta usa: tabela `avec_rejected_rows`.)
- e2e: banco `crm_e2e_avec`, `E2E_PORT=3520`, `EVOLUTION_URL=http://127.0.0.1:8080` só no comando. Proibido: portas 3000/3100/4321/4400/8080 para servidor, pkill/killall, push, deploy, WhatsApp.
- Agenda: só acrescentar a lista em Pendências (outros agentes mexem na Agenda). "Conferir com o Avec" ganha tipos novos na mesma lista.
- Testes de banco rodam no `DATABASE_URL` do `.env` (`crm_avec`; o `setup-env` só troca quando termina em `/crm`).

## Causas (systematic-debugging, fase 1) e decisões

| # | Sintoma | Causa raiz (com evidência) | Correção |
|---|---|---|---|
| 1 | Remarcação deixa a reserva antiga viva | O Avec muda a hora da reserva sem emitir cancelamento; a chave é `dia+hora+cliente+serviço` e nada varre a chave que sumiu. Prod: Maria Sonia 15/10 11:30 estava no relatório de 14/10 e sumiu dos de 15 e 17/10 (que trazem 13:30 "Pago"); `cancels_dia = 0` nos pares de 30 dias. | **Varredura "sumiu do Avec"** no relatório "Reservas" (f18900ac, filtrado por Data Reserva): para cada cliente + dia + profissional que o relatório traz, a reserva ativa do Avec desse grupo que não veio é cancelada (`remarcado`, via `avec`). |
| 2 | 375 cancelados às 00:00 | O relatório de cancelamentos (e8aa4978) nunca traz hora (`dd/mm/aaaa`, 100% das linhas). A busca exige UMA reserva com mesmo dia+cliente+serviço; nos 375, há sempre ≥2 (a antiga e a remarcada) → cai no 00:00. | Casar por **cliente + dia + profissional** (desempate pelo serviço). Já cancelada → nada. Uma viva → cancela. Senão → não grava nada. Nunca mais 00:00. |
| 3 | CLIENTE PADRÃO com 54 horários ativos | É a cliente genérica do Avec: nunca tem contato (prod: 726 horários, 0 com contato), e tudo trata nome igual como a mesma cliente (194 "visitas"). | `isGenericClient` em `src/lib/generic-client.ts`. Continua na grade (ocupa o horário). Sai de: lembrete, Sem baixa, Hoje (quadro e Na Casa; o Ao vivo usa o mesmo `dayVisitsOf`), visitas, comanda (Falta pagar e itens), relatórios da agenda. |
| 4 | Datas 2029, 2923, 4676 | `dateIso` aceita qualquer data do calendário; nenhuma checagem de plausibilidade (o 1903eedc trouxe até 4676-11-10). | Aceita de 2000-01-01 até hoje + 366 dias. Fora disso, a linha vai para `avec_rejected_rows` (migration 0058) e aparece em "Conferir com o Avec" enquanto vier nas importações dos últimos 30 dias. |
| 5 | Status desconhecido vira "agendado" | `reservationStatus` devolve `agendado` por padrão. Prod: único desconhecido é "Aguardando" (163 agendado + 2 cancelado). | Status novo **`conferir`** (neutro): não recebe lembrete, não entra no Sem baixa nem no Hoje, ocupa a grade, `avec_status` guarda o texto e entra em "Conferir com o Avec" ("Situação que o CRM não conhece"). A recepção resolve com Veio/Faltou/Chegou/Cancelar. |
| 6 | Gêmeos CRM↔Avec ("Atendimento" sem profissional) | `pairAvecTwins` só casa reserva do lote atual, com início e serviço idênticos. O "Atendimento" do lead não tem serviço nem profissional → nunca casa. Prod: 5 casos (16, 16, 17, 20 e 21/10). | **Juntar**: o "Atendimento" do CRM (origem `crm`, sem profissional e sem serviço, agendado/confirmado) some (cancelado, motivo `outro`, nota "Junto com o horário do Avec do mesmo dia") quando o Avec tem horário não cancelado da mesma cliente no dia; o lead (`dealId`) e a confirmação passam para os horários do Avec. |
| 7 | Pago no Avec, "agendado" no CRM | Itens de comanda e pagamentos só geram evidência de cliente; nenhum importador mexe no horário, e o gêmeo "nunca muda o do CRM". Prod (7 dias): 8 sem baixa com comanda/pagamento no dia, entre eles o da Karina (CRM com gêmeo). | Ao importar itens (63d414a7) ou pagamentos (d1e9f12d): horário da cliente no dia da comanda, já começado, em agendado/confirmado/chegou/em_atendimento/conferir, vira **compareceu** — a não ser que tenha `crmTouchedAt`; nesse caso só grava `avec_status = 'compareceu'` (aparece para conferir). |
| 8 | 35% sem conversa não recebem lembrete | `reminder.ts`: sem lead não arquivado do titular, não envia. | Lista **"Confirmar por telefone"** em Pendências: cliente com horário amanhã, sem conversa, com telefone; botão "Iniciar conversa". |

**Rulings (decisões tomadas sem perguntar):**
- R1. A varredura só roda no "Reservas" (f18900ac). O "Reservas (quem cadastrou)" (1903eedc) é filtrado pela data de **cadastro** (arquivo de 17/10: cadastro 15–16/10, reservas 15/10–10/12), então um dia dele não está completo e varrer apagaria reserva viva.
- R2. Cancelamento sem par seguro não vira linha: a reserva do relatório "Reservas" já traz "Cancelado" (é por isso que 100% dos 375 têm par cancelado no dia).
- R3. CLIENTE PADRÃO: nome normalizado começa com "cliente padrao" e sem contato (ou contato com esse nome). Fica na grade porque ocupa a profissional.
- R4. "Aguardando" continua desconhecido (vira `conferir`). Evidência: só aparece hoje/passado, 26% com comanda (Agendado: 0,1%), então parece "cliente chegou". Mapear para `chegou` é decisão do dono.
- R5. O fechamento pela comanda não avisa a profissional nem marca `crmTouchedAt` (é o Avec falando, como o "Pago" da reserva).
- R6. "Confirmar por telefone" usa a mesma regra de "sem conversa" do lembrete (nenhum lead não arquivado do titular do número). Contato Equipe/Fornecedor/Spam fica fora. A aba só aparece com algo na lista e entra na contagem do sino.

## Revisão: o que os testes precisam cobrir além do caminho feliz

1. Relatório "Reservas" filtrado por uma profissional: a varredura não pode tocar horário de outra profissional (grupo inclui a profissional).
2. Reserva mexida no CRM (`crmTouchedAt`) que sumiu/foi cancelada/foi paga no Avec: status não muda, só `avec_status` (aparece em Conferir).
3. Importar o mesmo arquivo duas vezes (idempotência) e importar fora de ordem (cancelamentos antes das reservas): nenhum 00:00, nada duplicado.
4. Comanda de hoje para horário que ainda não começou: não fecha.
5. Cliente com 2 serviços na mesma profissional no mesmo dia e cancelamento de um deles: cancela só o do serviço certo.

---

### Task 1: CLIENTE PADRÃO fora de tudo o que é cliente

**Arquivos:**
- Criar: `src/lib/generic-client.ts`, `src/lib/generic-client.test.ts`
- Modificar: `src/lib/agenda-day.ts` (`noBaixa`), `src/server/queries/agenda.ts` (campo `genericClient` no `AgendaItem`), `src/app/(app)/agenda/page.tsx` (`faltaPagar`), `src/server/queries/day-visit.ts` (`OUT`), `src/server/queries/today.ts` (Na Casa), `src/server/domain/agenda/visits.ts` (`OUT_OF_VISIT`), `src/server/domain/client-link/reminder.ts` (busca do job), `src/server/domain/caixa/comandas.ts` (`addAppointmentItemsTx`), `src/server/reports/salon.ts` (`salonAttendance`)
- Testes: `src/lib/generic-client.test.ts`, `src/lib/agenda-day.test.ts` (ou o que já testa `noBaixa`), `src/server/queries/day-visit.test.ts`, `src/server/domain/client-link/reminder.test.ts`, `src/server/reports/salon.test.ts`

**Interfaces (produz):**
- `isGenericClientName(name: string | null | undefined): boolean` — `normText(name)` começa com `"cliente padrao"`.
- `isGenericClient(a: { contactId?: string | null; clientName?: string | null; name?: string | null }): boolean`
- `genericClientSql(t: { contactId: AnyPgColumn; clientName: AnyPgColumn }): SQL` — `(contact_id is null and client_name ~* '^\s*cliente\s+padr(a|ã)o')`; e a versão texto `GENERIC_CLIENT_SQL_A` para SQL cru com alias `a`.
- `AgendaItem.genericClient: boolean`.

- [ ] Teste: `isGenericClientName("CLIENTE PADRÃO")`, `"Cliente Padrao"`, `" cliente  padrão (x)"` → true; `"Clientes Padrinho"`, `"Ana"`, `null` → false.
- [ ] Teste `noBaixa`: item com `genericClient: true` passado e agendado não entra.
- [ ] Teste `dayVisitsOf(dia)`: horário da CLIENTE PADRÃO no dia não vira visita; o de uma cliente real sim.
- [ ] Teste do job do lembrete: CLIENTE PADRÃO com contato fictício de mesmo nome e lead não gera outbox.
- [ ] Teste `salonAttendance`: agendado passado da CLIENTE PADRÃO não conta em `semDesfecho` nem nos totais.
- [ ] Teste `assignDayVisitsTx`: CLIENTE PADRÃO fica sem `visit_id`.
- [ ] Rodar e ver falhar; implementar; rodar e ver passar.
- [ ] Commit: `fix(avec): CLIENTE PADRÃO fora do lembrete, baixa, Hoje, visita, comanda e números`

### Task 2: status desconhecido vira `conferir`

**Arquivos:**
- Modificar: `src/server/domain/avec/normalize.ts` (`reservationStatus`, tipo `AppointmentStatus`), `src/server/domain/avec/import-agenda.ts` (`RANK`), `src/lib/appointment-status.ts` (`APPT_STATUSES`, `OCCUPYING_STATUSES`, `checkTransition`, `checkCancel`), `src/lib/agenda.ts` (`appointmentAgendaStatus`: `conferir` fica `conferir`), `src/server/domain/agenda/twins.ts` (tipo `status_desconhecido` em `listAvecDivergences`), `src/components/agenda/avec-divergences.tsx` (texto)
- Testes: `normalize.test.ts`, `src/lib/appointment-status.test.ts`, `src/lib/agenda.test.ts`, `src/server/domain/agenda/twins.test.ts`, `apply.test.ts`

**Interfaces:** `reservationStatus("Aguardando") → { status: "conferir", avecStatus: "Aguardando" }`; vazio continua `agendado`. `RANK.conferir = 2.5` (passa agendado/confirmado, perde para compareceu/faltou/cancelado). `DivergenceKind` ganha `"status_desconhecido"` com rótulo "Situação que o CRM não conhece"; descrição "No Avec: «Aguardando»."

- [ ] Testes: `reservationStatus` acima; `checkTransition("conferir","compareceu",passado)` ok, `"faltou"` ok, `"chegou"` no dia ok, `checkCancel("conferir")` ok, `"confirmado"` recusado; `appointmentAgendaStatus({status:"conferir"})` = `"conferir"` antes e depois da hora; importar reserva "Desmarcado" grava `conferir` + `avec_status`; reserva agendada que depois vem "Desmarcado" vira `conferir`; depois "Pago" vira `compareceu`; `listAvecDivergences` lista `status_desconhecido`.
- [ ] Falhar → implementar → passar.
- [ ] Commit: `fix(avec): status que o CRM não conhece fica em Conferir, não em agendado`

### Task 3: datas fora do limite recusadas (migration 0058)

**Arquivos:**
- Criar: `drizzle/0058_avec_recusadas.sql` (+ entrada no `_journal.json`, `when` 1792340000000)
- Modificar: `src/server/db/schema.ts` (`avecRejectedRows`), `src/server/domain/avec/normalize.ts` (`plausibleDay`), `src/server/domain/avec/context.ts` (`now`, `reportId`, `reject()`), `src/server/domain/avec/apply.ts` (passa `now` e `reportId`), `src/server/domain/avec/import-agenda.ts` (reservas, cancelamentos, espera), `src/server/domain/agenda/twins.ts` (`listAvecRejected`), `src/app/(app)/agenda/page.tsx` + `src/components/agenda/avec-divergences.tsx` (bloco "Data impossível")
- Testes: `normalize.test.ts`, `apply.test.ts`, `twins.test.ts`, `test/db.ts` (truncate da tabela nova)

**Interfaces:**
- Tabela `avec_rejected_rows`: `id uuid pk`, `external_key text unique not null` (`avec:rej:<chave da reserva>`), `reason text not null` (`data_fora_do_limite`), `report_id uuid → avec_reports on delete set null`, `day text not null` (o que veio), `hm text`, `client_name text`, `contact_id uuid → contacts`, `professional_name text`, `service_label text`, `first_seen_at`, `last_seen_at timestamptz not null default now()`.
- `plausibleDay(day: string, now: Date): boolean` — `day >= "2000-01-01" && day <= hoje(Salvador) + 366 dias`.
- `ImportCtx.reject(row: { day; hm; name; contactId; pro; service }): Promise<void>` — upsert por `external_key`, atualiza `last_seen_at`.
- `listAvecRejected(now: Date): Promise<AvecRejected[]>` — `last_seen_at` nos últimos 30 dias.

- [ ] Testes: `plausibleDay("4676-11-10")` false, `("2029-01-01", now=17/10/2026)` false, `("2027-10-17")` true, `("1999-12-31")` false; importar reservas com 10/11/4676 não cria horário e cria 1 recusada; reimportar não duplica e mexe no `last_seen_at`; `listAvecRejected` devolve a recusada.
- [ ] Falhar → implementar (migration aplicada com `npx drizzle-kit migrate`) → passar.
- [ ] Commit: `fix(avec): data impossível não entra na agenda e aparece em Conferir com o Avec`

### Task 4: cancelamento casado por cliente + dia + profissional (fim do 00:00)

**Arquivos:** Modificar `src/server/domain/avec/import-agenda.ts` (`importCancellations`). Testes em `src/server/domain/avec/import-agenda.test.ts` (novo).

**Interfaces:** `matchCancellation(cands: Cand[], row: { professionalId: string | null; service: string | null }): { key: string } | "ja_cancelado" | null` (pura, exportada para teste), `Cand = { key; status; professionalId; serviceLabel; contactId; clientName }`. Regra: candidatas = reservas com hora do mesmo dia e mesma cliente (contato; sem contato, `normText` do nome) → filtra pela profissional quando a linha tem → se mais de uma, prefere o mesmo serviço → alguma já `cancelado` → `"ja_cancelado"` → exatamente uma em `agendado|confirmado|solicitado|conferir` → ela → senão `null`. Linha com `null`/`"ja_cancelado"` não grava nada.

- [ ] Testes (sintéticos): remarcação (10:00 cancelada pelo Reservas + 14:00 agendada, mesmo serviço e profissional) + cancelamento sem hora → nada muda e nenhum 00:00; dois serviços na mesma profissional, cancela "Corte" → só o Corte cancela; profissional diferente desempata (Luci: 09:00 FABIANA, 17:00 LOANA; cancelamento da LOANA → cancela 17:00); cancelamento importado antes das reservas → nenhum 00:00; horário com `crmTouchedAt` → status igual, `avec_status = 'cancelado'`.
- [ ] Falhar → implementar → passar. Atualizar o teste antigo de `apply.test.ts` que esperava o 00:00.
- [ ] Commit: `fix(avec): cancelamento sem hora casa por cliente, dia e profissional; nunca mais às 00:00`

### Task 5: varredura "sumiu do Avec" (remarcação)

**Arquivos:** Criar `src/server/domain/avec/vanished.ts`; modificar `import-agenda.ts` (`importReservations` chama a varredura quando `ctx.signature === "f18900ac"`), `context.ts` (`signature`). Teste: `src/server/domain/avec/vanished.test.ts`.

**Interfaces:**
- `SWEEP_SIGNATURES = new Set(["f18900ac"])`.
- `sweepVanished(tx: Tx, input: { rows: { key: string; day: string; clientKey: string; professionalId: string | null }[]; createdBefore: Date; now: Date }): Promise<{ cancelled: number; flagged: number }>` — grupos `(day, clientKey, professionalId)` com profissional; no banco, `origin='avec'`, chave `avec:res:<day>T<hh:mm>|<clientKey>|…` (sem `--:--`), mesma profissional, `avec_twin_of is null`, status `agendado|confirmado|solicitado|conferir`, `created_at < createdBefore`, chave fora do relatório → sem `crmTouchedAt`: `cancelado`, `cancel_reason='remarcado'`, `cancelled_via='avec'`, `cancelled_at=now`, `cancel_note='Sumiu do Avec (remarcado para HH:MM)'` com as horas novas do grupo, auditoria `avec_sumiu`; com `crmTouchedAt`: só `avec_status='cancelado'` (`flagged`).
- `clientKey` = o pedaço da chave (`normText` do nome), igual ao de `reservationKey`.

- [ ] Testes: Maria Sonia sintética (11:30 e 15:00 agendadas antes; relatório novo traz só 13:30 Pago) → 11:30 e 15:00 canceladas com motivo `remarcado`; relatório com só a profissional A não toca horário da B; cliente sem linha no relatório não é tocada; "Reservas (quem cadastrou)" nunca varre; `crmTouchedAt` → `flagged`; reimportar = 0.
- [ ] Falhar → implementar → passar.
- [ ] Commit: `fix(avec): reserva remarcada no Avec não fica viva no CRM`

### Task 6: juntar o "Atendimento" do CRM com o horário do Avec

**Arquivos:** Modificar `src/server/domain/agenda/twins.ts` (`absorbCrmPlaceholders`), `src/server/domain/avec/apply.ts` (chama depois de `pairAvecTwins`, transação própria, erro não desfaz o lote). Teste: `twins.test.ts`.

**Interfaces:** `absorbCrmPlaceholders(tx: Tx, opts: { now: Date; contactIds?: string[] }): Promise<{ joined: number }>` — placeholder = `origin='crm'`, `professional_id is null`, `service_id is null`, `status in ('agendado','confirmado')`, `avec_twin_of is null`; par = horário `origin='avec'` da mesma `contact_id`, mesmo dia (Salvador), `avec_twin_of is null`, status fora de `cancelado`/espera. Efeito: horários do Avec sem `deal_id` recebem o do placeholder; placeholder `confirmado` → os do Avec em `agendado` sem `crmTouchedAt` ficam `confirmado` com `confirmed_at`/`confirmed_via` dele; placeholder → `cancelado`, `cancel_reason='outro'`, `cancel_note='Junto com o horário do Avec do mesmo dia'`, `cancelled_via='avec'`, auditoria `avec_juntou_atendimento`; lembrete pendente do placeholder cancelado na outbox (`source` com o `visit_id` dele, se a visita ficar sem horário ativo).

- [ ] Testes: placeholder + reserva do Avec no dia → placeholder cancelado, reserva com o `deal_id`; placeholder confirmado → reserva confirmada; Avec só com cancelado/espera no dia → nada; placeholder com profissional ou serviço → nada; idempotente.
- [ ] Falhar → implementar → passar.
- [ ] Commit: `fix(agenda): o Atendimento do lead se junta à visita do Avec do mesmo dia`

### Task 7: comanda ou pagamento do Avec dá baixa

**Arquivos:** Criar `src/server/domain/avec/sales-close.ts`; modificar `context.ts` (`salesDays: Set<string>` "contactId|dia"), `import-sales.ts` (itens e pagamentos registram o par), `apply.ts` (chama no fim do arquivo, dentro da transação). Teste: `sales-close.test.ts`.

**Interfaces:** `closeFromAvecSales(tx: Tx, pairs: { contactId: string; day: string }[], now: Date): Promise<{ closed: number; flagged: number }>` — em lotes de 500 pares; status `agendado|confirmado|chegou|em_atendimento|conferir`, `starts_at <= now`, `avec_twin_of is null`; sem `crmTouchedAt` → `compareceu`, `avec_status = coalesce(avec_status, status antigo)` (como a parte C do script 05), auditoria `avec_baixa_comanda`; com `crmTouchedAt` → `avec_status='compareceu'`.

- [ ] Testes: Karina sintética (horário do CRM agendado 16/10 + item de comanda 16/10) → compareceu; pagamento sem item também fecha; horário de hoje que ainda não começou não fecha; `crmTouchedAt` → só `avec_status`; cancelado/faltou não mudam; outro dia não muda.
- [ ] Falhar → implementar → passar.
- [ ] Commit: `fix(avec): comanda ou pagamento do Avec dá baixa no horário`

### Task 8: Pendências › "Confirmar por telefone"

**Arquivos:** Criar `src/server/queries/confirm-by-phone.ts` (+ teste), `src/components/agenda/day/confirm-by-phone.tsx`; modificar `src/components/agenda/day/pending.tsx` (aba `telefone`), `src/components/agenda/day/shell.tsx` (soma no sino), `src/app/(app)/agenda/page.tsx` (dados).

**Interfaces:**
- `listConfirmByPhone(now: Date): Promise<ConfirmByPhoneItem[]>`; `ConfirmByPhoneItem = { contactId: string; name: string; phone: string; firstStart: string; services: { service: string; pro: string | null }[] }` — horários de amanhã (Salvador) em `agendado|confirmado`, sem gêmeo, contato `kind='cliente'` com telefone, não genérico, e o titular do número (`shares_phone_with` ou ele mesmo) sem lead com `archived_at is null`. Um item por contato, ordenado pela hora.
- `PendingData.confirmByPhone: { items: ConfirmByPhoneItem[]; canStart: boolean }`; `PendingTab` ganha `"telefone"`, rótulo "Confirmar por telefone".
- Tela: título com a contagem, a frase "Sem conversa no CRM, não recebem o lembrete. Ligue ou inicie a conversa.", cada linha com hora, nome, serviços com a profissional, telefone formatado como link `tel:` e `<StartConversation contactId hasOpenLead={false} />` quando `canStart` (permissão `contatos.ver`).

- [ ] Testes da consulta: cliente com horário amanhã e sem lead entra; com lead aberto ou fechado não arquivado não entra; com lead arquivado entra; sem telefone não entra; CLIENTE PADRÃO não entra; horário depois de amanhã não entra; pessoa a mais no número cujo titular tem lead não entra; dois serviços = um item.
- [ ] e2e em `e2e/agenda-nova.spec.ts` (ou novo `e2e/confirmar-telefone.spec.ts`): semear cliente sem conversa com horário amanhã, abrir Pendências, ver a aba e o botão "Iniciar conversa".
- [ ] Falhar → implementar → passar.
- [ ] Commit: `feat(agenda): Pendências › Confirmar por telefone`

### Task 9: `scripts/limpar-avec-lixo.ts`

**Arquivos:** Criar `scripts/limpar-avec-lixo.ts` e `src/server/domain/avec/cleanup.ts` (+ `cleanup.test.ts`).

**Interfaces:** `runAvecCleanup(opts: { apply: boolean; now: Date; batch?: number; log?: (s: string) => void }): Promise<CleanupReport>`; `CleanupReport = { completarCadastro: number; cancelSemHora: { casados: number; apagados: number }; padrao: { visitasDesligadas: number; visitasApagadas: number }; datas: { recusadas: number; apagados: number }; desconhecidos: number; remarcados: { cancelados: number; sinalizados: number }; juntados: number; baixas: { fechados: number; sinalizados: number } }`. Cada passo em lotes (padrão 200) e uma transação por lote; `apply: false` faz cada transação e dá ROLLBACK (o número é o mesmo que o `--aplicar` daria). Passos:
1. 00:00 (`avec:res:%T--:--%`): `matchCancellation` com as reservas do dia → cancela a casada viva; apaga a linha 00:00 se nada a referencia (comanda, link, espera, gêmeo); auditoria com a chave.
2. CLIENTE PADRÃO: tira `visit_id` e apaga a visita que ficou vazia e sem comanda.
3. Datas fora do limite (= parte A do `05_agenda_status_e_datas.sql` do coordenador): grava em `avec_rejected_rows` e cancela o horário (`engano`, nota "Ano impossível vindo do Avec (AAAA).", `cancelled_via='avec'`, `crm_touched_at`), sem apagar.
4. Desconhecidos: `origin='avec'`, sem `crmTouchedAt`, `status in ('agendado','confirmado')`, `avec_status` que o `reservationStatus` não conhece → `conferir`.
5. Remarcação: para cada dia, o "Reservas" (f18900ac) mais recente que o cobre, guardado em `avec_reports` → `sweepVanished` com `createdBefore = imported_at`.
6. `absorbCrmPlaceholders`.
7. `closeFromAvecSales` com os pares (contato, dia) de `sales_items` e `sales_payments` de todo o histórico (= parte C do script 05: 516 em 17/10), e a parte B do 05: "chegou" de dia anterior com venda do Avec ou comanda do CRM no dia vira compareceu mesmo com `crmTouchedAt` (o Chegou foi do CRM; a venda prova o fim).
8. "(completar cadastro)" nos contatos: `cleanCompleteProfileNames` (= script 02).
Uso: `npx tsx scripts/limpar-avec-lixo.ts --dry-run|--aplicar`. Sem argumento: recusa. Saída só com números (sem nomes).

- [ ] Teste: banco sintético com um caso de cada → `apply:false` devolve as contagens e não muda nada; `apply:true` devolve as mesmas e muda; segunda rodada com `apply:true` = tudo zero.
- [ ] Falhar → implementar → passar.
- [ ] Commit: `feat(scripts): limpar-avec-lixo com --dry-run e --aplicar`

### Task 11: "(completar cadastro)" sai do nome e vira etiqueta

Pedido do coordenador (17/10, `~/ClaudeGerado/casa-fiaes-dados-2026-10-17.md` §4.3 e `02_contatos_completar_cadastro.sql`): 52 contatos com o sufixo do Avec.

**Arquivos:** Modificar `src/server/domain/avec/normalize.ts` (`splitClientName` devolve `completeProfile`), `src/server/domain/avec/context.ts` (`tagCompleteProfile`, `cleanCompleteProfileNames`), `src/server/domain/avec/import-agenda.ts`/`import-sales.ts`/`import-contacts.ts` (onde já marcam "Uso de imagem"), `src/server/domain/avec/apply.ts` (chama a limpeza como a de uso de imagem), `src/lib/display-name.ts` (a exibição tira o sufixo). Testes: `normalize.test.ts`, `apply.test.ts`, `src/lib/display-name.test.ts`.

**Interfaces:** `COMPLETE_PROFILE_TAG = "Completar cadastro"`; `splitClientName(raw) → { name, imageUse, completeProfile }` — tira só o parêntese final que contém "completar" (com ou sem o de fechar); o recado que vier junto ("MÃE AMIGA … - COMPLETAR CADASTRO") sai em `note`. `stripCompleteProfile(name: string): { name: string; note: string | null; hit: boolean }` (pura, a mesma regra do script 02, também para "NOME COMPLETAR [CADASTRO] [ONLINE]" sem parênteses) usada pela limpeza dos contatos e pela exibição. Nome que ficaria vazio: não muda. "completar" no meio do nome: não muda (à mão).

**Ruling:** as chaves das reservas usam `normText`, que já tira o parêntese final; o `splitClientName` só tira a forma com parênteses, para a chave das reservas sem parênteses não mudar (mudar a chave criaria horário duplicado e a varredura cancelaria o antigo). A forma sem parênteses sai do contato (limpeza) e da exibição.

- [ ] Testes: `splitClientName("ANA LIMA (COMPLETAR CADASTRO)")` → nome "ANA LIMA", `completeProfile: true`; `"(completar"` sem fechar; `"(COMPLETAR)"`; `stripCompleteProfile("MARIA SOUZA COMPLETAR CADASTRO")` → "MARIA SOUZA"; recado vai para `note`; nome só com o sufixo não muda; `displayName("ANA LIMA (COMPLETAR CADASTRO)")` = "Ana Lima"; importar cadastro/reserva com o sufixo → contato sem sufixo e com a etiqueta; contato antigo com o sufixo é limpo na importação (nome, etiqueta, recado em `notes`, auditoria `corrigiu_nome`) e reimportar não devolve o sufixo.
- [ ] Falhar → implementar → passar.
- [ ] Commit: `fix(avec): "(completar cadastro)" sai do nome e vira a etiqueta Completar cadastro`

### Task 10: verificação final

- [ ] `npx vitest run` completo.
- [ ] `npx next typegen && npx tsc --noEmit`.
- [ ] `npm run lint`.
- [ ] e2e de agenda e importação: `DATABASE_URL=…/crm_e2e_avec E2E_PORT=3520 EVOLUTION_URL=http://127.0.0.1:8080 npx playwright test e2e/agenda-*.spec.ts e2e/sinais-importacao.spec.ts e2e/confirmar-telefone.spec.ts --project=desktop`.
- [ ] Estimar o `--dry-run` por SELECT em produção (só números).
- [ ] Revisão final (superpowers:requesting-code-review) e correções.
