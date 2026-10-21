# Avec: funcionalidades e fluxo de cada pessoa (pesquisa de 15/10/2026)

Este documento completa `docs/avec-pesquisa.md` e `docs/avec-engenharia-reversa.md` (ambos de 14/10). Aqui o foco é **o fluxo de cada pessoa**, módulo por módulo:

- **Recepção**: quem marca, recebe a cliente, abre a comanda e cobra.
- **Profissional**: a cabeleireira, no computador ou no app Avec PRO.
- **Cliente**: no link de agendamento, no app Avec e no WhatsApp.
- **Gestão**: a dona ou a gerente, que configura, fecha o caixa, paga a equipe e emite nota.

Regras seguidas: só fontes públicas. Não fiz login em conta da Casa, não criei conta, não preenchi formulário e não usei navegador visível. Para ler o Reclame Aqui usei um navegador **sem janela** (script no scratchpad). Também consultei, sem login, três rotas públicas que o próprio site de agendamento usa (configuração do salão, consulta pelo endereço do salão e pacotes online), sem dados pessoais.

## Como ler

Grau de certeza (no texto ou na coluna "Grau"):

- **confirmado**: está numa fonte oficial do Avec (central de ajuda, vídeo dos canais oficiais, manual em PDF publicado pelo Avec, página do produto, loja de apps) ou no código público do site de agendamento.
- **provável**: é dedução minha a partir de indícios e precisa ser confirmada.
- **não encontrado**: procurei e não achei em nenhuma fonte pública. Isso não prova que o recurso não exista.
- **[Casa]**: evidência sobre a própria Casa Fiaes. Vem dos 205 formatos de relatório exportados pela Casa ou da configuração pública do salão 62004.

Siglas de fonte, para as tabelas caberem na tela (cada sigla é um endereço completo):

| Sigla | Endereço |
|---|---|
| `HC/<nome>` | `https://negocios.avec.app/central-de-ajuda/post/<nome>` (central de ajuda oficial; os 95 artigos são os mesmos de 14/10) |
| `YT/<id>` | `https://youtu.be/<id>`: vídeos dos canais oficiais `@avecbrasil.oficial` e `@avec_sul`. A data de cada um está na seção 15 |
| `PDF-IA` | Guia "Avec IA – Guia completo (de A a Z)": https://cdn.prod.website-files.com/69bd446f2f50765be0a879ee/6a23368413badaff5482169f_Avec%20IA%20-%20De%20A%20a%20Z%20(vers%C3%A3o%20cliente)%20(1)-compactado.pdf (link do artigo `HC/domine-o-futuro-da-gestao-com-o-guia-do-avec-ia`; arquivo enviado por volta de 05/06/2026, data **provável**, tirada do código do arquivo) |
| `PDF-PAINEL` | "Documentação – Painel AvecIA" (mar/2026): https://res.cloudinary.com/avecbrasil/image/upload/v1773926227/AVEC/Manuais/Documenta%C3%A7%C3%A3o_-_Painel_AvecIA.pdf |
| `PDF-CLUBE` | "Clube de assinaturas – Guia completo", edição NOV25: https://cdn.prod.website-files.com/69bd446f2f50765be0a879ee/6a146d4d05430ea2c13ba5d7_Clube%20de%20assinaturas.pdf |
| `PDF-NF` | "Emissão de Nota Fiscal – Boas práticas" (mar/2026): https://cdn.prod.website-files.com/69bd446f2f50765be0a879ee/6a29c3e08be0408d4a157fde_Nota%20Fiscal%20-%20Boas%20Pr%C3%A1ticas%20Oficial%20-%20RFT%20v2.pdf |
| `SITE/<caminho>` | `https://negocios.avec.app/<caminho>` (páginas comerciais e blog oficial) |
| `JS-BOOK/<arquivo>` | `https://booking.avec.beauty/_next/static/chunks/<arquivo>`: código público do site de agendamento. O mesmo build está no ar em 15/10 |
| `API/<rota>` | `https://api.avec.beauty/<rota>`: rota pública do site de agendamento, sem login, consultada em 15/10 |
| `FMT:<id>` | Formato de relatório em `docs/avec-formatos.json`, com os cabeçalhos exportados pela Casa. "N linhas" é o tamanho do maior arquivo daquele formato |
| `iOS-PRO` | https://apps.apple.com/br/app/avec-pro-app-do-profissional/id1324231062 |
| `iOS-CLI` | https://apps.apple.com/br/app/avec-servi%C3%A7os-de-beleza/id1394288142 |
| `PLAY-PRO` | https://play.google.com/store/apps/details?id=br.com.salaovip.terminal |
| `RA` | https://www.reclameaqui.com.br/empresa/avec-by-hyperlocal/lista-reclamacoes/ (lido em 15/10) |

## O que é novo em relação a 14/10

1. **Quatro manuais oficiais em PDF**, ainda não usados em 14/10: Avec IA de A a Z, painel da Avec IA, Clube de assinaturas e Nota fiscal. **Mais 73 vídeos oficiais** transcritos, além dos 15 de 14/10; outros 12 sem legenda foram usados só pelo título e pela descrição.
2. **Avec IA, o que ela faz e não faz** (lista oficial): confirma, cancela e remarca **só pela mensagem de confirmação**; entende áudio; cadastra a cliente; passa a conversa para uma pessoa em 3 situações. **Ainda não** marca "sem preferência", não oferece promoção e não recebe pagamento. O guia pede para **desligar qualquer outra automação de WhatsApp**.
3. **Horário da confirmação da IA**: 24 h antes. O vídeo de fev/2026 diz 10h, 14h, 18h e 21h; o guia de jun/2026 diz 10h15, 14h15 e 18h15. O painel mostra os dados do dia anterior e conta uma campanha como sucesso quando a cliente agenda em até 72 h.
4. **Marketing da IA**: o convite de retorno sai 7, 3 ou 1 dia antes dos "dias de retorno" do serviço; o aniversário, no 1º dia do mês, 7 ou 3 dias antes ou no dia. O convite a inativas é "em breve" ou contraditório entre as fontes.
5. **Cashback existe**: a fidelidade pode dar o prêmio em dinheiro, que vira crédito na ficha. Em 14/10 constava "não encontrado".
6. **Agendamento online, lado da cliente**:
   - código de verificação por e-mail, SMS ou WhatsApp;
   - junção de cadastros com opção **"Familiar"** (útil para mãe e filha no mesmo número);
   - aviso de **taxa de falta**;
   - cupom;
   - menu com Pacotes, "Meus pontos" e Avaliações;
   - ao cancelar, o site oferece reagendar;
   - a cliente pode excluir a própria conta.
7. **Lembretes**: 100 SMS por mês, que não acumulam (4 textos); WhatsApp manual ilimitado (3 textos); e-mail por reserva; campanhas de e-mail e SMS vão ser desligadas. **Lembrete "X horas antes": não encontrado.**
8. **Avec PRO**:
   - versão 2.1.2 de 08/10/2026 (sem preferência, busca por telefone, comissão de vale-presente);
   - o que a profissional vê na comissão depende do "recibo", e **a Casa esconde faturamento e custos**, o que explica a queixa de 14/10;
   - a comanda aberta no app buscando a cliente não marca o horário como "Pago" sozinho.
9. **O que a Casa usa** (pelos relatórios e pela configuração pública):
   - agenda, comanda, caixa, comissão com descontos, nota fiscal (provavelmente salão-parceiro), estoque básico e pacotes;
   - **não usa**: vale-presente, fidelidade, anamnese ou prontuário, promoções, avaliações e Avec Pay;
   - **provavelmente** paga a comissão fora do Avec.
10. **Pacote público da Casa**: "Combo Manutenção Método Fiaes", R$ 8.000, 4 sessões + 4 finalizações, válido por 365 dias, vendido no sistema e no online.
11. **Comanda e caixa**:
    - um caixa por usuário, que pode ser aberto com data passada;
    - sangria só com saldo;
    - forma de pagamento **"Cortesia"** (comissiona sem gerar receita; serve para migrar créditos);
    - "finalizar com dívida" × "marcar como pendente";
    - editar uma comanda finalizada exige o caixa do dia aberto;
    - gorjeta registrada de 3 jeitos.
12. **Comissão**:
    - descontos sempre proporcionais à comissão, exceto o de produto;
    - descontos recorrentes em %;
    - salário lançado como bônus recorrente;
    - pagamento em lote;
    - recálculo de até 45 dias feito pelo suporte, com resposta em até 6 h e sem valer para quem usa split;
    - **não há módulo de metas**.
13. **Clube de assinaturas** (Asaas): CPF obrigatório, link válido por 24 h, 3 tentativas de cobrança, repasse em 30 dias e comissão pela "técnica do pote".
14. **Nota fiscal**: emissão em lote em Financeiro › Notas fiscais; RPS na NFS-e; multiempresa ligada à profissional; só certificado A1; NFC-e cancelável em até 30 min; venda de vale-presente sem nota.
15. **Sem lista de espera**, sem NPS e sem Reserve com o Google. Existe a chave `permite_agendamento_instagram`, desligada na Casa. Reclame Aqui (abr–set/2026): 93 reclamações e 77,1% resolvidas.

---

## 1. O que a Casa usa de verdade no Avec

Antes dos módulos, vale saber o que a Casa realmente usa, para priorizar. As fontes são os cabeçalhos dos 205 relatórios que a Casa exportou e a configuração pública do salão (`API/salao/62004`, lida em 15/10).

**Atenção:** não sabemos o período de cada exportação. Um relatório vazio pode significar só "nada aconteceu no período escolhido".

| Módulo | Situação na Casa | Evidência |
|---|---|---|
| Agenda | **Muito usada** | 309 reservas com origem, status, observação e quem cadastrou (`FMT:f18900ac`). 70 bloqueios, alguns repetidos por dia da semana (`FMT:61a7a9b6`). 78 cancelamentos com "responsável pelo cancelamento" (`FMT:e8aa4978`). 14 casos em que a profissional da comanda foi diferente da reserva (`FMT:7afa0ac7`). 7 status diferentes (`FMT:4b6cbc4f`). 2 "tipos de agendamento", provavelmente online e interno (`FMT:54b78936`) |
| Taxa de ocupação | Vazia | `FMT:831f0aa5` com 0 linhas. Bate com o achado de 14/10: as profissionais não têm horário próprio cadastrado |
| Tipo/preferência do agendamento | Usado (**provável**) | `FMT:e30391f0`, 17 linhas, colunas por profissional: Preferencial, Primeira Vez, Indicação, Sem Preferência, **Noiva**, Não Informado. Parece uma classificação de cada horário |
| Agendamento online | Ligado, sem cobrança | `agendamento=1`, `portal=1`, antecedência de 60 min, até 40 dias à frente, grade de 30 min. Também: `pagamento_online=0`, `cartao_obrigatorio=0`, `cobranca_reserva=0` e "sem preferência" desligado no online (`profissional_indiferente=0`). "Restringir cancelamento" está ligado, mas com 0 h (`cancelar_reserva_antecedencia=1`, `antecedencia_cancelamento=0`), então a cliente **provavelmente** pode desmarcar até a hora. Celular obrigatório no cadastro (`celular_cliente_obrigatorio=1`). Fonte: `API/salao/62004` |
| Avec IA (WhatsApp) | **Ligada** | `contato_avec_ia=1` (`API/salao/62004`) |
| Comanda | **Muito usada** | Itens com Assistente 1 e Assistente 2, % de comissão e líquido (`FMT:63d414a7`, 271 linhas). Desconto por item (`FMT:56cf76ed`, 193). 96 itens excluídos com responsável (`FMT:f0431917`). 3 comandas excluídas com motivo (`FMT:78717dcb`). 19 comandas com diferença entre itens e pagamento (`FMT:83666552`) |
| Caixa | Abre e fecha | 14 caixas com "diferença no fechamento" (`FMT:5575de10`). Sangria e suprimento sem registro no período (`FMT:ef9246e2` vazio) |
| Pagamento | Cartão com taxa | 9 formas de pagamento com faturamento (`FMT:55b9d10c`) e 7 bandeiras (`FMT:2b4a413e`). Taxa de cartão e de antecipação calculadas por comanda (`FMT:eea8b3fc`, 207 linhas) |
| Comissão | Calculada no Avec, com descontos | Resumo por profissional (18) com rateio de serviços, produtos e outros, caixinha, gasto com produtos, taxa de cartão, taxa administrativa, desconto de assistente, "A pagar" e "Valor Casa" (`FMT:47d57e7d`, `FMT:36ba276e`). Data da comissão × data do pagamento por item (`FMT:64e8cd2a`, 633 linhas) |
| Pagamento da comissão no Avec | **Provavelmente não** | Os relatórios de comissões pagas e de recibos estão vazios (`FMT:2b708240`, `FMT:0649aabe`). Há 8 lançamentos que parecem vales ou bônus (`FMT:5647abd8`, **provável**) |
| Recibo da profissional | **Esconde valores** | `ocultar_faturamento_comissao=1` e `ocultar_custos_comissao=1` (`API/salao/62004`). **Provável** causa da queixa "a comissão aparece sem o valor do serviço" que apareceu em 14/10. É escolha de configuração da Casa (ver 7.1) |
| Avec Pay / split | **Provavelmente não usa** | `avecpay_id=0` (`API/salao/62004`). As colunas "Split" existem nos relatórios, mas isso não prova uso |
| Nota fiscal | **Usa** | 138 notas com "Empresa" e "Tipo Nota" (`FMT:eeeeed1d`). 152 comandas com "Total Nota Profissionais × Total Nota Salão" (`FMT:895bad02`), o que sugere NFS-e no modelo salão-parceiro (multiempresa, **provável**). 135 produtos com NCM e CFOP (`FMT:f80459ea`), então **provavelmente** emite NFC-e de produto também |
| Financeiro | Receita sim, despesa quase não | 270 lançamentos nos formatos de exportação para ContaAzul e ZeroPaper (`FMT:f2f49151`, `FMT:ca5e2f62`): **provavelmente** a Casa exporta para o contador. Só 2 despesas (`FMT:ac9b889a`); contas a pagar vazio (`FMT:ac142f7c`) |
| Estoque | Básico | 338 produtos com estoque anterior, entradas, saída por venda, saída por consumo e estoque atual (`FMT:2903b510`). 130 com estoque mínimo e reposição sugerida (`FMT:b2da8a31`). 24 saídas manuais com motivo e profissional (`FMT:0d9e9347`). Venda de produto por profissional (`FMT:c87358ae`). **Não usa**: baixa automática por serviço (`FMT:65800d14` e `FMT:2e24b54c` vazios), pedido de compra (`FMT:f736c64b`) nem validade (`FMT:ebf204a9`) |
| Pacotes | **Usa** | 7 pacotes cadastrados (`FMT:e98b5a6c`, com coluna "Vender Online"), 33 linhas de pacotes de clientes (`FMT:e7894755`) e 12 usos (`FMT:40ca3312`). Pacote público: **"Combo Manutenção Método Fiaes"**: R$ 8.000; 4 "Sessão de pacote método" + 4 "Finalização Método Fiaes"; validade de 365 dias; comissão sobre o valor com desconto; à venda "no sistema e no online"; descrição cita "parcelamento em 10x sem juros" (`API/salao/62004/pacotes/online/online`) |
| Não usa (formatos vazios) | — | Vale-presente (`FMT:1877878b`, `FMT:8d25b52d`). Fidelidade (`FMT:6c0ab0d1`, `FMT:4e1de251`). Avaliações (`FMT:f566f4bf`, `FMT:eda93287`; `avaliacao_atendimento=0`). Anamnese e prontuário (`FMT:0b4f0953`, `FMT:522e78d2`). Promoções (`FMT:75ba7de9`; `API/salao/62004/promocoes` vazia). Etiquetas (`FMT:30e656b2`). Saldo de crédito/dívida (`FMT:c8f00d91`). Recálculo de comissão (`FMT:5855fb02`) |

