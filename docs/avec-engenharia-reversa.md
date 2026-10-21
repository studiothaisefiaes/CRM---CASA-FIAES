# Avec por dentro: o que copiar, o que fazer melhor e como sair dele

Análise feita em 14/10/2026 para a Casa Fiaes. Fontes:
- o código público do Avec (site de agendamento, painel e API);
- 15 vídeos oficiais de treinamento (legendas);
- 278 relatórios da API oficial;
- cerca de 150 avaliações do app da profissional (Avec PRO) e de 5 concorrentes;
- o arquivo de clientes exportado do Avec em 14/10.

Nada foi feito com login ou senha de ninguém. Só lemos o que qualquer pessoa vê sem login, e nada foi criado nem enviado no Avec.

Para mostrar o grau de certeza de cada afirmação, o documento usa três marcas:
- **confirmado**: vimos com os próprios olhos, no código, num teste ou em vídeo.
- **provável**: vários indícios apontam para isso, mas não vimos funcionando.
- **inferência**: é a nossa dedução.

---

## 1. Resumo

1. **O que o Avec tem e nós ainda não:** 14 coisas essenciais, todas da agenda. Nossos serviços não têm duração nem preço. Falta a grade com uma coluna por profissional, marcar direto na grade, o horário de trabalho de cada profissional, o bloqueio de folga e almoço e o aviso de conflito pela duração do serviço. Também faltam cancelar com motivo e pôr vários serviços na mesma visita.
2. A equipe ainda não tem login. Faltam o perfil "Profissional", que só vê a própria agenda, e a tela "Hoje" no celular dela. As observações da cliente também não aparecem no horário.
3. Também são essenciais: importar as 6.308 clientes do Avec e uma regra de estabilidade (nunca apagar um horário, nunca atualizar o sistema na sexta).
4. **O ponto fraco do Avec é o app da profissional.** Ele tem nota 2,0 na App Store, enquanto os concorrentes ficam entre 4,8 e 4,9. As queixas mais comuns: pede login várias vezes ao dia, não avisa quando entra uma cliente nova, a agenda do celular é confusa e a comissão não dá para conferir. É aí que ganhamos com mais facilidade.
5. **Como fica a nossa agenda:** cada horário deixa de depender do lead. Ele vira uma *visita* da cliente, e a visita pode ter vários serviços, cada um com a sua profissional e o seu horário.
6. A recepção vê o dia em colunas, uma por profissional. Para marcar, toca num espaço livre; para remarcar, arrasta. O sistema avisa do conflito e deixa "encaixar mesmo assim" de propósito.
7. Cada profissional recebe um convite pelo WhatsApp e passa a ter o próprio login. No celular, abre direto em "Hoje": a próxima cliente, a observação dela e a linha do dia. Recebe aviso quando a cliente chega e não vê nada do restante da Casa.
8. **Como migrar:** em ordem, levamos clientes, serviços (com preço e duração), profissionais, quem faz o quê e horários. Depois vêm a agenda futura e o histórico. Parte sai do próprio Avec sem login; a outra parte é Excel que a Thaise exporta do painel.
9. A virada acontece numa segunda ou terça de manhã. No mesmo dia é preciso desligar no Avec o agendamento online e a Avec IA, para nenhuma cliente marcar numa agenda que ninguém olha e para ela não receber duas confirmações.
10. **Aviso de segurança para a Thaise:** o Avec deixa aberto na internet, sem login, o CPF, o e-mail, o celular e os dados bancários das profissionais da Casa. Não copiamos nada disso. Vale avisar o Avec e as profissionais.

---

## 2. O que descobrimos por dentro do Avec

### 2.1 Como o Avec é montado

| Parte | O que é | Confiança |
|---|---|---|
| Site da cliente | Feito em Next.js, em avec.app e booking.avec.beauty | confirmado |
| API | api.avec.beauty, com as rotas em português (`/salao/{id}/...`) | confirmado |
| Painel do salão | Sistema antigo em PHP + jQuery, em admin.avec.beauty/{slug}/admin, com login pela Amazon (Cognito). É o herdeiro do "SalãoVIP" | confirmado |
| App da profissional | "Avec PRO", um app separado (iOS e Android, este com pacote `br.com.salaovip.terminal`) | confirmado |
| Empresa | Hyperlocal (Joinville/SC), que também é dona do Beauty Date e do Avec Pay e comprou o Beleza Soft | provável |

**Dados da Casa no Avec** (confirmado, API pública):
- O salão tem id **62004** e endereço `studiothaisefiaes`. O contrato existe desde 24/07/2025.
- No agendamento online estão 42 serviços em 9 categorias e 11 profissionais.
- Regras do online: até 60 min de antecedência, até 40 dias à frente, grade de 30 min e sem cartão obrigatório.

**Horário da Casa:** no Avec, o horário vale para o salão inteiro (`profissional_id = 0`). **Ninguém tem horário próprio cadastrado.** Existe uma linha de terça a sábado das 9h às 18h e outra só de domingo das 9h às 18h, então o Avec mostra a Casa fechada só na segunda. Precisamos confirmar com a Casa se o domingo é verdade. O nosso horário padrão no código (seg–sex 8–20, sáb 8–17) não bate com nenhum dos dois.

### 2.2 As rotas e o que cada uma revela

**Públicas (sem login, chamadas pelo próprio site do Avec):**

| Rota | O que devolve | Confiança |
|---|---|---|
| `GET /salao/{id}` e `/salao/slug/{slug}` | Regras do salão: antecedência, limite de dias, grade, "sem preferência", se o salão usa a Avec IA (cerca de 105 campos) | confirmado |
| `GET /salao/{id}/horario_estabelecimento?todos=1` | Expediente. Os dias da semana vêm numa máscara que começa na **segunda** (`0,1,1,1,1,1,0`), as horas em minutos desde a meia-noite (540 = 9h), com período de validade e exceção por data | confirmado |
| `GET /salao/{id}/categorias` | As 9 categorias | confirmado |
| `GET /salao/{id}/servicos/online?status=1` | Os 42 serviços com duração, preço, tipo de preço (fixo, "a partir de", "sob consulta"), se pode ser feito junto com outro, folga depois e prazo de retorno | confirmado |
| `GET /salao/{id}/profissionais?status=1&status_agenda_online=1` | As 11 profissionais com apelido, cargo, cor, ordem na agenda e passo da grade | confirmado |
| `GET /salao/{id}/profissional/{pid}/servicos` | O que **uma** profissional faz, com duração, preço e comissão próprios | confirmado |
| `GET /salao/{id}/servico/{sid}/profissionais` | Quem faz **um** serviço. ⚠️ Devolve também CPF, e-mail, celular e dados bancários das profissionais | confirmado |
| `GET /salao/{id}/agenda/servico/{sid}?data=AAAA-MM-DD` | Horários livres do dia: para cada horário, quais profissionais estão livres. Não mostra quem está marcado | confirmado |
| `/promocoes`, `/pacotes/online/online`, `/avaliacoes`, `/galeria` | Promoções, pacotes, avaliações e fotos | confirmado / provável |

