# CRM Casa Fiaes, rodada 2: permissões, distribuição, atendimento e relatórios

- **Data:** 13/10/2026.
- **Branch:** `rodada-2`, criada a partir de `melhorias-completas` (que está no ar no Contabo).
- **Origem:** áudio da reunião com a Casa, transcrito e confirmado com o Joaquim em 13/10/2026.

## 0. Entendimento

| Pedido da Casa | Decisão |
|---|---|
| "Redirecionar o chat para uma pessoa e, se ela estiver em atendimento, mandar para outra. Níveis de prioridade. Alertar quem não está em atendimento" | **Distribuição automática por disponibilidade** (Parte B) |
| "Configurar as permissões de cada login: quem só vê atendimento, quem vê relatório" | **Perfis editáveis com caixinhas** (Parte A) |
| "Melhorar a parte visual do chat, que está bagunçada" e "o lugar das mensagens" (no áudio saiu "Instagram", mas foi erro de transcrição) | **Redesenho da tela de atendimento, com protótipos escolhidos antes** (Parte C) |
| "Ver o histórico da conversa ao começar a atender. Identificar mais palavras-chave" | **Cartão de contexto e mais sinais, com uma lista própria da gestão** (Parte C) |
| "Relatórios mais bem explicados, muito mais bonitos, em PDF" | **Explicação de cada número, visual novo e três PDFs: do período, fechamento mensal e por atendente** (Parte D) |

**Restrições que continuam valendo:**
- **Custo:** só ferramentas gratuitas, sem custo recorrente novo e sem IA paga.
- **Dados:** nada de dado inventado nem número simulado apresentado como real.
- **Mensagens:** nenhuma mensagem sai para a cliente sem uma ação humana ou uma automação que a Casa aprovou.
- **Banco:** as migrações só acrescentam, sem `DROP` de tabela nem de coluna.

**Como saber que deu certo:**
- a gestão cria um perfil "Recepção" que só vê o Atendimento, e quem tem esse perfil não abre os Relatórios nem pela URL nem pela API;
- uma conversa nova cai sozinha com a atendente livre de maior prioridade. Se ela não responde no prazo, outra pessoa livre recebe o aviso e assume com um clique;
- a atendente abre a conversa e vê em 2 segundos quem é a cliente, o que ela já fez na Casa e o que pediu agora;
- a gestão baixa um PDF do mês que dá para entender sem explicação de ninguém.

**Ordem de entrega:** A → B → C → D. Cada parte tem o próprio plano, testes e revisão, e só vai ao ar com o ok do Joaquim.

---

## Parte A: Permissões por perfil

### Modelo
- **Tabela nova `profiles`:** `id`, `name` (único, sem diferenciar maiúscula), `permissions text[]`, `is_system boolean`, `created_at`.
- **`users.profile_id`:** coluna nova, `uuid` que aponta para `profiles`. Aceita nulo só durante a migração.
- **Permissões** (constante única em `src/lib/permissions.ts`, com o rótulo em português ao lado de cada uma):

| Chave | Rótulo | O que libera |
|---|---|---|
| `atendimento.ver` | Ver Atendimento | `/atendimento` e a conversa |
| `atendimento.todas` | Ver conversas das outras | Fila "Todos". Sem ela, a pessoa vê só as conversas dela e as sem dona |
| `atendimento.transferir` | Transferir conversas | Botão Transferir e transferência em massa |
| `atendimento.fechar` | Fechar venda / marcar perdido | Fechar venda, Perdido e Não é cliente |
| `distribuicao.receber` | Receber leads da distribuição | Entra na Parte B |
| `quadro.ver` | Ver Quadro | `/funil` (com escopo igual ao da Fila: sem `atendimento.todas`, só os próprios) |
| `jornada.ver` | Ver Jornada | `/jornada` |
| `contatos.ver` | Ver Contatos | `/contatos`, ficha e importação (a importação também exige `config.editar`) |
| `relatorios.ver` | Ver Relatórios | `/relatorios`, só com os números próprios |
| `relatorios.equipe` | Ver números de toda a equipe | Relatórios sem filtro de dona e com o filtro por pessoa |
| `relatorios.exportar` | Exportar CSV e PDF | `/api/relatorios/*` e os PDFs |
| `config.editar` | Configurações | `/config/*`, exceto Equipe |
| `equipe.gerir` | Gerir equipe e perfis | `/config/equipe` e os perfis |

