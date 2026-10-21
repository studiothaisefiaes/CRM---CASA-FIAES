# Relatórios e Configurações: o que já existe, o que dá para calcular e o que falta

Analisei o código da branch rodada-2, o banco de produção (só consultas de leitura) e as telas, abertas num navegador sem janela, sem clicar em nada que mude dado.

## Resumo

1. **Os relatórios do CRM só usam conversas.** A pasta `src/server/reports/` não lê nenhuma tabela do Avec (vendas, pagamentos, agenda, pacotes). Faturamento, comissão, comparecimento e clientes novas x recorrentes, que são o que o dono de salão mais olha, não aparecem em lugar nenhum, embora o banco já tenha os dados (25.914 itens vendidos, 19.896 pagamentos, 25.280 horários).
2. **Erro grave nos valores importados do Avec.** O campo `sales_items.total_cents` está inflado. Em `src/server/domain/avec/import-sales.ts:106` o total é calculado como valor × quantidade, mas no Avec o "Valor" já é o total da linha, e nos itens de mega hair a "Qtd." é em gramas. Exemplo real: um item "Cabelo Método Fiaes 2" com valor R$ 38.000 e quantidade 380 virou R$ 14,4 milhões.
   - 2025 soma R$ 51,6 milhões pelo campo errado e R$ 3,06 milhões pelo valor menos desconto.
   - Os pagamentos de 2025 somam R$ 2,88 milhões, o que confirma que o certo é **valor menos desconto**.
   - São 393 linhas acima de R$ 5.000. Nenhum relatório novo pode usar `total_cents` antes de corrigir isso.
3. **O CRM ainda não tem dado próprio de venda nem de quem respondeu.**
   - Nenhuma conversa tem valor de venda registrado: 0 de 225.
   - Das 4.467 mensagens enviadas, nenhuma tem a atendente registrada; todas saíram do celular ou do ChatGuru.
   - Por isso "tempo de resposta por atendente" hoje é impossível de calcular, até a equipe responder pelo CRM.
4. **Os textos dos avisos de vazio enganam.**
   - Na tela Relatórios, aba Análise, o bloco "Retorno por coorte" diz "Depende da exportação de atendimentos do Avec, que ainda não está disponível" (`src/components/reports/analysis.tsx:26`). Os dados já estão no banco.
   - Também na Análise, "Financeiro" diz "Nenhuma venda fechada no período (n = 0)", mas só o Avec vendeu cerca de R$ 3,1 milhões em 2026.
5. **Configurações são tudo ou nada.** Uma única permissão, "Configurações" (`config.editar`), libera desde respostas prontas até desconectar o WhatsApp e apagar automações. Não existe hoje o recorte "atendente configura o dia a dia".
6. **Não dá para criar etapa no funil.** A tela só renomeia, reordena e muda prazo e cor. Os tipos de etapa são fixos (`src/server/db/schema.ts:7`) e a sequência de follow-up está escrita no código (`src/server/rules/engine.ts:125`).
7. **Etiquetas não têm tela nem cor.** Existe 1 etiqueta ("Uso de imagem") em 38 contatos, e a lista de palavras-chave que viram etiqueta está vazia.

## 1. Relatórios

### O que existe hoje

| Onde | O que mostra | Quem vê |
|---|---|---|
| Relatórios › Visão geral (`/relatorios`) | Resumo de hoje; "Os números do período" (leads novos, primeira resposta no prazo, agendamentos marcados, vendas, valor médio por venda); "Primeira resposta"; "Do primeiro contato à venda"; "Parados agora"; "Pelo CRM ou pelo celular"; "De onde vêm as vendas"; "Por que perdemos"; "Qualidade dos dados" | `relatorios.ver`; números da equipe só com `relatorios.equipe` |
| Relatórios › Análise | "O follow-up funciona?"; "Quando as clientes escrevem" (mapa de calor); "Retorno por coorte" (bloqueado); "Cada pessoa contra a meta"; "Financeiro" e cobranças | Igual à linha acima; Financeiro exige também `valores.ver` |
| Planilhas CSV (`src/app/api/relatorios/[tipo]/route.ts:41-128`) | 13 tipos: numeros, resposta, funil, parados, canal, origem, objecoes, qualidade, followup, calor, pessoas, financeiro, cobrancas | `relatorios.exportar`; pessoas, financeiro e cobrancas exigem também equipe e/ou valores |
| PDF (`src/components/reports/pdf-menu.tsx:33-34`) | "Relatório do período" e "Por atendente"; mais "Fechamentos do mês (PDF)" arquivados | `relatorios.exportar` |
| Relatórios do Avec (`/relatorios/avec`) | Tabelas guardadas do Avec, com busca, Excel e PDF por relatório, e envio de novos arquivos | Só gestão (`canSeeAvecReports`, `src/lib/permissions.ts:84`) |

