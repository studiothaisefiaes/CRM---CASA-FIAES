/**
 * Permissões dos perfis (Configurações › Equipe › Perfis). Funções puras: servem ao servidor (guardas) e à tela (menu, botões).
 * A segurança está nos guardas do servidor (requirePerm/assertPerm); esconder no menu é só aparência.
 */
export const PERMS = [
  "atendimento.ver", "atendimento.todas", "atendimento.transferir", "atendimento.setor", "atendimento.pausar", "atendimento.fechar", "distribuicao.receber", "alertas.escalada",
  "quadro.ver", "jornada.ver",
  "contatos.ver", "valores.ver", "mensagem.massa", "cliente.consentimento",
  "relatorios.ver", "relatorios.equipe", "relatorios.exportar",
  "config.diaadia", "config.sistema", "equipe.gerir", "setores.gerir", "horario.dias_especiais", "virada.fazer",
  "biblioteca.gerir", "biblioteca.enviar",
  "mensagem.reagir", "mensagem.editar", "mensagem.localizacao", "mensagem.contato", "mensagem.encaminhar", "conversa.nao_lida", "conversa.acompanhar",
  "agenda.marcar", "agenda.encaixar",
  "caixa.operar", "caixa.gerir", "comissao.ver",
  "caixa.dinheiro", "caixa.outros", "caixa.taxas", "caixa.assistente", "caixa.divida", "caixa.vale", "caixa.cancelar",
  "comissao.regras", "comissao.lancar", "comissao.pagar", "relatorios.excecoes",
  "servicos.editar",
  "pro.app", "pro.ganhos",
  // Fase C (Regra do dono): cada ação nova tem permissão própria.
  "agenda.marcador",
  "agenda.repetir",
  "agenda.passar_dia",
  "fidelidade.resgatar",
  "fidelidade.programas",
  "servicos.custo",
  "servicos.por_profissional",
  "contatos.uso_imagem",
  "fichas.ver",
  "fichas.responder",
  "fotos.adicionar",
  "fotos.apagar",
  "contatos.unir",
  // QA r66 (I-7): ver não é editar nem importar nem apagar para todos.
  "contatos.editar", "contatos.importar", "mensagem.apagar_todos",
  "config.marcadores",
  "config.fichas",
  "config.aviso_cliente",
  "config.funcoes",
  "financeiro.lancar", "financeiro.pagar", "financeiro.cancelar", "financeiro.cadastros",
  "estoque.produtos", "estoque.movimentar",
  "nota.configurar", "nota.emitir", "nota.ver", "nota.cancelar", "nota.resolver",
  // API v1 (26/10): criar, listar e revogar as chaves da API. Só a Gestão.
  "api.gerir",
] as const;
export type Perm = (typeof PERMS)[number];

export type PermGroup = "Conversas" | "Agenda" | "Caixa" | "Comissão" | "Visões" | "Clientes" | "Relatórios" | "Gestão";
export const PERM_GROUPS: PermGroup[] = ["Conversas", "Agenda", "Caixa", "Comissão", "Visões", "Clientes", "Relatórios", "Gestão"];

/** A permissão de "ver de outras" de cada área com gente ou dinheiro: o editor de perfis a marca com um selo. */
export const PERM_OTHERS: Partial<Record<PermGroup, Perm>> = { Conversas: "atendimento.todas", Caixa: "caixa.outros", "Comissão": "comissao.ver", "Relatórios": "relatorios.equipe" };