---

## 2. Agenda

### 2.1 Funcionalidades

| Funcionalidade | O que faz e como é o fluxo | Quem usa | Fonte | Grau |
|---|---|---|---|---|
| Tela principal | Abre direto na agenda do dia, **uma coluna por profissional**, com calendário à esquerda. Mostra 3, 5, 8, 10 ou 12 profissionais por página. Filtra por categoria da equipe ou digitando nomes separados por vírgula ("Cátia, Marcos, Joana"). Dá para esconder os menus e ampliar a grade, e o "olho" mostra a legenda das etiquetas | Recepção | `YT/lUrC-8g8E2I` | confirmado |
| Cor e ordem | Cor e posição de cada profissional na agenda, definidas no cadastro dela | Gestão | `YT/hb32zJWlkto` | confirmado |
| Rodízio (fila da vez) | O número ao lado do nome é a posição no rodízio de quem chega sem hora. Marcar a profissional como "ocupada" tira ela da fila. **Não é** a ordem das colunas | Recepção | `YT/lUrC-8g8E2I` | confirmado |
| Buscar cliente na agenda | Digita o nome e vê todos os horários dela: futuros, pagos e cancelados. Um clique leva ao horário ou abre a comanda | Recepção | `YT/lUrC-8g8E2I` | confirmado |
| Marcar | 1) clica no horário livre da coluna da profissional; 2) abre a tela "Reserva"; 3) busca a cliente por **nome, e-mail, telefone ou CPF** (o vídeo recomenda o telefone por causa dos homônimos) ou cadastra ali mesmo; 4) escolhe o serviço (só aparecem os que essa profissional faz); 5) se quiser, muda a **duração** e o **valor** só nesta reserva; 6) pode marcar "enviar lembrete por **SMS**"; 7) etiquetas e observação; 8) Salvar. O horário entra como **Agendado** (verde) | Recepção | `HC/agendar-servico-na-avec`, `YT/QIUKesbyGYg`, `YT/u0Qc495lC-A` | confirmado |
| Cadastro rápido de cliente | Pela tela da Reserva. A central de ajuda diz que o mínimo é **nome, sobrenome e celular**; um vídeo de jun/2026 diz que dá para salvar só com o nome. Na Casa o celular é obrigatório | Recepção | `HC/como-cadastrar-um-novo-cliente-na-avec`, `YT/QIUKesbyGYg`, `API/salao/62004` | confirmado |
| Alertas ao marcar | Ao escolher a cliente, aparecem os "avisos" configurados (ex.: "alérgica a sulfato de magnésio", "completar cadastro", "aniversariante") | Recepção | `YT/NXXSp5Nls_8`, `YT/lUrC-8g8E2I` | confirmado |
| Vários serviços na visita | "Adicionar serviço" acrescenta outro horário, com a mesma ou outra profissional. Segurando **Ctrl** (ou Shift no Mac) e clicando em várias células, marca serviços **ao mesmo tempo** com profissionais diferentes (ex.: mão e pé às 14h). No dia, **uma comanda só** reúne todos os serviços da cliente | Recepção | `HC/como-adicionar-um-novo-horario-para-um-cliente-ja-agendado`, `YT/VOUHIQP-zFI`, `YT/u0Qc495lC-A`, `YT/QIUKesbyGYg` | confirmado |
| Sem preferência | Caixa "sem preferência" na Reserva. O horário fica **listrado** e pode ser arrastado para outra profissional que faz o serviço; o sistema pergunta "Tem certeza que deseja alterar esse evento?". No online depende de uma chave, que **está desligada na Casa**. A versão 2.1.2 do Avec PRO (08/10/2026) trouxe de volta o "agendamento sem preferência" | Recepção, cliente | `YT/Bo9C13qn-5E`, `API/salao/62004`, `iOS-PRO` | confirmado |
| Conflito e encaixe | Se o horário bate com outro, o Avec avisa e oferece **"forçar encaixe"**. Para pôr duas clientes no mesmo horário, clica na faixa lateral (vermelha) do horário ocupado, escolhe a cliente, marca "forçar encaixe" e salva | Recepção | `YT/lUrC-8g8E2I`, `YT/if19WriXa2o`, `YT/dJR1m5WJowI` | confirmado |
| Remarcar arrastando | Arrasta o bloco para outra hora ou para a coluna de outra profissional que faz o mesmo serviço | Recepção | `YT/lUrC-8g8E2I` | confirmado |
| Recorrência | Na Reserva, botão "Recorrência". O Avec pergunta "Deseja realmente criar agendamento recorrente?". Depois: data de início, intervalo em semanas (1 ou mais vezes por semana), fim após N agendamentos **ou** numa data, e dias da semana. Ao salvar, cria um horário avulso para cada data. **Cobrança:** cada sessão é cobrada na hora, ou a comanda é fechada "como dívida" e acertada no fim (ex.: plano mensal) | Recepção | `YT/KmIVWexZJvs`, `YT/KRSmSesUHEY`, `YT/lUrC-8g8E2I`, https://admin.avec.beauty/public/js/admin/mensagens.js ("A recorrência será criada para todos os serviços listados neste agendamento") | confirmado |
| Cancelar | Abre o horário, muda o status para **Cancelado** e salva. Se a cliente tem recorrência ou outros horários, escolhe "deletar todos" (este e os futuros) ou "apenas este". O horário sai da grade, mas continua no histórico e no relatório de cancelados, que registra **quem cancelou**. **Motivo de cancelamento em lista: não encontrado** (só a observação) | Recepção | `HC/como-cancelar-um-agendamento-na-avec`, `YT/awwFpDRpTI0`, `YT/oe8ZzrWmtSY`, `FMT:e8aa4978` | confirmado |
| Bloquear horário | Botão "Bloquear horário". Escolhe uma profissional ou **todas**; a data ou o período (dia, semana, 15, 30 ou 60 dias, 1 ano, indeterminado ou data escolhida); início e fim; título/motivo (folga, almoço, atestado, feriado) e observação. Em "opções avançadas", escolhe dias da semana e horários. O período fica indisponível na grade. A Casa tem 70 bloqueios | Recepção, gestão | `HC/como-bloquear-a-agenda-de-um-profissional`, `YT/havf_UZ8PxU`, `YT/u2ORQtmKl2g`, `YT/lUrC-8g8E2I`, `FMT:61a7a9b6` | confirmado |
| Horário de trabalho da profissional | Configurações › Profissionais › Horário de trabalho: dias, entrada e saída, horário diferente por dia e "período específico" com datas. A profissional só aparece na agenda nesses horários. **Dá para marcar fora da jornada**, e o vídeo pede que a recepção avise a profissional | Gestão | `HC/como-definir-os-horarios-e-dias-de-trabalho-do-profissional`, `YT/JjZ1dvWYnuk`, `YT/S53jbPpx6Tg`, `YT/lUrC-8g8E2I` | confirmado |
| Horário da Casa | Obrigatório. Tem o horário padrão, dias com horário diferente e **períodos especiais** com início e fim (Natal, Carnaval). Quando o período acaba, volta sozinho ao normal | Gestão | `HC/como-configurar-o-horario-de-funcionamento-do-estabelecimento`, `YT/hb32zJWlkto`, `YT/S53jbPpx6Tg` | confirmado |
| Intervalo da grade | Por profissional: "Qual intervalo de agendamento deve aparecer na agenda?" | Gestão | `HC/como-alterar-o-tempo-de-intervalo-da-agenda-do-profissional` | confirmado |
| Duração, folga e serviço simultâneo | Cada serviço tem duração e **"folga necessária"** (tempo para arrumar o posto). Também diz se pode ser feito junto com outro: **Livre** (pode no mesmo horário, ex.: mão e pé), **Parcial** (só junto com um Livre, ex.: tonalização enquanto o produto age) ou **Restrito** (nada junto, ex.: depilação). A regra vale na agenda e no online. A duração pode ser diferente por profissional | Gestão | `YT/S53jbPpx6Tg`, `YT/hb32zJWlkto`, `HC/como-configurar-servicos-e-comissoes-do-profissional` | confirmado |
| Salas e equipamentos | Recurso (sala ou equipamento) com quantidade, ligado ao serviço. Se acabou (ex.: 1 maca), bloqueia o segundo agendamento no mesmo horário. Existe "aviso em salas e equipamentos" (vídeo de jul/2026) | Gestão, recepção | `HC/como-cadastrar-salas-e-equipamentos-na-avec`, `YT/hb32zJWlkto`, `YT/1Q-SG-36YrM` (título e descrição) | confirmado |
| Etiquetas | Campo na Reserva: cria uma etiqueta digitando ou escolhe uma existente (ex.: "cliente nova", "Instagram", "indicação"). Ela aparece na grade | Recepção | `HC/como-criar-etiquetas-personalizadas-na-agenda`, `YT/QIUKesbyGYg` | confirmado |
| Status do horário | **Agendado** (verde) → **Confirmado** (pela IA ou à mão) → **Aguardando** (automático quando a recepção abre a comanda; manda aviso para a profissional) → **Em atendimento** e **Finalizado** (à mão, pela profissional ou pela recepção) → **Pago** (vermelho, automático ao finalizar a comanda). Há também **Cancelado** e **status personalizados**. A regra ensinada: "no final do dia a agenda tem que estar toda vermelha". **Detalhe:** quando a comanda é aberta no app da profissional buscando a cliente (e não a partir do horário), o horário **não** vira "Pago" sozinho e alguém precisa mudar o status à mão. Aberta pela recepção a partir do horário, a mudança é automática | Todos | `YT/lUrC-8g8E2I`, `YT/3lQcALNi3P4`, `YT/Q2JmFpAoGn0` | confirmado |
| Origem e autoria | O relatório de reservas guarda origem (**provavelmente** online ou interno), quem cadastrou, data em que foi marcado, status e observação | Gestão | `FMT:f18900ac`, `FMT:1903eedc` | confirmado [Casa] |
| Agendamentos da cliente | No cadastro, a aba "Agendamentos" mostra os futuros e os passados (com paginação de até 100) | Recepção | `HC/como-visualizar-todos-os-agendamentos-de-um-cliente-na-avec`, `YT/lUrC-8g8E2I` | confirmado |
| Lista de espera | **Não encontrado.** Só existe o rodízio para quem chega sem hora. O blog do Avec recomenda usar lista de espera, mas não diz que o sistema tem uma | — | `SITE/blog/agenda-para-clinica-de-estetica-como-organizar-horarios-salas-e-profissionais` | não encontrado |

### 2.2 Dia típico da recepção na agenda

1. **Entrar:** avec.app › Entrar › "Entrar na plataforma" › e-mail › "Buscar unidade" › senha (`HC/como-acessar-a-plataforma-avec-login-no-sistema`). A verificação em duas etapas com Google Authenticator é opcional (`YT/tOTDKypKzeM`, descrição).
2. **Abrir o caixa antes de tudo**, porque o vídeo oficial recomenda esse hábito (`YT/3lQcALNi3P4`), e só depois ir para a agenda.
3. **Pedidos do dia** (telefone ou WhatsApp sem IA): marca na grade (2.1) e, se quiser, marca "lembrete por SMS".
4. **Cliente chega:** busca pelo nome, clica no horário e em "Abrir comanda" › Confirmar. O status vira **Aguardando** e a profissional recebe aviso no app (`YT/3lQcALNi3P4`, `YT/lUrC-8g8E2I`).
5. **Durante o atendimento:** a profissional (ou a recepção) muda para "Em atendimento" e depois para "Finalizado" (`YT/lUrC-8g8E2I`).
6. **Pagamento:** a mesma comanda recebe os serviços extras e os produtos e é finalizada. O horário vira **Pago** (seção 5).
7. **Fim do dia:** confere se a agenda está "toda vermelha" e fecha o caixa (seção 6).

---

## 3. App da profissional (Avec PRO)

**Dados do app (confirmado):** "Avec PRO: App do Profissional" para iOS e Android, pacote Android `br.com.salaovip.terminal`. A versão 2.1.2 saiu em **08/10/2026** com estas novidades: "Comissões Vale Presente", "Agendamento sem preferência", "Apresentação nome profissional e apelido", "Buscar cliente por telefone durante o agendamento" e "Melhorias de performance no módulo de comandas" (`iOS-PRO`). Notas: **2,0** na App Store (370 avaliações) e **3,6** no Google Play (853 avaliações, mais de 100 mil downloads, atualizado em 01/10/2026) (`iOS-PRO`, `PLAY-PRO`). Uma avaliação de 08/10/2026 diz: "Agora o app ficou bom! pós essa atualização 08/10/26 [...] Antes já tinha a opção de ver sem preferência, agora que voltou ficou ainda melhor" (`iOS-PRO`).

**Acesso:** a gestão cadastra o e-mail e uma senha para a profissional, e ela pode trocar a senha no primeiro acesso (`YT/S53jbPpx6Tg`). O que ela vê depende do **grupo de acesso**. O grupo pronto "Profissional" vê **só a própria agenda e as próprias comissões** (`YT/Z-K81eV1Dzs`).

### 3.1 O que a profissional vê e faz no celular