**Que pedem login (só lidas no código, nunca chamadas):**
- **Da cliente:** `POST /salao/{id}/reservas` cria a reserva, com a hora em minutos e "sem preferência" = profissional 0. Há também `GET`/`DELETE /reserva/{id}`, `/cliente/agendamentos` e `/cliente/signin`.
- **Do painel:** `admin/profissional/*` (cadastrar, transferir reservas, acessos, "master"), `admin/servicos/*`, `admin/recursos/*` (salas e aparelhos), `admin/clientes/listajson`, `admin/financeiro/solicitar-recalculo` (recalcular comissão até 45 dias para trás).

### 2.3 API de Relatórios (a oficial)

- **278 relatórios**, os mesmos do menu do painel. São só de leitura e ficam em `api.avec.beauty/reports/{código}`, com página e limite, e quase todos pedem um período (dd/mm/aaaa). (confirmado)
- O acesso exige um token que a documentação não explica como obter. Sem token a resposta é "Não autenticado". O caminho é **a Thaise pedir o token ao suporte** ou exportar em Excel pelo menu Relatórios. (confirmado)
- As colunas que cada relatório devolve **não estão documentadas**. Antes de escrever o importador da agenda, precisamos de uma exportação de teste. (confirmado)
- Os relatórios que nos interessam:

| Para quê | Relatórios |
|---|---|
| Clientes | 0004 (base inteira), 0012 (por data de cadastro), 0010/0018/0210 (duplicados) |
| Agenda futura | 0051 (clientes com agendamento), 0151 (por profissional), 0248 (por status), 0159 (bloqueios) |
| Histórico | 0186 (todos os itens das comandas), 0180, 0129 (resumo por cliente e profissional) |
| Serviços e equipe | 0033/2033 (tabela de preços), 0229 (lista de profissionais) |
| Comissões | 7123 (líquida), 0123/8123 (detalhada), 0028 (pagas) |
| Saldos | 0006 (créditos e débitos), 0063 (pacotes ativos), 0087 (vales-presentes) |
| O que **não existe** | relatório de jornada de trabalho, de regras de comissão, de permissões e de anexos. Isso vai por print ou pelo pedido formal (LGPD) |

### 2.4 Como a agenda do Avec funciona (pelos vídeos oficiais, confirmado)

- **Tela principal:** uma coluna por profissional, com 3 a 12 por página e filtro por nome. Cada coluna tem a cor e a ordem definidas no cadastro.
- **Marcar:** a recepção clica no horário livre e abre a "Reserva". Busca a cliente por nome, telefone, e-mail ou CPF, e se ela não existir cadastra ali mesmo. Só aparecem os serviços que aquela profissional faz, e o horário fica ocupado pela duração do serviço.
- **Vários serviços:** com "Adicionar serviço" o próximo entra logo em seguida. Com Ctrl/Shift + clique dá para usar várias profissionais ao mesmo tempo, por exemplo mão com uma e pé com outra às 14h.
- **Conflito:** o Avec avisa e oferece "forçar encaixe".
- **Remarcar:** arrastando o bloco para outro horário ou para a coluna de outra profissional.
- **Sem preferência:** a reserva aparece listrada, e a recepção sabe que pode mudá-la de profissional.
- **Status:**
  - Agendado (verde) → Confirmado (pela Avec IA ou à mão);
  - → Aguardando (automático ao abrir a comanda, e manda aviso para a profissional);
  - → Em atendimento → Finalizado (esses dois são à mão);
  - → Pago (automático ao fechar a comanda).
  - Existem também Cancelado e status personalizados. A regra ensinada nos vídeos é "no fim do dia a agenda tem que estar toda vermelha" (toda paga).
- **Cancelar:** pergunta se cancela "só este" ou "todos os próximos". O horário cancelado sai da grade, mas continua no histórico.
- **Recorrência:** a cada N semanas, terminando depois de N vezes ou numa data.
- **Bloqueio:** para uma profissional ou para todas, por um período (um dia, uma semana, 15, 30 ou 60 dias, um ano ou sem fim), com motivo (folga, almoço, atestado, feriado) e dias da semana fixos.
- **Serviço junto com outro** ("nível paralelo"):
  - **Livre:** pode acontecer ao mesmo tempo que outro.
  - **Parcial:** só junto com um Livre.
  - **Restrito:** nunca junto.
  - Na Casa: 36 serviços são Parcial, 6 são Livre e nenhum é Restrito.
- **Folga depois do serviço:** de 0 a 120 min. Na Casa, 18 serviços têm folga; o corte, por exemplo, tem 30 min.
- **Salas e aparelhos:** um recurso com quantidade, ligado ao serviço. Não sabemos se a Casa precisa disso.
- **Rodízio (fila da vez):** para atender quem chega sem hora marcada. A Casa trabalha com hora marcada.

### 2.5 Cadastro da profissional e acesso (confirmado)

- **Cadastro:** nome, apelido (o nome que aparece na agenda), cargo e "possui agenda" (a recepção não marca essa opção). Também: cor, ordem, passo da grade (10 profissionais da Casa usam 30 min e uma usa 60), regime de contratação e prazo de pagamento.
- **Login:** a profissional também é usuária do sistema, com e-mail, senha e "grupo de acesso". O grupo pronto "Profissional" vê **só a própria agenda e as próprias comissões**. Uma pessoa é a "master", com acesso total.
- **Quem faz o quê:** para cada profissional, a lista de serviços que ela faz. Cada um com comissão própria (na Casa, o corte vai de 0 a 65% conforme a profissional), comissão como assistente e, se for o caso, duração e preço próprios. Nos dados da Casa, porém, a duração e o preço são iguais para todas.

### 2.6 Avec PRO, o app da profissional (confirmado, pela loja, pelos vídeos e pelas avaliações)

- **O que tem:**
  - agenda do dia;
  - marcar horário e abrir ou fechar comanda, se ela tiver permissão;
  - comissões (pagas e a receber, com os descontos);
  - histórico das clientes atendidas, só para leitura;
  - ficha de anamnese;
  - aviso quando entra horário novo e quando a cliente chega.