export const PERM_LABEL: Record<Perm, string> = {
  "atendimento.ver": "Ver Conversas",
  "atendimento.todas": "Ver conversas de todas",
  "atendimento.transferir": "Transferir e atribuir conversas",
  "atendimento.setor": "Passar conversa para um setor",
  "atendimento.pausar": "Pausar as automáticas de uma cliente",
  "atendimento.fechar": "Fechar venda, Perdido e Não é cliente",
  "distribuicao.receber": "Receber conversas da distribuição",
  "alertas.escalada": "Receber escaladas (avisos da gestão)",
  "quadro.ver": "Ver Quadro",
  "jornada.ver": "Ver Jornada",
  "contatos.ver": "Ver Clientes",
  "valores.ver": "Ver valores de vendas e financeiro",
  "mensagem.massa": "Mandar mensagem em massa",
  "cliente.consentimento": "Mudar o que a cliente aceita",
  "relatorios.ver": "Ver Relatórios",
  "relatorios.equipe": "Ver números de toda a equipe",
  "relatorios.exportar": "Exportar CSV e PDF",
  "config.diaadia": "Configurar o dia a dia",
  "config.sistema": "Configurar o sistema",
  "equipe.gerir": "Gerir equipe e perfis",
  "setores.gerir": "Criar e editar setores",
  "biblioteca.gerir": "Subir e apagar arquivos da Biblioteca",
  "biblioteca.enviar": "Enviar arquivo da Biblioteca na conversa",
  "mensagem.reagir": "Reagir a uma mensagem",
  "mensagem.editar": "Editar uma mensagem que a Casa enviou",
  "mensagem.localizacao": "Mandar “Como chegar” (o pino da Casa)",
  "mensagem.contato": "Mandar um contato na conversa",
  "mensagem.encaminhar": "Encaminhar uma mensagem para outras conversas",
  "conversa.nao_lida": "Marcar uma conversa como não lida",
  "conversa.acompanhar": "Acompanhar conversas (lista Acompanhando no Hoje)",
  "horario.dias_especiais": "Cadastrar Dias especiais",
  "virada.fazer": "Fazer a troca do ChatGuru para o CRM e ligar o lembrete e o Depois do atendimento",
  "agenda.marcar": "Marcar, remarcar, cancelar e bloquear na Agenda",
  "agenda.encaixar": "Encaixar por cima de outro horário ou fora do horário de trabalho",
  "caixa.operar": "Abrir comanda, receber e operar o caixa",
  "caixa.gerir": "Gerir o caixa: aprovar diferença, reabrir caixa e cancelar comanda",
  "comissao.ver": "Ver a comissão de todas",
  "caixa.dinheiro": "Ver o dinheiro do caixa",
  "caixa.outros": "Ver os caixas e fechamentos da equipe",
  "caixa.taxas": "Mudar as taxas do cartão",
  "caixa.assistente": "Pôr e tirar assistente na comanda",
  "caixa.divida": "Deixar o que falta como dívida da cliente",
  "caixa.vale": "Transformar sangria em vale da profissional",
  "caixa.cancelar": "Cancelar cliente ou comanda no Caixa, com motivo",
  "comissao.regras": "Mudar as regras da comissão e o % da assistente",
  "comissao.lancar": "Lançar vale, bônus e desconto na comissão",
  "comissao.pagar": "Pagar a comissão e desfazer o pagamento",
  "relatorios.excecoes": "Ver as Exceções",
  "servicos.editar": "Mudar serviços e preços",
  "pro.app": "Entrar no app da profissional (só a própria agenda)",
  "pro.ganhos": "Ver os próprios ganhos no app",
  "agenda.marcador": "Pôr marcador e tipo no horário",
  "agenda.repetir": "Marcar horário que se repete",
  "agenda.passar_dia": "Passar o dia de uma profissional para outra",
  "fidelidade.resgatar": "Usar o prêmio da fidelidade na comanda",
  "fidelidade.programas": "Mudar os programas de fidelidade",
  "servicos.custo": "Ver e mudar o custo do serviço",
  "servicos.por_profissional": "Mudar preço e tempo por profissional",
  "contatos.uso_imagem": "Mudar o uso de imagem da cliente",
  "fichas.ver": "Ver anamnese, consultoria e campos da ficha",
  "fichas.responder": "Preencher anamnese, consultoria e campos da ficha",
  "fotos.adicionar": "Adicionar foto de antes e depois",
  "fotos.apagar": "Apagar foto de antes e depois",
  "contatos.unir": "Unir cadastros duplicados",
  "contatos.editar": "Editar, cadastrar e etiquetar clientes",
  "contatos.importar": "Trazer a conversa do WhatsApp para a ficha da cliente",
  "mensagem.apagar_todos": "Apagar uma mensagem para todos",
  "config.marcadores": "Configurar marcadores e tipos do horário",
  "config.fichas": "Configurar as fichas da cliente",
  "config.aviso_cliente": "Configurar o aviso da cliente",
  "config.funcoes": "Ligar e desligar funções",
  "financeiro.lancar": "Lançar despesas",
  "financeiro.pagar": "Pagar despesas e desfazer o pagamento",
  "financeiro.cancelar": "Cancelar despesas",
  "financeiro.cadastros": "Editar categorias, contas bancárias e a conta de cada forma de pagamento",
  "estoque.produtos": "Cadastrar e mudar produtos",
  "estoque.movimentar": "Dar entrada, saída e ajustar o estoque",
  "nota.configurar": "Configurar a nota fiscal (dados da Casa, códigos e a chave)",
  "nota.emitir": "Emitir nota fiscal",
  "nota.ver": "Ver e baixar notas fiscais (XML e PDF)",
  "nota.cancelar": "Cancelar nota fiscal",
  "nota.resolver": "Resolver nota fora do CRM",
  "api.gerir": "Criar e revogar chaves da API",
};