Os períodos são fixos: Hoje, 7 dias, Mês e Ano (`src/server/reports/common.ts:7`). Não há período livre nem escolha de mês anterior.

Números que aparecem hoje na Visão geral (mês atual):
- 35 leads novos.
- Primeira resposta no prazo: 4 de 17, com mediana de 25 min contra a meta de 2 min.
- Pelo celular: 17 de 17 respostas.
- Qualidade dos dados: "Leads em aberto sem responsável 155 de 185" e "Leads sem origem identificada 185 de 192".

### O que dá para calcular com os dados do banco

| Métrica do dono de salão | Fonte | Situação | Número real |
|---|---|---|---|
| Faturamento por período | `sales_items`: valor menos desconto (nunca `total_cents`) | Dá para calcular, falta tela | 2024: R$ 2,57 mi · 2025: R$ 3,06 mi · 2026 até 14/10: R$ 3,12 mi. Os pagamentos batem (R$ 2,43 mi / R$ 2,88 mi / R$ 3,01 mi) |
| Por profissional | `sales_items.professional_id` | Dá, mas 914 itens de 2026 estão sem profissional | Em 2026 a primeira profissional somou R$ 749 mil em serviços e a oitava, R$ 109 mil |
| Por serviço ou categoria | `sales_items.item` e `category` | Dá | 2026: categoria METODO FIAES R$ 1,21 mi e CABELO R$ 1,20 mi |
| Ticket médio | Valor dividido pelas comandas (data + número; o número da comanda reinicia, então tem que ser o par) | Dá | 2025: R$ 1.630 por comanda · 2026: R$ 954 |
| Comissão | Não está em `sales_items`. O relatório guardado "Itens de comanda" tem as colunas "Comissão (%)", "Comissão", "Custo" e "Líquido"; há também "Comissão por item" (25.911 linhas) | Precisa importar essas colunas | — |
| Clientes novas x recorrentes | Primeira compra de cada cliente em `sales_items` | Dá | Setembro/2026: 93 novas e 220 recorrentes; maio: 142 novas |
| Comparecimento e faltas | `appointments.status` | Dá | Setembro/2026: 464 compareceram, 25 faltaram, 147 cancelaram |
| Agenda sem desfecho | Horários já passados ainda como agendado ou confirmado | Pendência para avisar | 3.017 no histórico; em setembro, 78 |
| Ocupação da agenda | Precisa da duração de cada serviço e do horário de trabalho de cada profissional | Bloqueado | Serviços com duração: 0 de 55; tabela de horário das profissionais não existe; 3.934 bloqueios já importados |
| Conversa → agendamento | `deals` ligado a `appointments` pelo contato. `appointments.deal_id` está vazio em todos | Dá pelo contato | Das 225 conversas desde 23/04: 80 tiveram horário depois, 37 compareceram, 47 compraram |
| Tempo de resposta por atendente | `messages.sent_by_user_id` | Impossível hoje | 0 de 4.467 enviadas têm autora |
| Origem dos leads | `deals.source_id`, `lead_sources`, `contacts.imported_fields.avec.comoConheceu` | Fraca | 0 origens cadastradas; 210 de 225 conversas como "WhatsApp" sem origem; 891 clientes com "Como conheceu" do Avec, misturando Instagram (300), Indicação (216) e nomes de profissional |
| Pacotes | `client_packages`, `package_uses` | Dá | 31 pacotes, 23 de 118 sessões usadas, 369 usos |

Outro erro de dados: as datas de 2 horários ficaram em 2923 e 4676 (o relatório "Reservas (quem cadastrou)" vai "até 4676-11-10"). Há também um horário em 2029.

### Relatórios que faltam (proposta)

Um painel "Salão" ao lado da Visão geral, com:
- faturamento por dia, mês ou período livre, com comparação;
- por profissional (faturado, comissão, ticket);
- por serviço e categoria;
- formas de pagamento;
- clientes novas x recorrentes;
- comparecimento, faltas e cancelamentos por profissional;
- "clientes sumidas" e "retorno sugerido" calculados no CRM, e não só como tabela guardada do Avec;
- funil conversa → horário → compareceu → comprou.

Antes de qualquer coisa, corrigir `import-sales.ts:106`, recalcular `total_cents` e importar a comissão.

### Relatórios do Avec: situação e organização proposta

