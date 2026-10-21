# ChatGuru por dentro: o que dá para puxar e o que falta no nosso CRM

Relatório de engenharia reversa · 14/10/2026 · base de código conferida: `crm` HEAD d6c4fcb
Complementa `docs/chatguru-pesquisa.md` (pesquisa inicial) e `docs/backlog.md`.

**Como ler as confianças**
- **confirmado**: visto em documento oficial, no código público do ChatGuru ou em código de terceiros rodando em produção.
- **provável**: os indícios são fortes, mas ninguém testou na conta da Casa.
- **inferência**: dedução nossa, sem prova direta.

**Regras que seguimos na investigação.** Só material público: a wiki inteira, o site, os termos, a página de login e os arquivos JS/CSS públicos do painel, mais cerca de 25 repositórios de terceiros no GitHub e os nós do Make e do n8n. Não fizemos login, não usamos senha nem cookie de ninguém, não chamamos nenhuma ação de escrita e não testamos nenhuma rota ao vivo.

---

## 1. Resumo em 10 linhas

1. **Dá para tirar praticamente tudo do ChatGuru**, mas quase nada vem pela API oficial. Ela só envia coisas: das 10 ações, 8 são de escrita e só 2 consultam status.
2. **Caminho oficial, que a gestora faz sozinha:** CSV do Relatório de Chats, CSV do Relatório de Mensagens (mês a mês), CSV do Funil, CSV do NPS e download das mídias.
3. **Caminho completo, em sessão guiada:** com a gestora logada no navegador dela, as mesmas rotas internas que o painel usa entregam a lista inteira de chats e o histórico de cada conversa, inclusive as anotações. O cookie nunca sai da máquina dela.
4. **Garantia jurídica:** pedir agora, por LGPD, a exportação completa a juridico@ e dpo@chatguru.com.br. Os termos dizem que exportar antes de cancelar é responsabilidade do cliente, e o backup só dura 6 meses depois do cancelamento.
5. **Espelho ao vivo:** se a conta for WEB (QR Code), parear a nossa Evolution no mesmo número traz o histórico do aparelho e todas as mensagens novas durante a transição.
6. **Achado novo:** existe uma API v2 em `api.chatguru.app/api/v2/docs`, fechada com senha (HTTP Basic). Vale perguntar ao suporte pela credencial, porque é a candidata mais forte a ter leitura.
7. **Já temos:** a ficha migra (contato, etiquetas, campos, responsável e link), e somos melhores em distribuição por presença, prazo por expediente, origem por link/QR, alertas com escalada e salvaguardas de envio.
8. **Essenciais que faltam:** (a) importar mensagens e anotações antigas; (b) atender contato com número oculto (@lid), que hoje é ignorado e vira cliente perdida; (c) serviço com duração e preço, para a agenda não marcar dois horários um em cima do outro.
9. **Importantes de impacto rápido:**
   - parar de marcar "visto" quando a gestão só olha a conversa;
   - registrar ligação perdida e reação 👍;
   - nota interna;
   - exportar contatos;
   - etiquetas filtráveis e com cor;
   - mensagem agendada;
   - biblioteca de arquivos.
10. **Precisamos da Casa:** uma sessão de cerca de 1h30 com a admin logada, a confirmação de que a conta é WEB ou WABA, o número do servidor (sNN), o celular-servidor em mãos e o e-mail do titular da conta para o pedido de LGPD.

---

## 2. O que descobrimos por dentro do ChatGuru

### 2.1 Como o painel é construído

| O quê | Detalhe | Confiança |
|---|---|---|
| Painel principal | Site Flask (Python) renderizado no servidor, com jQuery ("app antigo"). | confirmado |
| Telas modernas | Microserviços Vue 3 embutidos: `chatlist` (lista de chats e conversa), `attachment-list` (biblioteca de arquivos), `phone_wa` (config do celular) e `unresolved-chats` (painel de não resolvidos). | confirmado |
| Servidores | Cada conta mora num servidor `sNN.chatguru.app` (s2, s4, s8, s10, s12, s17, s19, s20...). O nome antigo era ZapGuru (`app.zap.guru`). **Precisamos saber o sNN da Casa.** | confirmado |
| Tempo real | Eventos Pusher atualizam a lista, com push no navegador via Pusher Beams. A lista vem em páginas de 100 chats. | confirmado |
| Robô | O modelo de mensagem tem `watson_response`, ou seja, parte do motor de intenções nasceu ligada ao IBM Watson. A IA atual (resumo e transcrição) usa a chave OpenAI do próprio cliente. | confirmado |
| Rastreamento | O painel carrega GTM/GA, Microsoft Clarity, Facebook, LinkedIn, HubSpot, Beamer e Userflow. | confirmado |
| Tema e marca | Tema escuro e white-label (marca de revendedor). | confirmado |

### 2.2 Como o painel autentica