export const PERM_HELP: Record<Perm, string> = {
  "atendimento.ver": "Abre a Fila e as conversas.",
  "atendimento.todas": "Vê na Fila, no Quadro e no Hoje as conversas das outras pessoas. Sem isso, a lista mostra só as suas e as sem dono; com \"Atendente só mexe nas próprias conversas e nas sem dono\" ligado (Perfis), também não abre nem mexe nas das outras.",
  "atendimento.transferir": "Passa uma conversa para outra pessoa e atribui conversas em massa.",
  "atendimento.setor": "Em \"Passar para…\", passa a conversa para um setor (Recepção, Método Fiaes®, Serviços gerais): ela vai para quem do setor está Disponível.",
  "atendimento.pausar": "Liga e desliga \"Pausar automáticas desta cliente\" na conversa: enquanto pausada, nada automático sai para ela (a mensagem programada à mão continua saindo).",
  "atendimento.fechar": "Registra venda, marca como perdido ou como não é cliente.",
  "distribuicao.receber": "Entra na distribuição automática de conversas novas.",
  "alertas.escalada": "Recebe os avisos de conversa esperando demais e de número desconectado.",
  "quadro.ver": "Abre o Quadro com as etapas.",
  "jornada.ver": "Abre a Jornada dos últimos 30 dias.",
  "contatos.ver": "Abre a lista de clientes e a ficha de cada uma.",
  "mensagem.massa": "Monta e dispara mensagem em massa a partir de Clientes (com confirmação dupla). Só funciona com a chave ligada em Configurações › Mensagem em massa. Use com cuidado: o WhatsApp pode bloquear o número.",
  "cliente.consentimento": "Na ficha, marca se a cliente recebe campanhas por WhatsApp, se pode ser atendida com ajuda da IA e se quer CPF na nota. Quem disse Não fica de fora da massa e da IA.",
  "valores.ver": "Vê o total gasto por cliente, os valores nos relatórios e o financeiro. O valor de cada venda aparece também para quem registra venda.",
  "relatorios.ver": "Abre os Relatórios. Sem \"toda a equipe\", vê só os próprios números.",
  "relatorios.equipe": "Vê os números de todas as pessoas e o resumo do dia.",
  "relatorios.exportar": "Baixa planilhas e PDFs dos relatórios que pode ver.",
  "config.diaadia": "Etiquetas, respostas prontas, objeções e motivos de perda, serviços, palavras-chave, profissionais, origens e links, e o nível de cada pessoa na distribuição.",
  "config.sistema": "WhatsApp, horário e etapas, automações, mensagens automáticas, limite de envios e guarda de mídias, ligar e desligar a distribuição e importar contatos.",
  "biblioteca.gerir": "Em Configurações › Biblioteca, sobe fotos, vídeos, PDFs e áudios da Casa, muda nome, legenda e etiquetas e apaga arquivos.",
  "biblioteca.enviar": "No clipe da conversa, escolhe “Da biblioteca” e manda o arquivo para a cliente em um toque.",
  "mensagem.reagir": "Segurando a mensagem, reage com 👍 ❤️ 🙏 ou 😂 no WhatsApp da cliente. Reagir de novo com o mesmo emoji tira a reação.",
  "mensagem.editar": "Segurando uma mensagem que a própria pessoa enviou pelo CRM, edita o texto dentro do prazo (Configurações › Recursos). Fica registrado o texto antigo.",
  "mensagem.localizacao": "No “+” do campo de mensagem, manda o pino da Casa (“Como chegar”) para a cliente. Precisa do pino cadastrado em Página da cliente.",
  "mensagem.contato": "No “+” do campo de mensagem, manda um cartão de contato (nome e telefone) para a cliente.",
  "conversa.nao_lida": "No menu ⋯ da conversa, “Marcar como não lida” faz a conversa voltar para Não lidas na Fila, sem som nem aviso. Abrir a conversa limpa a marca.",
  "conversa.acompanhar": "No menu ⋯ da conversa, “Acompanhar” põe a conversa na lista Acompanhando do Hoje, só dessa pessoa, até ela deixar de acompanhar.",
  "mensagem.encaminhar": "Segurando a mensagem, encaminha o texto, a foto, o vídeo, o áudio ou o documento para até 10 conversas (o número vale em Configurações › Recursos). Para uma cliente vai só o conteúdo, sem o nome de quem estava na conversa.",
  "setores.gerir": "Em Configurações › Pessoas › Setores, cria setores, muda o nome, ativa e desativa e escolhe quem faz parte de cada um.",
  "horario.dias_especiais": "Em Configurações › Horário de funcionamento, cadastra os Dias especiais (feriado e horário reduzido). Dia fechado bloqueia a Agenda inteira.",
  "virada.fazer": "Em Configurações › Troca do ChatGuru para o CRM, marca o checklist (ChatGuru e Avec desligados, texto conferido), manda o teste para o próprio WhatsApp e liga o lembrete da véspera e o Depois do atendimento. Também é preciso para salvar esses dois ligados.",
  "equipe.gerir": "Convida pessoas, troca perfis e edita o que cada perfil pode fazer.",
  "agenda.marcar": "Bloqueia horários (almoço, folga, feriado) e procura horário livre na Agenda.",
  "agenda.encaixar": "Marca mesmo com outro horário no lugar ou fora do horário de trabalho da profissional. Fica registrado quem encaixou.",
  "caixa.operar": "Abre a comanda, soma itens, muda preço e dá desconto ou cortesia (sempre com motivo), recebe em várias formas e finaliza; abre e fecha o próprio caixa.",
  "caixa.gerir": "Aprova a diferença do fechamento acima da tolerância, fecha o caixa de outra pessoa, define as regras do fechamento e as formas de pagamento, cancela comanda fechada, reabre caixa e comanda de outro dia e dá novo prazo a pacote vencido.",
  "comissao.ver": "Vê o relatório de comissão de todas as profissionais.",
  "caixa.dinheiro": "Vê os valores em dinheiro do caixa (esperado, contado e diferença). Sem isso, o caixa fica no escuro para este perfil.",
  "caixa.outros": "Vê a página Caixas da equipe e os fechamentos de todas as pessoas. Sem isso, vê só os próprios fechamentos.",
  "caixa.taxas": "Muda a taxa do cartão por bandeira e parcela (Serviços › Formas de pagamento). Vale só para os pagamentos novos.",
  "caixa.assistente": "Põe e tira a assistente de um serviço na comanda.",
  "caixa.divida": "Ao finalizar uma comanda com valor faltando, pode deixar o que falta como dívida da cliente.",
  "caixa.vale": "Na sangria do caixa, pode transformar a retirada em vale da profissional (com a senha dela).",
  "caixa.cancelar": "No Caixa, cancela a cliente agendada ou a comanda aberta, sempre com motivo (comanda já paga pede o estorno antes). Fica na auditoria.",
  "comissao.regras": "Muda as regras da comissão (taxa do cartão, antecipação, custo, assistentes) e o % da assistente de cada serviço.",
  "comissao.lancar": "Lança vale, bônus e desconto na comissão de uma profissional, avulsos ou todo mês, sempre com motivo.",
  "comissao.pagar": "Paga a comissão da profissional (gera o recibo) e desfaz o pagamento, com motivo.",
  "relatorios.excecoes": "Abre a página de Exceções (descontos, cortesias, preços mudados, cancelamentos) e o \"Ver todas\" do Financeiro. Pede também ver Relatórios e ver valores.",
  "servicos.editar": "Na aba Serviços: cria, renomeia, muda preço, duração, descrição e quem faz, e desativa. Sem isso, a aba só mostra os preços.",
  "pro.app": "Abre o app da profissional no celular, com a agenda dela, as ações do atendimento e o pedido de folga. Sem Conversas, não vê as telas da equipe.",
  "pro.ganhos": "Vê no app a própria comissão (com o caixa no CRM e a comissão configurada).",
  "agenda.marcador": "Escolhe o marcador (VER OBS, Não Cobrar…) e o tipo (Indicação, Noiva) de cada horário.",
  "agenda.repetir": "Marca o mesmo horário a cada X semanas, de uma vez.",
  "agenda.passar_dia": "Passa os horários de um dia de uma profissional para outra quando alguém falta.",
  "fidelidade.resgatar": "Põe na comanda o prêmio de um programa de fidelidade da cliente.",
  "fidelidade.programas": "Na aba Serviços › Fidelidade: meta, quais serviços contam e quais são prêmio.",
  "servicos.custo": "Vê e muda o custo de cada serviço (nunca vai para a cliente nem para a IA).",
  "servicos.por_profissional": "Na ficha do serviço, define preço e tempo próprios de cada profissional.",
  "contatos.uso_imagem": "Marca se a cliente autorizou ou não o uso de imagem, e desde quando.",
  "fichas.ver": "Vê as respostas das fichas e as fotos de antes e depois da cliente.",
  "fichas.responder": "Responde as perguntas das fichas da cliente.",
  "fotos.adicionar": "Tira ou envia foto real (câmera ou arquivo) para a ficha da cliente.",
  "fotos.apagar": "Tira a foto da ficha da cliente.",
  "contatos.editar": "Na ficha e na lista de Clientes: muda nome, e-mail, aniversário, anotações e avisos, cadastra cliente nova e pessoa no mesmo número, e põe e tira etiquetas (também em massa). Sem isso, só vê.",
  "contatos.importar": "Em Configurações › Importar conversa do WhatsApp: sobe o arquivo exportado e traz o histórico para a ficha da cliente.",
  "mensagem.apagar_todos": "Segurando a mensagem, apaga para todos (some também do WhatsApp da cliente). Fica registrado quem apagou.",
  "contatos.unir": "Junta dois cadastros da mesma cliente num só. Não dá para desfazer.",
  "config.marcadores": "Cria, renomeia, colore e desativa marcadores; renomeia e desativa tipos do horário.",
  "config.fichas": "Cria, edita, ordena e desativa as perguntas da anamnese, da consultoria e dos campos da ficha.",
  "config.aviso_cliente": "Liga o aviso no horário e na comanda e muda o texto de quem não autorizou uso de imagem.",
  "config.funcoes": "Liga e desliga cada função nova do sistema em Configurações › Recursos.",
  "financeiro.lancar": "Lança despesas, avulsas ou repetidas por vários meses, em Relatórios › Financeiro › Contas a pagar.",
  "financeiro.pagar": "Marca uma despesa como paga, com a data, o valor e a conta bancária, e desfaz o pagamento se foi engano.",
  "financeiro.cancelar": "Cancela uma despesa, ou ela e as próximas da mesma série, sempre com o motivo.",
  "financeiro.cadastros": "Cria e muda as categorias de despesa, as contas bancárias e a conta onde cada forma de pagamento cai.",
  "estoque.produtos": "Na aba Produtos: cria, renomeia, muda preço, custo, NCM e estoque mínimo, e desativa produtos. Sem isso, a aba só mostra o catálogo.",
  "estoque.movimentar": "Dá entrada de mercadoria, registra saída e acerta o estoque pela contagem, sempre com o motivo quando é saída ou ajuste.",
  "nota.configurar": "Em Configurações › Nota fiscal: muda os dados da Casa, os códigos dos serviços, as regras e textos da nota e a chave Desligada, Teste ou Produção.",
  "nota.emitir": "Na comanda fechada, emite a nota fiscal (com a chave em Teste ou Produção) e emite de novo quando o governo recusou ou o envio falhou.",
  "nota.ver": "Vê a chave de acesso da nota para abrir no nfse.gov.br e baixa o XML da nota.",
  "nota.cancelar": "Cancela no governo uma nota fiscal autorizada, sempre com o motivo. Só depois disso a comanda pode ser reaberta ou cancelada.",
  "nota.resolver": "Registra, com o motivo, o que foi conferido no portal do governo quando o CRM não consegue resolver a nota sozinho (sem certificado, NFC-e fora do prazo de cancelamento, envio sem resposta). Depois disso a comanda pode ser reaberta ou cancelada.",
  "api.gerir": "Em Configurações › API, cria chaves para scripts e outros sistemas lerem e escreverem no CRM em nome de uma pessoa da equipe, e revoga as que não usa mais. A chave aparece uma vez só.",
};

