# Casa Fiaes CRM: agenda viva, comanda, app da profissional e área da cliente (Lotes 6A a 7B)

Documento de desenho escrito na noite de 15/10/2026 para virar plano e código **na mesma noite**. O dono autorizou executar tudo enquanto dorme. As escolhas que ele não fez estão na seção 11 ("Decisões tomadas sem o dono — revisar").

- **Base:** branch `agenda-viva`, que saiu da `rodada-2` em `84a902b` (Lote 1A inteiro e a primeira metade do 1B). O resto do 1B e o 1C estão sendo feitos em paralelo em `~/Projects/casa-fiaes/crm` (branch `rodada-2`). Os números de linha citados (`arquivo:linha`) valem para este código.
- **Pesquisas:** `docs/pesquisa-2026-10-15/avec-funcionalidades.md`, `docs/pesquisa-2026-10-15/chatguru-funcionalidades.md` e a matriz `docs/pesquisa-2026-10-15/matriz-avec-chatguru.md` (289 funcionalidades, uma por linha, com o lote que entrega).
- **Desenhos anteriores que continuam valendo:** `docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md` (Lotes 0 a 6 e as decisões do dono de 15/10), `docs/avec-engenharia-reversa.md` (seção 3, a agenda e o celular da profissional), `docs/avec-importacao-design.md` (regras da importação do Avec).
- **Plano dos lotes em paralelo:** `docs/superpowers/plans/2026-10-15-lotes-1-atendimento.md`. Este documento usa o que o 1C entrega (etapas Agendado, Atendida e Retorno sugerido; "Compareceu" leva a Atendida; a agenda e a importação do Avec movem o funil pela Tarefa C8) e **não refaz nada disso**.

---

## Resumo para o dono

**O que fica pronto (código testado; nada vai para o ar sem o seu ok):**

1. **Agenda de verdade no CRM.** A recepção marca tocando no horário livre, com um ou mais serviços na mesma visita e uma profissional para cada um. O sistema calcula os horários livres pela duração do serviço, pelo horário de trabalho de cada profissional, pelos bloqueios e pelos horários que já existem (do Avec e do CRM). Também dá para remarcar, cancelar com motivo, confirmar, marcar "chegou", "em atendimento", "finalizado" e "faltou", deixar observação, usar lista de espera com encaixe e ver a semana por profissional.
2. **Comanda, caixa e comissão.** A conta da cliente sai do horário, com vários itens, profissional por item, desconto e pagamento dividido. Tem caixa do dia com sangria, suprimento e fechamento conferido, comissão por profissional e serviço, e venda e baixa de pacotes. **Fica desligado** até a Casa decidir levar o caixa do Avec para o CRM, para a mesma venda não ser lançada duas vezes.
3. **App da profissional no celular.** É o próprio CRM, instalado na tela inicial: ela vê só a agenda dela, a próxima cliente com observações, marca chegou, iniciar e finalizar, pede folga e recebe aviso de horário novo, remarcado ou cancelado. Não vê conversas nem valores de outras pessoas.
4. **Página da cliente pelo link.** Mostra o horário e deixa a cliente confirmar, pedir para remarcar, cancelar, salvar no calendário e ver como chegar. O link sai pelo botão "Enviar link de confirmação" da conversa, que **só preenche o texto**: quem envia é a atendente.

**O que nunca liga sozinho:**
- nenhuma mensagem automática de WhatsApp;
- o lembrete da véspera e o agendamento online ficam construídos e desligados;
- duração dos serviços e comissões ficam vazias até a Casa preencher (o sistema nunca chuta).

**O que você decide quando acordar** (detalhes na seção 11):
- se a agenda do CRM fica só para consulta, em "dupla" (marca nos dois até a virada) ou já assume sozinha;
- quando o caixa passa para o CRM;
- se a cliente pode cancelar pelo link até 24 h antes;
- se a profissional vê o valor do serviço na comissão (no Avec da Casa isso está escondido);
- quando desligar a confirmação da Avec IA.

**O que a Casa precisa preencher:**
- a duração dos 55 serviços (sem ela, a agenda não sugere horário livre para aquele serviço);
- a comissão de cada profissional por serviço;
- o horário de quem não segue o da Casa (ter–sáb, 9h–18h);
- o endereço da Casa para a página da cliente;
- o e-mail de cada profissional que vai usar o app.

---

## 1. Entendimento do pedido

| O que foi pedido | O que estamos assumindo |
|---|---|
| Fechar o fluxo do Avec no CRM: agenda, comanda, caixa, comissão e pacotes | A recepção consegue fazer no CRM tudo o que faz todo dia no Avec. A virada (parar de usar o Avec) continua sendo decisão da Casa; até lá os dois convivem |
| App da profissional | Não é app de loja: é o próprio sistema, aberto com o perfil "Profissional" e instalado na tela inicial. Resolve as 4 maiores queixas do Avec PRO: login que cai, aviso que não chega, agenda confusa e comissão que não dá para conferir |
| Área da cliente | Uma página leve, aberta por link e sem login, para a cliente confirmar, remarcar ou cancelar. O link é mandado por uma pessoa; o envio automático fica desligado |
| Não duplicar o que os Lotes 1A, 1B e 1C fazem | A agenda nunca muda etapa do funil por conta própria: chama a função de sincronização do 1C (C8). Autoria, avisos e funil continuam do jeito dos Lotes 1 |
| Construir esta noite | Lotes pequenos, cada um testável e publicável sozinho, na ordem 6A → 6B → 6C → 7A → 7B. O que depende da Casa (duração, comissão, e-mail das profissionais) já fica com tela para preencher |

---

## 2. Onde estamos hoje

| Assunto | Hoje | Onde |
|---|---|---|
| Quem cria horário | **Ninguém cria horário na agenda pelo CRM.** Os 25.280 registros de `appointments` vieram do Avec. Os horários marcados na conversa ficam só no lead (`deals.scheduledAt`): 32 futuros, nenhum com serviço e profissional | `agenda/actions.ts:11`, `updates.ts:140` |
| Conflito | Janela fixa de 1 h, só contra horários marcados em conversas. Ignora os horários do Avec e os bloqueios | `updates.ts:132-158` |
| Serviços | 55, sendo 52 com preço e **0 com duração**. A tela de edição existe | `service-details.ts:17`, `lists.tsx:120` |
| Profissionais | 101 cadastros, 18 ativas, **0 vínculos** de quem faz o quê. Por isso a lista de profissionais do "Agendar" fica vazia | `schema.ts:425`, `schedule-sheet.tsx:34`, `professionals.ts:72` |
| Horário | Só o da Casa (ter–sáb, 9h–18h desde o Lote 0). Nenhuma profissional tem horário próprio, nem no Avec | `hours.ts:7`, `business-hours.ts:5` |
| Bloqueios | 3.934 importados (19 ainda valendo), visíveis na grade. Não dá para criar | `schema.ts:476`, `avec.ts:74` |
| Status do horário | agendado, confirmado, compareceu, faltou, cancelado e espera. Cancelar não tem motivo | `lib/agenda.ts:37`, `appointments.ts:8` |
| Venda | "Fechar venda" aceita 1 serviço e 1 forma de pagamento, sem profissional nem comissão | `updates.ts:199-240` |
| Pacotes | 31 ativos, só para ver | `packages-list.tsx:23` |
| Login | Sessão fixa de 30 dias; nenhum perfil para profissional; `professionals` não tem ligação com `users` | `sessions-store.ts:7`, `permissions.ts:66` |
| Avisos no celular | O push só avisa atraso de conversa. **0 aparelhos inscritos** | `push.ts:32` |
| Confirmação | Lembrete e enquete da véspera existem, desligados, e só olham o horário guardado no lead | `templates.ts:26-46`, `engine.ts:73-77` |
| Avec ligado na Casa | Agendamento online (60 min de antecedência, até 40 dias, cancelamento "até a hora") e **Avec IA confirmando 24 h antes** | `avec-funcionalidades.md` §1 |

---

## 3. Regras que valem para todos os lotes

1. **Migrations só aditivas**, numeradas depois da `0024_funil_novo` do 1C: `0025_agenda_base` (6A), `0026_agenda_viva` (6B), `0027_comanda_caixa` (6C), `0028_app_profissional` (7A) e `0029_area_cliente` (7B). Só `CREATE TABLE`, `ADD COLUMN` (coluna `NOT NULL` só com `DEFAULT`) e `CREATE INDEX`. Qualquer `DROP`, `ALTER COLUMN ... TYPE` ou `SET NOT NULL` gerado pelo drizzle-kit é erro: parar e corrigir. Antes de gerar a primeira migration, trazer a `rodada-2` com o 1C (`git merge rodada-2`) para a numeração não colidir.
2. **Nunca inventar dado.** Duração, preço, comissão, folga e valor por sessão vazios ficam "não informado". A tela pede para preencher. O motor de horários recusa um serviço sem duração em vez de supor 60 min.
3. **Nada sai no WhatsApp sem uma pessoa apertar Enviar.** O lembrete da véspera e o agendamento online nascem desligados. Ligar exige a confirmação de envio real que as automações já usam (`config/send-confirm.tsx`). Em teste, a Evolution aponta para `http://127.0.0.1:9` (`test/setup-env.ts`).
4. **O Avec convive.** A importação continua idempotente, pela mesma chave (`avec:res:…`). Ela nunca altera um registro criado no CRM (chave `crm:…`) e nunca ressuscita o que foi apagado ou cancelado no CRM. Quando o mesmo horário existe nos dois, o do Avec vira "gêmeo" do do CRM (6B).
5. **Nada se apaga.** Cancelar, desistir e tirar bloqueio só marcam a data, quem fez e o motivo. Toda mudança vai para `audit_log` com "de" e "para".
6. **Quem decide é o servidor.** Conflito, permissão, posse do horário (a profissional só mexe nos dela) e regra de cancelamento são conferidos dentro da transação. A tela só mostra.
7. **Fuso:** America/Bahia, UTC−3 fixo, sem horário de verão. Contas de dia e hora usam só as funções de `src/lib/schedule.ts`, `src/lib/agenda.ts` e `src/lib/free-slots.ts`. Nada depende do fuso do aparelho nem do processo. Na tela, `Intl` com `timeZone: "America/Bahia"`. No arquivo de calendário, horário em UTC.
8. **LGPD:** CPF, RG, endereço da cliente e dados bancários nunca entram. A página pública mostra só o primeiro nome. O app da profissional não mostra telefone, e-mail nem valores de outras pessoas. Token público é guardado só como hash.
9. **Tempo real:** um escopo novo, `agenda`, em `src/lib/live-scope.ts`. Os avisos `agenda_alterada` (com `day`) e `caixa_alterado` são emitidos depois do commit, e a Agenda, o Caixa e o app da profissional escutam.
10. **Textos em PT-BR, sem jargão.** Usamos "comanda", que é a palavra que a recepção já usa no Avec, e "Finalizado" para o atendimento concluído (no banco continua `compareceu`, por causa do 1C).
11. **Testes:**
    - Postgres local de pé (`npm run infra:up`). As tabelas novas entram no `truncate` de `test/db.ts` e de `e2e/reset.ts`.
    - Regra pura com teste de unidade; regra com banco com teste de domínio (`resetDb`); fluxo de tela com Playwright nos projetos `desktop` e `celular`.
    - Os testes do motor rodam também com `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`.
12. **Next 16 é diferente** (`AGENTS.md`): antes de criar grupo de rotas, manifest, route handler ou server action em página pública, ler o guia em `node_modules/next/dist/docs/`.
13. **Guardas:** toda tela nova chama `requirePerm`, toda rota e server action nova chama `assertPerm`. As públicas entram nas listas justificadas de `src/server/auth/guard-coverage.test.ts`.
14. **Commits** em PT-BR, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### 3.1 Chaves de configuração (tabela `settings`, sem migration)

| Chave | Valor quando não existe | O que controla | Quem muda |
|---|---|---|---|
| `agenda_modo` | `"consulta"` | `consulta`: como hoje, o CRM não cria ocupação nova (marcar, remarcar, bloquear e pôr na lista de espera são recusados); status, observação, cancelamento e link continuam valendo. `dupla`: tudo ligado, com o lembrete "faça também no Avec". `so_crm`: virada feita, sem o lembrete | Gestão (Configurações › Agenda) |
| `agenda_regras` | `{ "passoMin": 30 }` | Passo da grade e das sugestões | Gestão |
| `caixa_modo` | `"avec"` | `avec`: comanda e caixa do CRM desligados. `crm`: ligados | Gestão (Configurações › Caixa) |
| `caixa_regras` | `{ "exigeCaixaAberto": true }` | Fechar comanda só com caixa aberto | Gestão |
| `app_profissional` | `{ "mostraValorServico": false, "avisaConfirmacao": false }` | O que a profissional vê na comissão; aviso quando a cliente confirma | Gestão |
| `casa_info` | `{ "endereco": null, "whatsapp": null }` | Endereço e WhatsApp da Casa na página da cliente. Sem endereço, a página não mostra "Como chegar" | Gestão |
| `cliente_link` | `{ "cancelarAteHoras": 24, "texto": "<modelo da seção 9.4>" }` | Prazo para a cliente cancelar pelo link e texto que preenche a conversa | Gestão |
| `lembrete_d1` | `{ "enabled": false, "hora": "10:00", "texto": "<modelo>" }` | Lembrete automático na véspera com o link | Gestão, com a confirmação de envio real |
| `agendamento_online` | `{ "enabled": false, "antecedenciaMin": 60, "diasAFrente": 40, "servicos": [], "profissionais": [] }` | Página `/agendar` | Gestão |

O seed **não** grava essas chaves em produção. Em desenvolvimento e no e2e, o `e2e/reset.ts` e os testes gravam `agenda_modo = "dupla"` e `caixa_modo = "crm"` para exercitar tudo.

### 3.2 Permissões novas

| Permissão | Rótulo na tela | Gestão | Atendente e Recepção | Profissional |
|---|---|---|---|---|
| `agenda.marcar` | Marcar, remarcar, cancelar e bloquear na Agenda | obrigatória | sim | — |
| `agenda.encaixar` | Encaixar por cima de outro horário ou fora do horário de trabalho | obrigatória | sim | — |
| `caixa.operar` | Abrir comanda, receber e operar o caixa | obrigatória | sim | — |
| `caixa.gerir` | Reabrir caixa e cancelar comanda fechada | obrigatória | — | — |
| `comissao.ver` | Ver a comissão de todas | obrigatória | — | — |
| `pro.app` | Entrar no app da profissional (só a própria agenda) | opcional | — | sim |
| `pro.ganhos` | Ver os próprios ganhos no app | opcional | — | sim |

- Grupo novo "Agenda e caixa" em `PERM_GROUPS`.
- `pro.app` e `pro.ganhos` entram em `GESTAO_OPTIONAL`, para a Gestão não virar "profissional".
- Perfil de sistema novo: `profissional` ("Profissional"), com `["pro.app", "pro.ganhos"]`.
- **Os perfis Atendente e Recepção que já existem em produção** recebem `agenda.marcar`, `agenda.encaixar` e `caixa.operar` **uma única vez**: o seed guarda em `settings.perfis_permissoes_concedidas` a lista do que já foi dado. Se a gestão tirar depois, o seed não devolve.
- `firstAllowedPath(perms)` passa a mandar quem só tem `pro.app` para `/pro`.

---

## 4. Modelo de dados: visão de conjunto

### 4.1 A visita