- **Notas:** 2,0 na App Store (370 avaliações) e 3,6 no Google Play (853). Os concorrentes: Trinks 4,77, Gendo 4,81, Belasis 4,86 e AppBarber 4,89.
- **Do que as profissionais reclamam**, por ordem de frequência:
  1. Desloga de 2 a 10 vezes por dia, e a biometria foi retirada.
  2. Não avisa de cliente nova, de cancelamento nem de cliente que chegou.
  3. A agenda do celular virou uma cópia da tela do computador (redesign de julho de 2026), e agora é preciso rolar e abrir horário por horário.
  4. A comissão aparece sem o valor do serviço e sem o %, e ninguém consegue conferir.
  5. Remarcar e bloquear pelo celular é difícil.
  6. As observações da cliente sumiram do agendamento.
  7. Atualizações em plena sexta-feira, e um caso de agendamentos apagados.
  8. Suporte só por robô.
- **O que pedem:** uma tela só para o dia, passar o dedo para trocar de dia, widget da agenda, ver só o que é dela, buscar horário livre em todas as profissionais e a opção "sem preferência".

### 2.7 Agendamento online e Avec IA

- **Agendamento online** (confirmado): `booking.avec.beauty/saloes/studiothaisefiaes/agendar`, em 6 etapas: serviços, profissional, data, resumo, login e fim. Aceita vários serviços e "sem preferência", e no fim gera um arquivo para salvar no calendário. O servidor recusa por estes motivos:
  - horário ocupado;
  - fora do expediente;
  - a cliente já tem horário na mesma faixa;
  - antecedência menor que a mínima;
  - cartão obrigatório;
  - nenhuma profissional livre;
  - cliente bloqueada.
- **Avec IA** (confirmado em vídeo; a Casa tem a IA ligada): confirma a presença no dia anterior em 4 envios (10h, 14h, 18h e 21h). A resposta da cliente muda o status, e a IA pode cancelar ou remarcar. **Se ligarmos a nossa confirmação sem desligar a dela, a cliente recebe duas.**

### 2.8 O que ficou sem resposta

- **Avec PRO por dentro:** não vimos as telas internas, só a loja, os vídeos e as avaliações.
- **Status da agenda:** não sabemos os códigos numéricos de cada status no relatório 0248.
- **Luzes e Mechas:** confirmar se o valor de 1158 em "Luzes e Mechas" é em reais.
- **Colunas dos relatórios:** quais colunas cada relatório devolve (só duas foram citadas em vídeo).
- **Saldos da Casa:** se a Casa tem pacotes ou vales em aberto.
- **Salas e aparelhos:** se a Casa tem maca ou aparelho disputado entre profissionais.

---

## 3. Como vai ser a NOSSA agenda

### 3.1 A ideia central

Hoje o horário fica preso ao **lead** (a conversa de venda). Por isso a recepção não consegue:
- marcar dois serviços na mesma visita;
- marcar uma cliente antiga que ligou e não tem conversa aberta.

O novo desenho separa as duas coisas:
- **Visita**: a cliente vem num dia. Pode ter um lead ligado, ou não ter.
- **Itens da visita**: cada serviço, com a sua profissional, o horário de início, a duração, o preço daquele momento e o status.
- **Histórico**: toda mudança fica registrada com quem fez e quando. **Nada é apagado.** O que é cancelado fica marcado como cancelado.

Para não quebrar o que já existe (Quadro, Hoje, lembretes, relatórios), o sistema copia automaticamente para o lead o próximo horário futuro daquela cliente.

O que entra no cadastro:
- **Serviço:** duração, preço, tipo de preço, folga depois, se pode ser feito junto com outro e categoria.
- **Profissional:** apelido, cor (de uma paleta fechada de 12), ordem na agenda, se atende clientes, e o login dela (opcional).
- **Quem faz o quê:** a duração, o preço e a comissão daquela profissional para aquele serviço. Se ficar vazio, vale o valor do serviço.
- **Horário de trabalho:** da Casa e de cada profissional, com data de início e de fim.
- **Bloqueios:** folga, almoço, atestado, feriado ou curso.

### 3.2 Tela "Dia", na recepção (computador e iPad)

1. **Topo:** a data grande ("Quinta, 16 de outubro"), as setas ‹ Hoje ›, a escolha entre Dia e Semana, o campo "Buscar cliente" e os botões **Bloquear** e **Marcar**.
2. **Faixa "Agora"**, logo abaixo e sempre visível. Mostra quem chega nos próximos 30 min, quem está atrasada (10 min sem chegar), quem está na cadeira e quem falta pagar. Cada item já traz o próximo botão ("Chegou", "Fechar venda").
3. **Grade:**
   - As horas ficam presas à esquerda, em linhas de 30 min com um traço fino a cada 15.
   - Há uma coluna para cada profissional que trabalha no dia, na ordem definida.
   - No topo de cada coluna: a bolinha com a cor dela, o apelido e "6 clientes · 5h30", com uma barra de ocupação.
4. **O que aparece na grade:**
   - Fora do expediente da profissional: uma hachura leve.
   - Bloqueio: cinza, com o motivo escrito.
   - Hora atual: uma linha dourada.
   - Quando as colunas não cabem, a grade rola para o lado e as horas continuam presas.
5. **O cartão do horário:**
   - Num horário de 30 min aparece "10:00 Paula S. · Corte".
   - Num maior: nome, serviços, status, ícone de nota e os selos "primeira vez" ou "qualquer uma".
   - Os serviços da mesma visita ficam ligados por um ponto da mesma cor.
6. **Tocar no cartão** mostra a cliente, o serviço, a profissional e o horário, além de "Última visita: 12/08, Luzes". Os botões são: próximo status, Abrir conversa, Fechar venda, Remarcar e Cancelar.
7. **No celular da recepção:** uma profissional por vez, trocando com o dedo numa faixa de fotos. O modo "Todas" é a lista por hora que já existe hoje.

### 3.3 Marcar

Um formulário só, sem etapas, que já vem preenchido quando a recepção toca num horário livre:

1. **Cliente:** digita ou cola o telefone, ou digita o nome. Cada resultado mostra a última visita. "Nova cliente" pede só o nome e o celular.
2. **Serviço(s):** botões por categoria, com duração e preço. Só aparecem os que aquela profissional faz.
3. **Profissional:** a da coluna tocada, ou a preferida da cliente, ou "Qualquer uma".
4. **Dia e hora:** já vêm da grade. Aparece "Termina 11:20" e sugestões dos próximos horários livres.
5. **Observação deste horário.**
6. **"+ Adicionar serviço":** oferece "logo depois" ou "ao mesmo tempo com outra profissional", mostrando quem está livre.
7. **"Repetir":** a cada 1, 2, 3 ou 4 semanas, até uma data ou um número de vezes. Antes de salvar, mostra quais horários batem com folgas.
8. **Rodapé:** o botão **Marcar** e a opção "Mandar confirmação no WhatsApp", com o texto pronto para editar.

