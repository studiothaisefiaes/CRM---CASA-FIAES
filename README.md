# CRM Casa Fiaes

Atendimento e funil de vendas da Casa Fiaes: toda conversa do WhatsApp vira um lead, a Fila diz quem atender agora, o lead anda sozinho pelas etapas, quem atende é avisado quando atrasa, e a gestão acompanha os números.

## O que funciona

- **Lead automático** a partir de mensagens do WhatsApp (Evolution API). A **origem** é separada do canal: link/QR por origem (`#código` na 1ª mensagem), "Como conheceu?" no painel ou "Não identificada".
- **Fila de atendimento** (`/atendimento`): seções por urgência (atrasados, perto do prazo, aguardando, próximas ações, parados…), conversa ao lado no desktop e em tela cheia no celular, "Próximo da fila" depois de responder, triagem em massa com Desfazer.
- **Painel do cliente**: situação e "por que está esperando", etapas tocáveis com auditoria, assumir/transferir, agendar, Compareceu/Faltou, fechar venda em 4 toques (valor, pagamento, serviço), perdido com motivo, "Não é cliente" com Desfazer, próxima ação (tarefas).
- **Conversa**: respostas prontas (`/`), anexos e áudio, citação, visto, mensagem nova sem pular a rolagem.
- **Quadro** (`/funil`) com arrastar entre etapas e **Jornada** (`/jornada`) do primeiro contato à venda.
- **Contatos** com ficha (`/contatos/[id]`): histórico de leads, vendas e total gasto; importação de clientes por CSV.
- **Alertas** únicos por espera (responsável aos 2 min, gestão aos 10 min), sino, som, título da aba e **push no celular** (PWA, opcional com VAPID). Modo quieto de 30 min. Banner quando o WhatsApp cai.
- **Envios automáticos** (lembrete na véspera, confirmação D-1 por enquete, resposta fora do horário) com teto por hora. **Todos nascem desligados**: ligar exige aprovação da Casa.
- **Automações editáveis** ("Quando / Se / Então") com modelos, teste, liga/desliga, versões e histórico.
- **Relatórios** (`/relatorios`): abas Visão geral e Análise, período e filtros na URL, números com drill-down para a Fila filtrada, CSV que abre no Excel. Atendente não vê R$ nem os blocos da gestão.
- **Hoje** (`/`): quem está esperando, "Atender próximo", agenda do dia e o resumo da gestão.
- **Segurança e operação**: CSP com nonce, mídia servida em sandbox, rate limit por IP atrás do proxy, auditoria de/para, `/api/health` com o heartbeat do worker, backup e teste de restauração.

## Rotas

| Rota | O que é |
| --- | --- |
| `/` | Hoje: esperando agora, "Atender próximo", agenda, resumo da gestão |
| `/atendimento` | Fila. Parâmetros: `lead=<id>` (abre a conversa), `view=todos\|meus\|sem-dono\|parados\|agendados-hoje\|clientes-ativos\|sem-contato-90d`, `filtro=atrasados\|esperando\|parados`, `etapa=<chave>`, `foco=aguardando\|atrasados`, `dono=`, `fonte=` |
| `/atendimento/[id]` | Conversa em tela cheia (celular), com abas Conversa, Dados e Histórico |
| `/atendimento/[id]/cliente` | Painel do cliente em tela cheia (celular) |
| `/funil` | Quadro por etapas (arrastar) |
| `/jornada` | Jornada do lead por marcos |
| `/contatos`, `/contatos/[id]` | Busca de contatos e ficha do contato |
| `/relatorios` | `aba=visao\|analise`, `periodo=hoje\|7d\|mes\|ano`, filtros por pessoa e origem |
| `/config/*` | Só gestão: `automacoes`, `mensagens`, `whatsapp`, `origens`, `equipe`, `etapas`, `listas` |
| `/login`, `/convite/[token]` | Entrada e aceite de convite |
| `/dev/simulador` | Simulador de mensagens (só com `DEV_TOOLS=true` e fora de produção) |
| `/api/health` | Saúde: banco, heartbeat do worker e cada número do WhatsApp |
| `/api/relatorios/[tipo]` | CSV de cada relatório |
| `/api/stream` | Tempo real (SSE) |
| `/api/webhooks/evolution` | Webhook da Evolution (com `x-webhook-secret`) |
| `/api/media/[id]`, `/api/avatar/[id]` | Mídia e foto do contato (autenticadas) |

## Rodar local

Requisitos: Node 20.9+, Docker (Colima ou Docker Desktop).

```bash
cp .env.example .env        # ajuste as chaves (EVOLUTION_API_KEY, WEBHOOK_SECRET, SESSION_SECRET)
npm install
npm run infra:up            # Postgres 17 + Evolution API 2.3.7
npm run db:migrate          # cria/atualiza as tabelas (migrações 0000 a 0010)
npm run db:seed             # etapas, listas e automações padrão (idempotente)
npm run seed:admin -- --email voce@casafiaes.com.br --name "Seu nome"   # primeiro acesso de gestão
npm run dev                 # app em http://localhost:3000
npm run worker              # em outro terminal: automações, alertas e envios a cada minuto
```

