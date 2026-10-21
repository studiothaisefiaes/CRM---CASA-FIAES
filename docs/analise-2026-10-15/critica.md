**Crítica de completude do desenho "um sistema só" (Casa Fiaes CRM)**

Conferi três pontos além das auditorias, só com leitura. O Postgres de produção é a versão 17.11. A tabela `automations` tem a configuração atual das automações. Um grep no repositório não acha nenhum `mensagem_sem_numero`.

**(a) Partes do pedido sem cobertura**
- **Não existe plano de virada do ChatGuru.** A premissa central é que "ninguém responde pelo CRM", mas nenhum lote leva a equipe do ChatGuru para o CRM. Faltam a data, o critério de "pode desligar", o treinamento e a regra para o período em que os dois sistemas estão ligados no mesmo número (resposta em dobro, boas-vindas em dobro). Também ninguém investigou por que a equipe não usa o CRM hoje (celular? velocidade? hábito?).
- **"Testando com o Avec" ficou sem teste de paridade.** Não há uma lista das funções que a Casa usa no Avec no dia a dia, testada lado a lado. A "rotina diária de envio do relatório de Reservas" não tem responsável. Também não foi verificado se a reimportação do Avec é idempotente.
- **"Veja as funções do ChatGuru" ficou sem a fonte principal.** O CSV do funil e da ficha não foi exportado (`chatguru_records` = 0) e não há um passo "pedir a exportação à Casa" com dono e data. O funil proposto não se baseia no que a Casa usa lá.
- **"Marcar como aguardando" contradiz o próprio desenho.** No ChatGuru, aguardando é um *status*, e o desenho diz que vai "separar status de etapa como no ChatGuru". Mesmo assim cria "Aguardando cliente" como *etapa* no 1C e deixa o status "Resolvido" para o Lote 5. É preciso escolher um modelo só.
- **"Em atendimento tem muita gente" tem duas leituras.** O desenho entende "etapa lotada". O áudio também pode querer dizer "muitas pessoas da equipe atendendo". Vale confirmar com o dono.
- **"Todos os avisos, sem exceção" não está fechado.** Ficaram de fora o "Sua vez" do Quadro (não renomeado), os status e cores da Agenda, as mensagens de erro e confirmação das ações, os estados vazios dos Relatórios fora os dois citados e os títulos de push.
- **Mensagens em áudio ou imagem.** Não há regra de autoria para esses casos. Eles não têm assinatura no texto e provavelmente explicam boa parte dos 12–15% "sem assinatura". A auditoria não separou esses casos.

**(b) Afirmações sem evidência ou erradas**
- **A conta do "Em conversa" está errada.** O desenho diz "cai de 92 para ~5", mas pela própria tabela ficam 5 (Atendimento) + 9 (vindos do Follow-up 1) = **14**.
- **41 ou 42?** O Lote 0 e a Decisão 4 dizem "41 conversas pulam para Follow-up 2". A simulação do funil dá **42** passando de Follow-up 1 para Follow-up 2.
- **Horário "ter–sáb 9–18h".** A auditoria diz "a própria Casa diz", sem citar a fonte. Também faltam almoço e feriados.
- **Prazos de transição** (10/15 min, escala em 30 min): nenhum dado sustenta esses números. Além disso, a escala hoje é a automação `gestao_10min` (gatilho 10 min, com o nome "10 minutos"), que teria de ser editada.
- **"Atendida fecha como ganho em 3 dias" e "ficam com o 'Em conversa' após 4 h de expediente".** São números arbitrários, e o primeiro infla "vendas/ganho" nos relatórios sem nenhum valor ligado.
- **Visibilidade por perfil (Recepção vê 4, 5 e 6).** O perfil Recepção tem 0 pessoas. Não há evidência de como a Casa divide o trabalho.
- **"Fulana está nesta conversa" e "Equipe agora".** Nenhuma auditoria verificou se existe infraestrutura de tempo real ou presença confiável. Os 4 usuários aparecem "Ausente".
- **Contagem de "sem dono" com três bases** (155 / 152 / 108). O teste do 1A depende de 89/51/15, que é uma foto de 15/10. Na hora de rodar vai divergir; o teste precisa recalcular, não comparar com números fixos.
- **"As clientes estão acostumadas à assinatura".** É razoável, mas é inferência.