Hoje são 219 relatórios em 205 tipos, em ordem alfabética (`src/components/relatorios-avec/format.ts:36-45`). A lista mestra fala em 224 e 46 vazios, mas está desatualizada: são **36 vazios, e 34 tipos estão totalmente vazios**. Há tipos que se repetem com o mesmo número de linhas, por exemplo "Lucratividade por produto" e "Lucro por produto" (504 cada), e "Vendas de produto por profissional" e "Produtos vendidos por profissional" (3.812 cada).

Proposta de organização:
1. **Principais no topo, como cartões:**
   - Faturamento por dia
   - Comissão por profissional
   - Faturamento por serviço
   - Recebimentos por forma de pagamento
   - Reservas
   - Cancelamentos
   - Lista de espera
   - Clientes sumidas
   - Retorno sugerido
   - Aniversariantes
   - Pacotes das clientes
2. **Seções por assunto, cada uma recolhível:**
   - Agenda: Reservas, Reservas com valor, Cancelamentos, Lista de espera, Bloqueios, Reserva x comanda.
   - Vendas e comandas: Itens de comanda e variações, Situação das comandas, Itens excluídos, Observações.
   - Profissionais e comissões: Comissão por item, Comissões pagas, Recibos, Serviços por profissional.
   - Financeiro e caixa: Recebimentos, Taxas de cartão, Despesas, Contas a pagar, Caixas, Lançamentos.
   - Clientes: cadastros, Como conheceu, bairro e cidade, consumo.
   - Produtos e estoque.
   - Notas fiscais.
   - Pacotes e fidelidade.
3. **Um selo "Virou dado no CRM"** nos 21 relatórios que alimentaram agenda, contatos e vendas (campo `applied`), separados dos que ficam só como arquivo.
4. **Um grupo "Vazios (34)"** recolhido no fim, e os tipos repetidos juntados ou marcados como "mesmo conteúdo que…".

## 2. Configurações

A entrada da área exige `config.editar` ou `equipe.gerir` (`src/app/(app)/config/layout.tsx:6`). O cabeçalho diz "Tudo aqui pode ser ajustado pela gestão, sem programador." A ordem das abas está em `src/components/config/config-nav.tsx:9`.

| Aba | Permissão | O que configura | Situação real no banco |
|---|---|---|---|
| Equipe › Pessoas | `equipe.gerir` | Criar acesso, trocar perfil, trocar senha, desativar | 4 pessoas: 3 Gestão e 1 Atendente |
| Equipe › Perfis de acesso | `equipe.gerir` | 15 permissões em 5 grupos; criar, duplicar e apagar perfil | Gestão, Atendente, Recepção (Recepção com 0 pessoas) |
| WhatsApp | `config.editar` | Conectar por QR, desconectar e remover número, limite de envios por hora (1 a 200), prazo de guarda das mídias | 1 número conectado; mídias em "Não apagar" |
| Horário, etapas e prazos | `config.editar` | Horário de atendimento; por etapa: nome, ordem, prazo de resposta (min), limite parado (dias), cor | **O horário nunca foi salvo** (a tabela `settings` só tem `worker_heartbeat`; a tela Mensagens avisa "Ninguém salvou o horário ainda"). 9 etapas; **não dá para criar nem apagar etapa** |
| Listas e respostas | `config.editar` | Abas Respostas prontas (texto com {nome}), Objeções, Motivos de perda, Origens, Serviços (preço, duração, categoria, "lembrar retorno em" dias), Palavras-chave | 4 respostas prontas, 6 objeções, 6 motivos de perda, 6 origens. **Serviços: 55, sendo 52 com preço, 0 com duração e 0 com ciclo de retorno.** Palavras-chave: 0 |
| Profissionais | `config.editar` | Apelido, nome completo, cargo, serviços que faz, ativar e desativar | **101 cadastros (18 ativos, 83 desativados) e 0 ligações profissional-serviço.** A página tem 88.162 px de altura porque mostra os 55 botões de serviço em cada um dos 101 cadastros |
| Mensagens automáticas | `config.editar` | Só a resposta fora do horário | Desligada, sem texto |
| Distribuição | `config.editar` | Ligar e desligar, limite de conversas esperando, nível 1 a 3 por pessoa | Desligada (padrão `src/server/domain/distribution.ts:9`); só 1 pessoa recebe |
| Origens | `config.editar` | Link e QR do WhatsApp com frase pronta por origem | **0 origens** ("Nenhuma origem ainda"). Existe uma segunda lista "Origens" dentro de Listas e respostas, o que confunde |
| Automações | `config.editar` | 10 regras com versão, prévia e modelos | 8 ligadas. Nos últimos 7 dias: "Escalar para a gestão" 61×, "Conversa sem resposta no prazo" 51×, "Lead novo sem resposta" 32×. Lembrete da véspera e enquete D-1 desligados |

