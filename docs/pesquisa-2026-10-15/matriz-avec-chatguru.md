# Matriz Avec + ChatGuru × CRM da Casa Fiaes (15/10/2026)

Esta tabela junta **todas** as funcionalidades achadas nas pesquisas de 15/10 (`avec-funcionalidades.md` e `chatguru-funcionalidades.md`) e diz, para cada uma, como está o nosso CRM hoje e qual lote entrega.

**Base conferida:** o código da branch `agenda-viva`, que saiu da `rodada-2` em `84a902b`. Ela já tem o Lote 1A inteiro e a primeira metade do 1B. O resto do 1B e o 1C estão sendo feitos agora, em paralelo, na `rodada-2`. Os números de linha (`arquivo:linha`) valem para este código.

## Como ler

**Situação hoje**
- **feito**: existe e funciona.
- **parcial**: existe uma parte; a observação diz o que falta.
- **falta**: não existe.

**Lote que entrega**
- **1A, 1B, 1C**: lotes do atendimento, em construção (`docs/superpowers/plans/2026-10-15-lotes-1-atendimento.md`).
- **2, 3, 4**: lotes da spec de 15/10 (`docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md`): 2 = ficha da cliente e Contatos; 3 = relatórios do salão; 4 = configurações e etiquetas.
- **6A, 6B, 6C, 7A, 7B**: lotes da spec nova (`docs/superpowers/specs/2026-10-15-agenda-app-cliente-design.md`): 6A = base da agenda; 6B = agenda viva; 6C = comanda, caixa e comissão; 7A = app da profissional; 7B = área da cliente.
- **D01 a D39**: lista "depois", em ordem de valor, na seção 10 da spec nova. Os itens com "(L5)" são do Lote 5 (ChatGuru restante).
- **—**: não vamos fazer. O motivo está na observação (não se aplica à Casa, a Casa não usa, ou o próprio sistema não tem).

**Quem usa:** Recepção (marca e recebe), Atendente (conversa no WhatsApp), Profissional (cabeleireira), Gestão (dona e gerente), Cliente, Sistema (faz sozinho). Na Casa, Atendente e Recepção têm hoje as mesmas permissões.

---

## Parte 1. Avec

### 1.1 Agenda

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A01 | Agenda do dia com uma coluna por profissional e filtro por nome | Recepção | **parcial** · visão Profissionais das 7h às 21h em linhas de 30 min (`pro-grid.tsx:36`), colunas (`lib/agenda.ts:123`), filtro (`agenda/page.tsx:141`) | 6B | Falta a hachura do horário de trabalho e tocar no espaço livre para marcar |
| A02 | Cor e ordem de cada profissional na agenda | Gestão | **falta** · ordem alfabética (`professionals.ts:12`) | 6A | Paleta fechada de 12 cores que funcionam no claro e no escuro |
| A03 | Rodízio (fila da vez) para quem chega sem hora | Recepção | **falta** | — | A Casa trabalha com hora marcada; o "Encaixe agora" do 6B cobre quem chega sem hora |
| A04 | Buscar a cliente dentro da agenda | Recepção | **parcial** · busca só em Contatos (`contacts.ts:27`) | 6B | |
| A05 | Marcar tocando no horário livre: cliente, serviço que a profissional faz, duração e valor desta vez, observação | Recepção | **parcial** · só o "Agendar" de dentro da conversa (`schedule-sheet.tsx:22`, `updates.ts:140`); nenhum horário do CRM vai para a agenda (`appointments`) | 6B | Hoje 100% dos horários da agenda vieram do Avec |
| A06 | Cadastrar cliente nova ali mesmo (nome e celular) | Recepção | **parcial** · "Novo lead" fora da marcação (`updates.ts:180`) | 6B | Celular obrigatório, como no Avec da Casa |
| A07 | Avisos ao escolher a cliente (alergia, aniversário, completar cadastro) | Recepção | **falta** | 2 + 6B | 6B mostra observação, aniversário e pacote; os avisos fixos da ficha vêm no Lote 2 |
| A08 | Vários serviços na mesma visita, com profissionais diferentes, inclusive ao mesmo tempo | Recepção | **falta** · um serviço por conversa (`schema.ts:160`) | 6B | "Logo depois" ou "ao mesmo tempo com outra profissional" |
| A09 | "Sem preferência" de profissional | Recepção, Cliente | **parcial** · "Qualquer uma" no Agendar (`schedule-sheet.tsx:94`), sem lugar na grade | 6B | O sistema sugere a mais livre e o card leva o selo "qualquer uma"; arrastar o card fica no D13 |
| A10 | Conflito de horário e "forçar encaixe" | Recepção | **parcial** · aviso fixo de 1 h, só contra conversas (`updates.ts:132`) | 6A + 6B | Conflito real pela duração, contra Avec, CRM e bloqueios; encaixe com permissão e registro |
| A11 | Remarcar arrastando para outra hora ou profissional | Recepção | **parcial** · remarcar pelo formulário da conversa (`schedule-sheet.tsx:59`) | 6B + D13 | 6B remarca pelo formulário, com os horários livres; arrastar fica no D13 |
| A12 | Horário recorrente (a cada N semanas) | Recepção | **falta** | D14 | |
| A13 | Cancelar (este ou todos), sem apagar, guardando quem cancelou | Recepção | **parcial** · "Cancelar horário" sem motivo e só nos horários do Avec (`entry-sheet.tsx:48`, `appointments.ts:15`) | 6B | Motivo em lista (o Avec não tem) |
| A14 | Bloquear horário (uma ou todas, período, dias da semana, motivo) | Recepção, Gestão | **parcial** · os 3.934 bloqueios importados aparecem (`avec.ts:74`), mas não dá para criar | 6A | |
| A15 | Horário de trabalho de cada profissional | Gestão | **falta** · só existe o da Casa (`hours.ts:7`) | 6A | Sem cadastro, vale o horário da Casa (ter–sáb, 9h–18h) |
| A16 | Horário da Casa e períodos especiais (Natal, Carnaval) | Gestão | **parcial** · horário semanal (`hours.tsx:16`, `config.ts:42`) | 6A + D24 | No 6A o feriado vira bloqueio "todas" |
| A17 | Passo da grade por profissional (15, 30, 60 min) | Gestão | **falta** · grade fixa de 30 min (`lib/agenda.ts:72`) | D24 | 30 min serve à Casa (10 de 11 profissionais usam 30 no Avec) |
| A18 | Duração e folga de cada serviço | Gestão | **parcial** · duração editável (`service-details.ts:17`), mas 0 de 55 serviços preenchidos | 6A | Duração vazia: a tela pede; o sistema nunca chuta |
| A19 | Serviço feito junto com outro (Livre, Parcial, Restrito) e duração própria da profissional | Gestão | **falta** | D24 | |
| A20 | Salas e equipamentos | Gestão, Recepção | **falta** | D25 | Só se a Casa tiver maca ou aparelho disputado |
| A21 | Etiquetas no horário | Recepção | **parcial** · etiquetas ficam na cliente (`tags.ts:13`) | 6B | Selos "primeira vez" e "qualquer uma" no card |
| A22 | Status: Agendado → Confirmado → Aguardando → Em atendimento → Finalizado → Pago; Cancelado | Todos | **parcial** · agendado, confirmado, compareceu, faltou e cancelado (`lib/agenda.ts:37`) | 6B + 6C | "Pago" vem da comanda (6C) |
| A23 | Origem e autoria do horário (online, interno, quem cadastrou) | Gestão | **parcial** · origem e "quem cadastrou" do Avec (`schema.ts:462`) | 6B | Passa a gravar quem marcou no CRM |
| A24 | Horários da cliente na ficha (futuros e passados) | Recepção | **parcial** · próximos (`contact-avec.tsx:21`); os passados só aparecem como compras | 2 | |
| A25 | Lista de espera | Recepção | **parcial** · só a importada (`waitlist.tsx:17`, `avec.ts:61`) | 6B | Criar na Casa e encaixar quando vagar. A pesquisa não achou lista de espera no Avec; a que aparece hoje veio do relatório `fbd442b2` |
| A26 | Tipo do agendamento (preferencial, primeira vez, indicação, noiva) | Gestão | **falta** | 6B | "Primeira vez" automático no 6B; indicação e noiva viram etiqueta da cliente |

