# ChatGuru: pesquisa para substituição e importação de histórico

Pesquisa feita em 14/10/2026. Fontes principais:

- Wiki oficial (GitBook): https://wiki.chatguru.com.br. A documentação da API fica em https://wiki.chatguru.com.br/documentacao-api/parametros-obrigatorios. Baixei o índice inteiro (https://wiki.chatguru.com.br/llms.txt) e li as páginas em Markdown.
- Site comercial: https://chatguru.com.br, a página de planos (https://chatguru.com.br/planos-e-precos/) e os termos de uso (https://chatguru.com.br/termos-de-uso/, atualizados em 01/09/25).
- App do ChatGuru no Make: https://www.make.com/en/integrations/chatguru
- Código público de terceiros no GitHub que usa a API. Serve só para confirmar o comportamento na prática; está marcado como tal sempre que aparece.

Legenda usada no texto:
- **[DOC]**: confirmado na documentação oficial ou nos termos.
- **[3º]**: visto em código ou integração de terceiros, sem documentação oficial.
- **[INF]**: inferência minha, que precisa ser testada.

> Observação: o changelog público da wiki vai só até 10/06/2025. Recursos lançados depois disso podem não aparecer aqui.

---

## 1. Funcionalidades do ChatGuru e o que nosso CRM já tem

Comparei com a lista do nosso CRM: fila multiatendente, assumir/transferir, distribuição automática por disponibilidade, respostas prontas, etiquetas, funil/quadro, agenda, resposta fora do horário, automações de prazo e relatórios com PDF. Também usei o `docs/backlog.md`.

Valores da coluna "Nosso CRM":
- **Tem**: está na lista.
- **Parcial**: cobre parte do recurso.
- **Falta**: não está na lista.
- **Verificar**: a lista não diz e precisa olhar no código.

Os módulos são cobrados à parte no ChatGuru: API, Chatbot, Adicionar Chats, Atendimento, Funil, NPS, Transcrições e Resumo de chats. Cada conta tem só uma parte deles.

### Atendimento e caixa de entrada

| Recurso ChatGuru | O que faz | Nosso CRM |
|---|---|---|
| Multiatendimento no mesmo número | Vários usuários atendem pelo mesmo WhatsApp, cada um com o seu login | **Tem** |
| Vários números por conta | Mais de um WhatsApp na mesma conta: WEB (QR Code), API Oficial (WABA) ou CoEx. Filtra por "Aparelho" | **Verificar** |
| Responsável (delegação) | O chat é delegado a um ou mais usuários e/ou departamentos. Usuário "normal" só vê os chats dele | **Tem** (assumir/transferir) |
| Delegar p/ Fila | Devolve o chat ao rodízio | **Parcial** (transferir) |
| Rodízio de atendimento | Distribui chats novos em fila, com a opção de pular quem está offline | **Tem** |
| Departamentos | Grupos de usuários com permissões próprias, delegáveis e com rodízio próprio | **Falta** |
| Status de atendimento | Aberto, Em atendimento, Aguardando, Resolvido e Fechado. Muda sozinho ao responder e guarda o histórico com o tempo em cada status | **Parcial** (fila/assumir; conferir se há status explícitos) |
| Arquivar chat | Tira o chat da lista; ele volta se a cliente escrever. Arquiva sozinho em Resolvido/Fechado | **Falta** (está no backlog) |
| Filtros da lista de chats | Por nome, número, tags (todas/qualquer/não tem), responsável, funil, status, não lidas, arquivados, listas de transmissão, favoritos e agendados | **Parcial** (filtro por etiqueta está no backlog) |
| Busca por texto de mensagem | Procura uma mensagem enviada ou recebida | **Verificar** |
| Favoritos | Estrela no chat, guardada por usuário | **Falta** |
| Anotações internas | Nota que a cliente não vê, com @menção que notifica e manda e-mail. Tem histórico pesquisável | **Falta** (backlog: "Nota interna") |
| Agendar mensagem | Agenda texto e áudio para data e hora. Dá para executar na hora ou cancelar | **Falta** (backlog) |
| Respostas rápidas | Atalhos por usuário com variáveis {DAY_GREETING}, {PRIMEIRO_NOME_LEAD}, {NOME_LEAD}, {TELEFONE_LEAD}, {CHAT_LINK}, {LINK_WHATSAPP} e {Campo}. O admin copia para outros usuários | **Tem** (conferir as variáveis) |
| Biblioteca de arquivos | Arquivos compartilhados pela equipe, com "tags de arquivo" e limite de 15 MB | **Falta** |
| Responder (citar), encaminhar, reações, figurinhas | Como no WhatsApp. Reações e figurinhas de coleção só no WABA | **Verificar** |
| Grupos do WhatsApp | Mostra e responde grupos, com o nome de quem enviou | **Verificar** |
| Histórico de mídias do chat | Aba com mídias, documentos e figurinhas, com download | **Verificar** |
| Histórico de responsáveis | Registra quem delegou e quem removeu, manual ou automático | **Verificar** |
| Chamadas de voz | Registra chamada atendida ou perdida no chat (06/2025) | **Verificar** |
| Adicionar chats | Inicia conversa com número novo sem usar o celular. A mensagem inicial é obrigatória | **Verificar** |
| Linkar chat a usuário | Liga um usuário ao WhatsApp pessoal dele para receber relatórios e avisos do robô | **Falta** |
| Recarregar mensagens antigas | Força o sincronismo com o celular-servidor | n/a |

