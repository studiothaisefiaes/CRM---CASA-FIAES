# API do CRM (v1)

Para scripts, planilhas, outras IAs e integrações lerem e escreverem no CRM.
O documento completo (todas as rotas, campos e erros) é gerado do código e fica em
**`GET /api/v1/openapi.json`** (OpenAPI 3.1). Cole esse endereço num gerador de cliente ou numa IA.

## Chave

- Quem tem a permissão **Criar e revogar chaves da API** (`api.gerir`, perfil Gestão) cria em **Configurações › Pessoas › API**,
  ou no servidor: `npx tsx scripts/api-chave.ts criar --nome "Planilha" --email pessoa@casa --escopos ler,escrever`.
- Na tela, a chave é **de quem cria** (age em nome dela). Em nome de outra pessoa, só quem é da **Gestão**, e só para quem não tem
  permissão que a Gestão que cria não tem (a regra de 17/10 de mexer em pessoas também vale). O script do servidor roda como
  administrador e escolhe a pessoa pelo `--email`.
- A chave aparece **uma vez só** (`cf_` + 43 caracteres). No banco fica só o hash. Perdeu: revogue e crie outra.
- Toda chamada leva o cabeçalho `Authorization: Bearer cf_…`.
- A chave age **em nome de uma pessoa da equipe**. Vale o que o perfil dessa pessoa pode fazer **e** o que a chave pode:

| Escopo | Libera |
|---|---|
| `ler` | todo `GET` |
| `escrever` | criar e mudar (contatos, etapa, dona, agenda, tarefas, notas, respostas prontas) |
| `enviar` | tudo que manda WhatsApp para a cliente (não tem volta) |

  Mandar mensagem pede só `enviar`. Algumas escritas **podem** mandar WhatsApp e então pedem `enviar` também:
  remarcar com o lembrete do horário ligado (ou mande `avisar_cliente: false`), pôr a conversa em `resolvido` com a "Mensagem ao resolver"
  ligada e finalizar horário com o "Depois do atendimento" ligado.
- Conversas: sem "Ver conversas de todas", a lista traz só as da pessoa e as sem dona; com "Atendente só mexe nas próprias" ligado,
  a conversa de outra pessoa dá 403 (igual à tela).
- Conversas por id (`GET /conversas/{id}`, mensagens, notas, `PATCH`): o mesmo filtro da lista. Sem "Ver conversas de todas", só as
  da pessoa e as sem dona; a de outra pessoa dá 403 mesmo com "Atendente só mexe nas próprias" desligado. `POST /conversas` com o
  telefone de uma cliente que já tem conversa aberta com outra pessoa dá 409 (sem o id). `GET /agenda` traz `conversa_id: null` quando
  a conversa do horário está fora desse filtro.
- Pessoa desativada, chave revogada ou vencida: 401.
- **A chave sobrevive à troca de senha.** Trocar ou redefinir a senha da pessoa não corta as chaves dela (nem as que outra pessoa da
  Gestão criou em nome dela). Para cortar: **revogue a chave** ou **desative a pessoa** (vale no pedido seguinte).

### O que pode mandar WhatsApp com só `escrever`

O escopo `enviar` cobre o que manda mensagem **na hora**. Algumas escritas com só `escrever` fazem a Casa mandar mensagem **depois**,
sozinha, pelos caminhos de sempre da tela:

- **Lembrete da véspera** (Configurações › Link da cliente, ligado): `POST /agenda` (marcar) agenda o lembrete do horário; remarcar com
  `avisar_cliente: false` não manda o "remarcado" na hora, mas o lembrete da véspera passa para o horário novo e sai no dia.
- **Regras automáticas**: reabrir uma conversa (`PATCH /conversas/{id}` com `etapa` numa conversa fechada, `status: "aberto"` numa
  resolvida, ou `POST /conversas` abrindo uma nova) põe a conversa de volta no motor das Regras automáticas. Uma regra ligada com a ação
  "Enviar mensagem à cliente no WhatsApp" (ex.: "parada há X dias", "a Casa falou por último há X horas") pode mandar depois, sozinha.
- **Tarefas**: `PATCH /tarefas/{id}` (concluir) é igual à tela: pede só estar logada (nenhuma permissão do perfil), qualquer tarefa
  pelo id, e a conversa da tarefa ainda passa pela chave "Atendente só mexe nas próprias". Concluir não manda nada para a cliente.

## Regras gerais

- Respostas em JSON. Sucesso: `{ "dados": … }`; listas: `{ "dados": [ … ], "proximo_cursor": "…" | null }`.
- Erro: `{ "erro": "texto em português" }` com o status: 400 (entrada; o texto diz o campo), 401, 403, 404, 409, 411, 413, 429, 502
  (o WhatsApp não aceitou). Quando o WhatsApp recusa, o texto é sempre "O WhatsApp não aceitou a mensagem." (o que a Evolution disse
  não sai pela API), inclusive no campo `erro` da lista de mensagens.