| Função | Como funciona | Depende de permissão? | Fonte |
|---|---|---|---|
| Agenda do dia | Abre na própria agenda, com cores de status (vermelho = pago). Vê a agenda das colegas só se estiver liberado | Sim, para ver as colegas | `YT/o6KDJO7L9OM`, `YT/Q2JmFpAoGn0` |
| Marcar | Toca num horário livre, busca a cliente (por telefone desde a 2.1.2) e escolhe o serviço. O horário aparece **na hora** na agenda da recepção. Pode navegar para outras datas e marcar no futuro | Sim | `YT/Q2JmFpAoGn0`, `iOS-PRO` |
| Cadastrar cliente | Botão "+" em Clientes | Sim | `YT/o6KDJO7L9OM` |
| Comanda | Abre a comanda buscando a cliente. Lança o serviço (marcado ou não), assistente e produtos, e pode **mudar o preço** se tiver permissão. Finaliza com forma de pagamento (bandeira, parcelas, botão "T" que puxa o total), desde que haja caixa aberto. O vídeo diz que isso é função da recepção, mas serve para equipe pequena | Sim | `YT/Q2JmFpAoGn0`, `YT/o6KDJO7L9OM` |
| Mudar status | "Em atendimento" e "Finalizado" podem ser mudados pela profissional | Sim | `YT/lUrC-8g8E2I` |
| Mensagens manuais | Envia à cliente o **lembrete de agendamento**, a **mensagem de boas-vindas** e o **"obrigado"** (textos configurados pelo salão; é o envio manual para quem não tem Avec IA) | Sim | `YT/Q2JmFpAoGn0`, `YT/S53jbPpx6Tg` |
| Comissões | Filtra por período e por pagas, não pagas ou todas. Vê o total a receber, a "produção do dia" e o rateio. Tocando no dia, vê as clientes atendidas e, para cada uma: valor, forma de pagamento, taxa de cartão, antecipação, custo do serviço/produto, % e líquido. Serviços, produtos, caixinhas, descontos, bônus e vales aparecem separados | Sim | `YT/Q2JmFpAoGn0`, `YT/o6KDJO7L9OM`, `YT/Cl-oVzsB8vk` |
| O que aparece na comissão | Quem decide é a gestão, em "Recibo de comissão": mostra ou esconde faturamento, custos, taxa administrativa, taxa de cartão e taxa de serviço, e escolhe entre detalhado ou resumido. **A Casa esconde faturamento e custos** (`ocultar_faturamento_comissao=1`, `ocultar_custos_comissao=1`) | — | `YT/S53jbPpx6Tg`, `YT/5xr_wAVufLA`, `API/salao/62004` |
| Vale Rápido | Antecipa a comissão já produzida, pagando taxa. Precisa ser contratado pelo salão. A descrição do vídeo diz "sem precisar pedir nada ao salão". A página de comissões diz que "o gestor aprova e o sistema agenda o desconto automático no próximo fechamento" | Contratação | `YT/Q2JmFpAoGn0`, `YT/bahdBehVYoU` (descrição), `SITE/avec-pagamento-de-comissao` |
| Clientes que atendeu | Lista das últimas atendidas. A aba **Histórico** é só leitura (o que fez e quanto pagou); a aba **Dados** só aparece com permissão | Sim | `YT/Q2JmFpAoGn0` |
| Ficha de anamnese | Preenche no app as perguntas que o salão criou (seletor, múltipla escolha, texto). Fica salva no cadastro e a recepção e a gestão veem | Sim | `YT/Q2JmFpAoGn0`, `YT/r8j8rYaACqg` |
| Avisos (push) | Recebe aviso quando a recepção **abre a comanda** (cliente chegou, status "Aguardando") (`YT/lUrC-8g8E2I`). A página do produto diz "Novo horário notifica na hora; cliente desmarcou e o slot volta disponível" (`SITE/avec-pro`). As avaliações reclamam de avisos que não chegam (14/10) | — | idem |
| Split / Avec Conta | Se o salão usa Avec Pay com split, a parte dela cai direto na Avec Conta dela | Contratação | `SITE/avec-pro`, `HC/como-habilitar-o-split-para-o-profissional` |
| Bloquear o próprio horário pelo app | **Não encontrado** em fonte oficial (em 14/10 apareceu como queixa: "remarcar e bloquear pelo celular é difícil") | — | — |
| Metas | **Não existe módulo de metas.** O blog oficial diz: "A plataforma não define quais metas o negócio deve ter [...] pode apoiar a visualização de resultados" | — | `SITE/blog/metas-para-salao-de-beleza-como-criar-objetivos-que-a-equipe-entende` |

### 3.2 Um dia da profissional, passo a passo

1. Abre o Avec PRO com e-mail e senha. As queixas dizem que o app pede login várias vezes ao dia (14/10).
2. Vê a agenda do dia: horários, clientes e cores de status.
3. Recebe aviso quando a cliente chega (a recepção abriu a comanda e o status virou "Aguardando").
4. Se tiver permissão, muda para "Em atendimento" e depois para "Finalizado"; se o salão usa, preenche a anamnese no app.
5. Se a cliente quer outro horário, marca pelo app, quando a permissão existe.
6. Depois do pagamento na recepção, a comissão aparece em "não pagas". Se o recibo estiver configurado como detalhado, vê a conta inteira; **na Casa, faturamento e custos ficam escondidos**.
7. No fechamento do período, vê o que foi pago ("pagas") e, se o salão contratou, pede o Vale Rápido.

---

## 4. Lado da cliente

### 4.1 Por onde a cliente marca

| Canal | Como funciona | Fonte | Grau |
|---|---|---|---|
| Página do salão (link) | `booking.avec.beauty/saloes/<endereço>/agendar`. Mostra nome, descrição, endereço, horário, categorias, serviços com preço, equipe, fotos e avaliações. O link fica no menu "Links" do painel, para pôr na bio do Instagram | `YT/7azxmy3xnW8`, `YT/aisky3AFp0s`, `YT/S53jbPpx6Tg` | confirmado |
| App "Avec" (marketplace) | A cliente busca salões perto dela por categoria, favorita, agenda e acompanha os horários. No perfil: dados, salões favoritos, **pacotes contratados**, cartões, endereço, configurações e ajuda. A loja cita pagamento online, atendimento em casa e o **Avec+**, uma assinatura da cliente com "até 40% de desconto". Nota 2,2 na App Store (524) | `YT/q_sGuM_6Kco`, `iOS-CLI` | confirmado |
| Botão no site do salão | O painel gera um script; dá para escolher a cor e a posição (topo, esquerda, direita ou rodapé) | `YT/S53jbPpx6Tg`, `YT/hb32zJWlkto` | confirmado |
| WhatsApp com Avec IA | A cliente escreve e a IA agenda (seção 4.8) | `PDF-IA` | confirmado |
| WhatsApp ou telefone com a recepção | A recepção marca na grade | seção 2 | confirmado |
| Instagram | Só o link na bio. Na configuração do salão existe a chave `permite_agendamento_instagram`, que **está desligada na Casa**, o que sugere uma integração com o Instagram que não está documentada (**provável**) | `YT/7azxmy3xnW8`, `API/salao/62004` | confirmado / provável |
| Reserve com o Google | **Não encontrado** | — | não encontrado |

### 4.2 Fluxo do agendamento online, passo a passo

1. A cliente abre o link ou o app e escolhe "Agendar horário" (`JS-BOOK/3ghi0ixv133r4.js`, menu).
2. **Faz o pré-cadastro**, se ainda não tem conta. No vídeo de jan/2026 os campos são nome, **CPF**, e-mail, telefone e senha; sexo e nascimento são opcionais (`YT/7azxmy3xnW8`). A conta é confirmada com um **código** enviado por e-mail, SMS ou WhatsApp (`https://avec.app/_next/static/chunks/pages/_app-5189a9861a43b776.js`, cópia de 14/10). O salão escolhe se verifica a cliente pelo celular (SMS) ou pelo e-mail; o vídeo de configuração recomenda o e-mail (`YT/hb32zJWlkto`). Também dá para entrar com conta social (`/cliente/signin/social`, `JS-BOOK/154wfs3r-cx0i.js`).
3. **Cadastros duplicados:** se o salão já tem cadastros parecidos, o site pergunta para cada um se é **"Sou eu"**, **"Familiar"** ou **"Desconheço"** e junta as contas, guardando o parentesco (`JS-BOOK/09b89spe1h2m6.js`).
4. **Aviso de taxa de falta:** se o salão configurou uma taxa de ausência, aparece "Se você não puder comparecer no dia marcado, cancele seu agendamento com antecedência. Se você faltar, nos reservamos ao direito de cobrar uma taxa de R$ X por ausência", com a frase opcional "Essa taxa será convertida em créditos na unidade". A cliente precisa aceitar para seguir (`JS-BOOK/09b89spe1h2m6.js`).
5. Escolhe categoria, serviço e profissional, ou "sem preferência" se o salão liberar. O site pergunta "deseja agendar mais um serviço?". Depois mostra a agenda de até 4 profissionais e a cliente escolhe dia e horário (`YT/7azxmy3xnW8`, `YT/aisky3AFp0s`).
6. Pode aplicar um **cupom** de promoção (rota "Validar cupom", `JS-BOOK/272p0md22io33.js`) e escrever um **"pedido especial"**, que vira observação (`YT/7azxmy3xnW8`).
7. Se o salão exige cartão ou cobra na reserva, pede o **CVV** do cartão (o envio da reserva leva `cvv`) (`JS-BOOK/lazy_37-_o13bk1d_v.js`).
8. **Confirma.** O horário entra na agenda com a etiqueta "agendamento online" e um ícone de celular (`YT/aisky3AFp0s`). Se o salão ligou, recebe um e-mail a cada agendamento online (`HC/como-ativar-o-agendamento-online`).
9. O servidor recusa o agendamento por: horário fora do expediente, "você já tem uma reserva", antecedência mínima, cartão obrigatório, entre outros (`JS-BOOK/272p0md22io33.js`; lista completa em 14/10).

### 4.3 Depois de marcar: confirmar, cancelar, remarcar

| Ação da cliente | Como | Fonte | Grau |
|---|---|---|---|
| Ver os horários | "Meus agendamentos", no site (por salão ou por rede) e no app | `JS-BOOK/3ghi0ixv133r4.js`, `YT/q_sGuM_6Kco` | confirmado |
| Salvar no celular, mapa, compartilhar | Botões para salvar na agenda do celular (arquivo de calendário), abrir no Google Maps ou no Waze e compartilhar | `YT/7azxmy3xnW8`, `JS-BOOK/lazy_0x6cb3ntztpsc.js` | confirmado |
| Cancelar | Em "Meus agendamentos", toca em cancelar. **Logo em seguida o site pergunta se ela quer reagendar** e, se sim, segue o fluxo de marcação. Respeita a antecedência mínima de cancelamento definida pelo salão | `YT/7azxmy3xnW8`, `YT/S53jbPpx6Tg` | confirmado |
| Confirmar presença no site | Existe a rota "Confirmar reserva" (`PUT /salao/:salon/reservas/confirma`, "Reserva confirmada com sucesso"). **Provável** que seja a confirmação de presença pela cliente, mas não vi a tela | `JS-BOOK/272p0md22io33.js` | provável |
| Confirmar ou remarcar pelo WhatsApp | Respondendo à confirmação da Avec IA (4.8) | `PDF-IA` | confirmado |
| Excluir a própria conta | "Cliente excluiu o próprio cadastro" (`DELETE /cliente`) | `JS-BOOK/272p0md22io33.js` | confirmado |

**Regras configuráveis do online** (`HC/como-ativar-o-agendamento-online`, `YT/S53jbPpx6Tg`):

- antecedência mínima para marcar (ex.: 10 min, 1 h, 1 dia);
- restringir o cancelamento a um mínimo de horas antes (ex.: 2 h);
- limite máximo de dias à frente;
- se a cliente pode agendar pelo celular (app);
- e-mail ao salão a cada agendamento;
- quais profissionais e serviços aparecem;
- foto de capa e descrição.

**Na Casa:** 60 min, 40 dias, cancelamento com 0 h e "sem preferência" desligado (`API/salao/62004`).

### 4.4 Lembretes e confirmações que a cliente recebe

| Canal | Como funciona | Fonte | Grau |
|---|---|---|---|
| Avec IA (WhatsApp) | Confirmação **24 horas antes**. A cliente pode confirmar, cancelar ou reagendar na própria mensagem. Horários de envio na seção 4.8 | `PDF-IA`, `YT/a4gWA4YYoZo` | confirmado |
| WhatsApp "manual" | **3 textos** configuráveis, disparados pela equipe. O que estiver entre colchetes não se apaga, porque vira nome, data, hora e nome do salão. Uso **ilimitado** (`YT/S53jbPpx6Tg`). O vídeo do app cita as notificações manuais "lembrete de agendamento, mensagem de boas-vindas e mensagem obrigado" (`YT/Q2JmFpAoGn0`); que sejam esses os 3 textos é **provável** | `YT/S53jbPpx6Tg`, `YT/Q2JmFpAoGn0` | confirmado / provável |
| SMS | **4 textos** configuráveis. **100 SMS por mês, que não acumulam**; acima disso, só comprando pacote. Na Reserva há a caixa "enviar lembrete por SMS" | `YT/S53jbPpx6Tg`, `YT/QIUKesbyGYg` | confirmado |
| E-mail | "Envio de e-mail": a cliente recebe aviso de cada reserva, se a opção estiver ligada | `YT/S53jbPpx6Tg`, `YT/hb32zJWlkto` | confirmado |
| Horário do lembrete por SMS ou e-mail (ex.: D-1, 2 h antes) | **Não encontrado** | — | não encontrado |
| Campanhas de e-mail e SMS | Existem no menu Marketing, mas o vídeo diz que "será desabilitado da plataforma em breve" (jan/2026) | `YT/wQtWNsEn09s` | confirmado |

### 4.5 Pagamento antecipado, sinal e taxa de falta

- **Pagamento online no agendamento**: só com Avec Pay (`pagamento_online`) (`HC/como-identifico-se-minha-conta-possui-pagamento-online-ativo-na-plataforma`, `YT/hb32zJWlkto`). A configuração do salão também tem os campos `parcelamento_online`, `parcelamento_max_parcelas` e `parcelamento_valor_minimo`, que **provavelmente** controlam o parcelamento online (`API/salao/62004`). **Na Casa: desligado.**
- **Cartão obrigatório / cobrança na reserva**: chaves `cartao_obrigatorio` e `cobranca_reserva`, e a reserva envia o CVV (`JS-BOOK/lazy_37-_o13bk1d_v.js`, `API/salao/62004`). **Na Casa: desligado.** Exatamente quando a cobrança acontece: **não encontrado**.
- **Taxa de falta (no-show)**: a cliente aceita a taxa antes de marcar; o salão pode convertê-la em crédito (4.2, passo 4). Quando e como é cobrada: **não encontrado**.
- **Sinal por Pix no agendamento**: **não encontrado.** No balcão existe a **pré-venda** (pagar antes, usar depois) e o pagamento parcial (seção 8.2).

