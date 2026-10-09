# CRM Casa Fiaes MVP — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CRM local funcional da Casa Fiaes: WhatsApp (Evolution) → lead automático → funil com alertas e automações editáveis → card com conversa → relatórios.

**Architecture:** Next.js 16.4 (App Router, sem cacheComponents) + Postgres 17 (Drizzle) + pg-boss worker + Evolution API 2.3.7, tempo real por SSE/LISTEN-NOTIFY. Domínio em `src/server/*` (sem React), UI em `src/app` + `src/components`.

**Tech Stack:** next 16.4.0, react 19.3, drizzle-orm 0.45, pg 8, pg-boss 12, zod 4, motion 14, @node-rs/argon2, libphonenumber-js, qrcode, vitest 5, @playwright/test 1.64.

**Spec:** `docs/superpowers/specs/2026-10-09-crm-casa-fiaes-mvp.md`

## Global Constraints

- Node ≥ 20.9; TypeScript `strict: true`; nenhum `any` implícito.
- Toda Server Action e Route Handler revalida a sessão (`requireUser()` / `requireRole('gestor')`).
- Telefones sempre em E.164 (`+55...`); DDD padrão 71 ao normalizar números locais.
- Dinheiro em centavos (`integer`). Datas em `timestamptz`.
- Textos da interface em português do Brasil, sentence case, verbos de ação ("Enviar", "Salvar etapa").
- Animações só com `transform`/`opacity`; `prefers-reduced-motion` desliga movimento não essencial.
- Nenhuma credencial no código; tudo via `.env` (validado com zod em `src/server/env.ts`).
- `DEV_TOOLS` controla o simulador; em produção ele retorna 404.

## Review Focus

1. Webhook duplicado / fora de ordem (Evolution reenvia) → não pode duplicar mensagem nem deal. Teste: processar o mesmo payload 2× → 1 mensagem.
2. Mensagem enviada pelo próprio celular (`fromMe`) → conta como resposta e move Lead→Atendimento. Teste dedicado.
3. Telefone em formatos variados (`71 99999-9999`, `5571999999999@s.whatsapp.net`, 8 dígitos antigo) → mesmo contato. Teste de normalização.
4. Motor de regras rodando várias vezes no mesmo minuto → não pode gerar alertas repetidos para o mesmo evento. Teste de idempotência (`alerts` único por deal+tipo+janela).
5. Atendente tentando abrir `/config` ou chamar action de gestor → 403/redirect. Teste e2e.

---

### Task 1: Base do projeto, env, banco e migrações
**Files:** `next.config.ts`, `src/server/env.ts`, `src/server/db/{index,schema}.ts`, `drizzle.config.ts`, `drizzle/*`, `package.json` scripts (`db:generate`, `db:migrate`, `db:seed`, `seed:admin`, `worker`, `test`, `e2e`), `vitest.config.ts`.
**Produces:** `db` (drizzle node-postgres), todas as tabelas do spec §4, `pool` exportado, `notify(channel,payload)`.
- [ ] Desligar `cacheComponents`/`partialPrefetching`; manter regra turbopack do Tailwind.
- [ ] `env.ts` com zod (DATABASE_URL, EVOLUTION_URL, EVOLUTION_API_KEY, WEBHOOK_SECRET, WEBHOOK_PUBLIC_URL, SESSION_SECRET, APP_URL, DEV_TOOLS).
- [ ] Schema completo + `npm run db:generate` + `db:migrate`; verificar tabelas com `psql`.
- [ ] Seed: etapas padrão (Lead 2min, Atendimento 3min/1 dia, Agendado, Follow-up 1–4 1 dia, Fechado, Perdido), listas (objeções, motivos, respostas rápidas, origens), automações padrão (spec §5 itens 2,5,6,7).
- [ ] Teste vitest: seed idempotente (rodar 2× não duplica).
- [ ] Commit.

### Task 2: Autenticação e papéis
**Files:** `src/server/auth/{password,session,guard}.ts`, `src/proxy.ts`, `src/app/login/{page,actions}.tsx`, `src/app/convite/[token]/page.tsx`, `scripts/seed-admin.ts`.
**Produces:** `hashPassword`, `verifyPassword`, `createSession(userId)`, `getSessionUser()`, `requireUser()`, `requireRole(role)`, `destroySession()`.
- [ ] Testes: hash/verify; sessão expirada retorna null; token de sessão guardado só como hash.
- [ ] Login com mensagens de erro claras; rate limit simples por IP+email (5 tentativas/10 min em memória).
- [ ] Convite: gestor gera link; usuário define senha.
- [ ] proxy.ts: sem cookie → `/login` (exceto `/login`, `/convite`, `/api/webhooks`).
- [ ] Commit.

### Task 3: Domínio — telefone, contatos, deals, mensagens, eventos
**Files:** `src/server/domain/{phone,contacts,deals,messages,events}.ts`, testes em `src/server/domain/*.test.ts`.
**Produces:** `normalizePhone(raw): string|null`, `upsertContactByPhone(input)`, `getOrCreateOpenDeal(contactId, origin)`, `recordInbound(msg)`, `recordOutbound(msg)`, `moveDeal(dealId, stageKey, userId|null, reason)`, `logEvent(...)`, `emit(type, payload)`.
- [ ] Testes: normalização (formatos do Review Focus 3); inbound cria deal em Lead; inbound repetido não duplica; outbound fromMe em Lead move para Atendimento; inbound em Follow-up volta para Atendimento; detecção de origem ("vim pelo Instagram", referral de anúncio).
- [ ] Commit.