- **Só https.** Pedido com chave que chegou sem https (`X-Forwarded-Proto` diferente de `https`) dá 403 pedindo https; se a chave passou
  por http, revogue e crie outra. No endereço dos links da cliente (`CLIENT_LINK_URL`) a API não existe (404).
- **Corpo**: até 17 MB (413 acima disso; o arquivo vai até 16 MB). `POST`/`PATCH` precisa do cabeçalho `Content-Length` (corpo em
  pedaços, chunked, dá 411). JSON até 64 KB (413).
- Datas em ISO 8601 **com fuso**. A Casa usa `-03:00` (America/Bahia) e a API devolve sempre assim: `2026-10-26T14:00:00-03:00`.
  Data e hora sem fuso é recusada.
- Paginação: `?limite=` (1 a 200, padrão 50) e `?cursor=` (o `proximo_cursor` da página anterior).
- Limites (passou: 429 com `Retry-After`, em segundos):
  - por chave: 120 pedidos por minuto e 20 envios de WhatsApp por minuto;
  - envios por pessoa: 20 por minuto, somando todas as chaves dela;
  - envios pela API na Casa toda: 30 por minuto e 500 por dia;
  - sem chave ou com chave inválida: 30 pedidos por minuto por IP.
  Pedido recusado (entrada errada, sem permissão, conversa de outra pessoa) não gasta o limite de envios.
- **Cliente que não escreveu nas últimas 24 h** (ou nunca escreveu): `POST /conversas/{id}/mensagens` (texto ou arquivo) pede também
  a permissão **Mandar mensagem em massa** (`mensagem.massa`) no perfil da pessoa da chave. Sem ela, 403.
- Escritas com várias partes (`PATCH /conversas/{id}`, `PATCH /agenda/{id}`, `PATCH /respostas-prontas/{id}`) conferem tudo antes de
  gravar a primeira: uma parte recusada não deixa outra gravada. Em `PATCH /agenda/{id}`, remarcar e mudar o `status` vão em pedidos
  separados.
- Toda escrita fica na auditoria (entity `api`, com a chave, a rota, o status de verdade e quem criou a chave, `criada_por`).

## Rotas

| Método e caminho | Escopo | Permissão do perfil |
|---|---|---|
| `GET /api/v1/eu` | ler | — |
| `GET /api/v1/contatos?q=&tipo=` | ler | contatos.ver |
| `GET /api/v1/contatos/{id}` | ler | contatos.ver |
| `POST /api/v1/contatos` | escrever | contatos.editar |
| `PATCH /api/v1/contatos/{id}` | escrever | contatos.editar |
| `GET /api/v1/conversas?etapa=&dona=&q=&abertas=&anuncio=` | ler | atendimento.ver |
| `POST /api/v1/conversas` | escrever | atendimento.ver |
| `GET /api/v1/conversas/{id}` | ler | atendimento.ver |
| `PATCH /api/v1/conversas/{id}` (etapa, dona, status) | escrever (+ enviar ao resolver com a mensagem ligada) | atendimento.ver ou quadro.ver (dona de outra pessoa: atendimento.transferir) |
| `GET /api/v1/conversas/{id}/mensagens` | ler | atendimento.ver |
| `POST /api/v1/conversas/{id}/mensagens` | enviar | atendimento.ver (cliente fora das 24 h: + mensagem.massa) |
| `POST /api/v1/conversas/{id}/notas` | escrever | atendimento.ver |
| `GET /api/v1/funil/etapas` (etapas da conversa) | ler | atendimento.ver ou quadro.ver |
| `GET /api/v1/agenda?de=&ate=&profissional=` | ler | atendimento.ver |
| `POST /api/v1/agenda` | escrever | agenda.marcar |
| `PATCH /api/v1/agenda/{id}` | escrever (+ enviar ao remarcar avisando / finalizar com Depois do atendimento) | agenda.marcar ou atendimento.ver (conforme a mudança) |
| `GET /api/v1/profissionais` | ler | atendimento.ver |
| `GET /api/v1/servicos` | ler | atendimento.ver |
| `GET /api/v1/tarefas?responsavel=&abertas=&ate=` | ler | atendimento.ver |
| `POST /api/v1/tarefas` | escrever | atendimento.ver |
| `PATCH /api/v1/tarefas/{id}` | escrever | — (como na tela) |
| `GET /api/v1/respostas-prontas` | ler | atendimento.ver |
| `POST /api/v1/respostas-prontas` | escrever | atendimento.ver (para todas: config.sistema) |
| `PATCH /api/v1/respostas-prontas/{id}` | escrever | atendimento.ver |
| `GET /api/v1/avisos` | ler | — (o sino da própria pessoa) |
| `GET /api/v1/relatorios/{relatório}` | ler | relatorios.ver (+ o que cada um pede) |

Relatórios (os mesmos cálculos da tela de Relatórios; o objeto `dados` tem os nomes de campo do código):