### 1.2 App da profissional (Avec PRO)

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A27 | Login próprio da profissional, que só vê a própria agenda e a própria comissão | Profissional, Gestão | **falta** · não existe perfil de profissional (`permissions.ts:66`) | 7A | Convite por link que a gestão copia; nada é enviado sozinho |
| A28 | Agenda do dia no celular, com cores de status | Profissional | **falta** | 7A | |
| A29 | Ver a agenda das colegas | Profissional | **falta** | D23 | |
| A30 | Marcar pelo app | Profissional | **falta** | D23 | Decisão: no 7A só a recepção marca |
| A31 | Cadastrar cliente pelo app | Profissional | **falta** | — | A recepção cadastra |
| A32 | Comanda pelo app (lançar e receber) | Profissional | **falta** | 7A + 6C | "Finalizar" alimenta a comanda; quem recebe é a recepção |
| A33 | Mudar para Em atendimento e Finalizado | Profissional | **falta** | 7A | |
| A34 | Mensagens manuais à cliente pelo app (lembrete, boas-vindas, obrigado) | Profissional | **falta** | — | Decisão: a profissional não conversa com a cliente pelo sistema |
| A35 | Comissão no app (período, a receber e pagas, detalhe por cliente) | Profissional | **falta** | 7A + 6C | Só aparece quando a comissão estiver configurada |
| A36 | Recibo de comissão configurável (mostrar ou esconder o faturamento) | Gestão | **falta** | 7A | Começa escondendo o valor do serviço, como a Casa faz hoje no Avec |
| A37 | Vale Rápido (antecipar comissão) | Profissional | **falta** | — | Serviço financeiro do Avec; não se aplica |
| A38 | Clientes atendidas e histórico só para leitura | Profissional | **falta** | 7A | Resumo da próxima cliente (última visita, pacote, anotações) |
| A39 | Ficha de anamnese no app | Profissional | **falta** | D16 | A Casa não usa no Avec |
| A40 | Avisos no celular (horário novo, cancelado, cliente chegou) | Profissional | **falta** · o push só avisa atraso de conversa (`push.ts:32`) | 7A | É a 2ª maior queixa do Avec PRO |
| A41 | Split e Avec Conta | Profissional | **falta** | — | Não se aplica (Avec Pay) |
| A42 | Bloquear o próprio horário pelo app | Profissional | **falta** (o Avec também não tem) | 7A | Vira pedido que a recepção aprova |
| A43 | Login que não cai | Profissional | **parcial** · sessão fixa de 30 dias (`sessions-store.ts:7`) | 7A | 90 dias, renovando a cada uso (queixa nº 1 do Avec PRO) |
| A44 | Metas da equipe | Gestão | **falta** (o Avec também não tem) | D39 | |