### Perfis de sistema (criados pela migração)
- **Gestão:** todas as permissões. Não pode ser apagado nem perder `equipe.gerir`. É a trava para ninguém ficar trancado para fora.
- **Atendente:** exatamente o que o papel `atendente` permite hoje (conferido no código em 13/10):
  - `atendimento.ver`, `atendimento.transferir`, `atendimento.fechar` e `distribuicao.receber`;
  - `quadro.ver`, só com os próprios leads;
  - `contatos.ver`, sem importar;
  - `relatorios.ver`, só com os números próprios.

  Fica sem Jornada, sem exportar, sem números da equipe, sem Configurações e sem ver as conversas das outras na visão "Todos". Antes de trocar cada `role === "gestor"`, o plano lista essas checagens uma a uma e diz qual permissão substitui cada uma, para manter o mesmo comportamento.
- **Recepção:** só `atendimento.ver` e `distribuicao.receber`.

**Migração aditiva `0011`:** cria `profiles`, cria os três perfis e preenche `users.profile_id` a partir do papel (`gestor` vira Gestão, `atendente` vira Atendente). A coluna `users.role` **continua existindo**, para o código antigo seguir funcionando se for preciso voltar. O código novo deixa de ler o papel.

### Onde a regra é aplicada
- **Uma função só:** `can(user, perm)`. A sessão carrega as permissões do perfil numa única consulta (junção com `profiles`).
- **Páginas:** `requirePerm(perm)` nas páginas de servidor. Sem a permissão, redireciona para a primeira tela permitida com o aviso "Você não tem acesso a essa tela".
- **Server actions e rotas `/api`:** `assertPerm(perm)` em todas, que devolve 403 com uma mensagem amigável.
- **Menu:** o menu e a barra de baixo do celular escondem o que a pessoa não pode abrir. Isso é só aparência; a segurança está nas checagens do servidor.
- **Hoje (`/`):** todo mundo abre, e cada bloco aparece só se a pessoa puder ver o conteúdo dele.
- **Troca de permissão no meio do uso:** as permissões são lidas da sessão a cada requisição, sem guardar em cache, então a mudança vale na próxima navegação.

### Tela
Em Configurações › Equipe › **Perfis**:
- lista de perfis com quantas pessoas usam cada um;
- criar, renomear, duplicar e apagar (só se ninguém usa);
- caixinhas agrupadas por área.

Na lista da Equipe, cada pessoa ganha um seletor de perfil. O convite também passa a pedir o perfil.

### Riscos
- **Esquecer uma checagem é falha de segurança.** Por isso existe um teste que percorre **todas** as rotas de página, as server actions exportadas e as rotas `/api`, e confere que cada uma está protegida por permissão ou consta numa lista de exceções pública e justificada (login, convite, webhook, health).
- **A gestão pode tirar a própria permissão de gerir equipe.** Isso é bloqueado no perfil de sistema. Num perfil personalizado, não se pode deixar o sistema sem nenhuma pessoa ativa com `equipe.gerir`.

---

## Parte B: Distribuição automática por disponibilidade

### Estados da atendente
- **Coluna nova `users.availability`:** `disponivel`, `pausa` ou `ausente`. O padrão é `ausente`.
- **Coluna nova `users.last_seen_at`.**
- **Presença:** a conexão SSE que já existe (`/api/live`) faz o heartbeat. Cada conexão aberta atualiza `last_seen_at` a cada 60 s.
  - Ao entrar no CRM, quem tem `distribuicao.receber` vira `disponivel` sozinha, a menos que tenha escolhido `pausa` naquele dia.
  - O worker marca `ausente` quem passou de **5 min** sem sinal (constante `PRESENCE_TIMEOUT_MIN`).
  - Fechar o CRM ou sair da conta também deixa a pessoa ausente.
- **Mudar o próprio estado:** no menu do próprio nome, com as opções Disponível, Em pausa e Ausente.
- **Ver o estado da equipe:**
  - a gestão vê a equipe com uma bolinha de estado e a contagem de conversas;
  - a atendente vê o mesmo na hora de transferir.

### Configuração (Configurações › Atendimento › Distribuição)
- **Ligar ou desligar a distribuição.** O padrão é **desligada** na migração. Quando desligada, o sistema usa a regra de hoje (`pickOwner`: a atendente com menos conversas abertas).
- **Limite de conversas esperando resposta por pessoa:** padrão 3, de 1 a 20.
- **Nível de prioridade de cada pessoa:** 1, 2 ou 3. A coluna nova é `users.priority_level smallint`, com padrão 1.