### 4.6 Pacotes, assinatura e fidelidade do ponto de vista da cliente

- **Pacotes no site**: aba "Pacotes", com compra pelo site ("Cliente comprou um pacote", `POST /cliente/pacote/comprar`) (`JS-BOOK/3ghi0ixv133r4.js`, `JS-BOOK/272p0md22io33.js`). O pacote aparece no online quando foi cadastrado como "online" ou "ambos". O "Combo Manutenção Método Fiaes" da Casa está como "ambos" (`API/salao/62004/pacotes/online/online`). Como a Casa não tem pagamento online, **provavelmente** a compra não se conclui pelo site.
- **Clube de assinaturas**: a cliente recebe um **link de pagamento** pelo WhatsApp, preenche o cartão e a assinatura começa. O link vale 24 h e só pode ser gerado para cliente com **CPF cadastrado**. A cobrança no cartão é mensal pelo Asaas (`PDF-CLUBE`, `SITE/clube-de-assinaturas-para-beleza`).
- **Fidelidade e cashback**: a cliente acumula pontos por serviço e vê o saldo em "Meus pontos" (`JS-BOOK/3ghi0ixv133r4.js`). O prêmio pode ser **dinheiro (cashback, vira crédito na ficha)** ou **um serviço (vira crédito de pacote)** (`YT/wQtWNsEn09s`, `YT/QEoNvLw5Jv4`, `YT/fuAlfuTR44s`, `YT/1ymqBH0MWSY`). **Isso corrige 14/10, que dizia "cashback não encontrado".**

### 4.7 Pesquisa de satisfação e avaliação

- A cliente tem uma aba **"Avaliações"** na conta (`JS-BOOK/3ghi0ixv133r4.js`). O relatório guarda **nota de 1 a 5 + comentário, ligados à comanda e às profissionais** (`FMT:f566f4bf`). Há também a média por profissional (`FMT:eda93287`), e as avaliações aparecem na página pública (`API/salao/{id}/avaliacoes`, 14/10). A chave do salão é `avaliacao_atendimento`, que **na Casa está desligada** (`API/salao/62004`).
- O salão também pode lançar à mão uma "avaliação" da profissional (nome da cliente, data, nota e observação), que aparece no online (`HC/como-adicionar-avaliacoes-de-atendimento-para-o-profissional`, `YT/S53jbPpx6Tg`).
- **NPS de 0 a 10 e pesquisa automática por WhatsApp depois do atendimento: não encontrados.**

### 4.8 Avec IA no WhatsApp

**Como conecta**

- No vídeo de **fev/2026**, a conexão era feita gerando um **QR code** no menu Avec IA › Configurações; um selo verde indica que está conectado e um vermelho, que caiu (`YT/a4gWA4YYoZo`). O guia A–Z também fala em risco de bloqueio "logo após a leitura do QR Code" (`PDF-IA`).
- O guia de **jun/2026** trata da **API oficial da Meta (WABA)** (`SITE/guia/avec-ia-whatsapp-oficial`, `HC/boas-praticas-para-criar-sua-conta-bm-do-meta`). O fluxo é:
  1. conectar a conta Meta/WABA (só a usuária master ou alguém com permissão total);
  2. criar um template;
  3. aguardar a aprovação da Meta.
- Os envios só começam depois do primeiro template aprovado. Os status de template são "em análise", "aprovado" e "recusado"; aprovados e recusados não podem ser editados.
- Há duas categorias: **Utilidades** e **Marketing**, e a Meta pode trocar a categoria.
- O botão **"Parar de receber"** é opcional; sem ele, aumenta o risco de denúncia.
- Trocar de WABA exige reenviar os templates. Desconectar interrompe os envios, mas mantém os templates.

**O que a IA faz.** Lista do próprio Avec (`PDF-IA`, página "O que a Avec IA já faz"):

- confirma reservas;
- **cancela e reagenda pelo módulo de confirmação**;
- interpreta **áudio** e intenções;
- busca horários livres;
- **cadastra a cliente**;
- informa endereço, serviços e valores;
- apresenta a lista de serviços e de profissionais;
- envia convite de retorno e mensagem de aniversário;
- identifica clientes sumidas e as convida a voltar (mas a página 01 do mesmo guia marca o convite a inativas como "Em breve"; ver Marketing automático);
- confirma vários serviços numa mensagem só;
- faz o **transbordo para uma pessoa**;
- avisa quando cai a conexão;
- marca **várias clientes do mesmo número** (ex.: mãe e filha). Este é o único item marcado "em evolução".

**O que ela ainda não faz** (`PDF-IA`, página 17, todos marcados como "Futuro"):

- recomendar serviços adicionais;
- oferecer promoções;
- **agendar sem preferência de profissional**;
- remarcar mais de um serviço na mesma confirmação;
- **remarcar ou cancelar fora do fluxo de confirmação**;
- processar pagamentos.

O guia também diz que ela ainda não sabe a profissional preferida da cliente nem o dia que ela costuma vir.

**Quando passa para uma pessoa (transbordo)** (`PDF-IA`):

- a cliente pede;
- a IA "se perde no contexto";
- o salão interrompe a conversa;
- a pergunta foge do que ela sabe (ex.: "Que marca de tinta vocês usam?").

Se o salão desliga "permitir reagendar" ou "permitir cancelar", "fica uma conversa não lida e a sua recepção atua" (`YT/a4gWA4YYoZo`). **Onde a recepção continua a conversa** (no próprio WhatsApp ou numa tela do Avec): **não encontrado**.

**Configurações do módulo Agendamento** (`YT/a4gWA4YYoZo`):

- liga e desliga;
- "template de entrada", que é a primeira mensagem quando a cliente escreve: texto próprio ou criado pela IA;
- confirmação ativa;
- chaves **"permitir reagendar"** e **"permitir cancelar"**. Com o cancelamento ligado, "ele já deleta da agenda".

**Horários de envio**

| Fonte | Horários | O que vale para |
|---|---|---|
| Vídeo oficial de 02/02/2026 | **10h, 14h, 18h e 21h**, até com o salão fechado | Confirmação do dia seguinte, lembrete de retorno e aniversário (`YT/a4gWA4YYoZo`) |
| Guia A–Z (publicado por volta de jun/2026) | Janelas de **10h15, 14h15 e 18h15** | Confirmação de "serviços das próximas 24 horas ainda não confirmados" e também o marketing (`PDF-IA`) |

O próprio artigo avisa que "a Avec IA tem atualizações a todo momento" (`HC/domine-o-futuro-da-gestao-com-o-guia-do-avec-ia`). **O horário atual não foi confirmado.**

**Fluxo da confirmação** (`PDF-IA`):

1. A IA verifica na agenda os serviços das próximas 24 h que ainda não foram confirmados.
2. Envia a mensagem.
3. A cliente responde.
4. A IA marca o horário como "Confirmado" na plataforma e agradece. Se a cliente cancelar, o horário é liberado; se pedir outro horário, a IA oferece opções.

Sem a IA, quem confirma é a recepção, à mão (`YT/lUrC-8g8E2I`).

**Marketing automático** (`YT/a4gWA4YYoZo`, `PDF-IA`, `SITE/marketing-com-ia-para-beleza`):

- **Lembrete de retorno**: usa os "dias de retorno" de cada serviço (ex.: corte em 90 dias, esmaltação em 21), contados a partir da última comanda. O salão escolhe enviar **7, 3 ou 1 dia antes** de completar o prazo. O texto pode ser do salão ou criado pela IA.
- **Aniversário**: para todas as clientes ou só as cadastradas a partir de uma data. Envio no **1º dia do mês**, **7 dias antes**, **3 dias antes** ou **no dia**, mesmo com o salão fechado. Em fev/2026 ainda não dava para ligar uma promoção à mensagem.
- **Convite para clientes inativas**: "em breve" no vídeo de fev/2026 e na página 01 do guia, que também marca "Divulga promoções" como "Em breve". A página 02 do mesmo guia marca como feito "Identifica os clientes que não vêm há algum tempo e convida-os de volta", e a página comercial anuncia "ações para [...] clientes inativos" (`SITE/lp-avec-ia`). As fontes se contradizem: **não confirmado**.
- A página comercial promete sugerir "o dia da semana que a Maria costuma preferir"; o guia diz que ela **ainda não** sabe isso. As duas fontes não batem.

**Exemplos de mensagem**

Conversa de exemplo do guia (`PDF-IA`):

> "Seja bem-vinda, Priscila! Sou a Assistente virtual do Salão Beauty Bela e estou aqui para ajudar no seu agendamento" … "A Maria está disponível nesses horários no sábado de manhã: 10h / 10h30 / 11h30. Qual desses horários você prefere?" … "Agendamento feito com sucesso! Seu corte de cabelo com a Maria está confirmado para o dia 06/01 às 10h30."

Modelos citados no blog oficial (`SITE/blog/boas-praticas-para-templates-do-meta`):

- **Confirmação (Utilidade):** "Olá, {{nome_cliente}}! Seu atendimento de {{servico}} está confirmado para {{data_agendamento}}, às {{horario_agendamento}}. Se precisar reagendar, responda a esta mensagem."
- **Retorno (Marketing):** "Oi, {{nome_cliente}}! Faz um tempinho desde seu último {{servico}}. Abrimos novos horários nesta semana [...] Toque no botão para agendar."

"Na AvecIA os botões são inseridos automaticamente nas mensagens."

**Requisitos que o Avec impõe** (`PDF-IA`):

- dados do salão completos;
- serviços com "Agendamento online" ligado, a subcategoria de marketing preenchida e descrição de até **500 caracteres**;
- ao menos uma profissional no online por serviço;
- profissionais com horário de trabalho;
- antecedência para marcar e para cancelar preenchida;
- estas customizações ligadas: "Agenda com tempo fixo", **"Não permite cadastrar cliente com mesmo nome"**, "Código de cliente", "agendamento online" e "restringir cancelamento com antecedência".

O mesmo guia exige: **"As mensagens automáticas do WhatsApp devem ser desativadas. A Avec IA não deve ser configurada em conjunto com qualquer outra automação."**

**Painel de resultados** (`PDF-PAINEL`, mar/2026):

- Os dados são do dia anterior.
- Abas:
  - **Visão geral**: agendamentos feitos pela IA, confirmações respondidas e agendamentos que vieram de campanhas.
  - **Agendamentos**: quantidade, faturamento, ticket médio, por hora (inclusive de madrugada), por dia da semana, semanal e diário.
  - **Confirmados**: evolução diária, por dia da semana e por horário.
  - **Marketing**: mensagens enviadas por tipo, receita e clientes que voltaram.
- Uma campanha "conta" quando a cliente agenda em até **72 horas** depois de receber a mensagem.

**Segurança e privacidade** (`PDF-IA`):

- "Nenhuma mensagem trocada com os clientes é armazenada."
- No cadastro da cliente dá para tirá-la dos envios.
- As mensagens saem aos poucos ao longo do dia para reduzir o risco de bloqueio, e o guia recomenda evitar palavras como "pix", "boleto" e "dívida".

---

## 5. Comanda

A comanda é a conta da cliente no dia. Recebe tudo o que ela consome e é onde se registra o pagamento.

