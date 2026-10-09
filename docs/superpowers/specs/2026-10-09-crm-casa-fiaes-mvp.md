# CRM Casa Fiaes — Especificação do MVP

Data: 2026-10-09 · Fonte dos requisitos: reunião de 08/10 (`../reunioes/2026-10-08-reuniao-dev-ia.pdf`), ideias do Joaquim e plano aprovado (https://crm-plano-mvp.pages.dev).

## 1. Objetivo

Nenhum lead do WhatsApp esquecido: toda conversa vira um card, o card anda sozinho pelo funil, quem atende é avisado quando atrasa, e a gestão vê os números. Tudo rodando **local**, pronto para migrar ao Contabo sem reescrita.

## 2. Premissas (reversíveis, documentadas)

| # | Premissa | Por quê | Como reverter |
|---|---|---|---|
| P1 | "QR code" no contexto da Casa Fiaes = **conectar números de WhatsApp** (QR da Evolution API lido pelo celular). Leitor de QR pela câmera não tem uso no fluxo atual. | O cadastro manual some porque o lead nasce da mensagem; não existe QR físico de cliente nos requisitos. | O módulo `whatsapp/qr` é isolado; um leitor de câmera pode ser adicionado como outra porta de entrada de contatos. |
| P2 | Manual de marca ainda não recebido. Tokens provisórios herdados da proposta/plano: papel `#fdfdfc`, tinta `#121212`, dourado `#b8863f`, Newsreader + Inter. | Continuidade com o que o cliente já viu. | Trocar `src/styles/tokens.css`. |
| P3 | WhatsApp só pela Evolution API 2.3.7 (sem número oficial no MVP). | Decisão do Joaquim em 08/10. | Interface `WhatsAppProvider` permite adicionar Cloud API. |
| P4 | Instagram fora do MVP (exige App Review da Meta). | Decisão de 08/10. | Modelo já guarda `instagram` no contato. |
| P5 | Papéis: `gestor` (configura tudo) e `atendente`. O primeiro gestor é criado por script (`npm run seed:admin`); os demais são convidados pelo gestor dentro do CRM. | "Só gestor mexe em configurações" + "gestor cria cargos e convida". | Tabela `users.role`. |
| P6 | Transcrição de áudio: fora do MVP funcional; o áudio aparece com player e a interface `Transcriber` fica pronta. | Exige Whisper local (~1–1,5 GB RAM) e validação de qualidade. | Implementar `Transcriber` com whisper.cpp. |
| P7 | Exportação de relatórios em **CSV** (abre no Excel). PDF fica para depois. | Robusto, sem dependência pesada. | Adicionar gerador PDF. |
| P8 | Simulador de mensagens (`/dev/simulador`) existe **só** com `DEV_TOOLS=true`, para testar o fluxo sem parear número real. | Parear número exige um chip de teste confirmado pelo Joaquim. | Desligar a flag. |

## 3. Arquitetura

- **Next.js 16.4 (App Router, TypeScript estrito)** — UI + Server Actions + Route Handlers. `cacheComponents` desligado (CRM 100% dinâmico e autenticado).
- **PostgreSQL 17** (Docker local; Contabo depois) — fonte da verdade. **Drizzle ORM** + migrações SQL versionadas (`drizzle/`).
- **pg-boss** (fila no próprio Postgres) — worker separado (`npm run worker`) roda o motor de regras a cada minuto e processa webhooks.
- **Evolution API 2.3.7** (Docker) — conexão WhatsApp. Webhook por instância com header `x-webhook-secret`.
- **Tempo real**: Server-Sent Events (`/api/stream`) alimentado por `LISTEN/NOTIFY` do Postgres. Sem Supabase/Redis.
- **Auth própria**: senha com Argon2id (`@node-rs/argon2`), sessão em tabela, cookie `httpOnly` com id aleatório de 32 bytes (hash SHA-256 no banco). `proxy.ts` faz checagem otimista do cookie; a verificação real fica na DAL (`src/server/auth/session.ts`) e em toda Server Action / Route Handler.
- **Motion** (`motion/react`) para animações; CSS para o resto. Respeita `prefers-reduced-motion`.

```
WhatsApp ⇄ Evolution (Docker) ──webhook──► /api/webhooks/evolution ─► webhook_events (dedupe) ─► pg-boss
                                                                                         │
 Navegador ◄── SSE /api/stream ◄── NOTIFY crm_events ◄── domínio (contatos, deals, mensagens, alertas)
 Navegador ── Server Actions ──► domínio ──► Evolution (enviar mensagem)
 worker (pg-boss, 1/min) ──► motor de regras (SLA, parado, follow-up, aniversário, cobrança, recontato)
```

## 4. Modelo de dados (resumo)

- `users` (id, name, email único, password_hash, role, active, invite_token, created_at)
- `sessions` (id_hash, user_id, expires_at)
- `stages` (id, key, name, position, kind: `lead|atendimento|agendado|followup|fechado|perdido`, sla_minutes null, stale_days null, color)
- `contacts` (id, name, phone_e164 único, email, instagram, birthday (mês/dia/ano?), is_client, client_since, notes, created_at)
- `deals` (id, contact_id, stage_id, owner_id, origin, value_cents, payment_method, objection_id, lost_reason_id, observations, scheduled_at, charge_at, recontact_at, last_inbound_at, last_outbound_at, awaiting_reply_since, stage_entered_at, closed_at, created_at)
- `messages` (id, deal_id, contact_id, channel_id, external_id único por canal, direction in/out, kind text/audio/image/document/other, body, media_url, status, sent_by_user_id, created_at)
- `deal_events` (id, deal_id, type, payload jsonb, user_id, created_at) — histórico do card e base dos relatórios
- `alerts` (id, deal_id, user_id, type, severity, message, created_at, resolved_at) — atrasos registrados por pessoa
- `channels` (id, name, instance_name único, status, phone, last_qr_at, created_at)
- `lists` (id, kind `objection|lost_reason|quick_reply|origin`, label, body, position, active)
- `automations` (id, name, enabled, trigger jsonb, conditions jsonb, actions jsonb, version, updated_by, updated_at) + `automation_versions` + `automation_runs`
- `webhook_events` (id, provider, external_id, payload, received_at, processed_at, error; único(provider, external_id))
- `audit_log` (id, user_id, action, entity, entity_id, data, created_at)

## 5. Fluxos essenciais (critérios de aceite)

1. **Lead nasce sozinho**: mensagem recebida de número sem deal aberto → cria/atualiza contato → cria deal na etapa *Lead* → card aparece no funil em tempo real.
2. **Alerta de 2 min**: deal em *Lead* com `awaiting_reply_since` há ≥ `sla_minutes` (padrão 2) → card vermelho + som/notificação + linha em `alerts` para o responsável.
3. **Resposta move o card**: mensagem enviada pelo CRM **ou pelo celular** (fromMe) em deal na etapa *Lead* → move para *Atendimento* e zera a espera.
4. **Agendado**: o atendente marca data/hora → deal vai para *Agendado*.
5. **Follow-up**: deal em *Atendimento* sem resposta do cliente há ≥ 1 dia → *Follow-up 1*; a cada dia sem resposta → *Follow-up 2/3/4*. Resposta do cliente volta para *Atendimento*.
6. **Parado**: qualquer etapa com `stale_days` e sem movimento → alerta ao responsável.
7. **Aniversário (7 dias antes)**, **data de cobrança**, **data de recontato** → alerta/tarefa no dia.
8. **Responder pelo card**: digitar ou usar resposta rápida `/` → envia via Evolution → aparece na conversa com status.
9. **Conectar WhatsApp (QR)**: gestor cria número → QR exibido com estados *gerando / aguardando leitura / expirado (renova) / conectado / erro* → webhook `CONNECTION_UPDATE` confirma.
10. **Automações editáveis**: gestor liga/desliga e edita regras "Quando / Se / Então", com histórico de execuções e versão anterior.
11. **Relatórios**: período (hoje/7d/mês/ano), filtros (pessoa, origem), funil, tempo de resposta por pessoa vs meta, objeções, caixa por forma de pagamento, exportação CSV.
12. **Histórico de clientes**: importar CSV (nome, telefone, último atendimento) → contatos marcados como clientes → card mostra "já é cliente".
13. **Equipe**: gestor convida (link com token), define papel, desativa.
14. **Persistência**: dados sobrevivem a reinício do app e do Docker.

## 6. Design system (resumo)

- Cor: papel `#fdfdfc`, papel-2 `#f2f0ec`, tinta `#121212`, grafite `#5c5c5c`, linha `#e4e1db`, dourado `#b8863f` (ação primária e foco), dourado-claro `#efe4d2`, alerta `#b3261e`, ok `#2f6b4f`.
- Tipo: Newsreader (títulos, números grandes) + Inter (interface). Escala 12/13/14/16/18/22/28/36/48.
- Espaço: base 4 (4, 8, 12, 16, 20, 24, 32, 40, 56, 72). Raios: 8 (controles), 12 (cards), 16 (painéis), 999 (pílulas).
- Elevação: 0 (padrão), 1 (cards: borda), 2 (popover/sheet: sombra suave única).
- Motion tokens: `fast 140ms`, `base 220ms`, `slow 420ms`; ease `[0.22,1,0.36,1]`; spring padrão `{stiffness: 420, damping: 34}`; card arrastado `{stiffness: 520, damping: 38}`.
- Botões: 1 primário por tela/contexto (dourado escuro sobre tinta), secundário (borda), terciário (texto). Destrutivo sempre separado, com confirmação e "desfazer" quando possível. Ação primária à direita em diálogos; no card, "Enviar" junto do campo de mensagem (Fitts).

## 7. Telas

- `/login`, `/convite/[token]`
- `/` **Hoje**: esperando resposta (com cronômetro), follow-ups do dia, agendamentos do dia, aniversários da semana, cobranças e recontatos do dia.
- `/funil` kanban por etapa (arrastar entre colunas), busca e filtro por responsável/origem. Clique abre o **card** em painel lateral (`/funil?lead=ID`).
- `/contatos` lista + importação CSV.
- `/relatorios` painel + exportação CSV.
- `/config/*` (gestor): etapas e prazos, automações, listas (objeções, motivos de perda, respostas rápidas), WhatsApp (QR), equipe.
- `/dev/simulador` (só com `DEV_TOOLS=true`).

## 8. Migração para o Contabo (resumo; detalhe em `docs/deploy-contabo.md`)

Mesmo `docker-compose.yml` (db + evolution) + app/worker com `npm run build && npm start` sob pm2 (ou container). Variáveis só por `.env`. Migrações `npm run db:migrate`. Backup `pg_dump` diário. TLS via proxy reverso (Caddy). Nada dependente de serviço externo pago.
