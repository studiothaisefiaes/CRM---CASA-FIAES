# Paridade ChatGuru + Avec: o que ainda impede a Casa de desligar os dois amanhã

Conferi em 15/10: o código em `src/` (branch rodada-2), o banco de produção (só SELECT) e 10 telas abertas em navegador headless, sem clicar em nada que mude dado e sem abrir conversa.

**O ponto central é que, hoje, ninguém atende pelo CRM.** Nenhuma mensagem foi enviada por uma pessoa pelo CRM desde que ele existe (`messages.sent_by_user_id` está vazio em todas). Nos últimos 7 dias saíram 767 mensagens, todas pelo ChatGuru ou pelo celular. No dia 14/10 foram 317 enviadas e 250 recebidas. Das 2.498 mensagens enviadas em 30 dias, 2.154 (86%) começam com a assinatura `*SARA - CASA FIAES:*` (1.388) ou `*CATI - CASA FIAES:*` (766). O CRM hoje só espelha o que acontece no ChatGuru.

## Situação de cada item essencial no código

### ChatGuru

| Item | Situação | Onde |
|---|---|---|
| Assinatura `*NOME - CASA FIAES:*` | **Não feito.** `sendFromCrm` envia o texto puro, e o backlog ainda marca como 📝 | `src/server/domain/send.ts:79-103` |
| G01 Ficha e histórico do ChatGuru | **Não migrou nada.** `chatguru_records` tem 0 registros e nenhum contato tem `imported_fields.chatguru`. Existe só 1 etiqueta, usada em 38 contatos | `src/app/api/importar/chatguru/route.ts` (endereço pronto, depende do diálogo no ChatGuru) |
| G03 Contato @lid | Feito: 8 contatos "Número oculto" com conversa aberta | `src/server/whatsapp/webhook.ts:257-259` |
| G04 Nota interna | **Não existe** (nenhuma ocorrência no código) | — |
| G06/G07 Filtro por etiqueta; cor, renomear e juntar etiquetas | **Não existe.** A tabela de etiquetas não tem cor, não há aba Etiquetas em Configurações e a Fila não filtra por etiqueta | `src/server/db/schema.ts:384-389`, `src/components/config/config-nav.tsx:9`, `src/lib/queue.ts:5` |
| G08 Mensagem agendada | **Não existe.** A fila de envio programado só serve às automações | `src/server/domain/outbox.ts:59` |
| G09 Respostas prontas | Parcial: são 4, chamadas com "/" no composer, aceitam só `{nome}` e não levam anexo | `src/components/lead/composer.tsx:43` |
| Transferência | Feita, inclusive "Transferida por…" | `src/server/domain/assign.ts:41` |
| G27 "Visto" quando a gestão só espia | **Não feito.** Abrir a conversa marca como lida para a cliente | `src/components/queue/conversation-pane.tsx:121`, depois `send.ts:226` |
| G31/G32 Ligações e reações | **Descartadas** (lista de eventos ignorados) | `webhook.ts:71-72` |
| G41 Exportar contatos em CSV | **Não existe** | — |
| G46 Lembrete D-1 / enquete | Parcial: as duas automações existem e estão **desligadas**. Quando ligadas, só olham o horário marcado na conversa, não os horários da agenda | `src/server/rules/engine.ts:73-77`, `templates.ts:27-46` |
| Marcar como aguardando | Só existe de forma automática (seção "Aguardando a cliente") e pelo "Retomar depois". Não há status manual | `src/lib/queue.ts:13-18` |
| Criar etapas novas no funil | **Não é possível.** Os tipos de etapa são fixos no banco, e a tela de etapas só renomeia, muda prazo e reordena | `schema.ts:7`, `src/server/domain/config.ts:22-27` |

### Avec (as 14 essenciais)

| Item | Situação | Onde e evidência |
|---|---|---|
| G01 Serviço com duração e preço | Parcial: o campo existe, mas **0 de 55 serviços têm duração** (52 têm preço) | `schema.ts:105-107`, `config/listas/actions.ts:15` |
| G03 Dia em colunas por profissional | Parcial: a visão "Profissionais" mostra "1 horário / livre" por pessoa, sem grade de horas | `src/components/agenda/pro-grid.tsx` |
| G05 Marcar direto na agenda | **Não existe.** A única ação da Agenda é mudar o status. Nenhum horário foi criado pelo CRM: todos os registros de `appointments` vieram do Avec | `src/app/(app)/agenda/actions.ts:11` |
| G06 Horário de trabalho | **Não existe por profissional.** O horário da Casa nunca foi salvo; a tela "Mensagens automáticas" diz "Ninguém salvou o horário ainda" e os prazos correm no padrão seg–sex 8–20, sáb 8–17 | tabela `settings` só tem o sinal do worker |
| G07 Bloqueio | Parcial: os 3.934 bloqueios importados aparecem (19 ainda valendo), mas não dá para criar um | `schema.ts:463` |
| G08 Conflito pela duração | Parcial e frágil: janela fixa de 1 h, que só compara com os horários marcados nas conversas. Ignora os 153 horários futuros que vieram do Avec e os bloqueios | `src/server/domain/updates.ts:134-157` |
| G14 Cancelar | Parcial: "Cancelar horário" sem motivo e só para horários do Avec | `src/components/agenda/entry-sheet.tsx` |
| G15 Vários serviços na mesma visita | **Não existe** (um serviço por conversa) | — |
| G19/G20/G21 Login, perfil e tela da profissional | **Não existe.** A profissional não tem ligação com login nem horário, e não há permissão nenhuma de agenda | `schema.ts:399-410`, `src/lib/permissions.ts:5-11` |
| G24 Observação no horário | Parcial: o campo existe em `appointments.notes` | — |
| G43 Estabilidade | Parcial (backup diário) | — |
| G46 Importar clientes | Feito: 6.083 contatos | — |