1. **Login:** formulário `POST /login` com e-mail, senha e `browser_session`, um identificador único do navegador gravado no `localStorage`. É ele que alimenta a tela "Dispositivos seguros".
2. **Sessão:** cookie `session` assinado, HttpOnly e Secure, no padrão Flask.
3. **Token para as telas Vue:** `GET /jwt/user-service-token` devolve um JWT, enviado como `Authorization: Bearer`. Dentro dele vêm `account_id`, `user_type` (admin/super), `account_features[]` (os módulos contratados, por exemplo FUNNEL) e `permissions[]` (por exemplo CHAT_FILTER_BY_FUNNEL). **É assim que o ChatGuru liga e desliga cada recurso por conta e por pessoa.**
4. **Anti-falsificação:** também vai um cabeçalho XSRF no padrão double-submit (cópia de um cookie).
5. **Proteções da conta:** 2FA por e-mail (desligado, só em dispositivo novo ou sempre), lista de dispositivos seguros revogável, lista de IPs autorizados, horário de acesso e bloqueio depois de várias senhas erradas.

**Consequência prática:** qualquer leitura pelas rotas internas precisa de uma pessoa da Casa logada. Se o 2FA estiver ligado, o código chega no e-mail dela. Por isso a extração é feita **no navegador dela**, não num servidor nosso.

### 2.3 Rotas internas do painel (as que o próprio ChatGuru usa)

Todas exigem **login de um usuário da Casa**. As marcadas "admin" só trazem tudo se quem estiver logado for admin, porque um usuário normal vê apenas os chats dele e dos departamentos dele.

| Rota | O que traz | Leitura? | Confiança | Precisa |
|---|---|---|---|---|
| `POST /chatlist/store` (page_num 0..N, 100 por página) | Lista de chats com id, nome, tipo (chat/grupo), status, favorito, arquivado, agendado, última mensagem, responsáveis (pessoas e departamentos), etapas de funil e etiquetas com cor | sim | confirmado no JS público e em 2 projetos de terceiros | admin |
| `GET /messages2/{chat_id}/page/{n}` | Histórico completo da conversa: mensagens **e anotações intercaladas**, com autor (usuário, robô ou aparelho), tipo, ack, status, citações, edições, reações, mídia, mensagens agendadas pendentes e ações aguardando aprovação | sim | confirmado em código de terceiros, não testado por nós | admin |
| `GET /chatlist/tags`, `/chatlist/funnels`, `/chatlist/phones`, `/chatlist/users_and_groups`, `/get_users_and_groups` | Catálogos: etiquetas, funis e etapas, números, usuários e departamentos | sim | confirmado no JS público | admin |
| `POST /chat/custom_fields/{chat_id}/view` | Campos personalizados do chat (devolve HTML) | sim | confirmado em terceiros | login |
| `GET /dashboard/chats/unresolved` | Carga de chats não resolvidos por atendente, com status online | sim | confirmado em terceiros | admin |
| `GET /attachments/search?...` e `GET /attachments/attach/download/{id}` | Biblioteca de arquivos (busca e download) | sim | confirmado no JS público | login |
| `GET /nps/{id}/export?export=...` | Dispara a exportação CSV do NPS, que chega por link no e-mail | sim | confirmado em terceiros | permissão de exportar NPS |
| `GET /chats#{chat_id}` | Link direto para o chat (o mesmo do campo `link_chat`) | — | confirmado | login |
| `POST /chat/{id}/delegate`, `POST /chat/toggle_bot_status/{id}/{true/false}`, `POST /messages/` (envio com `reply_msg_id` e `send_datetime`), `POST /attachments/{id}/edit_tags` | **Escrita.** Só documentadas, nunca chamadas | não | confirmado em terceiros | — |

**O que essas rotas revelam sobre recursos do ChatGuru:**
- fila de aprovação de mensagens (`is_approved`, `chat_actions_need_approval`);
- ocultar conteúdo por permissão (`hide_msg_content`);
- histórico de edições;
- reações;
- pedidos de catálogo do WhatsApp;
- resposta citada e agendamento no envio manual;
- um chat pode estar em várias etapas de funil ao mesmo tempo (uma por funil).

### 2.4 API oficial (v1) e o que existe além dela

- **Endereço:** `POST https://sNN.chatguru.app/api/v1`, com `key`, `account_id`, `phone_id` e `action` no corpo. A chave aparece na tela Celulares WhatsApp.
- **As 10 ações documentadas:** `message_send` (aceita `send_date` para agendar), `message_file_send`, `chat_add`, `chat_update_name`, `chat_update_custom_fields`, `chat_update_context`, `note_add` e `dialog_execute` são de escrita. As únicas leituras, `message_status` e `chat_add_status`, consultam só o que a própria API mandou. **Não existe listar chats, mensagens ou contatos.**
- **Extras não documentados** (vistos em terceiros):
  - `param1..N` em `dialog_execute` para preencher template WABA (inferência);
  - `file_type=audio` para forçar áudio (inferência).
- **Ações que terceiros tentaram e que provavelmente não existem:** `chat_messages`, `chat_status` e `chat_send_message`.
- **`chat_add` é assíncrono:** devolve `pending` e o resultado sai depois, em `chat_add_status`. O texto é obrigatório, e integradores mandam um espaço.
- **Contatos sem número:** em WABA, `bsuid` e `username` substituem o número.
- **API v2:** `api.chatguru.app/api/v2/docs` e `openapi.json` respondem 401 com HTTP Basic. Existe, está fechada e o conteúdo é desconhecido. **Perguntar ao suporte.**
- **Integrações prontas:** o app oficial no Make e o nó n8n da comunidade só embrulham essas mesmas ações, sem gatilho e sem leitura. Não achamos nada no Zapier, Pluga, Pipedream nem Albato.