### Automação

| Recurso ChatGuru | O que faz | Nosso CRM |
|---|---|---|
| Chatbot: diálogos | Gatilhos com lógica AND/OR e parênteses: horário, dia da semana, status, contexto, tipo de mensagem, texto ou intenção. Também roda manualmente pelo atendente | **Parcial** (fora do horário + automações de prazo) |
| Ações do diálogo | Responder, Anexar, Encaminhar (aviso a usuário), Delegar, Tag (só adiciona), Funil, Anotação, Leitura, Diálogo, Status, NPS, CRM (POST para URL), Template, Campo Personalizado, Renomear Chat, Lista/Mensagem Interativa e Catálogo (WABA). Cada ação tem status, execução automática ou com aprovação e atraso | **Parcial** |
| Contextos | Variáveis no chat (ex.: URA = Departamento) para montar menus e submenus | **Falta** |
| Intenções e entidades | Reconhecimento por palavras-chave, frases de exemplo e sinônimos (NLP simples) | **Falta** |
| Menu de atendimento (URA) | Triagem do tipo "1 comercial, 2 suporte" feita com diálogos e contextos | **Falta** (backlog: menu de boas-vindas) |
| Resposta fora do horário / feriado | Diálogo com gatilho de horário e dia | **Tem** |
| Campanhas | Ação em massa sobre uma lista filtrada: envio de mensagem/arquivo ou mudança interna (status, responsável). Intervalo padrão de 180 s, ajustável. Uma campanha por vez. Pausar, arquivar | **Falta** (backlog) |
| Importação de lista (.csv) | Até 10 mil contatos, conforme o plano | **Falta** |

### Cadastro / CRM

| Recurso ChatGuru | O que faz | Nosso CRM |
|---|---|---|
| Tags | Etiquetas coloridas, várias por chat. Não podem ser renomeadas | **Tem** |
| Campos personalizados | "Ficha" do chat: texto, texto longo, e-mail, número, data e hora. Valem para todos os chats e viram variável {Campo} | **Verificar/Falta** |
| Funil (kanban) | Vários funis. Um chat fica em uma etapa por funil. Arrastar, adicionar em massa, restringir quem vê, **exportar CSV** | **Tem** (Quadro; export CSV a conferir) |
| Agenda | **Não existe nativa.** Só por integração (Google Calendar, Feegow) | **Tem** (vantagem nossa) |
| NPS | Pesquisa de 0 a 10 por link, com comentário, expiração, logo e cores. Relatório com score e exportação | **Falta** (backlog: pesquisa de satisfação) |

### Relatórios

| Recurso ChatGuru | O que faz | Nosso CRM |
|---|---|---|
| Relatório de Chats | Lista filtrável que pode ser salva e enviada sozinha por e-mail/WhatsApp em dias e horas definidos. **Exporta CSV** | **Parcial** |
| Relatório de Mensagens | Busca mensagens por autor, direção, tipo, texto, legenda, status, número e datas. **Exporta planilha** | **Falta** |
| Anotações internas | Busca anotações por autor, texto, número e data | **Falta** |
| Diálogos | Histórico de execuções do robô | n/a |
| Chats adicionados | Histórico de inícios de conversa | n/a |
| Acessos | Dias e horários em que cada usuário entrou | **Verificar** |
| Gráficos | Novos chats, novos atendimentos, mensagens enviadas/recebidas, mensagens por usuário, base acumulada, tempo em cada status e mapa de calor | **Tem** (relatórios) |
| Relatório de usuários | Chats atendidos, mensagens enviadas e **tempo médio de resposta** por usuário/departamento. **Exporta PDF** | **Tem/Parcial** (conferir o tempo médio de resposta) |