Embaixo do horário aparece na hora "Livre", ou o conflito exato ("Ana já tem Paula das 10:00 às 11:20").

### 3.4 Conflito e encaixe

- Quem decide se há conflito é o **servidor**, não a tela. Um horário conflita com outro da mesma profissional quando:
  - os dois se sobrepõem, contando duração + folga;
  - e a regra de "junto com outro" não permite (Livre com Livre pode; Livre com Parcial pode; Parcial com Parcial não pode).
- Também é conflito:
  - marcar dentro de um bloqueio;
  - marcar fora do expediente;
  - a mesma cliente já ter outro horário na mesma faixa.
- Quando há conflito, o botão vira **"Encaixar mesmo assim"**. Só aparece para quem tem essa permissão, e o encaixe fica registrado. Na grade, os dois horários aparecem lado a lado, em meia largura, com borda tracejada.

### 3.5 Remarcar, cancelar e bloquear

- **Remarcar no computador ou no iPad:**
  - A recepção arrasta o cartão; ele se ajusta a cada 15 min.
  - Enquanto arrasta, as colunas de quem não faz o serviço ficam apagadas e o conflito aparece na hora.
  - Ao soltar, nenhuma pergunta: aparece "Movido para qui 14:30 com Bia · Desfazer" por 8 segundos, com o botão "Avisar cliente" (abre a conversa com o texto pronto).
  - Puxar a borda de baixo do cartão muda a duração.
- **Remarcar no celular:** tocar no cartão, depois "Remarcar", e escolher numa lista dos próximos horários livres.
- **Cancelar:**
  - Escolhe o motivo: a cliente desmarcou, a Casa desmarcou, não confirmou ou outro.
  - Se a visita se repete, pergunta se cancela "só este" ou "este e os próximos".
  - O horário sai da grade, mas continua no filtro "Cancelados" e na ficha da cliente.
- **Bloquear:**
  - Escolhe quem (uma profissional ou todas), quando (hoje, um período ou repetir em certos dias até uma data), das/até e o motivo.
  - Se já houver clientes dentro do bloqueio, mostra quais são e oferece movê-las.
  - Atalho: arrastar num espaço vazio segurando Alt (no iPad, toque longo).

### 3.6 Status de cada serviço

| Status | Como aparece | Quem muda |
|---|---|---|
| Marcado | contorno neutro | quem marcou |
| Confirmado | ponto verde | a enquete do dia anterior (um voto confirma a visita inteira) ou a recepção |
| Chegou | fundo âmbar claro | a recepção. **Avisa a profissional no celular** |
| Em atendimento | fundo azul | a profissional ("Começar") ou a recepção |
| Concluído | grafite com ✓ | a profissional ("Concluir") ou a recepção |
| Pago | selo R$ | automático, quando a venda é fechada |
| Faltou | riscado em vermelho | a recepção (a profissional só com permissão e 15 min depois do início) |
| Cancelado | sai da grade | a recepção |
| Conferir | contorno âmbar | automático, quando o horário passou sem "chegou" nem "faltou" |

Meta do dia: tudo em Pago ou Faltou. Quando isso acontece, aparece "Dia fechado".

### 3.7 Semana, horários e ligação com o resto

- **Semana:**
  - Continua a grade de 7 dias que já existe.
  - Ganha o modo "Por profissional": cada linha é uma profissional, cada coluna é um dia, e a célula mostra o número de clientes, a ocupação ou "folga". Tocar abre o dia.
- **Horários:**
  - Em Configurações › Pessoas › profissional › Horário: os 7 dias com liga/desliga e "das/até" (até duas faixas por dia), o botão "Igual ao da Casa" e "Vale a partir de".
  - Em Horários da Casa: a semana padrão e as "Próximas exceções" (fim de ano, Carnaval). Feriado vira bloqueio para todas.
- **WhatsApp:**
  - O botão "Agendar" da conversa abre o mesmo formulário Marcar.
  - O painel "Próximos livres" tem "Copiar opções", que cola na mensagem "Tenho quinta 10h com a Ana ou 14h30 com a Bia".
  - Na conversa, um cabeçalho fixo mostra "Próximo horário: qui 16 10:00 · Corte com Ana · confirmado".
  - A enquete do dia anterior passa a confirmar a visita inteira. Se a cliente responder "Preciso remarcar", ela recebe 3 horários livres.
- **Fechar venda:**
  - Abre a partir do cartão, da faixa "Agora" ou da conversa, já com os serviços do dia daquela cliente (serviço, profissional e preço).
  - Permite somar um extra, dar desconto e dividir o pagamento.
  - Guarda a comissão daquele momento, para que uma mudança de regra não mexa no passado. É uma tela só, sem a palavra "comanda".
- **Tempo real:** a tela atualiza sozinha e muda na hora, desfazendo a mudança se o servidor recusar. Tudo funciona no fuso da Bahia.

### 3.8 O celular da profissional

É o mesmo sistema, aberto com o perfil "Profissional". Não é um app de loja.

**Entrada**
1. A dona liga, na ficha da pessoa, a opção "Entra no sistema", e o convite vai pelo WhatsApp da própria profissional. Ninguém cria senha por ela.
2. Ela abre o link, cria a senha (ou usa Face ID ou digital) e segue um passo a passo com imagens para pôr o sistema na tela inicial do celular. No iPhone isso é obrigatório para receber os avisos.
3. Ela toca em "Ativar avisos" e recebe um aviso de teste na hora.
4. **A sessão não cai:** cada vez que ela abre o sistema, a sessão se renova, e só expira depois de 90 dias sem uso. Hoje são 30 dias fixos, e isso precisa mudar. O sistema nunca pede login no meio de um atendimento.
5. O menu de baixo tem só **Hoje, Semana, Clientes e Ganhos**.

**Tela Hoje** (tudo numa tela, sem copiar o computador)
1. No topo: "Bom dia, Ana", e embaixo "Quinta, 16 de out · 6 clientes · 09:00–17:30".
2. Um cartão grande com a **próxima cliente**: "10:00 · em 25 min · Paula Souza · Corte feminino · 1h20". Mostra o status e a linha da ficha técnica sempre visível ("Alérgica a amônia · prefere pouco volume"). Quando a recepção marca "Chegou", o cartão pulsa e o botão vira **Começar**.
3. Abaixo, a linha do dia. Cada linha mostra o horário, a cliente, o serviço, a duração, o status e um ícone de nota. Os espaços vazios aparecem como "Livre 11:20–13:00" e o almoço como "Almoço 12:00–13:00". Os horários já feitos ficam recolhidos no topo ("3 feitos").
4. Passar o dedo para o lado troca o dia, e puxar para baixo atualiza.
5. Selos: "primeira vez", "qualquer uma" (a cliente não pediu ninguém) e "aniversário esta semana". Num dia sem clientes aparece "Dia livre"; numa folga, "Folga".