### 2.5 Webhook de saída "Post para URL"

- **O que é:** o único canal oficial em que o ChatGuru **empurra** dados. É uma ação "CRM" dentro de um diálogo do robô e exige os módulos API e Chatbot.
- **O que manda (JSON):**
  - dados do chat: `chat_id`, nome, celular, `phone_id`, `chat_created`, `link_chat`, `bsuid` e `username`;
  - organização: etiquetas, `campos_personalizados`, `bot_context` (as variáveis do robô) e responsável (nome e e-mail);
  - a mensagem que disparou: texto, tipo e `url_arquivo`;
  - campos livres: `campanha_id`, `campanha_nome` e `origem`. As agências usam `origem` como rótulo de roteamento.
- **Reenvio:** até 12 vezes se o destino falhar.
- **Limite:** **não traz o histórico**, só a mensagem que disparou.
- **Para nós:** é exatamente o que já recebemos em `src/app/api/importar/chatguru/route.ts` para migrar a ficha.

### 2.6 Exportações oficiais (pela tela)

| Exportação | Onde | O que sai | Confiança |
|---|---|---|---|
| Relatório de Chats → CSV | Relatórios › Chats › Exportar CSV | Nome, link (com o chat_id), WhatsApp, cadastro, última mensagem e data, etiquetas. **Não traz** campos personalizados nem responsável. Pode ser enviado sozinho por e-mail ou WhatsApp | confirmado |
| Relatório de Mensagens → CSV | Relatórios › Mensagens › Exportar Relatório | Autor, chat, nº, chat_id, tipo, preview/link do arquivo, status, datas. Não se sabe se o "preview" traz o texto inteiro | confirmado |
| Funil → CSV | Funis › Mais opções › Exportar em CSV | Chats por etapa (colunas não documentadas) | confirmado |
| NPS → CSV | NPS › métrica › Exportar | Nota, comentário, 2ª nota e 2º comentário, chat, usuário, departamento, datas. Chega por link no e-mail | confirmado |
| Usuários → PDF / gráficos → imagem | Relatórios | Só imagem, não reimportável | confirmado |
| Anotações, Diálogos, Acessos, Chats adicionados | Relatórios | Só na tela, sem botão de exportar documentado | provável |
| Mídias do chat / Biblioteca | Aba Histórico de mídias / menu Arquivos | Download arquivo por arquivo | confirmado |
| Pedido formal (LGPD/contrato) | juridico@ e dpo@chatguru.com.br | Em tese tudo; formato e prazo não documentados (resposta inicial em até 15 dias) | provável |

### 2.7 Recursos que só descobrimos olhando por dentro

| Recurso | Evidência | Confiança |
|---|---|---|
| Painel de chats não resolvidos (abertos, aguardando, em espera e total por pessoa) | CSS público `app.unresolved-chats` + rota `/dashboard/chats/unresolved` | confirmado |
| Aprovação humana antes do envio automático | Wiki do chatbot + texto "Aprovando mensagem..." na página de login + campos `is_approved` | confirmado |
| Resumo por IA também para grupos | id `#create_group_chat_summary` no CSS | inferência |
| Permissões granulares por tela (uma por filtro: etiqueta, funil, número...) | JWT com `permissions[]` | confirmado |
| Clientes do ChatGuru montam Selenium só para saber "quantas conversas abertas cada atendente tem", porque não existe nativamente | repositório DyhegoS/WebScraping_Chatguru | confirmado |
| Agências instalam scripts no navegador para ter atalhos de teclado, mensagens prontas no F2 e selo de origem do lead | repositório GL-BUSINESS | confirmado |

### 2.8 O que não conseguimos ver (e por quê)

- **O JavaScript das telas logadas** (chats, relatórios, editor do robô): só é servido depois do login. Tentamos cerca de 35 nomes óbvios e todos deram 404.
- **As rotas de respostas rápidas e do editor de diálogos** são desconhecidas e só aparecem gravando a sessão (HAR) com a gestora logada.
- **Exports:** colunas do CSV do funil, limite de linhas e se o preview das mensagens traz o texto inteiro, nada disso está documentado.
- **API v2:** fechada.
- **Changelog:** o da wiki para em 06/2025. CoEx, carteira e segmentação de origem só aparecem no site comercial.
- **Como a conta da Casa está configurada:** WEB ou WABA, quais módulos tem, se usa campos personalizados e quantos chats existem.

### 2.9 Alerta de segurança (sobre terceiros, não sobre a Casa)

Achamos credenciais do ChatGuru vazadas em repositórios públicos de outras empresas: uma chave de API, um cookie de sessão e uma chave num blueprint da própria wiki. **Não usamos nenhuma.** Serve de lição para nós: a chave de API e o cookie da Casa nunca vão para o git nem para arquivo compartilhado.

### 2.10 Resumo: o que precisa de login de admin da Casa

- **Precisa de admin logado:**
  - lista completa de chats;
  - histórico de mensagens e anotações;
  - catálogos (etiquetas, funil, usuários e departamentos);
  - painel de não resolvidos;
  - respostas rápidas de todos;
  - diálogos do robô;
  - configurações.