### Regra de entrega (`src/server/domain/routing.ts`, função pura + adaptador de banco)
**Quem conta como "livre":** pessoa ativa, com `distribuicao.receber`, `availability = disponivel`, sinal nos últimos 5 min e `carga < limite`. A **carga** é o número de leads abertos e não arquivados dela que estão esperando resposta.

**Quando chega uma conversa nova ou volta uma cliente que estava sem lead aberto:**
1. **Cliente que volta:** se ela teve um lead antes, a dona do último lead fechado ganha preferência, desde que esteja livre.
2. **Senão:** vai para quem está livre no menor nível de prioridade. No mesmo nível, recebe quem tem menor carga. No empate, recebe quem está há mais tempo sem receber (`users.last_assigned_at`, coluna nova).
3. **Ninguém livre:** o lead fica **sem dona** e o alerta de hoje vai para todas as `disponivel` com a permissão, e para a gestão se ninguém estiver disponível.

**Detalhes:**
- **Importação de histórico (`messages.set`):** **não** distribui. O lead vem do histórico e fica como está hoje.
- **Concorrência:** a escolha e a gravação acontecem na mesma transação que cria o lead. `last_assigned_at` é atualizado com `FOR UPDATE` nas linhas de usuários candidatos, então duas mensagens simultâneas não vão para a mesma pessoa acima do limite.

### Prazo estourado: oferta
Quando o lead de uma dona passa do prazo da etapa sem resposta (a regra única de atraso que já existe):
- **Oferta:** o worker escolhe a **próxima pessoa livre** pela mesma regra, excluindo a dona, e cria um alerta do tipo `oferta` com o texto "Pode assumir a Fulana? Esperando há X min". O alerta mostra o botão **Assumir** e toca o som.
- **A dona não perde a conversa sozinha.** Se alguém clicar em Assumir, a conversa passa para essa pessoa (`claimDeal`, que já existe) e a dona recebe o aviso "Bruna assumiu a Fulana".
- **Uma oferta por espera:** a deduplicação usa a mesma `wait_key` dos alertas de atraso.
- **Escalada:** se a oferta não for aceita em mais um prazo, a oferta vai para a próxima pessoa livre. Depois disso, a escalada para a gestão aos 10 min continua como está.
- **Ninguém livre para receber a oferta:** só a escalada da gestão acontece.

### Pausa e ausência
Quando uma pessoa passa para `pausa` ou `ausente`:
- **Os leads dela que ainda não receberam nenhuma resposta** (sem `last_outbound_at`) voltam para a distribuição, com o evento "devolvido à fila (Ana ficou ausente)".
- **Os leads que já estão em andamento** continuam com ela e seguem a regra de oferta quando o prazo estourar.

### Transferência manual
- A folha de Transferir mostra cada pessoa com estado, carga e nível. Quem está fora ou cheia aparece no fim, mas continua podendo ser escolhida.
- Quem recebe ganha um alerta "Ana transferiu a Fulana para você".

### Histórico
Os eventos `distribuido`, `oferecido`, `assumido_por_oferta`, `devolvido_a_fila` e `transferido` entram em `deal_events` e aparecem na linha do tempo do lead.

### Migração `0012` (aditiva)
- `users.availability`, `last_seen_at`, `priority_level` e `last_assigned_at`;
- `alerts.kind` é texto livre, então o tipo `oferta` não precisa de migração;
- chaves novas em `settings`.

---

## Parte C: Tela de atendimento

### C1. Redesenho do chat
**Processo:**
1. **Pesquisa de referência:** WhatsApp Web, Chatwoot, Front, Kommo e Intercom. O resultado é uma nota curta com prints e com o que copiar e o que evitar.
2. **Protótipos:** 2 ou 3 versões em HTML estático, com os dados da demonstração, na largura do computador e do celular. Ficam em `.superpowers/` e são publicados como página para a Casa escolher.
3. **Escolha:** a Casa escolhe uma, ou uma mistura. **Nada do redesenho é implementado antes da escolha.**

**O que os protótipos precisam resolver** (problemas que o áudio aponta e que já aparecem nas capturas):
- **Ações:** agrupadas por momento:
  - **Atender:** Assumir e Transferir;
  - **Marcar:** Agendar e próxima ação;
  - **Concluir:** Fechar venda, Perdido e Não é cliente.

  As de uso raro vão para um menu "Mais".
