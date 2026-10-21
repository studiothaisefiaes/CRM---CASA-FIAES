# Contatos, ficha da cliente e "situação atual": auditoria

Trabalho só de leitura: rodei apenas SELECT no banco, não mexi no repositório nem enviei mensagem nenhuma. Não abri conversa na Fila, porque abrir uma conversa já a marca como lida (`conversation-pane.tsx:121`, `markConversationReadAction`). Por isso o painel da cliente dentro da conversa foi analisado pelo código e pelo banco, sem tela.

Os prints estão em `/private/tmp/claude-501/-Users-joaquimsalles/1d859e91-de4e-47e9-bde3-8a64964253fe/scratchpad/analise/contatos/` (01 a 11, com o texto de cada tela em .txt, e as consultas `contatos_q1..q7.sql`).

## 0. Erros que distorcem o que a ficha mostra hoje

**1. "Total gasto" absurdo.** `src/server/domain/avec/import-sales.ts:106` calcula `total = valor × quantidade` quando o relatório do Avec não traz coluna de total. Só que o "Valor" do Avec já é o total da linha.
- Os 140 itens com quantidade maior que 1 têm total igual a valor × quantidade. Somam **R$ 70,6 milhões**, contra R$ 459 mil de valor real.
- O pior caso é "Cabelo Método Fiaes 2": quantidade 380, valor R$ 38.000, total gravado R$ 14,44 milhões.
- **71 contatos** aparecem com mais de R$ 50 mil gasto e 46 com mais de R$ 100 mil. A ficha de uma cliente mostra "Total gasto R$ 4.147.677,30" (print 05). Uma linha de R$ 14.359,00 aparece em "Atendimentos e compras" (print 04).
- Sem os valores fora da curva, o ticket médio por comanda é R$ 1.191 e a mediana R$ 590. Com eles, a média vira R$ 8.613.

**2. O painel da conversa ignora todo o Avec.** `src/server/queries/client-context.ts` conta "Visitas" só pelos leads do CRM com comparecimento (linhas 30-34), mas nenhum lead tem comparecimento registrado no banco (0). "Já gastou" usa só vendas fechadas no CRM (linhas 35-39). "Fala com a Casa desde" usa a data de criação do contato, e todos os 6.082 foram criados em 14/10. Dos **185 leads abertos**:
- 125 são de clientes com histórico no Avec;
- em **122** o painel mostra "Visitas: nenhuma registrada";
- em **109** mostra "Fala com a Casa desde: Agora (primeira conversa)", e a faixa do topo (`context-strip.tsx:20`) diz "Primeira conversa com a Casa", para cliente que frequenta desde 2020;
- 8 têm pacote ativo e 32 têm horário futuro. Esses dois dados o painel já mostra, porque vêm de outra consulta.

**3. Mesclas aparecem como "Não é cliente".** Os 33 leads arquivados no banco vêm todos da junção automática do contato de número oculto (@lid) com o contato com número (`lid-merge.ts:39`). A ficha rotula lead arquivado como "Não é cliente" (`contatos/[id]/page.tsx:29`). Resultado: uma cliente com 21 visitas aparece com "Não é cliente · 14/10/2026" na lista de leads (print 04).

**4. Eventos aparecem com o código cru no Histórico.** `src/lib/history.ts:105` (`default: return one(e.type)`) mostra o nome técnico do evento na tela. Ocorrências no banco:

| Texto que aparece | Ocorrências |
|---|---|
| `conversa_arquivada` | 53 |
| `contato_mesclado` | 33 |
| `espera_virou_followup` | 8 |
| `espera_encerrada_agradecimento` | 3 |
| `conversa_desarquivada` | 3 |

## 1. Lista de Contatos hoje (`/contatos`)

- **Arquivos:** `contatos/page.tsx`, `components/contacts/contacts-list.tsx`, `server/queries/contacts.ts`.
- **Filtros:** só dois, "Só clientes" e "Incluir “Não é cliente”" (`page.tsx:47-48`). O primeiro quase não filtra, porque 5.979 dos 6.083 contatos estão marcados como cliente. O segundo não muda nada: há 0 contatos ignorados.
- **Ordem:** sempre por data de criação (`contacts.ts:57`), sem opção de ordenar. Como 6.082 contatos nasceram no mesmo dia, a ordem é arbitrária. No topo aparecem os leads novos do WhatsApp, vários como "Número oculto" (print 01).
- **Colunas:** Nome, Telefone, Situação, Responsável, Último atendimento, Atendimentos.
  - "Atendimentos" conta leads do CRM (`contacts.ts:65`). Por isso dá 0 para cliente com 50 visitas no Avec.
  - Não há colunas de visitas, última visita do Avec, próximo horário, pacote, profissional, aniversário ou etiquetas.
- **Busca** (nome parecido, telefone, e-mail, trecho de mensagem): está boa.
- **Ações em massa:** só "Não é cliente". Não há exportar CSV (consta no backlog, item 9).
- **Paginação:** 50 por página, só com Anterior/Próxima.

## 2. Ficha hoje (`/contatos/[id]`)