- **Precisa de permissão de Relatórios** (admin ou usuário autorizado): todos os CSVs oficiais. O NPS exige a permissão própria "Exportar Respostas do NPS".
- **Precisa do titular da conta:** o pedido formal por LGPD, enviado do e-mail cadastrado.
- **Precisa do celular-servidor em mãos:** parear a Evolution (só se a conta for WEB).
- **Não precisa de nada da Casa:** o que já está neste relatório.

---

## 3. Plano de extração de todos os dados

### 3.1 O que pedir à Casa (checklist)

- [ ] **Titular da conta:** enviar o e-mail de pedido LGPD (nós redigimos), a partir do e-mail cadastrado no ChatGuru.
- [ ] **Admin:** uma sessão de cerca de 1h30, no computador do salão ou no dela, logada no ChatGuru, com a gente acompanhando por chamada ou acesso remoto.
- [ ] **Informações:** número do servidor (aparece no endereço, por exemplo `s12.chatguru.app`), se o número é WEB (QR Code) ou WABA, e quais módulos estão contratados (API, Chatbot, Funil, NPS, Adicionar Chats).
- [ ] **Celular-servidor do ChatGuru** em mãos no dia do pareamento (só se for WEB).
- [ ] **Data prevista de cancelamento** do ChatGuru. Nada pode ser cancelado antes de o passo 7 terminar.
- [ ] **Decisão sobre mensagens agendadas e automações:** quem desliga o quê no dia da virada.

### 3.2 Passo a passo

**Passo 1. Pedido formal por LGPD (hoje, prazo de até 15 dias ou mais).**
- **Como:** e-mail do titular para juridico@chatguru.com.br e dpo@chatguru.com.br pedindo a exportação de chats, mensagens, anotações, campos, etiquetas e mídias. No mesmo e-mail, perguntar pela credencial da API v2.
- **O que traz:** em tese tudo, além da garantia jurídica.
- **Confiança:** provável.
- **Risco:** só o prazo. Por isso vem primeiro.

**Passo 2. CSVs oficiais (a gestora, cerca de 30 min).**
- **Relatório de Chats:** exportar o CSV sem filtro e depois com "arquivados". Se a base for grande, fatiar por data de cadastro. Traz a base mínima garantida.
- **Relatório de Mensagens:** exportar mês a mês. No primeiro arquivo, conferir se o preview traz o texto inteiro. É o plano B do histórico.
- **Relatório de Mensagens com status "Agendada":** é o que precisa ser recriado na virada.
- **Funil:** exportar o CSV.
- **NPS:** exportar de cada métrica (chega no e-mail).
- **Usuários (PDF) e gráficos:** só como registro do "antes".
- **Confiança:** confirmado.
- **Risco:** nenhum.

**Passo 3. Sessão guiada: catálogos e configurações (admin logada, cerca de 20 min).**
- **Como:** com o DevTools aberto, gravar o HAR enquanto ela abre Etiquetas, Funil, Usuários/Departamentos, Respostas rápidas, Diálogos do robô e Configurações.
- **O que traz:** as rotas `/chatlist/tags`, `/funnels`, `/phones` e `/users_and_groups` entregam os catálogos, e o HAR revela as rotas de respostas rápidas e diálogos.
- **O que não vier em rota:** print das telas (rodízio, permissões, horário de acesso, regras de status, mensagem fora do horário).
- **Confiança:** provável para as rotas e inferência para respostas e diálogos.

**Passo 4. Sessão guiada: lista completa de chats e histórico (admin logada, roda sozinho à noite).**
- **Como:** um script de **só leitura** colado no console do navegador dela, em duas etapas:
  1. paginar `POST /chatlist/store` (100 por página) e salvar a lista;
  2. para cada chat, ler `GET /messages2/{id}/page/{n}` até vir vazio e baixar um JSON por chat na pasta de downloads dela.
- **Cuidados:** ritmo de 1 requisição por segundo, retomável de onde parou, sem nenhuma escrita. **O cookie nunca sai do navegador dela.**
- **Campos personalizados:** no mesmo laço, ler `/chat/custom_fields/{id}/view`.
- **O que traz:** tudo, inclusive as anotações internas, responsáveis, edições, reações e links de mídia.
- **Confiança:** provável, porque as rotas funcionam em código de terceiros em produção, mas não foram testadas por nós.
- **Riscos:** rota não oficial, pode mudar; volume alto pode ser barrado. Por isso o ritmo baixo, a execução à noite e o plano B (passo 2).
- **Antes de rodar em massa:** testar em 3 chats.

**Passo 5. Mídias.**
- **Como:** baixar os links de mídia vindos do passo 4 logo em seguida (podem expirar) e a biblioteca de arquivos (`/attachments/search` + download).
- **Plano B:** a aba Histórico de mídias de cada chat, à mão, só para clientes importantes.
- **Confiança:** provável.
- **Risco:** volume e links expirados.