Hoje cada horário fica preso ao lead. O desenho do Avec (e o de `avec-engenharia-reversa.md` §3.1) separa:
- **Visita** (`visits`): a cliente vem num dia. Pode ter conversa ligada ou não.
- **Horário** (`appointments`, que já existe): cada serviço da visita, com profissional, início, duração, status e observação.

A visita junta os serviços do mesmo dia (mão e pé, corte e escova), a comanda daquele dia e o link de confirmação: **um link confirma a visita inteira**. Horário que veio do Avec não tem visita até alguém mexer nele no CRM; quando precisa (gerar link, abrir comanda), o sistema cria a visita juntando os horários ativos da mesma cliente naquele dia.

### 4.2 Tabelas e colunas novas

| Migration | Lote | O quê | Para quê |
|---|---|---|---|
| 0025 | 6A | `lists.buffer_min` | Folga depois do serviço |
| 0025 | 6A | `professionals.work_hours`, `color`, `agenda_position` | Horário de trabalho, cor e ordem na agenda |
| 0025 | 6A | `professional_services.source`, `created_at`, `created_by` | Saber se o vínculo veio do histórico do Avec ou foi feito à mão |
| 0025 | 6A | `agenda_blocks.origin`, `reason`, `created_by`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by` | Bloqueio criado, editado e apagado no CRM |
| 0026 | 6B | tabela `visits` | A visita |
| 0026 | 6B | `appointments`: `visit_id`, `buffer_min`, `fit_in`, `fit_in_by`, `outside_hours`, `confirmed_at`, `confirmed_via`, `arrived_at`, `started_at`, `finished_at`, `cancelled_at`, `cancel_reason`, `cancel_note`, `cancelled_by`, `cancelled_via`, `created_by`, `updated_by`, `crm_touched_at`, `avec_twin_of`, `wait_window`, `wait_result_appointment_id` | Ciclo de vida completo, encaixe, gêmeo do Avec e lista de espera |
| 0027 | 6C | tabelas `cash_sessions`, `cash_movements`, `comandas`, `comanda_items`, `comanda_payments`, `client_credit_entries`, `package_defs` | Caixa, comanda, crédito da cliente, pacotes à venda |
| 0027 | 6C | `professional_services.commission_bp`; `client_packages.package_def_id`, `comanda_item_id`, `unit_cents`, `cancelled_at`; `package_uses.comanda_item_id`, `professional_id`, `origin`, `cancelled_at` | Comissão e pacotes vendidos e usados no CRM |
| 0028 | 7A | `professionals.user_id`; tabelas `pro_notifications`, `pro_day_acks`, `client_notes`; `agenda_blocks.request_status`, `requested_by`, `decided_by`, `decided_at`, `decision_note` | Login da profissional, avisos, "vi minha agenda", anotações e pedidos de folga |
| 0029 | 7B | tabela `client_links` | Link da cliente (só o hash) |

### 4.3 Status de um horário

`appointments.status` continua texto validado no domínio. "Finalizado" na tela é `compareceu` no banco, que é o que o 1C lê para levar a conversa a Atendida.

| Status (banco) | Na tela | Entra quando | Quem muda | Ocupa a agenda? |
|---|---|---|---|---|
| `espera` | Na lista de espera | Pedido sem vaga | Recepção | não |
| `solicitado` | Pedido pelo site | Agendamento online (desligado) | Cliente | sim, até a Casa responder |
| `agendado` | Agendado | Marcado | Recepção | sim |
| `confirmado` | Confirmado | Confirmou (link, enquete ou recepção) | Recepção, cliente | sim |
| `chegou` | Chegou | A cliente chegou | Recepção, profissional | sim |
| `em_atendimento` | Em atendimento | A profissional começou | Profissional, recepção | sim |
| `compareceu` | Finalizado | Terminou, ou a comanda foi fechada | Profissional, recepção, comanda | sim |
| `faltou` | Faltou | Não veio (só depois do início) | Recepção; a profissional, só 15 min depois do início | não |
| `cancelado` | Cancelado | Cancelou, com motivo | Recepção, cliente (link) | não |
| `espera_encaixada`, `espera_desistiu` | Saiu da lista | Encaixada ou desistiu | Recepção | não |

"Pago" não é status: aparece o selo R$ quando o horário está numa comanda fechada (6C). Horário do Avec com status desconhecido continua com `avec_status`, como hoje.

Transições permitidas, conferidas no servidor:
- `agendado → confirmado` a qualquer momento antes do início;
- `agendado` ou `confirmado` → `chegou` no dia do horário, a qualquer hora (a cliente pode chegar antes);
- `chegou` → `em_atendimento`; também direto de `agendado` ou `confirmado`, no dia do horário;
- `em_atendimento` ou `chegou` → `compareceu`; direto de `agendado` ou `confirmado` só depois do início (a recepção esqueceu os passos);
- `agendado` ou `confirmado` → `faltou`, só depois do início (a profissional, só 15 min depois);
- `agendado`, `confirmado`, `chegou` ou `solicitado` → `cancelado`, com motivo;
- `solicitado` → `agendado` quando a Casa confirma o pedido do site;
- `espera` → `espera_encaixada` ou `espera_desistiu`;
- "Desfazer" volta ao status anterior no mesmo dia, para quem tem `agenda.marcar`, e fica registrado.

---

## 5. Lote 6A: Base da agenda (tamanho M)

**Objetivo:** ter tudo o que o cálculo de horário livre precisa (duração, quem faz o quê, horário de trabalho, bloqueios) e o próprio cálculo, puro e testado, antes de marcar qualquer coisa.

### 5.1 O que muda para cada pessoa

- **Gestão**, em Configurações:
  - **Serviços** (a tela de Listas › Serviços, que já existe):
    - aviso no topo com a contagem do momento (hoje seria "55 serviços sem duração. Sem a duração, a agenda não sugere horário livre para eles");
    - filtro "Só os sem duração";
    - campo novo "Folga depois (min)", opcional: o tempo para arrumar o posto.
  - **Profissionais**: lista compacta, com as ativas primeiro e as desativadas recolhidas. Cada profissional abre em três partes:
    - **Dados**: apelido, nome completo, cargo, cor (paleta de 12), ordem na agenda e ativa;
    - **Horário de trabalho**: os 7 dias com liga e desliga, "das … às …" e intervalo opcional (até 2 faixas por dia). O botão "Igual ao da Casa" apaga o horário próprio. Sem horário próprio, aparece "Segue o horário da Casa: ter–sáb, 9h–18h";
    - **Serviços que faz**: os serviços marcados e, em destaque, as **sugestões do histórico do Avec** ("fez 14 vezes em 12 meses"), com "Aceitar as sugestões".
  - **Quem faz o quê**: uma matriz profissional × serviço, com as sugestões de todas e "Aceitar todas as sugestões".
  - **Agenda** (tela nova): o modo da agenda (consulta, dupla ou só CRM, explicado na seção 3.1) e o passo da grade.
- **Recepção**, na Agenda:
  - **Bloquear**: escolhe quem (uma profissional ou todas), o dia ou o período, das … às …, se repete em certos dias da semana e o motivo (Almoço, Folga, Atestado, Feriado, Curso ou Outro, com texto). Também edita e apaga bloqueios. Se o bloqueio veio do Avec, a tela lembra: "Enquanto o Avec estiver ligado, apague também lá";
  - na visão Profissionais, o que está fora do horário de trabalho de cada uma aparece hachurado, e a folga do dia inteiro aparece como "Folga" no topo da coluna;
  - **Procurar horário**: escolhe o serviço (e, se quiser, a profissional) e vê os 3 próximos horários livres de cada profissional que faz aquele serviço. "Copiar opções" monta o texto "Tenho quinta, 16/10, às 10h com a Ana ou às 14h30 com a Bia" para colar na conversa. Não marca nada.
- **Profissional e cliente:** nada muda neste lote.

### 5.2 Dados (`0025_agenda_base`)

```sql
alter table lists add column buffer_min smallint;                         -- folga depois; vazio = 0
alter table professionals add column work_hours jsonb;                    -- null = horário da Casa
alter table professionals add column color text;                          -- chave da paleta (ex.: "ameixa")
alter table professionals add column agenda_position integer;             -- ordem na agenda; null = pelo nome
alter table professional_services add column source text not null default 'manual';   -- manual | avec_historico
alter table professional_services add column created_at timestamptz not null default now();
alter table professional_services add column created_by uuid references users(id);
alter table agenda_blocks add column origin text not null default 'avec'; -- avec | crm
alter table agenda_blocks add column reason text;                         -- almoco | folga | atestado | feriado | curso | outro
alter table agenda_blocks add column created_by uuid references users(id);
alter table agenda_blocks add column updated_at timestamptz;
alter table agenda_blocks add column updated_by uuid references users(id);
alter table agenda_blocks add column deleted_at timestamptz;
alter table agenda_blocks add column deleted_by uuid references users(id);
create index agenda_blocks_live_idx on agenda_blocks (starts_on, ends_on) where deleted_at is null;
```

Formato de `work_hours` (validado por `workHoursSchema` em `src/lib/work-hours.ts`): chaves `"0"` (domingo) a `"6"` (sábado). Cada dia é `null` (não trabalha) ou uma lista de 1 ou 2 faixas `["HH:MM", "HH:MM"]`, com início menor que o fim, sem sobreposição e entre 06:00 e 24:00. Exemplo: `{"0": null, "1": null, "2": [["09:00","12:00"],["13:00","18:00"]], "3": [["09:00","18:00"]], …}`. O "intervalo" é o buraco entre as duas faixas.

Bloqueio criado no CRM: `origin = 'crm'` e `external_key = 'crm:blq:<uuid>'`.

### 5.3 Código

| Arquivo | O quê |
|---|---|
| `src/lib/work-hours.ts` (novo, puro) | `workHoursSchema`; `effectiveRanges(day, proHours, casaHours): [number, number][]` (minutos do dia; o horário próprio vence o da Casa); `describeWorkHours()` ("ter–sáb, 9h–18h · igual ao da Casa") |
| `src/lib/free-slots.ts` (novo, puro) | O motor de horários livres (5.4) |
| `src/lib/palette.ts` (novo, puro) | As 12 cores e o contraste com o texto, no claro e no escuro |
| `src/server/domain/agenda/availability.ts` (novo) | Monta o dia de uma profissional a partir do banco (`dayRulesFor`) e responde `checkStartFor` e `nextFreeSlots` |
| `src/server/domain/agenda/blocks.ts` (novo) | `createBlock`, `updateBlock`, `deleteBlock` (marca `deleted_at`), com auditoria |
| `src/server/domain/agenda/who-does-what.ts` (novo) | `suggestProfessionalServices({ since, minCount })` e `acceptSuggestions({ professionalId?, pairs? })` |
| `src/server/domain/professionals.ts` | `setWorkHours`, `setAppearance` (cor e ordem); `listProfessionals` ordena por `agenda_position` e depois pelo nome |
| `src/server/domain/service-details.ts` | `bufferMin` (0 a 120) |
| `src/server/queries/avec.ts:74` | `listAgendaBlocks` passa a ignorar os apagados |
| `src/server/domain/avec/import-agenda.ts:132` | O merge do bloqueio nunca devolve um bloqueio apagado no CRM (`deleted_at` preenchido: nada muda) |
| `scripts/quem-faz-o-que.ts` (novo) | `--dry-run` imprime a matriz sugerida; `--aplicar --backup <arquivo>` grava (5.5) |
| `src/server/domain/agenda/mode.ts` (novo) | `getAgendaMode()` e `assertCanBook()`: no modo consulta, o que cria ocupação nova (bloqueio no 6A; marcar, remarcar e lista de espera no 6B) é recusado com a frase da seção 6.6. Status, observação e cancelamento valem em qualquer modo, como hoje |
| Configurações › Agenda (nova) | Modo da agenda (consulta, dupla, só CRM) e passo da grade |
| `src/lib/permissions.ts`, `src/server/db/seed.ts` | Permissões novas e concessão única (seção 3.2) |
| Telas | `config/profissionais` (lista compacta e as 3 partes), `config/listas` (folga, aviso, filtro), `agenda` (Bloquear, hachura, Procurar horário) |

### 5.4 O motor de horários livres (`src/lib/free-slots.ts`)

É uma função pura. Trabalha só com **minutos do dia em Salvador** (0 a 1440) e nunca com `Date`, por isso não sente fuso, horário de verão nem relógio do aparelho. Quem chama converte com `bahiaParts`, `slotMs` e `minuteOfDay`.

```ts
export type Interval = { start: number; end: number };                       // [start, end), minutos do dia
export type BusyItem = Interval & { id: string; label: string;              // "Paula · Corte"
  unknownDuration?: boolean; fitIn?: boolean; clientId?: string | null };
export type BlockItem = Interval & { id: string; title: string; pending?: boolean };
export type DayRules = { ranges: [number, number][]; blocks: BlockItem[]; busy: BusyItem[] };

export type SlotQuery = {
  durationMin: number | null;      // null → { ok:false, reason:"sem_duracao" } (nunca chutar)
  bufferMin?: number | null;       // folga depois; vazio = 0
  stepMin?: number;                // passo das sugestões (30)
  notBeforeMin?: number | null;    // hoje: agora + antecedência; outros dias: null
  clientId?: string | null;        // conflito com outro horário da mesma cliente
  allowFitIn?: boolean;            // devolve também os horários que só cabem como encaixe
  allowOutsideHours?: boolean;     // devolve também os horários fora do horário de trabalho
};

export type SlotKind = "livre" | "encaixe" | "fora_do_horario";
export type Slot = { start: number; end: number; kind: SlotKind;
  conflicts: { id: string; label: string }[]; warnings: string[] };

export function freeSlots(day: DayRules, q: SlotQuery):
  { ok: true; slots: Slot[] } | { ok: false; reason: "sem_duracao" | "duracao_invalida" | "nao_trabalha" };

export function checkStart(day: DayRules, start: number, q: SlotQuery):
  | { ok: true; kind: SlotKind; conflicts: { id: string; label: string }[]; warnings: string[] }
  | { ok: false; reason: "sem_duracao" | "duracao_invalida" | "passou" | "atravessa_meia_noite" | "bloqueado" | "conflito" | "fora_do_horario";
      conflicts: { id: string; label: string }[]; blockedBy?: string };

export function planVisit(items: { day: DayRules; durationMin: number | null; bufferMin?: number | null; mode: "depois" | "junto" }[],
  start: number, q: Omit<SlotQuery, "durationMin" | "bufferMin">): { start: number; end: number; check: ReturnType<typeof checkStart> }[];