export const PERM_GROUP: Record<Perm, PermGroup> = {
  // A chave continua atendimento.*; na tela o grupo se chama Conversas (um nome para cada coisa, Plano 5).
  "atendimento.ver": "Conversas", "atendimento.todas": "Conversas", "atendimento.transferir": "Conversas", "atendimento.setor": "Conversas", "atendimento.pausar": "Conversas", "biblioteca.gerir": "Conversas", "biblioteca.enviar": "Conversas",
  "mensagem.reagir": "Conversas", "mensagem.editar": "Conversas", "mensagem.localizacao": "Conversas", "mensagem.contato": "Conversas", "mensagem.encaminhar": "Conversas", "conversa.nao_lida": "Conversas", "conversa.acompanhar": "Conversas",
  "atendimento.fechar": "Conversas", "distribuicao.receber": "Conversas", "alertas.escalada": "Conversas",
  "quadro.ver": "Visões", "jornada.ver": "Visões",
  "contatos.ver": "Clientes", "valores.ver": "Clientes", "mensagem.massa": "Clientes", "cliente.consentimento": "Clientes",
  "relatorios.ver": "Relatórios", "relatorios.equipe": "Relatórios", "relatorios.exportar": "Relatórios",
  "config.diaadia": "Gestão", "config.sistema": "Gestão", "equipe.gerir": "Gestão", "setores.gerir": "Gestão", "horario.dias_especiais": "Gestão", "virada.fazer": "Gestão",
  "agenda.marcar": "Agenda", "agenda.encaixar": "Agenda", "pro.app": "Agenda",
  "caixa.operar": "Caixa", "caixa.gerir": "Caixa", "servicos.editar": "Caixa", "caixa.dinheiro": "Caixa", "caixa.outros": "Caixa", "caixa.taxas": "Caixa",
  "caixa.assistente": "Caixa", "caixa.divida": "Caixa", "caixa.vale": "Caixa", "caixa.cancelar": "Caixa",
  "comissao.ver": "Comissão", "comissao.regras": "Comissão", "comissao.lancar": "Comissão", "comissao.pagar": "Comissão", "pro.ganhos": "Comissão",
  "relatorios.excecoes": "Relatórios",
  "agenda.marcador": "Agenda", "agenda.repetir": "Agenda", "agenda.passar_dia": "Agenda",
  "fidelidade.resgatar": "Agenda", "fidelidade.programas": "Agenda",
  "servicos.custo": "Caixa", "servicos.por_profissional": "Caixa",
  "contatos.uso_imagem": "Clientes", "fichas.ver": "Clientes", "fichas.responder": "Clientes", "fotos.adicionar": "Clientes", "fotos.apagar": "Clientes", "contatos.unir": "Clientes", "contatos.editar": "Clientes", "contatos.importar": "Clientes", "mensagem.apagar_todos": "Conversas",
  "config.marcadores": "Gestão", "config.fichas": "Gestão", "config.aviso_cliente": "Gestão", "config.funcoes": "Gestão",
  "financeiro.lancar": "Gestão", "financeiro.pagar": "Gestão", "financeiro.cancelar": "Gestão", "financeiro.cadastros": "Gestão",
  "estoque.produtos": "Caixa", "estoque.movimentar": "Caixa",
  "nota.configurar": "Gestão", "nota.resolver": "Gestão", "api.gerir": "Gestão",
  "nota.emitir": "Caixa", "nota.ver": "Caixa", "nota.cancelar": "Caixa",
};