**Passo 6. Espelho ao vivo pelo WhatsApp (se a conta for WEB).**
- **Como:** parear a nossa Evolution no mesmo número como aparelho adicional. O `syncFullHistory` traz o que o aparelho guarda, e `processHistoryEvents` já processa isso. O modo quieto de 48 h já existe e evita a avalanche de alertas.
- **O que traz:** conversas recentes (geralmente meses) e tudo o que chegar daqui para frente. Não traz anotações, etiquetas nem responsáveis.
- **Confiança:** provável.
- **Riscos:**
  - o limite é de 4 aparelhos conectados;
  - com os dois sistemas respondendo, a cliente pode receber resposta dupla, então as automações de envio de um dos lados ficam desligadas;
  - antes de parear, confirmar que o número é o da Casa.

**Passo 7. De/para e importação (do nosso lado).**
- **Montar o de/para:**
  - etiquetas, com cor;
  - etapas de funil para as nossas etapas;
  - usuários para a nossa equipe;
  - campos personalizados para as "Perguntas da ficha";
  - status: Resolvido/Fechado vira conversa arquivada;
  - etiquetas de origem (por exemplo TRAFEGO) vão para o campo origem.
- **Importar de forma idempotente pelo telefone**, com prévia antes ("1.240 clientes, 38 mil mensagens, 12 etiquetas, X serão mescladas") e cada mensagem marcada "veio do ChatGuru".
- **Conferir por amostragem:** 20 clientes conhecidas pela recepção.

**Passo 8. Virada.**
- **Recriar e cancelar as agendadas:** recriar aqui as mensagens agendadas pendentes e cancelá-las lá.
- **Desligar o robô e as automações do ChatGuru.**
- **Manter o ChatGuru só em leitura por 30 dias.**
- **Cancelar só depois** de a resposta do pedido LGPD chegar e de os passos 2 a 7 estarem conferidos.

---

## 4. Matriz completa: funcionalidade × ChatGuru × nós

Legenda de "nós":
- **sim**: já temos;
- **parcial**: temos uma parte;
- **não**: não temos.

A prioridade é a que ficou depois da verificação no código. "Obs." indica quando um dos dois revisores discordou.

### Essencial

| ID | Funcionalidade | ChatGuru | Nós | Prioridade | Como faremos melhor |
|---|---|---|---|---|---|
| G01 | Importar o histórico do ChatGuru (contatos, conversas, anotações, etiquetas, responsáveis) | Sem export completo oficial; só CSVs de Chats e Mensagens + rotas internas com sessão | parcial: a ficha já migra (contato, etiquetas, campos, responsável e link, idempotente pelo telefone); faltam mensagens e anotações | essencial (obs.: um revisor sugeriu importante, já que contatos e etiquetas migram) | Assistente "Migrar do ChatGuru": recebe CSV/JSON, mostra prévia, importa idempotente pelo telefone e marca "veio do ChatGuru" |
| G03 | Contatos sem número visível (@lid / bsuid / username) | Atende por bsuid/username normalmente | parcial: quando o número não vem, a mensagem é **ignorada** e só gera alerta (webhook.ts:257-265) | essencial | Criar o contato pelo @lid com o selo "número oculto", atender normalmente e completar o telefone quando ele aparecer |
| G47 | Serviços com duração e preço (conflito real na agenda) | Não tem; delega a Feegow/Trinks | parcial: conflito fixo de 1 h que só avisa; serviço sem duração nem preço | essencial (obs.: um revisor sugeriu importante enquanto o Avec for a agenda oficial; vira essencial quando a nossa agenda substituir a dele) | "Dura 1h30 · a partir de R$ 180"; ao agendar, só os horários livres da profissional; o preço preenche "Fechar venda" |

### Importante