O que mostra (print 04):
- cabeçalho com nome, telefone, e-mail e etiquetas;
- uma faixa com 4 dados: Origem, Cliente desde, Último atendimento, No sistema desde;
- Lead atual, Próximos horários, Pacotes;
- Valores (só gestão), Leads e Observações;
- "Atendimentos e compras" (comandas do Avec) e o Histórico.

O que falta ou está errado:
- **Visitas e total só aparecem para a gestão** (`page.tsx:128`, com a permissão de ver valores). A atendente não vê nem a quantidade de visitas.
- **Aniversário não aparece.** Existe para 3.714 contatos (2.660 com ano), mas só é editável dentro da conversa (`lead-sheet.tsx:32`).
- **"Como conheceu" do Avec nunca é mostrado** (891 contatos com essa informação). A Origem vem só do primeiro lead (`contact.ts:85`), então dá "Não identificada" para quase todas. Valores reais desse campo incluem "Instagram" (300), "Indicação" (216) e "CLIENTE GILVAN" (80): a Casa usava o campo para guardar a profissional da cliente.
- **Horários passados do Avec não aparecem.** São 13.441 comparecimentos, 6.001 cancelamentos e 960 faltas. Não há contagem de faltas nem de cancelamentos.
- **As 13.563 observações de horário do Avec não aparecem em lugar nenhum da ficha.**
- **Pagamentos não aparecem:** `getContactAvecData` busca, mas a página não usa. Inclui 1.692 lançamentos "Crédito Cliente" e 196 de "Dívida", ou seja, saldo e débito da cliente invisíveis.
- **Observações:** a ficha mostra só as anotações do contato, e esse campo está vazio nos 6.083. As anotações escritas na conversa ficam no lead (109 leads têm) e não chegam à ficha. Ao abrir um lead novo, somem da vista.
- **Não dá para editar nada na ficha:** nome, e-mail, aniversário, anotação, etiqueta, profissional preferida.
- **Nada calculado:** retorno sugerido, frequência, ticket médio, serviço e profissional preferidos não existem. O dado para calcular existe (seção 5). O campo de ciclo de retorno por serviço também existe e está vazio nos 55 serviços.
- **Etiquetas:** só uma no sistema inteiro ("Uso de imagem", 38 contatos). A ficha do ChatGuru não foi importada (0 contatos com dados de lá).

## 3. Painel da cliente na conversa (`client-pane.tsx`, `context-strip.tsx`)

- **Não existe link para a ficha.** Nome e foto (`client-pane.tsx:211-215`), cabeçalho (`pane-header.tsx`) e faixa do topo não abrem `/contatos/[id]`. Da conversa não se chega à ficha completa.
- **"Quem é"** mostra Veio de, Fala com a Casa desde, Visitas, Próximo horário, Pacote, Já gastou e Atendeu antes. Visitas, Fala com a Casa desde e Atendeu antes saem errados para cliente do Avec (item 0.2).
- **Não mostra:** aniversário (só como campo editável lá embaixo, em "Dados"), profissional preferida, última visita do Avec, faltas, retorno sugerido e as observações do Avec.

## 4. Onde o nome da cliente aparece e não abre a ficha

| Tela | Para onde o clique leva | Arquivo |
|---|---|---|
| Fila / conversa (nome, foto, cabeçalho) | nada | `client-pane.tsx:211`, `pane-header.tsx` |
| Faixa do topo da conversa | só expande | `context-strip.tsx:23` |
| Quadro (/funil) | abre o lead | `deal-card.tsx:30` |
| Jornada | conversa | `journey/station.tsx:39` |
| Hoje: Esperando, Conferir comparecimento, Aniversários | conversa | `waiting-list.tsx:46`, `attendance-list.tsx:45` |
| Hoje: Próximas ações | conversa (ficha só se não houver lead) | `next-actions.tsx:39` |
| Agenda, horário vindo de lead | conversa | `agenda-board.tsx:73` |
| Agenda, horário do Avec | painel com "Abrir ficha da cliente" (ok) | `entry-sheet.tsx:34` |
| Agenda, grade por profissional | abre o painel | `pro-grid.tsx:131` |
| Sino de alertas | conversa | `alerts-bell.tsx:132` |
| Relatórios (lista de cobranças) | conversa | `reports/analysis.tsx:141` |
| Relatórios do Avec (tabelas) | texto puro, sem link | `relatorios/avec/[id]` |
| Pacotes e Lista de espera | ficha (ok) | `packages-list.tsx:63`, `waitlist.tsx:59` |

**Aniversários na tela Hoje:** a consulta exige que a cliente tenha um lead (`today.ts:55`). No banco há **60 aniversariantes nos próximos 7 dias**, mas só 2 têm lead, e a tela mostra 2. Além disso, quem faz aniversário nos dias 29, 30 ou 31 cai no dia 28 (`least(birth_day,28)`).

## 5. O que o banco já permite calcular por cliente