Sem um número pareado, use o **simulador** em `/dev/simulador` (só com `DEV_TOOLS=true`; em `NODE_ENV=production` ele fica sempre desligado). Sem WhatsApp conectado e com `DEV_TOOLS=true`, as mensagens enviadas ficam marcadas como "simulado".

## Scripts

| Comando | Para quê |
| --- | --- |
| `npm run db:migrate` / `npm run db:generate` | Aplicar / gerar migrações (Drizzle) |
| `npm run db:seed` | Etapas, listas, respostas prontas e automações padrão (não sobrescreve edições da gestão) |
| `npm run seed:admin -- --email … --name …` | Cria o primeiro usuário de gestão |
| `npm run vapid` | Gera o par de chaves VAPID do push no celular (`scripts/vapid.ts`); cole no `.env` |
| `npm run worker` | Processo do worker (pg-boss) |
| `bash scripts/backup.sh` | Backup dos bancos `crm` e `evolution`, da mídia e da sessão do WhatsApp em `BACKUP_DIR` (14 dias) |
| `bash scripts/restore.sh <pasta> [--into-db nome] [--dump crm\|evolution] [--yes-overwrite-production]` | Restaura um backup; por padrão só em bancos `crm_restore*` |
| `bash scripts/restore-test.sh [--descartar]` | Faz um backup e restaura tudo em alvos temporários, conferindo contagens. `--descartar` não guarda o backup gerado |
| `node scripts/perf-fila-quadro.mjs` | Mede tarefas longas na Fila e no Quadro (build de produção, CPU 4x, 100 leads, banco `crm_e2e`, porta `PERF_PORT`, padrão 3190) |

Roteiro de backup em `docs/backup-restauracao.md`; deploy em `docs/deploy-contabo.md`.

## Variáveis de ambiente

Todas estão comentadas no `.env.example`. Obrigatórias: `DATABASE_URL`, `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `WEBHOOK_SECRET`, `WEBHOOK_PUBLIC_URL`, `SESSION_SECRET`, `APP_URL` (e `PG_*`/`EVOLUTION_PORT` para o Docker Compose). Opcionais:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `DEV_TOOLS` | `false` | Liga o simulador (ignorado em produção) |
| `TRUSTED_PROXY_HOPS` | `1` | Proxies confiáveis na frente do app (Caddy = 1; dev local = 0). Define o IP do rate limit |
| `BACKUP_DIR` | `$HOME/backups/casa-fiaes-crm` | Pasta dos backups, fora do repositório (caminho absoluto) |
| `MEDIA_DIR` | `./data/media` | Mídia baixada do WhatsApp (entra no backup). Nada é apagado dela até a gestão escolher um prazo em Configurações › WhatsApp (padrão "Não apagar") |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | — | Push no celular; sem o par, o push fica desligado sem erro |
| `VAPID_SUBJECT` | `APP_URL` | Contato (`mailto:`/`https:`) exigido pelo serviço de push |
| `TZ` | `America/Bahia` | Fuso das datas (o app e o worker já definem se faltar) |
| `CRM_DIR` | `/opt/crm` | Raiz do projeto para o `deploy/ecosystem.config.cjs` (pm2) |

Só para testes: `NEXT_DIST_DIR` (pasta de build separada), `PERF_PORT` e `CF_SHOTS_DIR` (prints dos specs).

## Testes

```bash
npm test                       # vitest: domínio, regras, webhook, relatórios, importação, auth (banco crm_test) — 652 testes
npm run e2e                    # Playwright: desktop 1440, iPhone 13 e axe (banco crm_e2e, dev server na porta 3100)
npm run typecheck && npx eslint src worker e2e --quiet
```

## Estrutura

```
src/server/        domínio sem React: db (Drizzle), auth, domain (leads, envio, fila de envios, tarefas, origens, importação, config), rules (motor), whatsapp, reports, queries, security (CSP)
src/app/           rotas (App Router): (app)/ telas autenticadas, api/ webhook, SSE, saúde, mídia e CSV, login, convite, dev/simulador
src/components/    design system (ui/), shell, queue (Fila e conversa), lead, pipeline (Quadro), journey, contacts, reports, today, config, motion
src/lib/           utilitários compartilhados entre cliente e servidor (Fila, links dos relatórios, dinheiro, horário de funcionamento, motion)
worker/            processo separado (pg-boss): automações, alertas, envios automáticos, push, reprocessamento de webhooks, limpeza
scripts/           backup, restauração, teste de restauração, medição de desempenho, VAPID, seeds
drizzle/           migrações SQL versionadas (0000 a 0010)
docs/              especificações, planos, deploy e backup
```

## Decisões e premissas

Ver `docs/superpowers/specs/2026-10-09-crm-casa-fiaes-mvp.md` e `docs/superpowers/specs/2026-10-09-crm-melhorias-completas-design.md` (§2 Decisões). Resumo: deploy, migração destrutiva, envio de mensagem real e envio em massa precisam de aprovação; toda automação que envia mensagem nasce desligada; Instagram e transcrição de áudio ficam para depois.

## Licença de terceiros

Usa a **Evolution API** (Apache 2.0 com condição de atribuição): este CRM integra com a Evolution API (https://github.com/evolution-foundation/evolution-api).