| ID | Funcionalidade | ChatGuru | Nós | Prioridade | Como faremos melhor |
|---|---|---|---|---|---|
| G02 | Mesclar contatos duplicados **(fonte duvidosa)** | Não mescla; corrige o 9º dígito; via API aceita duplicar | não (o 9º dígito já é corrigido e o telefone é único; sobram @lid e troca de número) | importante (depende de G03) | Aviso "parece a mesma pessoa que Ana S." + Juntar com comparação lado a lado e desfazer em 7 dias |
| G04 | Nota interna na conversa com @menção | Anotação no meio da conversa, @menção no sino e por e-mail, histórico com busca | não (só os campos soltos `contacts.notes` e `deals.observations`) | importante (e é o lugar onde caem as anotações migradas) | Botão "Nota" no composer (campo amarelo), balão tracejado "só a equipe vê", @nome no sino, nota na busca |
| G05 | Campos personalizados da ficha | Campos globais (texto, número, data, hora...), viram variável {Campo} | parcial: os campos do ChatGuru já ficam guardados (só leitura); a gestão não cria campos próprios | importante | "Perguntas da ficha" em Configurações (texto, número, data, sim/não, lista); campo desconhecido na migração vira pergunta sozinho |
| G06 | Filtrar a Fila por etiqueta (todas / qualquer / não tem) | Filtro com as 3 regras, combinável | não | importante | Tocar numa etiqueta do card filtra a Fila; chip removível; Shift+toque = "sem essa etiqueta" |
| G07 | Etiquetas com cor e gestão central | Coloridas; **não renomeia**; apagar é irreversível; permissões | parcial: sem cor, renomear nem apagar global (grafia duplicada já é evitada) | importante (obs.: um revisor sugeriu depois) | Tela Etiquetas com cor, contagem, Renomear e Juntar duas; apagar com Desfazer |
| G08 | Mensagem agendada (texto e áudio), executar agora, cancelar | Agenda texto e áudio; filtro de agendados; permissão própria | não (o outbox já tem "enviar depois", mas só para automações) | importante | Segurar Enviar → "Enviar depois" (Amanhã 9h, Segunda 9h, Escolher); mensagem cinza com relógio, "Enviar agora" e "Cancelar" |
| G09 | Respostas prontas ricas (variáveis, anexo, gestão) **(fonte duvidosa)** | Atalhos com variáveis; admin copia para a equipe | parcial: "/" com {nome}; lista global, sem anexo nem saudação | importante | Anexo da biblioteca + {saudação}, {serviço}, {horário}, {profissional}; prévia exata do que a cliente recebe |
| G10 | Biblioteca de arquivos da equipe | Arquivos com tags, busca, 15 MB; áudio "_ptt_guru" sai como voz | não | importante | Clipe "Da biblioteca" com miniaturas por etiqueta, envio num toque; áudio sai sempre como voz, sem regra de nome |
| G12 | Robô de triagem (menu de boas-vindas) | Diálogos, gatilhos, contextos (URA), intenções, regex, prioridade | não (o motor de regras roda por tempo, não por mensagem) | importante | Editor de "Menu" numa tela: opção → etiqueta, pessoa ou equipe + resposta; testador ao lado; sem intenções nem regex |
| G13 | Gatilhos por evento + condições E/OU | Texto, palavra, novo chat, ligação perdida, mídia, CPF, CEP... com AND/OR/NOT | parcial: só gatilhos de tempo e a condição "etapa" (as palavras-chave viram etiqueta, mas não disparam ação) | importante | "Quando a cliente escreve…", "contato novo", "ligação perdida", "etiqueta colocada" + condições de etiqueta, serviço, origem e horário, em frase legível |
| G14 | Mais ações nas automações | Responder, Anexar, Encaminhar, Delegar, Tag, Funil, Anotação, Status, NPS, CRM..., com atraso por ação | parcial: alertar, escalar, mover etapa, enviar mensagem/enquete | importante | "Pôr etiqueta", "passar para…", "criar próxima ação", "escrever nota", "enviar arquivo", com atraso mostrado como linha do tempo |
| G15 | Mensagem automática com aprovação humana | Ação "aguardando aprovação de um usuário" | não | importante (obs.: um revisor acha que o salão ainda não sente falta) | Modo "Sugerir em vez de enviar": rascunho amarelo no composer + seção "Sugestões para revisar" na Fila |
| G16 | Pausar robô e automações para uma cliente | Chave "Chatbot Sim/Não" por chat | não (só "Não é cliente", que tira do funil inteiro) | importante | Interruptor "Mensagens automáticas pausadas para esta cliente", com prazo opcional e selo na Fila |
| G17 | Departamentos / equipes | Grupos de usuários responsáveis por chats, permissões somadas, rodízio | não | importante (obs.: um revisor diz que só pesa junto com G12) | Equipes em Configurações; "Transferir para…" mostra equipes com pessoas livres e entrega à próxima livre |
| G20 | Painel ao vivo de carga por atendente | Painel status × usuário; rota /dashboard/chats/unresolved; clientes fazem Selenium por falta disso | parcial: em Distribuição e no Transferir, mas não no Hoje | importante (obs.: um revisor sugeriu depois) | Faixa "Equipe agora" no Hoje: avatar, status, conversas esperando, anel de atraso; arrastar conversas entre pessoas |
| G21 | Tempo médio de resposta (todas as respostas) | Relatório de Usuários por interação, PDF | parcial: só a primeira resposta (mediana, no expediente) | importante | Coluna "tempo típico de resposta" (todas as respostas no expediente), comparada ao período anterior, com clique para as mais lentas |
| G22 | Relatórios salvos com envio automático | Relatório salvo enviado por e-mail ou WhatsApp em dia e hora definidos | parcial: resumo do dia para copiar; PDF mensal gerado mas não enviado | importante | "Receber todo dia às 19h" no resumo e em qualquer filtro da Fila, no WhatsApp da gestora, com links diretos |
| G23 | Pesquisa de satisfação / NPS | Várias métricas, nota 0–10, score, export CSV (módulo pago) | não | importante (obs.: um revisor sugeriu depois) | Enquete pós-"Compareceu" com emojis; nota baixa vira alerta à gestão, nota alta recebe o link do Google; nota por profissional e serviço |
| G24 | Campanhas / envio em massa | Diálogo sobre lista filtrada, intervalo de 180 s, pausa, uma por vez | não | importante (obs.: só com ok explícito da Casa; risco de banimento) | "Convidar todas" na visão "Sem contato há 90 dias": prévia, limite por hora, contador ao vivo, "sair" remove sozinho |
| G25 | Transcrição automática de áudios | Transcreve em anotação, com a chave OpenAI do cliente | não | importante | Texto recolhido embaixo do áudio, alimentando as etiquetas automáticas (Pediu horário, Reclamação) e a busca |
| G27 | Não marcar "visto" quando a gestão só supervisiona **(fonte duvidosa)** | "Modo espião": não tira o não lido interno | não: qualquer abertura marca azul para a cliente (send.ts:223) | importante (correção barata) | Só marca como lida quando a responsável abre ou alguém responde; selo "visto sem avisar a cliente" |
| G31 | Ligações do WhatsApp registradas | Chamadas atendidas e perdidas na conversa; gatilho "Ligação perdida" | não: as ligações são descartadas (lista SILENT) | importante | "📞 Ligou e ninguém atendeu" na conversa, lead em espera com prazo, botão "Responder por mensagem" |
| G32 | Reações (ver e enviar) | Reagir e ver (só WABA) | não: as reações são descartadas (lista SILENT) | importante | Mostrar no balão; 👍/❤️ no lembrete conta como "confirmou"; segurar a mensagem para reagir |
| G33 | Apagar ou editar mensagem enviada | Só marca "Editada" e apaga na plataforma | não | importante (melhor que o ChatGuru) | Segurar → Editar / Apagar para todos (até 15 min), com registro na auditoria |
| G41 | Exportar a base de contatos (CSV) | Relatório de Chats → CSV | não | importante (portabilidade/LGPD) | "Exportar estes contatos" respeitando busca e filtros, com etiquetas, origem, último serviço, gasto (com permissão) e aniversário |
| G46 | Agendamento conversado + lembrete D-1 | Automação paga com Feegow/Google Calendar (R$ 1.800/ano) | parcial: enquete Confirmo/Preciso remarcar já funciona; lembrete D-1 existe mas vem desligado | importante | "Lembrar a cliente na véspera" marcado ao agendar; "Preciso remarcar" responde com 3 horários livres da mesma profissional |