| Funcionalidade | Como funciona | Quem | Fonte |
|---|---|---|---|
| Abrir pela agenda | Clica no horário, depois em "Abrir comanda" e em Confirmar. A comanda já vem com cliente, profissional, serviço, valor e duração, e o status vira "Aguardando". O vídeo recomenda **abrir a comanda assim que a cliente chega** e deixá-la aberta até o fim | Recepção | `HC/como-abrir-uma-nova-comanda`, `YT/3lQcALNi3P4` |
| Abrir pelo Financeiro (avulsa) | Financeiro › Comandas abertas › Abrir comanda: escolhe a cliente (ou cadastra) e a data. Usada para venda de produto, pacote, pré-venda, caixinha ou vale-presente **sem horário marcado** | Recepção | `HC/como-abrir-uma-nova-comanda`, `YT/KY_Vu-rPqMQ`, `YT/4ps6wQWHLXo`, `YT/gDdmmwQd98k` |
| Botões de item | **Serviço**, **Produto**, **Pré-venda**, **Pacote**, **Caixinha** (gorjeta) e **Vale-presente**. "Tudo que eu vendo para a cliente [...] tenho que informar por um destes botões" | Recepção | `YT/3lQcALNi3P4`, `YT/B1hn3rBS8TQ` |
| Serviço extra | Botão Serviço › serviço › profissional › salvar | Recepção | `YT/Z6KossLsSXs` |
| Assistentes | No item de serviço, escolhe até **2 assistentes**; a comissão de cada uma sai da principal | Recepção | `HC/como-incluir-um-assistente-na-comanda-na-avec`, `YT/3awWvbRKhsY`, `FMT:63d414a7` |
| Editar item | Com a comanda aberta, muda valor, quantidade e profissional (ícone de lápis) | Recepção | `HC/como-editar-itens-e-ou-valores-de-uma-comanda-aberta-na-avec`, `HC/como-editar-itens-de-uma-comanda-aberta-na-avec` |
| Produto vendido × produto usado | **Venda**: botão Produto, que só lista produtos "de venda"; profissional opcional (para comissão) e pergunta se dá baixa no estoque. **Usado no serviço** (insumo): edita o item do serviço e lança o produto e a quantidade (ex.: 30 g de tinta). Normalmente esse custo é descontado da profissional | Recepção | `YT/cb8-mGr6Z0E`, `YT/KY_Vu-rPqMQ`, `YT/4GAUUQFbMcU` |
| Importar agendamento | Se a cliente marcou algo depois de a comanda estar aberta: "Importar agendamento" › escolhe o horário | Recepção | `HC/como-importar-um-agendamento-para-uma-comanda-na-avec` |
| Usar pacote | Se a cliente tem pacote com aquele serviço, aparece sozinha a opção **"utilizar crédito de pacote"**, com valor zero. É **obrigatório escolher a profissional**, porque é aí que a comissão é gerada | Recepção | `HC/como-lancar-pacote-de-servicos-na-comanda-avec`, `YT/SmuzJreKNHI` |
| Promoção | Ao lançar um serviço em promoção, "o sistema vai me dar a sugestão de aplicar ou não"; também existe "adicionar promoção" no item | Recepção | `YT/kUyFvjcInLI`, `YT/riilTT4jR-c` |
| Prontuário | Dentro da comanda, botão "Prontuário", preenchido antes de finalizar | Recepção | `HC/como-configurar-o-prontuario-e-adiciona-lo-ao-cadastro-do-cliente`, `YT/r8j8rYaACqg` |
| Pagamento | Aba Pagamento: (1) escolhe o **caixa** aberto, (2) a forma de pagamento, (3) a **bandeira** e as parcelas no cartão (a bandeira pode ser obrigatória), (4) o valor ou o botão "T" (total), (5) "Finalizar comanda". **Várias formas** na mesma comanda (ex.: R$ 100 em dinheiro + o resto no cartão) | Recepção | `HC/como-finalizar-uma-comanda-na-avec`, `YT/3lQcALNi3P4`, `YT/MOIE_J_1cGE` |
| Formas de pagamento | Dinheiro; cartão de crédito e débito; Pix; cheque (há relatório de cheques); boleto (com regra própria de comissão); **"Autorização POS"** (busca a venda na maquininha Avec Pay); **Vale-presente** (código); crédito da cliente; **Cortesia**, que "comissiona a profissional, mas não gera receita no caixa" | Recepção | `YT/OdqFbWvL3bY`, `YT/GC9lujF3V0I`, `YT/W4a7aHpwahc`, `HC/como-configurar-a-data-de-recebimento-de-comissao-dos-profissionais`, `FMT:d3aa5ffc` |
| Troco e dívida | "Salvar troco como **crédito**": o valor pago a mais vai para a ficha da cliente. "Salvar troco como **dívida**": pagou menos, e ao finalizar escolhe **"Finalizar com dívida"** (a comissão sai agora) ou **"Marcar como pendente"** (a comissão só sai quando ela pagar). Na próxima comanda o débito aparece | Recepção | `HC/como-salvar-um-troco-como-credito`, `HC/como-finalizar-uma-comanda-com-divida-na-avec`, `YT/KY_Vu-rPqMQ`, `YT/lUrC-8g8E2I` |
| Comandas pendentes | Têm itens lançados, mas não foram pagas; não entram no faturamento até serem finalizadas | Recepção | `HC/o-que-sao-comandas-pendentes-e-como-finaliza-las` |
| Depois de finalizada | Em "Comandas finalizadas" dá para **editar, excluir ou imprimir**, desde que **o caixa daquele dia esteja aberto** (se não estiver, reabre o caixa). Excluir pede **motivo**, depende de permissão, não pode ser desfeito e mexe em estoque, comissão e caixa. Os relatórios guardam itens e comandas excluídos | Recepção, gestão | `YT/KY_Vu-rPqMQ`, `HC/como-excluir-uma-comanda-finalizada-na-avec`, `FMT:f0431917` |
| Comanda sem caixa | Se a comanda foi finalizada sem caixa, abre-se o caixa daquela data (retroativo), edita a comanda e escolhe esse caixa | Recepção | `YT/DdPC6udFjZg` |
| Regras | Bloquear o fechamento da comanda sem caixa aberto; formato da numeração; obrigar a conciliação com a Avec Pay para fechar o caixa | Gestão | `HC/como-configurar-e-definir-as-regras-da-comanda-na-avec`, `HC/como-conciliar-e-vincular-o-recebimento-via-avecpay-a-comanda`, `YT/gqEUV9G0RfU` |

---

## 6. Caixa

| Passo | Como funciona | Quem | Fonte |
|---|---|---|---|
| Abrir | Financeiro › Caixas abertos › Abrir caixa. Informa o valor inicial em dinheiro ou cheque (troco); a data e a hora podem ser **retroativas**. **Cada usuário só pode ter um caixa aberto por dia**: com duas recepcionistas, cada uma abre o seu | Recepção | `HC/como-realizo-a-abertura-e-o-fechamento-de-um-caixa-na-avec`, `YT/gqEUV9G0RfU` |
| Vínculo | A comanda finalizada com caixa aberto entra nesse caixa | Automático | `HC/como-vincular-comandas-ao-caixa-avec` |
| Sangria | Retira dinheiro com motivo. **Só funciona se houver saldo.** Opções: lançar a saída no financeiro e **descontar da profissional** (é assim que se lança um adiantamento em dinheiro) | Recepção | `HC/como-adiciono-uma-sangria-ao-caixa-na-avec`, `YT/gqEUV9G0RfU` |
| Suprimento | Põe dinheiro com motivo (ex.: troco). Opções: lançar a entrada no financeiro e **registrar como bônus para a profissional** (caixinha em dinheiro) | Recepção | `HC/como-adiciono-um-suprimento-ao-caixa-na-avec`, `YT/wBb8R1ULXq4` |
| Conferir | Em "Caixas abertos" aparece o total por forma de pagamento. Clicando numa forma, vê quais comandas entraram nela. A conferência é contra a gaveta e o extrato da maquininha. O débito em aberto é descontado do total | Recepção | `YT/MbwIFXes5Ig`, `YT/MOIE_J_1cGE` |
| Fechar | "Fechar caixa": **à esquerda os valores do sistema (não editáveis), no centro os valores contados**. A diferença é registrada no financeiro. Pergunta se quer imprimir o relatório | Recepção | `YT/MbwIFXes5Ig`, `YT/MOIE_J_1cGE`, `YT/gqEUV9G0RfU` |
| Histórico e reabrir | Histórico de caixas › filtra a data › relatório, com opção de **reabrir** para corrigir uma comanda e depois fechar de novo | Gestão | `HC/como-realizo-a-reabertura-de-um-caixa-na-avec`, `YT/gqEUV9G0RfU` |
| Com e sem Avec Pay | Sem Avec Pay, dá para **obrigar a bandeira** para fechar. Com Avec Pay, o cartão já vem conciliado | Gestão | `YT/MOIE_J_1cGE` |

---

## 7. Comissão, vale, gorjeta e pagamento da equipe

### 7.1 Regras de comissão

**Regras gerais** (Configurações › Comissões):

- **Data de recebimento**: para cartão, cheque e boleto, a comissão vale na data da comanda ou na data em que o salão recebe (ex.: maquininha que paga em 30 dias) (`HC/como-configurar-a-data-de-recebimento-de-comissao-dos-profissionais`, `YT/5xr_wAVufLA`, `YT/Cl-oVzsB8vk`).
- **Descontos**: taxa de antecipação, taxa de cartão (a mesma da maquininha ou outra), taxa de administração do salão (ex.: aluguel, água), taxa de administração da prestação de serviço, custo do serviço e produto. Todas as taxas, menos a de produto, entram **proporcionalmente à comissão**: com 50% de comissão e 2% de taxa, a profissional paga 1%. Só a **taxa de produto** pode ser cobrada inteira. Para ela, "descontar **antes** de calcular a comissão" divide o custo com o salão; "**depois**" faz a profissional pagar tudo (`HC/como-configurar-os-descontos-das-comissoes-dos-profissionais`, `YT/Cl-oVzsB8vk`, `YT/2pdJl89Yll8`, `YT/S53jbPpx6Tg`).
- **Recibo de comissão**: o que a profissional vê no app (mostrar ou esconder faturamento, custos e taxas; detalhado ou resumido) e um texto de rodapé (`HC/como-personalizar-o-recibo-de-comissao-dos-profissionais`, `YT/5xr_wAVufLA`). **A Casa esconde faturamento e custos.**
- **Comissão avançada**:
  - pré-venda: sobre o valor do serviço ou o valor com desconto;
  - % sobre venda de vale-presente;
  - % sobre pacote, que pode ser trocado em cada pacote;
  - **dois assistentes no mesmo serviço**: comissão sobre metade do valor ou sobre o total.

  Fontes: `HC/como-definir-a-comissao-de-pre-venda-dos-profissionais`, `HC/como-definir-a-comissao-de-vale-presente-dos-profissionais`, `YT/hb32zJWlkto`, `YT/3awWvbRKhsY`.

**Por profissional** (Configurações › Profissionais):

- **Serviço e comissão**: marca os serviços que ela faz, a % de cada um (com "aplicar à categoria"), a % como assistente e o tempo próprio (`HC/como-configurar-servicos-e-comissoes-do-profissional`, `YT/Z-K81eV1Dzs`, `YT/iIkqEp_nvYI`).
- **Regras de contrato e comissão**: tipo (CLT, freelancer, locatário), início e fim do contrato, repasse mensal, quinzenal, semanal ou diário, e **condições especiais** que substituem a regra geral (ex.: "não descontar a taxa de cartão da Amanda") (`YT/S53jbPpx6Tg`, `YT/hb32zJWlkto`).
- **Recebimento**: conta bancária ou Avec Conta. A Avec Conta é obrigatória para o split (`HC/como-cadastrar-os-dados-bancarios-do-profissional`, `HC/como-cadastrar-a-avec-conta-do-profissional`).

**Outros casos**

- **Produto**: a % de comissão fica no cadastro do produto e vale para quem vender (`YT/4GAUUQFbMcU`).
- **Pacote**: na venda, a profissional só entra se houver comissão de venda. No uso, a comissão é calculada sobre o valor do serviço com o desconto do pacote, ou sobre o valor cheio, conforme o cadastro. A forma de pagamento considerada é a da venda do pacote. O faturamento do salão conta o pacote inteiro no dia da venda (`YT/Jqc8prPJxZQ`, `YT/EhvLgCpMfBA`).
- **Promoção**: comissão sobre o valor cheio ou com desconto (`YT/kUyFvjcInLI`).

### 7.2 Gorjeta, vale, bônus e desconto

- **Gorjeta (caixinha), três jeitos**:
  1. na comanda (botão Caixinha), que fica **ligada à cliente**;
  2. por suprimento no caixa, marcado como "bônus para a profissional";
  3. em Financeiro › Comissões › Bônus, sem ligação com a cliente.

  Fonte: `YT/wBb8R1ULXq4`, `YT/3lQcALNi3P4`.
- **Adiantamento (vale)**: Financeiro › Comissões › profissional › **Desconto** › título e valor › "lançar adiantamento como registro de saída" (forma, categoria e conta). O saldo dela pode ficar negativo até produzir mais (`YT/kGqWhFdFDOw`, `YT/5xr_wAVufLA`, `YT/MOIE_J_1cGE`). Também dá para fazer pela sangria do caixa (seção 6).
- **Desconto recorrente** (ex.: "custo administrativo" de 7% em cada quinzena). A base pode ser o rateio do serviço, a comissão ou o faturamento (`YT/lmh9MhgH0Zk`).
- **Salário fixo** (recepção, gerente): lançado como bônus recorrente, com o FGTS e outros descontos como desconto (`YT/MOIE_J_1cGE`).

### 7.3 Pagar a equipe

1. Financeiro › Comissões › período (diário, semanal, quinzenal ou mensal) › uma ou todas as profissionais › Buscar (`HC/como-realizo-o-pagamento-dos-profissionais`, `YT/vRfRKUZvZbE`).
2. Confere a lista (comanda, valor cobrado, forma de pagamento, custos e comissão líquida), lança vales e bônus e tira os relatórios ("vários modelos de recibo") (`YT/5xr_wAVufLA`, `YT/2pdJl89Yll8`).
3. "Pagar comissão" ou **"Pagar profissionais selecionados"** (em lote): data, forma de pagamento e conta de saída (`YT/CIPrZsYigKE`, `YT/5xr_wAVufLA`).
4. Recibo para imprimir e assinar. O histórico fica em "Pagas" (`YT/vRfRKUZvZbE`, `HC/onde-localizo-as-comissoes-pagas-para-os-meus-profissionais`, `YT/krF_neT6So0`).
5. **Com Avec Pay**: paga por Pix direto da conta, com validação de identidade e código do Google Authenticator (`YT/MOIE_J_1cGE`). **Com split**: cada venda no cartão é dividida e a profissional recebe no dia seguinte, sem passar pelo salão (`HC/o-que-e-um-split-de-pagamentos`, `YT/krF_neT6So0`).
6. **Recálculo**: refaz comissões de até **45 dias** com as regras atuais. É um pedido ao suporte, com resposta "em até 6 horas" por e-mail, e **não vale para quem usa split** (`YT/YmtWWNPh1xY`, `YT/5xr_wAVufLA`, `SITE/avec-pagamento-de-comissao`).

**Metas**: não há módulo (seção 3.1).

---

## 8. Pacotes, pré-venda, clube de assinaturas, vale-presente e crédito

### 8.1 Pacote

| Etapa | Como funciona | Fonte |
|---|---|---|
| Cadastrar | Configurações › Serviços e pacotes › Pacotes: nome, validade (ex.: 60 dias), serviços × quantidade (ex.: 4 mãos + 2 pés), descrição e preço com desconto em R$ ou em % (o sistema calcula o outro). Também: comissão por serviço realizado (sobre o valor com desconto, sobre o valor cheio ou sem comissão), comissão pela venda e **onde aparece** (só no sistema, só no online ou nos dois) | `HC/como-cadastrar-pacotes-na-avec`, `YT/Jqc8prPJxZQ`, `YT/S53jbPpx6Tg` |
| Vender | Comanda › botão Pacote. Normalmente sem profissional, porque não há comissão de venda. A cliente pode já usar uma sessão na mesma comanda ou deixar para as próximas | `YT/XvZkxRCjsXI`, `YT/4ps6wQWHLXo` |
| Usar | Abre a comanda da visita; o serviço aparece com "utilizar crédito de pacote" e valor zero. Escolhe a profissional e finaliza | `YT/SmuzJreKNHI` |
| Acompanhar | Ficha da cliente › Pacotes: feitas, restantes, datas e validade. Quando o pacote vence, dá para **dar novo prazo** | `HC/como-acompanhar-o-pacote-de-servicos-no-cadastro-de-clientes`, `YT/lUrC-8g8E2I` |

### 8.2 Pré-venda

É um "pacote montado na hora". Comanda › **Pré-venda** › serviço, quantidade e desconto no item › pagamento. O crédito vai para a aba Pacotes da cliente. A validade é configurável em Financeiro (`HC/como-configurar-e-lancar-uma-pre-venda-na-comanda`, `YT/HKtWeE-65ok`). Também existe **pré-venda com pagamento parcial** e usar a pré-venda para **quitar dívida** (`YT/RnPMTw3JDSE`, `YT/vVXrhz7f8Uw`, títulos e descrições).