**Quem faz o quê está vazio.** `professional_services` tem 0 linhas. Ao escolher um serviço no "Agendar", a lista de profissionais fica vazia, porque a tela filtra pelos vínculos (`schedule-sheet.tsx:34`). O servidor também recusaria a combinação (`professionals.ts:75`). Resultado: dos 32 horários futuros marcados nas conversas, nenhum tem serviço nem profissional.

**Venda, caixa, comissão e pacotes.** O "Fechar venda" aceita 1 serviço e 1 forma de pagamento (pix, cartão, boleto ou dinheiro), sem profissional e sem comissão (`updates.ts:198-240`). Não existe caixa nem comissão. Os pacotes só podem ser vistos: há 31 ativos e 26 sessões usadas em 90 dias, mas o CRM não vende pacote nem dá baixa em sessão (`packages-list.tsx`). Estoque não existe, e a Casa vende produtos (124 itens de produto em 90 dias).

## O que impede desligar, em ordem de impacto

### Imprescindível

1. **Assinatura nas mensagens.** As clientes estão acostumadas a ver `*SARA - CASA FIAES:*`; sem isso, a equipe não troca de ferramenta. O ajuste é pequeno, em `send.ts:80`.
2. **Mostrar quem está atendendo de verdade.** Das 108 conversas abertas que aparecem como "Sem dono", 106 já têm alguém respondendo pelo ChatGuru (67 pela SARA, 39 pela CATI). No Quadro aparece "Você: *SARA - CASA FIAES:*" mesmo com outra pessoa logada. Na Agenda, os horários vindos de conversa mostram "atende: sem dono", que se confunde com "profissional". A correção é ler o nome da assinatura nas mensagens enviadas pelo celular e usar como dono e autor.
3. **Avisos que explicam sozinhos.** O texto hoje é "Fulana está sem resposta há 10 min", sem dizer de quem é a conversa nem o que fazer. O aviso "Retomar contato com X — X" repete o nome. Dos 39 avisos de tarefa da gestão em 7 dias, 34 seguem sem ler.
4. **Trazer a ficha do ChatGuru** (etiquetas, campos, responsável) e depois o histórico e as anotações. Hoje não entrou nada. Isso depende da Casa criar o diálogo no ChatGuru e exportar os CSVs.
5. **Nota interna**, para a troca de turno e para guardar as anotações migradas.
6. **Etapas configuráveis no funil.** Foi pedido hoje e hoje é impossível sem mexer no banco.
7. **Salvar o horário real da Casa.** Os prazos e avisos estão rodando num horário padrão nunca confirmado.
8. **Agenda viva no CRM**, para largar o Avec:
   - marcar direto na Agenda;
   - serviço com duração (0 de 55 hoje);
   - vínculos de quem faz o quê (0 hoje);
   - conflito checado também contra os horários do Avec e os bloqueios;
   - horário de trabalho de cada profissional;
   - criar bloqueio.

   Enquanto isso não existir, os dados do Avec são uma foto de 14/10: o último relatório entrou nesse dia e não há sincronização, então a agenda do CRM fica velha todo dia.
9. **Comanda.** Vários serviços, uma profissional por item, pagamento dividido e "Crédito Cliente" (216 pagamentos assim em 90 dias), mais o caixa do dia e a comissão (de 0 a 65% no Avec). Sem isso, o caixa continua fechando no Avec.
10. **Lembrete e confirmação D-1 ligados e valendo para a agenda própria.** Hoje quem confirma é a Avec IA. Os dois precisam ser trocados no mesmo dia.
11. **Pacotes:** vender e dar baixa em sessão pelo CRM, e levar os saldos na virada.

### Importante

- **G27:** a gestão só marcar como lida se for a responsável. Fica urgente assim que a gestão começar a usar o CRM.
- Mensagem agendada.
- Respostas prontas com anexo e variáveis.
- Tela de etiquetas com cor e filtro da Fila por etiqueta.
- Status manual "Aguardando" e "Resolvido".
- Ligações perdidas e reações aparecerem na conversa.
- Exportar contatos.
- Perfil "Profissional" com tela Hoje no celular. A recepção consegue operar sem isso na primeira semana.
- Relatórios por profissional.
- Estoque, se a Casa usa o controle de estoque do Avec. Isso precisa ser confirmado com a Thaise.

### Depois

Menu de boas-vindas, equipes, pesquisa de satisfação, campanhas, agendamento online próprio, anamnese, recorrência, arrastar para remarcar e uso sem internet.

## Erro de dados que afeta os números da gestão

A importação de vendas multiplica valor por quantidade mesmo quando o valor já é o total da linha (`src/server/domain/avec/import-sales.ts:106`). Por isso há 157 itens acima de R$ 10 mil que somam R$ 71,8 milhões. Exemplo: "Cabelo Método Fiaes 2" com quantidade 380 gravou um total 380 vezes maior. Qualquer faturamento por item vindo do Avec está distorcido até isso ser corrigido e o histórico reimportado.

Arquivos em /private/tmp/claude-501/-Users-joaquimsalles/1d859e91-de4e-47e9-bde3-8a64964253fe/scratchpad/analise/paridade/:
- hoje.png
- agenda.png
- agenda-pro.png
- etapas.png
- listas.png
- profissionais.png
- automacoes.png
- contatos.png
- quadro.png
- atendimento-sem-dono-cel.png