**O que ela pode fazer**
- **Começar e Concluir.** Ao concluir, aparece "Fez algo a mais?", que vira uma sugestão para a recepção cobrar.
- **Editar a ficha técnica da cliente** (fórmula, produtos, preferências) e a observação do horário.
- **Bloquear o próprio horário.** Pode ser direto ou como pedido para a recepção aprovar; a dona escolhe.
- **Marcar ou remarcar na própria coluna**, só se a dona permitir.

**Ficha da cliente:**
- O que mostra: nome, foto do WhatsApp, aniversário, "cliente desde", ficha técnica, as visitas anteriores (inclusive as do Avec) e "volta a cada 35 dias".
- O que não mostra: o telefone fica escondido, a menos que a dona libere.

**Ganhos** (só se a comissão estiver configurada)
- Hoje, semana e mês, com o valor líquido em destaque.
- Cada linha mostra a conta inteira: "Paula · Corte · R$ 180 × 40% = R$ 72,00 − taxa do cartão R$ 2,16 = R$ 69,84".
- Um horário concluído e ainda não pago aparece em cinza ("aguardando fechamento").

**Avisos no celular**
- Cliente nova, horário remarcado (de quando para quando), cancelado, cliente chegou e, se ela quiser, cliente confirmou.
- Os avisos ficam em silêncio fora do expediente dela.
- Há uma página "Avisos" com as últimas 48 horas, para quando um aviso não chegar.

**Sem internet:** o celular guarda o dia de hoje e o de amanhã, mostra "Sem internet · mostrando 09:42" e deixa só olhar, sem fazer ações.

**O que ela NÃO vê.** O bloqueio é feito no servidor, não só escondendo a tela:
- Fila, conversas do WhatsApp, leads, Quadro e Relatórios.
- Faturamento da Casa e comissões das colegas.
- Configurações.
- Clientes que ela nunca atendeu.
- A agenda das colegas. Ela só vê, para leitura, se a dona liberar.
- CPF e endereço, que nem entram no sistema.

**Visual:** padrão do iPhone de verdade. Títulos grandes, listas agrupadas, botões de 44 px, modo escuro, respeito ao tamanho de letra do aparelho e animação curta só na troca de status e de dia.

---

## 4. Migração do Avec

**Regras para todos os passos:**
- Fazer backup antes de começar.
- Rodar cada passo primeiro no banco de teste, com uma prévia que gera planilhas de conferência. Só depois rodar em produção.
- Em produção, gravar em blocos de 500, de um jeito que dê para repetir sem duplicar nada.
- **CPF, RG e endereço nunca são lidos nem gravados.**

### 4.1 Ordem

| # | O quê | De onde vem | Quem faz |
|---|---|---|---|
| 1 | Clientes | o arquivo de 14/10 (6.308 linhas) | nós |
| 2 | Serviços, preços e durações | API pública (42 serviços). Os que não estão no online saem do Excel 0033/2033 | nós + Thaise |
| 3 | Profissionais | API pública (11). A recepção e quem não está no online saem do 0229 | nós + Thaise |
| 4 | Quem faz o quê | API pública, uma consulta por profissional (a rota que **não** traz dados pessoais) | nós |
| 5 | Horários de trabalho | API pública (só traz o da Casa). O de cada profissional vem por print | Thaise |
| 6 | Agenda futura e bloqueios | Excel 0051/0151 + 0159, de hoje até o último horário marcado | Thaise exporta, nós importamos |
| 7 | Histórico de atendimentos | Excel 0186, mês a mês desde 2020 | Thaise exporta, nós importamos |
| 8 | Comissões em aberto e saldos | 7123/0123, 0006, 0063 e 0087, na véspera da virada | Thaise |
| 9 | Virada | ver 4.4 | todos |

**Detalhes de cada passo:**
- **Serviços:** casam com os que já existem pelo nome, com uma tela de conferência para os que não batem. O prazo de retorno do Avec só entra onde o nosso estiver vazio.
- **Profissionais:** entram sem login. Cada uma cria o próprio acesso pelo convite.
- **Quem faz o quê:** só guardamos duração, preço e comissão. As regras de desconto da comissão vêm por print de Configurações › Comissões.
- **Horários:** convertemos a semana do Avec (que começa na segunda) para a nossa (que começa no domingo).
- **Agenda futura:**
  - Antes de tudo, pedimos uma exportação de teste para ver as colunas.
  - Cada linha vira um serviço de uma visita. A cliente casa pelo telefone, e se não existir é criada.
  - Os bloqueios viram bloqueios.
  - Na conferência, comparamos dia a dia com os horários livres que o Avec mostra publicamente.
- **Histórico:**
  - Entra como visitas concluídas e pagas, marcadas como "Avec". Não cria vendas novas, para não inflar os relatórios.
  - Preenche "último atendimento" e confirma quem é cliente de verdade.
  - Também define a profissional preferida (a mais frequente nos últimos 6 meses).
- **Saldos:**
  - Créditos, pacotes e vales entram como nota fixada na ficha ("Pacote 3/5 escovas · Avec").
  - A Casa paga as comissões do período em curso pelo Avec.

### 4.2 O arquivo de clientes (14/10)

**Uma planilha, 6.308 linhas e 20 colunas, com cadastros de 01/2020 a 14/10/2026.**

| Coluna | Preenchida | Vai para | Observação |
|---|---|---|---|
| Cliente | 100% | nome | 1.954 em MAIÚSCULAS, 142 em minúsculas, 304 com apelido entre parênteses, 2 começando com ": " |
| Código | 97% | código do Avec (para não duplicar se importar de novo) | 172 vazios, 3 repetidos |
| Aniversário | 61% | dia, mês e ano | 1.089 sem ano; 28 com ano absurdo (ano só vale entre 1920 e 2020) |
| Celular | 96% | **telefone principal** | 1.617 sem o 9 da frente; 19 sem DDD |
| Telefone | 4% | telefone, só se não houver celular; senão vira segundo telefone | máscara quebrada; em 138 de 187 é igual ao celular |
| E-mail | 50% | e-mail, só se o nosso estiver vazio | 15 inválidos, 104 repetidos |
| Como Conheceu | 15% | origem + texto original | 69 jeitos de escrever. "Instagram", "Indicação" e cerca de 190 "CLIENTE <profissional>" |
| Cadastrado | 100% | "cliente desde" | — |
| Obs | 8% | anotações, com "[Avec]" na frente | 181 dizem "interessada", ou seja, são **leads**, não clientes |
| Sexo, Profissão, Cidade/UF | 15–100% | só como informação extra do Avec, ou não importar | "P" em Sexo é o padrão de "não informado" |
| CPF, RG, CEP, Endereço, Número, Complemento, Bairro | — | **não importar** (LGPD) | — |