**(c) Riscos**
- **As automações guardam chaves de etapa no banco.** Os campos `conditions.etapa_em` têm `["lead","atendimento","followup_1"…"followup_4"]` em `gestao_10min`, `atendimento_3min`, `parado_1dia` e `followup_diario`. A ação de `recontato` é `mover_para_etapa: "atendimento"`. O desenho fala em "~40 referências no código", mas **não fala em migrar esse JSON**. Se as etapas forem desativadas ou renomeadas sem isso, os alertas quebram sem aviso.
- **A migração e a importação do Avec vão disparar o motor.** Mover centenas de conversas gera eventos de etapa, e entrar em follow-up dispara aviso. O 14/10 já gerou 162 eventos. O motor precisa ficar pausado durante a migração e as movimentações em massa não podem gerar avisos. Isso não está no desenho.
- **A tabela de migração é uma foto de 15/10.** Quando o 1C entrar ela estará velha. A classificação tem de ser recalculada na hora, com ensaio numa cópia do banco (pg_dump), nunca em produção. O desenho diz "ensaio" mas não diz onde.
- **Produção pode não estar rodando a `rodada-2`.** Existem 11 alertas `mensagem_sem_numero` criados por um código que não está no repositório (grep vazio). Antes de qualquer migration, confirmar qual commit está no servidor.
- **Enum no PG 17.** O `ADD VALUE` funciona dentro de transação, mas o valor novo não pode ser usado na mesma transação. O padrão já existe em `drizzle/0008`, mas os dados precisam ser migrados num passo separado.
- **Automações que mandam mensagem à cliente.**
  - Hoje nenhuma das ligadas manda; só `lembrete_agendamento` e `confirmacao_d1`, que estão desligadas.
  - Os modelos em `templates.ts:55,88,99` ("hora de cuidar dos cabelos", aniversário, "ficou com alguma dúvida") casam exatamente com "Retorno sugerido", aniversário e as 3 tentativas do "Aguardando". O desenho precisa dizer que as tentativas D+1/D+3/D+7 são **tarefas**, não envios.
  - O 6b (D-1) e as "Mensagens automáticas" (boas-vindas, ausência) duplicam a Avec IA e o ChatGuru se forem ligados antes da virada.
  - A mensagem em massa precisa de limite e de confirmação dupla.
- **Dona automática pela assinatura.**
  - A Cati (perfil Gestão) passa a receber ~51 conversas e os alertas de nível 1 delas.
  - Assinatura copiada, citada ou encaminhada pode dar a dona errada.
  - O aviso para a dona quando outra pessoa responde vira ruído (já são 10 casos).
  - Envio pelo CRM de quem não tem assinatura cadastrada (o Joaquim, por exemplo) precisa de uma regra.
- **Permissões.**
  - `config.diaadia` deixa a atendente mexer em preço de Serviços, em Profissionais e nos níveis da Distribuição dos colegas. É largo demais.
  - Os "avisos fixos de dívida ou crédito" no cabeçalho da ficha vazam valor para quem não tem `valores.ver`.
  - Exportar CSV de 6 mil contatos sem uma permissão própria é um risco de LGPD.
- **Buraco no funil.** A cliente que escreve estando em Agendado (4) ou Atendida (5) não tem transição definida, porque só 2, 3, 6 e 7 voltam para 1. Somado à visibilidade por perfil (a atendente não vê a etapa 5), uma mensagem dela pode sumir para quem atende.
- **Regra de 180 dias.** Esconder datas absurdas mascara o erro da importação em vez de corrigir.

**(d) Grande demais para um lote**
- **1B (marcado M, na prática G):** dividir em
  1. textos, seções e a regra única de 60%;
  2. sino e push;
  3. tarefas, Hoje e aniversários.
- **1C (G):** dividir em
  1. refatorar as ~40 referências e o JSON das automações para usar o tipo da etapa, sem mudar comportamento;
  2. etapas e transições novas;
  3. migração dos dados com o motor pausado;
  4. visibilidade por perfil.
- **2 (G):** separar a ficha, o painel da conversa e a lista de Contatos com a visão materializada.
- **1A:** tirar "Equipe agora" e "está nesta conversa" (tempo real) do núcleo de assinatura, autoria e dona.
- **4:** "criar e apagar etapa" depende do 1C(a) e é um projeto à parte.
- **Coisas pequenas que deveriam ir para o Lote 0:** preencher os vínculos profissional × serviço a partir do Avec (destrava o "Agendar"), corrigir o texto falso do aniversário ("mensagem pronta"), o `nextWaitingId` e os 5 códigos crus do Histórico.
- **6:** é a troca do Avec. Precisa de spec própria e de um pré-requisito que não aparece no desenho: a sincronização automática com o Avec.