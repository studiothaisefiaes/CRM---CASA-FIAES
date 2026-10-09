# CRM Casa Fiaes: melhorias completas (especificação)

Data: 09/10/2026.

**Fontes:**
- investigação em `~/Projects/casa-fiaes/investigacao-2026-10-09/` (01–06);
- doc "CRM Casa Fiaes — Investigação e roadmap";
- revisão do GPT ("APROVADO COM AJUSTES");
- decisões do dono no chat.

A spec do MVP (`2026-10-09-crm-casa-fiaes-mvp.md`) continua valendo para o que não for alterado aqui.

## 1. Objetivo e critério de sucesso

A equipe atende o próximo lead em até 2 minutos, no computador e no celular, sem esquecer ninguém. A gestora confia nos números, e o sistema está pronto para subir no Contabo.

**Sucesso:**
- 0 falhas de segurança conhecidas;
- todo atraso toca no aparelho de quem atende;
- os números batem com os SQLs de referência do doc 04;
- os critérios de conclusão da §12 são verificados por teste automatizado ou no navegador.

## 2. Decisões (fixas)

| # | Decisão | Origem |
|---|---|---|
| D1 | O atendimento é feito por **celular e por computador** | Dono |
| D2 | O risco de bloqueio do número está aceito | Dono |
| D3 | Resumo e alertas aparecem **só dentro do sistema** (sem WhatsApp para a gestora) | Dono |
| D4 | Sem aviso de uso de dados às clientes. A proteção técnica continua: login, retenção e backup | Dono |
| D5 | Horário padrão: seg–sex 8–20h, sáb 8–17h, fuso America/Bahia, editável em Configurações | Premissa; a Casa ainda não confirmou |
| D6 | **Fila** é a tela principal; **Jornada** é a visão da gestora; **Quadro (kanban)** é a visão secundária | GPT + recomendação |
| D7 | Sem Three.js e sem GSAP. Animação só com a biblioteca Motion, que já está no projeto | Investigação 03 |
| D8 | Sem ranking de atendentes. O acompanhamento individual é feito contra a meta e contra o próprio histórico | Investigação 04 |
| D9 | Avec: a estrutura fica pronta e o recurso aparece como **bloqueado**. Nenhum dado é inventado | GPT + revisão cética |
| D10 | Precisam de aprovação: deploy, migração destrutiva, envio de mensagem real, envio em massa e qualquer decisão da Casa. **Toda automação que envia mensagem nasce desligada** | Dono |

## 3. Arquitetura (o que muda)

A stack continua a mesma: Next 16.4 App Router, Drizzle/Postgres, worker com pg-boss, SSE, Evolution 2.3.7. Mudanças:

- **Rotas de atendimento:**
  - `/atendimento` = Fila.
  - No desktop, a Fila mostra 3 painéis: fila, conversa (`?lead=`) e cliente.
  - No celular, vira uma sequência de telas: `/atendimento` → `/atendimento/[id]` → `/atendimento/[id]/cliente`.
  - A posição, os filtros e a rolagem da fila ficam guardados em `sessionStorage` + URL.
  - `/funil` passa a se chamar "Quadro" e continua acessível.
  - `/jornada` é a visão da gestora.
- **Tempo real seletivo:** o SSE envia `{type, dealId, scope}`. Cada tela assina só os escopos que mostra, e a Fila atualiza só o item e a contagem. O `router.refresh` geral fica restrito a quando não há assinante local.
- **Serviços novos no worker:**
  - `retencao-midia` (diário);
  - `escalonar-alertas` (minuto, dentro do motor);
  - `push` (envio do Web Push);
  - `lembretes` (tarefas vencendo);
  - `modo-quieto` (saída automática).
- **Push:** Web Push com chaves VAPID geradas no setup. O Service Worker fica em `public/sw.js`. Dependência nova: `web-push`, gratuita.
- **Testes:** dependência de dev `@axe-core/playwright` para acessibilidade nos e2e.

## 4. Modelo de dados (migrações aditivas; nada destrutivo)