### O que falta, comparado ao ChatGuru

- **Etiquetas:** não há tela, cor, renomear, juntar nem filtrar a Fila por etiqueta. A tabela `tags` não tem campo de cor (`schema.ts:384`) e as etiquetas são criadas na conversa (`src/server/domain/tags.ts:13`).
- **Respostas prontas:** só texto com a variável {nome}. Faltam anexo, outras variáveis, pastas e respostas por atendente.
- **Campos da ficha:** não existem campos próprios. Os do ChatGuru ficam só para leitura em `contacts.imported_fields`.
- **Departamentos e menu de boas-vindas:** não existem.
- **Mensagens automáticas:** só a de fora do horário. Boas-vindas, ausência e encerramento faltam.
- **Restrições de acesso:** não há horário de acesso por usuário nem permissão por etiqueta ou por funil.
- **Assinatura com o nome de quem atende:** está anotada na lista mestra, não implementada.

### O que falta, comparado ao Avec

- **Serviços:** duração e comissão por serviço e por profissional. A coluna "Tempo" veio vazia do Avec, e a comissão por item existe nos relatórios guardados mas não foi aplicada.
- **Horário de trabalho de cada profissional:** sem tabela.
- **Bloqueios:** importados (3.934), mas sem tela para criar ou editar.
- **Pacotes:** sem catálogo de pacotes para vender.
- **Ainda faltam:** formas de pagamento e taxas, salas e recursos, regras de comissão.
- **Profissionais x serviços:** a ligação pode ser preenchida a partir do relatório "Serviços por profissional" (21.937 linhas), que mostra quem já fez cada serviço.

### Pedido "atendente configura o dia a dia"

Proposta: dividir `config.editar` em duas permissões.
- **`config.diaadia`:** Etiquetas (tela nova), Respostas prontas, Palavras-chave, Profissionais, Serviços, Origens e links, e quem recebe conversas (níveis da Distribuição).
- **`config.sistema`, só a gestão:** WhatsApp, Horário e etapas, Automações, Mensagens automáticas, limite de envio e guarda de mídias, ligar e desligar a Distribuição.

Pontos de mudança no código:
- `GESTAO_REQUIRED` já inclui automaticamente qualquer permissão nova (`src/lib/permissions.ts:66`).
- O perfil Atendente (`EQUIPE`, `permissions.ts:72`) precisa receber `config.diaadia`.
- A sessão `run()` de `src/app/(app)/config/actions.ts:19` passa a receber a permissão certa em cada ação.
- O filtro de abas de `config-nav.tsx:13` passa a olhar as duas permissões.

### Pedido "mais etapas no funil"

Hoje exige mudar o código. É preciso:
- uma ação de criar e apagar etapa (`src/server/domain/config.ts` só tem `updateStage`/`moveStage`, linhas 22 e 27);
- escolher o tipo da etapa entre os 6 fixos;
- trocar a sequência de follow-up fixa (`src/server/rules/engine.ts:125`) por uma configurável.

"Aguardando" hoje é só uma seção da Fila (`src/server/queries/queue.ts:286`), não uma etapa nem uma marcação manual.

## Prioridade sugerida

1. Corrigir `total_cents` (`import-sales.ts:106`, usar valor menos desconto), recalcular e importar a comissão.
2. Painel "Salão" com faturamento, profissional, serviço, ticket, novas x recorrentes e comparecimento; trocar os textos de "Retorno por coorte" e "Financeiro".
3. Separar `config.diaadia` de `config.sistema`; criar a tela Etiquetas com cor.
4. Profissionais: lista compacta só com as ativas e preenchimento dos serviços pelo histórico do Avec. Duração dos serviços (depende da Casa).
5. Criar etapa no funil.
6. Organizar os Relatórios do Avec em principais, seções e vazios recolhidos.
7. Salvar o horário de atendimento e pedir à Casa as origens.

Nada foi alterado no repositório, no servidor ou no banco, e nenhuma mensagem foi enviada.

As capturas de tela (.png) e o texto de cada página (.txt) estão em `/private/tmp/claude-501/-Users-joaquimsalles/1d859e91-de4e-47e9-bde3-8a64964253fe/scratchpad/analise/relatorios-config/`:
- relatorios
- relatorios-analise
- relatorios-avec
- config-equipe
- config-perfis
- config-whatsapp
- config-etapas
- config-listas
- config-listas-servicos
- config-listas-keyword
- config-profissionais
- config-mensagens
- config-distribuicao
- config-origens
- config-automacoes