**Arrumação do telefone** (o campo mais importante, porque no CRM cada contato precisa de um celular único):
- Usar o Celular primeiro; o Telefone só se o Celular não servir.
- Pôr o 9 nos números de 10 dígitos que começam com 6 a 9.
- Pôr o DDD 71 nos números de 9 dígitos que começam com 9.
- Descartar os números de 11 dígitos cujo 3º dígito não é 9.
- Telefone fixo fica guardado, mas não vira o telefone principal.
- **Resultado esperado:** cerca de 6.057 com celular válido e cerca de 251 sem telefone. Esses vão para uma planilha de pendências; os 182 que não têm nem telefone nem e-mail ficam de fora.

**Duplicados dentro da própria planilha** (236 números aparecem em mais de uma linha):
- **Mesmo nome ou mesmo primeiro nome (131 grupos):** é a mesma pessoa. Fica o cadastro mais antigo, os outros dados completam o que falta, e todos os códigos ficam guardados.
- **Pessoas diferentes no mesmo número (105 grupos, por exemplo mãe e filha):** só uma vira contato. As outras ficam anotadas na ficha ("número também cadastrado para: …") e vão numa planilha para a equipe decidir. **Nunca inventamos telefone.**

**Casamento com quem já está no CRM**, nesta ordem:
1. Celular igual.
2. Segundo telefone do Avec igual ao celular do CRM.
3. E-mail igual, só quando o e-mail for único nos dois lados.

**O nome nunca casa sozinho.** Há 148 nomes repetidos e 120 homônimos com telefones diferentes.

**Quando a cliente já existe no CRM, só preenchemos o que está vazio:**
- O nome do CRM fica como está.
- E-mail e aniversário entram só se estiverem vazios.
- Marca como **Cliente**, exceto as "interessadas" (leads). Quem já é cliente nunca volta a ser lead.
- A anotação do Avec é acrescentada sem apagar nada e sem repetir se importarmos de novo.
- **Não cria lead nem venda.** As 6 mil entram sem encher a Fila, e a data de criação é a data da importação, para os relatórios de "contatos novos" não explodirem.

**Limpeza do nome:**
- Tirar o ": " do começo.
- Separar o apelido entre parênteses, que fica guardado à parte.
- Ajustar maiúsculas e minúsculas no padrão brasileiro ("Maria da Silva") quando o nome está todo em maiúsculas ou todo em minúsculas.
- Os 18 nomes com números vão para revisão.

**"Como Conheceu" vira categoria:** instagram, indicação, profissional, site/google, tiktok, passante, cliente antiga ou outros. O "on" é sujeira da exportação e é descartado. Os "CLIENTE <profissional>" (3 profissionais concentram quase todos) definem a **profissional preferida** da cliente depois do passo 3.

**O que o nosso importador atual já faz e o que falta:**
- **Já existe** (`src/server/domain/import.ts`, botão em Contatos), com limite de 10 mil linhas. Ele lê o Celular antes do Telefone, aceita aniversário sem ano e lê "Cadastrado", "Como Conheceu" e "Código".
- **Falta:**
  - aceitar o arquivo **.xlsx** (hoje só lê .csv);
  - importar a coluna **Obs**;
  - não marcar como cliente quem é "interessada";
  - limpar o nome e o apelido;
  - separar o segundo telefone;
  - deduplicar dentro da planilha;
  - gerar a prévia com as planilhas de conferência.

### 4.3 O que depende da Thaise

- O link do agendamento online, para confirmar que `studiothaisefiaes` é o salão 62004.
- Os Excel dos relatórios 0229, 0033, 0051/0151 (agenda futura), 0159, 0186 (histórico), 0006, 0063 e 7123.
- Prints da aba "Serviço e Comissão" e de "Horário de trabalho" de cada profissional, e de Configurações › Comissões.
- Confirmar o horário da Casa (abre domingo?) e se existe maca ou aparelho disputado.
- Pedir ao suporte o token da API de Relatórios (opcional, mas poupa trabalho).

### 4.4 A virada

1. **Quando:** numa segunda ou terça de manhã, **nunca na sexta**.
2. **Na véspera:** a Thaise exporta a agenda futura, os bloqueios, os saldos e as comissões em aberto.
3. **Na manhã:**
   - Importamos tudo e conferimos com a recepção, profissional por profissional.
   - A partir daí, **toda marcação nova é feita só no CRM**.
4. **No mesmo dia:**
   - Desligar no Avec o agendamento online e a Avec IA.
   - Trocar o link do Instagram pelo WhatsApp.
   - Ligar a nossa enquete do dia anterior e o lembrete, que hoje estão desligados.
5. **Primeira semana:**
   - O Avec fica só para consulta e para fechar comanda e caixa, até o nosso "Fechar venda" com vários serviços ficar pronto.
   - Se nesse período a venda tiver que ser lançada nos dois sistemas, a meta é que isso dure menos de 2 semanas.
6. **Antes de cancelar o contrato:** fazer o pedido formal pela LGPD ao suporte, com a exportação completa (inclusive anexos, regras de comissão e jornadas), e guardar junto do backup.

**Aviso à Thaise (segurança).** A rota pública `/salao/62004/servico/{id}/profissionais` mostra, para qualquer pessoa, CPF, e-mail, celular e dados bancários das profissionais. Isso não foi copiado e não será. A migração usa a outra rota, e qualquer campo pessoal é descartado na leitura. Vale avisar o Avec e as profissionais.

---

## 5. Matriz completa (essencial primeiro)

Legenda da coluna "Nós": **não** = não temos; **parcial** = temos uma parte; **sim** = já temos.

### Essencial (14)