**Para a migração:** créditos já pagos fora do Avec são lançados como pré-venda com forma de pagamento **"Cortesia"**. Isso cria o crédito sem gerar receita, e a profissional é comissionada quando atender (`YT/W4a7aHpwahc`).

### 8.3 Clube de assinaturas

Primeira versão de nov/2025 (`PDF-CLUBE`, `HC/como-funciona-o-clube-de-assinaturas-da-avec`).

1. **Configurar**: a % do faturamento do clube que vai para o "pote" da equipe e os **pontos de cada serviço**. O guia recomenda dar mais pontos aos serviços mais demorados e dá o exemplo "Corte de cabelo dura 60 minutos, logo 60 pontos".
2. **Criar planos** (ex.: "Escova ilimitada").
3. **Vender**: Clube › Vender assinaturas › cliente (precisa estar cadastrada e ter **CPF**) › plano › **link de pagamento** (vale 24 h) › a cliente põe o cartão › plano ativado.
4. **Cobrança** recorrente no cartão pelo **Asaas**, com credenciamento obrigatório. O dinheiro chega ao salão **30 dias depois** do pagamento, e a antecipação é feita no Asaas.
5. **Status**: Aguardando pagamento, Recusado, Cancelado (não pago, depois de 3 tentativas), Pago e Cancelado (a pedido).
6. **Painel**: receita do mês, previsão, recusados e assinantes ativos.
7. **Comissão pela "técnica do pote"**: o valor do pote é dividido pelos pontos que cada profissional fez no período › "Gerar bônus e fechar pote" › pagamento em Financeiro › Comissão. No exemplo: R$ 120 mil arrecadados, 47% no pote e José com 57% dos pontos recebe R$ 32.148.
8. Contrato padrão em Configurações › Contrato.

### 8.4 Vale-presente

- **Configurar** a validade em dias, em Financeiro › "Comanda, Vale-presente e Pré-venda".
- **Vender**: comanda › Vale Presente › valor › gerar código › pagamento. O código pode ir num cartãozinho ou pelo WhatsApp.
- **Usar**: na comanda de quem ganhou, forma de pagamento "Vale-Presente" › código › o valor é abatido.
- **Comissão** de venda configurável.
- **Na venda não há nota fiscal**; a nota sai quando o vale é trocado por serviço ou produto.

Fontes: `HC/como-configurar-e-lancar-um-vale-presente-na-comanda-da-avec`, `YT/GC9lujF3V0I`, `PDF-NF`.

### 8.5 Crédito e débito da cliente

Lançados na ficha (aba Créditos), pela master ou por quem tem permissão. O vídeo recomenda lançar **pelo caixa**, para ficar registro financeiro. Também são criados pelo troco na comanda e pelo prêmio de fidelidade (`HC/como-lancar-credito-ou-debito-no-cadastro-do-cliente-na-avec`, `YT/r8j8rYaACqg`, `YT/fuAlfuTR44s`).

---

## 9. Estoque, fornecedores e compras

| Funcionalidade | Como funciona | Fonte |
|---|---|---|
| Cadastro do produto | Só o nome é obrigatório; o **custo** também é exigido. Outros campos: código de barras, local de estoque, marca, linha, categoria e descrição. **Característica**: venda, consumo (uso interno), insumo ou "produzido". Opções: **solicitação de saída** (a saída precisa de aprovação), **proibir estoque negativo** e **controle de validade**. Valor de venda, % de comissão de venda, código interno, fornecedor e prazo de entrega. **Unidade de saída**: unidade, dose, ml, g, cm, caixa ou pacote, travada depois do primeiro movimento. Estoque mínimo, primeira entrada e dados de nota fiscal (CST, CFOP, origem, NCM, CEST, campos da reforma tributária) | `HC/como-cadastrar-um-novo-produto-no-estoque-na-avec`, `YT/QYzwxyIT4_c`, `YT/1oFy0n0qM1o`, `YT/pfGu_DIZ8Ag`, `YT/255u0GEEa1o`, `YT/kO6IlSGcMOU` |
| Desconto da profissional | "Descontar produto do profissional" tem três valores: **uso próprio** (venda à profissional), **uso interno** (custo descontado dela quando usa no serviço) e **descontar uso do cliente** (cobra o produto na comanda). Depois é preciso ligar a "Taxa de produto" em Comissões › Descontos | `HC/como-lancar-o-desconto-da-unidade-do-produto-para-o-profissional`, `YT/QYzwxyIT4_c` |
| Baixa automática por serviço | No serviço › aba "Estoque automático": produto + quantidade. Sempre que o serviço é lançado na comanda, o produto sai do estoque. Exemplo: kit manicure R$ 6 + toalha R$ 1, descontados da profissional; com o desconto "antes da comissão", ela paga R$ 3,50 | `HC/como-configurar-a-baixa-automatica-de-produtos-no-estoque-na-avec`, `YT/2pdJl89Yll8` |
| Entrada | Produtos › Registrar entrada: produto, observação (sugere o número da nota), quantidade e **custo total da nota**. Opcionalmente lança a saída no financeiro | `HC/como-registrar-a-entrada-de-um-produto-no-estoque-na-avec`, `YT/pfGu_DIZ8Ag` |
| Saída manual | Para uso interno (ex.: 1 L de acetona). A venda sai sempre pela comanda | `YT/pfGu_DIZ8Ag` |
| Aprovar saída | Estoque › Solicitações de saída › Aprovar. Só então o produto sai do estoque | `HC/como-aprovo-uma-saida-de-produto-do-estoque-na-avec`, `YT/l04AGH2ibwQ` |
| Alerta de reposição | Produto abaixo do mínimo fica com exclamação vermelha; há relatório de reposição sugerida | `YT/pfGu_DIZ8Ag`, `YT/QYzwxyIT4_c`, `FMT:b2da8a31` |
| Histórico e custo médio | Botão "histórico" por produto; custo médio ponderado calculado | `YT/1oFy0n0qM1o`, `YT/QYzwxyIT4_c` |
| Inventário | Novo inventário › produtos › quantidade real › concluir, o que ajusta o estoque | `HC/como-utilizo-o-inventario-de-estoque-na-avec` |
| Fornecedor | Documento, razão social, nome fantasia e cidade | `HC/como-cadastrar-um-fornecedor-na-avec` |
| Pedido de compra | Novo › Manual › fornecedor › produtos e quantidades (o custo pode ser atualizado) › forma de pagamento e parcelas › Confirmar. Quando a mercadoria chega: **"Receber pedido"**, que dá a entrada | `HC/como-adiciono-um-novo-pedido-de-compra-na-avec`, `YT/UMWgZAOdGW8` |
| Entrada pelo XML da nota | Pedido de compra › Importar XML. O Avec casa os itens pelo código de barras, pergunta quando há dois produtos com o mesmo código e oferece cadastrar os que não encontrou | `HC/como-importo-o-arquivo-xml-no-meu-estoque-na-avec`, `YT/iKwCwrRHgjU` |
| Regras gerais | Validade, fabricação, código interno na comanda e **locais de estoque** (ex.: loja, color bar, vitrine) | `HC/como-configurar-o-estoque-e-definir-as-regras-de-utilizacao-na-avec`, `YT/hb32zJWlkto` |

---

## 10. Financeiro e nota fiscal

### 10.1 Financeiro

- **Configurar**:
  - categorias e subcategorias de receita e despesa;
  - contas bancárias, cujo saldo inicial entra no dia anterior;
  - taxas de cartão: no débito, taxa e prazo; no crédito, taxa, **taxa de antecipação**, prazo e parcelas. Com Avec Pay as taxas entram sozinhas.

  Fontes: `HC/como-cadastrar-categorias-de-receitas-e-despesas-na-avec`, `HC/como-cadastrar-contas-bancarias-na-avec`, `HC/como-cadastrar-taxas-de-cartao-de-credito-e-debito-na-avec`, `YT/X94p34dGwkA`, `YT/S53jbPpx6Tg`.
- **Entradas e saídas**:
  - "Nova entrada" funciona como contas a receber.
  - "Nova saída" funciona como contas a pagar: título, categoria, valor, vencimento, conta prevista, fornecedor, competência, centro de custo, **repetir** (diário, semanal ou mensal, N vezes), dados de nota e observação.
  - Depois: pagar ou antecipar, com juros, multa e desconto.
  - Transferência entre contas.
  - **As receitas das comandas entram sozinhas**; o cartão aparece com a data em que vai cair e a taxa já descontada.

  Fontes: `HC/como-registrar-uma-entrada-do-financeiro-na-avec`, `HC/como-registrar-uma-saida-do-financeiro-na-avec`, `HC/como-registrar-uma-transferencia-bancaria-na-avec`, `YT/X94p34dGwkA`, `YT/pHZ3Fye14Ps`, `YT/MOIE_J_1cGE`.
- **Telas**:
  - Extrato, Despesas e Receitas, com filtro por data de competência, vencimento ou quitação, conta, categoria, fornecedor, centro de custo, forma, status e valor bruto ou líquido.
  - **Conciliação bancária**: sobe o arquivo OFX do banco e vincula cada linha a um lançamento ou cria um novo.
  - **Fluxo de caixa**: até 12 meses na tela, por categoria.

  Fontes: `HC/onde-visualizar-as-entradas-e-saidas-do-financeiro-na-avec`, `HC/como-gerar-o-fluxo-de-caixa-na-avec`, `YT/xYjCYTaqUUU`, `YT/PfbOT9zAOkY`.
- **DRE**: **não encontrado** com esse nome. O fluxo de caixa por categoria e os relatórios de lucratividade por serviço e produto fazem papel parecido (**provável**).
- **Exportar para o contador**: relatórios no formato de importação do ContaAzul e do ZeroPaper (14/10). A Casa exporta esses formatos (seção 1).

### 10.2 Nota fiscal

1. **Contratar** o módulo à parte (Meu plano › Mudar de plano › Itens adicionais) e configurar com o contador: certificado **A1** (arquivo PFX; **não aceita A3**); regime de tributação; ISS, CNAE, código de tributação e usuário e senha da prefeitura para NFS-e; CSC e token da Sefaz para NFC-e; dados fiscais de cada produto, com o código de barras obrigatório ou "SEM GTIN". Para empresas do Regime Normal, os campos da reforma tributária (IBS e CBS) valem para produto desde jan/2026 e para serviço desde abr/2026 (`PDF-NF`, `YT/Wux8mVhrh_0`, `YT/kO6IlSGcMOU`).
2. **Multiempresa (salão-parceiro)**: cadastra o CNPJ ou MEI de cada parceira em Configurações › Nota fiscal › Multiempresa e liga essa empresa à profissional em "Regras de contrato e comissão". Aí a nota da parceira sai pela plataforma. "Mesmo que o módulo fiscal completo não seja utilizado, a função multiempresa ainda permite que a nota fiscal de serviço inclua a **cota-parte** de cada profissional" (`YT/Wux8mVhrh_0`, `YT/MAMfs0h5XK0`, `PDF-NF`).
3. **Emitir**: Financeiro › Notas fiscais › período, tipo (serviço ou produto), status "Não emitidas" e, se for o caso, a empresa da parceira › Buscar › seleciona as comandas › **"Emitir selecionadas"**. A recomendação é emitir em lotes: 5 por vez no vídeo, até 25 no manual; a NFC-e de produto, uma por vez. Na NFS-e, o Avec gera primeiro o **RPS**, que a prefeitura converte em nota (`PDF-NF`, `YT/Wux8mVhrh_0`, `YT/MAMfs0h5XK0`).
   - **Nota:** o site comercial fala em emissão "no exato momento do checkout" e em "PDF e XML [...] enviados automaticamente ao cliente" (`SITE/emissao-de-notas-fiscais-avec`). Os manuais mostram a emissão em lote na tela de notas.
4. **Status**: Não emitidas (inclui as que voltaram com erro), Em processamento, Pendente, Emitidas, Contingência e Canceladas. A NFC-e só pode ser cancelada em até **30 minutos**; a NFS-e segue o prazo do município. PDF e XML ficam disponíveis por nota (`PDF-NF`).
5. **O que não tem**: nota de devolução (`PDF-NF`).

---

## 11. Cadastro da cliente e marketing

### 11.1 Cadastro

- **Campos**: nome, sobrenome, celular, telefone fixo, aniversário, gênero, CPF, RG, código interno, e-mail, CEP e endereço, observação, **"Como conheceu"** (uma lista que cresce conforme se digita, ex.: Instagram) e profissão. Há também **permissões de contato**, que permitem tirar a cliente dos envios (`YT/r8j8rYaACqg`, `PDF-IA`).
- **Abas**: Dados, Agendamentos, Comandas (abre cada comanda), **Produtos** (o que foi usado nela: a "receita" da coloração, em gramas), Créditos, Pacotes, Fidelidade, Anamnese, Prontuário e Anexos (`YT/r8j8rYaACqg`, `YT/lUrC-8g8E2I`).
- **Busca** por nome, e-mail, telefone, celular, CPF ou código (`YT/r8j8rYaACqg`).
- **Anamnese**:
  - Clientes › Anamnese › adicionar campo. Tipos: texto, data, telefone, número, seletor, múltiplas opções, única opção, área de texto, título e **envio de arquivo**.
  - A mesma ficha vale para todas as clientes.
  - É preenchida no cadastro (recepção) ou no app (profissional), puxa sozinha os dados cadastrais, pode ser **impressa**, e o acesso é controlado pelo grupo de acesso.

  Fontes: `HC/o-que-e-anamnese-e-como-configura-la-no-cadastro-do-cliente`, `YT/sCtBQGyE1Ss`, `YT/r8j8rYaACqg`.
- **Prontuário**: campos dos mesmos tipos, em ordem escolhida, preenchidos **na comanda a cada atendimento** (recepção) e guardados no histórico (`HC/como-configurar-o-prontuario-e-adiciona-lo-ao-cadastro-do-cliente`, `YT/r8j8rYaACqg`).
- **Anexos**: qualquer arquivo (foto, PDF, contrato, comprovante) de até **4 MB** (`HC/como-adicionar-um-anexo-no-cadastro-do-cliente`, `YT/r8j8rYaACqg`).
- **Fotos de antes e depois**: **não há recurso próprio**. Dá para usar os anexos ou o campo de arquivo da anamnese ou do prontuário (**provável**).
- **Termo com assinatura digital: não encontrado.**
- **Avisos**:
  - Para uma cliente ou para um grupo. Aparecem ao escolher a cliente na **agenda** e/ou na **comanda**.
  - Grupos disponíveis: sem serviço, sem produto, sem telefone/e-mail/aniversário, sem CPF, aniversariantes do mês, aniversariantes do dia, atendidas 4 vezes ou mais em 90 dias, **com fidelidade a premiar**, com crédito ou dívida, **na primeira visita**, com e sem crédito de pacote, mostrar a data do último atendimento, todas e mostrar a observação do cadastro.
  - Exemplos do vídeo: "alérgica a sulfato de magnésio", "gosta de café".

  Fontes: `HC/como-adicionar-uma-mensagem-de-aviso-na-avec`, `YT/r8j8rYaACqg`, `YT/NXXSp5Nls_8`.