### Task 4: WhatsApp — provider Evolution, webhook, QR
**Files:** `src/server/whatsapp/{provider,evolution,webhook}.ts`, `src/app/api/webhooks/evolution/route.ts`, `src/app/(app)/config/whatsapp/*`.
**Produces:** `WhatsAppProvider { createInstance, getQr, getState, sendText, logout, remove }`, `handleEvolutionEvent(payload)`.
- [ ] Webhook: valida `x-webhook-secret` (timing-safe), grava `webhook_events` (único), responde 200 rápido, enfileira.
- [ ] Testes: payload `messages.upsert` real (fixture), `connection.update`, segredo inválido → 401, duplicado → ignorado.
- [ ] Tela QR com estados (gerando, aguardando, expirado→renovar, conectado, erro) e polling a cada 3 s; desconectar com confirmação.
- [ ] Verificação real: criar instância local e obter QR da Evolution rodando.
- [ ] Commit.

### Task 5: Worker e motor de regras (automações editáveis)
**Files:** `worker/index.ts`, `src/server/rules/{types,engine,triggers,actions}.ts`.
**Produces:** `runRules(now)`, tipos `Trigger`/`Condition`/`Action` (zod), `executeAction`.
- [ ] Triggers: `sem_resposta_minutos`, `parado_dias`, `sem_retorno_cliente_dias`, `aniversario_em_dias`, `data_cobranca`, `data_recontato`. Condições: `etapa_em`. Ações: `alertar_responsavel`, `alertar_gestao`, `mover_para_etapa`, `mover_para_proximo_followup`.
- [ ] Idempotência: `automation_runs` único por (automation_id, deal_id, chave_de_janela).
- [ ] Testes com relógio injetado para cada trigger + idempotência.
- [ ] pg-boss: fila `webhook` + cron `rules` a cada minuto.
- [ ] Commit.

### Task 6: Design system e shell
**Files:** `src/styles/tokens.css`, `src/app/globals.css`, `src/components/ui/{button,input,select,textarea,badge,sheet,dialog,toast,avatar,skeleton,empty,kbd}.tsx`, `src/components/shell/{sidebar,topbar,command}.tsx`, `src/lib/motion.ts`.
- [ ] Tokens do spec §6; componentes com estados hover/focus/disabled/loading; foco visível dourado.
- [ ] Shell: barra lateral (Hoje, Funil, Contatos, Relatórios, Config*), sino de alertas, busca Cmd+K.
- [ ] Commit.

### Task 7: Funil (kanban) + card do lead
**Files:** `src/app/(app)/funil/{page,actions}.tsx`, `src/components/pipeline/{board,column,deal-card}.tsx`, `src/components/lead/{lead-sheet,conversation,composer,fields}.tsx`, `src/app/api/stream/route.ts`, `src/lib/use-live.ts`.
- [ ] Kanban com arrastar (pointer events + layout animation), cronômetro ao vivo, card vermelho quando atrasado.
- [ ] Card em painel lateral: dados clicáveis (tel:, mailto:, instagram), objeção, observações, valor/forma de pagamento, datas (agendamento, cobrança, recontato), aniversário, histórico, conversa e composer com respostas rápidas `/`.
- [ ] SSE: atualiza board e conversa sem recarregar.
- [ ] Commit.

### Task 8: Hoje, contatos e importação
**Files:** `src/app/(app)/page.tsx`, `src/app/(app)/contatos/{page,actions}.tsx`, `src/server/domain/import.ts`.
- [ ] Teste de importação CSV (cabeçalhos flexíveis, telefones inválidos reportados, idempotente).
- [ ] Commit.

### Task 9: Relatórios
**Files:** `src/server/reports/*.ts`, `src/app/(app)/relatorios/page.tsx`, `src/app/api/relatorios/[tipo]/route.ts`.
- [ ] Consultas: funil por etapa (eventos), tempo médio de 1ª resposta por pessoa vs meta, alertas por pessoa, origem, objeções, caixa por forma de pagamento; período e filtros.
- [ ] CSV com BOM UTF-8 (abre certo no Excel).
- [ ] Testes das consultas com dados semeados.
- [ ] Commit.

### Task 10: Configurações (gestor)
**Files:** `src/app/(app)/config/{etapas,automacoes,listas,equipe}/*`.
- [ ] Etapas (nome, ordem, prazos), automações (editor Quando/Se/Então, liga/desliga, histórico, voltar versão), listas, equipe (convite, papel, desativar).
- [ ] Commit.

### Task 11: Simulador dev, e2e, QA visual, documentação
**Files:** `src/app/dev/simulador/*`, `e2e/*.spec.ts`, `docs/deploy-contabo.md`, `README.md`.
- [ ] e2e: login → simular mensagem → card aparece em Lead → passa 2 min (relógio do motor) → vermelho → responder pelo card → Atendimento → agendar → Agendado; atendente sem acesso a /config; dados persistem após reiniciar app.
- [ ] QA visual desktop e mobile (capturas), console sem erros.
- [ ] README (setup local) e deploy Contabo.
- [ ] Revisão final do branch.