### 1.3 Lado da cliente

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A45 | Página de agendamento da Casa (link na bio) | Cliente | **falta** | 7B | Construída e DESLIGADA até a gestão decidir |
| A46 | App de marketplace "Avec" | Cliente | **falta** | — | Não se aplica |
| A47 | Botão de agendar no site da Casa | Cliente | **falta** | D33 | Depende do agendamento online ligado |
| A48 | Marcar pelo WhatsApp com IA (Avec IA) | Cliente | **falta** | D32 | Custo de IA |
| A49 | Agendar pelo Instagram | Cliente | **falta** | — | Desligado na Casa |
| A50 | Reserve com o Google | Cliente | **falta** (o Avec também não tem) | — | |
| A51 | Conta da cliente com código de verificação | Cliente | **falta** | D33 | O online do 7B não usa código: vira pedido que a recepção confirma |
| A52 | Juntar cadastros "Sou eu / Familiar" (mãe e filha no mesmo número) | Cliente | **falta** · um contato por telefone (`schema.ts:97`) | D30 | |
| A53 | Aviso de taxa de falta | Cliente | **falta** | D37 | A Casa não cobra |
| A54 | Escolher serviço, profissional, dia e hora; vários serviços | Cliente | **falta** | 7B | DESLIGADO |
| A55 | Cupom e "pedido especial" | Cliente | **falta** | 7B + D36 | "Pedido especial" vira observação no online; cupom fica para depois |
| A56 | Cartão obrigatório ou cobrança na reserva | Cliente | **falta** | D37 | Desligado na Casa |
| A57 | Recusas do servidor (fora do expediente, já tem horário, antecedência) | Sistema | **falta** | 6A + 7B | Quem decide é o motor de horários livres |
| A58 | "Meus agendamentos" | Cliente | **falta** | 7B + D33 | O link mostra o horário marcado; a lista de todos fica para depois |
| A59 | Salvar no calendário e abrir no Maps ou Waze | Cliente | **falta** | 7B | Arquivo de calendário (.ics) e "Como chegar" |
| A60 | Cancelar respeitando a antecedência e ser convidada a remarcar | Cliente | **falta** | 7B | Até 24 h antes (configurável); "Preciso remarcar" vira pedido para a recepção |
| A61 | Confirmar presença pelo site | Cliente | **falta** | 7B | |
| A62 | Confirmar ou remarcar respondendo à mensagem do WhatsApp | Cliente | **parcial** · enquete "Confirmo / Preciso remarcar" pronta e desligada (`templates.ts:37`), voto lido (`webhook.ts:177`) | 7B | Lembrete da véspera com link: construído e DESLIGADO |
| A63 | Excluir a própria conta | Cliente | **falta** | — | Não há conta de cliente; pedido de LGPD vai à Casa |
| A64 | Regras do online (antecedência, prazo de cancelar, dias à frente, quais serviços e profissionais) | Gestão | **falta** | 7B | |
| A65 | Lembrete manual por WhatsApp (3 textos prontos) | Recepção | **parcial** · respostas prontas com "/" (`composer.tsx:43`) | 7B | "Enviar link de confirmação" só preenche o texto; quem envia é a atendente |
| A66 | SMS (100 por mês) | Sistema | **falta** | — | Não se aplica |
| A67 | E-mail a cada reserva | Sistema | **falta** | — | Não vamos fazer |
| A68 | Campanhas de e-mail e SMS | Gestão | **falta** | — | O próprio Avec vai tirar |
| A69 | Pagamento e parcelamento online | Cliente | **falta** | D37 | Desligado na Casa |
| A70 | Comprar pacote pelo site | Cliente | **falta** | D36 | |
| A71 | Clube de assinaturas | Cliente | **falta** | D36 | A Casa não usa |
| A72 | Fidelidade e cashback ("Meus pontos") | Cliente | **falta** | D36 | A Casa não usa |
| A73 | Avaliação de 1 a 5 pela cliente | Cliente | **falta** | D15 | Desligada na Casa |
| A74 | Avaliação lançada à mão para a profissional | Gestão | **falta** | D15 | |
| A75 | Avec IA: conexão e modelos de mensagem da Meta | Gestão | **falta** | — | Não se aplica (usamos o WhatsApp conectado) |
| A76 | Avec IA: confirmação 24 h antes, nas janelas do dia | Sistema | **falta** · enquete desligada (`templates.ts:37`) | 7B | Construído e DESLIGADO; nunca junto com a Avec IA (o próprio guia do Avec exige) |
| A77 | Avec IA: marca, cadastra, informa preço, entende áudio | Sistema | **falta** | D32 | Custo de IA |
| A78 | Avec IA: passa a conversa para uma pessoa | Sistema | **feito** · a conversa já é humana na Fila (`queries/queue.ts:258`) | — | |
| A79 | Avec IA: convite de retorno (7, 3 ou 1 dia antes do prazo) | Sistema | **parcial** · automação de retorno pelo ciclo (`templates.ts:48`), desligada e sem ciclo nos serviços | 2 + D11 | Retorno sugerido no Lote 2; envio só com ok do dono |
| A80 | Avec IA: mensagem de aniversário | Sistema | **parcial** · automação desligada (`templates.ts:81`); o Hoje lista (`today.ts:51`) | 1B + D11 | Envio só com ok do dono |
| A81 | Avec IA: convite a clientes sumidas | Sistema | **parcial** · visão "sem contato há 90 dias" (`lib/queue.ts:5`) | 2 + D11 | |
| A82 | Painel de resultados da IA | Gestão | **falta** | — | Não se aplica |
| A83 | Tirar a cliente dos envios automáticos | Recepção | **parcial** · só "Não é cliente" (`schema.ts:89`) | D17 | "Pausar mensagens automáticas para esta cliente" |

### 1.4 Comanda

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A84 | Abrir comanda pela agenda, já com cliente, profissional e serviço | Recepção | **falta** · "Fechar venda" de 1 serviço no lead (`updates.ts:211`) | 6C | Construída e DESLIGADA até a Casa escolher onde fica o caixa |
| A85 | Comanda avulsa (venda sem horário) | Recepção | **falta** | 6C | |
| A86 | Itens: serviço, produto, pacote, pré-venda, caixinha, vale-presente | Recepção | **falta** | 6C + D08 + D26 | 6C: serviço, produto (nome e preço digitados) e pacote; caixinha no D08; pré-venda e vale no D26 |
| A87 | Serviço extra na comanda | Recepção | **falta** | 6C | |
| A88 | Até 2 assistentes por serviço, com comissão | Recepção | **falta** | D38 | |
| A89 | Editar item (valor, quantidade, profissional) com a comanda aberta | Recepção | **falta** | 6C | |
| A90 | Produto usado no serviço (insumo, em gramas) | Recepção | **falta** | D09 | Depende do estoque |
| A91 | Juntar na comanda um horário marcado depois | Recepção | **falta** | 6C | A comanda junta os serviços da visita do dia |
| A92 | Usar sessão de pacote na comanda | Recepção | **falta** · pacotes só para ver (`packages-list.tsx:23`) | 6C | Profissional obrigatória (é dela a comissão) |
| A93 | Promoção sugerida na comanda | Recepção | **falta** | D36 | A Casa não usa |
| A94 | Prontuário dentro da comanda | Recepção | **falta** | D16 | |
| A95 | Várias formas de pagamento na mesma comanda | Recepção | **parcial** · uma forma por venda (`updates.ts:202`) | 6C | |
| A96 | Formas: dinheiro, crédito, débito, Pix, crédito da cliente (também cheque, boleto, POS, vale, cortesia) | Recepção | **parcial** · Pix, cartão, boleto, dinheiro (`updates.ts:36`) | 6C + D08 | Cortesia, bandeira e cheque no D08 |
| A97 | Troco como crédito da cliente; finalizar com dívida | Recepção | **falta** | 6C + D08 | 6C guarda o troco como crédito; dívida no D08 |
| A98 | Comandas abertas (pendentes) | Recepção | **falta** | 6C | |
| A99 | Corrigir ou excluir comanda fechada (motivo, caixa do dia aberto) | Recepção, Gestão | **falta** | 6C | Cancelar com motivo e refazer; nada se apaga |
| A100 | Regras da comanda (exige caixa aberto, numeração) | Gestão | **falta** | 6C | |