| Tabela / coluna | Para quê |
|---|---|
| `deals.archived_at`, `archived_by`, `archived_stage_id` | "Não é cliente" reversível (não apaga mais em cascata) |
| `deals.source_id` → `lead_sources.id`; `deals.source_label` | **Origem** separada do canal (`channel_id`). O antigo `origin` fica como legado, para leitura; descartá-lo é migração destrutiva e precisa de aprovação |
| `lead_sources` (`id`, `code` único, `label`, `kind` instagram/google/panfleto/indicacao/anuncio/recepcao/outro, `prefill`, `referrer_contact_id?`, `active`) | Link e QR por canal |
| `deals.service_id` → `lists(kind='service')`, com `lists.cycle_days` | Serviço e ciclo de retorno |
| `deals.paid_at`, `paid_cents` | Cobrança paga |
| `deals.attendance` (`compareceu`/`faltou`/`remarcou`), `attendance_at` | Comparecimento |
| `tasks` (`id`, `deal_id?`, `contact_id`, `kind` proxima_acao/retorno/comparecimento/geral, `title`, `due_at`, `assignee_id?`, `done_at?`, `created_by`) | **Próxima ação** com data e responsável, lembrete de retorno e marcação de comparecimento |
| `deal_events` `campo_alterado.payload = {campos:[{campo,de,para}]}` | Auditoria com valor antigo e novo |
| `deal_events` `resposta.payload` + `stage`, `slaSeconds`; `lead_criado.payload` + `initialStage`, `historico` | Relatório de primeira resposta certo |
| `alerts.wait_key`, `level` (1 = responsável, 2 = gestão), `escalated_at` | Um alerta por espera, que escala |
| `channels.quiet_until` | Modo quieto de 48 h depois de parear |
| `messages.media_purged_at` | Retenção de 12 meses |
| `push_subscriptions` (`user_id`, `endpoint` único, `p256dh`, `auth`, `created_at`, `last_ok_at`) | Notificação no celular |
| `contacts.last_auto_reply_at` | Resposta fora do horário (no máximo 1 a cada 12 h por contato) |
| `settings`: `auto_resposta`, `envio_teto_hora`, `retencao_midia_meses` | Configurações novas |

## 5. Segurança e confiabilidade

- **S1 Mídia segura:**
  - o tipo real do arquivo é detectado pela assinatura (*magic bytes*): JPEG, PNG, WebP, GIF, OGG/Opus, MP3, MP4/M4A, WebM, PDF;
  - **só esses abrem no navegador** (`inline`); todo o resto vai com `Content-Disposition: attachment` e `application/octet-stream`;
  - todas as respostas levam `nosniff` e `Content-Security-Policy: sandbox`;
  - o nome do arquivo é sanitizado.