- Números do CRM, com `?periodo=hoje|7d|mes|ano` (e `dono=`, `origem=`): `resumo-do-dia`, `numeros`, `resposta`, `funil`, `parados`,
  `origem`, `perdas`, `canal`, `qualidade`, `followup`, `calor`, `respostas-por-pessoa`, `pessoas`, `vendas-e-cobrancas`,
  `faturamento-salao`, `retorno`. Sem "Ver números de toda a equipe", são sempre os números da pessoa da chave.
  `origem` aceita `?recorte=anuncio` (por campanha: anúncios do Meta pelo nome dado em Configurações › Origens) e `?recorte=porta`
  (por porta de entrada); sem `recorte`, por origem, como sempre.
- Conversas trazem `anuncio` (`id`, `nome`, `plataforma`, `post_url`; null quando não veio de anúncio) e `porta_de_entrada`
  (`anuncio`, `instagram`, `link`, `busca`, `grupo`, `status`, `outro` ou null). `?anuncio=sim|nao|<id do anúncio>` filtra a lista.
- Salão e Financeiro, com `?de=AAAA-MM-DD&ate=AAAA-MM-DD` (ou `?periodo=hoje|7d|mes|mes-passado|ano`): `salao`, `satisfacao`, `ocupacao`,
  `financeiro`, `excecoes`, `resultado`, `contas-a-pagar`, `notas-fiscais`. Relatório desligado em Configurações dá 404.

## Exemplos

```sh
API=https://crm.exemplo.com.br/api/v1
CHAVE=cf_coloque_a_sua_chave_aqui

# Quem é a chave
curl -s $API/eu -H "Authorization: Bearer $CHAVE"

# Buscar cliente pelo telefone (qualquer formato)
curl -s "$API/contatos?q=71%2099999-0000" -H "Authorization: Bearer $CHAVE"

# Cadastrar cliente
curl -s -X POST $API/contatos -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"nome":"Maria Exemplo","telefone":"71 99999-0000","aniversario":"14/11"}'

# Conversas abertas na etapa "lead", sem dona
curl -s "$API/conversas?etapa=lead&dona=sem&limite=20" -H "Authorization: Bearer $CHAVE"

# Abrir (ou achar) a conversa de um telefone e mandar mensagem (escopo enviar)
ID=$(curl -s -X POST $API/conversas -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"telefone":"71 99999-0000"}' | jq -r .dados.id)
curl -s -X POST $API/conversas/$ID/mensagens -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"texto":"Oi! Seu horário está confirmado."}'

# Mandar um PDF (até 16 MB; foto, PDF, áudio ou vídeo)
curl -s -X POST $API/conversas/$ID/mensagens -H "Authorization: Bearer $CHAVE" \
  -F arquivo=@tabela.pdf -F legenda="Nossa tabela"

# Mudar etapa; status do cabeçalho (aberto, aguardando, resolvido)
curl -s -X PATCH $API/conversas/$ID -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"etapa":"atendimento"}'
curl -s -X PATCH $API/conversas/$ID -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"status":"aguardando"}'

# Nota interna (a cliente não vê)
curl -s -X POST $API/conversas/$ID/notas -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"texto":"Pediu orçamento de mechas"}'

# Agenda de um dia e de uma profissional
curl -s "$API/agenda?de=2026-10-27&ate=2026-10-27&profissional=<id>" -H "Authorization: Bearer $CHAVE"

# Marcar horário (preferencia: escolhida | sem_preferencia)
curl -s -X POST $API/agenda -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" -d '{
  "cliente": {"contato_id": "<id>"},
  "inicio": "2026-10-28T10:00:00-03:00",
  "servicos": [{"servico_id": "<id>", "profissional_id": "<id>", "preferencia": "escolhida"}],
  "chave_pedido": "6f1c9a0e-1111-4c9d-8e1f-0a1b2c3d4e5f"
}'

# Remarcar sem avisar a cliente / confirmar / cancelar
curl -s -X PATCH $API/agenda/<id> -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"inicio":"2026-10-28T15:00:00-03:00","avisar_cliente":false}'
curl -s -X PATCH $API/agenda/<id> -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" -d '{"status":"confirmado"}'
curl -s -X PATCH $API/agenda/<id> -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"status":"cancelado","motivo":"cliente_desmarcou"}'

# Combinado da conversa (um aberto por conversa) e concluir
curl -s -X POST $API/tarefas -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d "{\"conversa_id\":\"$ID\",\"titulo\":\"Mandar orçamento\",\"vence_em\":\"2026-10-28T09:00:00-03:00\"}"
curl -s -X PATCH $API/tarefas/<id> -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" -d '{"concluida":true}'

# Relatórios
curl -s "$API/relatorios/numeros?periodo=mes" -H "Authorization: Bearer $CHAVE"
curl -s "$API/relatorios/salao?de=2026-10-01&ate=2026-10-25" -H "Authorization: Bearer $CHAVE"

# Página seguinte de uma lista
curl -s "$API/conversas?limite=50&cursor=<proximo_cursor>" -H "Authorization: Bearer $CHAVE"
```

## O que a API ainda não faz

Fechar venda, marcar perdido e "não é cliente", etiquetas, arquivo das mídias (download), anexo de resposta pronta, mensagem programada,
reação, editar/apagar mensagem, caixa/comandas, comissão, estoque, nota fiscal e configurações. Na tela continuam como sempre.