- **Unificar duplicadas**: botão "Unificar cadastro" na lista; junta comandas, créditos e histórico (`HC/como-unificar-cadastros-duplicados-de-clientes-na-avec`, `YT/r8j8rYaACqg`). A própria cliente também unifica no site, indicando se é "Familiar" (4.2).

### 11.2 Marketing

- **Promoções**:
  - Campos: nome, um ou todos os serviços, % ou valor final, vigência com data e hora, dias da semana, onde vale (sistema, online ou ambos), **código promocional** e comissão sobre o valor cheio ou com desconto.
  - Na comanda, o Avec sugere a promoção vigente.

  Fontes: `YT/wQtWNsEn09s`, `YT/kUyFvjcInLI`, `YT/riilTT4jR-c`.
- **Fidelidade**:
  - Campanha com nome, tipo de prêmio (dinheiro/cashback ou serviço), meta e prêmio. Depois se liga **cada serviço** à campanha com os pontos dele.
  - Pontos manuais são permitidos. O aviso "cliente com prêmio fidelidade" aparece, e "Premiar" põe o dinheiro em Créditos ou o serviço como crédito de pacote.
  - Exemplos: "a cada 10 cortes ganha uma massagem"; "4.000 pontos = R$ 200".

  Fontes: `YT/wQtWNsEn09s`, `YT/QEoNvLw5Jv4`, `YT/fuAlfuTR44s`, `YT/1ymqBH0MWSY`, `SITE/avec-fidelidade`.
- **Marketing pela IA**: retorno, aniversário e inativas (4.8).
- **Segmentar e achar clientes sumidas**: grupos de avisos e relatórios. Exemplos de relatório: 0001 aniversariantes, 0005 "fez a categoria A e não a B", 0007 e 0011 taxa de retorno, retorno sugerido e dias desde a última visita (índice em `https://doc.api.avec.beauty/llms.txt`, 14/10). **Não existe uma tela de "campanha para um segmento" fora da IA**, já que e-mail e SMS vão sair (**provável**).
- **Avaliações**: seção 4.7.

---

## 12. Relatórios, permissões, várias unidades e integrações

- **Relatórios**:
  - **Painel** em 3 abas: Clientes (atendidas, novas, cancelamentos, "como conheceu" em %, avaliações do online, 20 melhores, faixa etária, bairro e sexo); Profissionais (reservas por dia, ranking de faturamento com comandas e ticket médio, avaliações, **taxa de ocupação**, venda de produtos); Financeiro (faturamento bruto, ticket médio, despesas, faturamento por tipo serviço/produto/pacote, por dia, despesas por categoria, serviços e produtos mais vendidos).
  - **Favoritos** marcados com estrela e **todos os 200+**, com busca por palavra.
  - **Mapa de calor** de dias × horas, em intervalos de 60 ou 30 min, por profissional e serviço, em quantidade ou em R$.

  Fontes: `YT/btKqF5rJ8qo`, `SITE/relatorios-e-indicadores-para-beleza`. A exportação em Excel e a API de relatórios estão em 14/10.
- **Permissões**:
  - Grupos de acesso com "visualizar, editar, excluir e ver de todos" para cada parte (ex.: a recepção não vê o caixa).
  - Uma pessoa é a **master**. Ao passar o master para outra, o Avec avisa que isso inclui "as transações na conta AvecPay".
  - Verificação em duas etapas com Google Authenticator.

  Fontes: `HC/como-cadastrar-grupos-de-acesso-na-avec`, `YT/S53jbPpx6Tg`, `YT/hb32zJWlkto`, `YT/tOTDKypKzeM`; aviso do master no arquivo público de mensagens do painel, https://admin.avec.beauty/public/js/admin/mensagens.js (lido em 15/10).
- **Várias unidades**: painel central para redes e franquias, Avec Lake para comparar unidades e IA padronizada. A cliente vê os horários de toda a rede (`SITE/gestao-de-franquias-e-multiunidades-beleza`, `JS-BOOK/272p0md22io33.js`). Não se aplica à Casa.
- **Integrações confirmadas**:
  - WhatsApp (Avec IA; QR code e depois API oficial da Meta);
  - Avec Pay (maquininha TEF/POS, conta digital, split, Pix);
  - Asaas (clube de assinaturas);
  - Sinc.Finance (Vale Rápido, 14/10);
  - prefeituras e Sefaz (certificado A1);
  - exportação ContaAzul e ZeroPaper;
  - OFX do banco e XML da nota de compra;
  - Avec Lake (Power BI e outros);
  - agenda do celular, Google Maps e Waze (cliente);
  - botão no site e link no Instagram.

  **Não encontrado**: Reserve com o Google e Google Agenda da profissional.
- **Customizações escondidas**: opções que o suporte liga quando o salão pede, como mostrar o nome completo nas comissões, mudar a cor do bloqueio ou opções da comanda (`YT/hb32zJWlkto`, `YT/S53jbPpx6Tg`). Algumas são exigidas pela Avec IA (4.8).
- **Assinatura do Avec**: a tela "Meu plano" mostra faturas, plano, renovação e loja de adicionais; o pagamento é por boleto, Pix ou cartão (`YT/4yKe44j8nEg`).
- **Suporte**:
  - Chat na plataforma e WhatsApp (11) 9.4142-4253 (`PDF-NF`).
  - Reclame Aqui (abr–set/2026): 93 reclamações, 100% respondidas, 77,1% resolvidas, nota do consumidor 5,4, "voltariam a fazer negócio" 60%, reputação "Boa".
  - Problemas mais citados no histórico: mau atendimento (452), cobrança indevida (263), demora (135) e "não consigo cancelar" (135). Entre as recentes: "continuo sendo cobrada no cartão após solicitar o cancelamento" (18/09/2026) e "suporte ficou pior com franqueados" (17/09/2026) (`RA`).

---

## 13. Fluxos completos de ponta a ponta

Legenda: **C** = cliente, **R** = recepção, **P** = profissional, **G** = gestão, **IA** = Avec IA, **S** = o Avec fazendo sozinho.

### F1. A cliente marca online, é lembrada, vem, paga e é chamada de volta

| # | Quem | Onde | O que acontece | Fonte |
|---|---|---|---|---|
| 1 | C | Link na bio do Instagram ou app Avec | Abre a página do salão e entra ou se cadastra, recebendo um código de verificação | 4.1, 4.2 |
| 2 | C | Site | Junta cadastros duplicados ("Sou eu / Familiar"); aceita a taxa de falta, se houver | `JS-BOOK/09b89spe1h2m6.js` |
| 3 | C | Site | Escolhe o serviço, a profissional (ou "sem preferência", se liberado), o horário e o pedido especial, e confirma | `YT/7azxmy3xnW8` |
| 4 | S | Agenda | O horário aparece como **Agendado** com o selo "online"; o salão recebe e-mail, se configurado | `YT/aisky3AFp0s` |
| 5 | S/P | App PRO | Aviso de horário novo (promessa da página do produto; há queixas de falha) | `SITE/avec-pro` |
| 6 | IA | WhatsApp | **24 h antes**, numa das janelas, pede a confirmação | 4.8 |
| 7 | C | WhatsApp | Responde confirmando, cancelando ou pedindo outro horário (os botões entram sozinhos na mensagem) | `PDF-IA`, `SITE/blog/boas-praticas-para-templates-do-meta` |
| 8 | S | Agenda | Vira **Confirmado**; se cancelou, sai da grade; se reagendou, muda o horário | `YT/lUrC-8g8E2I`, `YT/a4gWA4YYoZo` |
| 9 | R | Agenda | A cliente chega: R busca o nome e clica em **Abrir comanda** › Confirmar. Aparecem os avisos (ex.: alergia, aniversário) | `YT/3lQcALNi3P4`, `YT/NXXSp5Nls_8` |
| 10 | S/P | App PRO | Status **Aguardando**; P recebe o aviso | `YT/lUrC-8g8E2I` |
| 11 | P | App PRO ou agenda | Muda para **Em atendimento** e preenche a anamnese, se usada | `YT/lUrC-8g8E2I`, `YT/Q2JmFpAoGn0` |
| 12 | P/R | Comanda | Produtos usados no item do serviço (gramas) ou baixa automática; serviço extra; venda de produto | 5, 9 |
| 13 | P | App PRO | **Finalizado** | `YT/lUrC-8g8E2I` |
| 14 | R | Comanda › Pagamento | Escolhe o caixa, as formas de pagamento e a bandeira, e finaliza. O troco pode virar crédito e o que faltou, dívida | 5 |
| 15 | S | Agenda, caixa e comissão | O horário vira **Pago** (vermelho), a venda entra no caixa e a comissão é calculada com descontos; a profissional vê em "não pagas" | `YT/3lQcALNi3P4`, `YT/iIkqEp_nvYI` |
| 16 | C | App ou site | Avalia de 1 a 5, se o salão ligou a avaliação (**na Casa está desligada**) | 4.7 |
| 17 | G | Financeiro › Notas fiscais | Emite a nota da comanda, em lote; no salão-parceiro, a nota da parceira | 10.2 |
| 18 | IA | WhatsApp | Perto de completar os "dias de retorno" do serviço (7, 3 ou 1 dia antes), manda o convite. Se a cliente agenda em até 72 h, conta como resultado no painel | 4.8, `PDF-PAINEL` |

### F2. A cliente pede pelo WhatsApp e a Avec IA marca

| # | Quem | Onde | O que acontece | Fonte |
|---|---|---|---|---|
| 1 | C | WhatsApp da Casa | Manda texto ou **áudio** (exemplo do Avec: "Oi, queria ver se a Bia consegue me atender para uma mecha no sábado de manhã") | `SITE/funcionalidade/avec-ia` |
| 2 | IA | WhatsApp | Responde com o "template de entrada", entende o serviço e o período ("amanhã de manhã" = 9h–12h) e consulta a agenda daquela profissional | `PDF-IA` |
| 3 | IA | WhatsApp | Oferece horários; se a cliente é nova, **cadastra**; tira dúvidas de preço e endereço | `PDF-IA` |
| 4 | C | WhatsApp | Escolhe um horário | `PDF-IA` |
| 5 | IA/S | Agenda | Grava o horário ("Agendamento feito com sucesso!") | `PDF-IA` |
| 6 | R | WhatsApp | **Transbordo**: a cliente pede uma pessoa, a IA se perde, a pergunta foge do roteiro ("marca da tinta?") ou a cliente quer cancelar ou remarcar fora da confirmação. A conversa fica para a recepção. **A IA não marca "sem preferência"** | `PDF-IA`, `YT/a4gWA4YYoZo` |
| 7 | — | — | A partir daqui, segue F1 do passo 6 | — |

### F3. A recepção marca por telefone ou WhatsApp, sem IA

| # | Quem | Onde | O que acontece | Fonte |
|---|---|---|---|---|
| 1 | R | Agenda | Busca horário livre na coluna das profissionais (filtrando por nome) e confere duração, folga e conflito | 2.1 |
| 2 | R | Reserva | Cliente (por telefone), serviço(s) com "Adicionar serviço" ou Ctrl + clique, observação e etiqueta. Se quiser, marca **lembrete por SMS** | `YT/QIUKesbyGYg` |
| 3 | R ou P | WhatsApp manual | Manda o texto de **lembrete** configurado (envio manual, ilimitado) | `YT/S53jbPpx6Tg`, `YT/Q2JmFpAoGn0` |
| 4 | R | Agenda | Confirma à mão (status **Confirmado**) quando a cliente responde | `YT/lUrC-8g8E2I` |
| 5 | — | — | Segue F1 do passo 9 | — |

### F4. A cliente desmarca ou remarca

| Caminho | Passos | Fonte |
|---|---|---|
| Pelo site ou app | C › Meus agendamentos › Cancelar (respeitando a antecedência mínima) › o site pergunta "reagendar?" › se sim, marca de novo › S tira o horário da grade | `YT/7azxmy3xnW8` |
| Pela confirmação da IA | C responde à confirmação › IA cancela ("deleta da agenda") ou remarca, se o salão permitiu | `YT/a4gWA4YYoZo`, `PDF-IA` |
| Pela recepção | R abre o horário › **Cancelado** › "apenas este" ou "deletar todos" (recorrência) › ou arrasta para o novo horário | 2.1 |
| Quem ocupa a vaga | **Não há lista de espera.** A vaga simplesmente fica livre na grade e no online | 2.1 |

### F5. Pacote "Método Fiaes": venda e uso

| # | Quem | Onde | O que acontece | Fonte |
|---|---|---|---|---|
| 1 | G | Configurações › Pacotes | O pacote já existe: R$ 8.000; 4 sessões + 4 finalizações; 365 dias; comissão sobre o valor com desconto; "ambos" | `API/salao/62004/pacotes/online/online` |
| 2 | R | Comanda (agenda ou financeiro) | Botão **Pacote**, sem profissional (sem comissão de venda); pagamento em várias formas ou parcelas no cartão | `YT/XvZkxRCjsXI`, `YT/4ps6wQWHLXo` |
| 3 | S | Ficha › Pacotes | Fica 0/4 usadas, com a validade | `HC/como-acompanhar-o-pacote-de-servicos-no-cadastro-de-clientes` |
| 4 | R | Comanda da sessão | "Utilizar crédito de pacote" (valor 0) + **profissional** | `YT/SmuzJreKNHI` |
| 5 | S | Comissão | Comissão sobre o valor do serviço com o desconto do pacote, com a forma de pagamento da venda | `YT/EhvLgCpMfBA` |
| 6 | R | Ficha › Pacotes | Se venceu com sessões sobrando, R pode dar novo prazo | `YT/lUrC-8g8E2I` |

### F6. Fechar o dia, o período e o mês