### 1.5 Caixa

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A101 | Abrir o caixa com o troco inicial | Recepção | **falta** | 6C | Um caixa da Casa por vez (o Avec abre um por pessoa) |
| A102 | Venda entra no caixa aberto | Sistema | **falta** | 6C | |
| A103 | Sangria (só com saldo em dinheiro) | Recepção | **falta** | 6C | |
| A104 | Suprimento | Recepção | **falta** | 6C | |
| A105 | Conferir o caixa por forma de pagamento | Recepção | **falta** | 6C | |
| A106 | Fechar com contado × sistema e registrar a diferença | Recepção | **falta** | 6C | A Casa teve 14 caixas com diferença no Avec |
| A107 | Histórico e reabertura de caixa | Gestão | **falta** | 6C | |
| A108 | Obrigar bandeira e conciliar a maquininha Avec Pay | Gestão | **falta** | — | Não se aplica |

### 1.6 Comissão

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A109 | % por profissional × serviço ("aplicar à categoria") | Gestão | **falta** | 6C | Vazio até a Casa preencher; nunca inventar |
| A110 | Comissão congelada no fechamento da comanda | Sistema | **falta** | 6C | Mudar a regra depois não mexe no passado |
| A111 | Relatório de comissão por período | Gestão | **parcial** · só os relatórios crus do Avec (`relatorios/avec/page.tsx:18`) | 6C | |
| A112 | Descontos na comissão (taxa de cartão, antecipação, administração, produto) | Gestão | **falta** | D07 | |
| A113 | Data em que a comissão vale (cartão que cai em 30 dias) | Gestão | **falta** | D07 | |
| A114 | Pagar comissão (em lote, recibo, histórico "Pagas") | Gestão | **falta** | D07 | A Casa provavelmente paga fora do Avec |
| A115 | Recálculo de comissão (até 45 dias) | Gestão | **falta** | — | O nosso cálculo é por retrato; se precisar recalcular, entra no D07 |
| A116 | Comissão de pacote | Gestão | **falta** | 6C | Sobre o valor por sessão, quando ele estiver definido |
| A117 | Comissão de assistente, de produto, de vale e de pré-venda | Gestão | **falta** | D38 | |
| A118 | Contrato (CLT, freelancer), repasse e condições especiais | Gestão | **falta** | D38 | |
| A119 | Gorjeta (caixinha), vale (adiantamento), bônus e descontos recorrentes | Gestão | **falta** | D08 + D07 | |

### 1.7 Pacotes, crédito, vale e clube

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A120 | Cadastrar pacote (serviços × sessões, validade, preço, onde aparece) | Gestão | **falta** | 6C | |
| A121 | Vender pacote na comanda | Recepção | **falta** | 6C | |
| A122 | Dar baixa em sessão | Recepção | **falta** | 6C | |
| A123 | Acompanhar o pacote na ficha (feitas, restantes, validade) | Recepção | **feito** · `packages-list.tsx:23`, `contact-avec.tsx:75` | — | |
| A124 | Dar novo prazo a pacote vencido | Gestão | **falta** | 6C | |
| A125 | Pré-venda (inclusive para quitar dívida) | Recepção | **falta** | D26 | |
| A126 | Migrar créditos com a forma "Cortesia" | Gestão | **falta** | D08 | Usado na virada |
| A127 | Clube de assinaturas (cobrança pelo Asaas) | Gestão | **falta** | D36 | A Casa não usa; exige CPF |
| A128 | Vale-presente | Recepção | **falta** | D26 | A Casa não usa |
| A129 | Crédito da cliente na ficha | Recepção | **parcial** · pagamentos "Crédito Cliente" importados aparecem (`avec.ts:161`) | 6C | Saldo de crédito no 6C; dívida no D08 |

### 1.8 Estoque

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A130 | Cadastro de produto (custo, preço, venda ou uso interno, mínimo, dados fiscais) | Gestão | **falta** | D09 | Confirmar com a Thaise se a Casa usa o estoque |
| A131 | Entrada, saída manual, aprovação de saída e inventário | Gestão | **falta** | D09 | |
| A132 | Baixa automática do produto pelo serviço | Sistema | **falta** | D09 | A Casa não usa |
| A133 | Alerta de reposição e custo médio | Gestão | **falta** | D09 | |
| A134 | Fornecedores, pedido de compra e XML da nota | Gestão | **falta** | D09 | |
| A135 | Desconto do produto na comissão da profissional | Gestão | **falta** | D07 | |

### 1.9 Financeiro e nota fiscal

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A136 | Categorias, contas bancárias e taxas de cartão | Gestão | **falta** | D08 + D27 | |
| A137 | Entradas e saídas (contas a pagar e a receber) | Gestão | **falta** | D27 | |
| A138 | Extrato, conciliação bancária (OFX) e fluxo de caixa | Gestão | **falta** | D27 | |
| A139 | Exportar para o contador (ContaAzul, ZeroPaper) | Gestão | **falta** | D27 | |
| A140 | Nota fiscal de serviço e de produto (certificado A1) | Gestão | **falta** | D06 | A Casa emite: precisa estar pronta antes de desligar o Avec |
| A141 | Multiempresa (nota da profissional parceira) | Gestão | **falta** | D06 | |

