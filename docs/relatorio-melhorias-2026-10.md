# Relatório da rodada de melhorias do CRM Casa Fiaes (outubro de 2026)

- **Branch:** `melhorias-completas`, criado a partir de `main` @ `c627f30`. HEAD `460aa89`, com cerca de 100 commits.
- **Plano:** `docs/superpowers/plans/2026-10-09-crm-melhorias-completas.md`.
- **Spec:** `docs/superpowers/specs/2026-10-09-crm-melhorias-completas-design.md`.

**Nada foi publicado:**
- o banco `crm` (dados reais) não foi alterado;
- nenhuma mensagem real foi enviada;
- nenhuma automação foi ligada.

## 1. Funcionalidades

### Atendimento: Fila (`/atendimento`), a tela principal
- **Seções:** atrasados, prazo estourado, perto do prazo, aguardando resposta, agendados e "Para reengajar".
- **Filtros:** chips de foco (`?foco=`) e busca.
- **Navegação:** a posição da rolagem é guardada; o "Próximo da fila" e o teclado também funcionam.
- **Conversa:**
  - envio de texto, foto, PDF, áudio e vídeo;
  - responder citando a mensagem;
  - confirmação de leitura;
  - aviso de "nova mensagem";
  - tela cheia no celular.
- **Painel da cliente:**
  - Assumir e Transferir;
  - Agendar, com aviso fora do expediente;
  - Fechar venda: serviço, valor e pagamento, sem duplicar;
  - Perdido, com motivo;
  - Não é cliente, com Desfazer;
  - etapas;
  - próxima ação;
  - "Como conheceu a Casa?";
  - Compareceu/Faltou, onde Faltou cria a tarefa "Remarcar";
  - histórico com auditoria.
- **Ações em massa** na Fila e em Contatos.

### Prazo e alertas
- **Prazo de 2 min:** conta só no horário de expediente (America/Bahia) e separa "atrasado" de "fora do expediente". Existe uma regra única de atraso, usada pelo sino, pela Fila, pelo Quadro, pela Jornada, pelo Hoje e pelo título da aba.
- **Alertas:** um por espera, com escalonamento para a gestão.
- **Avisos:** sino, som (com "Toque para ativar o som" quando o navegador bloqueia) e push no celular (VAPID opcional).
- **Modo quieto:** 48 h depois de parear um número.

### Telas
- **Contatos:** ficha (`/contatos/[id]`) com histórico, "Iniciar conversa", busca por trecho de mensagem e importação de CSV com prévia.
- **Quadro:** ordenado por urgência e com teclado. Não deixa mover para Agendado, Fechado ou Perdido sem a ação própria.
- **Jornada** (`/jornada`): visão da gestão dos últimos 30 dias.
- **Hoje:** resumo sempre no topo, "Minhas próximas ações" e "Comparecimentos para conferir".
- **Relatórios:**
  - abas Visão geral e Análise;
  - coortes, funil monotônico e comparação com o período anterior;
  - drill-down para a Fila filtrada;
  - CSV protegido contra fórmula.
- **Origem por link e QR:** a origem e o canal são campos separados.

### Automações
- 8 modelos, todos **desligados**: resposta automática, confirmação D-1, lembrete e outros.
- O envio passa por uma fila com teto por hora (30/h), cadeado e regra de "envio incerto": na dúvida, nunca reenvia.
- Voto por enquete.
- **Para ligar qualquer uma é preciso aprovação.** Ao ligar, aparece a confirmação "Isto vai enviar mensagens reais para clientes", com o número de clientes atingidas.

### Mídia
- Retenção configurável. O padrão é **"Não apagar"**: nada é apagado até a gestão escolher um prazo.
- Mídia expirada aparece como "Mídia expirada · apagada em dd/mm/aaaa".

### Sinais na Fila
Etiquetas como "Pediu preço" e "Pediu horário", com correções de falso positivo.

### Backup e restauração
O teste de restauração cobre o banco do CRM, o banco da Evolution, a mídia e a sessão do WhatsApp, sempre em alvos temporários. Para só testar, sem guardar cópia: `scripts/restore-test.sh --descartar`.