/**
 * No perfil Gestão, isto é opcional: entrar no rodízio de conversas (o papel gestor antigo não entrava), mandar mensagem em massa
 * (Lote 5: ninguém nasce com ela) e o app da profissional (Lote 7A, para a Gestão não virar "profissional"). O resto é obrigatório.
 */
export const GESTAO_OPTIONAL: Perm[] = ["distribuicao.receber", "mensagem.massa", "pro.app", "pro.ganhos"];
export const GESTAO_REQUIRED: Perm[] = PERMS.filter((p) => !GESTAO_OPTIONAL.includes(p));

export type SystemProfileKey = "gestao" | "atendente" | "recepcao" | "profissional";
/**
 * Atendente e Recepção fazem o mesmo atendimento (pedido da Casa, 14/10): fecham venda, transferem, veem Quadro e Clientes, configuram
 * o dia a dia (Lote 4) e marcam e encaixam na Agenda (a recepção já "força encaixe" no Avec). Relatórios e o sistema, só a Gestão.
 */
/** Fase C (Regra do dono): ações novas da equipe (Atendente e Recepção) e as que só a Recepção ganha. */
const EQUIPE_FASE_C: readonly Perm[] = ["agenda.marcador", "agenda.repetir", "agenda.passar_dia", "fidelidade.resgatar", "contatos.uso_imagem", "fichas.ver", "fichas.responder", "fotos.adicionar", "fotos.apagar", "config.marcadores", "config.fichas", "config.aviso_cliente"];
const RECEPCAO_FASE_C: readonly Perm[] = ["servicos.por_profissional", "contatos.unir"];
/** QA r66 (I-7): quem já fazia isso no dia a dia continua (migration 0087 concede uma vez; perfil novo já nasce com elas). */
const EQUIPE_QA66: readonly Perm[] = ["contatos.editar", "contatos.importar", "mensagem.apagar_todos"];
const EQUIPE: readonly Perm[] = ["atendimento.ver", "atendimento.transferir", "atendimento.fechar", "distribuicao.receber", "quadro.ver", "contatos.ver", "config.diaadia", "agenda.marcar", "agenda.encaixar", "atendimento.setor", "atendimento.pausar", "cliente.consentimento", "biblioteca.enviar", "mensagem.reagir", "mensagem.editar", "mensagem.localizacao", "mensagem.contato", "mensagem.encaminhar", "conversa.nao_lida", "conversa.acompanhar", "caixa.operar", "caixa.dinheiro", "caixa.assistente", "caixa.divida", "caixa.vale", "caixa.cancelar", "nota.emitir", "nota.ver", ...EQUIPE_FASE_C, ...EQUIPE_QA66];
export const SYSTEM_PROFILES: { key: SystemProfileKey; name: string; permissions: readonly Perm[] }[] = [
  { key: "gestao", name: "Gestão", permissions: GESTAO_REQUIRED },
  { key: "atendente", name: "Atendente", permissions: EQUIPE },
  // Aba Serviços (16/10): a recepção muda preço e serviço; a atendente só consulta.
  { key: "recepcao", name: "Recepção", permissions: [...EQUIPE, "servicos.editar", "biblioteca.gerir", "estoque.produtos", "estoque.movimentar", ...RECEPCAO_FASE_C] },
  // Lote 7A: só o app (a própria agenda) e os próprios ganhos. Nada da equipe.
  { key: "profissional", name: "Profissional", permissions: ["pro.app", "pro.ganhos"] },
];