### Equipe, segurança e plataforma

| Recurso ChatGuru | O que faz | Nosso CRM |
|---|---|---|
| Usuários admin/normal | Permissões granulares por menu, com botão "selecionar todas" | **Parcial** (perfis Recepção/Atendente/Gestão) |
| Nome visível para o cliente | Assina cada mensagem com o nome do atendente | **Verificar** |
| Modo espião | O gestor lê o chat sem tirar o "não lido" | **Falta** |
| Horário de acesso | Bloqueia o login fora do expediente e desconecta sozinho | **Falta** |
| 2FA e dispositivos seguros | Login em duas etapas e logout por inatividade | **Verificar** |
| Notificações | Sino, push, e-mail, sons e tema escuro | **Verificar** (já existe sino) |
| IA: Transcrições | Transcreve os áudios recebidos e mostra numa anotação. Usa a chave OpenAI do cliente | **Falta** |
| IA: Resumo de chats | Resume as últimas 24 h ou os últimos 7 dias numa anotação. Usa a chave OpenAI do cliente | **Falta** |
| WABA (API oficial) | Templates, listas e botões interativos, catálogo e bloqueio de template de marketing por número | **Falta** (não se aplica com Evolution) |
| API + webhook | Veja a seção 2 | n/a |
| Integrações | App oficial no Make e integrações prontas vendidas à parte (Asaas, RD Station, Monday, Google Calendar, Feegow, ZapSign, Advbox, Projuris, Zenvia, Google Sheets) mais um "Assistente IA" | **Falta** |
| App | **Não há app nativo documentado.** A plataforma web tem versão mobile (o changelog de 22/05/2024 cita a "versão mobile") | **Verificar** |

**O que mais falta para a Casa, em ordem sugerida:**
1. Nota interna.
2. Arquivar.
3. Mensagem agendada.
4. Campos personalizados (necessários para importar a ficha das clientes).
5. Filtro da fila por etiqueta.
6. Menu de triagem.
7. Pesquisa de satisfação.
8. Campanhas.
9. Transcrição de áudio.

---

## 2. A API do ChatGuru (v1)

Fonte única oficial: https://wiki.chatguru.com.br/documentacao-api/parametros-obrigatorios **[DOC]**

### 2.1 Endpoint, formato e autenticação

| Item | Valor |
|---|---|
| URL base | `https://{servidor}.chatguru.app/api/v1`. Cada conta fica num servidor (ex.: `s10`); é o mesmo prefixo da URL de acesso ao painel **[DOC]** |
| Método | `POST` em todas as ações. É um endpoint só, e a operação vai no campo `action` **[DOC]** |
| Formato | `application/x-www-form-urlencoded` **[DOC]**. Mandar tudo na query string também funciona **[3º]** (vários projetos no GitHub, ex.: `?key=...&action=message_send...`) |
| Autenticação | Parâmetros obrigatórios em toda chamada: `key` (chave da API), `account_id` (ID da conta) e `phone_id` (ID do número WhatsApp), além de `action` **[DOC]**. Não usa header nem Bearer |
| Onde obter | Menu **Celulares WhatsApp** → "Informações da API". **Só admin vê.** Se não aparecer, o **módulo API não está contratado**; para ativar, fala com o suporte **[DOC]** |
| Trocar chave | O admin gera uma nova chave no mesmo menu e a anterior para de funcionar na hora **[DOC]** |
| Identificar o chat | `chat_number` (número completo com DDI e DDD, ex.: 5571999999999). No WABA com telefone oculto, `bsuid` (Business-Scoped User ID da Meta). Também `username` (nome reservado no WhatsApp) **[DOC]** |
| Limites (rate limit) | **Não documentados.** A wiki não traz limite de requisições por segundo nem por dia. Para campanhas, a página de planos fala em "limite diário e cadência de 3 envios por segundo" **[DOC, planos]** |
| Respostas | JSON com `code`, `result` (`success`/`error`) e `description`, mais campos próprios de cada ação. Erros voltam com `code: 400` **[DOC]** |