```

O nome `checkStart` evita confusão com `checkSlot` de `src/lib/schedule.ts:22`, que continua servindo ao formulário antigo de Agendar.

Regras do motor:
1. **Ocupação** de um horário candidato = `[início, início + duração + folga)`. A folga só pesa para a profissional; a cliente pode começar outro serviço com outra profissional no fim da duração.
2. **Cabe no horário de trabalho** quando a ocupação inteira está dentro de uma das faixas do dia. Fora disso o horário é `fora_do_horario`: só aparece com `allowOutsideHours` e só pode ser marcado com `agenda.encaixar`.
3. **Bloqueio** que se sobrepõe à ocupação recusa o horário (`bloqueado`). Os intervalos são fechados no início e abertos no fim: terminar às 11:00 e começar às 11:00 não é sobreposição. Pedido de folga ainda não aprovado (`pending`, do 7A) não recusa: vira aviso ("Ana pediu folga nesse horário").
4. **Conflito** = a ocupação se sobrepõe a um horário ocupado da mesma profissional, ou a outro horário da mesma cliente (`clientId`) com qualquer profissional. Com `allowFitIn`, o horário volta como `encaixe`, listando com quem conflita; sem isso, não volta.
5. **Duração desconhecida em horário que já existe** (os do Avec sem "Tempo" e sem duração no serviço): o motor não inventa. O horário ocupa só um passo da grade (`[início, início + passo)`) e todo candidato que começa até 3 h depois, na mesma profissional, ganha o aviso "Ana tem Paula às 10:00 sem duração informada: confira antes".
6. **Duração do serviço vazia** no candidato → `sem_duracao`. A tela pede a duração desta vez (6B), nunca supõe.
7. **Passado e meia-noite:** candidato antes de `notBeforeMin` não volta (`passou`). Ocupação que passa de 1440 é recusada (`atravessa_meia_noite`). Horário existente que atravessa a meia-noite é cortado em 1440 naquele dia e continua no dia seguinte; quem monta o dia faz isso.
8. **Sugestões** começam nos múltiplos do passo, contados da meia-noite (09:00, 09:30…), dentro das faixas, e saem em ordem. `nextFreeSlots` percorre até 14 dias e para nas 3 primeiras de cada profissional.
9. **"Qualquer uma"**: entre as profissionais que fazem o serviço e têm o horário `livre`, ganha a que tem menos horários naquele dia; no empate, a de menor `agenda_position` e depois a do nome.

Como o servidor monta o dia (`dayRulesFor`, em `availability.ts`):
- **Faixas:** `effectiveRanges(dia, professionals.work_hours, settings.business_hours)`.
- **Bloqueios** que valem no dia (`blockAppliesOn`, `src/lib/agenda-blocks.ts:7`), da profissional ou de todas, sem os apagados.
- **Ocupados:**
  - os `appointments` da profissional nos status que ocupam (seção 4.3), sem os gêmeos (`avec_twin_of` preenchido), sem o próprio horário que está sendo remarcado e sem os de "sem hora" do Avec (cancelamento gravado às 00:00);
  - enquanto o script do 6B não migrar os horários antigos, também os leads com `scheduled_at` e `professional_id` e sem horário na agenda.
- **Duração** de cada ocupado: a do horário, senão a do serviço, senão desconhecida (regra 5). Folga: a do horário, senão a do serviço, senão 0.

### 5.5 Regras

- **Horário de trabalho:** sem `work_hours`, vale o da Casa. Com horário próprio, vale o dela, mesmo num dia em que a Casa fecha. Nesse caso a tela pergunta "A Casa não abre na segunda. Ela vai atender mesmo assim?".
- **Bloqueio:**
  - motivo obrigatório; a data final não pode vir antes da inicial nem passar de 366 dias; a hora final vem depois da inicial; "Todas" = `professional_id` vazio;
  - salvar um bloqueio por cima de clientes marcadas **não mexe nelas**: a tela lista quem está dentro ("3 clientes marcadas: Paula 10:00, …") e a recepção remarca no 6B;
  - apagar marca `deleted_at` (vale também para os que vieram do Avec), e a reimportação não traz de volta;
  - criar, editar e apagar bloqueio seguem o modo da agenda: recusado no modo consulta (o Avec ainda é a agenda que a cliente vê no online) e com o lembrete "faça também no Avec" no modo dupla. Horário de trabalho, duração, folga e quem faz o quê podem ser preenchidos em qualquer modo, porque não mudam nada no Avec.
- **Quem faz o quê:**
  - as sugestões saem do relatório "Serviços por profissional" (formato `6f695f67`, guardado em `avec_reports.rows`, com as colunas Profissional, Data Comanda e Serviço; o CPF já foi tirado) e, como reforço, de `sales_items` com `kind = 'servico'` e profissional;
  - o serviço casa pelo nome normalizado (`normText`) com `lists` (tipo serviço, ativo); a profissional casa pelo apelido ou pelo nome completo, como a importação faz;
  - vira sugestão quem fez o serviço 2 vezes ou mais nos últimos 12 meses;
  - aceitar grava com `source = 'avec_historico'` e nunca tira um vínculo feito à mão. Rodar duas vezes não duplica (chave primária).
- **Script `quem-faz-o-que.ts`:** `--dry-run` imprime a matriz (profissional × serviço × vezes) e o que não casou ("serviço não cadastrado: Escova progressiva (12 vezes)"). `--aplicar` exige `--backup <arquivo>` (JSON com os vínculos de antes). Em produção, só com o ok do dono.
- **Cor e ordem:** a cor sai da paleta fechada (`src/lib/palette.ts`); ordem vazia segue o nome.

### 5.6 Erros e casos difíceis

| Caso | O que acontece |
|---|---|
| Serviço sem duração em "Procurar horário" | "Mechas não tem duração cadastrada. Preencha em Configurações › Serviços para ver horários livres." Link direto para o serviço |
| Profissional que não trabalha no dia | Coluna com "Folga" e nenhuma sugestão. Nada quebra |
| Ninguém faz o serviço | "Ninguém está marcado para fazer Mechas. Marque em Configurações › Profissionais." |
| Horário próprio com faixas sobrepostas, fim antes do início ou hora inválida | Recusado, com o dia e a faixa errados escritos |
| Bloqueio do Avec apagado e relatório reimportado | Continua apagado |
| Bloqueio com clientes dentro | Salva e lista as clientes, sem mexer nelas |
| Horário do Avec sem duração na frente do candidato | Aviso do motor (regra 5), sem bloquear |
| Profissional desativada | Sai das sugestões e do "Qualquer uma"; os horários dela continuam na grade |
| Duas pessoas editando o mesmo horário de trabalho | Vale o último salvo; os dois ficam na auditoria |

### 5.7 Segurança

- Configurações (horário, cor, ordem, serviços, quem faz o quê): `config.editar`.
- Bloqueio e "Procurar horário" na Agenda: `agenda.marcar` (o "Procurar horário" só lê, mas fica junto de quem marca).
- `nextFreeSlots` devolve só apelido, horário e o rótulo "ocupado", nunca o nome de outra cliente.

### 5.8 Testes

- **Unidade:**
  - `src/lib/free-slots.test.ts`:
    - dia simples; intervalo de almoço; folga somada;
    - bloqueio de "todas"; pedido de folga pendente que só avisa;
    - conflito com a mesma profissional e com a mesma cliente; encaixe e fora do horário só com as flags;
    - duração desconhecida em horário existente (ocupa um passo e avisa); duração vazia no candidato (`sem_duracao`);
    - passado (`notBeforeMin`); atravessar a meia-noite; passo de 15 e de 30;
    - "qualquer uma" com empate; `planVisit` "depois" e "junto";
    - as mesmas entradas com `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo` dão o mesmo resultado.
  - `src/lib/work-hours.test.ts`: validação; herança da Casa; horário próprio num dia em que a Casa fecha; descrição.
- **Banco:**
  - `availability.test.ts`: monta o dia com horários do Avec e do CRM, gêmeos de fora, lead antigo dentro, cancelado de fora;
  - `blocks.test.ts`: criar, editar e apagar; reimportar o mesmo relatório não devolve o apagado;
  - `who-does-what.test.ts`: linhas sintéticas do formato `6f695f67` e de `sales_items` (nunca dados reais) viram sugestão com 2 ou mais vezes em 12 meses; aceitar é idempotente; vínculo manual nunca sai;
  - `seed`: concessão única das permissões novas.
- **e2e:** Configurações › Profissionais › horário (salvar e "Igual ao da Casa"); Agenda › Bloquear (aparece listrado e some ao apagar); "Procurar horário" → "Copiar opções" (texto na área de transferência).

### 5.9 Desligado até o ok do dono

O script `quem-faz-o-que.ts --aplicar` em produção. Nada neste lote envia mensagem nem muda horário de cliente.

---

## 6. Lote 6B: Agenda viva (tamanho G)

**Objetivo:** a recepção marca, remarca, cancela, confirma e acompanha o atendimento no CRM, com conflito de verdade e ligada ao funil do 1C.

**Depende de:** 6A. Da Tarefa C8 do 1C (`syncContactFunnelTx`, `applyAppointmentTx`), só a parte "ligar ao funil" (6.5); o resto do 6B não depende do 1C.

### 6.1 O que muda para cada pessoa

- **Recepção** (e atendente, que na Casa tem as mesmas permissões):
  - **Marcar**: botão no topo da Agenda, ou tocar num espaço livre da visão Profissionais (já vem com a profissional e a hora). Um formulário só:
    1. **Cliente**: busca por nome ou telefone, mostrando a última visita; "Cliente nova" pede nome e celular;
    2. **Serviços**: um ou mais. Cada um com o serviço (só os que a profissional faz), a profissional ou "Qualquer uma" e a duração (do serviço; se estiver vazia, "Quanto tempo leva desta vez?", com "Salvar como duração do serviço" para quem tem `config.editar`). O segundo serviço entra "logo depois" ou "ao mesmo tempo, com outra profissional";
    3. **Dia e hora**: já preenchidos pela grade, com os 3 próximos horários livres em botões. Embaixo, na hora: "Livre" ou o conflito exato ("Ana já tem Paula das 10:00 às 11:20");
    4. **Observação** deste horário;
    5. **Marcar**. Com conflito, o botão vira "Encaixar mesmo assim" para quem tem `agenda.encaixar`.
  - **No card do horário**: o próximo passo em destaque (Confirmar, Chegou, Iniciar, Finalizar), mais Faltou (depois do início), Remarcar, Cancelar, Observação, Abrir conversa ou Abrir ficha, Abrir comanda (6C) e Copiar link (7B).
  - **Remarcar**: o mesmo formulário com o horário atual, a lista dos próximos livres e o conflito na hora. Remarcar desfaz a confirmação.
  - **Cancelar**: o motivo é obrigatório ("A cliente desmarcou", "A Casa desmarcou", "Não confirmou", "Marcado por engano" ou "Outro", com texto). Visita com vários serviços pergunta "Só este serviço" ou "A visita toda". "Avisar a cliente" abre a conversa com o texto pronto; não envia sozinho.
  - **Lista de espera**: "+ Lista de espera" (cliente, serviço, profissional preferida ou qualquer uma, dia desejado, manhã/tarde/dia todo, observação). Quando um horário é cancelado, a coluna daquele dia mostra "2 na espera querem este horário", e "Encaixar" abre o Marcar já preenchido.
  - **Faixa "Agora"**, logo abaixo do título da Agenda de hoje: quem chega nos próximos 30 min, quem está 10 min atrasada sem "Chegou", quem está na cadeira e quem falta fechar (6C), cada uma com o próximo botão.
  - **Semana por profissional**: uma linha por profissional e uma coluna por dia. Cada célula mostra o número de clientes e as horas marcadas, ou "Folga". Tocar abre o dia.
  - **Buscar cliente na Agenda**: mostra os horários dela (futuros, passados e cancelados), e um toque leva ao dia com o card destacado.
  - **Modo dupla**: a faixa "Enquanto o Avec estiver ligado, marque, remarque e cancele também lá" aparece no formulário e em "Conferir com o Avec" (6.4).
- **Atendente na conversa:** o "Agendar horário" (`client-pane.tsx:254`) abre o mesmo Marcar, já com a cliente e a conversa. A etapa vai para Agendado pelo 1C.
- **Gestão:** tudo isso, mais a lista "Conferir com o Avec". O modo da agenda (Configurações › Agenda) já vem do 6A.
- **Profissional:** recebe os avisos no 7A.
- **Cliente:** nada é enviado.

### 6.2 Dados (`0026_agenda_viva`)

```sql
create table visits (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id),
  client_name text,
  day date not null,                                   -- dia em Salvador
  deal_id uuid references deals(id),
  notes text,
  origin text not null default 'crm',                  -- crm | avec | online
  request_key text,                                    -- idempotência do formulário Marcar
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index visits_request_key_uq on visits (request_key) where request_key is not null;
create index visits_contact_day_idx on visits (contact_id, day);
create index visits_day_idx on visits (day);

alter table appointments
  add column visit_id uuid references visits(id),
  add column buffer_min smallint,
  add column fit_in boolean not null default false,
  add column fit_in_by uuid references users(id),
  add column outside_hours boolean not null default false,
  add column confirmed_at timestamptz, add column confirmed_via text,     -- recepcao | link | enquete
  add column arrived_at timestamptz, add column started_at timestamptz, add column finished_at timestamptz,
  add column cancelled_at timestamptz, add column cancel_reason text, add column cancel_note text,
  add column cancelled_by uuid references users(id), add column cancelled_via text,  -- recepcao | link | avec
  add column created_by uuid references users(id), add column updated_by uuid references users(id),
  add column crm_touched_at timestamptz,                                  -- mexido no CRM: a importação não toca mais
  add column avec_twin_of uuid references appointments(id),
  add column wait_window text,                                             -- manha | tarde | dia
  add column wait_result_appointment_id uuid references appointments(id);