/**
 * Permissões novas que os perfis Atendente e Recepção JÁ EXISTENTES recebem uma única vez (o seed registra em
 * `settings.perfis_permissoes_concedidas` como "<perfil>:<permissão>"; se a gestão tirar depois, não voltam). Cada lote só acrescenta.
 */
export const ONE_TIME_GRANTS: { profile: "atendente" | "recepcao"; perm: Perm }[] = [
  { profile: "atendente", perm: "agenda.marcar" }, { profile: "atendente", perm: "agenda.encaixar" },
  { profile: "recepcao", perm: "agenda.marcar" }, { profile: "recepcao", perm: "agenda.encaixar" },
  { profile: "atendente", perm: "caixa.operar" }, { profile: "recepcao", perm: "caixa.operar" },
  { profile: "recepcao", perm: "servicos.editar" },
  // Fase C (Regra do dono).
  ...EQUIPE_FASE_C.flatMap((perm) => [{ profile: "atendente" as const, perm }, { profile: "recepcao" as const, perm }]),
  ...RECEPCAO_FASE_C.map((perm) => ({ profile: "recepcao" as const, perm })),
  { profile: "atendente", perm: "atendimento.setor" }, { profile: "recepcao", perm: "atendimento.setor" },
  { profile: "atendente", perm: "atendimento.pausar" }, { profile: "recepcao", perm: "atendimento.pausar" },
  { profile: "atendente", perm: "cliente.consentimento" }, { profile: "recepcao", perm: "cliente.consentimento" },
  { profile: "atendente", perm: "biblioteca.enviar" }, { profile: "recepcao", perm: "biblioteca.enviar" }, { profile: "recepcao", perm: "biblioteca.gerir" },
  ...(["mensagem.reagir", "mensagem.editar", "mensagem.localizacao", "mensagem.contato", "mensagem.encaminhar", "conversa.nao_lida", "conversa.acompanhar"] as const).flatMap((perm) => [{ profile: "atendente" as const, perm }, { profile: "recepcao" as const, perm }]),
  { profile: "recepcao", perm: "estoque.produtos" }, { profile: "recepcao", perm: "estoque.movimentar" },
  { profile: "atendente", perm: "nota.emitir" }, { profile: "atendente", perm: "nota.ver" },
  { profile: "recepcao", perm: "nota.emitir" }, { profile: "recepcao", perm: "nota.ver" },
  { profile: "atendente", perm: "caixa.cancelar" }, { profile: "recepcao", perm: "caixa.cancelar" },
];