### 1.10 Cadastro da cliente e marketing

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A142 | Cadastro (nome, celular, e-mail, aniversário, como conheceu) | Recepção | **feito** · `schema.ts:72` | 2 | CPF, RG e endereço nunca entram (LGPD); o Lote 2 mostra tudo na ficha |
| A143 | Ficha com abas (horários, comandas, créditos, pacotes) | Recepção | **parcial** · `contatos/[id]/page.tsx:38`, `contact-avec.tsx:21` | 2 | |
| A144 | Busca por nome, telefone ou e-mail | Recepção | **feito** · `contacts.ts:27` | — | Sem CPF, de propósito |
| A145 | Anamnese e prontuário | Profissional, Recepção | **falta** | D16 | A Casa não usa no Avec |
| A146 | Anexos e fotos de antes e depois | Profissional | **falta** | 7A + D16 | 7A: foto junto da anotação da profissional |
| A147 | Termo com assinatura digital | Cliente | **falta** (o Avec também não tem) | — | |
| A148 | Avisos fixos ao abrir a cliente (alergia, grupos) | Recepção | **falta** | 2 | |
| A149 | Unificar cadastros duplicados | Recepção | **parcial** · junção automática do número oculto (`lid-merge.ts:15`) | D30 | |
| A150 | Promoções | Gestão | **falta** | D36 | A Casa não usa |
| A151 | Fidelidade e cashback | Gestão | **falta** | D36 | A Casa não usa |
| A152 | Achar clientes sumidas e na hora de voltar | Gestão | **parcial** · visão "sem contato há 90 dias" (`lib/queue.ts:5`) | 2 | |

### 1.11 Relatórios, acessos e integrações

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| A153 | Painel em 3 abas (clientes, profissionais, financeiro) | Gestão | **parcial** · relatórios de atendimento (`relatorios/page.tsx:24`) | 3 | |
| A154 | Taxa de ocupação por profissional | Gestão | **falta** (também vazia no Avec da Casa) | 3 | Precisa do 6A (duração e horário de trabalho) |
| A155 | Mais de 200 relatórios, com busca e favoritos | Gestão | **parcial** · relatórios do Avec guardados, com busca (`relatorios/avec/page.tsx:18`) | 3 | |
| A156 | Mapa de calor da agenda (dia × hora) | Gestão | **parcial** · só de conversas (`queries.ts:322`, `heatmap.tsx:11`) | 3 | |
| A157 | Exportar para Excel | Gestão | **parcial** · CSV dos relatórios (`api/relatorios/[tipo]/route.ts:136`) e Excel dos relatórios do Avec | 3 | |
| A158 | Grupos de acesso (ver, editar, excluir, ver de todos) | Gestão | **parcial** · perfis com 15 permissões (`permissions.ts:5`) | 6A–7A + 4 | Entram as permissões de agenda, caixa e profissional |
| A159 | Verificação em duas etapas | Gestão | **falta** | D21 | |
| A160 | Várias unidades e franquias | Gestão | **falta** | — | Não se aplica |
| A161 | Integrações (Avec Pay, Asaas, prefeitura, contador, Power BI) | Gestão | **falta** | D06 + D27 | Avec Pay e Asaas não se aplicam |
| A162 | Estabilidade (nada se apaga, nunca atualizar em dia de movimento, backup) | Todos | **parcial** · backup diário (`scripts/backup.sh`), auditoria (`schema.ts:300`) | 6A–7B | Cancelar só marca; publicar fora do expediente |

---

## Parte 2. ChatGuru