### Depois

| ID | Funcionalidade | ChatGuru | Nós | Prioridade | Como faremos melhor |
|---|---|---|---|---|---|
| G11 | Galeria da cliente (mídias por conversa) | Aba Histórico de mídias | não (a mídia só aparece na conversa) | depois | Bloco "Fotos" no painel, com data e serviço de cada visita |
| G18 | Carteira de clientes (atendente fixa) | Carteirização (plano Profissional) | parcial: preferência pela última responsável se estiver livre | depois | "Atendente da cliente" na ficha; se ela estiver ausente, outra atende com o aviso "cliente da Thaís" |
| G19 | Rodízio de atendimento | Fila com peso, pular offline | **sim**, e melhor: presença real, nível, limite por pessoa e menor carga | depois | Prévia "próximas 5 conversas iriam para: Ana, Bia, Ana…" |
| G26 | Resumo da conversa por IA | Resumo de 24 h ou 7 dias, só admin, chave OpenAI | não | depois | "Em resumo:" no topo do painel ao transferir ou abrir conversa longa, visível para toda a equipe |
| G28 | Login reforçado (2FA, dispositivos seguros) | 2FA por e-mail, lista revogável, bloqueio | parcial: bloqueio por tentativas; desativar a pessoa derruba as sessões na hora | depois | Código por e-mail só em aparelho novo + "Aparelhos conectados" com Desconectar |
| G29 | Restrição por horário, IP e celular | Horário em 2 períodos, IPs autorizados, permissão mobile | não | depois | "Pode acessar: só no horário da Casa / só no Wi-Fi do salão / também pelo celular" |
| G30 | Relatório de acessos | Usuário, dispositivo, IP, tempo logado | parcial: presença e último acesso, sem tela de histórico | depois | Linha do tempo do dia por pessoa em Equipe |
| G34 | Encaminhar mensagens | Para vários chats; aviso no WhatsApp pessoal | não | depois | Selecionar fotos → "Mandar para a profissional" com nome da cliente e horário |
| G35 | Enviar vídeo, localização e contato | Todos os tipos | parcial: o backend aceita vídeo, a tela não oferece | depois | Liberar vídeo no seletor + resposta pronta "Como chegar" com o pino da Casa |
| G36 | Marcar como não lida / favoritar | Não lida sobe sem som; favoritos | não (a Fila por prazo cobre a maior parte) | depois | Estrela "Acompanhar esta cliente" → seção "Acompanhando" no Hoje |
| G37 | Status de atendimento com regras | 5 status fixos + regras | **sim**, automático (prazo + etapa + arquivar) | depois | De/para na migração: Resolvido/Fechado vira conversa arquivada |
| G38 | Funil kanban (vários funis, CSV) | Vários funis, massa, CSV | parcial: um funil configurável, ações em massa, CSV agregado | depois | Funis paralelos (ex.: Noivas) viram etiqueta + visão salva |
| G39 | Adicionar chat com validação de WhatsApp | Valida o número e corrige o 9º dígito | parcial: cria lead e corrige o 9º dígito, sem checar WhatsApp | depois | ✓ "tem WhatsApp" + foto ao digitar o número (consulta na Evolution) |
| G40 | Relatório de mensagens (falhas, agendadas) | Filtros por status, erro, agendada; export | parcial: a falha manual aparece no balão; a automática gera alerta | depois (obs.: um revisor pediu importante, porque a falha da outbox é silenciosa) | Card "Mensagens que não chegaram" no Hoje (só quando houver), com "Tentar de novo" |
| G42 | Sino, sons e notificações | Sino, push, e-mail, sons | **sim** | depois | Menções (de G04) no mesmo sino |
| G43 | Vários números com filtro por aparelho | Filtro "Aparelho" em tudo | parcial: vários canais, sem filtro | depois | Chip do número no card só com 2+ números conectados |
| G44 | WhatsApp oficial (WABA/CoEx) | Gupshup, templates, botões, catálogo | não (só Evolution, com o provider já abstrato) | depois | Provider pronto para Cloud API + explicação de custo antes de ligar |
| G45 | Webhook de saída / integração | Post para URL + API v1 | não | depois | "Avisar outro sistema quando…" nas automações, com log de entregas |
| G48 | Atalhos de teclado | Não nativo (agências usam userscripts) | parcial: "/", Esc, "Próximo da fila" | depois | J/K, A, T, N, Ctrl+K, com "?" mostrando todos |
| G49 | Grupos e listas de transmissão | Mostra e responde grupos | não, de propósito (grupo não é cliente) | depois | Manter ignorado; se pedirem, aba "Grupos" só de leitura |
| G50 | Origem do lead automática | Etiquetas de origem (planos maiores) | **sim**, e melhor: link, QR, código, anúncio detectado | depois | Na migração, etiquetas como TRAFEGO viram o campo origem |
| G51 | Tema escuro | Botão manual | não | depois | Seguir o tema do aparelho, sem botão |