### 2.2 Todas as ações documentadas (10)

Todas recebem `key`, `account_id`, `phone_id` e `action`. O chat é identificado por `chat_number`, `bsuid` ou `username`.

| `action` | Para que serve | Parâmetros próprios (\* = obrigatório) | Resposta de sucesso (exemplo da doc) |
|---|---|---|---|
| `message_send` | Envia texto para um chat já existente. Pode agendar | `text`\*, `send_date` (`YYYY-MM-DD HH:MM`) | `201` `{"result":"success","description":"Mensagem cadastrada com sucesso!","message_id":"5dd6…","message_status":"scheduled"}` |
| `message_status` | Consulta o status de uma mensagem enviada pela API | `message_id`\* | `{"message_status":"sent","result":"success","code":200}` |
| `message_file_send` | Envia um arquivo por URL. A URL precisa terminar com a extensão | `file_url`\*, `caption`\* | `{"code":200,"message_file_send_return":"Arquivo enviado com sucesso!","result":"success"}` |
| `chat_add` | Cadastra um chat novo e manda a mensagem inicial. Exige o módulo **Adicionar Chats** | `name`\*, `text`\*, `chat_number`\*, `user_id` (responsável), `dialog_id` (diálogo a executar) | `201` `{"chat_add_id":"5dd6…","chat_add_status":"pending"}` |
| `chat_add_status` | Consulta o resultado do `chat_add` | `chat_add_id`\* | `{"chat_add_status":"done","chat_add_status_description":"Chat adicionado com sucesso!"}` |
| `chat_update_name` | Renomeia o chat | `chat_name`\* | `{"result":"success","code":200}` |
| `chat_update_custom_fields` | Grava campos personalizados | `field__{variável}`\* (um por campo). Data aceita `yyyy-mm-dd`, `dd/mm/yyyy`, `dd-mm-yyyy` e `yyyy/mm/dd` (changelog de 30/05/2025) | `{"chat_id":"5e52…","description":"Campos personalizados foram salvos.","result":"success"}` |
| `chat_update_context` | Cria ou atualiza contextos do chatbot | `var__{nomedocontexto}`\* | `{"result":"success","code":200}` |
| `note_add` | Adiciona uma anotação interna | `note_text`\* | `{"code":200,"description":"Anotação criada com sucesso","note_id":"5ebb…"}` |
| `dialog_execute` | Executa um diálogo do chatbot num chat | `dialog_id`\* | `{"code":200,"dialog_execution_return":"Diálogo executado"}` |