### 2.1 Caixa de entrada e atendimento

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| C01 | Vários atendentes no mesmo número, cada um com seu login | Atendente | **feito** · `schema.ts:25`, `send.ts:80` | — | A assinatura sai sozinha (1A) |
| C02 | Lista de conversas que se atualiza sozinha | Atendente | **feito** · Fila por prazo (`queries/queue.ts:258`), tempo real (`stream/route.ts`) | — | A nossa ordena por prazo de resposta |
| C03 | Busca por nome ou número | Atendente | **feito** · `queries/queue.ts:358` | — | |
| C04 | Busca pelo texto das mensagens | Atendente | **falta** | D12 | |
| C05 | Filtros por responsável e por etapa | Atendente, Gestão | **feito** · `lib/queue.ts:5`, `lib/queue.ts:60` | — | |
| C06 | Filtro por etiqueta (todas, qualquer, não tem) | Atendente | **falta** | 4 | |
| C07 | Filtro "não lidas" | Atendente | **parcial** · seção "Esperando a Casa responder" (`lib/queue.ts:13`) | D10 | |
| C08 | Conversas arquivadas numa lista à parte | Atendente | **feito** · seção Encerradas (`lib/queue.ts:13`, `conversation-archive.ts:11`) | — | |
| C09 | Favoritos | Atendente | **falta** | D10 | "Acompanhar esta cliente" |
| C10 | Filtro "com mensagem agendada" | Atendente | **falta** | D04 (L5) | Vem com a mensagem agendada |
| C11 | Listas de transmissão | Atendente | **falta** | — | Decisão anterior: lista de transmissão e grupo não são cliente |
| C12 | Prévia da última mensagem por tipo (foto, áudio, documento) | Atendente | **feito** · `queue-item.tsx` | — | |
| C13 | Contador de não lidas no título da aba | Atendente | **parcial** · atrasados no título (`late-watch.tsx:61`) | — | |
| C14 | Painel ao vivo por pessoa (quem está online, quem está sem dono) | Gestão | **feito** · "Equipe agora" (`queries/team-now.ts:16`, 1A) e resumo da Fila (1B) | — | |
| C15 | Responsável pela conversa e "ver só as minhas" | Atendente | **feito** · `assign.ts:41`, permissão "Ver conversas de todas" (`permissions.ts:6`) | — | |
| C16 | Departamento como responsável | Gestão | **falta** | D28 | |
| C17 | Alerta com som ao receber uma conversa | Atendente | **feito** · `alerts-bell.tsx:19`, `sound.ts:77` | — | |
| C18 | Histórico de quem passou a conversa para quem | Gestão | **feito** · eventos (`updates.ts:120`), histórico (`history.ts`) | — | |
| C19 | Rodízio que pula quem está offline, com peso | Gestão | **feito** · distribuição por presença (`distribution.ts:24`, `presence.ts:67`) e níveis (`distribution.ts:71`) | — | A nossa é melhor: presença real e limite por pessoa |
| C20 | Devolver a conversa à fila | Atendente | **feito** · evento "devolvido à fila" (`events.ts:8`), ofertas (`offers.ts:19`) | — | |
| C21 | Redistribuir quando a cliente volta (carteira) | Sistema | **parcial** · prefere a dona anterior, se estiver livre (`routing.ts:10`) | — | |
| C22 | Transferir com recado para a colega | Atendente | **parcial** · transferir com aviso "te passou esta conversa" (`assign.ts:41`) | D01 (L5) | O recado vem com a nota interna |
| C23 | Atalho que avisa a cliente e passa para o setor | Atendente | **falta** | D28 | |
| C24 | Departamentos (permissões somadas, rodízio por setor) | Gestão | **falta** | D28 | |
| C25 | Status Aberto, Em atendimento, Aguardando, Resolvido, Fechado | Atendente | **parcial** · seções automáticas por prazo (`lib/queue.ts:13`) | 1C + D10 | "Aguardando cliente" à mão no 1C; "Resolvido" no D10 |
| C26 | Arquivar sozinho ao resolver e voltar quando a cliente escreve | Sistema | **feito** · `conversation-archive.ts:11` | — | |
| C27 | Tempo para considerar a conversa "reiniciada" ("Obrigado" não reabre) | Sistema | **feito** · agradecimento não vira espera (`worker/index.ts:63`) | — | |
| C28 | Tiques de enviada, entregue e lida | Atendente | **feito** · `conversation.tsx:31` | — | |
| C29 | "Reverificar leitura" e áudio ouvido | Atendente | **falta** | — | Pouco valor |
| C30 | Marcar como não lida | Atendente | **falta** | D10 | |
| C31 | Modo espião (a gestão olha sem marcar como lida) | Gestão | **feito** · "visto" só da dona (`send.ts:236`, 1A) | — | |
| C32 | Presença da equipe (logada, último acesso) | Gestão | **feito** · `presence.ts:67`, `queries/team-now.ts:16` | — | |
| C33 | Anotação interna com @menção (sino e e-mail) | Atendente | **falta** | D01 (L5) | |
| C34 | Relatório de anotações (busca por autora e texto) | Gestão | **falta** | D01 (L5) | |
| C35 | Painel da cliente na conversa (nome, número, responsável, etiquetas, campos) | Atendente | **parcial** · `client-pane.tsx`; campos do ChatGuru só leitura (`schema.ts:93`) | 2 + D29 | |
| C36 | Esconder o número da cliente por permissão | Gestão | **falta** | 7A + D21 | No 7A a profissional nunca vê o telefone |
| C37 | Abas de histórico (status, funil, responsáveis) | Atendente | **feito** · `history.ts`, `contact-timeline.ts:30` | — | |
| C38 | Aba com as mídias da conversa | Atendente | **falta** | D39 | |
| C39 | Quem mandou cada mensagem e por onde | Atendente | **feito** · "Cati · pelo celular · 14:02" (1A) | — | |
| C40 | Carteira de clientes (atendente fixa) | Gestão | **parcial** · `routing.ts:10` | — | |
| C41 | Grupos do WhatsApp na plataforma | Atendente | **falta** | — | De propósito: grupo não é cliente |
| C42 | Iniciar conversa com número novo | Atendente | **feito** · `start-conversation.ts:16`, `updates.ts:180` | — | |
| C43 | Corrigir o 9º dígito e recusar número sem WhatsApp | Atendente | **parcial** · 9º dígito corrigido (`phone.ts`); a checagem de WhatsApp falta | D30 | |
| C44 | Bloqueio do robô ao puxar uma conversa | Atendente | **falta** | — | Não há robô de menu |
| C45 | Relatório de conversas adicionadas | Gestão | **falta** | — | Pouco valor |
| C46 | Sino de alertas e de mensagens | Atendente | **feito** · `alerts-bell.tsx:19` | — | |
| C47 | Sons configuráveis | Gestão | **parcial** · um som de alerta fixo (`sound.ts:77`) | — | |
| C48 | Aviso no celular e no computador (push) | Atendente | **feito** · `push.ts:32` | 1B + 7A | Hoje são 0 aparelhos inscritos; o 1B pede no primeiro login |
| C49 | E-mail nas menções | Atendente | **falta** | D01 (L5) | |
| C50 | Aviso no WhatsApp pessoal da atendente | Atendente | **falta** | D18 | |