- **Visitas** (dias distintos com comparecimento ou comanda): 4.153 clientes têm ao menos uma.

  | Visitas | Clientes |
  |---|---|
  | 1 | 2.363 |
  | 2 a 4 | 1.110 |
  | 5 a 11 | 513 |
  | 12 ou mais | 167 |

- **Última visita:**

  | Há quanto tempo | Clientes |
  |---|---|
  | até 30 dias | 287 |
  | 31 a 90 dias | 375 |
  | 91 a 180 dias | 368 |
  | 181 a 365 dias | 460 |
  | mais de 1 ano | 2.663 |

- **Ritmo de volta** (clientes com 3 ou mais visitas: 1.163): mediana de **62 dias** entre visitas, com metade das clientes entre 34 e 121 dias. Sem horário marcado:
  - 118 estão "na hora de voltar" (entre 0,8 e 1,5 vez o ritmo dela);
  - **199 estão "sumidas"** (mais de 1,5 vez o ritmo, há menos de 1 ano);
  - só 47 dessas clientes têm horário futuro.
- **Profissional preferida:** 752 das 1.596 clientes com 3 ou mais serviços fazem 60% ou mais com a mesma profissional. 2.832 itens vieram sem profissional.
- **Serviço preferido:** 564 das 1.684 clientes com 3 ou mais serviços têm um serviço que é 40% ou mais do total.
- **Aniversário:** 292 no mês e 60 nos próximos 7 dias.
- **Pacotes:** 31 ativos, de 18 clientes. Hoje nenhum está vencido nem esgotado.
- **Leads abertos:** 155 sem dono e 30 com Sara.

## 6. Ficha ideal (blocos, em ordem)

1. **Cabeçalho:** foto, nome, telefone, botões Conversar/Ligar/WhatsApp. Etiquetas editáveis ali mesmo. Avisos fixos em destaque (alergia, "não gosta de volume", dívida ou crédito).
2. **Situação em uma frase**, montada pelo servidor. Exemplo: "Tem horário amanhã 14h com Maiara · pacote 3/4 · última visita há 20 dias · conversa aguardando resposta há 2h com Sara". Com estados claros: Sem dono, Atrasada, Sumida, Na hora de voltar, Aniversário nesta semana.
3. **Agora:** lead atual (etapa, quem atende, aguardando há quanto tempo, próxima ação) e próximos horários.
4. **Retorno sugerido:** "Volta a cada ~45 dias · próxima volta prevista 02/11 · atrasada 12 dias". Usa o ritmo dela ou, sem histórico, o ciclo do serviço. Botões Agendar e Lembrar.
5. **Números da cliente** (visíveis também para a atendente, sem os valores em dinheiro):

   | Visitas | Desde | Frequência | Ticket médio* | Total* | Faltas / cancelamentos |
   |---|---|---|---|---|---|

   (*só com permissão de ver valores, e depois de corrigido o erro do item 0.1)
6. **Preferências:** profissional preferida (calculada e editável), serviços mais feitos (top 3), aniversário e origem ("Como conheceu" do Avec, ou a origem do lead).
7. **Pacotes:** já existe e está bom.
8. **Visitas:** passadas e futuras juntas (Avec + agenda própria), com profissional, status (Atendida/Faltou/Cancelado) e **a observação do horário**. Fundir com "Atendimentos e compras" por dia.
9. **Financeiro** (gestão): pagamentos, saldo de crédito e dívida.
10. **Anotações da cliente:** um campo único e editável no contato, juntando as 109 anotações hoje presas nos leads e os campos do ChatGuru quando forem importados.
11. **Conversa resumida:** última mensagem e quem respondeu, quantidade de conversas, link "Abrir conversa". Histórico completo recolhido, com os 5 textos crus traduzidos.
12. **Leads:** separar "Mesclado" de "Não é cliente".

No painel da conversa: usar a mesma frase de situação, o retorno sugerido e a profissional preferida, corrigir visitas e "desde" para incluir o Avec, e pôr o link "Ver ficha completa" no nome e na foto.

## 7. Lista de Contatos ideal

**Filtros em botões (com contagem):**

| Filtro | Contagem estimada hoje |
|---|---|
| Sumidas (passou do ritmo, sem horário) | ~199 |
| Na hora de voltar | ~118 |
| Aniversariantes (semana / mês) | 60 / 292 |
| Com pacote (ativo / acabando / vencendo) | — |
| Com horário marcado | — |
| Em atendimento: sem dono / com quem | — |
| Nunca voltou (1 visita) | 2.363 |
| VIP (top 10% em gasto ou 12+ visitas, configurável) | — |
| Faltosas (2+ faltas) | — |

**Filtros em lista:** por profissional, por serviço, por etiqueta e por origem.

**Colunas:** Nome · Situação (frase curta) · Última visita · Visitas · Próximo horário · Profissional preferida · Pacote · Aniversário · Responsável.

**Ordenação:** última visita, mais visitas, nome e ordem de chegada no CRM.

**Ações em massa:** etiquetar, exportar CSV, "Mandar mensagem" (com confirmação) e "Não é cliente". O "Retorno Sugerido" do Avec viraria o filtro "Sumidas / Na hora de voltar", com o botão Agendar em cada linha.