- **S2 Cabeçalhos globais** (`next.config.ts` `headers()` + CSP no `proxy.ts`):
  - CSP com `default-src 'self'`, `img-src 'self' data: blob:`, `media-src 'self' blob:` e `connect-src 'self'`;
  - em dev, `'unsafe-eval'` e o websocket do HMR;
  - `script-src 'self' 'nonce-…' 'strict-dynamic'`, com o nonce gerado por requisição no `proxy.ts` (guia oficial `content-security-policy.md` do Next 16; o app já é 100% dinâmico);
  - `style-src 'self' 'unsafe-inline'`, porque o Motion anima por atributo `style`;
  - o cabeçalho de segurança da página fica no `proxy.ts`; os demais vão no `next.config.ts`;
  - `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (câmera e geolocalização off, notificações on), `X-Frame-Options: DENY`.
- **S3 Rate limit pelo IP real:** o IP vem de `TRUSTED_PROXY_HOPS` (env, padrão 1 atrás do Caddy). Fora disso, usa o IP da conexão. Cobre o login, o convite e o webhook (este por segredo e por limite).
- **S4 Retenção:** um job diário marca `media_purged_at` e apaga o arquivo da mídia com mais de `retencao_midia_meses` (padrão 12). O registro da mensagem fica, e a tela mostra "mídia expirada".
- **S5 Backup e restauração:**
  - `scripts/backup.sh` gera, numa pasta com data: `pg_dump -Fc` dos bancos `crm` e `evolution`, um tar do `MEDIA_DIR` e um tar do volume de instâncias da Evolution;
  - o pacote tem checksum, rotação de 14 dias e permissões 600;
  - `scripts/restore.sh` faz a restauração com verificação;
  - `docs/backup-restauracao.md` explica o processo, e um teste de restauração roda num banco temporário.
- **S6 "Não é cliente" reversível:**
  - `archived_at` em vez de delete, e o contato fica com `ignored=true`;
  - "Desfazer" restaura a etapa e o dono;
  - existe triagem em massa (seleção na Fila e em Contatos), e tudo fica na auditoria;
  - todas as consultas (Fila, Quadro, Hoje, Relatórios e motor) ignoram leads arquivados.
- **S7 Modo quieto:**
  - ao parear (`connection.update` open com número novo ou reconectado depois de logout), `quiet_until = now() + 48h`;
  - o motor não cria alerta nem move follow-up de leads cujo canal está em modo quieto, e o lead importado do histórico não abre espera;
  - um banner mostra "Modo quieto até sex 14:30 · Encerrar agora";
  - quem decide é o backend.
- **S8 Health:** `/api/health` informa o banco, o worker (heartbeat em `settings.worker_heartbeat` a cada minuto, considerado ok se tiver menos de 3 min) e cada canal do WhatsApp. Responde 503 se o banco cair; se só o WhatsApp cair, o estado fica `degraded`.

## 6. CRM

- **C1 Fila** (ver o wireframe do GPT, §12 do documento de revisão):
  - Ordem:
    1. Atrasados;
    2. Perto do prazo;
    3. Aguardando (tudo pela maior espera de expediente);
    4. Uma seção "Próximas ações de hoje";
    5. Uma seção "Aguardando a cliente", recolhida.
  - Ninguém some da fila: um lead sem próxima ação há mais tempo que `stale_days` aparece em "Parados".
  - Cada item mostra: foto, nome, tempo esperando (anel e texto), última mensagem, etapa, origem, dono e as etiquetas de sinal.
- **C2 Painel do cliente:**
  - etapa (barra de etapas no estilo Path) e dono com **Assumir**;
  - serviço, origem, canal, próxima ação (texto, data e responsável) e o motivo do atraso em linha;
  - ações: Agendar, Fechar venda (com chips de pagamento, serviço e valor), Perdido, Não é cliente;
  - histórico resumido.
- **C3 Assumir:** define `owner_id = eu` e registra o evento `assumiu`. Uma resposta pelo celular é atribuída a quem assumiu.
- **C4 Valor em reais:** um parser único `parseBRL` aceita `1.234,56`, `1234,56`, `1234.56`, `1.234` e `R$ 1.234,56`. A ambiguidade de `1.234` é resolvida como milhar. Valores são guardados em centavos.
- **C5 Agendar e comparecimento:** ao agendar, cria a tarefa `comparecimento` para o dia seguinte. A Fila e o Hoje mostram os botões "Compareceu" e "Faltou".
- **C6 Ficha do contato** (`/contatos/[id]`):
  - todos os leads, a conversa completa, as tarefas e a auditoria;
  - "Iniciar conversa" cria o lead e abre o campo de mensagem (o envio é manual);
  - a busca encontra por nome, telefone e trechos de mensagem (`ILIKE` com índice trigram).
- **C7 Views prontas** (fixas, sem editor): "Meus leads", "Sem dono", "Parados", "Agendados hoje", "Clientes ativos", "Sem contato há 90 dias".
- **C8 Auditoria:** antes e depois em toda alteração de campo; a ficha mostra uma linha do tempo.
- **C9 Quadro (kanban):**
  - o atual, com follow-ups agrupados e Fechado e Perdido recolhidos;
  - ordenação por urgência;
  - mover por teclado com KeyboardSensor.
- **C10 Jornada** (gestora): as estações com contagens e a foto de quem está em cada uma; clicar abre a Fila filtrada.

## 7. WhatsApp, alertas e automação

- **W1 Enviar mídia** pelo CRM (imagem, PDF, áudio gravado ou arquivo, até 16 MB) e **responder citando** (`quoted`).
- **W2 Visto azul ao abrir:** quando alguém abre a conversa, chama `markMessageAsRead` nas mensagens recebidas não lidas. Só para quem está logado e vendo a conversa.
- **W3 Alerta único com escalonamento:**
  - cada espera gera um `wait_key` = `dealId` + `awaitingReplySince`;
  - no nível 1 vai para o dono (ou para a gestão, se o lead não tiver dono);
  - depois de 10 min sobe para o nível 2 (gestão), atualizando o mesmo alerta;
  - a resposta resolve o alerta;
  - nunca há mais de um alerta ativo por espera.
- **W4 Avisos no aparelho:** quando o lead **cruza** o prazo:
  - toca um som uma vez;
  - o título da aba vira "(N) atrasados";
  - vai uma notificação push para o dono (com o celular bloqueado, via PWA);
  - "Silenciar 30 min" continua valendo.
- **W5 Painel de alertas:** no celular é um *bottom sheet* via portal, fora do header com blur. Esc fecha. Tocar no alerta abre o lead.
- **W6 Banner de conexão:** aparece em todas as telas quando o WhatsApp cai ou fica preso reconectando, com base no vigia que já existe.
- **W7 Resposta fora do horário:**
  - template editável;
  - enviada a quem escreveu primeiro, no máximo 1 a cada 12 h por contato;
  - **nasce desligada** e ligar exige aprovação (D10);
  - conta no teto de envios.
- **W8 Teto de envios automáticos:** `envio_teto_hora` (padrão 30) vale para todos os envios automáticos (lembrete, resposta fora do horário, confirmação). Acima do teto, o envio fica em fila e vai para o próximo minuto livre.
- **W9 Automações por modelos:** uma galeria de 8 modelos que preenchem o editor, como "Lead sem resposta", "Follow-up diário", "Aniversário" e "Retorno de serviço".
- **W10 Origem por link e QR:**
  - Configurações › Origens gera, por canal, o link `wa.me/<número>?text=<prefill> [#code]` e um QR em PNG/SVG para baixar;
  - o webhook reconhece o código na **primeira mensagem** do lead (busca o `#code` no texto e, de reserva, a frase exata do prefill) e grava `source_id`;
  - se não reconhecer, a origem fica "Não identificada" e a pergunta "Como conheceu?" aparece no painel.
- **W11 Confirmação D-1 por enquete:** `sendPoll` ("Confirmo" / "Preciso remarcar"); o voto atualiza a tarefa e o comparecimento. **Nasce desligada.**

## 8. Relatórios

Os SQLs de referência estão no doc 04, §3. Todos excluem leads arquivados e contatos ignorados, e os leads de histórico importado ficam fora das contagens de "novos".

| ID | Relatório | Tela |
|---|---|---|
| R1 | Resumo das 19h em texto (gerado a qualquer hora para "hoje", com destaque a partir das 19h) | Hoje (gestão) + topo de Relatórios |
| R2 | 5 números com comparação ao período anterior (hoje é comparado com ontem até a mesma hora) e n visível | Relatórios |
| R4 | Primeira resposta em faixas, com p50 e p90 e a meta por etapa | Relatórios |
| R5 | Funil por marcos com conversão de cada etapa, Perdido à parte e aviso de "em aberto" | Relatórios |
| R6 | Parados agora, por etapa | Relatórios + Hoje |
| R8 | Origem até a venda; "Não identificada" sempre aparece; % só com n ≥ 20 | Relatórios |
| R9 | Perdas por motivo e por etapa; objeções por resultado | Relatórios |
| R10 | Eficácia de cada follow-up | Relatórios (aba Análise) |
| R11 | Mapa de calor hora × dia | Relatórios (aba Análise) |
| R13 | Financeiro com pago, vencidas e a vencer | Relatórios (gestão) |
| R15 | Faixa de qualidade dos dados | Rodapé de Relatórios |
| R16 | % respondido pelo CRM × pelo celular | Relatórios |
| R7 | Pessoa contra a meta e contra o próprio histórico, só com n ≥ 20 e em ordem alfabética | Relatórios (gestão) |

- **Drill-down:** todo número clicável abre a Fila ou o Quadro com o filtro correspondente na URL.
- **CSV:** mantido.
- **Visualização:** barras, bullet graph e heatmap em tom único. Sem pizza e sem gauge.

## 9. Visual, celular e acessibilidade

- **Tokens** (`globals.css @theme`):
  - escala de texto com 8 passos (12, 13, 14, 16, 18, 22, 28, 40);
  - raios: control 10, card 14, panel 18;
  - `gold-ink #946c2e` para texto pequeno;
  - borda de campo com ≥ 3:1;
  - codemod para trocar os valores soltos.
- **Componentes:** `ui/Select`, `ui/Tabs`, `ui/Menu` (Esc, setas e foco), `ui/IconButton` (44 px no toque), `ui/Sheet` (modal acessível com `aria-modal`, foco inicial, Esc e retorno do foco).
- **Celular:** campos com 16 px, alvos de 44 px, nenhuma rolagem lateral em 390 px, cabeçalho do lead compacto e navegação inferior ajustada (Hoje, Atendimento, Contatos, Relatórios, Mais).
- **Leitor de tela:** os itens da Fila são `listbox`/`option`; o anúncio de "lead atrasado" usa `aria-live=polite`.
- **Verificação:** axe nos e2e com 0 violações sérias ou críticas.

## 10. Motion

- **Tokens:** `src/lib/motion.ts` com durações de 100, 150, 200, 250 e 300 ms, saída mais curta que a entrada e molas sem quique.
- **Componentes:**
  - `useCrossedThreshold`: pulso único quando o lead atrasa, no lugar do pulso infinito (WCAG 2.2.2);
  - `ChangeFlash`;
  - `Bar` com `scaleX`;
  - `Sheet` que troca de lead sem fechar;
  - saída da Fila só com opacidade e altura via FLIP;
  - arrastar respeitando "reduzir movimento";
  - conversa abrindo já no fim, sem rolagem suave.
- **Desempenho:** o cronômetro não faz medição de layout (`layoutDependency`, `memo` e componentes folha para o relógio).
- **Card instantâneo:** o painel abre na hora com os dados do item da Fila; a conversa carrega depois.
- **Não fazer:** transições de página nem View Transitions.

## 11. Extras

- **E1 Relógio de manutenção:**
  - uma venda com serviço que tem `cycle_days` cria a tarefa "retorno" para `fechamento + cycle_days`;
  - no dia, a tarefa aparece na Fila com o rascunho da mensagem;
  - **o envio é manual**.
- **E2 Etiquetas de sinal:** são regras sobre a conversa: "pediu preço" (`/valor|preço|quanto/`), "pediu horário", "sumiu após preço" e "respondeu rápido". **Só informativas; não reordenam a fila.**
- **E3 Importação com pré-visualização:** CSV com mapeamento de colunas, duplicados detectados pelo telefone e um resumo antes de confirmar. A importação periódica do Avec fica **bloqueada (D9)**.
- **E4 Mapa de calor:** é o R11.

## 12. Critérios de conclusão (do GPT, verificáveis)

1. A equipe acha e atende o próximo lead no desktop e no celular, e ao voltar para a Fila os filtros, a rolagem e a posição continuam iguais (e2e).
2. O SLA de 2 min respeita o horário e diferencia "atrasado" de "fora do expediente" (unitário + e2e).
3. "Assumir" atribui a resposta, inclusive a dada pelo celular (unitário).
4. Fechar venda grava serviço, valor e pagamento, sem duplicar (unitário + e2e).
5. Origem e canal são campos distintos; o link e o QR atribuem a origem (unitário).
6. A ficha mostra o histórico e permite iniciar conversa (e2e).
7. A auditoria tem valor antigo, valor novo, autor e data (unitário).
8. "Não é cliente" pode ser desfeito, individualmente e em massa (unitário + e2e).
9. O modo quieto impede alertas e follow-ups por 48 h depois do pareamento (unitário).
10. Mídia e cabeçalhos seguem a §5 (teste de rota + teste de cabeçalhos).
11. O backup e a restauração cobrem banco, mídia e sessão da Evolution (script testado em banco temporário).
12. O health mostra o banco, o worker e o WhatsApp (unitário).
13. O que depende do Avec aparece como "bloqueado", sem dados fictícios (revisão).
14. O deploy fica pronto com roteiro de rollback, mas não é executado (revisão).
15. Saem limpos: `tsc`, `eslint`, `vitest`, `playwright` (incluindo o axe) e `next build`.

## 13. Fora do escopo / bloqueado

**Bloqueado:**
- importação periódica do Avec e relatórios de retorno por coorte;
- deploy no Contabo (aguarda aprovação);
- ligar as automações que enviam mensagem (aguarda aprovação);
- descartar a coluna `origin` (migração destrutiva);
- horário real (premissa D5 até a Casa confirmar).

**Fora do escopo:**
- 3D, GSAP, ranking e personalização livre de views;
- busca em linguagem natural, copiloto de IA, transcrição de áudio e Instagram (fase futura);
- sinal por Pix e lista de espera, que dependem da agenda do Avec.