O app oficial no Make (https://www.make.com/en/integrations/chatguru) tem exatamente as mesmas 9 operações de chat: Add a Chat, Add a Note, Check Add Chat Status, Check Message Status, Execute a Dialog, Send a File, Send Message, Update Custom Fields, além de **Make an API Call** (chamada livre). **Não tem nenhum gatilho e nenhuma busca.** Isso reforça que a API não tem leitura **[3º/Make]**.

Ação **não documentada** vista em código de terceiros: `chat_status` (repositório `eduardorodriguesadv1-cloud/ADVBOX-CHAT-GURU-CRM`, arquivo `artifacts/api-server/src/routes/chatguru.ts`). Parece código gerado por IA e **não há confirmação de que funcione** **[3º, não confiável]**. Nenhum código público usa ações do tipo "listar mensagens" ou "listar chats".

### 2.3 Webhook (ChatGuru → nosso sistema)

**[DOC]**, na mesma página, em "Post do ChatGuru para URL personalizada":
- **Não é um webhook de eventos da conta.** É uma **ação "CRM → Post para URL" dentro de um diálogo do chatbot**. Exige os módulos **API + Chatbot**.
- Só dispara quando o diálogo roda. Isso acontece de três jeitos: por gatilho, e os gatilhos **só reagem a ações da cliente**, não a mensagens da equipe; manualmente pelo atendente; ou por `dialog_execute` e por campanha.
- Formato: POST com JSON. Exemplo oficial:

```json
{
  "campanha_id": "…", "campanha_nome": "…", "origem": "…",
  "email": "559988776655@c.us", "nome": "Wiki ChatGuru",
  "tags": ["ASSINANTE"], "texto_mensagem": "",
  "campos_personalizados": {"email": "wiki@chatguru.com.br", "Empresa": "ChatGuru"},
  "bot_context": {"Contexto": true},
  "bsuid": "BR.1446537576716482", "username": "abc123",
  "responsavel_nome": "Usuário 1", "responsavel_email": "usuario1@…",
  "link_chat": "https://s2.chatguru.app/chats#id_do_chat",
  "celular": "559988776655", "phone_id": "id_do_phone", "chat_id": "id_do_chat",
  "chat_created": "2022-08-02 20:06:58.641000",
  "datetime_post": "2023-02-09 12:57:59.085340",
  "tipo_mensagem": "chat"
}
```

- Em mensagens de imagem ou áudio vêm também `tipo_mensagem` (`image`, `ptt`…) e `url_arquivo`, com o link do arquivo (changelog de 29/05/2023).
- O payload traz **a ficha do chat** (tags, campos personalizados, responsável, contexto, data de cadastro, chat_id) e **só a mensagem que disparou**. Não traz histórico nem anotações.

---

## 3. Dá para ler o HISTÓRICO pela API?

### Resposta direta: **não.**

A API v1 oficial **não tem nenhum endpoint de leitura**. As 10 ações documentadas só escrevem (enviar, cadastrar, atualizar, anotar, executar) ou consultam o status de algo que **a própria API** enviou (`message_status`, `chat_add_status`). Não existe ação para listar chats, contatos, mensagens, mídias, tags, anotações ou usuários **[DOC]**. O app oficial no Make confirma isso: zero gatilhos e zero buscas. Na busca por código público também não apareceu nenhuma ação de leitura **[3º]**.

### Alternativas, do mais completo ao mais limitado

| # | Caminho | O que traz | O que não traz / riscos | Status |
|---|---|---|---|---|
| A | **Pedir exportação ao ChatGuru (suporte/pós-vendas)**, com base nos Termos de Uso, cláusulas 11 e 13, e na LGPD (art. 18, portabilidade, pelo DPO) | Em tese, tudo o que eles guardam. Os termos dizem que a ChatGuru "disponibilizará os recursos de exportação conforme o plano contratado" e que, após o cancelamento, os dados ficam em backup **por até 6 meses**, período em que "o cliente poderá solicitar a exportação ou download" | Formato, prazo e custo **não documentados**. Depois de excluídos, só "dados básicos/metadados" mediante taxa e sem garantia. **Pedir ANTES de cancelar** | Direito **[DOC, termos]**; formato **[INF]** |
| B | **Relatório de Mensagens → "Exportar Relatório"** (planilha/CSV desde 24/08/2023) | Uma linha por mensagem: autor (atendente), chat, número, **chat_id**, tipo, prévia, status, data de cadastro e data de envio/recebimento. Filtra por período, direção, tipo e número | O campo se chama "**Preview**". **Não está claro se traz o texto inteiro** **[INF]**. Mídia aparece como link na tela; não se sabe se o CSV traz a URL. Limite de linhas desconhecido: exportar em lotes por período e testar | **[DOC]** (https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/mensagens) |
| C | **Relatório de Chats → "Exportar CSV"** | Lista de contatos: nome, link do chat, número, data de cadastro, última mensagem e data, **tags** | Sem campos personalizados e sem responsável | **[DOC]** (https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/chats) |
| D | **Funil → "Exportar em CSV"** | Etapa de cada chat em cada funil | Formato exato não documentado | **[DOC]** (https://wiki.chatguru.com.br/modulos/funil) |
| E | **Relatório de Anotações internas** | Autor, chat, número, texto completo e data, em ordem crescente | A doc **não cita botão de exportar**. Talvez só copiando da tela | **[DOC]** consulta; export **[INF]** |
| F | **NPS → exportar respostas** | Notas e comentários | Não importa muito para a Casa | **[DOC, changelog 2024]** |
| G | **Ficha completa de cada chat via webhook "em massa"**: criar um diálogo **só com a ação CRM → Post para URL (sem mensagem para a cliente)** e rodar em todos os chats, por campanha (filtro = todos, intervalo curto) ou chamando `dialog_execute` para cada número do CSV do item C | Para cada chat: `chat_id`, nome, número, **tags, campos_personalizados, responsavel_nome/email, bot_context, chat_created, link_chat** | Não traz mensagens nem anotações. Só uma campanha por vez. **Testar antes em 1 chat** para confirmar que nada é enviado à cliente | Cada parte é **[DOC]**; a combinação é **[INF]** |
| H | **Webhook contínuo durante a transição**: diálogo com gatilho em toda mensagem recebida → POST para nosso CRM | Mensagens **novas** recebidas das clientes, com mídia (`url_arquivo`) e ficha atualizada | Não pega mensagens da equipe (gatilho só reage à cliente) nem o passado | **[DOC]** + **[INF]** |
| I | **Sincronizar o histórico pelo próprio WhatsApp via Evolution API** (só se o número estiver conectado no ChatGuru como **WEB/QR Code**, ou seja, como "aparelho conectado") | Ao parear a instância Evolution com `syncFullHistory` ligado, o WhatsApp do celular manda o histórico de mensagens, que a Evolution grava (`messaging-history.set`, `DATABASE_SAVE_DATA_HISTORIC=true`). Traz o **texto completo** e mensagens enviadas e recebidas, inclusive as mandadas pelo celular | **Não traz nada do ChatGuru**: tags, anotações, responsáveis, campos, funil. Quanto histórico o WhatsApp entrega e por quanto tempo as mídias antigas ficam baixáveis **não é garantido** **[INF]**. Não funciona se o número for **WABA** (não há celular com histórico) | Código Evolution **[3º]**: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` (opção `syncFullHistory`) |
| J | **"Exportar conversa" no celular** (WhatsApp → conversa → Exportar) | .txt + mídia, uma conversa por vez | Manual, inviável para centenas de chats. O backup do Google Drive é criptografado e não serve | **[INF]** (recurso do WhatsApp) |
| K | Raspar o painel web (endpoints internos usados pelo navegador, com sessão de usuário) | Teoricamente, o que a tela mostra | **Não documentado.** Pode violar os termos ("não tentar acesso não autorizado") e quebrar a qualquer momento. **Não recomendo** sem autorização por escrito do ChatGuru | **[INF]** |

### Plano recomendado (combinação)

1. **Antes de cancelar qualquer coisa**: a Casa abre um pedido formal no suporte da ChatGuru pedindo a exportação completa (contatos, conversas, mídias, anotações, campos, responsáveis), citando os Termos de Uso, cláusulas 11 e 13, e o art. 18 da LGPD. Perguntar formato e prazo.
2. Em paralelo, a gente mesmo exporta pelo painel (com o login admin):
   - CSV de Chats (todos, inclusive arquivados);
   - Relatório de Mensagens em lotes por mês;
   - CSV de cada Funil;
   - Anotações, por cópia ou export se houver.
3. Ficha de cada chat (tags, campos, responsável): caminho **G**, depois de testado em 1 chat.
4. Corpo completo das mensagens e mídias: caminho **I** (Evolution com `syncFullHistory`). Só vale se o número for WEB, e é preciso confirmar o efeito de ter ChatGuru e Evolution conectados ao mesmo tempo. O FAQ do ChatGuru desaconselha usar WhatsApp Web junto. Depois, cruzar com o CSV de mensagens (B) pelo número e pela data para atribuir o **autor/atendente** de cada mensagem enviada.
5. Durante a operação paralela: caminho **H** para não perder nada novo.
6. Chave de junção entre as fontes: **número completo (`chat_number`/`celular`)** e, quando houver, `chat_id`.

---

## 4. O que pedir à Casa Fiaes para a importação

**Acesso e dados da conta**
1. Login de **administrador** no ChatGuru, ou alguém da Casa que faça as exportações por videochamada. O menu de API e a exportação exigem admin.
2. **URL de acesso** do painel, para saber o servidor (`sNN.chatguru.app`).
3. Quais **módulos estão contratados**: API, Chatbot, Adicionar Chats, Atendimento, Funil, NPS, Transcrições, Resumo. Sem o **módulo API**, os itens 4 e 5 não existem; aí é pedir ao suporte para ativar.
4. Credenciais da API (menu **Celulares WhatsApp**): **`key`**, **`account_id`** e **`phone_id`** de cada número.
5. Tipo de conexão de cada número: **WEB (QR Code)**, **WABA (API oficial)** ou **CoEx**. Isso decide se o caminho I funciona.
6. Plano, data de renovação e se há **fidelidade/multa**, para não cancelar antes de concluir a exportação.

**Para mapear o que vem na importação**
7. Lista de **usuários** (nome e e-mail), para casar `responsavel_nome/email` e o autor das mensagens com a equipe no nosso CRM. Os `user_id` (menu Usuários) só são necessários se formos usar `chat_add`.
8. Lista de **tags**, **campos personalizados** (nome e variável, ex.: `{Endereco}`) e **funis/etapas**.
9. **Respostas rápidas** e diálogos do chatbot que valham a pena recriar. Não há export documentado; é copiar da tela.

**Autorizações**
10. Ok para **criar no ChatGuru um diálogo "Exportar ficha"** só com a ação CRM → Post para URL e rodá-lo em todos os chats (caminho G), depois de testado em 1 chat.
11. Ok e presença do **celular-servidor** para parear a Evolution (caminho I), sabendo que pode haver instabilidade enquanto ChatGuru e Evolution estiverem conectados juntos.
12. Pedido formal ao suporte da ChatGuru, **feito pelo titular da conta**, para a exportação completa (caminho A). Como controladora dos dados (LGPD), a Casa autoriza a importação no nosso CRM.

---

## Fontes consultadas

- API: https://wiki.chatguru.com.br/documentacao-api/parametros-obrigatorios
- Módulo API: https://wiki.chatguru.com.br/modulos/api
- Exemplos e app do Make: https://wiki.chatguru.com.br/documentacao-api/exemplos
- Celulares WhatsApp (credenciais): https://wiki.chatguru.com.br/sobre-o-sistema/celulares-whatsapp
- Chats: https://wiki.chatguru.com.br/sobre-o-sistema/chats
- Relatórios:
  - https://wiki.chatguru.com.br/sobre-o-sistema/relatorios
  - https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/mensagens
  - https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/chats
  - https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/anotacoes-internas
  - https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/relatorios-graficos
  - https://wiki.chatguru.com.br/sobre-o-sistema/relatorios/acessos-1
- Funil: https://wiki.chatguru.com.br/modulos/funil
- Chatbot: https://wiki.chatguru.com.br/modulos/chatbot
- Campanhas: https://wiki.chatguru.com.br/sobre-o-sistema/campanhas
- Usuários, departamentos e rodízio: https://wiki.chatguru.com.br/sobre-o-sistema/usuarios
- Atendimento (status): https://wiki.chatguru.com.br/modulos/atendimento
- Configurações da conta: https://wiki.chatguru.com.br/sobre-o-sistema/configuracoes/configuracoes-da-conta
- Tags, Arquivos e Respostas rápidas:
  - https://wiki.chatguru.com.br/sobre-o-sistema/tags
  - https://wiki.chatguru.com.br/sobre-o-sistema/arquivos
  - https://wiki.chatguru.com.br/sobre-o-sistema/respostas-rapidas
- Adicionar chats: https://wiki.chatguru.com.br/modulos/adicionar-chats
- NPS, Transcrições e Resumo:
  - https://wiki.chatguru.com.br/modulos/nps
  - https://wiki.chatguru.com.br/modulos/transcricoes
  - https://wiki.chatguru.com.br/modulos/resumo-de-chats
- FAQ: https://wiki.chatguru.com.br/duvidas-e-dicas/faq
- Integrações:
  - https://wiki.chatguru.com.br/integracoes/conheca-a-solucao-para-integracoes
  - https://wiki.chatguru.com.br/integracoes/duvidas-comuns-sobre-integracoes
- Changelogs:
  - https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-da-plataforma
  - https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2024
  - https://wiki.chatguru.com.br/novidades-da-plataforma/atualizacoes-anteriores/2023
- Site, planos e termos:
  - https://chatguru.com.br/produto/plataforma-chatguru/
  - https://chatguru.com.br/planos-e-precos/
  - https://chatguru.com.br/termos-de-uso/
- Make: https://www.make.com/en/integrations/chatguru
- Código de terceiros:
  - https://github.com/luishcarreira/nexus_api (README do cliente ChatGuru)
  - https://github.com/nextlw/crate_chatguru
  - https://github.com/eduardorodriguesadv1-cloud/ADVBOX-CHAT-GURU-CRM
- Evolution API, sincronização de histórico: https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts e `.env.example` (`DATABASE_SAVE_DATA_HISTORIC`)
