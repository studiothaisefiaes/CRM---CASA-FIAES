# ChatGuru: funcionalidades e fluxos de uso, módulo por módulo

Pesquisa de 15/10/2026. Complementa `docs/chatguru-pesquisa.md` e `docs/chatguru-engenharia-reversa.md` (ambos de 14/10). O foco aqui é **como cada recurso é usado no dia a dia**: por quem atende (atendente), por quem gerencia (gestão/administrador) e pelo lado da cliente.

**Regras seguidas.** Só material público:
- a wiki oficial inteira (60 páginas; conferi hoje que o índice https://wiki.chatguru.com.br/llms.txt é o mesmo de ontem);
- o site comercial, inclusive as 31 páginas de "Soluções" publicadas em 2026 (https://chatguru.com.br/funcionalidade-sitemap.xml);
- as legendas automáticas de 54 vídeos oficiais do canal da ChatGuru no YouTube (baixadas com `yt-dlp`, sem navegador);
- o arquivo JavaScript público do painel (o mesmo baixado ontem, servido sem login);
- Reclame Aqui, Google Play, imprensa, Capterra e GitHub.

Não fiz login, não criei conta, não preenchi formulário e não usei navegador visível. Páginas que precisam de JavaScript foram lidas com Playwright em modo invisível (headless).

**Marcas usadas**
- **[DOC]** wiki oficial (central de ajuda), inclusive o histórico de atualizações, sempre com a data.
- **[VÍDEO]** vídeo oficial do canal da ChatGuru. A fonte é a legenda automática do YouTube: li a transcrição inteira, mas palavras isoladas podem estar erradas.
- **[SITE]** site comercial oficial. É texto de marketing e descreve o recurso de forma genérica.
- **[JS]** arquivo público do painel (código que o navegador baixa sem login).
- **[3º]** terceiros: Reclame Aqui, imprensa, Capterra, GitHub, Google Play.
- **Provável:** inferência minha, sem confirmação.
- **Não documentado:** procurei e não achei em nenhuma fonte pública.

---

## 0. O que este documento acrescenta aos de ontem

1. **Ações do robô com "janela de envio".** Cada ação pode ter atraso (de segundos até dias) e duas travas: "se passar de 20h, manda no dia seguinte às 10h" e "não manda no fim de semana, empurra para segunda" [VÍDEO [VMvKRbOzxbw](https://www.youtube.com/watch?v=VMvKRbOzxbw)].
2. **Diálogo agendado à mão dentro do chat.** A atendente escolhe data e hora, e depois pode "Executar agora" ou "Cancelar". O vídeo do hotel usa isso para o check-in e o check-out [VÍDEO [VMvKRbOzxbw](https://www.youtube.com/watch?v=VMvKRbOzxbw), [lvpRPfJa6Iw](https://www.youtube.com/watch?v=lvpRPfJa6Iw)].
3. **Ação "Delegar" tem três opções.** Põe um departamento, pode tirar os outros responsáveis e pode entregar a uma pessoa só do setor, "dando preferência para quem estiver online" [VÍDEO [TWCwnyCbUA8](https://www.youtube.com/watch?v=TWCwnyCbUA8)].
4. **Listas completas de gatilhos e ações.** São 23 gatilhos e 18 ações, mais o padrão de "contexto" que monta menus: URA=True no início, URA=1 e URA=1.1 nas etapas, URA=False no fim e URA=Block para o robô ficar quieto quando a equipe começa a conversa [DOC, VÍDEO].
5. **Permissões por grupo.** Tags, usuários, arquivos, celulares, login pelo celular, mensagens, funis, campanhas, NPS, cada tipo de relatório, chatbot e chats. O código do painel tem nomes como `CHAT_SEE_ALL`, `CHAT_VIEW_GROUP_CHATS` e `CHAT_FILTER_BY_*` [VÍDEO, JS].
6. **Planos atuais com a tabela de recursos.** Essencial: 2 usuários e 1 número. Performance: 5 e 1. Profissional: 10 e 2. Departamentos: nenhum, 3 ou ilimitados. Carteira de clientes só no Profissional. IA e "segmentação de origem" só do Performance para cima [SITE].
7. **Recursos nativos que o site confirma.** A carteirização é nativa: a cliente que volta cai com a mesma pessoa, e a carteira é redistribuída nas férias. A importação por planilha CSV também é nativa, com até 10.000 contatos [SITE].
8. **Agenda própria continua não existindo.** O agendamento depende de integração. É "nativo" com Google Calendar e Feegow e "via integração" com Calendly. A wiki ainda cita **Trinks** (sistema de salão) [SITE, DOC].
9. **Sem aplicativo de celular.** No Google Play só existe um app homônimo de outra empresa. O acesso pelo celular é o painel web, e existe uma permissão própria para "entrar pelo celular" [3º, DOC, VÍDEO].
10. **Sem Instagram nem Messenger como caixa de entrada.** Tudo é WhatsApp, em três modos: Web, API oficial ou CoEx. O Instagram aparece só como origem de lead e anúncio [SITE].
11. **Painel em tempo real.** Mostra status × pessoa ou departamento, os chats "sem delegação" e quem está online (verde) ou offline (vermelho). A página inicial do administrador tem 7 gráficos prontos [VÍDEO].
12. **Métricas de tempo.** "Primeira resposta" é o tempo médio no status Aberto. O "tempo médio de resposta" por pessoa conta todas as respostas. Há um mapa de calor de dia × hora [DOC].
13. **Mudanças da Meta em 2026 que a wiki não tem.**
    - Cobrança por mensagem na API oficial desde 01/10/2026. O número Web não é cobrado.
    - Janela de anúncio de até 7 dias, desde 28/09/2026.
    - Contato sem número visível (BSUID/username). A ChatGuru diz que guarda os dois e completa o cadastro quando o telefone aparece.

    [SITE, VÍDEO, DOC]
14. **A ChatGuru declara que "não possui um modelo próprio de inteligência artificial".** Transcrição e resumo usam a chave OpenAI paga pelo próprio cliente [SITE, DOC].
15. **Reclame Aqui.** Reputação "Ótima" entre abril e setembro de 2026, com 37 reclamações no semestre, 81,1% respondidas e tempo médio de resposta de 19 dias e 12 horas. Os temas mais comuns são instabilidade, número banido e suporte lento [3º].
16. **Soluções novas no site.**
    - Menu de atendimento falado (opções em áudio).
    - Telefonia (Calix, Zenvia).
    - Cobrança (Asaas, Cielo).
    - Recuperação de carrinho.
    - Conversa que começa sozinha a partir de um formulário, planilha ou CRM.

    [SITE]
17. **Detalhes de mensagem.**
    - Figurinhas da coleção, reações e envio de localização só existem na API oficial.
    - A API oficial não responde citando uma mensagem e não participa de grupos.
    - Mensagem apagada pela cliente aparece como "Essa mensagem foi apagada pelo remetente"; mensagem editada ganha a marca "Editada".

    [DOC]
18. **O ritmo das campanhas tem quatro versões diferentes nas fontes oficiais.** Padrão de 180 s ajustável, "3 a 6 minutos", "2 a 3 minutos" e "3 envios por segundo com limite diário" [DOC, VÍDEO, SITE].

---

## 1. Retrato rápido do ChatGuru

| Item | Detalhe | Fonte |
|---|---|---|
| Canal | Só WhatsApp, em três modos: **Web** (QR Code; um celular "servidor" fica ligado o tempo todo), **API oficial / WABA** (pela Gupshup, sem celular) e **CoEx** (Web e API oficial no mesmo número) | [SITE whatsapp](https://chatguru.com.br/produto/whatsapp/), [DOC WABA](https://wiki.chatguru.com.br/whatsapp-business-api/whatsapp-business-api-waba) |
| Quem usa | **Administrador** (tudo, mais o painel), **Normal** (só o que o admin libera) e **Departamento** (grupo de usuários com permissões somadas) | [DOC Usuários](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios) |
| Suporte | Pelo WhatsApp, de segunda a sexta, das 8h às 18h. Só atende números autorizados pelo admin da conta | [SITE](https://chatguru.com.br/), [DOC Dicas](https://wiki.chatguru.com.br/duvidas-e-dicas/dicas) |
| Implantação | "Onboarding assistido": a equipe da ChatGuru ajuda a configurar o robô ("nosso suporte configura cada fluxo") | [SITE](https://chatguru.com.br/produto/plataforma-chatguru/), [VÍDEO 1glTuRYVY5E](https://www.youtube.com/watch?v=1glTuRYVY5E) |
| Empresa | Fundada em 2019. Mais de 6.000 clientes, 9 países, "+200 milhões de mensagens/mês". CNPJ 17.878.549/0001-86 | [3º Baguete](https://www.baguete.com.br/noticias/chatguru-traz-dois-novos-c-level), [SITE](https://chatguru.com.br/), [3º Reclame Aqui](https://www.reclameaqui.com.br/empresa/chatguru/) |

**Planos (outubro de 2026).** Os preços não são públicos ("Falar com um especialista"). Também existem as condições "MEI" e "Enterprise". Fonte: [SITE planos](https://chatguru.com.br/planos-e-precos/). Li a tabela direto do HTML da página: um ✔ ou ✘ por plano.

| Recurso | Essencial | Performance | Profissional |
|---|---|---|---|
| Usuários incluídos | 2 | 5 | 10 |
| Números de WhatsApp | 1 | 1 | 2 |
| Departamentos | ✘ | 3 | ilimitado |
| Rodízio de atendimento | "básico" | "avançado" | "avançado" |
| Carteira de clientes | ✘ | ✘ | ✔ |
| Segmentação de origem | ✘ | ✔ | ✔ |
| IA de resumo e IA de transcrição | ✘ | ✔ | ✔ |
| NPS, menu de atendimento (URA), tags, funil, relatórios, filtros, anotações, integrações, biblioteca de arquivos, histórico, início manual de conversas | ✔ | ✔ | ✔ |
| Mensagens ativas e disparo em massa | grátis no Web | grátis no Web | grátis no Web |
| Importação de lista (.csv) | 10 mil contatos | 10 mil | 10 mil |

- O site não explica a diferença entre rodízio "básico" e "avançado". **Provável:** o "avançado" inclui distribuir por departamento e pelo robô, já que departamentos só existem do Performance para cima.
- Nota do site: "As campanhas estão sujeitas às regras da plataforma, operando com limite diário e cadência de 3 envios por segundo" [SITE planos](https://chatguru.com.br/planos-e-precos/).

---

## 2. Multiatendimento (a caixa de entrada)

### 2.1 Lista de chats, filtros e busca

- **O que faz:** mostra todas as conversas do número, com filtros e busca, para a atendente achar quem precisa de resposta.
- **Quem usa:**
  - Atendente: vê só os chats em que é responsável ou que são do departamento dela.
  - Gestão: vê todos.
- **Fluxo da atendente:**
  1. Abre o menu **Chats**.
  2. Filtra a lista por:
     - **nome**;
     - **número**;
     - **tags**, com as regras "Todas", "Qualquer" ou "Não tem";
     - **responsável** (usuários ou departamentos, com "Qualquer", "Todos" ou "Não tem", podendo escolher vários);
     - **etapa do funil** (várias de uma vez);
     - **status**;
     - **ordenação**;
     - **não lidas**;
     - **arquivados**, que é uma lista à parte;
     - **broadcasts** (listas de transmissão);
     - **favoritos**;
     - **agendados** (chats com mensagem agendada).
  3. Ou usa a busca:
     - pelo **texto de uma mensagem** enviada ou recebida, com filtro de período desde julho de 2024;
     - pelo **nome**, com pelo menos 3 letras;
     - pelo **número**, com pelo menos 4 dígitos. Os 4 últimos dígitos bastam.
  4. Chat arquivado só aparece na busca se ela marcar "Arquivados".
- **O que aparece na lista:**
  - Ícone de **uma pessoa**: há usuário responsável (**verde** = está online; **vermelho** = offline).
  - Ícone de **duas pessoas**: um departamento é o responsável.
  - "Sem usuário delegado".
  - Prévia da última mensagem por tipo: Foto, Vídeo, Áudio, Mensagem de Voz, Documento, Figurinha, Contato, Localização, **Ligação Perdida** e "Aguardando Mensagem..." (mensagem que o WhatsApp não carregou).
- **Outros detalhes:**
  - A lista não tem limite e se atualiza sozinha desde 2022.
  - O título da aba do navegador mostra quantas mensagens não lidas a pessoa tem nos chats dela.
  - Cada filtro pode ser liberado ou bloqueado por permissão.
- **Fontes:**
  - [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [DOC 2024, 01/07 e 01/08](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024)
  - [DOC 2022, 01/07](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2022)
  - [VÍDEO "Filtros e pesquisas de chats"](https://www.youtube.com/watch?v=z68El8JyLq0)
  - [VÍDEO "Treinamento para usuários administradores"](https://www.youtube.com/watch?v=-_7A9UpZr4k)
  - [VÍDEO "Dashboard de atendimento"](https://www.youtube.com/watch?v=1ohwcx-iDUo)
  - [JS] textos e permissões do arquivo `app.chatlist.js`

### 2.2 Painel de controle em tempo real

- **O que faz:** um quadro no topo da tela de Chats com a contagem de conversas por status (Aberto, Em atendimento, Aguardando e total) e por pessoa ou departamento. Também mostra os chats sem ninguém responsável e quem está online.
- **Quem usa:**
  - Administrador: vê a conta inteira.
  - Usuário normal: vê uma versão reduzida, só com os chats dele e dos departamentos dele (desde 29/05/2023).
- **Fluxo da gestão:**
  1. Abre Chats e olha o painel.
  2. Clica num número do painel ("3 em Aberto com o Suporte", por exemplo) e a lista passa a mostrar só aqueles chats.
  3. Redistribui ou cobra a equipe a partir dali.
- **Fontes:**
  - [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [DOC Relatórios gráficos ("Extra")](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/relatorios-graficos)
  - [VÍDEO "Dashboard de atendimento"](https://www.youtube.com/watch?v=1ohwcx-iDUo)
  - [DOC 2023](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)
  - [SITE "Monitoramento de atendimento"](https://chatguru.com.br/blog/solucoes/monitoramento-de-atendimento-no-whatsapp/)

### 2.3 Responsável (delegação) e quem vê o quê

- **O que faz:** cada chat tem um ou mais **responsáveis**, que podem ser usuários e/ou departamentos. Por padrão, o usuário normal só enxerga a conversa se for responsável ou se fizer parte do departamento responsável. O administrador vê tudo, e a permissão "**ver todos os chats**" funciona como um meio-termo entre o normal e o administrador.
- **Quem usa:** atendente e gestão, cada um conforme as permissões.
- **Fluxo:**
  1. No painel direito do chat, clica em **Responsável**.
  2. Marca ou desmarca pessoas e departamentos.
  3. Quem foi adicionado recebe um alerta no sino, com som.
- **Histórico:** a aba "Histórico de usuários delegados" mostra quem delegou para quem e quando. Também mostra se a delegação foi **automática** (feita pelo robô ou pelo sistema) ou **manual**.
- **Quando alguém sai da equipe:** apagar o usuário deixa os chats dele como "não delegados". A wiki diz que dá para transferir esses chats a outra pessoa "através do chatbot", com ajuda do suporte.
- **Fontes:**
  - [DOC Chats, item "Responsável"](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [DOC Usuários](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios)
  - [VÍDEO "Vários usuários utilizando o mesmo WhatsApp"](https://www.youtube.com/watch?v=gTgfeZk8MzY)
  - [VÍDEO "Permissões de usuários"](https://www.youtube.com/watch?v=9gR5mpPvUxk)

### 2.4 Rodízio de atendimento (fila e distribuição automática)

- **O que faz:** entrega cada chat **novo** à próxima pessoa ou departamento da fila.
- **Quem usa:**
  - Gestão: configura a fila.
  - Atendente: recebe os chats.
- **Fluxo da gestão:**
  1. Abre Usuários e depois a aba **Rodízio**.
  2. Adiciona usuários e/ou departamentos em ordem. Colocar a mesma pessoa duas vezes faz ela receber o dobro de chats.
  3. Liga a regra "**Pular**" para não entregar chat a quem está offline.
  4. Usa **Ativo/Inativo** para tirar alguém da fila naquele dia sem apagar o lugar dela.
  5. O painel destaca quem é o "Próximo".
- **Regras:**
  - O rodízio só vale para chats que chegam **depois** de ser ativado.
  - Cada número de WhatsApp tem a sua fila, e uma pessoa pode estar em várias.
  - Se a fila tiver um **departamento**, o chat vai para o departamento inteiro, e todos os membros veem.
  - Para quem usa o robô, a ChatGuru recomenda **desligar** o rodízio do menu e distribuir pelo robô.
- **Botões e configurações relacionados:**
  - "**Delegar p/ Fila**" no chat: devolve a conversa ao rodízio.
  - "Delegar novamente os chats que forem reiniciados": quando a cliente volta, ela entra de novo na fila.
  - "Remover o(s) usuário(s) delegado(s) quando o chat for reiniciado": tira a atendente anterior antes de redistribuir.
- **Pelo robô:** a ação Delegar pode mandar para um departamento e "delegar apenas para um único usuário" do setor, "dando preferência para quem estiver online".
- **Fontes:**
  - [DOC Usuários, item "Rodízio"](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios)
  - [DOC Acessando a plataforma, 4º passo](https://wiki.chatguru.com.br/primeiros-passos/acessando-a-plataforma)
  - [DOC Configurações da conta](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta)
  - [VÍDEO "Como criar um diálogo de encaminhamento"](https://www.youtube.com/watch?v=TWCwnyCbUA8)
  - [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k)

### 2.5 Transferência entre pessoas e setores

- **O que faz:** passa a conversa para outra pessoa ou setor.
- **Quem usa:** atendente, se tiver a permissão de "alterar responsável", e a gestão.
- **Fluxo manual:**
  1. Troca o campo **Responsável**.
  2. Escreve uma **anotação interna** com @ da colega, explicando o caso.
  3. A colega recebe aviso no sino e por e-mail.
- **Fluxo com "diálogo de encaminhamento",** um atalho configurado uma vez pela gestão:
  1. A atendente clica em "Acionar um diálogo" e escolhe, por exemplo, "Encaminhar para SAC".
  2. O robô:
     - manda à cliente "Você está sendo direcionado para o SAC, aguarde";
     - põe o departamento SAC como responsável;
     - tira os responsáveis anteriores;
     - opcionalmente entrega a uma única pessoa online do SAC.
  3. A pessoa do SAC recebe o alerta.
- **Fontes:**
  - [VÍDEO TWCwnyCbUA8](https://www.youtube.com/watch?v=TWCwnyCbUA8)
  - [VÍDEO gTgfeZk8MzY](https://www.youtube.com/watch?v=gTgfeZk8MzY)
  - [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats)

### 2.6 Departamentos (setores)

- **O que faz:** grupos de usuários. Servem para três coisas:
  1. dar permissões de uma vez para várias pessoas;
  2. ser responsável por chats, que todos os membros passam a ver;
  3. montar rodízios por setor.
- **Quem usa:** a gestão cria; a atendente participa.
- **Fluxo da gestão:**
  1. Abre Usuários e depois a aba Departamentos.
  2. Dá um nome ao departamento.
  3. Escolhe os membros.
  4. Marca as permissões.
- **Regras:**
  - Uma pessoa pode estar em vários departamentos.
  - As permissões do departamento **se somam** às da pessoa.
  - Pode haver nomes repetidos.
  - O limite depende do plano: nenhum no Essencial, 3 no Performance e ilimitado no Profissional.
- **Fontes:**
  - [DOC Usuários](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios)
  - [VÍDEO 9gR5mpPvUxk](https://www.youtube.com/watch?v=9gR5mpPvUxk)
  - [SITE planos](https://chatguru.com.br/planos-e-precos/)

### 2.7 Status do atendimento e arquivamento

- **O que faz:** cada chat tem um status fixo:
  - **Aberto** (vermelho): a cliente escreveu e ninguém respondeu;
  - **Em atendimento** (roxo);
  - **Aguardando** (amarelo): esperando a cliente ou um retorno interno;
  - **Resolvido** (verde);
  - **Fechado** (azul): encerrado sem sucesso, por exemplo.

  Existe ainda um "**Indefinido**", para quando a abertura automática está desligada.
- **Quem usa:**
  - Atendente: troca o status à mão.
  - Robô: troca por regra.
  - Gestão: define as regras.
- **Fluxo típico:**
  1. A cliente escreve: o chat vai para **Aberto** e conta como "novo atendimento".
  2. A atendente responde pela plataforma: o chat passa sozinho para **Em atendimento**.
  3. Se ficou esperando um documento, a atendente põe **Aguardando**.
  4. No fim, põe **Resolvido** ou **Fechado**, e o chat é **arquivado** automaticamente.
  5. Se a cliente escrever de novo depois do tempo de "chat reiniciado" (padrão de 30 s, mínimo de 1 s), o chat volta para Aberto, sai dos arquivados e conta como novo atendimento. Um "Obrigado" mandado 20 s depois do fim não reabre.
- **Configurações da conta:**
  - ligar ou desligar os status;
  - abrir automaticamente os chats novos;
  - reabrir os chats reiniciados;
  - tempo para considerar o chat reiniciado;
  - arquivar sozinho em Resolvido ou Fechado;
  - passar para Em atendimento quando uma pessoa responde;
  - passar para Em atendimento quando o robô responde.
- **Limites:**
  - Não dá para renomear, mudar a cor ou criar status.
  - Não dá para impedir a atendente de trocar o status.
- **Pegadinha:** se a atendente responder pelo celular-servidor e não pela plataforma, o status **não muda**. A FAQ desaconselha usar o celular junto.
- **Provável erro de texto na wiki:** ela diz que, com a abertura automática "ativada", os novos chats iniciam como Indefinido. O sentido indica que isso acontece quando a opção está **desativada**.
- **Fontes:**
  - [DOC Atendimento](https://wiki.chatguru.com.br/modulos/atendimento)
  - [DOC Configurações da conta](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta)
  - [DOC FAQ](https://wiki.chatguru.com.br/duvidas-e-dicas/faq)
  - [VÍDEO "Módulo de atendimento"](https://www.youtube.com/watch?v=BIrk4U862kQ)
  - [JS] o status `INDEFINIDO` existe no código da lista

### 2.8 Leitura ("visto") e presença da equipe

- **Para a cliente:** a plataforma mostra os tiques do WhatsApp:
  - um tique cinza: enviada;
  - dois cinzas: entregue;
  - dois azuis: lida.

  O botão "**Reverificar leitura das mensagens**" busca de novo essa informação no celular. Desde 2021 também aparece se o **áudio foi ouvido** pela cliente.
- **Dentro da equipe ("não lida"):**
  - Abrir o chat tira o aviso de não lida.
  - "**Marcar como não lido**" devolve o chat ao topo da lista, sem som.
  - "Marcar como lido" tira o aviso à mão.
  - O robô tem a ação "**Leitura**", que põe ou tira esse aviso.
- **Modo espião:**
  - O administrador liga por usuário.
  - Quem está em modo espião abre conversas sem tirar o aviso de não lida, sem que as colegas percebam.
  - Uma opção extra faz as mensagens enviadas pelo espião zerarem o contador (desde julho de 2023).
  - O site vende o recurso como "acompanhe conversas em tempo real sem interferir".
- **Presença das atendentes:** a tela de Usuários mostra Logado/Deslogado, "Último acesso" e "Visto última vez". O relatório de Acessos tem o histórico.
- **Não documentado:** se abrir a conversa no ChatGuru manda o tique azul para a cliente. **Provável**, por ser conexão do tipo WhatsApp Web, que siga o comportamento do WhatsApp Web, mas não achei confirmação.
- **Fontes:**
  - [DOC Chats, "Mais opções"](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [DOC Usuários, "Modo espião"](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios)
  - [DOC 2022, nota de 29/11/2021](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2022)
  - [DOC 2023, 05/07](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)
  - [SITE](https://chatguru.com.br/produto/plataforma-chatguru/)

### 2.9 Anotações internas e menções (@)

- **O que faz:** nota dentro da conversa que **a cliente não vê**. Serve para deixar um recado de turno, registrar uma condição combinada ou passar o caso a alguém.
- **Quem usa:** atendente, gestão e o próprio robô. A transcrição de áudio e o resumo por IA também viram anotações.
- **Fluxo:**
  1. No chat, clica no ícone de anotação (ao lado do emoji) ou vai em Mais opções e depois "Escrever uma anotação".
  2. Digita o texto. Para chamar alguém, escreve **@ seguido do e-mail** da pessoa e escolhe na lista.
  3. Salva.
  4. A pessoa mencionada recebe um aviso no sino e **um e-mail** com o início do texto e o link do chat. Ela pode desligar o e-mail no próprio perfil.
  5. A mencionada pode responder com outra anotação mencionando de volta.
- **Onde consultar depois:**
  - aba **Histórico de anotações** do chat, com páginas e busca por texto;
  - **Relatório de anotações internas**, com filtro por autor, texto, número (até só o DDD) e período.

  Anotação **não pode ser apagada** pelo relatório. As do robô aparecem sem autor.
- **Fontes:**
  - [DOC Chats, "Anotações"](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [DOC Relatório de anotações](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/anotacoes-internas)
  - [VÍDEO "Treinamento para usuários"](https://www.youtube.com/watch?v=ngySgRzFlwU)
  - [VÍDEO gTgfeZk8MzY](https://www.youtube.com/watch?v=gTgfeZk8MzY)
  - [DOC 2023, 24/08](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)

### 2.10 O que fica guardado no painel do chat

- **Painel direito:**
  - nome, que dá para editar e afeta todos os usuários;
  - estrela de **favorito** (pessoal);
  - número, que pode ficar oculto conforme a permissão;
  - chave **Chatbot Sim/Não**;
  - chave **Arquivar Sim/Não**;
  - Responsável;
  - Tags;
  - Campos personalizados;
  - "Aparelho Origem", ou seja, qual número da empresa a cliente usa;
  - data de cadastro.
- **Abas de histórico:**
  - **status**: quem mudou, quando e quanto tempo ficou em cada um;
  - **anotações**;
  - **funil**;
  - **usuários delegados**;
  - **diálogos e contextos** do robô: as últimas 50 execuções; dá para apagar um contexto e "reiniciar" o robô para aquela cliente;
  - **NPS respondidos**;
  - **mídias**, separadas em Mídias, Documentos e Figurinhas, com download e o botão "mostrar na conversa".
- **Seta embaixo de cada mensagem:**
  - se o robô processou a mensagem e qual intenção ou diálogo ela ativou;
  - a hora em que a cliente enviou e a hora em que chegou ao servidor. Uma diferença grande indica problema no celular.
  - quem mandou: usuário, celular ou robô ("Não há detalhes").
  - "**Reprocessar mensagem**", para o robô "reler" a mensagem.
- **Fontes:**
  - [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [DOC Relatório de diálogos](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/dialogos)
  - [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k)
  - [VÍDEO 9gR5mpPvUxk](https://www.youtube.com/watch?v=9gR5mpPvUxk)

### 2.11 Carteira de clientes (carteirização)

- **O que faz:** liga cada cliente a uma atendente fixa. Quem volta a escrever cai com quem já conhece a história. A carteira pode ser **redistribuída** em férias, afastamentos ou mudanças na equipe.
- **Quem usa:** a gestão monta a carteira; a atendente atende a dela.
- **Fluxo:**
  1. A cliente entra na base.
  2. Uma responsável é definida.
  3. Nos próximos contatos, a conversa vai para ela.
  4. A gestão redistribui quando precisa.
- **Detalhes:** o site diz que é "recurso nativo" e não depende de integração. Só existe no plano Profissional. As automações prontas usam a carteira como alternativa ao rodízio ("via rodízio ou carteira").
- **Não documentado:** a tela e as regras exatas, por exemplo o que acontece se a dona da carteira está offline. **Provável:** é um "responsável fixo" guardado no chat, usado pelo robô na hora de delegar.
- **Fontes:**
  - [SITE "Carteirização de clientes"](https://chatguru.com.br/blog/solucoes/carteirizacao-de-clientes-no-whatsapp/)
  - [SITE planos](https://chatguru.com.br/planos-e-precos/)
  - [SITE "URA Avançada de Saúde"](https://chatguru.com.br/automacao/ura-saude/)
  - [SITE follow-up](https://chatguru.com.br/automacao/follow-up/)

### 2.12 Grupos do WhatsApp e listas de transmissão

- **Grupos:**
  - Aparecem e podem ser respondidos pela plataforma.
  - Cada mensagem mostra o nome de quem mandou (desde 06/01/2024).
  - Clicar no nome abre uma conversa particular com aquela pessoa.
  - A wiki recomenda deixar o **Chatbot = Não** nos grupos.
  - A API oficial não participa de grupos.
- **Listas de transmissão:** o filtro "Broadcasts" mostra as listas criadas no celular. Dá para executar um diálogo para enviar uma mensagem pela lista. Só recebe quem salvou o número da empresa, por isso a ChatGuru diz que é "mais segura" que uma campanha.
- **Permissão:** existe `CHAT_VIEW_GROUP_CHATS` [JS]. **Provável:** é "ver chats do departamento" (no código, "group" aparece como departamento), e não grupos do WhatsApp.
- **Fontes:**
  - [DOC Chats, "Grupos"](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [DOC 2024, 06/01](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024)
  - [DOC WABA](https://wiki.chatguru.com.br/whatsapp-business-api/whatsapp-business-api-waba)
  - [VÍDEO "Como criar campanhas"](https://www.youtube.com/watch?v=nO4ai205rOg)

### 2.13 Iniciar conversa com número novo ("Adicionar chats")

- **O que faz:** a atendente escreve para alguém que ainda não está na lista, sem pegar o celular.
- **Quem usa:** atendente com a permissão, que pode ser liberada número a número da empresa.
- **Fluxo:**
  1. Em Chats, clica em **Adicionar**.
  2. Preenche o nome e o número completo (país + DDD + número).
  3. Escolhe uma **resposta rápida** ou escreve a mensagem. No modo Web **a mensagem é obrigatória**; na API oficial é preciso executar um diálogo com template.
  4. Opcionalmente escolhe um diálogo do robô para rodar junto.
  5. Clica em Cadastrar.
  6. O chat nasce delegado a quem adicionou, sem passar pelo rodízio.
- **Validações:**
  - Corrige o nono dígito sozinho.
  - Recusa número sem WhatsApp ("O número informado não está cadastrado no WhatsApp", desde abril de 2025).
  - Não deixa adicionar o mesmo contato duas vezes, exceto pela API.
  - O contato **não** vai para a agenda do celular.
- **Acompanhamento:**
  - A tela mostra os 50 últimos chats adicionados nas últimas 24 h.
  - O resto fica no **Relatório de chats adicionados**, com status Pendente, Adicionando, Adicionado, Erro e Indiferente.
  - Dá "Tentar novamente" e "Limpar adições pendentes" em massa.
- **"Bloqueio de URA":** antes de puxar uma conversa ativa, a atendente executa um diálogo manual que põe o contexto `URA = Block` e o status Em atendimento. Assim o menu do robô não dispara quando a cliente responder.
- **Fontes:**
  - [DOC Adicionar chats](https://wiki.chatguru.com.br/modulos/adicionar-chats)
  - [DOC Relatório de chats adicionados](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/chats-adicionados)
  - [DOC Celulares](https://wiki.chatguru.com.br/sobre-o-sistema/celulares-whatsapp)
  - [DOC atualizações 2025](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-da-plataforma)
  - [VÍDEO "Addchat com resposta rápida e bloqueio de URA"](https://www.youtube.com/watch?v=nPH0JTeW1Jc)
  - [VÍDEO "Módulo Adicionar Chats"](https://www.youtube.com/watch?v=6BW0Lddl9_Y)

### 2.14 Notificações

- **Sino de alertas:** chat novo delegado à pessoa ou ao departamento dela e menções em anotações. Fica vermelho até a pessoa clicar, mesmo se ela estava offline (correção de 28/03/2025).
- **Sino de mensagens:** toda mensagem de chat em que a pessoa ou o departamento dela é responsável.
- **Sons:** há três, e só o administrador escolhe, valendo para todos:
  - alerta;
  - nova mensagem;
  - atualização do chat aberto.
- **Também há:**
  - **push** no computador, configurado por usuário;
  - **e-mail** nas menções;
  - aviso dentro do chat quando chega mensagem nova enquanto a pessoa lê o histórico (desde 30/06/2023);
  - contador na aba do navegador.
- **No WhatsApp pessoal da atendente:** com o número pessoal "linkado" ao usuário, a ação do robô **Encaminhar** manda um aviso direto no WhatsApp dela, com nome da cliente, link do chat, telefone, link wa.me e a mensagem. Os relatórios agendados também podem chegar por esse WhatsApp.
- **Fontes:**
  - [DOC Chats, "Barra superior"](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [DOC Configurações da conta, "Notificações"](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta)
  - [VÍDEO "Encaminhamento de mensagem através do ChatGuru"](https://www.youtube.com/watch?v=Pe_UrVgi5Bk)
  - [DOC 2025, 28/03](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-da-plataforma)

---

## 3. Chatbot (Diálogos)

Exige o **módulo Chatbot**. Cada número da empresa tem o seu robô, com os próprios diálogos.
Fontes:
- [DOC Chatbot](https://wiki.chatguru.com.br/modulos/chatbot)
- [DOC Diálogos/Chatbot](https://wiki.chatguru.com.br/sobre-o-sistema/dialogos-chatbot)
- [VÍDEO "Como cadastrar um novo diálogo"](https://www.youtube.com/watch?v=VMvKRbOzxbw)

### 3.1 Como um diálogo é montado

Um diálogo junta quatro partes:
1. **gatilhos**: quando ele dispara;
2. **ações**: o que ele faz;
3. **contexto de saída**: a "marca" que ele deixa no chat;
4. **configurações**.

A **ordem da lista define a prioridade**: o diálogo de cima vence. Os gatilhos **só reagem ao que a cliente faz**. Mensagem da equipe nunca dispara o robô; para isso existe a execução manual.

**Fluxo da gestão:**
1. Abre "Diálogos/Chatbot" e clica em "+".
2. Dá um título e escolhe um grupo, que só serve para organizar a lista.
3. Adiciona os gatilhos.
4. Adiciona as ações. **Cada ação nasce "Desligada"** e precisa ser ligada.
5. Ajusta as configurações.
6. Clica em "Salvar alterações".
7. O botão "copiar" duplica um diálogo, o que é útil para montar submenus.

### 3.2 Gatilhos (lista completa)

| Gatilho | Dispara quando a cliente… |
|---|---|
| Texto exato | manda exatamente aquele texto. Desde 03/2024 aceita emojis |
| Palavra | manda algo que contém a palavra |
| Intenção | manda algo parecido com um grupo de palavras e frases (ver 3.7) |
| Entidade | usa uma palavra de uma lista de sinônimos ou um padrão (ver 3.7) |
| Contexto | está com uma marca específica (ver 3.6) |
| Dia/Hora | interage em certo dia da semana, horário, dia específico do ano, hora, minuto, dia do mês ou dia/mês |
| Status do chat | interage enquanto o chat está em certo status (exige o módulo Atendimento) |
| Novo chat | é a primeira interação |
| Número inicial do chat | tem número começando com certos dígitos, por exemplo um DDD |
| Ligação perdida | tenta ligar pelo WhatsApp |
| Email / Possui algum email | manda só um e-mail, ou um texto que contém um e-mail |
| Telefone/Celular, CEP, CPF, CNPJ | manda uma sequência de números nesse formato |
| Data | manda uma data |
| Áudio, Foto/Imagem, Vídeo, Documento | manda esse tipo de arquivo |
| Msg Incompleta | manda uma mensagem que o WhatsApp não carregou |
| Qualquer coisa | manda qualquer mensagem |

**Operadores:** parênteses, **AND** (obrigatório), **OR** (opcional) e **NOT** (negação). Existe também um campo "Condições adicionais" para escrever a regra por extenso, como `current_time<09:00 or current_time>=19:00`. Esse campo não cria tipos novos de gatilho.

Fontes:
- [DOC Diálogos/Chatbot](https://wiki.chatguru.com.br/sobre-o-sistema/dialogos-chatbot)
- [DOC 2024, 19/03](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024)
- [VÍDEO "Como configurar diálogo de feriado" (2025)](https://www.youtube.com/watch?v=ARCPt2qUor0)

### 3.3 Ações (lista completa)

| Ação | O que faz |
|---|---|
| Responder | Manda uma mensagem. Aceita as variáveis das respostas rápidas |
| Anexar | Manda um arquivo da biblioteca |
| Encaminhar | Manda um aviso para o **WhatsApp pessoal** de um usuário, com nome, link do chat, telefone, link wa.me e a mensagem da cliente |
| Delegar | Põe ou tira usuários e departamentos. Pode remover os outros e entregar a 1 pessoa do setor, preferindo quem está online |
| Tag | **Só adiciona** uma tag; não remove |
| Funil | Põe numa etapa ou, desde 07/2024, **tira** do funil |
| Anotação | Escreve uma nota interna |
| Leitura | Marca o chat como lido ou não lido |
| Diálogo | Chama outro diálogo |
| Status | Muda o status |
| NPS | Manda a pesquisa |
| CRM | **Post para URL** (webhook) para outro sistema (ver 3.11) |
| Campo Personalizado | Grava a resposta da cliente num campo da ficha |
| Renomear Chat | Usa a resposta da cliente como nome do chat |
| Template, Lista interativa, Mensagem interativa, Catálogo | Só na API oficial (ver 3.14) |

As ações rodam **de cima para baixo**, e dá para arrastar para mudar a ordem.
Fontes:
- [DOC Chatbot](https://wiki.chatguru.com.br/modulos/chatbot)
- [DOC 2023, 30/06](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)
- [VÍDEO Pe_UrVgi5Bk](https://www.youtube.com/watch?v=Pe_UrVgi5Bk)
- [VÍDEO TWCwnyCbUA8](https://www.youtube.com/watch?v=TWCwnyCbUA8)

### 3.4 Ajustes de cada ação

- **Status:** liga ou desliga a ação sem apagá-la.
- **Execução:**
  - **automática**; ou
  - **aguardando aprovação**: a mensagem fica pendente até uma pessoa liberar, e é a "fila de aprovação".
- **Atraso:** segundos depois do disparo. Um relógio converte, por exemplo "3 dias", em segundos. O atraso vale para a **ação**, não para o diálogo. Exemplo da wiki: mandar um texto longo e, 20 minutos depois, "Você concorda com o texto acima?".
- **Janela de envio** [VÍDEO, legenda automática]:
  - "evitar determinado horário": se passar das 20h, envia no dia seguinte às 10h;
  - "fim de semana": no sábado e no domingo não envia e joga para segunda-feira.
- **Na tela do chat:** as ações atrasadas aparecem como **agendadas**, com "Executar" e "Cancelar".
- **Fontes:**
  - [DOC Chatbot, "Ações"](https://wiki.chatguru.com.br/modulos/chatbot)
  - [VÍDEO VMvKRbOzxbw](https://www.youtube.com/watch?v=VMvKRbOzxbw)

### 3.5 Configurações do diálogo

| Configuração | Para que serve |
|---|---|
| Tipo **Padrão** | Dispara pelos gatilhos, roda uma vez por mensagem da cliente e espera a próxima. É o usado em perguntas de menu |
| Tipo **Contínuo** | Roda e deixa o próximo diálogo que também casar rodar em seguida. Exemplo: pôr uma tag em todo chat novo **e** mostrar o menu |
| Tipo **Manual** | Só roda quando uma pessoa aciona ou quando outro diálogo, a API ou uma campanha chama |
| Invocável | Aparece ou não na lista de "Acionar um diálogo" das atendentes |
| Máximo de execuções | Limite por chat. Exemplo: o menu só uma vez. Execução manual ignora o limite |
| Intervalo mínimo | Segundos entre duas execuções no mesmo chat. Para mensagem fora do horário, o costume é 600 s, assim 3 mensagens seguidas recebem um só aviso |
| Certificar contexto | Mesmo acionado à mão, o diálogo só roda se o chat casar com os gatilhos. Exemplo: "Encerrar" só se estiver Em atendimento |
| Restringir a usuários/departamentos | Quem pode ver e acionar o diálogo |
| Grupo | Organização visual da lista |
| Condições adicionais | Gatilhos escritos por extenso |

As ações "Campo Personalizado" e "Renomear Chat" só funcionam em diálogo Padrão ou Contínuo disparado por gatilho.
Fontes:
- [DOC Chatbot](https://wiki.chatguru.com.br/modulos/chatbot)
- [DOC 2023, 30/06](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)

### 3.6 Contextos (a "memória" que monta menus)

- **O que faz:** uma marca `variável = valor` gravada no chat, por exemplo `URA = Departamento`. Serve de gatilho para o passo seguinte.
- **Padrão ensinado pelo suporte:**
  - "por padrão as URAs funcionam com true para início de atendimento ou false para fim de atendimento, e os números para as etapas" [VÍDEO nPH0JTeW1Jc];
  - a mensagem inicial grava `URA = True`, que o suporte chama de "ponto zero";
  - a opção 1 exige `URA = True` **e** o texto "1", e grava `URA = 1`;
  - o submenu 1.1 exige `URA = 1` e o texto "1", e grava `URA = 1.1`;
  - no fim do atendimento, grava-se `URA = False`;
  - para o robô ficar quieto, grava-se `URA = Block`, um valor que nenhum diálogo usa.

  As legendas automáticas escrevem "true" como "outro" ou "urato". **Provável:** o valor gravado é mesmo `True`.
- **Regras:**
  - O valor não pode ser `0`, `null` ou `None`, que o robô lê como vazio.
  - `None` significa "nunca recebeu essa marca".
  - É preciso **atualizar** o contexto a cada passo, senão o robô fica "preso".
  - Um diálogo pode gravar vários contextos, desde que sejam variáveis diferentes.
  - O contexto precisa existir antes de aparecer como gatilho.
- **Pela API:** `chat_update_context` grava contextos.
- **Fontes:**
  - [DOC Chatbot, "Contextos"](https://wiki.chatguru.com.br/modulos/chatbot)
  - [VÍDEO "Como criar uma URA com sub níveis"](https://www.youtube.com/watch?v=NBgAlZLZdFo)
  - [VÍDEO nPH0JTeW1Jc](https://www.youtube.com/watch?v=nPH0JTeW1Jc)

### 3.7 Intenções e entidades (entender o que a cliente escreveu)

- **Intenção:** título, palavras-chave e frases de exemplo. A pontuação funciona assim:
  - palavra-chave: 10;
  - frase parecida com um exemplo: 2;
  - frase idêntica a um exemplo: 100.

  Cada intenção tem uma "pontuação mínima" para disparar. Pelo chat, dá para adicionar a mensagem da cliente como nova frase de exemplo.
- **Entidade:** nome, descrição e lista de **sinônimos**, por exemplo "preço", "valor", "custo", "valores". Também aceita **padrões** (expressão regular), por exemplo "11 dígitos". Não tem pontuação e só dispara com a palavra exata.
- **Uso no exemplo de restaurante:** a cliente digita "endereço" em vez de "3", e o robô entende. Ela digita "pizza de provolone" e o robô manda foto e preço [VÍDEO](https://www.youtube.com/watch?v=2p_P-ZQPzKw).
- **Origem técnica:** ontem vimos o campo `watson_response`, sinal de que esse motor nasceu ligado ao IBM Watson ([engenharia reversa](../chatguru-engenharia-reversa.md)).
- **Fontes:**
  - [DOC Chatbot, "Intenções" e "Entidades"](https://wiki.chatguru.com.br/modulos/chatbot)
  - [VÍDEO intenções](https://www.youtube.com/watch?v=e_O9iMIHaNM)
  - [VÍDEO entidades](https://www.youtube.com/watch?v=AYFYB7NhxKE)

### 3.8 Menu de boas-vindas (URA), passo a passo

- **Quem usa:** a gestão monta, a cliente navega e a atendente recebe a conversa já triada.
- **Fluxo da gestão,** como no vídeo oficial:
  1. **Diálogo "Boas-vindas"** (Padrão), com o gatilho "Novo chat" ou "Qualquer coisa" + status Aberto. Ação Responder: "Bom dia! 1 Vendas, 2 Financeiro". Contexto de saída `URA = True`. Máximo de execuções baixo e intervalo mínimo.
  2. **Diálogo "Opção 1"**, com gatilhos `URA = True` AND texto exato "1". Ações:
     - Responder com o submenu ou "Vou te passar para Vendas";
     - Delegar para o departamento Vendas;
     - Status;
     - Anotação "quer Vendas".

     Contexto de saída `URA = 1`.
  3. Copia o diálogo 1 e ajusta a cópia para "2", "1.1", "1.2" e assim por diante.
  4. Opcional: um **diálogo "voltar ao menu"**. O roteiro do restaurante sempre oferece "voltar", para a cliente não ficar perdida.
- **Fluxo da cliente:** escreve "oi", recebe o menu, digita "1" (ou "vendas", se houver intenção), recebe a confirmação e espera a atendente.
- **Fluxo da atendente:** recebe o alerta no sino. O chat chega delegado, com tag e anotação.
- **Fontes:**
  - [VÍDEO NBgAlZLZdFo](https://www.youtube.com/watch?v=NBgAlZLZdFo)
  - [VÍDEO "Funcionamento do Chatbot"](https://www.youtube.com/watch?v=Z2GAnD2WorU)
  - [VÍDEO restaurante](https://www.youtube.com/watch?v=2p_P-ZQPzKw)
  - [VÍDEO hotel](https://www.youtube.com/watch?v=lvpRPfJa6Iw)
  - [VÍDEO imobiliária](https://www.youtube.com/watch?v=G07YfL6YiQE)

### 3.9 Horário de atendimento, mensagem fora do horário e feriados

- **Não existe uma tela de "horário de funcionamento".** Tudo é feito com um diálogo com gatilho **Dia/Hora**.
- **Fora do horário,** exemplo da wiki: `(current_time<09:00 OR current_time>=19:00) OR sunday OR (saturday AND current_time>=13:00)`. Diálogo Padrão, não invocável, com intervalo mínimo de 600 s. Ação Responder com o aviso. Opcionalmente, Tag e Anotação.
- **Feriado de uma data:** gatilho Dia/Hora com "Dia específico". Feriado **fixo todo ano**: "Dia/Mês" (Natal = 25/12). O vídeo de 2025 sugere máximo de execuções alto e intervalo de 120 a 1800 s.
- **Horário de almoço:** `current_time>=12:00 AND current_time<13:00`.
- **Fontes:**
  - [DOC Chatbot, exemplo e "Materiais complementares"](https://wiki.chatguru.com.br/modulos/chatbot)
  - [VÍDEO feriado 2025](https://www.youtube.com/watch?v=ARCPt2qUor0)
  - [VÍDEO feriado 2021](https://www.youtube.com/watch?v=roW6XIa1GwA)
  - [SITE "Avisos automáticos de ausência"](https://chatguru.com.br/produto/plataforma-chatguru/)

### 3.10 Coleta de dados pelo robô

- **Como funciona:** o robô pergunta, por exemplo "Qual seu e-mail?", e grava o contexto `etapa = email`. O diálogo seguinte tem os gatilhos `etapa = email` AND "Email". Ele faz duas coisas:
  1. usa a ação **Campo Personalizado** para gravar a resposta na ficha;
  2. muda o contexto para a próxima pergunta.
- **Gatilhos de validação:** e-mail, CPF, CNPJ, CEP, telefone e data. Entidade com padrão também valida, por exemplo o código do quarto no hotel.
- **"Renomear Chat":** usa a resposta da cliente como nome do chat. Serve para quem tem emoji no nome do WhatsApp.
- **Exemplo de integração:** e-mail capturado vai por Post para URL até o Make e de lá para o Google Sheets [VÍDEO](https://www.youtube.com/watch?v=j8kUSybSOUE).
- **Fontes:**
  - [DOC Diálogos/Chatbot](https://wiki.chatguru.com.br/sobre-o-sistema/dialogos-chatbot)
  - [DOC 2023](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)
  - [VÍDEO hotel](https://www.youtube.com/watch?v=lvpRPfJa6Iw)

### 3.11 Post para URL (webhook de saída)

- **O que faz:** a ação **CRM → "Post para URL"** manda um JSON para outro sistema quando o diálogo roda. Exige os módulos **API e Chatbot**.
- **Conteúdo do JSON:**
  - dados do chat: nome, número, tags, campos personalizados, contexto do robô, responsável (nome e e-mail), link do chat, data de cadastro, `chat_id` e `phone_id`;
  - a **mensagem que disparou**, com tipo e link do arquivo se for mídia;
  - campos livres: "campanha_id", "campanha_nome" e "origem".
- **Reenvio:** se o destino falhar, tenta até 12 vezes com intervalo crescente (desde 29/11/2021).
- **Não manda:** histórico, anotações ou mensagens da equipe. Os gatilhos só reagem à cliente.
- **Uso típico:** contar quantas clientes escolhem cada setor numa planilha [VÍDEO](https://www.youtube.com/watch?v=DVc-RpZGM1Y), capturar e-mail e consultar CEP/CNPJ [VÍDEOS](https://www.youtube.com/watch?v=NWOFb8qN2N0).
- **Fontes:**
  - [DOC API, "Post do ChatGuru para URL personalizada"](https://wiki.chatguru.com.br/documentacao-api/parametros-obrigatorios)
  - [DOC 2022 (nota de 2021)](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2022)
  - [DOC 2023, 29/05](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)

### 3.12 Uso manual do robô pela atendente

- **Acionar:** no topo do chat, "Acionar um diálogo", busca pelo nome e Executar. Exemplos: "Encerrar atendimento", "Encaminhar para SAC", "Pedir avaliação".
- **Agendar um diálogo:** em vez de executar, escolhe data e hora. O diálogo fica "aguardando", com Executar e Cancelar. No exemplo do hotel, a atendente agenda "boas-vindas ao hóspede" para o dia do check-in e "fim da estadia" para o check-out. **Provável:** é o mesmo mecanismo das mensagens agendadas.
- **Chatbot Sim/Não:** chave no painel do chat que desliga o robô só para aquela cliente. É útil para grupos e para casos delicados.
- **Reprocessar mensagem:** se o celular caiu e o robô não leu a resposta, a atendente manda o robô reler a mensagem.
- **Permissões envolvidas:**
  - executar diálogo (vem ligada por padrão);
  - ver o processamento da mensagem;
  - reprocessar;
  - ligar e desligar o robô no chat;
  - apagar ações e diálogos (desde 08/2023).
- **Fontes:**
  - [DOC Chats, "Acionar um diálogo"](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [VÍDEO VMvKRbOzxbw](https://www.youtube.com/watch?v=VMvKRbOzxbw)
  - [VÍDEO hotel](https://www.youtube.com/watch?v=lvpRPfJa6Iw)
  - [VÍDEO 9gR5mpPvUxk](https://www.youtube.com/watch?v=9gR5mpPvUxk)

### 3.13 Receitas prontas que o suporte ensina

| Receita | Como é feita | Fonte |
|---|---|---|
| **Alerta de cliente parada no menu** | Diálogo "timer" (com gatilho `URA = True`, ou seja, ainda não escolheu nada) que delega a alguém, reenvia o menu ou encerra. No diálogo de boas-vindas entra a ação "Diálogo: timer" com **atraso de 1 h**. Dá para encadear vários lembretes | [VÍDEO X-P0wNWLeNE](https://www.youtube.com/watch?v=X-P0wNWLeNE) |
| **Aviso de lead novo no celular da atendente** | Ação Encaminhar no diálogo de boas-vindas. Exige o número pessoal linkado ao usuário | [VÍDEO Pe_UrVgi5Bk](https://www.youtube.com/watch?v=Pe_UrVgi5Bk) |
| **Encerrar atendimento** | Diálogo manual que faz cinco coisas: (1) responde "Atendimento finalizado"; (2) põe numa etapa do funil; (3) muda para Resolvido (com atraso de 10 s, para a mensagem sair antes); (4) escreve uma anotação; (5) arquiva | [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats), [VÍDEO VMvKRbOzxbw](https://www.youtube.com/watch?v=VMvKRbOzxbw) |
| **Origem do lead** | Link wa.me com texto pronto ("Vi seu perfil no Instagram…"). O gatilho Texto exato responde e põe a tag "Instagram" | [VÍDEO OifrhCzfWxs](https://www.youtube.com/watch?v=OifrhCzfWxs) |
| **Feedback pós-serviço ao gestor** | Ao fim da estadia, o robô pede a opinião. A resposta vai por Encaminhar para o WhatsApp do supervisor, com o link do chat. Tag e etapa de funil "estadia finalizada" | [VÍDEO hotel](https://www.youtube.com/watch?v=lvpRPfJa6Iw) |
| **Bloqueio do robô** | `URA = Block` (ver 2.13) | [VÍDEO nPH0JTeW1Jc](https://www.youtube.com/watch?v=nPH0JTeW1Jc) |

### 3.14 Recursos só da API oficial (WABA)

- **Template:** mensagem pré-aprovada pela Meta. É **obrigatória para puxar conversa** quando já passaram 24 h da última mensagem da cliente.
  - Tem até 4 variáveis (`{{1}}`…`{{4}}`), que podem receber `{PRIMEIRO_NOME_LEAD}` ou um campo personalizado.
  - Pode ter botões "Resposta rápida" ou "Chamada para ação" (link ou telefone).
  - Aceita mídia desde 08/2024.
  - Categorias: Marketing, Utilidade, Autenticação e Serviço.
  - Fluxo: criar na tela Celulares, depois "Ver templates" e "Criar". Em seguida, "Sincronizar" até aparecer Aprovado. Depois é usado num diálogo (ação Template) ou à mão: Mais opções e "Enviar mensagem de template".
  - Desde 04/2025, os templates de marketing podem ser bloqueados por número.
  - Template em número Web dá erro.
- **Lista interativa:** botão que abre uma lista de opções. Só funciona com a sessão de 24 h aberta e é gratuita.
- **Mensagem interativa:** imagem, vídeo, PDF ou texto com até 3 botões, desde 11/2024. Não abre sessão.
- **Catálogo:** 1 ou até 30 produtos do Gerenciador de Comércio da Meta, desde 05/2025.
- **Saldo e extrato:** consumo de créditos na tela Celulares.
- **Fontes:**
  - [DOC WABA](https://wiki.chatguru.com.br/whatsapp-business-api/whatsapp-business-api-waba)
  - [DOC "Configurações WABA via ChatGuru"](https://wiki.chatguru.com.br/whatsapp-business-api/utilizando-o-waba/configuracoes-waba-via-chatguru)
  - [DOC atualizações 2025](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-da-plataforma)
  - [DOC 2024](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024)

### 3.15 Menu de atendimento "falado"

- **O que é:** o site vende um menu em que a cliente "recebe orientações **em áudio** sobre os caminhos disponíveis" e escolhe a opção.
- **Não documentado:** como se monta. **Provável:** é um diálogo comum cuja ação Anexar manda um áudio gravado como mensagem de voz (truque `_ptt_guru`, ver 4.2), seguido do menu em texto.
- **Fonte:** [SITE "Menu de atendimento falado"](https://chatguru.com.br/blog/solucoes/menu-de-atendimento-falado-no-whatsapp/)

---

## 4. Mensagens

### 4.1 Respostas rápidas

- **O que faz:** textos prontos acionados por atalho.
- **Quem usa:**
  - Atendente: cada uma cria as **suas**, e elas não aparecem para as colegas.
  - Administrador: **copia** respostas para uma ou várias pessoas. Se o atalho for igual, a cópia **sobrescreve** a resposta da pessoa, e assim o admin padroniza a equipe.
- **Fluxo da atendente:**
  1. No menu Respostas rápidas, cria um atalho, por exemplo "boasvindas". Desde 05/2024 o atalho aceita acentos e espaços.
  2. Escreve o texto com emojis e variáveis.
  3. No chat, digita **"/"** e escolhe.
  4. As variáveis são trocadas na hora do envio.
- **Variáveis:**
  - `{DAY_GREETING}` (Bom dia, Boa tarde ou Boa noite);
  - `{PRIMEIRO_NOME_LEAD}`;
  - `{NOME_LEAD}`;
  - `{MSG_TEXT}` (a última mensagem da cliente, mais usada no robô);
  - `{CHAT_LINK}`;
  - `{TELEFONE_LEAD}`;
  - `{LINK_WHATSAPP}`;
  - `{NomeDoCampo}` (qualquer campo personalizado, escrito sem acento).
- **Gestão da lista:** dá para apagar em massa.
- **Não documentado:** resposta rápida com **anexo**. Os arquivos ficam na Biblioteca (4.2).
- **Fontes:**
  - [DOC Respostas rápidas](https://wiki.chatguru.com.br/sobre-o-sistema/respostas-rapidas)
  - [VÍDEO H4CZoX0I0bw](https://www.youtube.com/watch?v=H4CZoX0I0bw)
  - [VÍDEO ngySgRzFlwU](https://www.youtube.com/watch?v=ngySgRzFlwU)
  - [DOC 2023, 29/05](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)
  - [DOC 2024, 22/05](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024)

### 4.2 Biblioteca de arquivos e áudio pré-gravado

- **O que faz:** pasta compartilhada pela equipe, com catálogo, tabela de preços, vídeos e áudios explicativos.
- **Fluxo:**
  1. No menu Arquivos, ou no clipe dentro do chat, a pessoa sobe o arquivo e põe uma **tag de arquivo**.
  2. No chat, clica no clipe, depois em "Anexar um arquivo", filtra pela tag e envia.
  3. Também dá para arrastar ou colar um arquivo do computador sem salvar na biblioteca.
- **Regras:**
  - Limite de 15 MB por arquivo.
  - Não há pastas.
  - Só imagem e vídeo aceitam legenda.
  - O robô pode mandar os arquivos (ação Anexar).
  - Há permissões próprias.
- **Áudio pré-gravado como "mensagem de voz":** basta o nome do arquivo terminar em `_ptt_guru.opus` ou `_ptt_guru.ogg`. A ChatGuru apresenta isso como diferencial: a cliente vê como áudio gravado na hora, e não como arquivo de música.
- **Fontes:**
  - [DOC Arquivos](https://wiki.chatguru.com.br/sobre-o-sistema/arquivos)
  - [DOC Chats, "Anexar"](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [SITE blog áudio pré-gravado](https://chatguru.com.br/blog/arquivo-de-mensagem-de-voz-pre-gravada-conheca-um-dos-diferenciais-do-chatguru/)
  - [DOC 2022 (nota de 2021)](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2022)

### 4.3 Mensagem agendada

- **O que faz:** programa uma mensagem de **texto ou áudio** (áudio desde 08/2023) para uma data e hora.
- **Quem usa:** atendente com a permissão "Agendar mensagem".
- **Fluxo:**
  1. Escreve a mensagem, ou grava o áudio.
  2. Clica no **relógio** ao lado da caixa de texto e escolhe dia e hora.
  3. Envia.
  4. A mensagem aparece num quadro "agendadas" dentro do chat, com **Executar** (manda agora) e **Cancelar**.
  5. Ela só sai se o celular-servidor estiver conectado (modo Web).
- **Onde achar depois:**
  - filtro "**Agendados**" na lista de chats;
  - **Relatório de mensagens** com status "Agendada", onde também dá para cancelar;
  - pela API, `message_send` com `send_date`.
- **Fontes:**
  - [DOC Chats, "Agendar mensagem"](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [VÍDEO z5rfZtgRNiA](https://www.youtube.com/watch?v=z5rfZtgRNiA)
  - [DOC Relatório de mensagens](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/mensagens)
  - [DOC 2023](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)

### 4.4 Tipos de mensagem e limites

| Tipo | Web | API oficial | Fonte |
|---|---|---|---|
| Texto, emojis e formatação do WhatsApp (`*negrito*`) | sim | sim | [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats), [VÍDEO](https://www.youtube.com/watch?v=VMvKRbOzxbw) |
| Áudio gravado na plataforma (o navegador pede o microfone) | sim | sim | [VÍDEO gTgfeZk8MzY](https://www.youtube.com/watch?v=gTgfeZk8MzY) |
| Foto, vídeo, documento (até 15 MB pela biblioteca) | sim | sim, e recebe até 100 MB | [DOC Arquivos](https://wiki.chatguru.com.br/sobre-o-sistema/arquivos), [DOC 2024](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024) |
| Figurinhas da coleção | não | sim (desde 05/2024) | [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats) |
| Enviar a localização atual | não | sim | [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats) |
| Receber contato e localização | aparecem na lista como "Contato" e "Localização" | — | [JS] |
| Mensagens que citam produto do catálogo | aparecem (desde 10/2023) | catálogo pelo robô | [DOC 2023](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023) |

### 4.5 Responder, encaminhar e reações

- **Responder citando:** passa o mouse sobre a mensagem e clica na seta para a esquerda. A wiki lista "responder mensagem selecionada" como algo que a API oficial **não** tem.
- **Encaminhar:**
  1. Seta para a direita.
  2. Marca as mensagens.
  3. Escolhe os chats de destino.
  4. "Encaminhar".

  O limite de destinos é configurável. A wiki cita "até 20" e alerta que a Meta pode ver isso como spam. A mensagem recebida mostra "Encaminhada".
- **Reações:** a atendente reage e vê as reações da cliente **só na API oficial** (desde 08/2024).
- **Fontes:**
  - [DOC Chats, itens 12 a 14](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [DOC WABA](https://wiki.chatguru.com.br/whatsapp-business-api/whatsapp-business-api-waba)
  - [DOC Configurações da conta](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta)

### 4.6 Ligações

- **O que faz:** ligações de voz da cliente pelo WhatsApp ficam registradas no chat como **atendida** ou **perdida** (diferenciação desde 06/2025). Na lista, aparece "Ligação Perdida".
- **Robô:** o gatilho "**Ligação perdida**" permite responder sozinho, por exemplo "Vi que você ligou, como posso ajudar?".
- **Não documentado:** fazer ou atender ligação pela plataforma. A API oficial "não tem chamadas de voz" segundo a wiki. Para ligação, o site oferece integração de telefonia (Calix e Zenvia "nativos", iBot "via integração").
- **Fontes:**
  - [DOC atualizações 10/06/2025](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-da-plataforma)
  - [DOC gatilhos](https://wiki.chatguru.com.br/sobre-o-sistema/dialogos-chatbot)
  - [DOC WABA](https://wiki.chatguru.com.br/whatsapp-business-api/whatsapp-business-api-waba)
  - [SITE "Telefonia integrada"](https://chatguru.com.br/blog/solucoes/telefonia-integrada-ao-whatsapp/)
  - [JS]

### 4.7 Mensagens apagadas e editadas

- **A cliente apagou:** aparece "Essa mensagem foi apagada pelo remetente" (sincronização corrigida em 08/2023).
- **A cliente editou:** a mensagem é atualizada e ganha a marca "**Editada**" (desde 03/2024). O botão "Recarregar mensagens recentes editadas" força a atualização. Na API oficial, a Meta não repassa edições.
- **A equipe:**
  - "**Apagar todas as mensagens**" só limpa o chat **dentro da plataforma** e não mexe no celular.
  - Mensagens na fila ou agendadas podem ser apagadas no Relatório de mensagens.
- **Não documentado:** editar uma mensagem já enviada, ou apagar para todos, a partir da plataforma.
- **Fontes:**
  - [DOC 2023, 03/08](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)
  - [DOC 2024, 19/03](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024)
  - [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [VÍDEO relatório de mensagens](https://www.youtube.com/watch?v=VBSnTKx6Qko)

### 4.8 Nome da atendente para a cliente

- **O que faz:** cada usuário pode ter um "**Nome visível para o cliente**", que vai como assinatura em cada mensagem que ele manda. A gestão liga ou desliga por usuário.
- **Não documentado:** o formato exato da assinatura.
- **Fontes:**
  - [DOC Usuários](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios)
  - [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k)
  - [SITE blog "nome do atendente"](https://chatguru.com.br/blog/como-colocar-nome-do-atendente-no-whatsapp-business/)

### 4.9 IA: transcrição de áudio e resumo da conversa

- **Transcrição:**
  - Transcreve **todos** os áudios recebidos, sozinha, numa anotação logo abaixo do áudio.
  - A busca é feita pelo relatório de anotações.
  - Fluxo da gestão:
    1. Contratar o módulo.
    2. Criar uma conta na OpenAI com créditos (mínimo de US$ 5).
    3. Colar a chave em Configurações → "Inteligência Artificial".
    4. Ligar "Permitir que todos os áudios recebidos sejam transcritos".
- **Resumo:**
  - Só o **administrador** usa: Mais opções, "Criar resumo do chat", escolher últimas 24 h ou 7 dias.
  - Em segundos, o resumo aparece como anotação.
  - Exige a chave OpenAI própria e a opção "Permitir que todos os chats possam ser resumidos".
- **Posição oficial:** "A ChatGuru não possui um modelo próprio de inteligência artificial". Se os créditos da OpenAI acabam, a transcrição para.
- **Fontes:**
  - [DOC Transcrições](https://wiki.chatguru.com.br/modulos/transcricoes)
  - [DOC Resumo de chats](https://wiki.chatguru.com.br/modulos/resumo-de-chats)
  - [VÍDEO 1su80-m60is](https://www.youtube.com/watch?v=1su80-m60is)
  - [VÍDEO gkhQoA0zPU0](https://www.youtube.com/watch?v=gkhQoA0zPU0)
  - [SITE blog agente de IA](https://chatguru.com.br/blog/como-configurar-agente-ia-whatsapp/)

---

## 5. Campanhas, listas, etiquetas, campos, funil e tarefas

### 5.1 Campanhas (disparo em massa)

- **O que faz:** roda **um diálogo** em todos os chats de uma lista filtrada. Pode mandar mensagem ou arquivo, ou só fazer uma mudança interna, como pôr tag, mudar status, trocar responsável ou mover no funil. Exige o módulo Chatbot.
- **Quem usa:** a gestão, ou atendentes com permissão.
- **Fluxo:**
  1. Cria antes o diálogo da campanha (ver 3.1).
  2. Em Campanhas, clica em "Nova campanha" e confirma o aviso de banimento ("Entendo o risco… Quero continuar").
  3. Preenche nome, descrição, **data de início** (ou começa na hora), **intervalo entre disparos** e diálogo.
  4. Monta a lista de contatos com os filtros (abaixo) e clica em "Filtrar contatos". Mostra, por exemplo, "44 chats".
  5. Pode tirar chats da lista antes de começar.
  6. Salva. A campanha fica "agendada", com "começar agora" ou "cancelar".
  7. Acompanha o progresso na lista de campanhas.
- **Filtros de contatos:**
  - tem ou não tem tags;
  - data de cadastro;
  - mais ou menos de X dias sem interagir, sem receber ou sem enviar mensagem;
  - nome contém (mínimo de 4 letras);
  - etapa do funil;
  - arquivado;
  - status;
  - tem mensagem não lida;
  - tem mensagem agendada;
  - delegado a pessoas ou a departamento;
  - número da empresa ("Aparelho");
  - robô ligado ou desligado.
- **Regras:**
  - **Uma campanha por vez.**
  - Não dá para apagar depois de começar; só **pausar**.
  - Não dá para editar os filtros depois de salva.
  - Dá para **arquivar** campanhas antigas e ver os filtros usados nas anteriores.
  - Desde 02/2023 os disparos são "independentes do aparelho". **Provável:** a fila fica no servidor e sai quando o celular conecta.
  - Só manda para chats que **já existem** na plataforma.
- **Ritmo,** onde as fontes divergem:
  - "intervalo de 3 a 6 minutos entre cada disparo" e "o tempo padrão é de 180 segundos", ajustável [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/campanhas);
  - "2 a 3 minutos" [VÍDEO](https://www.youtube.com/watch?v=nO4ai205rOg);
  - "limite diário e cadência de 3 envios por segundo" [SITE planos](https://chatguru.com.br/planos-e-precos/).

  **Provável:** os 3 por segundo valem para a API oficial, e os minutos para o número Web.
- **Fontes:**
  - [DOC Campanhas](https://wiki.chatguru.com.br/sobre-o-sistema/campanhas)
  - [DOC 2023, 16/02](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)
  - [VÍDEO nO4ai205rOg](https://www.youtube.com/watch?v=nO4ai205rOg)

### 5.2 Listas: transmissão e importação

- **Lista de transmissão:** ver 2.12.
- **Importação por CSV:** o site diz que se sobe uma planilha CSV com até **10.000 contatos** e eles passam a fazer parte da base. O recurso aparece em todos os planos.
- **Não documentado:** a tela, as colunas aceitas e se a importação manda mensagem. Pela regra do "Adicionar chats" (mensagem obrigatória no Web), é **provável** que importar crie chats com uma primeira mensagem, o que conversa com o tutorial antigo de importação pelo Make, que alerta: "Cada chat adicionado será uma mensagem enviada".
- **Fontes:**
  - [SITE "Importação de contatos via CSV"](https://chatguru.com.br/blog/solucoes/importacao-de-contatos-para-o-whatsapp-via-csv/)
  - [SITE planos](https://chatguru.com.br/planos-e-precos/)
  - [DOC Exemplos de API](https://wiki.chatguru.com.br/documentacao-api/exemplos)

### 5.3 Etiquetas (tags)

- **O que faz:** marcadores coloridos no chat. Servem para segmentar (estado, interesse, origem, VIP), filtrar a lista, montar relatórios e escolher o público de campanhas.
- **Fluxo:**
  1. No menu Tags, cria a etiqueta com **cor de fundo**, **cor do texto** e nome.
  2. No chat, procura e aplica. A busca por tag ao aplicar existe desde 02/2023.
  3. Um chat pode ter várias.
- **Regras:**
  - **Não dá para renomear.** É preciso apagar, criar de novo e reaplicar.
  - Apagar não tem volta.
  - Fundo branco não é recomendado.
  - Criar, aplicar, tirar e apagar têm permissões separadas.
  - O robô **só adiciona** tags; para tirar, é à mão.
  - A wiki recomenda tag para informação "fixa"; para datas e coisas que mudam, campo personalizado.
- **Fontes:**
  - [DOC Tags](https://wiki.chatguru.com.br/sobre-o-sistema/tags)
  - [VÍDEO fQ4Fih8DdcA](https://www.youtube.com/watch?v=fQ4Fih8DdcA)
  - [VÍDEO 1glTuRYVY5E](https://www.youtube.com/watch?v=1glTuRYVY5E)
  - [DOC 2023](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)

### 5.4 Campos personalizados (a "ficha" da cliente)

- **O que faz:** campos extras em **todos** os chats da conta, como e-mail, CPF, endereço ou data da última compra.
- **Tipos:** texto, texto longo, e-mail, número, data (DD/MM/AAAA) e hora (HH:MM).
- **Fluxo:**
  1. No painel do chat, clica em "Gerenciar campos personalizados".
  2. Dá nome, tipo e **ordem**, e clica em Cadastrar.
  3. Preenche o campo em cada chat.
  4. Usa como variável: `{Endereco}`, sem acento.
- **Regras:**
  - Criar ou apagar um campo vale para a conta inteira.
  - Há permissões para ver, preencher, apagar e criar.
  - O robô preenche com a ação "Campo Personalizado".
  - A API grava com `chat_update_custom_fields`, que desde 05/2025 aceita data em 4 formatos.
- **Fontes:**
  - [DOC Chats, item 8](https://wiki.chatguru.com.br/sobre-o-sistema/chats)
  - [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k)
  - [VÍDEO 9gR5mpPvUxk](https://www.youtube.com/watch?v=9gR5mpPvUxk)
  - [DOC API](https://wiki.chatguru.com.br/documentacao-api/parametros-obrigatorios)

### 5.5 Funil (quadro kanban)

- **O que faz:** quadros com etapas (Novo → Orçamento → Fechado → Perdido, por exemplo). Pode haver **vários funis**. O chat fica em **uma etapa por funil**, mas pode estar em funis diferentes ao mesmo tempo.
- **Quem usa:** a gestão cria; a atendente move os cards; o robô também move.
- **Formas de pôr chats no funil:**
  1. No funil, "adicionar chats", com filtros. Sem filtro, entram todos.
  2. Pelo painel do chat.
  3. Pelo robô ou pela campanha.
- **Uso:**
  - arrastar o card entre etapas;
  - reordenar as etapas;
  - buscar um chat;
  - clicar no card para abrir a conversa ou tirar do funil;
  - gráfico do funil, que desde 11/2023 também aparece para usuários normais com visão limitada.
- **Mais opções do funil:**
  - restringir quem vê, com a opção "só os chats delegados à pessoa";
  - renomear;
  - **Exportar em CSV**;
  - apagar.
- **Fontes:**
  - [DOC Funil](https://wiki.chatguru.com.br/modulos/funil)
  - [VÍDEO dFUeMrTblq0](https://www.youtube.com/watch?v=dFUeMrTblq0)
  - [DOC 2023](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)
  - [DOC 2024, 01/07](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024)

### 5.6 Tarefas e lembretes

- **Não existe módulo de tarefas**, e não achei em nenhuma fonte.
- **O que faz as vezes de lembrete:**
  - mensagem agendada (4.3);
  - diálogo agendado (3.12);
  - ação com atraso, como "timer" (3.13);
  - relatório salvo enviado todo dia por e-mail ou WhatsApp, por exemplo "quem ficou sem resposta" (6.4);
  - menção em anotação (2.9);
  - aviso no WhatsApp pessoal da atendente (ação Encaminhar).
- **Fontes:** as das seções citadas.

### 5.7 Follow-up (retomar quem parou)

- **O que faz:** cadência automática de mensagens para leads que pararam de responder, em intervalos ajustáveis.
  - Quem responde volta para a vendedora "por delegação nativa (padrão) ou carteira de clientes (opcional)".
  - O fluxo "encerra conversas sem interação após 10 dias" e organiza com tags e funil.
- **É uma "automação pronta" vendida à parte** e montada pela equipe da ChatGuru. **Provável:** feita com diálogos e ações com atraso.
- **Fontes:**
  - [SITE "Follow-up Inteligente"](https://chatguru.com.br/automacao/follow-up/)
  - [SITE "Follow-up automático"](https://chatguru.com.br/blog/solucoes/follow-up-automatico-no-whatsapp/)

---

## 6. Relatórios e gestão

### 6.1 Página inicial do administrador

Ao entrar, o administrador vê gráficos prontos:
- chats não resolvidos ou fechados;
- status dos chats;
- novos chats nos últimos 7 dias;
- novos atendimentos nos últimos 7 dias;
- acumulado;
- mensagens nos últimos 7 dias;
- chats × horas;
- tempo de atendimento nos últimos 7 dias.

Os gráficos de status exigem o módulo Atendimento.
Fontes:
- [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k)
- [DOC Relatórios gráficos, "Extra"](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/relatorios-graficos)

### 6.2 Relatórios gráficos (volume e tempos)

- **Filtros:** período (7, 15 ou 30 dias, mês, ano ou datas livres), "ignorar fins de semana" e número da empresa.
- **Gráficos:**
  - **Novos chats:** pessoas novas, contadas na primeira interação.
  - **Novos atendimentos:** quantas vezes um chat entrou em Aberto. A mesma pessoa pode gerar vários por dia.
  - **Mensagens enviadas e recebidas.**
  - **Mensagens por usuário:** barras e pizza, com o total do robô à parte e as "sem usuário" (enviadas pelo celular).
  - **Total de chats acumulados.**
  - **Tempo de atendimento:** tempo total ou médio que os chats ficam em cada status. **O tempo médio em "Aberto" é o tempo de espera pela primeira resposta.**
  - **Chats × Horas:** **mapa de calor** de dia da semana × hora com mais chats ou atendimentos novos.
- **Quem usa:** gestão.
- **Fontes:**
  - [DOC Relatórios gráficos](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/relatorios-graficos)
  - [VÍDEO Lqe-sDSWLMM](https://www.youtube.com/watch?v=Lqe-sDSWLMM)

### 6.3 Relatório de usuários (desempenho por pessoa ou setor)

- **Filtros:** período (predefinido ou livre), ignorar fim de semana, número da empresa, vários usuários e/ou departamentos (desde 04/2025).
- **Gráficos:**
  - **chats atendidos** por dia;
  - **mensagens enviadas**;
  - **tempo médio de resposta** em hh:mm:ss.

  O tempo de resposta é a diferença entre a mensagem da cliente e a resposta da atendente, em **cada** troca, com média por dia.
- **Exporta em PDF** (imagem dos gráficos).
- **Fontes:**
  - [DOC Relatório de usuários](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/acessos-1)
  - [DOC 11/04/2025](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-da-plataforma)

### 6.4 Relatório de chats (salvo e enviado sozinho)

- **O que faz:** uma lista filtrada de chats, que pode ser **salva** e **enviada automaticamente** por e-mail e/ou WhatsApp em dias e horários definidos.
- **Filtros:**
  - inclui ou exclui tags ("todas" ou "pelo menos uma");
  - status;
  - arquivado;
  - não lida;
  - tem agendada;
  - usuário (ou "não delegado");
  - departamento;
  - número da empresa;
  - robô;
  - etapa do funil;
  - nome contém;
  - cadastrado nos últimos X dias ou entre datas;
  - interagiu nos últimos X dias;
  - mais de X dias sem interagir;
  - dias sem receber mensagem;
  - dias sem enviar mensagem.
- **Resultado:** nome com link, WhatsApp, data de cadastro, última mensagem, data da última mensagem e tags. **Exporta CSV.**
- **Exemplos oficiais:**
  - **"Clientes sem resposta":** interagiu no último dia + não recebeu mensagem no último dia, enviado toda manhã.
  - **"Leads da semana":** cadastrados nos últimos 7 dias, enviado na sexta às 18h pelo WhatsApp. Chega um **link** para o relatório.
  - **"Exportar contatos":** relatório sem filtro e exportação em CSV.
- **Fontes:**
  - [DOC Relatório de chats](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/chats)
  - [VÍDEO o0zC_N4EHgo](https://www.youtube.com/watch?v=o0zC_N4EHgo)
  - [VÍDEO z-S9RqZit2U](https://www.youtube.com/watch?v=z-S9RqZit2U)
  - [VÍDEO EUQyvpJNTTk](https://www.youtube.com/watch?v=EUQyvpJNTTk)

### 6.5 Relatório de mensagens

- **Filtros:**
  - autor (usuário);
  - direção (enviada ou recebida);
  - tipo;
  - texto (sem legendas);
  - legenda;
  - **status**: Agendada, Na fila, Enviando, Enviada, Erro, Recebida e processada, Recebida e não processada;
  - destinatário (número completo);
  - data de criação;
  - número da empresa;
  - data de envio ou recebimento.
- **Resultado:** autor, chat (com link), número, `chat_id` (desde 02/2025), tipo, prévia (arquivo clicável), status e datas. **Exporta planilha** desde 08/2023.
- **Ações no relatório:** cancelar agendadas e apagar as que estão na fila.
- **Fontes:**
  - [DOC Relatório de mensagens](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/mensagens)
  - [VÍDEO VBSnTKx6Qko](https://www.youtube.com/watch?v=VBSnTKx6Qko)

### 6.6 Outros relatórios

| Relatório | O que mostra | Fonte |
|---|---|---|
| Acessos | Usuário, dispositivo, IP, data, "visto por último" e **tempo total logado** | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/acessos) |
| Diálogos | Que diálogo rodou, em que chat e quando, e quem acionou (usuário, API, campanha). Filtro "executado ou não" | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/dialogos) |
| Anotações internas | Ver 2.9 | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/anotacoes-internas) |
| Chats adicionados | Ver 2.13 | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/chats-adicionados) |

Cada tipo de relatório tem a sua permissão [VÍDEO 9gR5mpPvUxk](https://www.youtube.com/watch?v=9gR5mpPvUxk).

### 6.7 NPS (pesquisa de satisfação)

- **O que faz:** manda à cliente um **link** para uma página própria com nota de 0 a 10 e comentário. Tem "métricas" (pesquisas) diferentes, por exemplo produto e atendimento.
- **Fluxo da gestão,** para montar a pesquisa:
  - nome e descrição internos;
  - **mensagem de envio**, que aceita variáveis;
  - pergunta principal;
  - texto do comentário;
  - mensagem de link expirado;
  - agradecimento;
  - textos das notas 0 e 10;
  - **tempo de expiração em minutos**;
  - rodapé;
  - cores;
  - logo, que vem das Configurações da conta;
  - opção "**NPS editável**": a cliente pode mudar a resposta uma vez (só vale para pesquisas novas).
- **Fluxo da atendente:** Mais opções, "**Solicitar NPS**", ou um diálogo "Encerrar e pedir avaliação" com a ação NPS.
- **Fluxo da cliente:**
  1. Recebe "Fulana, por favor responda nossa pesquisa" com o link.
  2. Abre a página com a logo e as cores da empresa.
  3. Escolhe a nota, comenta e envia.
  4. Vê o agradecimento.
  5. Se passar do prazo, vê a mensagem de expirado e precisa receber outro link.
- **Resultado:**
  - score = (promotores − detratores) ÷ respostas, com promotores 9–10, passivos 7–8 e detratores 0–6;
  - porcentagem por nota;
  - contador de enviadas e taxa de resposta;
  - lista com nota, comentário, **usuário e departamento responsáveis no momento do envio** e datas;
  - padrão dos últimos 90 dias;
  - **exporta CSV**.
- **No chat:** aba "Histórico de NPS respondidos".
- **Fontes:**
  - [DOC NPS (módulo)](https://wiki.chatguru.com.br/modulos/nps)
  - [DOC NPS (sistema)](https://wiki.chatguru.com.br/sobre-o-sistema/nps)
  - [VÍDEO 4Zx6wwR1Ic0](https://www.youtube.com/watch?v=4Zx6wwR1Ic0)
  - [DOC 2023](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023)

### 6.8 Exportações (resumo)

| O que | Formato | Fonte |
|---|---|---|
| Lista de chats (contatos e tags) | CSV | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/chats) |
| Mensagens (sem garantia de texto completo na "prévia") | planilha | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/mensagens) |
| Funil | CSV | [DOC](https://wiki.chatguru.com.br/modulos/funil) |
| NPS | CSV | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/nps) |
| Relatório de usuários | PDF (imagem) | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/acessos-1) |
| Conversa inteira, campos personalizados, anotações em lote | **sem botão documentado** (ver o plano de extração em `docs/chatguru-engenharia-reversa.md`) | — |

O "backup" da ChatGuru serve só para consulta dentro dela e não restaura no celular. A recomendação é ligar o backup do próprio WhatsApp [SITE "Recomendações técnicas"](https://chatguru.com.br/recomendacoes-tecnicas/).

---

## 7. Equipe, permissões e segurança

### 7.1 Usuários

- **Criar um usuário:**
  - e-mail de login;
  - nome interno;
  - senha;
  - **nome visível para a cliente**;
  - tipo **Administrador** ou **Normal**, com as permissões e o botão "Selecionar todas" (desde 05/2025).

  O número de usuários é limitado pelas licenças contratadas.
- **Por usuário:**
  - **modo espião**;
  - **horário de acesso** (dias e até 2 períodos por dia). Fora do horário não entra, e no fim do horário **é desconectado**;
  - **chat linkado**, ou seja, o WhatsApp pessoal da pessoa para relatórios e avisos.
- **Tela de usuários:** tipo, nome, espião, horário, chat linkado, Logado/Deslogado, último acesso e "visto última vez".
- **Regras:**
  - Precisa haver pelo menos um administrador.
  - Excluir é **irreversível**, e o mesmo e-mail não pode ser reusado sem o suporte.
  - Mudar nome ou e-mail só pelo suporte.
  - Usuário normal que pode criar usuários **não** cria administradores (desde 04/2025).
- **Fontes:**
  - [DOC Usuários](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios)
  - [VÍDEO LClLKq-g58Q](https://www.youtube.com/watch?v=LClLKq-g58Q)
  - [DOC atualizações 2025](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-da-plataforma)

### 7.2 Permissões (lista reconstruída)

Cada grupo de permissão corresponde a um menu. Se nada do grupo estiver marcado, **o menu some** para a pessoa. As permissões do departamento se somam às da pessoa.

| Grupo | Exemplos de permissão | Fonte |
|---|---|---|
| Tags | ver, aplicar, remover, criar, editar, apagar | [VÍDEO 9gR5mpPvUxk](https://www.youtube.com/watch?v=9gR5mpPvUxk), [DOC Tags](https://wiki.chatguru.com.br/sobre-o-sistema/tags) |
| Usuários | acesso ao menu e às funções; "linkar chat a usuário" | [VÍDEO](https://www.youtube.com/watch?v=9gR5mpPvUxk) |
| Arquivos | criar, editar, enviar | [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k) |
| Celulares | acessar o menu, ler o QR (na prática só o admin lê o QR), recarregar mensagens (duas permissões) | [VÍDEO](https://www.youtube.com/watch?v=9gR5mpPvUxk), [DOC Celulares](https://wiki.chatguru.com.br/sobre-o-sistema/celulares-whatsapp) |
| Login | **entrar pelo celular** (dispositivo móvel) | [DOC 2022](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2022), [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k) |
| Mensagens | ações nas mensagens; **agendar mensagem** | [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k), [DOC 2023](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023) |
| Funis | criar e editar etapas; acesso a funis restritos | [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k) |
| Campanhas e NPS | acesso ao menu; "Exportar respostas do NPS" | [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k), [DOC 2024](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024) |
| Relatórios | uma permissão por tipo de relatório ("Consultar/Ver") | [VÍDEO](https://www.youtube.com/watch?v=9gR5mpPvUxk), [DOC 2023](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023) |
| Chatbot | acessar o menu, criar e alterar, apagar ações e diálogos, **executar diálogo**, ver o processamento, reprocessar | [VÍDEO](https://www.youtube.com/watch?v=9gR5mpPvUxk) |
| Chats | cada filtro da lista (`CHAT_FILTER_BY_NAME`, `…NUMBER`, `…TAG`, `…USER`, `…FUNNEL`, `…UNREAD`, `…ARCHIVED`, `…BROADCAST`, `…FAVORITED`, `…PHONE`), ordenar (`CHAT_ORDER_BY`), **ver todos os chats** (`CHAT_SEE_ALL`), ver chats do departamento (`CHAT_VIEW_GROUP_CHATS`, provável), alterar status (`CHAT_STATUS`, provável), alterar responsável, renomear, ligar e desligar o robô, arquivar, **ver o número do WhatsApp da cliente**, reverificar leitura, **adicionar chats** (`CHAT_ADD_CHAT`), ver o histórico de delegados | [VÍDEO](https://www.youtube.com/watch?v=9gR5mpPvUxk), [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k), [JS] |
| Campos personalizados | ver, preencher, apagar, criar | [VÍDEO](https://www.youtube.com/watch?v=9gR5mpPvUxk) |
| Figurinhas | adicionar à coleção (ligado nas Configurações da conta) | [DOC Configurações](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta) |

**Provável:** a lista acima não está completa, porque a tela de permissões só aparece com login.

### 7.3 Configurações da conta (só administrador)

- **Informações:** fuso horário, número de usuários e de números, módulos contratados.
- **Logo:** só aparece no NPS.
- **Chats:** regras de status e de redelegação (ver 2.7 e 2.4) e limite de encaminhamento.
- **IA:** chaves OpenAI para transcrição e resumo.
- **Conversas:** figurinhas para usuários normais, ligar a transcrição, ligar o resumo.
- **Notificações:** por usuário e por departamento, e os 3 sons.
- **Login:**
  - **só de IPs autorizados** (vale também para administradores);
  - **2FA por e-mail**: desligado, só em aparelho novo (recomendado) ou sempre;
  - logout por inatividade, "temporariamente desabilitado".
- **Dispositivos seguros:** lista revogável dos aparelhos que já passaram pelo 2FA.
- **Bloqueio de senha:** acontece depois de várias senhas erradas **seguidas** (desde 02/2025).
- **Aviso da própria wiki:** "Não altere as configurações deste menu sem real necessidade… podem ter resultados irreversíveis".
- **Fontes:**
  - [DOC Configurações da conta](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta)
  - [DOC Dispositivos seguros](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/dispositivos-seguros)
  - [DOC atualizações 2025](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-da-plataforma)

### 7.4 Uso pelo celular

- **Não há aplicativo nativo.** A busca no Google Play por "chatguru" traz só "ChatGuru: Guest Messaging", da Tiny Schedule LTD, ligado ao domínio chatguru.co e voltado a hotéis, sem relação com a empresa brasileira. Não achei menção a app em nenhuma fonte oficial.
- **O acesso é o painel web no navegador do celular.** O changelog cita a "versão mobile" (05/2024), e existe a permissão "entrar por dispositivo móvel".
- **Avisos no celular:** relatórios e a ação **Encaminhar** chegam no WhatsApp pessoal da atendente.
- **Provável:** o painel é pensado para computador. Os vídeos mostram tudo em tela grande.
- **Fontes:**
  - [3º Google Play](https://play.google.com/store/search?q=chatguru&c=apps&hl=pt_BR)
  - [DOC 2024, 22/05](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024)
  - [DOC 2022](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2022)

---

## 8. Números, canais e as mudanças da Meta

### 8.1 Web, API oficial (WABA) e CoEx

| Modo | Como funciona | Prós e contras citados | Fonte |
|---|---|---|---|
| **Web** | O admin lê o QR Code com o celular da empresa, que fica **ligado, carregando, com o WhatsApp aberto e sem outros apps**. A conexão é a mesma do WhatsApp Web | Sem custo por mensagem; grupos; espelha o celular. O celular cair derruba tudo. Usar o WhatsApp Web ou o próprio celular junto "não é recomendado". iPhone não é recomendado. A lista de aparelhos recomendados prefere Samsung S10/S20, e S21/S22/Z para volume alto | [SITE](https://chatguru.com.br/produto/whatsapp/), [DOC FAQ](https://wiki.chatguru.com.br/duvidas-e-dicas/faq), [DOC Aparelhos](https://wiki.chatguru.com.br/duvidas-e-dicas/aparelhos-recomendados), [SITE recomendações](https://chatguru.com.br/recomendacoes-tecnicas/) |
| **API oficial (WABA)** | O número fica na nuvem da Meta, via Gupshup. Exige BM verificada, verificação em duas etapas e templates | Estável, menor risco de banimento, botões, listas e catálogo. Sem grupos, sem status, sem chamadas, sem foto da cliente, sem responder citando. Cobrado por mensagem desde 10/2026. Para voltar ao app comum: 30 dias sem enviar template | [DOC WABA](https://wiki.chatguru.com.br/whatsapp-business-api/whatsapp-business-api-waba), [DOC FAQ WABA](https://wiki.chatguru.com.br/whatsapp-business-api/duvidas-frequentes-waba) |
| **CoEx** | Web e API no mesmo número: "API para lembretes, confirmações e cobranças; Web para conversas e grupos". Mantém o histórico no aparelho | A parte que passa pela API é cobrada | [SITE](https://chatguru.com.br/produto/whatsapp/), [SITE blog](https://chatguru.com.br/blog/whatsapp-web-vai-ser-pago-nova-cobranca-meta/), [VÍDEO webinar](https://www.youtube.com/watch?v=t7wagnFFm4E) |

**Tela "Celulares WhatsApp" (admin):**
- status da conexão;
- nome do número, que dá para renomear;
- **fila de mensagens**, ou seja, quantas saíram da plataforma e ainda não chegaram ao WhatsApp. A mesma informação aparece no topo para todos;
- ler o QR Code;
- restringir quem adiciona chats naquele número;
- dados da API;
- no WABA: templates, saldo e extrato.

Fontes: [DOC Celulares](https://wiki.chatguru.com.br/sobre-o-sistema/celulares-whatsapp), [VÍDEO admin](https://www.youtube.com/watch?v=-_7A9UpZr4k).

### 8.2 Vários números na mesma conta

O site já falou em "número ilimitado de números". Os planos incluem 1 ou 2, e o número adicional é pago.
- Cada chat mostra o "Aparelho Origem".
- Filtros, relatórios e campanhas têm o filtro "Aparelho".
- Cada número tem o seu robô e o seu rodízio.
- Também é saída de emergência quando um número é banido. Há ainda o serviço pago de **troca de número**, que mantém os chats.

Fontes: [SITE blog 8 funcionalidades](https://chatguru.com.br/blog/como-funciona-o-chatguru-conheca-8-funcionalidades/), [DOC Dicas, "Banimento"](https://wiki.chatguru.com.br/duvidas-e-dicas/dicas), [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats).

### 8.3 Instagram, Messenger e outros canais

**Não achei** atendimento de Instagram Direct ou de Facebook Messenger em nenhuma fonte (wiki, site, blog, vídeos). O Instagram só aparece como **origem** do lead (tag "Instagram", link wa.me na bio) e como anúncio "clique para WhatsApp". O site fala em "otimizar suas campanhas no Instagram com API oficial", no sentido de anúncio que leva ao WhatsApp. A busca aberta também não trouxe nada.

Fontes: [SITE plataforma](https://chatguru.com.br/produto/plataforma-chatguru/), [VÍDEO OifrhCzfWxs](https://www.youtube.com/watch?v=OifrhCzfWxs).

### 8.4 Mudanças da Meta em 2026 (contexto)

- **01/10/2026:** na API oficial, mensagens de serviço dentro da janela de 24 h passaram a ser cobradas, com franquia de 1.000 por número por mês. Os números **Web e o app Business não são cobrados** por mensagem.
- **28/09/2026:** a janela grátis de quem chega por anúncio passou de 72 h para "até 7 dias".
- **Username e BSUID:** a cliente pode esconder o número e conversar por um identificador por empresa.
  - A API da ChatGuru já aceita `bsuid` e `username`.
  - No webinar de junho de 2026, a ChatGuru disse que guarda telefone e BSUID e que, quando o telefone aparece, o contato "vai ser complementado na plataforma" automaticamente.
  - Recomendação deles: **coletar o telefone** da cliente, porque o BSUID só vale para aquele número da empresa.
- **Fontes:**
  - [SITE "Tenho número Web…"](https://chatguru.com.br/blog/whatsapp-web-vai-ser-pago-nova-cobranca-meta/)
  - [SITE "Como reduzir custos…"](https://chatguru.com.br/blog/como-reduzir-custos-no-whatsapp-nova-cobranca-meta/)
  - [SITE "Janela de 72 horas…"](https://chatguru.com.br/blog/janela-72-horas-whatsapp-7-dias/)
  - [VÍDEO webinar 23/06/2026](https://www.youtube.com/watch?v=t7wagnFFm4E)
  - [VÍDEO webinar 08/07/2026](https://www.youtube.com/watch?v=PAYl6QPxwqg)
  - [DOC API](https://wiki.chatguru.com.br/documentacao-api/parametros-obrigatorios)

O site também anuncia uma "Engine Híbrida", mas **a página só tem um formulário** e o conteúdo não é público ([SITE](https://chatguru.com.br/material/calculadora-de-impacto-api-novo-modelo-e-engine-hibrida/)). **Provável**, pelo blog "API e WhatsApp Web na operação": é usar Web e API conforme o setor ([SITE](https://chatguru.com.br/blog/api-e-whatsapp-web-na-operacao/)).

---

## 9. Integrações e API

### 9.1 Ferramentas de automação

- **Make:** existe um app oficial. Ele só tem **ações**: mandar mensagem, mandar arquivo, adicionar chat, anotar, campos, executar diálogo, consultar status e chamada livre. **Não tem gatilho nem busca.** A conexão pede chave, account_id, phone_id e o "app" do servidor (s10 = 10). Fontes: [3º Make](https://www.make.com/en/integrations/chatguru), [DOC Exemplos](https://wiki.chatguru.com.br/documentacao-api/exemplos), [VÍDEO](https://www.youtube.com/watch?v=I1iXeArUduU).
- **n8n:** nó da comunidade `n8n-nodes-chatguru`, com as mesmas ações. Fonte: [3º GitHub](https://github.com/vgdss/n8n-nodes-chatguru).
- **Zapier:** a wiki cita o Zapier só como lugar para "tratar dados". Não achei app oficial. Fonte: [DOC Exemplos](https://wiki.chatguru.com.br/documentacao-api/exemplos).
- **Entrada de dados no ChatGuru:** só pela API v1 (9.5).
- **Saída de dados:** só pelo "Post para URL" (3.11).

### 9.2 Integrações prontas (serviço pago, feito pela equipe da ChatGuru)

A integração **não vem no plano**. Exige o módulo API e, às vezes, outros módulos (Adicionar Chats, por exemplo). O código não é entregue ao cliente, e mudanças na conta (planilha, etapas de funil) precisam ser avisadas para ajustarem a integração. Fontes: [DOC "Conheça a solução"](https://wiki.chatguru.com.br/integracoes/conheca-a-solucao-para-integracoes), [DOC "Dúvidas comuns"](https://wiki.chatguru.com.br/integracoes/duvidas-comuns-sobre-integracoes).

As páginas de Soluções separam "Nativo" de "Via integração". **Provável:** "Nativo" é integração pronta e "Via integração" é projeto sob medida. O site não define os termos.

| Área | "Nativo" | "Via integração" ou citado na wiki | Fonte |
|---|---|---|---|
| **Agenda** | Google Calendar, Feegow | Calendly; a wiki cita **Trinks**, Clínica nas Nuvens, Outlook, Teams | [SITE](https://chatguru.com.br/blog/solucoes/agendamento-automatico-pelo-whatsapp/), [DOC](https://wiki.chatguru.com.br/integracoes/casos-de-uso/agendamentos) |
| CRM | Pipedrive, HubSpot, Moskit, Monday, RD Station CRM (aparece como nativo numa página e via integração em outra) | a wiki cita ActiveCampaign, Agendor, Bitrix24, Pipefy, Omie, Otimus | [SITE](https://chatguru.com.br/blog/solucoes/crm-integrado-ao-whatsapp/), [DOC](https://wiki.chatguru.com.br/integracoes/casos-de-uso/crm-erp) |
| Marketing | RD Station Marketing, ActiveCampaign | HubSpot, LeadLovers | [SITE](https://chatguru.com.br/blog/solucoes/automacao-de-marketing-integrada-ao-whatsapp/) |
| Cobrança | Asaas, Cielo | Vindi, InfinitePay, PicPay, Mercado Pago, Superlógica | [SITE](https://chatguru.com.br/blog/solucoes/cobranca-e-pagamentos-pelo-whatsapp/), [DOC](https://wiki.chatguru.com.br/integracoes/casos-de-uso/sistemas-de-pagamento-e-financeiro) |
| Assinatura | ZapSign | Clicksign, Docusign | [DOC](https://wiki.chatguru.com.br/integracoes/casos-de-uso/assinatura-digital) |
| Planilhas e formulários | Google Sheets, Google Forms | Google Docs | [SITE](https://chatguru.com.br/blog/solucoes/integracao-do-whatsapp-com-planilhas-e-dados/), [SITE](https://chatguru.com.br/blog/solucoes/inicio-automatico-de-conversas-no-whatsapp/) |
| Telefonia | Calix, Zenvia | iBot | [SITE](https://chatguru.com.br/blog/solucoes/telefonia-integrada-ao-whatsapp/) |
| E-commerce | Bling | Nuvemshop, Baggy, VTEX, WooCommerce; a wiki cita WordPress, Hotmart, Monetizze | [SITE](https://chatguru.com.br/blog/solucoes/recuperacao-de-carrinho-abandonado-pelo-whatsapp/), [DOC](https://wiki.chatguru.com.br/integracoes/casos-de-uso/outros-casos) |
| Jurídico | ADVbox, Projuris | Themis, Astrea | [SITE](https://chatguru.com.br/blog/solucoes/acompanhamento-de-processos-pelo-whatsapp/) |

### 9.3 Automações prontas com preço público

**"Agendamento Inteligente com Google Calendar"** (também existe com Feegow): **R$ 1.800,00 em 12 meses**. Comparação deles com "atendente CLT: R$ 31.200,00".

Como funciona:
1. A cliente escolhe o serviço.
2. Escolhe a profissional ou o local.
3. Vê os horários livres.
4. Confirma, e o horário fica bloqueado no Google.

Depois, o sistema:
- lembra a cliente perto do horário;
- **pergunta se ela vai comparecer**;
- deixa **remarcar ou cancelar** sozinha;
- manda a localização no Maps.

O gestor recebe por WhatsApp ou e-mail os números do mês: novos agendamentos, remarcações, cancelamentos e confirmações.

Fontes: [SITE Google Calendar](https://chatguru.com.br/automacao/agendamento-inteligente-com-google-calendar/), [SITE Feegow](https://chatguru.com.br/automacao/agendamento-inteligente/).

### 9.4 Assistente de IA

Projeto sob medida: o cliente precisa contratar o módulo API, ter uma conta OpenAI com créditos e entregar documentos (descrição da empresa, serviços, preços, FAQ, "como o assistente deve se comportar"). A ChatGuru promete entender imagem, perceber o tom da conversa, qualificar o lead, agendar e fazer follow-up. Ela diz não ter modelo próprio.

Fontes: [DOC "Projeto Assistente IA"](https://wiki.chatguru.com.br/integracoes/projeto-assistente-ia), [SITE blog](https://chatguru.com.br/blog/como-configurar-agente-ia-whatsapp/).

### 9.5 API v1: o que cada ação faz

**Formato:** um único endereço, `POST https://sNN.chatguru.app/api/v1`, em formato de formulário (`x-www-form-urlencoded`).
- **Sempre vai:** `key`, `account_id`, `phone_id` e `action`.
- **Identificação da cliente:** `chat_number` (número completo), `bsuid` ou `username`.
- **Credenciais:** ficam em Celulares → "Informações da API" (só admin, só com o módulo API). Gerar uma chave nova derruba a antiga na hora.

Fontes: [DOC API](https://wiki.chatguru.com.br/documentacao-api/parametros-obrigatorios), [DOC Celulares](https://wiki.chatguru.com.br/sobre-o-sistema/celulares-whatsapp).

| Ação (`action`) | Em palavras simples | O que precisa |
|---|---|---|
| `message_send` | Manda um texto para uma cliente que **já está** na lista. Com `send_date` ("AAAA-MM-DD HH:MM"), **agenda** | `text` |
| `message_status` | Diz se uma mensagem mandada pela API já saiu (agendada, enviada…) | `message_id` |
| `message_file_send` | Manda um arquivo a partir de um link. O link precisa terminar com a extensão | `file_url`, `caption` (nome do arquivo) |
| `chat_add` | Cadastra uma cliente nova e manda a primeira mensagem. Pode já delegar a alguém e rodar um diálogo. Exige o módulo Adicionar Chats. A resposta volta "pendente" | `name`, `text`, `chat_number`; opcionais `user_id` e `dialog_id` |
| `chat_add_status` | Diz se o `chat_add` deu certo | `chat_add_id` |
| `chat_update_name` | Muda o nome da cliente | `chat_name` |
| `chat_update_custom_fields` | Grava campos da ficha | `field__NomeDoCampo` |
| `chat_update_context` | Grava contextos do robô, por exemplo para fazer o robô "pular" uma etapa | `var__NomeDoContexto` |
| `note_add` | Escreve uma anotação interna | `note_text` |
| `dialog_execute` | Roda um diálogo naquela cliente. Serve para mandar template, mudar status, delegar ou mover no funil a partir de outro sistema | `dialog_id` |

- **Não existe ação para ler:** não lista chats, mensagens nem contatos. Para ler, só o webhook (3.11), os relatórios ou as rotas internas do painel (ver o documento de engenharia reversa).
- **Limites de uso:** não documentados.
- **Suporte:** a ChatGuru **não dá suporte** a integração feita pelo desenvolvedor do próprio cliente.

Fontes: [DOC API](https://wiki.chatguru.com.br/documentacao-api/parametros-obrigatorios), [DOC "Dúvidas comuns sobre integrações"](https://wiki.chatguru.com.br/integracoes/duvidas-comuns-sobre-integracoes).

---

## 10. O que os clientes reclamam (Reclame Aqui)

- **Perfil:**
  - reputação **"Ótima"** e empresa verificada;
  - dados de 01/04 a 30/09/2026: 37 reclamações, 81,1% respondidas, 7 aguardando, 100% resolvidas entre as avaliadas, nota média 9,7;
  - **tempo médio de resposta de 19 dias e 12 horas**;
  - histórico: "Regular" em abril de 2026 e "Ótima" de junho a setembro;
  - 237 reclamações ativas no total;
  - categorias de problema mais frequentes: "Mau atendimento no SAC" (57), "Outro problema" (18), "Descumprimento de contrato" (14), "Site fora do ar/Lento" (12), "Propaganda enganosa" (8).
- **Títulos recentes:**
  - "Perdi 350 contatos e fui negativado…" (10/2026, sem resposta);
  - "Meu suporte ChatGuru piorou e a funcionalidade prometida atrasou… entregue a 1 dia da cobrança da Meta" (01/10/2026);
  - "Instabilidade constante…" (09/2026);
  - "Estou sem acesso à plataforma há 3 dias…" (09/2026);
  - "WhatsApp banido e não temos suporte" (07/2026);
  - "Sistema fora do ar e suporte indisponível" (10/07/2026);
  - "Demora no atendimento…" (05/2026).
- **Fontes:**
  - [3º perfil](https://www.reclameaqui.com.br/empresa/chatguru/)
  - [3º lista](https://www.reclameaqui.com.br/empresa/chatguru/lista-reclamacoes/)
- **Páginas que não consegui abrir:** as reclamações individuais devolvem 403 para leitura automática. O que segue vem **do resumo do buscador** e não foi lido na página:
  - a ChatGuru atribuiu a queda de 10/07/2026 à parceira de infraestrutura **OVH**, com normalização "após as 21h";
  - em 2025, respondeu a instabilidades citando "capacidade de processamento dos servidores";
  - houve disputa sobre cobrança durante número banido.

  Endereços: [3º](https://www.reclameaqui.com.br/chatguru/reclamacao-sobre-falha-na-plataforma-chatguru-e-seus-impactos_Wpm1B68H_IeO6vHo/) e [3º](https://www.reclameaqui.com.br/chatguru/instabilidade-do-sistema-chatguru-causando-perda-de-negocios_v9ONRCy693jdPOQs/).

---

## 11. Fluxos completos de ponta a ponta

Cada fluxo junta peças documentadas. Quando a ligação entre as peças é dedução minha, está marcada como **provável**.

### F1. Cliente chama fora do horário → … → campanha de retorno

| # | O que acontece | Quem faz | Como, no ChatGuru | Fonte |
|---|---|---|---|---|
| 1 | Cliente manda "Oi, quero marcar escova" às 21h | Cliente | Mensagem chega no número (Web ou API) | — |
| 2 | Chat é criado e fica **Aberto** | Sistema | Status automático "novos chats como Aberto" | [DOC Configurações](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta) |
| 3 | Resposta automática "Estamos fora do horário…" | Robô | Diálogo "Fora do horário" (Dia/Hora), Padrão, intervalo de 600 s. Ações: Responder, Tag "fora do horário", Anotação | [DOC Chatbot](https://wiki.chatguru.com.br/modulos/chatbot) |
| 4 | Pede dados enquanto espera: "Qual serviço e qual dia prefere?" | Robô e cliente | Contexto `etapa=pedido`. O diálogo seguinte grava a resposta num campo personalizado (ação Campo Personalizado) | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/dialogos-chatbot) |
| 5 | Chat entra na **fila** | Sistema | Fica Aberto, sem dono, até o rodízio ou o robô delegar. **Provável:** o rodízio de usuário com "pular offline" não entrega a quem está fora; o chat fica "sem delegação" no painel | [DOC Usuários](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios) |
| 6 | Às 9h, **distribuição** | Robô ou rodízio | Rodízio do menu Usuários, ou robô com Delegar → departamento Recepção → "1 pessoa online". Alerta com som no sino | [VÍDEO](https://www.youtube.com/watch?v=TWCwnyCbUA8) |
| 7 | Gestão confere a fila | Gestão | Painel: "Aberto: 6, sem delegação: 1" → clica e redistribui | [VÍDEO](https://www.youtube.com/watch?v=1ohwcx-iDUo) |
| 8 | Atendente responde com **resposta rápida** | Atendente | Digita "/" + atalho: "{DAY_GREETING}, {PRIMEIRO_NOME_LEAD}! …". O status vira **Em atendimento** sozinho | [DOC Respostas](https://wiki.chatguru.com.br/sobre-o-sistema/respostas-rapidas) |
| 9 | Marca **etiqueta** "Escova" / "Cliente nova" | Atendente | Tags no painel do chat | [DOC Tags](https://wiki.chatguru.com.br/sobre-o-sistema/tags) |
| 10 | **Agenda** o horário | Atendente | **ChatGuru não tem agenda.** Ou a Casa marca em outro sistema (Avec) e anota no chat ("Escova 17/10 15h com Ana"), ou contrata a integração Google Calendar/Feegow (R$ 1.800/ano), em que a própria cliente escolhe o horário | [SITE](https://chatguru.com.br/automacao/agendamento-inteligente-com-google-calendar/) |
| 11 | Move no **funil** "Agendada" | Atendente ou robô | Funil → etapa, pelo chat ou pela ação Funil | [DOC Funil](https://wiki.chatguru.com.br/modulos/funil) |
| 12 | **Confirmação na véspera** | Atendente ou robô | **Mensagem agendada** (texto ou áudio) para 16/10 às 10h: "Confirma amanhã às 15h?" Ou diálogo agendado com a mensagem e o contexto `confirmacao=aguardando`. Na API oficial, depois de 24 h sem conversa, **precisa de template** | [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats), [VÍDEO](https://www.youtube.com/watch?v=VMvKRbOzxbw), [DOC WABA](https://wiki.chatguru.com.br/whatsapp-business-api/whatsapp-business-api-waba) |
| 13 | Cliente responde "Sim" | Cliente e robô | **Provável:** diálogo com gatilho `confirmacao=aguardando` AND palavra "sim" → Tag "Confirmada" + Anotação + contexto `confirmacao=ok`. Se responder "remarcar", Delegar para a recepção | (montagem com [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/dialogos-chatbot)) |
| 14 | Fim do atendimento | Atendente | Diálogo manual "Encerrar": mensagem + Resolvido (o chat **arquiva**) + etapa do funil | [DOC Chats](https://wiki.chatguru.com.br/sobre-o-sistema/chats) |
| 15 | Depois do serviço, **NPS** | Robô ou atendente | Ação NPS no diálogo "Pós-atendimento" (pode ser agendado para o dia seguinte) | [DOC NPS](https://wiki.chatguru.com.br/modulos/nps) |
| 16 | **Campanha de retorno** 45 dias depois | Gestão | Campanhas: filtro "tem a tag Escova" + "mais de 40 dias sem interagir" + robô ligado → diálogo "Volte" (mensagem + tag "Campanha retorno"), intervalo de 180 s, uma campanha por vez | [DOC Campanhas](https://wiki.chatguru.com.br/sobre-o-sistema/campanhas) |
| 17 | Quem responde volta à fila | Sistema | O chat é "reiniciado" e volta para Aberto. Se a opção estiver ligada, é **delegado de novo** pelo rodízio ou, no plano Profissional, pela carteira | [DOC Configurações](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta), [SITE carteira](https://chatguru.com.br/blog/solucoes/carteirizacao-de-clientes-no-whatsapp/) |
| 18 | Gestão mede | Gestão | Gráficos: tempo médio em Aberto (espera), mapa de calor; Relatório de usuários: tempo médio de resposta; Relatório de chats com a tag "Campanha retorno"; NPS por atendente | [DOC Gráficos](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/relatorios-graficos) |

### F2. Triagem por menu e transferência entre setores com recado

1. A cliente manda "oi" e recebe o menu "1 Agendar, 2 Tratamento capilar, 3 Financeiro" (`URA=True`).
2. Ela digita "2". O diálogo "Opção 2" faz quatro coisas:
   - responde;
   - põe a tag "Tricologia";
   - delega ao departamento Tricologia, entregando a 1 pessoa online;
   - grava `URA=2`.
3. A tricologista atende e descobre que é cobrança.
4. Ela aciona o diálogo manual "Encaminhar para Financeiro". O robô avisa a cliente, troca o responsável e tira a tricologista.
5. Antes, ela escreve uma anotação: "@financeiro@… cliente pagou sinal por Pix, conferir".
6. O Financeiro recebe o sino e o e-mail da menção. O histórico de delegação guarda quem passou para quem.
7. **Provável:** se a cliente voltar dias depois, cai em Aberto. Se "remover delegados ao reiniciar" estiver ligado, ela passa de novo pelo rodízio; se não, continua com o Financeiro.

Fontes: [VÍDEO NBgAlZLZdFo](https://www.youtube.com/watch?v=NBgAlZLZdFo), [VÍDEO TWCwnyCbUA8](https://www.youtube.com/watch?v=TWCwnyCbUA8), [VÍDEO gTgfeZk8MzY](https://www.youtube.com/watch?v=gTgfeZk8MzY), [DOC Configurações](https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta).

### F3. Puxar uma cliente que não escreveu (lembrete ou retorno ativo)

1. A atendente vai em Chats → Adicionar e põe o nome, o número e uma resposta rápida.
   - No Web, a mensagem é obrigatória.
   - Na API oficial, escolhe um diálogo com template.
2. Antes de a cliente responder, a atendente aciona "Bloqueio de URA" (`URA=Block`, Em atendimento), para o menu não disparar.
3. O chat nasce delegado a ela.
4. O número tem que existir no WhatsApp, e o nono dígito é corrigido sozinho.
5. Se ficar "Pendente" por muito tempo, ela confere no relatório de chats adicionados.

Fontes: [VÍDEO nPH0JTeW1Jc](https://www.youtube.com/watch?v=nPH0JTeW1Jc), [DOC Adicionar chats](https://wiki.chatguru.com.br/modulos/adicionar-chats).

### F4. Lead que parou no menu ("ocioso")

1. O diálogo de boas-vindas tem a ação extra "Diálogo: timer", com atraso de 1 h.
2. Se depois de 1 h a cliente continua em `URA=True` (não escolheu nada), o diálogo "timer" roda. Ele pode:
   - delegar a uma pessoa; ou
   - reenviar o menu; ou
   - encerrar.
3. Ele grava `timer=1`, e dá para repetir com outro atraso.

Fonte: [VÍDEO X-P0wNWLeNE](https://www.youtube.com/watch?v=X-P0wNWLeNE).

### F5. Cliente manda áudio longo ou liga

- **Áudio:** com o módulo Transcrições, em segundos aparece a anotação com o texto. A atendente lê e responde. Mais tarde, a gestão acha "alisamento" no relatório de anotações. Fonte: [DOC Transcrições](https://wiki.chatguru.com.br/modulos/transcricoes).
- **Ligação:** a cliente liga pelo WhatsApp e ninguém atende. O chat registra "ligação perdida", e o diálogo com gatilho "Ligação perdida" responde "Vimos sua ligação, em que podemos ajudar?" e põe a tag. Fontes: [DOC gatilhos](https://wiki.chatguru.com.br/sobre-o-sistema/dialogos-chatbot), [DOC 06/2025](https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-da-plataforma).

### F6. Rotina da gestão num dia

1. **8h:** chega pelo WhatsApp da gerente o relatório salvo "Clientes sem resposta ontem" (interagiu no último dia + não recebeu mensagem no último dia), com link [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/chats).
2. **Durante o dia:**
   - painel em tempo real para ver quem está sobrecarregado e quem está offline;
   - **modo espião** para acompanhar conversas sem tirar o "não lido";
   - **resumo por IA** (24 h) antes de entrar num caso longo.

   Fontes: [VÍDEO](https://www.youtube.com/watch?v=1ohwcx-iDUo), [DOC Usuários](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios), [DOC Resumo](https://wiki.chatguru.com.br/modulos/resumo-de-chats).
3. **Sexta, 18h:** relatório "Leads da semana" e gráficos [VÍDEO](https://www.youtube.com/watch?v=z-S9RqZit2U).
4. **Equipe:**
   - horário de acesso por pessoa: a atendente é desconectada ao fim do turno;
   - relatório de acessos com o tempo logado;
   - ajuste do rodízio (Ativo/Inativo para quem está de folga).

   Fonte: [DOC Usuários](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios).

### F7. Pós-serviço com feedback ao gestor (modelo do vídeo do hotel)

1. Ao concluir, a atendente aciona "Reserva concluída". O diálogo:
   - manda a mensagem;
   - põe Resolvido;
   - põe a tag;
   - move no funil.

   Ela também **agenda** os diálogos de "início" e "fim" para as datas certas.
2. No fim, o robô pede a opinião.
3. A resposta da cliente é encaminhada ao **WhatsApp do supervisor** com nome, texto e link do chat. A tag vira "estadia finalizada".
4. Se a cliente escrever de novo depois, ela recebe o menu inicial, porque já não é "hóspede".

Fonte: [VÍDEO lvpRPfJa6Iw](https://www.youtube.com/watch?v=lvpRPfJa6Iw). **Provável:** no salão, isso equivale a "serviço feito → agradecimento → NPS → nota baixa vai ao WhatsApp da gerente".

### F8. Saída do ChatGuru (dados)

1. Relatório de chats sem filtro → CSV dos contatos [VÍDEO EUQyvpJNTTk](https://www.youtube.com/watch?v=EUQyvpJNTTk).
2. Relatório de mensagens por período → planilha [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/mensagens).
3. Funil → CSV. NPS → CSV.
4. O resto (conversa inteira, campos personalizados, anotações em lote) não tem botão. Ver o plano em `docs/chatguru-engenharia-reversa.md` (pedido formal por LGPD, sessão guiada e espelho pela Evolution).

---

## 12. O que o ChatGuru não faz, ou não documenta

| Lacuna | Situação | Fonte |
|---|---|---|
| Agenda própria (serviço, duração, profissional) | Não existe; só por integração paga | [SITE](https://chatguru.com.br/automacao/agendamento-inteligente-com-google-calendar/), [DOC](https://wiki.chatguru.com.br/integracoes/casos-de-uso/agendamentos) |
| App nativo de celular | Não encontrado | [3º Google Play](https://play.google.com/store/search?q=chatguru&c=apps&hl=pt_BR) |
| Instagram, Messenger e outros canais | Não encontrado | §8.3 |
| Tela de horário de funcionamento | Não existe; é feita com o gatilho Dia/Hora | [DOC Chatbot](https://wiki.chatguru.com.br/modulos/chatbot) |
| Módulo de tarefas | Não existe | §5.6 |
| Resposta rápida compartilhada pela equipe ou com anexo | Respostas são pessoais (o admin copia); anexo não documentado | [DOC](https://wiki.chatguru.com.br/sobre-o-sistema/respostas-rapidas) |
| Renomear tag, criar status próprio, renomear status | Não dá | [DOC Tags](https://wiki.chatguru.com.br/sobre-o-sistema/tags), [DOC Atendimento](https://wiki.chatguru.com.br/modulos/atendimento) |
| Robô tirar tag | Não dá; ação Tag só adiciona | [DOC Chatbot](https://wiki.chatguru.com.br/modulos/chatbot) |
| Mais de uma campanha ao mesmo tempo | Não dá | [DOC Campanhas](https://wiki.chatguru.com.br/sobre-o-sistema/campanhas) |
| Editar ou apagar mensagem enviada para todos | Não documentado | §4.7 |
| Abrir o chat sem marcar "visto" para a cliente | Não documentado; o modo espião é só interno | §2.8 |
| Ler dados pela API (listar chats e mensagens) | Não existe na v1 | [DOC API](https://wiki.chatguru.com.br/documentacao-api/parametros-obrigatorios) |
| Exportar conversas completas | Sem botão | §6.8 |
| IA própria | Não tem; usa a OpenAI do cliente | [SITE](https://chatguru.com.br/blog/como-configurar-agente-ia-whatsapp/) |
| Resumo por IA para usuário normal | Só admin ("futuramente" para normais) | [DOC](https://wiki.chatguru.com.br/modulos/resumo-de-chats) |
| Status certo quando se responde pelo celular | O status não muda | [DOC FAQ](https://wiki.chatguru.com.br/duvidas-e-dicas/faq) |
| Mudar nome ou e-mail de usuário, reusar e-mail | Só pelo suporte | [DOC Usuários](https://wiki.chatguru.com.br/sobre-o-sistema/usuarios) |

---

## 13. Fontes consultadas

**Wiki oficial** (https://wiki.chatguru.com.br), lida inteira:
- Chats, Atendimento, Usuários, Chatbot, Diálogos/Chatbot, Respostas rápidas, Campanhas, Tags, Arquivos, Funil, NPS (as duas páginas), Transcrições, Resumo de chats, Adicionar chats, API, Celulares WhatsApp, Configurações, Configurações da conta e Dispositivos seguros.
- Relatórios: geral, Chats, Mensagens, Gráficos, Usuários, Acessos, Diálogos, Anotações e Chats adicionados.
- WABA: visão geral, configuração via ChatGuru, FAQ e atualizações.
- FAQ, Dicas, Aparelhos recomendados e Acessando a plataforma.
- API: Introdução e Exemplos.
- Integrações: solução, casos de uso (todas as subpáginas), Assistente IA e Dúvidas comuns.
- Histórico de atualizações: 2025, 2024, 2023 e 2022.

**Site oficial:**
- https://chatguru.com.br/
- https://chatguru.com.br/produto/plataforma-chatguru/
- https://chatguru.com.br/produto/whatsapp/
- https://chatguru.com.br/planos-e-precos/
- https://chatguru.com.br/recomendacoes-tecnicas/
- https://chatguru.com.br/automacoes/
- https://chatguru.com.br/automacao/agendamento-inteligente/
- https://chatguru.com.br/automacao/agendamento-inteligente-com-google-calendar/
- https://chatguru.com.br/automacao/follow-up/
- https://chatguru.com.br/automacao/ura-saude/
- https://chatguru.com.br/automacao/anotacao-interna/
- As 31 páginas de https://chatguru.com.br/blog/solucoes/, listadas em https://chatguru.com.br/funcionalidade-sitemap.xml.
- Posts do blog:
  - https://chatguru.com.br/blog/como-funciona-o-chatguru-conheca-8-funcionalidades/
  - https://chatguru.com.br/blog/arquivo-de-mensagem-de-voz-pre-gravada-conheca-um-dos-diferenciais-do-chatguru/
  - https://chatguru.com.br/blog/como-colocar-nome-do-atendente-no-whatsapp-business/
  - https://chatguru.com.br/blog/whatsapp-web-vai-ser-pago-nova-cobranca-meta/
  - https://chatguru.com.br/blog/como-reduzir-custos-no-whatsapp-nova-cobranca-meta/
  - https://chatguru.com.br/blog/metodo-pagamento-waba-outubro-2026/
  - https://chatguru.com.br/blog/janela-72-horas-whatsapp-7-dias/
  - https://chatguru.com.br/blog/waac-whatsapp-novo-modelo-waba/
  - https://chatguru.com.br/blog/whatsapp-flows-o-que-e-como-funciona/
  - https://chatguru.com.br/blog/como-configurar-agente-ia-whatsapp/
  - https://chatguru.com.br/blog/api-e-whatsapp-web-na-operacao/
  - https://chatguru.com.br/blog/chatguru-reduzir-custo-whatsapp-api/
- https://chatguru.com.br/material/calculadora-de-impacto-api-novo-modelo-e-engine-hibrida/ (só formulário)

**Vídeos oficiais** (YouTube, canal ChatGuru; legenda automática em português):

| Vídeo | Assunto |
|---|---|
| https://www.youtube.com/watch?v=ngySgRzFlwU | Treinamento para usuários (2022) |
| https://www.youtube.com/watch?v=-_7A9UpZr4k | Treinamento para administradores (2022) |
| https://www.youtube.com/watch?v=Q3g6N_c7caA | Primeiros passos |
| https://www.youtube.com/watch?v=1glTuRYVY5E | Apresentação resumida |
| https://www.youtube.com/watch?v=VqsWxq6JHGc | Conheça os recursos (2026) |
| https://www.youtube.com/watch?v=1ohwcx-iDUo | Dashboard |
| https://www.youtube.com/watch?v=BIrk4U862kQ | Atendimento |
| https://www.youtube.com/watch?v=9gR5mpPvUxk | Permissões |
| https://www.youtube.com/watch?v=gTgfeZk8MzY | Vários usuários no mesmo WhatsApp |
| https://www.youtube.com/watch?v=LClLKq-g58Q | Cadastrar usuário |
| https://www.youtube.com/watch?v=NBgAlZLZdFo | URA com subníveis |
| https://www.youtube.com/watch?v=VMvKRbOzxbw | Cadastrar diálogo |
| https://www.youtube.com/watch?v=Z2GAnD2WorU | Funcionamento do chatbot |
| https://www.youtube.com/watch?v=OifrhCzfWxs | Gatilhos simples |
| https://www.youtube.com/watch?v=TWCwnyCbUA8 | Diálogo de encaminhamento |
| https://www.youtube.com/watch?v=Pe_UrVgi5Bk | Encaminhamento para o celular |
| https://www.youtube.com/watch?v=X-P0wNWLeNE | Leads ociosos |
| https://www.youtube.com/watch?v=e_O9iMIHaNM | Intenções |
| https://www.youtube.com/watch?v=AYFYB7NhxKE | Entidades |
| https://www.youtube.com/watch?v=2p_P-ZQPzKw | Restaurante |
| https://www.youtube.com/watch?v=G07YfL6YiQE | Imobiliária |
| https://www.youtube.com/watch?v=lvpRPfJa6Iw | Hotel |
| https://www.youtube.com/watch?v=ARCPt2qUor0 | Feriado (2025) |
| https://www.youtube.com/watch?v=roW6XIa1GwA | Feriado (2021) |
| https://www.youtube.com/watch?v=H4CZoX0I0bw | Respostas rápidas |
| https://www.youtube.com/watch?v=z5rfZtgRNiA | Agendamento de mensagens |
| https://www.youtube.com/watch?v=z68El8JyLq0 | Filtros |
| https://www.youtube.com/watch?v=0bgg_a6gl4M | Anexar arquivos |
| https://www.youtube.com/watch?v=-v5HKhv3WYE | Arquivos |
| https://www.youtube.com/watch?v=nO4ai205rOg | Campanhas |
| https://www.youtube.com/watch?v=dFUeMrTblq0 | Funil |
| https://www.youtube.com/watch?v=fQ4Fih8DdcA | Tags |
| https://www.youtube.com/watch?v=o0zC_N4EHgo | Relatório de chats |
| https://www.youtube.com/watch?v=z-S9RqZit2U | Leads da semana |
| https://www.youtube.com/watch?v=VBSnTKx6Qko | Relatório de mensagens |
| https://www.youtube.com/watch?v=Lqe-sDSWLMM | Relatórios gráficos |
| https://www.youtube.com/watch?v=EUQyvpJNTTk | Exportar contatos |
| https://www.youtube.com/watch?v=4Zx6wwR1Ic0 | NPS |
| https://www.youtube.com/watch?v=6BW0Lddl9_Y | Adicionar chats |
| https://www.youtube.com/watch?v=nPH0JTeW1Jc | Bloqueio de URA |
| https://www.youtube.com/watch?v=Iaw1QdTIixI | Chats adicionados |
| https://www.youtube.com/watch?v=1su80-m60is | Transcrições |
| https://www.youtube.com/watch?v=gkhQoA0zPU0 | Resumo |
| https://www.youtube.com/watch?v=j8kUSybSOUE | Captura de e-mail |
| https://www.youtube.com/watch?v=DVc-RpZGM1Y | Contagem por departamento |
| https://www.youtube.com/watch?v=jM6QhYByGwI | Consulta de CNPJ |
| https://www.youtube.com/watch?v=NWOFb8qN2N0 | Consulta de CEP |
| https://www.youtube.com/watch?v=I1iXeArUduU | App no Make/Integromat |
| https://www.youtube.com/watch?v=2wAvp7T_CaE | Adicionar chats a partir do Sheets |
| https://www.youtube.com/watch?v=t7wagnFFm4E | Webinar "Seu número… dias contados" (23/06/2026) |
| https://www.youtube.com/watch?v=PAYl6QPxwqg | Webinar "Novas regras da Meta" (08/07/2026) |
| https://www.youtube.com/watch?v=sb7kfnP_jtI | NPS (vídeo curto de divulgação) |
| https://www.youtube.com/watch?v=tPPSilXFVVc | NPS (vídeo curto de divulgação) |
| https://www.youtube.com/watch?v=Za--ifj3XQw | Divulgação geral |

**Terceiros:**
- https://www.reclameaqui.com.br/empresa/chatguru/
- https://www.reclameaqui.com.br/empresa/chatguru/lista-reclamacoes/
- https://www.baguete.com.br/noticias/chatguru-traz-dois-novos-c-level
- https://www.capterra.com.br/software/212407/zapguru
- https://play.google.com/store/search?q=chatguru&c=apps&hl=pt_BR
- https://www.make.com/en/integrations/chatguru
- https://github.com/vgdss/n8n-nodes-chatguru

**Código público do painel:** `app.chatlist.js`, baixado em 14/10 sem login (ver `docs/chatguru-engenharia-reversa.md`). Dele vieram os nomes de permissões, os status e os tipos de mensagem citados como [JS].
