# Fluxo novo do CRM: menu, comanda no centro, caixa, ao vivo e fechamento do dia

Aprovado pelo dono em 17/10/2026. A versão visual está em https://claude.ai/artifact/Enm1ZRZGcvJzsrWSn3SmmZ. O protótipo do Hoje está em https://claude.ai/artifact/HYBxKW32J4RRAnCmHKpek9.

O desenho das telas atuais está aprovado e não muda. Muda o caminho entre elas. O sistema passa a seguir o dia da Casa: a cliente escreve, marca, chega, é atendida, paga e volta. Cada passo acontece em uma tela, tem um dono e deixa rastro. Os outros lugares só mostram o que aconteceu.

## Decisões do dono (17/10)
- **Caixa por pessoa.** Cada pessoa abre o próprio caixa, com fundo de troco, e fecha com a própria contagem, como no Norte Vendas. A gestão vê "Caixas da equipe".
- **Por enquanto, todos podem mudar o preço, dar desconto e dar cortesia.** Cada mudança registra quem fez, o valor anterior e o motivo, e aparece no Financeiro.
- **Avec e CRM juntos (decisão de 17/10, pedido da Casa):** a agenda e o caixa ficam nos dois, sem data para sair do Avec. Isso tem três consequências:
  - a importação do Avec continua, e o horário que alguém mexer no CRM é preservado (`crmTouchedAt`);
  - o caixa do CRM é ligado (`caixa_modo = "crm"`) quando estiver pronto;
  - o Financeiro mostra o caixa do CRM e compara com os pagamentos do Avec do mesmo dia, sem somar os dois.

## O dia (fonte única de cada passo)

| Passo | Quem faz | Onde | O que acontece |
|---|---|---|---|
| 1 | Atendente | Conversas › Fila | Responde, orça e marca. "Agendar" sempre cria o horário na Agenda. |
| 2 | Sistema | Configurações › Mensagens | Envia um lembrete só. O texto é montado na hora de enviar, com o nome de quem atende de verdade (o assistente sai no nome da principal). |
| 3 | Recepção | Hoje › Recepção | "Chegou" vale para a visita toda. A comanda abre com os serviços marcados, cada um com o preço do catálogo. |
| 4 | Profissional | App da profissional, ou a recepção pela comanda | Começa e Finaliza cada serviço. "Fez algo a mais?" entra na comanda. |
| 5 | Recepção | Caixa | A comanda com tudo finalizado vai para "A receber". Ali se ajusta preço, item, desconto e cortesia, e se recebe em uma ou mais formas. |
| 6 | Recepção e gestão | Caixa › Fechar o dia | Três passos: horários sem desfecho, comandas abertas e contagem por forma de pagamento. |
| 7 | Sistema | Conversas e Relatórios | A conversa vai para Atendida. Comissão e Financeiro são calculados sozinhos. "Hora de voltar" lembra a cliente. |

## Menu

São 5 itens do dia a dia e o grupo **Gestão**, que aparece só com permissão. Os subtópicos ficam dentro do item aberto.

| Item | Rota | Pergunta | Subtópicos |
|---|---|---|---|
| Hoje | `/` | Como está a Casa agora? | Recepção (`/`) · Ao vivo (`/ao-vivo`) |
| Conversas | `/atendimento` | Quem eu preciso responder? | Fila (`/atendimento`) · Quadro (`/funil`) · Programadas (`/atendimento/programadas`) |
| Agenda | `/agenda` | Quem vem e quando? | Dia · Semana (`?v=semana`) · Pendências |
| Caixa | `/caixa` (só com `caixa_modo=crm`) | Quem falta pagar e quanto entrou? | A receber · Fechamentos (`/caixa/fechamentos`) |
| Clientes | `/contatos` | Quem é essa pessoa? | Lista · Com pacote (`/servicos?aba=clientes`) |
| Relatórios (Gestão) | `/relatorios` | Como a Casa está indo? | Visão geral · Salão · Análise · Financeiro · Comissão (`/caixa/comissao`) · Jornada (`/jornada`) · Relatórios do Avec (`/relatorios/avec`) |
| Serviços e pacotes (Gestão) | `/servicos` | O que a Casa vende e por quanto? | Serviços · Pacotes |
| Configurações (Gestão) | `/config` | Como o sistema se comporta? | (o índice atual) |

- **Jornada** sai das abas da Conversa e vai para Relatórios.
- **Configurações › Serviços**, que hoje é só um atalho, sai.
- **Celular:** a barra de baixo tem Hoje, Conversas, Agenda, Caixa (se ligado) e Mais. O "Mais" tem Clientes, o grupo Gestão e Sair.

## Comanda no centro
- A **visita** (cliente + dia) nasce quando o horário é criado, inclusive na importação do Avec. Os horários antigos recebem visita por backfill.
- **Chegou** marca a visita toda e abre a comanda, que já existe no caixa 6C (`comandas.visit_id`). Os itens são os serviços da visita, com preço do catálogo e profissional.
- **Mesmo componente em todo lugar.** Hoje, Agenda, conversa e Caixa abrem a mesma comanda grande: serviços, quem faz, assistente, horário, estado, valor e total. As ações dependem da permissão.
- **Comparecimento** é o estado dos horários e da comanda. O "Ela veio?" e os outros lugares só mostram.
- **Esperas às 00:00 do Avec** (relatório Lista de espera) ficam fora da comanda e do Hoje.

