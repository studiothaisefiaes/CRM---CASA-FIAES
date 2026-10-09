# CRM Casa Fiaes

Atendimento e funil de vendas da Casa Fiaes: toda conversa do WhatsApp vira um lead, o card anda sozinho pelo funil, quem atende é avisado quando atrasa, e a gestão acompanha os números.

## O que já funciona (MVP)

- **Lead automático** a partir de mensagens do WhatsApp (Evolution API), com origem detectada (anúncio, Instagram, indicação, já é cliente).
- **Funil** com arrastar entre etapas, cronômetro de espera ao vivo e card vermelho ao estourar o prazo.
- **Card do lead**: conversa, resposta pelo próprio card com respostas prontas (`/`), dados que salvam sozinhos, histórico.
- **Movimento automático**: respondeu (pelo CRM ou pelo celular) → Atendimento; cliente sumiu → Follow-up 1 a 4, um por dia; cliente voltou → Atendimento.
- **Alertas**: 2 min sem resposta, parado há 1 dia, aniversário em 7 dias, cobrança, recontato. Sino, som e notificação do navegador.
- **Automações editáveis** ("Quando / Se / Então") com teste, liga/desliga, versões e histórico de execuções.
- **Relatórios** por período e filtros, com exportação CSV que abre no Excel.
- **Contatos** e importação do histórico de clientes (CSV).
- **WhatsApp**: conectar números por QR code, com estados e renovação automática.
- **Equipe**: convite por link, papéis (gestão / atendimento), desativação.
- Tempo real (SSE), celular (layout próprio), acessibilidade (foco, teclado, `prefers-reduced-motion`).

## Rodar local

Requisitos: Node 20.9+, Docker (Colima ou Docker Desktop).

```bash
cp .env.example .env        # ajuste as chaves (EVOLUTION_API_KEY, WEBHOOK_SECRET, SESSION_SECRET)
npm install
npm run infra:up            # Postgres 17 + Evolution API 2.3.7
npm run db:migrate          # cria as tabelas
npm run db:seed             # etapas, listas e automações padrão (pode rodar de novo)
npm run seed:admin -- --email voce@casafiaes.com.br --name "Seu nome"   # primeiro acesso de gestão
npm run dev                 # app em http://localhost:3000
npm run worker              # em outro terminal: automações a cada minuto
```

Sem um número pareado, use o **simulador** em `/dev/simulador` (só com `DEV_TOOLS=true`) para mandar mensagens de teste. Mensagens enviadas pelo card ficam marcadas como "simulado".

## Testes

```bash
npm test          # 62 testes de domínio, regras, webhook, relatórios, importação, auth (banco crm_test)
npm run e2e       # 11 testes no navegador, desktop e celular (banco crm_e2e, servidor na porta 3100)
npm run typecheck && npx eslint src
```

## Estrutura

```
src/server/        domínio sem React: db (Drizzle), auth, domain (leads, envio, importação, config), rules (motor), whatsapp, reports, queries
src/app/           rotas (App Router): (app)/ telas autenticadas, api/ webhook, SSE e CSV, login, convite, dev/simulador
src/components/    design system (ui/), shell, pipeline, lead, config, reports, today
worker/            processo separado (pg-boss): automações, reprocessamento de webhooks, limpeza
drizzle/           migrações SQL versionadas
docs/              especificação, plano e guia de deploy
```

## Decisões e premissas

Ver `docs/superpowers/specs/2026-10-09-crm-casa-fiaes-mvp.md` (§2 Premissas). Resumo: QR code = conexão de números do WhatsApp; tokens visuais provisórios até o manual de marca; Instagram e transcrição de áudio ficam para a fase 2.

## Licença de terceiros

Usa a **Evolution API** (Apache 2.0 com condição de atribuição): este CRM integra com a Evolution API (https://github.com/evolution-foundation/evolution-api).