- **Cabeçalho:** só nome, estado (etapa), dona com o estado dela e o relógio do prazo.
- **Mensagens:**
  - balões com contraste certo;
  - separador por dia;
  - agrupamento de mensagens seguidas da mesma pessoa;
  - mídia em tamanho legível;
  - citação clara;
  - horário discreto.
- **Campo de texto:** respostas prontas com `/` e anexos ficam no próprio campo. Enter envia e Shift+Enter quebra a linha (manter).
- **Movimento:** segue os tokens de animação existentes (`T` e `SPRING_UI`), sem biblioteca nova.

**Critério de pronto:**
- axe sem violações sérias;
- alvos de 44 px no celular;
- sem rolagem lateral em 390 px;
- todos os e2e da conversa passando;
- capturas lado a lado de antes e depois.

### C2. Cartão de contexto da cliente
Fica no topo da conversa, recolhível, e lembra se estava aberto ou fechado por pessoa (localStorage). Mostra:
- **"Cliente desde"** (o primeiro contato) e **"Última visita"** (o último agendamento com Compareceu);
- **últimos serviços** (as 3 últimas vendas, com serviço, data e valor) e o **total gasto**, a soma das vendas fechadas no CRM. Quando não há venda, aparece "Sem vendas registradas no CRM". Nunca aparece um número estimado;
- **quem atendeu antes**, as **observações** e a **próxima ação**;
- **sinais** da conversa atual;
- o link "Ver linha do tempo completa", que abre a ficha.

**Regras:**
- os dados vêm de consultas que já existem (ficha e histórico) ou de uma consulta nova `clientContext(contactId)`, com no máximo uma ida ao banco;
- cliente nova (sem lead anterior) vê só "Primeiro contato" e os sinais;
- depende do Avec: sem a exportação, o cartão mostra só o que o CRM registrou e deixa isso claro com "Histórico do Avec: bloqueado".

### C3. Palavras-chave e sinais
**Sinais embutidos novos**, em `signals.ts`, cada um com teste de falso positivo:
- `pediu_desconto`: desconto, promoção, cupom, "faz por menos";
- `remarcar_cancelar`: remarcar, desmarcar, cancelar, "não vou poder ir";
- `reclamacao`: reclamação, insatisfeita, "não gostei", "ficou ruim", estragou;
- `evento`: noiva, casamento, formatura, festa, madrinha, debutante;
- `urgente`: urgente, "hoje ainda", "o quanto antes";
- `indicacao`: "fulana indicou", indicação, "me passaram seu contato".

**Serviço de interesse:** a mensagem é comparada com os nomes dos serviços ativos (lista `service`), ignorando acentos e caixa, palavra inteira. O resultado aparece como a etiqueta "Interesse: Coloração". Se nenhum serviço estiver cadastrado, não aparece nada.

**Palavras-chave da gestão:**
- **Onde:** um tipo novo na lista, `keyword`, em Configurações › Listas › Palavras-chave.
- **Cada item tem:**
  - as frases (uma por linha);
  - a etiqueta que aparece;
  - "Subir prioridade na Fila" (sim ou não).
- **Comparação:** sem acento, caixa ou pontuação, frase inteira.
- **Vale a partir de agora:** a lista é aplicada nas mensagens recebidas a partir dela, sem reprocessar o histórico. Os sinais são recalculados a cada mensagem, como hoje.

**Na Fila:**
- as etiquetas aparecem nas linhas (no máximo 2, como hoje, por ordem de prioridade: sinais de risco primeiro);
- os chips de foco ganham "Reclamação" e "Evento";
- o filtro aceita qualquer etiqueta.

**Prioridade:** o que tem "subir prioridade" ou os sinais `reclamacao` e `urgente` sobe **dentro da sua seção** da Fila. Nunca passa na frente de quem está atrasado.

**Migração `0013` (aditiva):** acrescenta `keyword` ao enum `list_kind` e cria a coluna `lists.meta jsonb`, que hoje não existe. Ela guarda `{ tag, boost }`; as frases ficam em `body`, uma por linha.

---

## Parte D: Relatórios

### D1. Explicação dos números
- **Fonte única:** `src/lib/metric-copy.ts`.
- **Para cada métrica, um texto:**
  - **O que é**, em uma frase;
  - **Como calculamos**, em uma frase com a regra real do código;
  - **Como ler**, que compara com o período anterior e diz se subiu ou desceu e se isso é bom ou ruim.

  "Bom ou ruim" só aparece quando o sentido é óbvio (por exemplo, tempo de resposta menor é melhor). Nunca há meta inventada.