### 2.2 Robô (diálogos)

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| C51 | Diálogos com gatilhos, ações e prioridade | Gestão | **parcial** · automações por tempo (`engine.ts:215`) | D17 | |
| C52 | Gatilhos por mensagem (texto, palavra, CPF, CEP, data, mídia, novo chat, ligação perdida, DDD) | Gestão | **parcial** · palavras-chave viram sinal (`signals.ts:89`) | D17 | CPF nunca (LGPD) |
| C53 | Ações (responder, anexar, delegar, etiqueta, funil, anotação, status, pesquisa, webhook, campo) | Gestão | **parcial** · alertar, escalar, mover, enviar texto ou enquete (`types.ts:20`) | D17 | |
| C54 | Ação com atraso e janela de envio ("depois das 20h vai às 10h") | Sistema | **parcial** · a fila de envio só manda com a Casa aberta e com teto por hora (`outbox.ts:87`) | — | |
| C55 | Aprovação humana antes do envio | Gestão | **falta** | D17 | "Sugerir em vez de enviar" |
| C56 | Tipos de diálogo (padrão, contínuo, manual), limite de execuções e intervalo | Gestão | **parcial** · uma execução por janela (`schema.ts:280`) | D17 | |
| C57 | Contextos (a "memória" que monta menus) | Gestão | **falta** | D28 | |
| C58 | Intenções e entidades | Gestão | **parcial** · palavras-chave (`signals.ts:89`) | D17 | |
| C59 | Menu de boas-vindas | Cliente | **falta** | D28 | |
| C60 | Resposta fora do horário | Sistema | **feito** · `auto-reply.ts:20` | — | |
| C61 | Feriados (data específica e todo ano) | Gestão | **falta** | 6A + D24 | O bloqueio de feriado do 6A vale para a agenda; a resposta automática no D24 |
| C62 | Coleta de dados pelo robô (e-mail, CPF) | Sistema | **falta** | — | CPF nunca (LGPD) |
| C63 | Mandar dados para outro sistema (Post para URL) | Gestão | **falta** | D35 | |
| C64 | Acionar ou agendar um diálogo à mão | Atendente | **falta** | D04 (L5) + D17 | |
| C65 | Robô ligado ou desligado por cliente | Atendente | **falta** | D17 | |
| C66 | Reprocessar mensagem | Atendente | **falta** | — | Não se aplica |
| C67 | Receitas prontas (cliente parada no menu, encerrar, origem do lead, opinião ao gestor) | Gestão | **parcial** · origem por link e QR (`sources.ts:21`), Encerrar (`conversation-archive.ts:11`), aviso de parado (`engine.ts:215`) | D15 + D17 | |
| C68 | Recursos da API oficial (modelos, botões, listas, catálogo) | Gestão | **falta** | D34 | |
| C69 | Menu falado (opções em áudio) | Cliente | **falta** | — | Não vamos fazer |

### 2.3 Mensagens

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| C70 | Respostas rápidas com "/" | Atendente | **parcial** · lista da Casa com {nome} (`composer.tsx:43`) | D05 (L5) | |
| C71 | Respostas pessoais que o admin copia para a equipe | Gestão | **falta** | — | De propósito: uma lista única da Casa |
| C72 | Biblioteca de arquivos com etiquetas | Atendente | **falta** | D19 | |
| C73 | Áudio pré-gravado que sai como mensagem de voz | Atendente | **falta** | D19 | |
| C74 | Mensagem agendada (texto ou áudio) com "Executar" e "Cancelar" | Atendente | **falta** · a fila programada só serve às automações (`outbox.ts:59`) | D04 (L5) | |
| C75 | Texto, emoji e formatação do WhatsApp | Atendente | **feito** · `composer.tsx`, `emoji-picker.tsx` | — | |
| C76 | Gravar áudio na plataforma | Atendente | **feito** · gravador no `composer.tsx` | — | |
| C77 | Foto, vídeo e documento | Atendente | **parcial** · foto, PDF e áudio (`send.ts:140`); vídeo pela tela falta | D20 | |
| C78 | Figurinhas e localização (só API oficial) | Atendente | **falta** | D34 | |
| C79 | Responder citando a mensagem | Atendente | **feito** · `funil/actions.ts:68` | — | |
| C80 | Encaminhar mensagens | Atendente | **falta** | D20 | |
| C81 | Reações (ver e enviar) | Atendente | **falta** · descartadas (`webhook.ts:71`) | D02 (L5) | |
| C82 | Ligações registradas (atendida, perdida) | Atendente | **falta** · descartadas (`webhook.ts:72`) | D02 (L5) | |
| C83 | Mensagem apagada ou editada pela cliente | Atendente | **feito** · `schema.ts:198`, `schema.ts:201` | — | |
| C84 | Editar ou apagar mensagem para todos | Atendente | **falta** | D20 | |
| C85 | Nome da atendente nas mensagens (assinatura) | Atendente | **feito** · `signature.ts:25` (1A) | — | |
| C86 | Transcrição de áudio | Atendente | **falta** | D31 | Custo de IA |
| C87 | Resumo da conversa por IA | Gestão | **falta** | D31 | Custo de IA |

### 2.4 Campanhas, etiquetas, campos, funil e tarefas

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| C88 | Campanhas (mensagem em massa por filtro, com intervalo) | Gestão | **falta** | D11 (L5) | Só com ok do dono; risco de banimento |
| C89 | Importar contatos por planilha (até 10 mil) | Gestão | **feito** · `import.ts:110`, limite (`import.ts:62`) | — | |
| C90 | Etiquetas com cor e permissões | Atendente | **parcial** · etiquetas sem cor (`tags.ts:13`) | 4 | |
| C91 | Campos personalizados da ficha | Gestão | **parcial** · os do ChatGuru ficam só leitura (`schema.ts:93`) | D29 | |
| C92 | Funil em quadro (mover, buscar, restringir quem vê) | Atendente | **feito** · Quadro (`funil/page.tsx:19`) | 1C | Funil novo no 1C |
| C93 | Vários funis ao mesmo tempo | Gestão | **falta** | — | Funis paralelos (noivas) viram etiqueta |
| C94 | Exportar o funil em CSV | Gestão | **parcial** · CSV agregado dos relatórios (`api/relatorios/[tipo]/route.ts:136`) | 2 | |
| C95 | Tarefas e lembretes (o ChatGuru não tem) | Atendente | **feito** · próximas ações (`tasks.ts:92`), lembrete (`tasks.ts:136`) | — | |
| C96 | Follow-up automático (cadência) | Sistema | **parcial** · tentativas D+1, D+3, D+7 sem envio (1C) | 1C | |