## 2. Problemas corrigidos (principais)

### Envio
- A citação era descartada em silêncio.
- A fila de envio reenviava em caso de dúvida (falhava aberta). Agora falha fechada e promove o eco.
- Envio em dobro quando a Evolution respondia 4xx depois de o eco já ter chegado.
- Envio em massa para leads antigos ao ligar uma automação. Agora há teto de idade.
- Restaurar uma versão de automação religava o envio.
- Erro inesperado na fila sumia sem aviso. Agora vai para o log e gera alerta.

### Alertas e avisos
- Lead atrasado sem dono ficava invisível para a atendente.
- Responder a cliente apagava o lembrete de tarefa do sino.
- O som de atraso não tocava em aba parada.
- O push morria no aparelho depois de "Sair".
- O motor de regras não ignorava contatos marcados como "não é cliente".

### Tela e conversa
- Rótulos errados na Jornada.
- Um aviso que já estava saindo continuava clicável, e outro ficava preso no DOM.
- O aviso ocupava meia tela no celular e cobria botões.
- Mensagens do mesmo segundo apareciam fora de ordem.
- A rolagem da Fila se perdia em celular lento.
- O texto "há N minutos" quebrava a hidratação na virada do minuto.
- "Respondido em X" contava o tempo corrido. Agora conta só o horário de expediente.
- Erros técnicos (SQL) apareciam na tela.

### Segurança e dados
- O link de convite não tinha limite de tentativas, e o argon2 rodava antes de conferir o token.
- **Os testes automáticos apontavam para a Evolution real** (porta 8080, com a Recepção conectada). Agora usam um endereço morto e se recusam a subir se apontarem para a real.
- O seed de produção criaria 5 serviços com nomes inventados. Foram removidos.

## 3. Arquitetura

- **Regra única de atraso:** `src/server/queries/late-count.ts` (`lateWhere`, `countLateLeads`).
- **SSE por escopo** (`src/lib/live-scope.ts`), com agrupamento de eventos em até 2 s.
- **Fila de envio:** `src/server/domain/outbox.ts`, com cadeado `pg_try_advisory_lock`, `FOR UPDATE SKIP LOCKED` e "envio incerto" sem reenvio.
- **Migrações, todas aditivas e não aplicadas ao `crm`:**
  - `0008`: arquivamento, origem, serviço, pagamento, comparecimento, tarefas, alertas por espera, modo quieto, fila de envio e push.
  - `0009`: índices.
  - `0010`: preenche o `wait_key` dos alertas antigos.
- **Jobs no pg-boss:** `regras` (com heartbeat no `/api/health`), `retencao-midia` às 04:00 (sem efeito enquanto estiver em "Não apagar") e lembretes de tarefas.

## 4. UI/UX

- Fila como tela principal, Jornada como visão da gestão e Quadro como tela secundária. Sem 3D e sem ranking.
- **Celular:**
  - conversa em tela cheia;
  - folhas que sobem de baixo;
  - alvos de 44 px;
  - campos com 16 px, para o iPhone não dar zoom;
  - margens para o notch em retrato e em paisagem.
- **Acessibilidade:** axe sem violações sérias ou críticas em todas as rotas, nos dois perfis (gestão e atendente) e nos dois dispositivos. Um único h1 por página e "não lido" anunciado pelo leitor de tela.
- **Bloqueado:** o que depende do Avec aparece como "Bloqueado", sem nenhum dado.

## 5. Motion

- Tokens de animação únicos (`T`, `SPRING_UI`) e relógio isolado (`<Elapsed>`), para o resto da tela não re-renderizar.
- `useCrossedThreshold` sinaliza quando um lead cruza o prazo.
- Sem GSAP e sem Three.js.

## 6. Relatórios

- Números reais do CRM; quando falta base, aparece "Sem dados suficientes (n = X)". Nada é simulado.
- "Retorno por coorte" aparece como **Bloqueado** porque depende da exportação do Avec.
- Exportação em CSV e drill-down para a Fila.