**Onde já somos melhores:** distribuição por presença real (G19), status automáticos por prazo (G37), origem por link/QR/anúncio (G50), sino com som e push (G42), alertas com escalada, teto de envio por hora e relatórios com detalhamento. Em G33 (editar/apagar para todos) e G07 (renomear etiqueta) seremos melhores ao entregar.

---

## 5. Ordem de construção proposta (lotes pequenos, cada um entregável)

**Lote 1. Não perder sinal da cliente** (correções baratas, alto impacto)
- G27: só marcar "visto" quando a responsável abre ou alguém responde.
- G31: ligação perdida vira item na conversa e lead em espera.
- G32: reação aparece no balão; 👍 no lembrete conta como confirmação.
- **Entrega:** nenhuma cliente fica "vista e ignorada" e nenhuma ligação some.

**Lote 2. Contato com número oculto** (essencial)
- G03: criar e atender contato @lid com o selo "número oculto", completando o telefone quando aparecer.
- **Entrega:** cliente nova por @lid vira lead normal.

**Lote 3. Nota interna** (pré-requisito da migração)
- G04: botão Nota, balão "só a equipe vê", @menção no sino (G42), busca.
- **Entrega:** troca de turno com recado e um lugar para as anotações do ChatGuru.

**Lote 4. Importador do histórico** (essencial)
- G01: assistente "Migrar do ChatGuru" que lê os CSVs oficiais e os JSONs do passo 4, mostra prévia, importa mensagens e anotações de forma idempotente e marca a origem.
- **Depende de:** Lote 3 e da extração (seção 3).
- **Entrega:** a recepção vê o passado de cada cliente no nosso sistema.

**Lote 5. Mesclar duplicados**
- G02: aviso "parece a mesma pessoa", comparação lado a lado, desfazer.
- **Depende de:** Lote 2 (@lid) e Lote 4 (três fontes juntas).

**Lote 6. Ficha e etiquetas para o de/para**
- G05: Perguntas da ficha (os campos migrados viram perguntas editáveis).
- G07: tela de Etiquetas com cor, renomear e juntar.
- G06: filtrar a Fila por etiqueta.
- **Entrega:** a organização do ChatGuru chega inteira e utilizável.

**Lote 7. Agenda de verdade** (essencial quando a agenda sair do Avec)
- G47: serviço com duração e preço; só horários livres; preço em "Fechar venda".
- G46: lembrete da véspera marcado por padrão; "Preciso remarcar" oferece 3 horários livres.

**Lote 8. Produtividade no atendimento**
- G08: mensagem agendada, reaproveitando o outbox.
- G10: biblioteca de arquivos.
- G09: respostas prontas com anexo e variáveis.
- G33: editar e apagar mensagem enviada.

**Lote 9. Saída de dados e falhas visíveis**
- G41: exportar contatos (CSV com filtros).
- G40: card "Mensagens que não chegaram".
- **Entrega:** portabilidade e LGPD, sem falha silenciosa.

**Lote 10. Automações mais seguras e mais capazes**
- G16: pausar automações por cliente.
- G15: modo "Sugerir em vez de enviar".
- G13 + G14: gatilhos por evento ("a cliente escreve…", contato novo, ligação perdida, etiqueta) e ações novas (etiqueta, passar para, tarefa, nota, arquivo).

**Lote 11. Equipes e triagem**
- G17: equipes / departamentos.
- G12: menu de boas-vindas com testador.

**Lote 12. Gestão**
- G20: faixa "Equipe agora" no Hoje.
- G21: tempo típico de todas as respostas.
- G22: resumo e filtros enviados sozinhos por WhatsApp ou e-mail.

**Lote 13. Opcionais com decisão da Casa**
- G25: transcrição de áudios. Exige chave e custo de IA.
- G23: pesquisa de satisfação.
- G24: campanhas. Só com ok explícito, por causa do risco de banimento.

Os itens "depois" (seção 4) entram conforme o pedido da Casa, sem lote próprio.