### 2.5 Relatórios e gestão

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| C97 | Página inicial com gráficos | Gestão | **feito** · Hoje e Relatórios (`relatorios/page.tsx:24`) | — | |
| C98 | Novos chats, novos atendimentos, mensagens enviadas e recebidas | Gestão | **feito** · `queries.ts:387` | — | |
| C99 | Tempo médio de espera pela primeira resposta | Gestão | **feito** · `queries.ts:76` | — | |
| C100 | Mapa de calor de dia × hora | Gestão | **feito** · `queries.ts:322`, `heatmap.tsx:11` | — | |
| C101 | Relatório por pessoa (atendidos, mensagens, tempo médio de todas as respostas) | Gestão | **parcial** · primeira resposta por pessoa (`queries.ts:353`, `team.ts:20`) | 3 | |
| C102 | Relatório salvo e enviado sozinho por e-mail ou WhatsApp | Gestão | **parcial** · PDF mensal gerado e não enviado (`pdf.ts:73`) | D18 | |
| C103 | Relatório de mensagens (agendadas, na fila, com erro) | Gestão | **falta** | D18 | |
| C104 | Relatório de acessos (tempo logado) | Gestão | **parcial** · último acesso (`schema.ts:38`) | D21 | |
| C105 | Relatório de diálogos do robô | Gestão | **falta** | — | Não se aplica |
| C106 | Pesquisa de satisfação (nota de 0 a 10 por link) | Gestão | **falta** | D15 | |
| C107 | Exportar a lista de contatos (CSV) | Gestão | **falta** | 2 | |
| C108 | Exportar relatórios (CSV e PDF) | Gestão | **feito** · `api/relatorios/[tipo]/route.ts:136`, `pdf.ts:73` | — | |

### 2.6 Equipe, permissões e segurança

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| C109 | Criar usuária (e-mail, senha, nome visível para a cliente) | Gestão | **feito** · convite e criação direta (`profiles.ts:132`, `profiles.ts:147`), assinatura (`schema.ts:42`) | — | |
| C110 | Admin × normal e permissões por grupo | Gestão | **feito** · perfis editáveis (`permissions.ts:5`, `profiles.ts:46`) | 6A–7A | Entram as permissões de agenda, caixa e profissional |
| C111 | Permissão por filtro e por "ver o número da cliente" | Gestão | **parcial** | 4 + 7A | |
| C112 | Horário de acesso por pessoa | Gestão | **falta** | D21 | |
| C113 | IPs autorizados, código por e-mail e aparelhos seguros | Gestão | **falta** | D21 | |
| C114 | Bloqueio depois de várias senhas erradas | Sistema | **feito** · `login/actions.ts:31` | — | |
| C115 | Fuso e logo da conta | Gestão | **parcial** · fuso de Salvador fixo (`lib/agenda.ts:5`) | — | |
| C116 | Uso pelo celular | Atendente | **feito** · sistema instalável (`public/manifest.webmanifest`) | 7A | O 7A traz a tela da profissional |

### 2.7 Números, canais e integrações

| # | Funcionalidade | Quem usa | Hoje no CRM | Lote | Observação |
|---|---|---|---|---|---|
| C117 | WhatsApp pelo QR Code, com vigia da conexão | Gestão | **feito** · `config/whatsapp/page.tsx`, `watchdog.ts` | — | |
| C118 | Fila de mensagens que ainda não saíram | Gestão | **parcial** · a falha aparece no balão (`conversation.tsx:31`) | D18 | |
| C119 | WhatsApp oficial (API da Meta) e CoEx | Gestão | **falta** | D34 | |
| C120 | Vários números com filtro por aparelho | Gestão | **parcial** · vários canais (`schema.ts:116`), sem filtro | D34 | |
| C121 | Instagram e Messenger | Atendente | **falta** (o ChatGuru também não tem) | — | |
| C122 | Contato sem número visível (BSUID, @lid) | Sistema | **feito** · `schema.ts:91`, `lid-merge.ts:15` | — | |
| C123 | App no Make e no n8n | Gestão | **falta** | D35 | |
| C124 | Integrações prontas (Google Agenda, Feegow, Asaas, RD Station) | Gestão | **falta** | — | A agenda própria (6A–7B) substitui a integração de agenda |
| C125 | Agendamento com lembrete, confirmação e remarcação pela cliente (pago à parte no ChatGuru) | Cliente | **falta** | 7B | Link de confirmação; lembrete da véspera construído e DESLIGADO |
| C126 | Assistente de IA sob medida | Gestão | **falta** | D32 | |
| C127 | API (enviar, adicionar chat, nota, contexto) | Gestão | **parcial** · só a entrada da ficha do ChatGuru (`api/importar/chatguru/route.ts`, `chatguru-import.ts:21`) | D35 | |

---

## Contagem por situação

| | feito | parcial | falta | Total |
|---|---|---|---|---|
| Avec (A01–A162) | 4 | 36 | 122 | 162 |
| ChatGuru (C01–C127) | 42 | 30 | 55 | 127 |
| **Total** | **46** | **66** | **177** | **289** |

**Para onde vai o que é parcial ou falta (243 itens)**

| Destino | Avec | ChatGuru | Total |
|---|---|---|---|
| Lotes desta noite (6A, 6B, 6C, 7A, 7B), sozinhos ou junto com outro lote | 74 | 4 | 78 |
| Lotes 1B/1C, 2, 3 e 4 (já desenhados em 15/10), sem lote desta noite | 12 | 8 | 20 |
| Lista "depois" (D01–D39), sem lote já desenhado | 54 | 54 | 108 |
| Não vamos fazer (—) | 18 | 19 | 37 |

Leitura rápida:
- **O ChatGuru está quase coberto** no que a Casa usa: 42 de 127 já estão feitos, e o que falta para desligá-lo está no Lote 5 (nota interna, ligações e reações, importação da ficha, mensagem agendada e respostas prontas com variáveis: D01 a D05).
- **O Avec é o grande buraco**: só 4 de 162 estão feitos. O que a Casa usa todo dia (agenda, comanda, caixa, comissão e pacotes) cai nos lotes desta noite. Ficam de fora a nota fiscal (D06), as taxas de cartão e a caixinha (D08) e o estoque (D09), que são condição para desligar o Avec.
- Os 37 "não vamos fazer" são, quase todos, recursos que a Casa não usa ou que não se aplicam (Avec Pay, marketplace, SMS, campanhas de e-mail, robô de outra plataforma).

As contagens saíram de um script sobre as tabelas acima. Cada linha conta uma vez. Quando a linha cita dois lotes, vale o desta noite, se houver; senão, o lote já desenhado; senão, a lista "depois".