| Funcionalidade | Avec | Nós | Prioridade | Como faremos melhor |
|---|---|---|---|---|
| G01 Serviço com duração, preço e tipo de preço | tem (42 serviços, duração de 30 a 480 min) | não (o serviço é só um nome) | essencial | Configurações › Serviços por categoria, com duração em passos de 15 min e preço; os 42 já vêm do Avec preenchidos, a Casa só confere |
| G03 Dia em colunas por profissional | tem (3 a 12 colunas por página) | parcial (lista por hora com filtro) | essencial | Uma coluna só para quem trabalha no dia, com barra de ocupação e linha do agora; rola para o lado em vez de paginar; no celular, uma profissional por vez trocando com o dedo |
| G05 Marcar direto na grade, buscando a cliente por telefone ou nome | tem | parcial (só a partir de um lead, ou criando "Novo lead" antes) | essencial | Toque no horário livre → formulário Marcar; aceita colar o telefone, mostra a última visita, "Nova cliente" só com nome e celular |
| G06 Horário de trabalho da Casa e da profissional | tem (na Casa só o do salão está cadastrado) | parcial (só o da Casa, e o padrão não bate) | essencial | 7 dias com liga/desliga, "Igual ao da Casa", "Vale a partir de"; conferir o horário real da Casa |
| G07 Bloqueio (folga, almoço, atestado, feriado) | tem | não | essencial | Formulário com quem, quando, repetir e motivo; faixa cinza na grade; nunca altera o horário de trabalho (o bug do Avec); a profissional bloqueia pelo celular |
| G08 Conflito pela duração, com encaixe consciente | tem ("forçar encaixe") | parcial (só avisa se houver outro horário a menos de 1 h) | essencial | O servidor checa duração + folga + regra de "junto com outro"; diz exatamente o conflito; "Encaixar mesmo assim" com permissão e registro |
| G14 Cancelar (este ou os próximos) sem apagar | tem (e já apagou agendamentos por bug) | parcial (só faltou ou remarcou no lead) | essencial | Motivo em botões, "só este / os próximos", nunca apaga, filtro "Cancelados", contagem na ficha |
| G15 Vários serviços e várias profissionais na mesma visita | tem (Ctrl + clique) | não (um serviço por lead) | essencial | Visita + itens; "+ Adicionar serviço" sugere "logo depois" ou "ao mesmo tempo com…" |
| G19 Profissional com login e a opção "atende clientes" | tem | não | essencial | Tela única "Pessoas" com 2 chaves (atende / entra no sistema); convite pelo WhatsApp dela, ninguém inventa senha |
| G20 Perfil "Profissional" e permissões da agenda | tem | parcial (nenhuma permissão de agenda; quem vê a agenda vê também a Fila e as conversas) | essencial | Permissões novas (agenda da Casa, marcar, encaixar, só a própria, ver colegas, comissão própria, telefone da cliente), bloqueadas no servidor |
| G21 Tela "Hoje" da profissional no celular | tem (nota 2,0, copiou o computador) | parcial (dá para filtrar a agenda por profissional) | essencial | Cartão da próxima cliente + linha do dia numa tela só, troca de dia com o dedo, ações com um toque |
| G24 Observação e ficha técnica visíveis no horário | tem (sumiu do app) | parcial (existem, mas a agenda não mostra) | essencial | "Observação deste horário" + ficha técnica fixada (alergia, fórmula); uma linha visível no celular sem abrir nada; usar as 511 "Obs" do Avec |
| G43 Estabilidade: dia de atualizar, nada se apaga, ver sem internet | falhou (atualização na sexta, agendamentos apagados) | parcial (backup diário e registro, sem regra de dia nem modo sem internet) | essencial | Atualizar a agenda só de segunda a quarta de manhã; histórico de toda mudança; hoje e amanhã guardados no celular; teste do caminho inteiro antes de cada atualização |
| G46 Importar as clientes do Avec | — (exporta em Excel) | parcial (o importador existe, mas só lê .csv e não traz Obs) | essencial | Ver 4.2: prévia com planilhas de conferência, duplicados resolvidos e leads separados de clientes |

### Importante (21)

| Funcionalidade | Avec | Nós | Prioridade | Como faremos melhor |
|---|---|---|---|---|
| G02 Duração, preço e comissão por profissional × serviço | tem (comissão de 0 a 65% na Casa) | parcial (só a lista de quem faz o quê) | importante | Matriz profissional × serviço; um toque liga ou desliga; valor herdado em cinza; "Aplicar à categoria" |
| G04 Cor, ordem e apelido | tem (cores do Avec ruins: pretos e vermelhos parecidos) | não | importante | Paleta fechada de 12 cores que funcionam no claro e no escuro; ordem arrastando; apelido em toda a agenda |
| G09 "Pode ser junto com outro serviço" e folga depois | tem (36 Parcial, 6 Livre) | não | importante | Duas perguntas simples no serviço, sem jargão; a folga aparece como faixa clara no fim do cartão |
| G11 Ciclo de status | tem (Agendado → … → Pago) | parcial (por lead: confirmado, compareceu, faltou) | importante | Status por serviço, com cores contidas; um botão para o próximo passo; "Pago" sempre automático |
| G12 "Chegou" avisa a profissional | tem (falha bastante) | não | importante | Botão "Chegou" separado da comanda, que dispara o aviso "Paula chegou · Corte 10:00" |
| G13 Remarcar arrastando | tem | parcial (remarcar pelo formulário, inclusive trocando a profissional) | importante | Arrastar com conflito ao vivo, "Desfazer" em vez de pergunta, "Avisar cliente" com texto pronto |
| G16 Sem preferência de profissional | tem (listrado) | parcial ("Qualquer uma", sem lugar na grade) | importante | Vai para a menos ocupada que faz o serviço, borda tracejada, pode ser movida livremente |
| G17 Busca de horário livre em todas as profissionais | só no online (no app é a queixa mais votada) | não | importante | "Próximos livres" por serviço e "Copiar opções" direto para a conversa no WhatsApp |
| G18 Agendamento que se repete | tem | não | importante | A cada N semanas, até uma data ou N vezes; mostra os conflitos antes de salvar |
| G23 Avisos da agenda no celular | tem (falha) | parcial (avisos só para leads) | importante | Novo, remarcado, cancelado, chegou, confirmou; silêncio fora do expediente; histórico de 48 h; instalação guiada no iPhone |
| G25 Ficha da cliente com as visitas | tem | parcial (ficha sem lista de serviços feitos) | importante | Bloco "Visitas": próximas e passadas, inclusive as do Avec com selo |
| G26 Comissão transparente para a profissional | tem (sem valor nem %, gera briga) | não | importante | Cada linha com a conta inteira; hoje, semana e mês; % congelado na venda |
| G27 Fechar venda com vários serviços a partir da visita | tem (comanda) | parcial (um serviço e uma forma de pagamento) | importante | Já vem com os serviços do dia; extra, desconto e pagamento dividido; sem a palavra "comanda" |
| G33 Confirmação automática no dia anterior | tem (Avec IA, ligada na Casa) | parcial (existe, mas está desligada) | importante | Um voto confirma a visita inteira; "Preciso remarcar" responde com 3 horários; ligar no dia da virada e desligar a do Avec |
| G35 Horário especial (fim de ano, Carnaval) | tem | não | importante | Período com início e fim; feriado vira bloqueio para todas; lista de "Próximas exceções" |
| G36 Passar os horários futuros ao desativar uma profissional | tem | não | importante | Ao desativar, lista os futuros: "Passar para…" (com conflitos) ou "Cancelar e avisar" |
| G37 Buscar a cliente dentro da agenda | tem | parcial (busca em Contatos, mas a ficha não mostra o horário) | importante | Campo "Buscar cliente" / ⌘K na agenda; um toque leva ao dia com o cartão destacado |
| G38 Relatórios por profissional e por serviço | tem (mais de 200) | não | importante | Três números por profissional (faturamento, ocupação descontando bloqueios, faltas) e ranking de serviços |
| G44 Gestão pelo celular (dona) | não tem (só no navegador) | sim | importante | Manter: agenda e relatórios legíveis no celular e no iPad |
| G45 Visão semana | tem | sim | importante | Acrescentar o modo "por profissional" com ocupação |
| G47 Profissional preferida da cliente | não tem (a Casa improvisa em "Como Conheceu") | não | importante | Preenchida na importação e depois pela frequência; já vem marcada no formulário Marcar |