- **Na tela:** a primeira frase aparece embaixo do número e o resto fica num "Como calculamos" que abre ao clicar.
- **Base pequena:** continua aparecendo "Sem dados suficientes (n = X)".

### D2. Visual da tela de Relatórios
Segue o padrão do CRM:
- serifada nos títulos;
- cartões com os números grandes;
- gráficos com a paleta da marca.

Os gráficos continuam em SVG próprio, como hoje (o projeto não usa biblioteca de gráficos), sem dependência nova. Abas e drill-down continuam como estão.

### D3. PDFs
**Motor:**
- **Chromium headless no servidor:** `playwright-core` + `chromium` instalado no VPS. É dependência de produção e custo zero.
- **Página de impressão:** `/relatorios/imprimir?tipo=...&periodo=...`, renderizada pelo próprio Next com os mesmos componentes da tela e CSS `@media print` / `@page` (A4, margens e quebras de página controladas).
- **Acesso do Chromium:** ele abre essa página com um **token de uso único** (5 min, gravado em hash no banco e ligado ao usuário que pediu), sem cookie de sessão.
- **Concorrência:** um PDF de cada vez, com cadeado `pg_try_advisory_lock`. Se outro já estiver sendo gerado, aparece "Já tem um PDF sendo gerado, tente em instantes". O tempo limite é de 60 s.
- **Formato:** capa com o logo, o nome da Casa, o período e "Gerado em dd/mm/aaaa hh:mm por Fulana". Rodapé com o número da página.

**Tipos:**
- **Período** (`tipo=periodo`): o mesmo conteúdo das abas Visão geral e Análise, com as explicações da D1 e a comparação com o período anterior.
- **Fechamento mensal** (`tipo=mensal`):
  - **Conteúdo:** o do período, para o mês anterior, mais uma página "Destaques do mês". Os destaques são frases montadas por regra a partir dos números, por exemplo "O tempo médio de resposta caiu de 6 para 4 min". Sem IA e sem opinião.
  - **Geração:** um job do pg-boss todo dia 1º às 06:00 (America/Bahia) gera o arquivo e guarda em `data/relatorios/AAAA-MM.pdf` e na tabela nova `report_files`.
  - **Onde aparece:** na lista "Fechamentos" na aba Relatórios, para quem tem `relatorios.exportar`.
  - **E-mail:** só se `SMTP_*` estiver configurado no `.env`. Se não estiver, o job registra "e-mail não configurado" e não falha.
- **Por atendente** (`tipo=equipe`):
  - **Por pessoa:** conversas recebidas, tempo médio de resposta (no horário de expediente), quantas respondeu dentro do prazo, agendamentos, vendas fechadas, valor e taxa de conversão;
  - **Ressalvas:** sem ranking nem nota (a mesma decisão de "sem ranking" da rodada 1). Mostra os números lado a lado em ordem alfabética, e a base pequena aparece marcada.
  - **Escopo:** quem tem `relatorios.equipe` vê todas. Quem não tem vê só a própria linha.

**Migração `0014` (aditiva):** tabelas `report_files` e `report_print_tokens`.

**Backup:** `scripts/backup.sh` passa a incluir `data/relatorios/`.

---

## Fora do escopo desta rodada
- **Receber as DMs do Instagram:** não foi pedido (era erro de transcrição).
- **Resumo da conversa por IA:** tem custo recorrente e precisa de aprovação.
- **Distribuição por habilidade:** por exemplo, coloração vai para a Ana. Pode vir depois em cima do nível de prioridade.
- **Ranking ou meta por atendente.**

## Testes e verificação (todas as partes)
- **Desenvolvimento:** TDD nas regras puras: `can`, `routing`, `signals` e `keywords`, além dos textos de métrica, que só podem usar chaves existentes.
- **Integração** com o banco de teste: migrações aplicadas sobre uma cópia, distribuição sob concorrência (duas mensagens ao mesmo tempo), oferta e escalada, devolução por ausência e geração do PDF com token.
- **e2e Playwright** no computador e no celular, com axe:
  - perfil Recepção bloqueado nas telas e nas APIs;
  - distribuição com duas atendentes logadas;
  - oferta aceita;
  - cartão de contexto;
  - nova palavra-chave criada e etiquetando;
  - PDF baixado e aberto (conferir número de páginas e textos-chave).
- **Ensaio das migrações** sobre o backup de produção, cronometrado, antes de cada deploy.
- **Deploy por parte:** backup, `pm2 stop`, migração, build, start e health. Cada parte só sobe com o ok do Joaquim.