| Quando | Quem | Passos | Fonte |
|---|---|---|---|
| Fim do dia | R | Finaliza todas as comandas (agenda "toda vermelha") › Caixas abertos › confere cada forma de pagamento contra a gaveta e a maquininha › Fechar caixa (informa a diferença) › imprime o relatório se quiser | 6 |
| Fechamento de comissão | G | Financeiro › Comissões › período › confere › lança vales, bônus e descontos recorrentes › paga em lote › recibo › histórico "Pagas". **A Casa provavelmente só calcula aqui e paga fora** | 7.3, seção 1 |
| Mês | G | Emite as notas pendentes › lança e concilia despesas (OFX) › fluxo de caixa › exporta para o contador (ContaAzul ou ZeroPaper) | 10 |

### F7. Venda sem atendimento (produto ou vale-presente)

R › Financeiro › Abrir comanda › cliente › botão **Produto** (com profissional, se ela ganha comissão; baixa no estoque) ou **Vale Presente** (valor + código) › Pagamento › Finalizar. Quem ganhou o vale usa o código na forma de pagamento "Vale-Presente" (`YT/gDdmmwQd98k`, `YT/GC9lujF3V0I`).

---

## 14. O que não foi encontrado

- **Lista de espera** para vagas que abrem (só existe o rodízio para quem chega sem hora).
- **NPS de 0 a 10** e pesquisa automática depois do atendimento; o que existe é a avaliação de 1 a 5 no app ou site.
- **Lembrete em horas** (ex.: 2 h antes) e o horário exato do SMS e do e-mail.
- **Sinal por Pix** no agendamento online. Existe pagamento online só com Avec Pay, cobrança na reserva com cartão e taxa de falta.
- **Assinatura digital de termo**, **fotos de antes e depois** com tela própria e **metas** da equipe.
- **Motivo do cancelamento** em lista.
- **Reserve com o Google**, integração com Google Agenda e com o botão "Agendar" do Instagram (há só a chave `permite_agendamento_instagram`).
- Onde a recepção atende a conversa depois do transbordo da Avec IA.
- **Bloqueio de horário pela própria profissional** no app.
- Horário atual da confirmação da IA (as duas fontes oficiais divergem).

---

## 15. Fontes

**Lidas em 15/10/2026, além das de 14/10**

- Manuais em PDF: `PDF-IA`, `PDF-PAINEL`, `PDF-CLUBE` e `PDF-NF` (endereços na tabela de siglas).
- Central de ajuda: os mesmos 95 artigos de 14/10, relidos; o mapa do site de 15/10 não tem artigos novos (https://negocios.avec.app/sitemap.xml).
- Páginas comerciais:
  - https://negocios.avec.app/funcionalidade/avec-ia
  - https://negocios.avec.app/lp-avec-ia
  - https://negocios.avec.app/marketing-com-ia-para-beleza
  - https://negocios.avec.app/avec-fidelidade
  - https://negocios.avec.app/clube-de-assinaturas-para-beleza
  - https://negocios.avec.app/avec-pro
  - https://negocios.avec.app/app-para-profissionais-de-beleza-avec-pro
  - https://negocios.avec.app/avec-pagamento-de-comissao
  - https://negocios.avec.app/emissao-de-notas-fiscais-avec
  - https://negocios.avec.app/gestao-de-franquias-e-multiunidades-beleza
  - https://negocios.avec.app/relatorios-e-indicadores-para-beleza
  - https://negocios.avec.app/app-white-label-para-salao-e-clinica
  - https://negocios.avec.app/guia/avec-ia-whatsapp-oficial
- Blog oficial:
  - https://negocios.avec.app/blog/boas-praticas-para-templates-do-meta
  - https://negocios.avec.app/blog/metas-para-salao-de-beleza-como-criar-objetivos-que-a-equipe-entende (novo, depois de 14/10)
  - https://negocios.avec.app/blog/como-montar-uma-escala-de-profissionais-em-salao-de-beleza (novo)
  - https://negocios.avec.app/blog/como-criar-um-padrao-de-atendimento-para-salao-de-beleza (novo)
  - https://negocios.avec.app/blog/agenda-para-clinica-de-estetica-como-organizar-horarios-salas-e-profissionais
  - https://negocios.avec.app/blog/como-calcular-comissao-de-profissionais-de-beleza-com-mais-clareza
  - https://negocios.avec.app/blog/como-evitar-faltas-em-estudio-de-tatuagem-8-acoes-para-proteger-sua-agenda
- Código público do site de agendamento (mesmo build no ar em 15/10):
  - https://booking.avec.beauty/_next/static/chunks/09b89spe1h2m6.js (taxa de falta, cadastros duplicados)
  - https://booking.avec.beauty/_next/static/chunks/272p0md22io33.js (lista de ações da cliente, erros)
  - https://booking.avec.beauty/_next/static/chunks/3ghi0ixv133r4.js (menu da cliente)
  - https://booking.avec.beauty/_next/static/chunks/lazy_37-_o13bk1d_v.js (pagamento online, CVV)
  - https://booking.avec.beauty/_next/static/chunks/lazy_0x6cb3ntztpsc.js (salvar na agenda do celular)
  - https://booking.avec.beauty/_next/static/chunks/154wfs3r-cx0i.js (entrar com conta social)
  - App marketplace: https://avec.app/_next/static/chunks/pages/_app-5189a9861a43b776.js (código de verificação, cópia de 14/10)
  - Painel: https://admin.avec.beauty/public/js/admin/mensagens.js (textos de recorrência e do aviso de troca de master)
- Rotas públicas, sem login, em 15/10:
  - https://api.avec.beauty/salao/62004
  - https://api.avec.beauty/salao/slug/studiothaisefiaes
  - https://api.avec.beauty/salao/62004/pacotes/online/online
  - https://api.avec.beauty/salao/62004/promocoes (cópia de 14/10)

  Só foram lidas configurações do salão e o pacote público; nenhum dado pessoal.
- Lojas: `iOS-PRO`, `iOS-CLI` (consulta pela API pública da Apple, https://itunes.apple.com/lookup?id=1324231062,1394288142&country=br) e `PLAY-PRO`.
- Reclame Aqui: `RA` (lido com navegador sem janela em 15/10).
- Arquivo da Casa: `docs/avec-formatos.json` (205 formatos).

**Vídeos oficiais** (`https://youtu.be/<id>`; legendas automáticas em português baixadas em 15/10, menos as 15 já transcritas em 14/10; os marcados "(sem legenda)" foram usados só pelo título e pela descrição)

| id | Publicado | Título |
|---|---|---|
| lUrC-8g8E2I | 25/01/2026 | Explorando o Módulo Agenda da Plataforma Avec |
| btKqF5rJ8qo | 25/01/2026 | Explorando o Módulo de Relatórios da Plataforma Avec |
| hb32zJWlkto | 26/01/2026 | Configurações: Passo a Passo para uma Plataforma Eficiente |
| 7azxmy3xnW8 | 26/01/2026 | Agendamento Online – Facilitando o Atendimento ao Cliente |
| wQtWNsEn09s | 26/01/2026 | Explorando o Módulo de Marketing na Plataforma Avec |
| MOIE_J_1cGE | 26/01/2026 | Fechamento de Caixa e Gestão Financeira Simplificada sem e com AvecPay |
| QYzwxyIT4_c | 26/01/2026 | Gerenciamento de Estoque – Cadastro e Controle de Produtos |
| a4gWA4YYoZo | 02/02/2026 | Descubra como otimizar seu agendamento e marketing com a IA da Avec! |
| Q2JmFpAoGn0 | 02/02/2026 | Apresentação do Aplicativo AvecPro para Profissionais de Beleza |
| r8j8rYaACqg | 02/02/2026 | Apresentação do Módulo de Clientes e Funcionalidades |
| krF_neT6So0 | 03/02/2026 | Entendendo o Split de Pagamento na AvecPay |
| oe8ZzrWmtSY | 03/02/2026 | Como cancelar um agendamento |
| tOTDKypKzeM | 03/02/2026 | Google Authenticator – como configurar (sem legenda) |
| p2E1BNFYmE8 | 05/03/2026 | Conheça a Plataforma AVEC |
| S53jbPpx6Tg | 02/06/2026 | Como configurar as informações do seu estabelecimento na Avec |
| QIUKesbyGYg | 02/06/2026 | Como realizar um novo agendamento |
| KmIVWexZJvs | 02/06/2026 | Como agendar um serviço recorrente |
| if19WriXa2o | 02/06/2026 | Como agendar mais de um cliente por horário |
| aisky3AFp0s | 02/06/2026 | Como ativar o Agendamento On line na Avec |
| o6KDJO7L9OM | 02/06/2026 | Como usar o App Avec Pro |
| q_sGuM_6Kco | 02/06/2026 | Como usar o App Avec |
| NXXSp5Nls_8 | 02/06/2026 | Como adicionar uma mensagem de aviso ao cadastro do cliente |
| havf_UZ8PxU | 02/06/2026 | Como bloquear horário |
| VOUHIQP-zFI | 02/06/2026 | Como incluir um novo agendamento para um cliente já agendado |
| KY_Vu-rPqMQ | 02/06/2026 | Tudo sobre comandas |
| gqEUV9G0RfU | 02/06/2026 | Tudo sobre caixa |
| ekyM8BNA6s0 | 02/06/2026 | Como realizo a abertura e fechamento de um caixa |
| 5xr_wAVufLA | 02/06/2026 | Como configurar e pagar comissão? |
| Cl-oVzsB8vk | 02/06/2026 | Descontar taxas de cartão |
| 3awWvbRKhsY | 02/06/2026 | Como configurar a comissão de Assistente |
| YmtWWNPh1xY | 02/06/2026 | Como funciona o recálculo de Comissão |
| kGqWhFdFDOw | 02/06/2026 | Adiantamento de comissão |
| wBb8R1ULXq4 | 02/06/2026 | Como adicionar bônus a um profissional |
| X94p34dGwkA | 02/06/2026 | Gestão de Entradas e Saídas Financeira |
| xYjCYTaqUUU | 02/06/2026 | Como fazer Conciliação Bancária |
| 1ymqBH0MWSY | 02/06/2026 | Campanha de Fidelidade, como criar a sua |
| riilTT4jR-c | 02/06/2026 | Como criar campanhas promocionais |
| FLVt0bmWgCI | 02/06/2026 | Como configuro o prontuário (o conteúdo da legenda é sobre caixa) |
| 255u0GEEa1o | 02/06/2026 | Como configuro o meu estoque e defino as regras de utilização |
| l04AGH2ibwQ | 02/06/2026 | Solicitação de saída no estoque |
| kO6IlSGcMOU | 02/06/2026 | Como configuro o meu módulo de nota fiscal |
| MAMfs0h5XK0 | 02/06/2026 | Configurar multiempresa NF Nacional |
| Wux8mVhrh_0 | 02/06/2026 | Como Configurar e Emitir Notas Fiscais |
| 4yKe44j8nEg | 02/06/2026 | Onde visualizo as informações do meu plano contratado |
| Jqc8prPJxZQ | 15/07/2026 | Como criar um pacote de serviços |
| XvZkxRCjsXI | 15/07/2026 | Como lançar a venda de um pacote na comanda |
| SmuzJreKNHI | 15/07/2026 | Como lançar um serviço para uma cliente com pacote |
| EhvLgCpMfBA | 15/07/2026 | Como comissionar e faturar pacotes |
| W4a7aHpwahc | 16/07/2026 | Como gerar crédito com pacotes |
| iIkqEp_nvYI | 16/07/2026 | Como o sistema calcula as comissões |
| u0Qc495lC-A | 16/07/2026 | Agendamento com preferência de profissional |
| Bo9C13qn-5E | 16/07/2026 | Agendamento sem preferência de profissional |
| QEoNvLw5Jv4 | 16/07/2026 | Campanhas de fidelidade – Parte 1 |
| fuAlfuTR44s | 16/07/2026 | Campanhas de fidelidade – Parte 2 |
| lmh9MhgH0Zk | 16/07/2026 | Desconto personalizado e recorrente para o profissional |
| 2pdJl89Yll8 | 16/07/2026 | Descontar um produto vinculado a um serviço |
| 4GAUUQFbMcU | 16/07/2026 | Vender e comissionar um produto na comanda |
| Z6KossLsSXs | 16/07/2026 | Incluir um serviço extra na comanda |
| DdPC6udFjZg | 16/07/2026 | Vincular uma comanda finalizada a um caixa |
| sCtBQGyE1Ss | 16/07/2026 | Criar uma ficha de anamnese |
| 1oFy0n0qM1o | 16/07/2026 | Módulo de estoque – Parte 1 |
| pfGu_DIZ8Ag | 16/07/2026 | Módulo de estoque – Parte 2 |
| UMWgZAOdGW8 | 16/07/2026 | Emitir um pedido de compra |
| iKwCwrRHgjU | 16/07/2026 | Importar o XML da nota fiscal |
| pHZ3Fye14Ps | 16/07/2026 | Como lançar despesas |
| 3lQcALNi3P4 | 17/07/2026 | Abrir uma comanda pela Agenda |
| 4ps6wQWHLXo | 17/07/2026 | Abrir uma comanda pelo Financeiro |
| gDdmmwQd98k | 17/07/2026 | Vender um produto sem serviços na comanda |
| cb8-mGr6Z0E | 17/07/2026 | Dar saída de produtos pela comanda |
| MbwIFXes5Ig | 17/07/2026 | Como fechar um caixa |
| HKtWeE-65ok | 17/07/2026 | Como lançar uma pré-venda |
| RnPMTw3JDSE | 17/07/2026 | Pré-venda com pagamento parcial (sem legenda) |
| vVXrhz7f8Uw | 17/07/2026 | Pré-venda para quitar uma dívida (sem legenda) |
| GC9lujF3V0I | 17/07/2026 | Como funcionam os vale-presentes |
| kUyFvjcInLI | 17/07/2026 | Como criar uma promoção |
| Z-K81eV1Dzs | 17/07/2026 | Como cadastrar um profissional – básico |
| JjZ1dvWYnuk | 17/07/2026 | Alterar o horário de trabalho de um profissional |
| 1Q-SG-36YrM | 17/07/2026 | Avisos em salas e equipamentos (sem legenda) |
| bahdBehVYoU | 15/08/2025 | Vale Rápido no app Avec Pro! (sem legenda) |
| s6081v4m9-4, KRSmSesUHEY, dJR1m5WJowI, awwFpDRpTI0, u2ORQtmKl2g, B1hn3rBS8TQ, CIPrZsYigKE, vRfRKUZvZbE, juZu5ajoYm4, OdqFbWvL3bY, PfbOT9zAOkY | 29/11/2022 | Série curta "Avec •" (agendar, recorrência, encaixe, cancelar, bloquear, itens da comanda, pagar comissões, visão geral, fechar comanda, vínculo de venda, entradas e saídas) |