const SET = new Set<string>(PERMS);
export const isPerm = (x: string): x is Perm => SET.has(x);

export function can(perms: readonly string[] | null | undefined, perm: Perm): boolean {
  return !!perms && perms.includes(perm);
}

/** Valor da coluna antiga users.role, mantida em sincronia para o código antigo funcionar se for preciso voltar. */
export const legacyRoleOf = (perms: readonly string[]): "gestor" | "atendente" => (perms.includes("equipe.gerir") ? "gestor" : "atendente");

/** Valor de uma venda no lead e no Quadro: quem vê valores ou quem registra venda (a atendente vê o que ela mesma fecha). */
export const canSeeDealMoney = (perms: readonly string[] | null | undefined): boolean => can(perms, "valores.ver") || can(perms, "atendimento.fechar");

/**
 * Relatórios do Avec (ver, enviar, baixar): só a gestão. Além de abrir Relatórios, pede "toda a equipe" e "ver valores", porque as tabelas
 * do Avec trazem valores e comissões de todo mundo e o envio mexe em contatos e na agenda.
 */
export const canSeeAvecReports = (perms: readonly string[] | null | undefined): boolean =>
  can(perms, "relatorios.ver") && can(perms, "relatorios.equipe") && can(perms, "valores.ver");

/** Painel Salão (Relatórios): números do salão inteiro, então pede "toda a equipe" além de abrir Relatórios. Os R$, só com "ver valores". */
export const canSeeSalon = (perms: readonly string[] | null | undefined): boolean => can(perms, "relatorios.ver") && can(perms, "relatorios.equipe");