create index appointments_pro_starts_idx on appointments (professional_id, starts_at);
create index appointments_visit_idx on appointments (visit_id);
create index appointments_contact_starts_idx on appointments (contact_id, starts_at);
create index appointments_twin_idx on appointments (avec_twin_of) where avec_twin_of is not null;
```

- Horário criado no CRM: `id` gerado no app (`crypto.randomUUID()`), `external_key = 'crm:' || id`, `origin = 'crm'`, e preço e duração copiados do serviço na hora de marcar.
- `cancel_reason` aceita: `cliente_desmarcou`, `casa_desmarcou`, `nao_confirmou`, `engano`, `remarcado`, `recusado` (pedido do site recusado) e `outro`.

### 6.3 Código

| Arquivo | O quê |
|---|---|
| `src/server/domain/agenda/visits.ts` (novo) | `createVisit`, `rescheduleAppointment`, `cancelAppointments`, `updateAppointmentNotes`, `ensureVisitFor(appointmentId)` |
| `src/server/domain/appointments.ts:15` | `setAppointmentStatus` vira a porta única de status, com a tabela de transições (4.3), carimbos (`arrived_at`…), auditoria e o gancho do funil. Mantém o nome e a assinatura que o 1C (C8) usa |
| `src/server/domain/agenda/waitlist.ts` (novo) | `addToWaitlist`, `resolveWaitlist`, `waitlistMatchesFor(day, professionalId?, serviceId?)` |
| `src/server/domain/agenda/twins.ts` (novo) | `pairAvecTwins(tx, { from })` e `listAvecDivergences(range)` |
| `src/server/domain/agenda/locks.ts` (novo) | `lockAgendaTx(tx, { professionalIds, contactId, days })`: `pg_advisory_xact_lock` por profissional e dia e por cliente e dia, sempre na mesma ordem (evita impasse) |
| `src/server/domain/avec/apply.ts:94` | Depois de importar reservas, chama `pairAvecTwins` |
| `src/server/domain/avec/import-agenda.ts:19` | `mergeAppointment` pula horários mexidos no CRM (6.4, regra 15) |
| `src/server/queries/agenda.ts:29` | Sem gêmeos; com os status novos; o horário ligado a um lead aparece **como horário** (e o lead some), o contrário de hoje (`queries/agenda.ts:57-60`); campos `visitId`, `paid` (6C), `firstVisit`, `anyPro` e `fitIn` |
| `src/server/queries/agenda-week.ts` (novo) | Semana por profissional |
| `src/lib/agenda.ts:37` | `AgendaStatus` e `STATUS_LABEL` com chegou, em atendimento e "Finalizado"; `appointmentAgendaStatus` só pede conferência para agendado e confirmado que já passaram |
| `src/lib/live-scope.ts:13` | Escopo `agenda` e o aviso `agenda_alterada` |
| `src/app/(app)/agenda/actions.ts` | `createVisitAction`, `rescheduleAction`, `cancelAction`, `setStatusAction` (amplia a atual), `notesAction`, `waitlistAction`, `freeSlotsAction`, `searchClientsAction` |
| Componentes | `agenda/booking-sheet.tsx` (Marcar e Remarcar), `cancel-sheet.tsx`, `waitlist-sheet.tsx`, `now-strip.tsx`, `week-by-pro.tsx`, `agenda-search.tsx`, `avec-divergences.tsx`; `pro-grid.tsx` (tocar no livre, hachura, selos, cabeçalho com "6 clientes · 5h30"); `entry-sheet.tsx` (ações novas); `queue/client-pane.tsx` passa a abrir o `BookingSheet` no lugar do `ScheduleSheet` |
| `scripts/migrar-agendados-para-agenda.ts` (novo) | Leva os horários que estão só no lead para a agenda (6.5) |

### 6.4 Regras

1. **Uma porta para cada mudança.** Marcar, remarcar, cancelar e mudar status passam só pelas funções da seção 6.3. Cada uma, numa transação:
   1. confere a permissão e, quando a mudança cria ocupação nova (marcar, remarcar, lista de espera), o modo da agenda;
   2. trava a agenda (`lockAgendaTx`);
   3. relê o banco e roda o motor (`checkStartFor`);
   4. grava e audita;
   5. chama o gancho do funil (6.5);
   6. depois do commit, emite `agenda_alterada`. Os avisos para a profissional entram no 7A.
2. **Idempotência:** o formulário Marcar gera uma `request_key` ao abrir. Mandar duas vezes devolve a mesma visita.
3. **Conflito:** quem decide é o servidor, com o motor do 6A e o banco relido depois da trava. Com conflito e sem `agenda.encaixar`, recusa com o texto do conflito. Com a permissão e "Encaixar mesmo assim", grava `fit_in = true` e `fit_in_by`. Fora do horário de trabalho é igual, com `outside_hours`.
4. **Profissional e serviço:** a profissional precisa estar ativa e fazer o serviço (`assertProfessionalFor`, `professionals.ts:72`). Quem tem `config.editar` pode marcar "Ela faz esse serviço" ali mesmo, o que grava o vínculo.
5. **Duração:** do serviço; se estiver vazia, a recepção digita a desta vez (de 5 em 5 min, até 720). Sem duração não se marca.
6. **Cliente:**
   - telefone já cadastrado reaproveita o contato (nunca duplica);
   - contato marcado "Não é cliente" volta a ser cliente (como `createManualLead`, `updates.ts:186`);
   - cliente nova exige nome e celular.
7. **Mesma visita:** todos os serviços no mesmo dia. "Logo depois" começa no fim do anterior; "ao mesmo tempo" começa junto, e as profissionais precisam ser diferentes.
8. **Início:** a partir de 15 min atrás. "Encaixe agora" (a cliente chegou sem hora) cria já com status `chegou`. Lançar atendimento mais antigo fica para depois.
9. **Remarcar** muda o mesmo registro (início, profissional, duração), volta para `agendado` e apaga `confirmed_at`. A auditoria guarda o de-para, e o link da cliente mostra o horário novo (7B).
10. **Cancelar** grava motivo, quem e por onde, e nunca apaga. A comanda aberta da visita perde o item daquele horário (6C).
11. **Gêmeos do Avec**, a cada importação, para cada reserva do Avec que **acabou de entrar**:
    - se já existe outro horário ativo (de qualquer origem: criado no CRM ou vindo do Avec e mexido aqui) com a **mesma cliente** (pelo contato; sem contato, pelo nome normalizado), o **mesmo início** e o **mesmo serviço** (pelo `service_id`; sem ele, pelo nome normalizado), a reserva nova vira gêmea dele (`avec_twin_of`);
    - serviços diferentes no mesmo horário (mão e pé) **não** são gêmeos;
    - o gêmeo some da grade, não ocupa horário, não entra no funil e nunca muda o horário do CRM. Se no Avec ele está pago ou cancelado, isso só aparece em "Conferir com o Avec".
12. **Conferir com o Avec** (lista de divergências, só leitura):
    - mesma cliente, mesmo dia e mesmo serviço, com horários diferentes nos dois sistemas (remarcado só de um lado);
    - gêmeo com status diferente;
    - horário do Avec criado depois da troca para o modo `so_crm`.

    A recepção decide o que fazer. O sistema não corrige sozinho.
13. **Lista de espera:**
    - o pedido fica como `espera`, no dia desejado, às 00:00 (como o importado);
    - "Encaixar" cria o horário novo e muda o pedido para `espera_encaixada`, com `wait_result_appointment_id`; "Desistiu" muda para `espera_desistiu`;
    - a reimportação nunca devolve o pedido para `espera`: pedido mexido no CRM não é tocado pela importação (regra 15).
14. **Desativar profissional com horários futuros** é recusado com a lista ("Ela tem 5 horários marcados: remarque antes"). A gestão pode desativar mesmo assim, e fica registrado.
15. **A importação não mexe em horário que já foi mexido no CRM.** Toda mudança feita aqui (recepção, profissional ou link da cliente) grava `crm_touched_at`. O merge da importação (`mergeAppointment`, `import-agenda.ts:19`) pula as linhas com `crm_touched_at` preenchido: nem status, nem observação, nem profissional. Só grava em `avec_status` o que o Avec diz agora, e a diferença aparece em "Conferir com o Avec". Sem isso, um status novo do CRM (`chegou`, `espera_encaixada`) valeria 0 no `RANK` (`import-agenda.ts:15`) e seria sobrescrito, e um "Cancelado" do Avec (que no Avec também é o jeito de remarcar) desfaria um "Chegou" daqui. Horários nunca mexidos no CRM seguem a regra de hoje: o status só sobe.
16. **Mexer num horário que veio do Avec** (remarcar, cancelar, mudar status, observação) é permitido no modo dupla, no próprio registro, e a partir daí ele é do CRM (regra 15).

### 6.5 Ligação com a conversa e o funil (sem duplicar o 1C)

- O 6B **nunca muda etapa**. Depois de marcar, remarcar, cancelar ou mudar status, chama, na mesma transação, `syncContactFunnelTx(tx, contactId, now)` do 1C (Tarefa C8). Essa função já:
  - leva a conversa para Agendado com a data do horário mais próximo;
  - liga o horário ao lead;
  - cria a conferência de comparecimento;
  - leva a Atendida quando o horário vira `compareceu`, e a Aguardando cliente, com "Remarcar", quando faltou ou cancelou;
  - respeita a decisão 4 do dono: só conversas dos últimos 30 dias.
- Marcar de dentro da conversa grava `visits.deal_id`. O resto é com o 1C.
- O 1C precisa ignorar gêmeos e os status novos: `syncFunnelFromAgenda` e `syncContactFunnelTx` passam a filtrar `avec_twin_of is null` e a tratar `chegou` e `em_atendimento` como "ainda vai acontecer". **É o único ponto em que o 6B mexe em código do 1C**, e ele entra junto com o merge.
- **Os horários que estão só no lead** (32 hoje) vão para a agenda pelo `scripts/migrar-agendados-para-agenda.ts`:
  - `--dry-run` lista cada um: cliente, data, serviço e profissional (se houver) e se já existe horário igual;
  - `--aplicar --backup <arquivo>` cria a visita e o horário (`origin = 'crm'`, duração do serviço ou vazia), sem mudar a etapa;
  - em produção, só com ok.
- O `scheduleDeal` (`updates.ts:140`) continua existindo para quem ainda chama, mas a tela deixa de usar.

### 6.6 Erros e casos difíceis

| Caso | O que acontece |
|---|---|
| Duas pessoas marcando a mesma profissional no mesmo horário | A trava faz uma esperar a outra. A segunda vê "Esse horário acabou de ser ocupado (Cati marcou Paula às 10:02). Escolha outro." |
| O mesmo formulário enviado duas vezes | Uma visita só |
| Horário criado no CRM e o mesmo chegando do Avec | Vira gêmeo (6.4, regra 11) |
| Serviço sem duração | Pede a duração desta vez; sem ela, não marca |
| Profissional sem horário de trabalho no dia | "Fora do horário de trabalho"; só encaixa quem tem `agenda.encaixar`, e fica registrado |
| Passa da meia-noite | Recusado: "Esse horário passa da meia-noite" |
| A cliente já tem outro horário que se sobrepõe | "Paula já tem Escova às 10:00 com a Bia" (encaixe só com permissão) |
| Remarcar horário do Avec no modo dupla | Permitido, com a faixa "mude também no Avec" |
| Modo consulta | Marcar, remarcar, bloquear e pôr na lista de espera são recusados no servidor: "A agenda do CRM está só para consulta. A gestão muda em Configurações › Agenda." Status, observação e cancelamento continuam, como hoje, com o lembrete "faça também no Avec" no cancelamento |
| "Encaixar" da lista de espera num horário que acabou de ser ocupado | Cai no conflito normal |
| Finalizar sem ter marcado "Chegou" | Permitido depois do início; grava os dois carimbos com a mesma hora |
| Faltou antes da hora | Recusado: "Só dá para marcar falta depois do horário" |
| Cancelar visita com comanda fechada | Recusado: "Essa visita já foi paga. Cancele a comanda antes (gestão)" |
| Horário do Avec cancelado "sem hora" (00:00) | Não aparece na grade, não ocupa horário, não pode ser remarcado |
| Marcar no CRM um horário que já veio do Avec (mesma cliente, início e serviço) | Não cria outro: "Paula já tem Corte às 10:00 (veio do Avec). Abrir o horário" leva ao registro que existe |
| Relatório do Avec chegando depois de o CRM marcar "Chegou" (ou com o horário cancelado lá) | O registro do CRM fica como está; a diferença vai para "Conferir com o Avec" (6.4, regra 15) |

### 6.7 Segurança

- Escrever na agenda: `agenda.marcar`. Encaixe e fora do horário: `agenda.encaixar`. Ver a agenda: `atendimento.ver`, como hoje.
- `searchClientsAction` devolve nome, telefone formatado e última visita, só para quem tem `atendimento.ver`.
- As ações nunca recebem quem é o autor da tela: o autor é sempre a pessoa da sessão.

### 6.8 Testes

- **Banco** (`src/server/domain/agenda/*.test.ts`):
  - marcar 1 e 2 serviços ("depois" e "junto");
  - conflito com horário do CRM, do Avec, com bloqueio e com a mesma cliente;
  - encaixe só com permissão; fora do horário;
  - **duas transações em paralelo** (`Promise.all`) no mesmo horário: uma passa, a outra recebe o conflito; mesma `request_key` duas vezes;
  - remarcar desfaz a confirmação;
  - cancelar com motivo; desfazer;
  - lista de espera → encaixar;
  - gêmeos na importação (mesma cliente e início) e divergência (outro horário);
  - modo consulta recusa marcar, remarcar e lista de espera, e deixa mudar status e cancelar;
  - o gancho do funil chamado em cada caso (Agendado, Atendida, Aguardando), com as funções do 1C;
  - script de migração dos agendados: ensaio e aplicar, idempotente.
- **Unidade:** transições permitidas (tabela 4.3); `STATUS_LABEL`; `appointmentAgendaStatus` com os status novos.
- **e2e:**
  - `desktop`:
    - tocar no livre → Marcar → aparece na coluna;
    - conflito escrito e "Encaixar mesmo assim";
    - Chegou → Iniciar → Finalizar;
    - cancelar com motivo;
    - lista de espera → Encaixar;
    - semana por profissional;
  - `celular`: Marcar pela lista do dia e buscar cliente;
  - conversa: "Agendar horário" abre o Marcar e a etapa vira Agendado.

### 6.9 Desligado até o ok do dono

- **Em produção, o modo da agenda continua "consulta"** até o dono escolher "dupla" ou "só CRM".
- O script `migrar-agendados-para-agenda.ts --aplicar`.

---

### 6.10 Decisão do dono (15/10, 9h): Agenda no modelo "B · lista ao lado" e cadastro da profissional com foto

O dono viu dois protótipos e escolheu o **B**. Protótipos de referência (HTML, abrir no navegador só para olhar; nomes fictícios): `docs/prototipos/agenda-opcao-b.dc.html` e `docs/prototipos/cadastro-profissional.dc.html`. Isto entra no 6B e substitui a fileira de nomes em maiúsculas que existe hoje.

**Agenda (dia):**
- À esquerda, a lista "Profissionais": foto (ou as iniciais num círculo com a cor dela), nome na agenda em letra normal (não maiúsculas), o que está fazendo agora ("Atendendo Júlia até 10:30", "Livre até 10:00", "Folga hoje", "Fora do horário") e quantos horários tem no dia. Busca por nome no topo da lista.
- O primeiro item é **"Casa Fiaes"**: mostra todas que trabalham no dia, em colunas (é a visão geral da Casa). Quem está de folga fica no fim da lista, apagada, e não vira coluna.
- Tocar numa profissional mostra só a dela; tocar em mais de uma mostra **até 4 lado a lado** (a quinta troca a mais antiga). Tocar em "Casa Fiaes" volta para todas. A escolha fica na URL (`?p=ana,bruna`), para recarregar e compartilhar.
- À direita, a grade do dia: cabeçalho de cada coluna com a foto pequena, o nome e a quantidade; linha do "agora" em dourado; horários com a cor clara da profissional, o status em selo e cliente + serviço.
- Celular: a lista vira uma faixa de fotos rolável no topo (Casa Fiaes primeiro), e a grade mostra uma profissional por vez com deslizar para o lado.
- Semana: com uma profissional escolhida, a semana dela; com "Casa Fiaes", a semana com a contagem por dia e por profissional.

**Foto da profissional:**
- Coluna nova `professionals.photo_path` (texto, anulável) na migration do 6B. Arquivo no `MEDIA_DIR` (fora da pasta da versão), como as fotos de contato; aceita jpg, png e webp até 5 MB; o servidor guarda uma versão quadrada pequena para lista e cabeçalho. Rota de envio com `assertPerm` (gestão ou quem tem `agenda.marcar`), sem expor caminho do disco.
- Aparece na lista da Agenda, no cabeçalho das colunas, no painel do horário, no cadastro e no app da profissional (7A).

**Configurações › Profissionais (refeita, no lugar do paredão de serviços):**
- À esquerda, as ativas (foto, nome, "Cargo · N serviços") e "Desativadas · N" recolhido. Botão "+ Adicionar profissional".
- À direita, a ficha da profissional escolhida, em blocos:
  1. Foto grande com "Enviar foto" e "Tirar foto" (no celular abre a câmera: `<input type="file" accept="image/*" capture="user">`);
  2. Nome na agenda, cargo, nome completo (liga com as vendas do Avec), e-mail para o app dela (7A), cor na agenda (a paleta do 6A);
  3. Dias e horário de trabalho: dias como botões (Seg a Dom) e "Entra / Sai / Almoço de–até"; sem mudar nada, segue a Casa (ter–sáb, 9h–18h), dito na tela;
  4. Serviços que faz: agrupados por categoria, com busca e caixa de marcar; o aviso "O Avec mostra que ela fez mais N serviços este ano" com "Ver e marcar" (as sugestões do 6A);
  5. Salvar e Desativar no fim.
- Testes: unidade da regra "até 4 lado a lado" e da URL; domínio do envio de foto (tipo, tamanho, permissão); e2e da Agenda (Casa Fiaes → uma → duas → volta) e do cadastro (enviar foto e ver na Agenda), no desktop e no celular.


### 6.11 Decisão do dono (15/10, ~10h): preferência pela profissional

Todo horário diz se a cliente **escolheu a profissional** ou **tanto faz** (como o Avec: Preferencial × Sem preferência).
- Coluna aditiva `appointments.preference` (texto: `escolhida` | `sem_preferencia` | null = não informado), na migration do 6B. Importação do Avec: preenche quando o relatório trouxer o tipo (formato e30391f0: Preferencial → escolhida, Sem Preferência → sem_preferencia; os outros tipos ficam null, sem inventar).
- Ao marcar (BookingSheet): escolha obrigatória entre "Ela quer a [profissional]" e "Tanto faz quem atende". Com "tanto faz", o sistema sugere a primeira profissional livre que faz o serviço e o horário pode ser trocado de profissional sem perguntar à cliente; com "escolhida", trocar a profissional pede confirmação ("ela pediu a Ana").
- Na Agenda (grade, lista e app da profissional): selo pequeno e distinto — coração/estrela "Pediu ela" para escolhida; "Tanto faz" em cinza; nada quando não informado. Filtro na Agenda e nas tabelas/relatórios: Escolhida · Tanto faz · Não informado.
- Relatório (Lote 3, quando juntar): % de horários com preferência por profissional (mostra quem tem clientela fiel).
- Testes: domínio (sugestão automática só em "tanto faz"; troca de profissional exige confirmação em "escolhida"; importação mapeia só os dois tipos), e2e marcar com cada opção e ver o selo.


## 7. Lote 6C: Comanda, caixa e comissão (tamanho G)

**Objetivo:** a conta da cliente nasce do horário e fecha no caixa do dia, com a comissão congelada no fechamento, e os pacotes são vendidos e usados pela comanda. **Construído e desligado** (`caixa_modo = "avec"`) até a Casa decidir levar o caixa para o CRM.

**Depende de:** 6B (visita e status).

### 7.1 O que muda para cada pessoa

- **Recepção** (`caixa.operar`):
  - **Abrir comanda** no card do horário ou na faixa "Agora". A comanda já vem com os serviços da visita do dia, cada um com profissional e preço do serviço. Preço vazio: a recepção digita. Dá para:
    - somar serviço extra, produto (nome e preço digitados), venda de pacote e sessão de pacote;
    - dar desconto no item (R$ ou %) ou na comanda inteira;
    - mudar profissional e quantidade.
  - **Receber**: várias formas na mesma comanda (Pix, crédito com número de parcelas, débito, dinheiro e crédito da cliente). Dinheiro a mais vira troco, e "Guardar o troco como crédito da cliente" é opcional. "Finalizar" fecha a comanda, os horários da visita viram Finalizado e aparece o selo R$ na agenda.
  - **Caixa do dia** (menu "Caixa"):
    - Abrir caixa, com o troco inicial;
    - Sangria e Suprimento, com motivo;
    - comandas abertas e fechadas do dia;
    - Fechar caixa: para cada forma, o valor do sistema ao lado do valor contado, e a diferença.
  - **Comanda avulsa** (venda sem horário): pelo Caixa.
- **Gestão** (`caixa.gerir`, `comissao.ver`, `config.editar`):
  - comissão em % por profissional e serviço, na matriz "Quem faz o quê" do 6A, com "aplicar à categoria". Fica vazia até a Casa preencher;
  - relatório **Comissão** por período: por profissional, com as linhas, a base, o % e o valor. "Sem regra" aparece separado;
  - histórico de caixas, com reabrir;
  - cancelar comanda fechada (com motivo; desfaz pacote, crédito e comissão);
  - **Pacotes à venda** (nome, preço, validade, serviços × sessões e valor por sessão opcional) e "dar novo prazo" a um pacote vencido.
- **Profissional:** vê a própria comissão no 7A.
- **Cliente:** nada (recibo fica para depois).

### 7.2 Dados (`0027_comanda_caixa`)

```sql
create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  status text not null default 'aberto',                 -- aberto | fechado
  opening_cents integer not null default 0,
  opened_by uuid not null references users(id), opened_at timestamptz not null default now(),
  closed_by uuid references users(id), closed_at timestamptz,
  expected jsonb, counted jsonb, difference_cents integer, notes text,
  reopened_by uuid references users(id), reopened_at timestamptz
);
create unique index cash_sessions_one_open on cash_sessions ((true)) where status = 'aberto';   -- um caixa da Casa aberto por vez

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references cash_sessions(id),
  kind text not null,                                    -- sangria | suprimento
  value_cents integer not null check (value_cents > 0),
  reason text not null,
  created_by uuid not null references users(id), created_at timestamptz not null default now(),
  cancelled_at timestamptz, cancelled_by uuid references users(id)
);

create table package_defs (
  id uuid primary key default gen_random_uuid(),
  name text not null, price_cents integer, validity_days integer,
  items jsonb not null,                                  -- [{ serviceId, sessions, unitCents|null }]
  active boolean not null default true,
  created_by uuid references users(id), created_at timestamptz not null default now()
);

create table comandas (
  id uuid primary key default gen_random_uuid(),
  day date not null, number integer not null,            -- "Comanda 12 de 16/10"
  contact_id uuid references contacts(id), client_name text,
  visit_id uuid references visits(id),
  status text not null default 'aberta',                 -- aberta | fechada | cancelada
  discount_cents integer not null default 0,
  subtotal_cents integer, total_cents integer, paid_cents integer, change_cents integer,
  cash_session_id uuid references cash_sessions(id),
  request_key text,
  opened_by uuid not null references users(id), opened_at timestamptz not null default now(),
  closed_by uuid references users(id), closed_at timestamptz,
  cancelled_by uuid references users(id), cancelled_at timestamptz, cancel_reason text,
  notes text, updated_at timestamptz not null default now()
);
create unique index comandas_day_number_uq on comandas (day, number);
create unique index comandas_open_visit_uq on comandas (visit_id) where status = 'aberta' and visit_id is not null;
create unique index comandas_request_key_uq on comandas (request_key) where request_key is not null;

create table comanda_items (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references comandas(id),
  kind text not null,                                    -- servico | produto | pacote_venda | pacote_sessao
  label text not null,
  service_id uuid references lists(id), appointment_id uuid references appointments(id),
  professional_id uuid references professionals(id),
  qty numeric not null default 1,
  unit_cents integer,                                    -- null = preço não informado: não fecha
  discount_cents integer not null default 0,
  total_cents integer,
  client_package_id uuid references client_packages(id), -- sessão usada
  package_def_id uuid references package_defs(id),      -- pacote vendido
  commission_bp integer, commission_base_cents integer, commission_cents integer,   -- retrato no fechamento
  added_by uuid references users(id), added_via text not null default 'recepcao',   -- recepcao | profissional
  created_at timestamptz not null default now(),
  cancelled_at timestamptz, cancelled_by uuid references users(id)
);
create index comanda_items_comanda_idx on comanda_items (comanda_id);
create index comanda_items_pro_idx on comanda_items (professional_id, created_at);

create table comanda_payments (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references comandas(id),
  method text not null,                                  -- pix | credito | debito | dinheiro | credito_cliente
  value_cents integer not null check (value_cents > 0),
  installments smallint,
  created_by uuid not null references users(id), created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table client_credit_entries (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id),
  delta_cents integer not null check (delta_cents <> 0),
  reason text not null,                                  -- troco | pagamento | estorno | ajuste | saldo_avec
  comanda_id uuid references comandas(id), note text,
  created_by uuid references users(id), created_at timestamptz not null default now()
);
create index client_credit_contact_idx on client_credit_entries (contact_id);

alter table professional_services add column commission_bp integer check (commission_bp between 0 and 10000);  -- 4000 = 40%
alter table client_packages add column package_def_id uuid references package_defs(id),
  add column comanda_item_id uuid references comanda_items(id), add column unit_cents integer, add column cancelled_at timestamptz;
alter table package_uses add column comanda_item_id uuid references comanda_items(id),
  add column professional_id uuid references professionals(id), add column origin text not null default 'avec', add column cancelled_at timestamptz;
```

- Chaves dos registros criados no CRM: pacote vendido `crm:pac:<item>:<serviço>`; sessão usada `crm:uso:<item>`.
- Saldo da cliente = soma de `client_credit_entries.delta_cents`.

### 7.3 Código

| Arquivo | O quê |
|---|---|
| `src/lib/comanda-math.ts` (novo, puro) | Totais, desconto da comanda rateado pelos itens (a sobra do arredondamento vai para o maior item), troco, comissão (`arredonda(base × bp / 10000)`, meio centavo para cima), conferência do caixa |
| `src/server/domain/caixa/cash.ts` | `openCash`, `addMovement`, `closeCash`, `reopenCash`, `cashSummary` |
| `src/server/domain/caixa/comandas.ts` | `openComandaForVisit`, `openWalkInComanda`, `addItem`, `updateItem`, `removeItem`, `addPayment`, `removePayment`, `closeComanda`, `cancelComanda` |
| `src/server/domain/caixa/commission.ts` | `setCommission`, `applyCommissionToCategory`, `commissionReport({ from, to, professionalId? })` |
| `src/server/domain/caixa/packages.ts` | `savePackageDef`, `extendPackage`; venda e baixa de sessão chamadas pelo fechamento da comanda |
| `src/server/domain/caixa/credits.ts` | `creditBalance(contactId)`, lançamentos com trava por cliente |
| `src/server/domain/caixa/mode.ts` | `getCaixaMode()`, `assertCaixaOn()` |
| `src/app/(app)/caixa/*` (novo) | `page.tsx` (Hoje), `fechamentos/page.tsx`, `comissao/page.tsx`, `pacotes/page.tsx`, `actions.ts` |
| Componentes | `caixa/comanda-sheet.tsx`, `payment-panel.tsx`, `cash-close-sheet.tsx`, `movement-sheet.tsx`, `commission-table.tsx`, `package-def-editor.tsx`; selo R$ e "falta fechar" no card e na faixa "Agora" |
| `src/components/shell/sidebar.tsx:26` | Item "Caixa" para quem tem `caixa.operar`, só no modo `crm` |

### 7.4 Regras

1. **Uma comanda aberta por visita.** "Abrir comanda" num horário com visita aberta reaproveita a mesma. Os horários da visita entram como itens de serviço (preço do serviço, profissional do horário, `appointment_id`). Horário marcado depois entra com "Juntar horário de hoje".
2. **Preço:** vem do serviço e pode ser mudado no item. Sem preço, a recepção digita; item com preço vazio impede fechar ("Falta o preço de Mechas").
3. **Profissional:** obrigatória em serviço e em sessão de pacote. Em produto é opcional (não há comissão de produto nesta versão).
4. **Desconto:** no item e na comanda. O total nunca fica negativo.
5. **Pagamento:**
   - a soma precisa bater com o total para fechar;
   - só o dinheiro pode passar (a diferença vira troco);
   - "crédito da cliente" não passa do saldo (trava por cliente);
   - "Guardar troco como crédito" lança `+troco` em vez de devolver o dinheiro.
6. **Caixa:**
   - fechar comanda exige caixa aberto (`exigeCaixaAberto`). Sem caixa, a tela oferece "Abrir o caixa de hoje" (com o troco inicial);
   - existe um caixa da Casa aberto por vez;
   - a sangria só sai se houver dinheiro suficiente ("No caixa há R$ 80,00 em dinheiro");
   - no fechamento, o sistema calcula o esperado de cada forma. Dinheiro esperado = troco inicial + recebido em dinheiro − troco devolvido + suprimentos − sangrias;
   - a recepção digita o contado (dinheiro é obrigatório) e a diferença fica registrada;
   - com comandas abertas, o fechamento avisa ("3 comandas abertas ficam para o próximo caixa"), mas deixa fechar.
7. **Fechar a comanda**, numa transação só (comanda `FOR UPDATE`):
   - confere a regra 5;
   - congela a comissão de cada item. A base é o total do item menos a parte dele no desconto da comanda; o % vem de `professional_services.commission_bp`. Sem regra, a comissão fica vazia e o item aparece como "sem regra". Na sessão de pacote, a base é `client_packages.unit_cents × qtd`; vazio = "valor da sessão não definido";
   - venda de pacote: cria as linhas de `client_packages` (`origin = 'crm'`, validade = dia + `validity_days`). Nada é criado antes de fechar;
   - sessão de pacote: conferida de novo com `FOR UPDATE`, `used_sessions += qtd` e uma linha em `package_uses` (`origin = 'crm'`);
   - os horários da visita em agendado, confirmado, chegou ou em atendimento viram `compareceu`, pela porta única do 6B (que chama o funil);
   - liga a comanda ao caixa aberto e a numera (número do dia, com trava por dia).
8. **Cancelar comanda fechada** (só `caixa.gerir`):
   - motivo obrigatório;
   - só com o caixa daquele dia aberto (senão, "Reabra o caixa de 15/10 primeiro");
   - desfaz pacotes vendidos (`cancelled_at`), sessões usadas (`used_sessions −=`, `cancelled_at` no uso), crédito (estorno) e comissão (itens cancelados);
   - os horários **não** voltam de status sozinhos.
   - Para corrigir, "Reabrir para corrigir" cancela e abre uma comanda nova com os mesmos itens.
9. **Pacote vencido:** a sessão é recusada ("venceu em 03/10"), e só a gestão dá novo prazo (`extendPackage`, com auditoria).
10. **Pacotes do Avec** (31 ativos) continuam valendo para baixa no CRM. O valor por sessão vem vazio, então a comissão dessas sessões fica "valor da sessão não definido" até a gestão preencher.
11. **Modo `avec`:** o menu Caixa some e as ações de comanda e caixa são recusadas ("O caixa ainda é no Avec"). Cadastro de pacote e comissão continuam disponíveis, para a Casa preparar.

### 7.5 Erros e casos difíceis

| Caso | O que acontece |
|---|---|
| Duas pessoas fechando a mesma comanda | A segunda vê "Essa comanda acabou de ser fechada por Cati" |
| A última sessão do pacote usada em duas comandas ao mesmo tempo | `FOR UPDATE` no pacote: a segunda vê "O pacote de Paula não tem mais sessões" |
| Crédito da cliente usado em duas comandas | Trava por cliente: o saldo nunca fica negativo |
| Desconto maior que o total | Recusado |
| Fechar sem caixa aberto | Pede para abrir |
| Regra de comissão mudou depois | Não mexe no que já fechou (retrato) |
| Profissional desativada | O relatório continua mostrando o que ela fez |
| Item de horário cancelado com a comanda aberta | O item sai sozinho |
| Comanda avulsa sem cliente | "Cliente de balcão" (nome livre) |
| Troco em forma que não é dinheiro | Recusado: "Só o dinheiro pode passar do total" |

### 7.6 Segurança

- Operar: `caixa.operar`. Reabrir e cancelar: `caixa.gerir`. Comissão de todas: `comissao.ver`. Pacotes e %: `config.editar`.
- Valores aparecem para quem opera o caixa, porque precisa cobrar. A comissão de todas aparece só para `comissao.ver`; a da própria profissional, no 7A.

### 7.7 Testes

- **Unidade** (`comanda-math.test.ts`): rateio do desconto com sobra; comissão com meio centavo; troco; esperado do caixa.
- **Banco:**
  - abrir pela visita e juntar horário;
  - fechar com 3 formas;
  - troco como crédito; crédito insuficiente;
  - sem caixa;
  - venda de pacote (cria na hora de fechar) e baixa de sessão;
  - pacote vencido;
  - cancelar comanda (desfaz tudo); concorrência (duas pessoas fechando, a última sessão);
  - fechar caixa com diferença; sangria sem saldo;
  - relatório de comissão por período com "sem regra";
  - modo `avec` recusa.
- **e2e** (`desktop`): abrir caixa → abrir comanda pelo card → pagamento dividido → Finalizar → selo R$ na agenda → fechar caixa com diferença → relatório de comissão.

### 7.8 Desligado até o ok do dono

- `caixa_modo` continua `avec` em produção.
- Nenhum valor de comissão é preenchido pelo sistema.

---

### 7.9 Decisão do dono (15/10, ~9h40): caixa só de vendas e a aba "Já pagaram"

**Caixa só para registrar vendas, por enquanto.** Nada de financeiro (contas a pagar/receber, DRE): só a comanda (itens, profissional por item, desconto) e o pagamento (formas e pagamento dividido), com o total do dia por forma de pagamento. Abrir/fechar caixa com conferência, sangria e suprimento ficam construídos mas OPCIONAIS: `caixa_regras.exigeCaixaAberto` passa a valer `false` quando não existe. Comissão continua calculada como na seção 7 (a Casa usa), sem tela de pagamento de comissão.

**Agenda › aba "Já pagaram"** (pedido da Casa): quem já pagou e ainda não fez o serviço. No lugar da aba "Pacotes" de hoje (que vira uma parte dela). Uma linha por cliente, com:
- o que pagou e falta usar: pacote com sessões restantes ("Combo Método Fiaes · faltam 3 de 4 · vence 12/03"), crédito da cliente com saldo (`client_credit_entries`), serviço pago antes do horário (comanda fechada ligada a um horário que ainda não aconteceu);
- quanto (só para quem vê valores) e quando pagou;
- próximo horário marcado, ou **"Sem horário marcado"** com o botão Agendar (é o caso que mais importa: pagou e não voltou);
- filtros: Sem horário marcado · Vence em 30 dias · Pacote · Crédito; ordenar por vencimento.
Fonte: o que existe no CRM e no Avec importado. Nunca inventar saldo: crédito do Avec sem extrato aparece como "crédito no Avec (conferir)" só quando houver lançamento, nunca um valor calculado sem base. Contagem no título da aba. Testes: domínio (cada origem entra uma vez, pacote esgotado sai, horário passado sai), e2e da aba no desktop e no celular.


## 8. Lote 7A: App da profissional (tamanho G)

**Objetivo:** cada profissional abre o CRM no celular e vê só a agenda dela, com a próxima cliente, as ações do atendimento, os pedidos de folga, os ganhos (quando configurados) e avisos que chegam.

**Depende de:** 6B (status e porta única). Os ganhos dependem do 6C.

### 8.1 O que muda para cada pessoa

- **Gestão:**
  - em Configurações › Profissionais, na profissional, **"Acesso ao app"**: digita o e-mail dela e o sistema cria o acesso com o perfil Profissional e mostra **"Copiar link do convite"** (vale 7 dias), com uma sugestão de texto. **Nada é enviado.** Depois aparecem "Entrou em 16/10", "Avisos ligados neste aparelho: sim" e os botões "Gerar novo link" e "Tirar acesso";
  - na Agenda, "Ana viu a agenda de amanhã às 19:02" no topo da coluna, ou "mudou depois que ela viu";
  - aprova ou recusa os pedidos de folga.
- **Profissional:**
  1. Abre o link, cria a senha e cai em **"Instalar"**: passo a passo com imagens para pôr na tela inicial (iPhone: Compartilhar › Adicionar à Tela de Início; Android: ⋮ › Instalar app), depois "Ativar avisos" e um aviso de teste na hora.
  2. **Hoje**, a tela de abertura:
     - "Bom dia, Ana · quinta, 16 de out · 6 clientes · 9h–18h";
     - o **cartão da próxima cliente**: "10:00 · em 25 min · Paula Souza · Corte feminino · 1h20", com o status, a observação do horário e da ficha ("Alérgica a amônia"), última visita ("12/08 · Luzes com a Bia"), pacote ("Combo Método 2 de 4") e os selos "primeira vez" e "aniversário esta semana";
     - a **linha do dia**: cada horário, mais "Livre 11:20–13:00" e "Almoço 12:00–13:00". Os atendimentos feitos ficam recolhidos ("3 feitos").
  3. **Ações num horário**: Chegou, Iniciar, Finalizar (alimenta a comanda para a recepção, com "Fez algo a mais?"), Faltou (só 15 min depois do início) e Anotar (texto, com foto opcional).
  4. **Amanhã**: a agenda de amanhã e o botão "Vi minha agenda de amanhã". **Semana**: dia a dia, com o número de clientes. Troca de dia passando o dedo ou pelos botões.
  5. **Pedir folga ou bloqueio**: dia ou período, das … às … e motivo. Fica "Aguardando a recepção".
  6. **Ganhos**, só com a comissão configurada e o caixa no CRM:
     - hoje e o mês, com o total líquido em destaque;
     - cada linha: "Paula · Corte · 40% = R$ 72,00" (o valor do serviço só aparece se a gestão ligar `mostraValorServico`);
     - horário finalizado e ainda não pago aparece "aguardando fechamento".
  7. **Avisos**: os das últimas 48 h (para quando o aviso no celular não chegar).
  8. **Não vê** Fila, conversas, Quadro, Contatos, Relatórios, Configurações, telefone ou e-mail de cliente, nem valores e agenda de outras pessoas.
- **Recepção:**
  - recebe os pedidos de folga (selo "Pedidos (1)" na Agenda e aviso no sino da gestão) e aprova ou recusa. Se houver clientes no período, a tela lista quem são para remarcar;
  - vê "Finalizado por Ana" no card e a comanda alimentada;
  - no card do horário, "Anotar para a profissional" grava uma anotação da ficha técnica (`client_notes`) que a profissional vê na próxima cliente.
- **Cliente:** nada.

### 8.2 Dados (`0028_app_profissional`)

```sql
alter table professionals add column user_id uuid references users(id);
create unique index professionals_user_uq on professionals (user_id) where user_id is not null;

create table pro_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  professional_id uuid not null references professionals(id),
  kind text not null,          -- novo | remarcado | cancelado | chegou | confirmou | folga_aprovada | folga_recusada
  appointment_id uuid references appointments(id),
  title text not null, body text not null, url text not null,
  dedupe_key text not null,
  hold_until timestamptz,      -- silêncio fora do expediente dela
  created_at timestamptz not null default now(), pushed_at timestamptz, read_at timestamptz
);
create unique index pro_notifications_dedupe_uq on pro_notifications (dedupe_key);
create index pro_notifications_pending_idx on pro_notifications (pushed_at, hold_until);

create table pro_day_acks (
  professional_id uuid not null references professionals(id),
  day date not null,
  acked_at timestamptz not null default now(),
  acked_by uuid not null references users(id),
  primary key (professional_id, day)
);

create table client_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id),
  author_id uuid not null references users(id),
  professional_id uuid references professionals(id),
  appointment_id uuid references appointments(id),
  body text not null check (length(body) <= 2000),
  media_path text, media_mime text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid references users(id)
);
create index client_notes_contact_idx on client_notes (contact_id, created_at);

alter table agenda_blocks add column request_status text,     -- null = bloqueio normal | pedido | aprovado | recusado
  add column requested_by uuid references users(id), add column decided_by uuid references users(id),
  add column decided_at timestamptz, add column decision_note text;
```

### 8.3 Rotas e telas

- **Grupo próprio** `src/app/(pro)/pro/`, com layout próprio: sem o menu da equipe, sem sino de conversas, sem presença da distribuição.
  - `layout.tsx`: `requirePerm("pro.app")` e acha a profissional ligada (`professionals.user_id = sessão`, ativa). Sem ligação: "Sua conta ainda não está ligada a uma profissional. Fale com a gestão."
  - Páginas: `page.tsx` (Hoje), `dia/[d]/page.tsx`, `semana/page.tsx`, `horario/[id]/page.tsx`, `ganhos/page.tsx` (exige `pro.ganhos`), `avisos/page.tsx`, `folga/page.tsx`, `instalar/page.tsx`, `actions.ts`.
- **Manifest próprio** `public/pro.webmanifest`: `"id": "/pro"`, `"start_url": "/pro"`, `"scope": "/"` (para o login, fora de `/pro`, não abrir em outra janela) e `"display": "standalone"`. O layout de `/pro` aponta para ele pelos metadados do Next.
- **Quem só tem `pro.app`** e abre qualquer tela da equipe vai para `/pro`: `(app)/layout.tsx` redireciona antes de rodar `beat()`, os alertas e a contagem de atrasados, e `firstAllowedPath` também.
- **"Equipe agora" e a distribuição** ignoram quem não tem `atendimento.ver`: a profissional nunca aparece como "Disponível" para receber conversa (`queries/team-now.ts:16`, `deals.ts:52` já exige `distribuicao.receber`).
- **Sessão que não cai:** `POST /api/sessao/renovar`. O app chama no máximo uma vez por dia, ao abrir; a rota exige sessão. Ela estende a sessão no banco para agora + 90 dias (perfil com `pro.app` e sem `atendimento.ver`) ou + 30 dias (os demais) e grava de novo o cookie. Função `renewSession(token, now, days)` em `sessions-store.ts`.
- **Fotos das anotações:**
  - envio de até 5 MB; o tipo é conferido pelos bytes (JPEG, PNG, WebP ou HEIC, com `sniff.ts`) e o arquivo fica em `MEDIA_DIR/notas/`;
  - `GET /api/notas/[id]/foto` serve a foto para quem tem `atendimento.ver` ou `contatos.ver`, ou para a profissional que tem horário com aquela cliente entre 60 dias atrás e 60 dias à frente.

### 8.4 Regras

1. **Posse:** toda leitura e ação do app usa a profissional da sessão, resolvida no servidor. Um `id` de horário de outra profissional devolve "Horário não encontrado" (a tela nunca escolhe a profissional).
2. **O que ela vê da cliente:**
   - **vê:** nome; serviço; observação do horário; anotações da ficha técnica (`client_notes`, escritas pela profissional ou pela recepção em "Anotar para a profissional"; as anotações gerais do contato, `contacts.notes`, não aparecem porque podem trazer assunto de conversa); última visita (data, serviço e profissional, sem valor); pacote (nome e sessões); "primeira vez"; "aniversário esta semana";
   - **não vê:** telefone, e-mail, ano de nascimento, conversas, valores, outras clientes.
3. **Ações:**
   - Chegou, Iniciar e Finalizar passam pela porta única do 6B (`setAppointmentStatus`, com `via = 'profissional'`);
   - Faltou, só 15 min depois do início;
   - Finalizar, com o caixa no CRM, põe o serviço na comanda aberta da visita (cria a comanda se precisar, `added_via = 'profissional'`). "Fez algo a mais?" acrescenta serviços dela com o preço do cadastro; sem preço, a recepção completa.
4. **Folga ou bloqueio pedido:** cria `agenda_blocks` com `request_status = 'pedido'`, que só avisa no motor (6A, regra 3). A aprovação vira `aprovado` e passa a bloquear; a recusa vira `recusado` com nota. Os dois avisam a profissional.
5. **"Vi minha agenda de amanhã"** grava `pro_day_acks`. Qualquer mudança nos horários dela daquele dia depois do `acked_at` faz aparecer "mudou depois que você viu" (para ela) e "mudou depois que ela viu" (para a recepção).
6. **Avisos no celular:**
   - **quando:** novo horário, remarcado (avisa a de antes e a de depois), cancelado, chegou, confirmou (só com `avisaConfirmacao`) e pedido de folga decidido;
   - **de onde:** criados na mesma transação da mudança (gancho no 6B) e enviados pelo job `push-agenda` do worker, a cada minuto, com o `webPushSender` de `push.ts:17`. Endereço que não existe mais (404 ou 410) sai, como hoje;
   - **silêncio:** fora do horário de trabalho dela, o aviso espera até o próximo início (`hold_until`); "chegou" não espera;
   - **nunca** sai aviso de mudança vinda da importação do Avec, de script ou de migração;
   - a mesma mudança não avisa duas vezes (`dedupe_key = appointment:kind:minuto`).
7. **Ganhos:**
   - só com `pro.ganhos`, `caixa_modo = 'crm'` e comissão configurada;
   - linhas de `comanda_items` com `professional_id` dela, em comandas fechadas e não canceladas; o valor do serviço só aparece com `mostraValorServico`;
   - sem regra: "Comissão ainda não configurada para Corte. Fale com a gestão."
8. **Convite:**
   - `inviteProfessional(professionalId, email, actorId)`, só com `equipe.gerir`:
     - cria ou atualiza a usuária com o perfil Profissional e um token de convite de 7 dias (`createInvite`, `users.ts:20`);
     - liga `professionals.user_id`;
     - devolve a URL, que a tela só copia;
   - e-mail já usado por outra pessoa da equipe: "Esse e-mail já é de Cati. Use outro";
   - "Tirar acesso" desativa a usuária (a sessão cai na hora, como hoje) e mantém a ligação para o histórico.

### 8.5 Erros e casos difíceis

| Caso | O que acontece |
|---|---|
| Profissional sem horário de trabalho | O dia segue o horário da Casa. Na segunda (Casa fechada) aparece "Folga". Aviso fora do expediente espera o próximo dia aberto |
| Profissional com dois aparelhos | Os dois recebem o aviso (uma inscrição por aparelho) |
| iPhone sem o app na tela inicial | "Ativar avisos" explica que no iPhone o aviso só funciona com o app instalado e leva ao passo a passo |
| Sessão expirada no meio do dia | Não acontece com uso diário (renovação). Se acontecer, o login volta para `/pro` |
| Profissional desativada com acesso | A sessão cai; o convite antigo não funciona mais |
| Finalizar com o caixa ainda no Avec | Só muda o status; a comanda não é tocada |
| Horário remarcado para outra profissional | A de antes recebe "Paula saiu da sua agenda (passou para a Bia)", sem detalhes da outra |
| Pedido de folga com clientes no período | Na aprovação, a recepção vê a lista; nada é remarcado sozinho |

### 8.6 Segurança

- Bloqueio no servidor, não só na tela: as telas da equipe exigem permissões que o perfil Profissional não tem.
  - `/api/media` e `/api/avatar` já exigem `atendimento.ver` ou `contatos.ver` (`api/media/[id]/route.ts:16`); `/api/relatorios` exige `relatorios.exportar` (`api/relatorios/[tipo]/route.ts:29`).
  - As consultas do app (`src/server/queries/pro.ts`) recebem só a profissional da sessão.
- O tempo real (`/api/stream`) só avisa "algo mudou" no escopo `agenda`, sem dados. Cada tela recarrega com as próprias permissões.
- `guard-coverage.test.ts`: `(pro)/pro/layout.tsx` com `requirePerm`; `/api/sessao/renovar` na lista de exceções ("renova a própria sessão"); `/api/notas/[id]/foto` com `can(user.perms, …)`.

### 8.7 Testes

- **Banco:**
  - `pro-access.test.ts`: posse (horário de outra profissional devolve "não encontrado"); profissional sem ligação; convite e e-mail repetido; tirar acesso;
  - `pro-notifications.test.ts`: criar, remarcar (duas profissionais) e cancelar geram aviso; a importação do Avec não gera; silêncio fora do horário; não repete; job de envio com um sender falso;
  - `pro-acks.test.ts`: mudança depois do "vi" aparece;
  - `pro-earnings.test.ts`: só as linhas dela; esconde o valor do serviço; sem regra;
  - `sessions-store.test.ts`: renovação de 90 e de 30 dias.
- **Unidade:** o redirecionamento e o `firstAllowedPath` para quem só tem `pro.app`.
- **e2e** (projeto `celular`; usuária `maiara@e2e.local`, ligada a uma profissional, com sessão salva no `auth.setup.ts`):
  - entra e cai em `/pro`;
  - Hoje mostra só os horários dela;
  - Chegou → Iniciar → Finalizar;
  - pedir folga, e a gestão aprova (`desktop`);
  - `/atendimento`, `/contatos` e `/api/media/<id>` barrados;
  - axe sem violações.

### 8.8 Desligado até o ok do dono

- Nenhum convite é criado sozinho: a gestão gera e copia cada um.
- "Mostrar o valor do serviço" e "Avisar quando a cliente confirmar" começam desligados.

---

## 9. Lote 7B: Área da cliente (tamanho M; agendamento online M, desligado)

**Objetivo:** a cliente confirma, pede para remarcar ou cancela pelo link, sem login. A atendente manda o link com um botão que só preenche o texto. O lembrete da véspera e o agendamento online ficam prontos e desligados.

**Depende de:** 6B (visita, status, porta única) e 7A para o aviso à profissional (opcional: sem o 7A, só não avisa).

### 9.1 O que muda para cada pessoa

- **Atendente e recepção:**
  - na conversa, quando a cliente tem horário futuro, aparece **"Enviar link de confirmação"**. O botão gera o link e **preenche** a caixa de mensagem com o texto modelo. A atendente lê, ajusta e aperta Enviar. Se já houver texto digitado, pergunta "Trocar o que você estava escrevendo?";
  - no card da Agenda, **"Copiar link"**, para quem não tem conversa aberta;
  - o que a cliente fez aparece na Agenda ("Confirmou pelo link às 10:42"), no histórico da conversa e, quando é pedido de remarcar, como combinado na Fila.
- **Cliente**, ao abrir o link (página leve, feita para o celular, sem menu):
  - "Oi, Paula! Seu horário na Casa Fiaes";
  - "Corte feminino com a Ana · quinta, 16 de outubro · 10:00 às 11:20" (todos os serviços da visita);
  - endereço, "Como chegar" (Maps) e "Salvar no calendário" (.ics);
  - botões **Confirmar presença**, **Preciso remarcar** e **Cancelar**;
  - depois de agir, a página diz o que aconteceu e o que vem agora ("Pronto! A Casa vai te chamar no WhatsApp para combinar outro horário").
- **Gestão:**
  - Configurações › Página da cliente: endereço e WhatsApp da Casa, texto modelo do link e prazo para cancelar (24 h);
  - Configurações › Automações: o **lembrete da véspera com o link**, desligado, com o aviso "Desligue antes a confirmação da Avec IA: o guia do Avec exige, e a cliente receberia duas mensagens";
  - Configurações › Agendamento online, desligado.
- **Profissional:** aviso de cancelamento sempre; de confirmação, se a gestão ligar.

### 9.2 Dados (`0029_area_cliente`)

```sql
create table client_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,                      -- sha256 hex do token; o token nunca é guardado
  visit_id uuid not null references visits(id),
  issued_starts_at timestamptz not null,         -- início da visita quando o link foi gerado
  created_by uuid references users(id),          -- null = lembrete automático
  created_via text not null,                     -- conversa | agenda | lembrete_d1
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  open_count integer not null default 0, first_opened_at timestamptz, last_opened_at timestamptz,
  last_action text, last_action_at timestamptz   -- confirmou | pediu_remarcar | cancelou
);
create unique index client_links_token_uq on client_links (token_hash);
create index client_links_visit_idx on client_links (visit_id);
```

### 9.3 Rotas

| Rota | Tipo | Acesso |
|---|---|---|
| `src/app/c/[token]/page.tsx` | página pública | token |
| `src/app/c/[token]/actions.ts` | ações públicas (confirmar, pedir remarcação, cancelar) | token + limite por IP e por link |
| `src/app/c/[token]/agenda.ics/route.ts` | arquivo de calendário | token |
| `src/app/agendar/page.tsx` e `actions.ts` | agendamento online | público; `notFound()` quando desligado |
| `createClientLinkAction(appointmentId)` em `agenda/actions.ts` | interna | `atendimento.ver` (gerar não é enviar) |

- `src/proxy.ts:6`: `PUBLIC` ganha `/c` e `/agendar`.
- `guard-coverage.test.ts`: `PUBLIC_PAGES` ganha `c/[token]/page.tsx` e `agendar/page.tsx`; `PUBLIC_ACTION_FILES` ganha `c/[token]/actions.ts` e `agendar/actions.ts`; `ROUTE_EXCEPTIONS` ganha `c/[token]/agenda.ics/route.ts` ("token de 32 bytes, só o hash no banco"). Cada exceção traz o motivo, como as atuais.
- Preencher o texto na conversa: um pequeno estado de rascunho por conversa (`src/components/lead/composer-draft.ts`). O painel da cliente escreve e o `Composer` lê; o `Composer` (`composer.tsx:26`) não envia nada sozinho.

### 9.4 Regras

1. **Token:**
   - `newToken()` (`tokens.ts:4`): 32 bytes aleatórios em base64url. No banco vai só `hashToken(token)` (SHA-256). URL: `${APP_URL}/c/<token>`;
   - validade = o menor entre (fim do último serviço da visita + 24 h) e (geração + 60 dias);
   - vários links da mesma visita podem valer ao mesmo tempo (a atendente pode gerar de novo);
   - o token nunca vai para log: só os 8 primeiros caracteres do hash.
2. **O que a página mostra:**
   - **mostra:** primeiro nome da cliente; serviços; apelido das profissionais; dia e hora; endereço e WhatsApp da Casa;
   - **nunca mostra:** telefone, e-mail, sobrenome, outros horários, valores, nada de conversa.
3. **Estados da página:**
   - **agendado:** os três botões;
   - **confirmado:** "Você confirmou ✓", mais Remarcar e Cancelar;
   - **remarcado depois do link** (início atual ≠ `issued_starts_at`): "Seu horário mudou: agora é quinta, 16/10, às 14:00", e os botões valem para o horário novo;
   - **cancelado:** "Este horário foi cancelado", sem botões, com "Falar com a Casa";
   - **já aconteceu:** "Obrigada pela visita!";
   - **pedido pelo site** (`solicitado`): "Aguardando a Casa confirmar";
   - **link vencido ou inválido:** a mesma página genérica ("Este link não vale mais. Fale com a Casa pelo WhatsApp"), sem dizer qual dos dois.
4. **Confirmar presença:**
   - todos os horários ativos da visita viram `confirmado` (`confirmed_via = 'link'`), pela porta única do 6B;
   - grava `client_links.last_action`, o evento no histórico da conversa ("Confirmou pelo link") e, se a gestão ligou, avisa a profissional;
   - repetir não muda nada.
5. **Preciso remarcar:**
   - **não cancela**. Cria um combinado "Remarcar (pediu pelo link)" para a dona da conversa (`createTaskTx`, que já acha o responsável, B9) e o evento na conversa;
   - sem conversa aberta, avisa a gestão pelo sino, com o link da ficha;
   - campo opcional "Qual dia ou horário é melhor para você?" (até 200 caracteres), que vai junto.
6. **Cancelar:**
   - motivo obrigatório: "Não vou conseguir ir", "Problema de saúde", "Imprevisto" ou "Outro" (com texto);
   - só até `cancelarAteHoras` antes do início. Depois disso, o botão vira "Falar com a Casa" (`wa.me/<WhatsApp da Casa>` com o texto pronto);
   - cancela todos os horários ativos da visita (`cancel_reason = 'cliente_desmarcou'`, `cancelled_via = 'link'`), pela porta única do 6B (funil do 1C, aviso à profissional, vaga para a lista de espera).
7. **Envio de formulário com o horário antigo:** a página manda junto o início que mostrou. Se o horário mudou entre a página abrir e o clique, a ação recusa ("O horário mudou. Atualize a página").
8. **Arquivo de calendário (.ics):**
   - `UID: <visita>@casafiaes`, `DTSTART` e `DTEND` em UTC (`…Z`), `SUMMARY: Casa Fiaes · Corte com a Ana`, `LOCATION` com o endereço e o link na `DESCRIPTION`;
   - sem o nome da cliente; texto escapado conforme a RFC 5545.
9. **Proteções da página pública:**
   - limite de 30 aberturas com link errado por IP a cada 10 min (`allow`, `rate-limit.ts:3`, com `clientIp`); 10 ações por IP e 5 por link a cada 10 min. Passou do limite, "Muitas tentativas. Espere alguns minutos";
   - cabeçalhos `Cache-Control: no-store`, `X-Robots-Tag: noindex` e `Referrer-Policy: no-referrer` (o token está no endereço e não pode ir para o Maps);
   - a CSP com nonce já vem do proxy;
   - as server actions do Next conferem a origem do pedido;
   - a página não marca nada como lido no WhatsApp e não devolve `id` interno.
10. **Texto modelo do link** (editável): "Oi, {primeiro_nome}! Seu horário na Casa Fiaes: {data} às {hora} ({servicos}). Para confirmar ou remarcar, é só tocar aqui: {link}".
11. **Lembrete da véspera (DESLIGADO):**
    - job `lembrete-d1` no worker, a cada 15 min, que só roda com `lembrete_d1.enabled`;
    - pega os horários de amanhã em `agendado` (não confirmados), de clientes **com conversa aberta** e que não estão como "Não é cliente". Horário que veio do Avec ganha visita na hora (`ensureVisitFor`), e cada visita recebe uma mensagem só. Cria o link (`created_via = 'lembrete_d1'`) e põe a mensagem na **fila de envio que já existe** (`enqueueAutomated`, `outbox.ts:59`), com `source = "lembrete_d1:<visita>"`, `notBefore` = véspera na hora configurada, dentro do expediente, e `guard.scheduledAt` = o início;
    - na hora de enviar, a fila confere de novo: lembrete ligado, visita ativa, mesmo início, ainda não confirmada;
    - nunca liga junto com o lembrete ou a enquete das automações (mesma trava de `config.ts:57-67`).
12. **Agendamento online (DESLIGADO):**
    - `/agendar` só existe com `agendamento_online.enabled`. Passos: serviço (só os marcados para o online), profissional (as marcadas, mais "Qualquer uma"), dia (até `diasAFrente`), horário (só `livre`, com `antecedenciaMin`), nome, celular e observação;
    - o pedido vira uma visita `origin = 'online'` com os horários em `solicitado`, que **seguram a vaga**, mais um aviso para a recepção;
    - a recepção confirma (vira `agendado`) ou recusa (`cancelado`, motivo `recusado`), pela Agenda ou pela Fila;
    - pedido sem resposta até o início é cancelado sozinho (`cancel_reason = 'recusado'`, nota "a Casa não respondeu a tempo");
    - **sem código de verificação e sem WhatsApp automático**: quem confirma é uma pessoa;
    - **anti-abuso:** limite por IP (5 por hora), no máximo 2 pedidos abertos por celular, campo isca (escondido) e tempo mínimo de preenchimento de 3 s;
    - contato existente nunca tem o nome trocado; contato novo nasce só com nome e celular (a origem "site" fica na visita).

### 9.5 Erros e casos difíceis

| Caso | O que acontece |
|---|---|
| Link de horário cancelado | Página "Este horário foi cancelado", sem botões |
| Link de horário remarcado | Mostra o horário novo e avisa que mudou; o clique com a página antiga é recusado |
| Cliente cancela dentro do prazo e depois toca em Confirmar (outra aba) | "Este horário foi cancelado" |
| Duas confirmações ao mesmo tempo | Idempotente: uma muda, a outra não faz nada |
| Visita com 2 serviços e uma das profissionais cancelou o dela | A página mostra só o serviço que continua |
| Cliente sem conversa pede remarcar | Aviso para a gestão, com o link da ficha |
| Link aberto por outra pessoa (encaminhado) | Só vê o primeiro nome e o horário; pode confirmar ou cancelar (o mesmo risco de quem recebe o WhatsApp) |
| Endereço da Casa não preenchido | Sem "Como chegar"; o resto funciona |
| Lembrete ligado com a Avec IA ainda ligada | O sistema não sabe da Avec IA: o aviso é na tela de ligar, e a decisão é do dono (seção 11) |

### 9.6 Testes

- **Unidade:** `ics.test.ts` (UTC, escape, sem o nome da cliente); validade do link; o texto modelo com as variáveis.
- **Banco:** `client-link.test.ts`:
  - gerar e guardar só o hash;
  - abrir com token errado (genérico) e vencido;
  - confirmar (idempotente, todos os serviços);
  - remarcado depois do link (a página mostra o novo; a ação com o início antigo é recusada);
  - cancelar dentro e fora do prazo;
  - pedir remarcação com e sem conversa;
  - limite por IP;
  - lembrete da véspera: desligado não faz nada; ligado (com o provider de teste), põe uma mensagem na fila por visita, não repete, cancela na hora de enviar se a visita foi confirmada ou remarcada, e não liga com o lembrete das automações ligado;
  - agendamento online: desligado devolve 404; ligado cria `solicitado`, segura a vaga e respeita os limites.
- **e2e:**
  - `celular`: abrir o link → Confirmar → a Agenda (`desktop`) mostra Confirmado; Cancelar com motivo; depois do prazo, aparece "Falar com a Casa";
  - `desktop`: "Enviar link de confirmação" preenche a caixa de mensagem e nada é enviado (a Evolution de teste não recebe nada);
  - axe na página pública.

### 9.7 Desligado até o ok do dono

- O lembrete automático da véspera.
- O agendamento online.
- Prazo de cancelamento de 24 h (o dono pode mudar).
- O botão de enviar o link só preenche o texto.

---

## 10. Lote 5 e o resto da matriz, em ordem de valor (depois)

Tamanhos: **P** = poucas horas; **M** = um dia de trabalho; **G** = dois ou três dias. "(L5)" = item do Lote 5 da spec de 15/10 (ChatGuru restante). Os números D01 a D39 são os que a matriz usa.

| # | O quê | Tamanho | Por que vem nesta posição |
|---|---|---|---|
| D01 | Nota interna com @menção na conversa (L5) | M | Troca de turno e lugar para as anotações que vêm do ChatGuru |
| D02 | Ligação perdida e reações aparecendo na conversa; 👍 na mensagem do link conta como confirmação (L5) | P | Hoje são descartadas (`webhook.ts:71-72`): cliente que ligou some |
| D03 | Importar a ficha e o histórico do ChatGuru (L5) | M | Depende da Casa exportar os CSVs e criar o diálogo "Post para URL" |
| D04 | Mensagem agendada, com "Enviar agora" e "Cancelar" (L5) | M | Usa a fila de envio que já existe (`outbox.ts:59`) |
| D05 | Respostas prontas com variáveis ({primeiro_nome}, {horario}, {profissional}, {link}) e anexo (L5) | M | Padroniza a equipe; o {link} usa o 7B |
| D06 | Nota fiscal (NFS-e no modelo salão-parceiro e NFC-e) por um emissor terceirizado | G | A Casa emite (138 notas no período): sem isso o Avec não desliga |
| D07 | Fechamento de comissão: descontos (taxa de cartão, produto), recibo e "pago em" | M | Fecha o ciclo do 6C |
| D08 | Taxas de cartão por bandeira e prazo; caixinha; dívida da cliente; forma "Cortesia" para migrar créditos | M | A Casa usa muito cartão com taxa (207 comandas com taxa) |
| D09 | Estoque básico: produtos, entrada, baixa na venda, mínimo | G | Confirmar com a Thaise se a Casa usa (338 produtos no Avec) |
| D10 | Status "Resolvido" à mão e "Acompanhar" (marcar como não lida ou favorita) (L5) | P | |
| D11 | Mensagem em massa a partir dos filtros de Contatos, com prévia, limite e confirmação (L5) | M | Só com ok explícito: risco de banimento |
| D12 | Busca pelo texto das conversas | P | "Quem falou de alisamento?" |
| D13 | Arrastar para remarcar ou trocar de profissional, com Desfazer | M | Agilidade na grade (o 6B remarca pelo formulário) |
| D14 | Horário que se repete (a cada N semanas) | M | |
| D15 | Pesquisa de satisfação depois do atendimento, com nota baixa avisando a gestão | M | Envio só com ok |
| D16 | Ficha técnica estruturada (anamnese e prontuário), anexos e fotos de antes e depois | M | Tricologia; a Casa não usa isso no Avec hoje |
| D17 | Automações por evento (cliente escreveu, ligação perdida, etiqueta), pausar por cliente e "sugerir em vez de enviar" | G | |
| D18 | Relatórios e avisos enviados sozinhos (WhatsApp ou e-mail da gestora e da atendente) e relatório de mensagens que não chegaram | M | |
| D19 | Biblioteca de arquivos e áudio pré-gravado que sai como voz | M | |
| D20 | Encaminhar mensagem; editar e apagar para todos; vídeo pela tela | M | |
| D21 | Login reforçado: código em aparelho novo, lista de aparelhos, horário e IP de acesso, relatório de acessos; esconder telefone por permissão | M | |
| D22 | App da profissional sem internet (hoje e amanhã guardados) | M | |
| D23 | Profissional ver a agenda das colegas e marcar na própria coluna, com permissão | P | |
| D24 | Horários especiais da Casa (Natal, Carnaval), feriado na resposta automática, passo e duração por profissional, serviço simultâneo | M | |
| D25 | Salas e equipamentos | M | Só se houver maca ou aparelho disputado |
| D26 | Pré-venda e vale-presente | M | A Casa não usa vale hoje |
| D27 | Financeiro: entradas e saídas, contas, fluxo de caixa, exportar para o contador | G | |
| D28 | Menu de boas-vindas e equipes (departamentos) | G | |
| D29 | Campos personalizados da ficha | M | |
| D30 | Juntar contatos duplicados, "Familiar" (mãe e filha no mesmo número) e checar se o número tem WhatsApp | M | |
| D31 | Transcrição de áudio e resumo por IA | M | Custo de IA; decisão da Casa |
| D32 | IA que sugere ou marca horário pelo WhatsApp | G | Depois da agenda própria madura |
| D33 | Agendamento online com código de confirmação, "Meus horários" e botão no site | M | Evolução do 7B |
| D34 | WhatsApp oficial (API da Meta), vários números com filtro, figurinhas e localização | G | |
| D35 | Integrações: aviso para outro sistema, API própria, Make | M | |
| D36 | Fidelidade, cashback, promoções, cupom, pacote pelo site e clube de assinaturas | G | A Casa não usa |
| D37 | Taxa de falta e sinal ou pagamento online | G | A Casa não usa |
| D38 | Comissão de assistente e de produto, tipos de contrato e condições especiais | M | |
| D39 | Galeria de mídias da cliente, metas da equipe, tema escuro, atalhos de teclado | P | |

Os Lotes 2 (ficha e Contatos, inclusive exportar CSV), 3 (relatórios do salão, ocupação e mapa de calor da agenda) e 4 (configurações, etiquetas com cor e filtro) continuam como estão na spec de 15/10. A ocupação do Lote 3 passa a ser possível depois do 6A.

---

## 11. Decisões tomadas sem o dono — revisar

**Dadas pelo pedido desta noite:**
1. **O app da profissional é o próprio sistema** (instalado na tela inicial), não um app de loja.
2. **A profissional entra por convite**: a gestão gera o link e copia; nada é enviado sozinho.
3. **O link da cliente não tem login.**
4. **Nenhum envio automático de WhatsApp fica ligado.**
5. **O agendamento online fica desligado.**
6. **Comissão e duração ficam vazias até a Casa preencher.**
7. **A agenda do CRM convive com o Avec** até a Casa decidir a virada. A importação continua idempotente e nunca sobrescreve o que foi criado no CRM.

**Tomadas aqui, com o porquê:**

8. **Visita.** Os serviços da mesma cliente no mesmo dia formam uma visita, e o link da cliente é por visita. *Por quê:* mão e pé às 14h é uma ida só, e uma confirmação deve valer para tudo, como na Avec IA.
9. **Modo da agenda em três posições** (consulta, dupla, só CRM). Em produção começa em **consulta**, e você escolhe. *Por quê:* com o Avec online e a Avec IA ligados, um horário marcado só no CRM fica livre no Avec, e uma cliente pode marcar por cima. No modo dupla, a equipe marca nos dois até a virada.
10. **Comanda e caixa do CRM desligados** (`caixa_modo = avec`) até a Casa escolher. *Por quê:* com dois caixas, cada venda seria lançada duas vezes e os relatórios dobrariam.
11. **Um caixa da Casa aberto por vez**, e não um por pessoa como no Avec. *Por quê:* a Casa fecha em média um caixa por dia, e um só facilita a conferência. Dá para mudar depois.
12. **Comissão desta versão:** % sobre o valor do item já com desconto, sem descontar taxa de cartão nem produto (isso fica no D07). Pacote: sobre o valor por sessão, quando definido. Produto: sem comissão. *Por quê:* é o que dá para calcular sem inventar regra.
13. **A profissional vê a própria comissão sem o valor do serviço**, como a Casa configurou no Avec (`ocultar_faturamento_comissao=1`). A gestão pode ligar "mostrar valor". *Por quê:* foi escolha da Casa, e mudar isso sem perguntar mexe com a equipe.
14. **A cliente cancela pelo link até 24 h antes**; depois disso, "Falar com a Casa". *Por quê:* no Avec está "restringir cancelamento" ligado com 0 h, o que parece configuração incompleta. Cancelar em cima da hora é o que mais prejudica o salão. Para voltar ao 0 h, basta mudar o número.
15. **"Preciso remarcar" não cancela**: vira combinado para a recepção. *Por quê:* a cliente é atendida por uma pessoa e a vaga não some antes de haver outra.
16. **O lembrete da véspera, quando ligado, vai só para quem tem conversa aberta.** *Por quê:* mandar para todas criaria cartões no funil para clientes sem conversa (contra a decisão 4 de 15/10). Além disso, o próprio Avec exige que a Avec IA não rode junto com outra automação.
17. **A profissional precisa de e-mail para entrar** (pode ser o do Google do celular dela). *Por quê:* o login da equipe é por e-mail. Entrar pelo apelido fica para depois.
18. **A sessão da profissional dura 90 dias e se renova a cada uso**; a da equipe continua com 30. *Por quê:* login caindo é a queixa nº 1 do Avec PRO.
19. **Gestão e Recepção/Atendente podem encaixar** e marcar fora do horário de trabalho, sempre com registro. *Por quê:* a recepção da Casa já faz isso no Avec ("forçar encaixe").
20. **Sem horário próprio, a profissional segue o horário da Casa** (ter–sáb, 9h–18h). Com horário próprio, vale o dela, mesmo num dia em que a Casa fecha.
21. **Quem faz o quê** é sugerido pelo histórico do Avec (2 vezes ou mais em 12 meses) e só é gravado com um toque da gestão, ou pelo script com ensaio e o seu ok.
22. **Remarcar muda o mesmo horário** (com histórico) e desfaz a confirmação. *Por quê:* a cliente confirmou o horário antigo.
23. **A profissional não marca nem remarca clientes no app**: só pede folga ou bloqueio, que a recepção aprova. Não vê conversas, telefone nem valores de outras pessoas.
24. **A importação do Avec nunca gera aviso no celular da profissional.** *Por quê:* uma importação traz centenas de horários de uma vez.
25. **Bloqueio que veio do Avec pode ser apagado no CRM** (some só daqui). A tela lembra de apagar no Avec enquanto ele estiver ligado.
26. **Mantemos a palavra "Comanda"**, que é a que a recepção usa no Avec.
27. **As permissões novas entram uma única vez** nos perfis Atendente e Recepção. Se a gestão tirar depois, não voltam.
28. **"Pago" não é status**: é o selo de comanda fechada. *Por quê:* o 1C lê "compareceu" para levar a conversa a Atendida, e esse sentido não pode mudar.
29. **A Avec IA:** enquanto estiver ligada, não ligamos nenhuma confirmação automática. Desligá-la no Avec é decisão sua, de preferência no mesmo dia em que ligar o lembrete do CRM.

---

## 12. Review Focus

Cinco situações que mais podem morder quem usa. Cada uma tem teste na tarefa dona.

1. **O mesmo horário criado no CRM e chegando pela importação do Avec** (modo dupla: a recepção marca nos dois). O do Avec vira gêmeo: some da grade, não ocupa vaga, não entra no funil e nunca altera o do CRM, nem quando no Avec ele está pago ou cancelado. Horário diferente para a mesma cliente no mesmo dia vai para "Conferir com o Avec". Reimportar não muda nada. *Teste:* `agenda/twins.test.ts` (6B) e `avec/apply.test.ts`.
2. **Link de confirmação de horário já cancelado ou remarcado.**
   - Cancelado: "Este horário foi cancelado", sem botões.
   - Remarcado depois do link: mostra o horário novo e avisa que mudou.
   - Clique numa aba antiga, com o horário de antes: recusado ("O horário mudou. Atualize a página").
   - Link vencido: página genérica.
   - Confirmar depois de cancelar: recusado.

   *Teste:* `client-link.test.ts` (7B).
3. **Profissional sem horário de trabalho.**
   - Segue o horário da Casa. Na segunda (Casa fechada), o motor responde "não trabalha" sem erro, e marcar exige `agenda.encaixar` (fica `outside_hours`).
   - No app aparece "Folga". O aviso no celular fora de qualquer expediente espera o próximo dia aberto.
   - Com horário próprio na segunda, vale o dela.

   *Teste:* `free-slots.test.ts` e `work-hours.test.ts` (6A), `pro-notifications.test.ts` (7A).
4. **Fuso, horário de verão e meia-noite.**
   - O motor só trabalha com minutos do dia e dá o mesmo resultado com `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`.
   - Marcar às 23:30 por 60 min é recusado ("passa da meia-noite").
   - O .ics de 16/10 às 23:30 em Salvador sai como `DTSTART:20261017T023000Z`.
   - O cancelamento do Avec "sem hora" (00:00) não ocupa a grade.
   - A semana que atravessa o fim do mês fica certa.
   - Um aparelho em outro fuso vê o mesmo horário (`Intl` com America/Bahia).

   *Teste:* `free-slots.test.ts`, `ics.test.ts`, `agenda.test.ts`.
5. **Dois cliques simultâneos marcando o mesmo horário.**
   - Duas transações em paralelo para a Ana às 10:00: uma passa, a outra recebe "acabou de ser ocupado".
   - O mesmo formulário enviado duas vezes (mesma `request_key`) cria uma visita só.
   - O mesmo vale para duas pessoas fechando a mesma comanda, para a última sessão do pacote e para o crédito da cliente, que nunca fica negativo.

   *Teste:* `visits.test.ts` (6B) e `comandas.test.ts` (6C), com `Promise.all`.

---

## 13. Ordem de construção, dependências e implantação

### 13.1 Ordem

1. **6A.** Não depende do 1C. Pode começar já, deixando a migration `0025` para depois do merge da `rodada-2`, se o 1C ainda não tiver criado a `0024`.
2. **Merge da `rodada-2`** (1B e 1C) na `agenda-viva`. Os pontos de contato estão na lista abaixo.
3. **6B.** A tarefa "ligar ao funil" usa `syncContactFunnelTx` do 1C.
4. **6C** (depende do 6B).
5. **7A** (depende do 6B; os ganhos dependem do 6C).
6. **7B** (depende do 6B; o aviso à profissional usa o 7A, se já existir).

Pontos de contato com o 1C, para resolver no merge:
- `src/server/domain/appointments.ts`: o 1C (C8) chama a sincronização aqui; o 6B amplia `setAppointmentStatus`;
- `src/server/domain/avec/apply.ts`: o 1C devolve `funil`; o 6B acrescenta `pairAvecTwins`;
- `src/server/domain/avec/funnel-sync.ts`: passa a ignorar gêmeos e a tratar `chegou` e `em_atendimento` como "ainda vai acontecer";
- `src/components/queue/client-pane.tsx`: o 1C acrescenta botões; o 6B troca o `ScheduleSheet` pelo `BookingSheet`;
- `src/lib/permissions.ts` e `src/server/db/schema.ts`: só acréscimos.

### 13.2 Arquivos de teste e e2e que todos os lotes tocam

- `test/db.ts` e `e2e/reset.ts`: as tabelas novas entram no `truncate`.
- `e2e/reset.ts` também grava `agenda_modo = "dupla"`, `caixa_modo = "crm"`, uma profissional com horário 9h–18h e a usuária `maiara@e2e.local` (perfil Profissional) ligada a ela.
- `e2e/auth.setup.ts` ganha a sessão da profissional.
- `playwright.config.ts`: o projeto `celular` passa a rodar também `profissional.spec.ts` e `link-cliente.spec.ts` (hoje ele só pega os nomes da lista em `testMatch`).
- `src/server/auth/guard-coverage.test.ts` recebe as exceções justificadas (seções 8.6 e 9.3).

### 13.3 Implantação (só com o ok do dono)

O roteiro é o mesmo dos Lotes 1 (pasta nova `/opt/crm-rN` e troca de pasta, fora do expediente). Em ordem:
1. Migrations `0025` a `0029` (só acréscimos: a versão anterior funciona com o banco novo).
2. Seed: perfil Profissional e concessão única das permissões.
3. Configurar: `agenda_modo` (você escolhe), `caixa_modo = avec`, endereço da Casa. Lembrete e online continuam desligados.
4. `quem-faz-o-que.ts --dry-run` → você confere → `--aplicar --backup`.
5. `migrar-agendados-para-agenda.ts --dry-run` → você confere → `--aplicar --backup`.
6. Convites das profissionais, um por um, pela tela.

**Para voltar atrás:** volta-se a pasta anterior. As tabelas e colunas novas ficam sem uso. Os dois scripts têm backup JSON do estado de antes.

---

## 14. Fora de escopo

- Tudo da lista D01 a D39 (seção 10).
- Arrastar na grade, recorrência, "sem internet" no app, anamnese, nota fiscal, estoque e financeiro.
- Lançar atendimento passado (mais de 15 min antes).
- Mudar o horário de trabalho com data de início ("vale a partir de") e períodos especiais.
- Juntar no 7B a cliente da página com a cliente certa quando o número é de outra pessoa da família (D30).

---

## Notas

- **As duas maiores fontes de risco da virada não são de código.**
  - A **Avec IA** e o **agendamento online do Avec** continuam marcando e confirmando enquanto estiverem ligados.
  - A **nota fiscal** ainda sai só pelo Avec.

  Por isso o modo da agenda começa em "consulta" e o caixa em "avec".
- **Os números desta spec** vêm das auditorias de 15/10 (`docs/analise-2026-10-15/*.md`) e da pesquisa de 15/10. Nada foi lido do banco de produção para escrevê-la.