## Caixa (modelo do Norte Vendas, sem a taxa de 10%)
- **Por pessoa:** "Abrir caixa, {nome}" com o fundo de troco. Sangria e suprimento pedem motivo. "Fechar caixa" mostra o esperado por forma de pagamento e pede a contagem por forma: dinheiro por cédula e moeda, cartão e PIX pelo total. A contagem cega é opcional. Diferença acima da tolerância pede aprovação da gestão. A gestão tem "Caixas da equipe".
- **Fila "A receber":** comandas com tudo finalizado, da mais antiga para a mais nova. Também aparecem "Em atendimento" e "Pagas hoje".
- **Pagamento:**
  - várias formas lançadas uma a uma, com "Restante a pagar" e troco calculado só sobre o dinheiro;
  - formas: PIX, Crédito (bandeira obrigatória e parcelas), Débito (bandeira), Dinheiro, Cortesia, Crédito da cliente e "Outra", cadastrável pela gestão em Serviços e pacotes › Formas de pagamento;
  - observação;
  - pagamento parcial, que deixa a comanda em aberto com saldo.
- **Item:**
  - alterar o preço, com motivo;
  - desconto em R$ ou em %, com motivo;
  - adicionar serviço ou produto;
  - usar sessão de pacote.
- **Auditoria:** item cancelado, preço alterado, desconto, cortesia, sangria grande, estorno e reabertura.
- **Nota fiscal (futuro):** fica para depois do "Finalizar". Serviço é NFS-e da Prefeitura de Salvador; produto é NFC-e. Desde já o caixa guarda o tipo do item (serviço ou produto) e o CPF opcional.

## Ao vivo (`/ao-vivo`, subtópico do Hoje)
- Uma coluna por profissional ativa no dia, com:
  - a cliente de agora, o serviço, o tempo desde o início e o tempo previsto restante;
  - a próxima cliente.
- **No topo:** atrasadas para chegar, esperando começar e a receber.
- **Atualização:** sozinha, com botão de tela cheia para o monitor da recepção.

## Hoje › Recepção
Segue o protótipo:
- **Faixa no topo:** Conversas esperando · Na Casa agora · Ainda vão chegar · Atrasadas para chegar.
- **Quadro** com A chegar · Na Casa · Finalizou · Não veio. Cada cartão é uma comanda (uma por cliente) com o nome inteiro, um serviço por linha com bolinha de estado e profissional, e barra de progresso. "Chegou" fica no cartão.
- **"Atrasada Xh"** aparece só em A chegar. Nunca "sem baixa" no meio do dia.
- **Coluna estreita de conversas:** Esperando resposta · Para retomar · Aniversário · Equipe agora.

## Fechar o dia e Financeiro
- **Caixa › Fechar o dia** tem três passos:
  1. horários sem desfecho, com o estado do Avec sugerido;
  2. comandas abertas;
  3. fechar o próprio caixa.

  Substitui Sem baixa, Comparecimentos para conferir e Fechar caixa, que hoje estão espalhados.
- **Relatórios › Financeiro:**
  - entradas por dia, forma de pagamento, profissional, serviço e categoria, e por caixa (pessoa);
  - ticket médio;
  - descontos, cortesias e preços alterados, com quem fez e o motivo;
  - pacotes vendidos e sessões usadas;
  - comissão;
  - exportação em Excel com as abas Painel, Formas, Caixas, Vendas, Itens e Exceções.

## Juntar e tirar (quando a agenda do CRM sair do modo consulta, `agenda_modo` dupla)

| Hoje | Fica |
|---|---|
| `ScheduleSheet` (só `deals.scheduledAt`) | o `BookingSheet` |
| "Fechar venda" na conversa | a comanda |
| `deals.attendance` como entrada | derivado da comanda |
| LeadSheet do Quadro | o painel da Fila |
| as automações `lembrete_agendamento` e `confirmacao_d1` | o `lembrete_d1` |
| pacotes editados em `/caixa/pacotes` | só em Serviços e pacotes |

## Um nome para cada coisa (texto da tela; código e banco não mudam)

| Nome que fica | Nomes que saem |
|---|---|
| Conversas | Atendimento (título e menu) |
| Aberto / Aguardando / Resolvido (status, escolha do dono em 16/10) | Encerrar, Encerradas |
| Aguardando a cliente | Bola com a cliente |
| Hora de voltar | Retorno sugerido, Na hora de voltar, Para reengajar |
| Combinado | Próxima ação, Minhas próximas ações |
| Comanda | visita, conta (na tela) |
| Finalizado (serviço) e Atendida (etapa) | — |
| Fechar o dia | (substitui Sem baixa e Comparecimentos para conferir) |

## Ordem
1. Correções da Cati (branches `cati-1710` e `contato-1710`, em andamento).
2. Plano 1: menu agrupado e nomes únicos.
3. Plano 2: visita e comanda no centro, Hoje › Recepção e Ao vivo. Depende de `cati-1710`.
4. Plano 3: caixa por pessoa e pagamento novo.
5. Plano 4: Fechar o dia, Financeiro e Comissão.
6. Plano 5: limpeza da seção "Juntar e tirar", na virada do Avec.
7. Nota fiscal.