/** Só o app da profissional: tem `pro.app` e não vê o Atendimento (seção 8.3). */
export const isProOnly = (perms: readonly string[] | null | undefined): boolean => can(perms, "pro.app") && !can(perms, "atendimento.ver");

/** Para onde mandar quem abriu uma tela sem permissão: o Hoje abre para todo mundo; quem só tem o app da profissional vai para /pro. */
export const firstAllowedPath = (perms: readonly string[]): string => (isProOnly(perms) ? "/pro" : "/");

/** A permissão de antes do Lote 4 ("tudo ou nada"), que o seed troca por config.diaadia + config.sistema nos perfis guardados. */
export const LEGACY_CONFIG_PERM = "config.editar";

/** UMA lista só das permissões que abrem Configurações: o menu (`canConfigure`), o layout e o índice de /config usam esta. */
export const CONFIG_ENTRY_PERMS = ["config.diaadia", "config.sistema", "equipe.gerir", "config.funcoes", "config.marcadores", "config.fichas", "config.aviso_cliente", "nota.configurar", "api.gerir"] as const satisfies readonly Perm[];
/** Entra em Configurações: quem configura o dia a dia, o sistema, gere a equipe, liga e desliga funções, cuida dos marcadores e das fichas, configura a nota fiscal ou gere as chaves da API. */
export const canConfigure = (perms: readonly string[] | null | undefined): boolean => CONFIG_ENTRY_PERMS.some((p) => can(perms, p));