## 7. Testes (no HEAD final)

| Comando | Resultado |
|---|---|
| `tsc --noEmit` | 0 erros |
| `eslint .` | 0 problemas |
| `vitest run` | 705/705 |
| `playwright test` (desktop e iPhone 13, com axe) | 166 passaram, 51 pulados (são de outro dispositivo), 0 falhas |
| `next build` | ok |

- A suíte do Playwright passou duas vezes seguidas na correção final e mais uma vez no HEAD.
- O `restore-test.sh --descartar` deu OK. Os números bateram: 31 leads, 831 mensagens, 72 arquivos de mídia e a sessão do WhatsApp.
- Navegador com o build de produção: 18 de 18 fluxos do dia, no desktop e no celular, com 0 erros de console e 0 violações de CSP.
- Os 15 critérios da spec (§12) estão ligados a testes, e o mapa está no ledger.

## 8. Desempenho

Medição com `scripts/perf-fila-quadro.mjs`: build de produção, CPU 4× mais lenta, 100 leads e janela de 10 s. Resultado: **0 tarefas longas** na Fila e no Quadro.

## 9. Limitações conhecidas

- **Envio em dobro na ordem 400 → eco.** Se a Evolution responder 400 antes de o eco chegar, um lembrete automático pode sair duas vezes. Hoje não acontece, porque as automações estão desligadas. **Antes de ligar**, decidir entre tratar 4xx/5xx como "envio incerto" (sem reenvio) ou guardar uma marca que o eco promove.
- **Ordem no mesmo segundo.** Se a mensagem da cliente chegar atrasada e a resposta ao vivo entrar no mesmo segundo, a ordem pode sair trocada. A solução definitiva é uma coluna sequencial, ou seja, uma migração nova.
- **Push.** A reinscrição só acontece ao abrir o Hoje e, se falhar, falha em silêncio.
- **Modo quieto.** Durante ele, a linha da Fila mostra "prazo estourado" em vermelho dentro de "Aguardando resposta".
- **Erros sem log.** Duas telas (contatos e atendimento) ainda não registram no log os erros inesperados.
- **Evolution real não testada.** Citação, eco de mídia e voto de enquete foram testados só com o simulador. Falta um teste com um número de teste antes de ligar automações.
- **Horário de expediente provisório:** seg–sex 8–20 e sáb 8–17, até a Casa confirmar.

## 10. Dependências externas

- **Avec:** a importação periódica e o retorno por coorte estão bloqueados até a Casa liberar a exportação.
- **Evolution API 2.3.7:** é o WhatsApp não oficial e tem risco de bloqueio (aceito pelo dono).
- **VAPID** (push): opcional. Sem a chave, o push não faz nada.
- **Contabo** (deploy): aguarda aprovação.

## 11. Prontidão para produção

O código está pronto e o roteiro está em `docs/deploy-contabo.md`. **O deploy não foi feito.** No dia:

1. Backup.
2. Ensaio das migrações 0008, 0009 e 0010 numa cópia restaurada, cronometrado.
3. `pm2 stop` do web e do worker.
4. `db:migrate`, seed e build.
5. Cadastrar os serviços com os nomes confirmados pela Casa.
6. Conferir, só lendo, que as automações que enviam estão desligadas.
7. Subir o web e o **worker**, e conferir o `/api/health`.

O rollback está descrito no mesmo documento: o código antigo funciona, mas volta a mostrar os leads arquivados.

**Precisam de aprovação ou de decisão do dono:**
- o deploy e as migrações no banco real;
- as chaves VAPID de produção;
- ligar as automações, depois do teste real com um número de teste;
- confirmar o horário de expediente;
- a exportação do Avec;
- o prazo de retenção de mídia;
- os nomes dos serviços.

**Worker local:** o worker não está rodando nesta máquina (`/api/health` mostra `lastBeatAt` nulo). Sem ele não há alertas, lembretes nem fila de envio.