### Depois (13)

| Funcionalidade | Avec | Nós | Prioridade | Como faremos melhor |
|---|---|---|---|---|
| G10 Passo da grade por profissional | tem (30 min; uma usa 60) | não | depois (fonte duvidosa) | Passo da Casa = 30 min, com exceção só para quem precisar |
| G22 Sessão que não cai e biometria | falha (queixa nº 1) | parcial (30 dias fixos, sem renovar) | depois | Sessão que se renova a cada uso (ajuste pequeno, fazer junto com o login); Face ID ou digital depois |
| G28 Caixa do dia | tem | não | depois (fonte duvidosa) | Fechamento gerado das vendas: "contei" ao lado de "sistema", sem abertura obrigatória |
| G29 Fechamento e pagamento de comissões | tem | não | depois | "Fechar período" por profissional, com recibo em PDF; ela vê "pago em 15/11" (confirmar com a Thaise como a Casa calcula hoje) |
| G30 Salas e aparelhos | tem | não | depois | Só se a Casa tiver maca ou aparelho disputado |
| G31 Etiquetas no agendamento | tem | parcial (etiquetas no contato) | depois | Selo automático "primeira vez" + até 2 etiquetas do contato no cartão |
| G32 Rodízio / fila da vez | tem | não | depois | A Casa trabalha com hora marcada; se pedirem, "Encaixe agora" sugere quem está livre |
| G34 Agendamento online público | tem | não | depois | Página curta (serviço, dia, hora, nome e celular, confirmação no WhatsApp); na virada, desligar o do Avec |
| G39 Mapa de calor da agenda | tem | parcial (só de conversas) | depois (fonte duvidosa) | Reaproveitar o componente atual com dados da agenda |
| G40 Avaliação da profissional | tem | não | depois | Enquete de 1 a 5 no WhatsApp 2 h depois do "concluído" |
| G41 Anamnese, prontuário e anexos | tem | não | depois | Modelos de ficha por categoria e fotos de antes e depois |
| G42 Pacotes, vale-presente, créditos | tem | não | depois | Na virada, como nota fixada na ficha; módulo próprio depois |
| G48 Lista de espera | não tem (o AppBarber tem) | não | depois | Ao cancelar, mostra "quem queria este horário" |

---

## 6. Ordem de construção (lotes pequenos, cada um entregável)

Cada lote vai para o ar de **segunda a quarta de manhã**, depois de testar o caminho inteiro: marcar → chegou → concluído → venda.

**Fase 1: a recepção larga a agenda do Avec**
1. **Serviços:** duração, preço, tipo de preço, folga e "junto com outro", com a tela de Configurações › Serviços e a importação dos 42 do Avec. Conferir "Luzes e Mechas".
2. **Profissionais:** apelido, cor da paleta, ordem e "atende clientes", com importação das 11. Junto, a matriz "Quem faz o quê", com duração, preço e comissão opcionais.
3. **Horários:** o da Casa (corrigindo o padrão depois de confirmar o domingo), o de cada profissional com validade e as exceções. Também os bloqueios: formulário Bloquear e faixa cinza.
4. **Modelo visita + itens + histórico:** os agendamentos que estão nos leads passam para o novo modelo, e o próximo horário continua copiado no lead para nada quebrar.
5. **Tela Dia em colunas:** com a faixa "Agora", a linha do agora e os cartões por status. No celular, uma profissional por vez.
6. **Marcar na grade:** busca por telefone ou nome, "Nova cliente", vários serviços, conflito checado no servidor e "Encaixar mesmo assim".
7. **Status por serviço** (chegou, em atendimento, concluído, faltou), **cancelar com motivo** e **remarcar pelo formulário**. Junto, "Buscar cliente" na agenda.
8. **Importar as clientes do Avec:** .xlsx, Obs, leads × clientes, limpeza do nome, duplicados e a prévia com planilhas.

**Fase 2: a profissional no celular**

9. **Permissões e perfil "Profissional"**, bloqueados no servidor. Precisa estar pronto **antes do primeiro convite**.
10. **Pessoas:** login ligado à profissional, convite pelo WhatsApp, sessão que se renova e "Desconectar aparelhos".
11. **Tela Hoje** com a próxima cliente, a linha do dia, a ficha técnica, Começar/Concluir e o menu Hoje · Semana · Clientes · Ganhos.
12. **Avisos da agenda** (novo, remarcado, cancelado, chegou), com a instalação guiada no iPhone e o aviso de teste.
13. **Sem internet:** guardar hoje e amanhã no celular, só para olhar.

**Fase 3: agilidade e dinheiro**

14. Arrastar para remarcar ou mudar de profissional, com "Desfazer".
15. Agendamento que se repete e "sem preferência" na grade.
16. Fechar venda com vários serviços, desconto e pagamento dividido, guardando a comissão de cada um.
17. Ganhos no celular, com a conta inteira de cada linha.
18. "Próximos livres" na conversa, com "Copiar opções".
19. Enquete do dia anterior por visita, com "Preciso remarcar" respondendo 3 horários livres.

**Fase 4: virada**

20. Receber da Thaise a exportação de teste da agenda futura e escrever o importador em cima das colunas reais.
21. Importar o histórico (0186) e com ele a profissional preferida e "último atendimento".
22. Fazer a virada numa segunda ou terça: importar a agenda futura e os bloqueios, desligar no Avec o online e a Avec IA, ligar a nossa confirmação e trocar o link do Instagram.
23. Duas semanas depois, fazer o pedido formal pela LGPD com a exportação completa e só então cancelar o contrato.

**Depois:** relatórios por profissional, horário especial e feriados (antes de dezembro), passar horários ao desativar, caixa do dia, fechamento de comissões, agendamento online próprio, pacotes, anamnese, avaliações e lista de espera.
