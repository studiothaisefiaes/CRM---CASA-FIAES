import { can, type Perm } from "./permissions";
import type { AgendaMode } from "./agenda-settings";
import type { CaixaMode } from "./caixa-settings";
import type { FiscalModo } from "./fiscal-settings";

/**
 * Configurações (F5, nova organização de 16/10): poucos grupos numa coluna à esquerda, sem abas correndo para o lado.
 * Cada item tem nome, uma frase do que faz, palavras para a busca e o estado atual. Os formulários são os de antes:
 * aqui muda só onde cada um fica, o nome e a frase. Tudo que manda mensagem para cliente fica em "Mensagens automáticas";
 * o que pode parar o atendimento fica separado, na Área de cuidado.
 */
export type ConfigGroupId = "casa" | "pessoas" | "mensagens" | "conversas" | "agenda" | "clientes" | "dados" | "cuidado";
export type ConfigGroup = { id: ConfigGroupId; label: string; description: string; hint: string; danger?: boolean };

export const CONFIG_GROUPS: ConfigGroup[] = [
  { id: "casa", hint: "Horário e página da cliente", label: "A Casa", description: "Quando a Casa abre e o que a cliente vê pela internet." },
  { id: "pessoas", hint: "Equipe, perfis e quem recebe", label: "Pessoas", description: "Quem usa o sistema, o que cada uma vê e quem recebe conversa nova." },
  { id: "mensagens", hint: "O que sai sozinho para a cliente", label: "Mensagens automáticas", description: "O que o sistema manda ou faz sozinho, sem ninguém apertar enviar." },
  { id: "conversas", hint: "Respostas, etiquetas e etapas", label: "Conversas", description: "Respostas prontas, etiquetas, etapas e de onde a cliente veio." },
  { id: "agenda", hint: "Profissionais, intervalo e caixa", label: "Agenda e caixa", description: "Profissionais, intervalo da agenda e como a Casa recebe." },
  { id: "clientes", hint: "Anamnese, consultoria e campos", label: "Clientes", description: "O que a Casa pergunta e anota de cada cliente." },
  { id: "dados", hint: "Não envia nada", label: "Trazer dados", description: "Trazer conversas antigas para o sistema. Nada aqui envia mensagem." },
  { id: "cuidado", hint: "WhatsApp e Avec", label: "Área de cuidado", description: "Conexões que, se mexidas, podem parar o atendimento.", danger: true },
];

/** Estado lido do banco para mostrar no índice. Campo ausente = não deu para ler (o item fica sem estado, nunca com um inventado). */
export type ConfigSnapshot = Partial<{
  autoReply: boolean; welcome: boolean; menu: boolean; away: boolean; closing: boolean; reminder: boolean; mass: boolean; suggestedReturn: boolean;
  /** Depois do atendimento (Fase B): ligado = modo diferente de "desligado". */ afterVisit: boolean;
  /** Resumo do dia no WhatsApp da gestão (Fase B). */ summaryWhatsapp: boolean;
  automations: { on: number; total: number; sendingOn: number };
  hours: { summary: string; saved: boolean };
  clientPage: { endereco: boolean; cancelarAteHoras: number };
  onlineBooking: boolean; library: boolean;
  people: { active: number; pending: number };
  distribution: boolean;
  lists: Partial<Record<"quick_reply" | "objection" | "lost_reason" | "service" | "keyword" | "origin", number>>;
  tags: number; stages: number; sources: number; professionals: number;
  financeiro: { contasAPagar: boolean; resultado: boolean };
  estoque: { ligado: boolean };
  relatorios: { ocupacao: boolean };
  nota: { nfse: FiscalModo };
  passoMin: number; exigeCaixaAberto: boolean; agendaMode: AgendaMode; caixaMode: CaixaMode;
  whatsapp: { connected: number; total: number };
  /** Sugestão de resposta por IA: ligada e o gasto do mês (milionésimos de dólar). */
  ai: { enabled: boolean; monthMicros: number; monthlyLimitUsd: number };
  /** Funções novas ligadas (Regra do dono, Fase C). */
  funcoes: { on: number; total: number };
  /** Marcadores do horário em uso (Fase C, item 19). */
  marcadores: number;
  /** Perguntas em uso nas fichas da cliente (Fase C, itens 21 e 25b). */
  fichas: number;
  /** Onde o Aviso da cliente salta (Fase C, item 20): já com a função aplicada. */
  avisoCliente: { horario: boolean; comanda: boolean };
  /** Limites do Repetir horário (Fase C, item 23a) e se a função está ligada. */
  repetir: { maxSemanas: number; maxVezes: number; on: boolean };
}>;
/** `on` pinta o estado de ligado/desligado; `alert` só para o que está quebrado (WhatsApp desconectado). */
export type ConfigState = { text: string; on?: boolean; alert?: boolean };

type Need = "diaadia" | "sistema" | "equipe" | "pessoas" | "nota" | "funcoes" | "marcadores" | "aviso" | "fichas" | "api";
export type ConfigItem = {
  id: string; group: ConfigGroupId; href: string; label: string; description: string; keywords: string[]; need: Need;
  /** Manda mensagem para cliente sozinho. */ sends?: boolean;
  /** Área de cuidado: para mudar, digita CONFIRMAR. */ danger?: boolean;
  /** Outros caminhos que são o mesmo item (abas internas). */ also?: string[];
  /** Para quem não tem a permissão, o item abre outro caminho (Pessoas sem gerir equipe → quem recebe conversa nova). */ alt?: { href: string; unless: Perm };
  /** "O que muda para a equipe", em uma frase. */ changes?: string;
  state?: (s: ConfigSnapshot) => ConfigState | null;
};

const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(2).replace(".", ",")}`;
const n = (v: number, um: string, varios: string) => `${v} ${v === 1 ? um : varios}`;
/** Ligado/desligado com o gênero do nome ("Resposta… Ligada", "Menu… Ligado"). */
const onOff = (key: "autoReply" | "welcome" | "menu" | "away" | "closing" | "reminder" | "mass" | "afterVisit" | "summaryWhatsapp", f = false) => (s: ConfigSnapshot): ConfigState | null => {
  const v = s[key];
  if (v == null) return null;
  return { text: v ? (f ? "Ligada" : "Ligado") : (f ? "Desligada" : "Desligado"), on: v };
};
const count = (k: keyof NonNullable<ConfigSnapshot["lists"]>, um: string, varios: string) => (s: ConfigSnapshot): ConfigState | null =>
  s.lists?.[k] == null ? null : { text: n(s.lists[k]!, um, varios) };
const AGENDA_MODE: Record<AgendaMode, string> = { consulta: "Agenda só consulta", dupla: "Agenda dupla (CRM e Avec)", so_crm: "Agenda só no CRM" };

export const CONFIG_ITEMS: ConfigItem[] = [
  // A Casa
  { id: "funcoes", group: "casa", href: "/config/funcoes", need: "funcoes", label: "Recursos",
    description: "Liga e desliga os recursos do sistema, por assunto (Conversas, Agenda, Clientes e Caixa), e ajusta os números e textos de cada um.",
    keywords: ["recursos", "recurso", "funcao", "funcoes", "ligar", "desligar", "liga desliga", "limite", "texto", "marcador", "fidelidade", "fichas", "fotos", "repetir", "unir", "passar o dia"],
    changes: "Recurso desligado some da tela e o sistema recusa a ação; o que já foi gravado fica guardado. Os que mandam mensagem para a cliente nascem desligados.",
    state: (s) => (s.funcoes == null ? null : { text: `${s.funcoes.on} de ${s.funcoes.total} ligados`, on: s.funcoes.on > 0 }) },
  { id: "horario", group: "casa", href: "/config/etapas?parte=horario", need: "sistema", label: "Horário de funcionamento",
    description: "Quando a Casa atende. Fora desse horário, nada conta como atraso e vale a resposta fora do horário.",
    keywords: ["aberto", "fechado", "dias", "semana", "expediente", "hora", "abre", "fecha", "funcionamento", "feriado", "dia especial", "dias especiais", "horario reduzido", "natal"],
    changes: "Fora desse horário o prazo de resposta não corre.",
    state: (s) => (s.hours ? { text: s.hours.saved ? s.hours.summary : `${s.hours.summary} · padrão, ninguém salvou` } : null) },
  { id: "pagina-cliente", group: "casa", href: "/config/pagina-cliente", need: "sistema", label: "Página da cliente",
    description: "O link que a cliente recebe para ver, confirmar ou remarcar o horário: endereço, WhatsApp e até quando pode cancelar.",
    keywords: ["link", "confirmacao", "confirmar", "remarcar", "cancelar", "endereco", "pagina", "site"],
    changes: "A cliente vê esses dados quando abre o link do horário.",
    state: (s) => (s.clientPage ? { text: `${s.clientPage.endereco ? "Com endereço" : "Sem endereço"} · cancela até ${s.clientPage.cancelarAteHoras} h antes` } : null) },
  { id: "agendamento-online", group: "casa", href: "/config/agendamento-online", need: "sistema", label: "Agendamento pela internet",
    description: "Deixa a cliente pedir horário sozinha pelo link, com os serviços e profissionais que a Casa escolher.",
    keywords: ["agendamento online", "agendar", "site", "internet", "pedido", "pagina", "link"],
    changes: "Pedidos pelo link aparecem para a recepção conferir.",
    state: (s) => (s.onlineBooking == null ? null : { text: s.onlineBooking ? "Ligado" : "Desligado", on: s.onlineBooking }) },
  // Pessoas
  { id: "pessoas", group: "pessoas", href: "/config/equipe", need: "pessoas", label: "Pessoas",
    description: "Quem usa o sistema, a assinatura de cada uma, o que cada perfil vê e quem recebe conversa nova primeiro.",
    keywords: ["equipe", "atendente", "recepcao", "gestao", "usuario", "senha", "convite", "assinatura", "perfil", "permissao", "acesso", "distribuicao", "prioridade", "ordem", "quem recebe", "disponivel", "pausa", "setor", "setores", "departamento"],
    also: ["/config/equipe/perfis", "/config/equipe/setores", "/config/distribuicao"], alt: { href: "/config/distribuicao", unless: "equipe.gerir" },
    changes: "Cada pessoa só vê o menu do perfil dela; a conversa nova vai para quem está disponível, na ordem da prioridade.",
    state: (s) => {
      if (!s.people && s.distribution == null) return null;
      const parts = s.people ? [n(s.people.active, "pessoa", "pessoas"), ...(s.people.pending ? [n(s.people.pending, "convite pendente", "convites pendentes")] : [])] : [];
      if (s.distribution != null) parts.push(s.distribution ? "distribuição ligada" : "distribuição desligada");
      return { text: parts.join(" · ") };
    } },
  { id: "api", group: "pessoas", href: "/config/api", need: "api", label: "API",
    description: "Chaves para planilhas, scripts e outros sistemas lerem e escreverem no CRM em nome de alguém da equipe.",
    keywords: ["api", "chave", "token", "integracao", "integração", "script", "planilha", "automacao", "sistema", "programar"],
    changes: "A chave faz só o que o perfil da pessoa escolhida pode fazer, e só o que foi marcado nela. Revogar corta na hora." },
  // Mensagens automáticas
  { id: "fora-do-horario", group: "mensagens", href: "/config/mensagens?parte=fora-do-horario", need: "sistema", sends: true, label: "Resposta fora do horário",
    description: "Responde sozinha quem escreve com a Casa fechada, no máximo uma vez a cada 12 horas por cliente.",
    keywords: ["fora do horario", "fechado", "ausencia", "robo", "automatica", "noite", "fim de semana"],
    changes: "A cliente recebe a resposta na hora, e a conversa continua na lista para vocês responderem.", state: onOff("autoReply", true) },
  { id: "boas-vindas", group: "mensagens", href: "/config/mensagens?parte=boas-vindas", need: "sistema", sends: true, label: "Boas-vindas",
    description: "Responde sozinha quem escreve pela primeira vez, com a Casa aberta.",
    keywords: ["boas vindas", "primeira mensagem", "saudacao", "robo", "automatica", "oi"],
    changes: "A cliente nova recebe o texto na hora; a conversa entra normalmente na lista.", state: onOff("welcome", true) },
  { id: "menu", group: "mensagens", href: "/config/menu", need: "sistema", sends: true, label: "Menu de boas-vindas",
    description: "Manda a saudação com opções numeradas (1, 2, 3…) para quem escreve pela primeira vez; a resposta vira etiqueta.",
    keywords: ["menu", "opcoes", "numero", "robo", "boas vindas", "saudacao", "chatbot", "automatica"],
    changes: "A opção escolhida pela cliente vira etiqueta e nota na conversa.", state: onOff("menu") },
  { id: "ausencia", group: "mensagens", href: "/config/mensagens?parte=ausencia", need: "sistema", sends: true, label: "Quando ninguém está disponível",
    description: "Responde sozinha quando a Casa está aberta mas ninguém da equipe está Disponível no sistema.",
    keywords: ["ausencia", "ninguem", "disponivel", "pausa", "robo", "automatica", "ocupada"],
    changes: "Com todas em Pausa ou Ausente, a cliente recebe este texto (uma vez a cada 12 h).", state: onOff("away", true) },
  { id: "encerramento", group: "mensagens", href: "/config/mensagens?parte=encerramento", need: "sistema", sends: true, label: "Mensagem ao resolver",
    description: "Manda um texto para a cliente toda vez que alguém resolve a conversa.",
    keywords: ["encerrar", "encerramento", "obrigada", "despedida", "fim", "automatica"],
    changes: "Ao tocar em Resolver, a cliente recebe este texto.", state: onOff("closing", true) },
  { id: "lembrete", group: "mensagens", href: "/config/automacoes?parte=lembrete", need: "sistema", sends: true, label: "Lembrete do horário",
    description: "Lembra a cliente do horário 24 horas antes e avisa na hora quando o horário é remarcado.",
    keywords: ["lembrete", "vespera", "confirmacao", "confirmar", "avec ia", "remarcado", "aviso", "dia anterior"],
    changes: "Antes de ligar, desligue a confirmação da Avec IA para a cliente não receber duas mensagens.", state: onOff("reminder") },
  { id: "depois-atendimento", group: "mensagens", href: "/config/depois-atendimento", need: "sistema", sends: true, label: "Depois do atendimento",
    description: "Quando todos os serviços da visita ficam Finalizados, manda para a cliente o agradecimento com o link da Avaliação no Google.",
    keywords: ["depois do atendimento", "agradecimento", "obrigada", "avaliacao", "google", "pos atendimento", "finalizado", "pesquisa", "satisfacao"],
    changes: "Liga pela troca do ChatGuru para o CRM; cada visita concluída recebe uma mensagem só, no tempo e na janela escolhidos.", state: onOff("afterVisit") },
  { id: "virada", group: "mensagens", href: "/config/virada", need: "sistema", sends: true, label: "Troca do ChatGuru para o CRM",
    description: "Liga o lembrete do horário e o Depois do atendimento no CRM depois de desligar os do ChatGuru e do Avec, conferir o texto e receber um teste.",
    keywords: ["virada", "chatguru", "avec", "desligar", "ligar", "lembrete", "confirmacao", "agradecimento", "teste", "duas mensagens", "mensagem em dobro"],
    changes: "Sem a troca do ChatGuru para o CRM, o lembrete e o Depois do atendimento não ligam: a cliente nunca recebe a mesma mensagem duas vezes." },
  { id: "resumo-whatsapp", group: "mensagens", href: "/config/resumo-whatsapp", need: "sistema", label: "Resumo do dia no WhatsApp",
    description: "Manda o resumo do dia no WhatsApp da Gestão (ou de quem você escolher) na hora marcada. Vai para a conversa Equipe, nunca para cliente.",
    keywords: ["resumo", "resumo do dia", "whatsapp", "gestora", "gestao", "relatorio", "19h", "noite", "equipe"],
    changes: "Ligado, as pessoas escolhidas recebem o resumo do dia no WhatsApp, na hora marcada.", state: onOff("summaryWhatsapp") },
  { id: "massa", group: "mensagens", href: "/config/massa", need: "sistema", sends: true, label: "Mensagem em massa",
    description: "A chave que permite mandar a mesma mensagem para várias clientes de uma vez, e as que já saíram.",
    keywords: ["massa", "disparo", "lote", "campanha", "varias", "todas", "promocao"],
    changes: "Ligada, quem tem a permissão vê o botão em Clientes.", state: onOff("mass", true) },
  { id: "regras", group: "mensagens", href: "/config/automacoes?parte=regras", need: "sistema", sends: true, label: "Regras automáticas",
    description: "O que o sistema faz sozinho a cada minuto: avisar, mudar de etapa e, em algumas, mandar mensagem.",
    keywords: ["automacao", "automacoes", "regra", "tentativas", "perdido", "aniversario", "parabens", "follow-up", "prazo", "parado"],
    changes: "Cada regra diz quando age e o que faz; as que mandam mensagem pedem confirmação para ligar.",
    state: (s) => (s.automations ? { text: `${s.automations.on} de ${s.automations.total} ligadas${s.automations.sendingOn ? ` · ${n(s.automations.sendingOn, "manda", "mandam")} mensagem` : ""}`, on: s.automations.on > 0 } : null) },
  { id: "retorno", group: "mensagens", href: "/config/automacoes?parte=retorno", need: "sistema", label: "Hora de voltar automática",
    description: "Todo dia às 8h põe na lista as clientes em Hora de voltar. Não manda mensagem: alguém da Casa chama.",
    keywords: ["retorno", "hora de voltar", "voltar", "ciclo", "manutencao", "chamar"],
    changes: "As clientes do dia aparecem na etapa de retorno para alguém chamar.",
    state: (s) => (s.suggestedReturn == null ? null : { text: s.suggestedReturn ? "Ligada · não manda mensagem" : "Desligada", on: s.suggestedReturn }) },
  // Conversas
  { id: "respostas", group: "conversas", href: "/config/listas?aba=quick_reply", need: "diaadia", label: "Respostas prontas",
    description: "Os textos que aparecem ao digitar “/” na conversa, com pasta, anexo e variáveis como o nome da cliente.",
    keywords: ["atalho", "modelo", "template", "barra", "texto pronto", "agendar mensagem", "programar mensagem", "anexo"],
    changes: "As respostas universais aparecem para todas ao digitar “/”.", state: count("quick_reply", "resposta", "respostas") },
  { id: "biblioteca", group: "conversas", href: "/config/biblioteca", need: "diaadia", label: "Biblioteca",
    description: "Os arquivos da Casa (tabela de preços, resultados, cuidados, como chegar) para mandar em um toque pelo clipe da conversa.",
    keywords: ["biblioteca", "arquivo", "arquivos", "pdf", "foto", "video", "audio", "tabela de precos", "catalogo", "clipe", "anexo"],
    changes: "O clipe da conversa ganha “Da biblioteca”; quem envia é sempre a atendente.",
    state: (s) => (s.library == null ? null : { text: s.library ? "Ligada" : "Desligada", on: s.library }) },
  { id: "etiquetas", group: "conversas", href: "/config/etiquetas", need: "diaadia", label: "Etiquetas",
    description: "As marcas das clientes (como VIP e Método Fiaes®): cor, nome e juntar duas que são a mesma.",
    keywords: ["tag", "etiqueta", "marca", "vip", "cor", "juntar"],
    changes: "As etiquetas aparecem na conversa, na ficha e nos filtros.", state: (s) => (s.tags == null ? null : { text: n(s.tags, "etiqueta", "etiquetas") }) },
  { id: "palavras", group: "conversas", href: "/config/listas?aba=keyword", need: "diaadia", label: "Palavras que viram etiqueta",
    description: "Quando a cliente escreve uma dessas palavras, a conversa ganha a etiqueta sozinha.",
    keywords: ["palavra chave", "palavras-chave", "keyword", "etiqueta automatica", "mega hair"],
    changes: "A etiqueta entra sozinha na conversa quando a palavra aparece.", state: count("keyword", "palavra", "palavras") },
  { id: "motivos", group: "conversas", href: "/config/listas?aba=lost_reason", need: "diaadia", label: "Motivos de perda",
    description: "Os motivos que a pessoa escolhe ao marcar uma conversa como Perdido.",
    keywords: ["perdido", "motivo", "perda", "desistiu"],
    changes: "A lista aparece ao marcar Perdido e vira relatório.", state: count("lost_reason", "motivo", "motivos") },
  { id: "objecoes", group: "conversas", href: "/config/listas?aba=objection", need: "diaadia", label: "Objeções",
    description: "O que a cliente diz quando hesita (preço, horário, distância). Vira relatório.",
    keywords: ["objecao", "objecoes", "caro", "preco", "hesita"],
    changes: "As objeções marcadas nas conversas aparecem nos relatórios.", state: count("objection", "objeção", "objeções") },
  { id: "etapas", group: "conversas", href: "/config/etapas?parte=etapas", need: "sistema", label: "Etapas e prazos",
    description: "Os passos da conversa, a cor de cada um, quem vê e quanto tempo a Casa tem para responder.",
    keywords: ["funil", "prazo", "sla", "cor", "etapa", "tempo de resposta", "tentativas", "parado"],
    changes: "O prazo aparece na lista de Conversas só quando a cliente está esperando.", state: (s) => (s.stages == null ? null : { text: n(s.stages, "etapa", "etapas") }) },
  { id: "origens", group: "conversas", href: "/config/origens", need: "diaadia", label: "De onde a cliente veio",
    description: "As origens (Instagram, indicação…) e os links com QR que mostram qual anúncio ou perfil trouxe a cliente.",
    keywords: ["origem", "instagram", "anuncio", "indicacao", "link", "qr", "como conheceu", "campanha"],
    changes: "A pergunta “Como conheceu a Casa?” passa a oferecer estas opções.",
    state: (s) => (s.lists?.origin == null && s.sources == null ? null : { text: [s.lists?.origin != null ? n(s.lists.origin, "origem", "origens") : null, s.sources != null ? n(s.sources, "link", "links") : null].filter(Boolean).join(" · ") }) },
  { id: "ia", group: "conversas", href: "/config/ia", need: "sistema", label: "Sugestão de resposta por IA",
    description: "A IA escreve uma sugestão; ninguém recebe nada sem a atendente enviar.",
    keywords: ["ia", "inteligencia artificial", "sugestao", "resposta sugerida", "claude", "robo", "assistente", "gasto", "limite"],
    changes: "Ligada, a conversa ganha o botão Sugerir resposta (só ele gera a sugestão); a atendente toca Usar, confere e envia.",
    state: (s) => (s.ai == null ? null : { text: s.ai.enabled ? `Ligada · ${usd(s.ai.monthMicros)} no mês` : "Desligada", on: s.ai.enabled }) },
  // Agenda e caixa
  { id: "profissionais", group: "agenda", href: "/config/profissionais", need: "diaadia", label: "Profissionais",
    description: "Quem atende na cadeira: foto, horário de trabalho, o que cada uma faz e o acesso ao app da profissional.",
    keywords: ["profissional", "cabeleireira", "manicure", "quem faz o que", "horario de trabalho", "app da profissional", "foto"],
    changes: "A Agenda oferece só os serviços que cada profissional faz.", state: (s) => (s.professionals == null ? null : { text: n(s.professionals, "profissional", "profissionais") }) },
  // Serviços e pacotes é item do menu (grupo Gestão, 17/10): o atalho que ficava aqui saiu.
  // Repetir antes do Intervalo: os dois moram em /config/agenda e o item com `?parte=` precisa ser achado primeiro (matchConfigItem).
  { id: "repetir", group: "agenda", href: "/config/agenda?parte=repetir", need: "sistema", label: "Repetir horário",
    description: "Até quantas semanas entre uma vez e outra e até quantas vezes a recepção pode repetir o mesmo horário ao marcar.",
    keywords: ["repetir", "repete", "recorrente", "toda semana", "semanal", "quinzenal", "serie", "a cada", "vezes", "limite"],
    changes: "Muda o máximo que aparece no Repetir do Marcar; os horários já repetidos ficam como estão.",
    state: (s) => (s.repetir == null ? null : s.repetir.on ? { text: `Até ${s.repetir.maxSemanas} semanas · ${s.repetir.maxVezes} vezes`, on: true } : { text: "Função desligada", on: false }) },
  { id: "intervalo", group: "agenda", href: "/config/agenda", need: "sistema", label: "Intervalo da agenda",
    description: "De quanto em quanto tempo a agenda mostra os horários e o Procurar horário sugere (09:00, 09:30…).",
    keywords: ["intervalo", "passo", "grade", "horarios livres", "slot", "sugestao", "encaixe"],
    changes: "A Agenda e as sugestões passam a andar nesse intervalo.", state: (s) => (s.passoMin == null ? null : { text: `A cada ${s.passoMin} min` }) },
  { id: "marcadores", group: "agenda", href: "/config/marcadores", need: "marcadores", label: "Marcadores do horário",
    description: "Os marcadores que a equipe põe no horário (VER OBS, Não Cobrar…), com cor, e o nome dos tipos do horário (Indicação, Noiva).",
    keywords: ["marcador", "marcadores", "etiqueta do horario", "tipo", "tipo do horario", "indicacao", "noiva", "ver obs", "nao cobrar", "cor"],
    changes: "Muda as opções que a equipe vê ao marcar e ao abrir um horário; o que já foi posto nos horários fica como está.",
    state: (s) => (s.marcadores == null ? null : { text: n(s.marcadores, "marcador em uso", "marcadores em uso") }) },
  { id: "aviso-cliente", group: "agenda", href: "/config/aviso-cliente", need: "aviso", label: "Aviso da cliente",
    description: "Se o aviso da cliente (alergias, cuidados, não autorizou uso de imagem) salta ao abrir o horário e a comanda, e o texto de quem não autorizou imagem.",
    keywords: ["aviso", "avisos", "alerta", "alergia", "cuidado", "uso de imagem", "imagem", "foto", "salta", "janela", "entendi"],
    changes: "Muda se a janela do aviso salta na Agenda e na comanda; os Avisos continuam na ficha da cliente.",
    state: (s) => (s.avisoCliente == null ? null : { text: s.avisoCliente.horario || s.avisoCliente.comanda ? `Salta ${[s.avisoCliente.horario && "no horário", s.avisoCliente.comanda && "na comanda"].filter(Boolean).join(" e ")}` : "Não salta", on: s.avisoCliente.horario || s.avisoCliente.comanda }) },
  { id: "caixa", group: "agenda", href: "/config/caixa", need: "sistema", label: "Caixa, pacotes e comissão",
    description: "Se fechar a comanda exige o caixa aberto, e os atalhos para os pacotes à venda e as regras de comissão.",
    keywords: ["caixa", "comanda", "pagamento", "comissao", "pacote", "pacotes"],
    changes: "A recepção fecha a comanda do jeito escolhido aqui.",
    state: (s) => (s.exigeCaixaAberto == null ? null : { text: s.exigeCaixaAberto ? "Exige caixa aberto" : "Não exige caixa aberto" }) },
  // Clientes
  { id: "fichas", group: "clientes", href: "/config/fichas", need: "fichas", label: "Fichas da cliente",
    description: "As perguntas da Anamnese, da Consultoria de imagem e dos Campos da ficha: o texto, o tipo de resposta, as opções e a ordem.",
    keywords: ["ficha", "fichas", "anamnese", "consultoria", "consultoria de imagem", "campos", "campos da ficha", "pergunta", "perguntas", "prontuario", "questionario"],
    changes: "Muda as perguntas que a equipe vê ao preencher a ficha; as respostas que já foram dadas continuam guardadas.",
    state: (s) => (s.fichas == null ? null : { text: n(s.fichas, "pergunta em uso", "perguntas em uso") }) },
  { id: "financeiro", group: "agenda", href: "/config/financeiro", need: "sistema", label: "Financeiro",
    description: "Liga ou desliga Contas a pagar e o Resultado, e define com quantos dias avisar o vencimento e por quantos meses uma despesa pode se repetir.",
    keywords: ["financeiro", "contas a pagar", "despesa", "despesas", "resultado", "dre", "fluxo de caixa", "vencimento", "boleto", "repetir"],
    changes: "Desligado, a vista some de Relatórios › Financeiro e novas despesas são recusadas.",
    state: (s) => (s.financeiro ? { text: `Contas a pagar: ${s.financeiro.contasAPagar ? "Ligadas" : "Desligadas"} · Resultado: ${s.financeiro.resultado ? "Ligado" : "Desligado"}`, on: s.financeiro.contasAPagar || s.financeiro.resultado } : null) },
  { id: "estoque", group: "agenda", href: "/config/estoque", need: "sistema", label: "Estoque",
    description: "Liga ou desliga Produtos e estoque e define o CFOP, o CSOSN e a unidade que um produto novo recebe.",
    keywords: ["estoque", "produto", "produtos", "cfop", "csosn", "unidade", "nota fiscal", "baixa", "inventario"],
    changes: "Desligado, o produto na comanda volta a ser texto livre, a aba Produtos some e o estoque não baixa.",
    state: (s) => (s.estoque ? { text: s.estoque.ligado ? "Ligado" : "Desligado", on: s.estoque.ligado } : null) },
  { id: "relatorios", group: "agenda", href: "/config/relatorios", need: "sistema", label: "Relatórios",
    description: "Liga ou desliga a Ocupação (mapa de calor e ocupação por profissional) em Relatórios › Salão.",
    keywords: ["relatorios", "relatorio", "ocupacao", "mapa de calor", "agenda cheia", "profissional", "salao"],
    changes: "Desligado, a vista Ocupação some de Relatórios › Salão e fica só o Resumo.",
    state: (s) => (s.relatorios ? { text: `Ocupação: ${s.relatorios.ocupacao ? "Ligada" : "Desligada"}`, on: s.relatorios.ocupacao } : null) },
  { id: "nota-fiscal", group: "agenda", href: "/config/nota-fiscal", need: "nota", label: "Nota fiscal",
    description: "Como a Casa emite nota fiscal: a chave Desligada, Teste ou Produção, os dados da Casa, os códigos dos serviços, as regras e os textos da nota.",
    keywords: ["nota fiscal", "nota", "nfse", "nfs-e", "nfce", "nfc-e", "nfse.gov.br", "cnpj", "inscricao municipal", "certificado", "ctribnac", "nbs", "simples", "parceira", "producao", "teste"],
    changes: "Desligada, a Casa emite à mão no nfse.gov.br; em Teste, emite no ambiente de teste do governo.",
    state: (s) => (s.nota ? { text: s.nota.nfse === "desligada" ? "Desligada" : s.nota.nfse === "teste" ? "Teste" : "Produção", on: s.nota.nfse !== "desligada" } : null) },
  // Trazer dados
  { id: "importar", group: "dados", href: "/config/chatguru", need: "sistema", label: "Importar conversas antigas",
    description: "Traz o histórico do ChatGuru para as fichas das clientes. Não envia nada para ninguém.",
    keywords: ["importar", "chatguru", "historico", "antigo", "trazer", "csv", "planilha"],
    changes: "O histórico aparece na ficha da cliente.", state: () => ({ text: "Não envia nada" }) },
  { id: "importar-whatsapp", group: "dados", href: "/config/importar-whatsapp", need: "sistema", label: "Trazer conversa antiga do WhatsApp",
    description: "Traz as mensagens de antes de julho pelo “Exportar conversa” do celular da Casa (.zip ou .txt). Não envia nada.",
    keywords: ["importar", "whatsapp", "exportar conversa", "historico", "antigo", "trazer", "zip", "txt", "celular", "mensagens antigas"],
    changes: "As mensagens antigas aparecem na conversa da cliente com o selo “importada”.", state: () => ({ text: "Não envia nada" }) },
  // Área de cuidado
  { id: "whatsapp", group: "cuidado", href: "/config/whatsapp", need: "sistema", danger: true, label: "Conexão do WhatsApp",
    description: "O número da Casa ligado ao sistema, o limite de envios por hora e por quanto tempo guardar as mídias.",
    keywords: ["whatsapp", "numero", "qr code", "conectar", "desconectar", "celular", "limite", "midia", "evolution"],
    changes: "Se desconectar, nenhuma mensagem entra nem sai até ler o QR code de novo.",
    state: (s) => (!s.whatsapp ? null : s.whatsapp.connected > 0 ? { text: "Conectado", on: true } : s.whatsapp.total ? { text: "Desconectado", on: false, alert: true } : { text: "Nenhum número", on: false }) },
  { id: "avec", group: "cuidado", href: "/config/avec", need: "sistema", danger: true, label: "Ligação com o Avec",
    description: "Se a agenda e o caixa da Casa ficam no Avec, nos dois ou só no CRM.",
    keywords: ["avec", "modo", "virada", "agenda dupla", "so crm", "consulta", "caixa no crm"],
    changes: "Trocar o modo muda onde a recepção marca e fecha cada horário.",
    state: (s) => (!s.agendaMode || !s.caixaMode ? null : { text: `${AGENDA_MODE[s.agendaMode]} · caixa ${s.caixaMode === "crm" ? "no CRM" : "no Avec"}` }) },
];

const allowed = (perms: readonly string[] | null | undefined, need: Need) => {
  const d = can(perms, "config.diaadia"), s = can(perms, "config.sistema"), e = can(perms, "equipe.gerir");
  if (need === "nota") return can(perms, "nota.configurar");
  if (need === "api") return can(perms, "api.gerir");
  return need === "funcoes" ? can(perms, "config.funcoes") : need === "marcadores" ? can(perms, "config.marcadores") : need === "aviso" ? can(perms, "config.aviso_cliente") : need === "fichas" ? can(perms, "config.fichas") : need === "equipe" ? e : need === "diaadia" ? d : need === "sistema" ? s : d || s || e;
};

/** Os itens que a pessoa pode abrir (o servidor confere de novo em cada página). */
export function configTabs(perms: readonly string[] | null | undefined): ConfigItem[] {
  return CONFIG_ITEMS.filter((i) => allowed(perms, i.need));
}
export function configGroups(perms: readonly string[] | null | undefined): ConfigGroup[] {
  const items = configTabs(perms);
  return CONFIG_GROUPS.filter((g) => items.some((i) => i.group === g.id));
}
/** Grupo aberto ao entrar: Mensagens automáticas (o que mais pesa para a cliente) quando a pessoa pode ver; senão, o primeiro dela. */
export function defaultConfigGroup(perms: readonly string[] | null | undefined): ConfigGroupId | null {
  const gs = configGroups(perms);
  return gs.find((g) => g.id === "mensagens")?.id ?? gs[0]?.id ?? null;
}
export const itemHref = (i: ConfigItem, perms: readonly string[] | null | undefined) => (i.alt && !can(perms, i.alt.unless) ? i.alt.href : i.href);
/** Linha de apoio do grupo na coluna da esquerda: quantas mensagens estão ligadas; na Área de cuidado, como está o WhatsApp. */
export function groupHint(g: ConfigGroup, items: ConfigItem[], s: ConfigSnapshot): ConfigState {
  if (g.id === "mensagens") {
    const st = items.filter((i) => i.group === "mensagens" && i.sends).map((i) => stateOf(i, s)).filter((x): x is ConfigState => x?.on != null);
    if (st.length) { const on = st.filter((x) => x.on).length; return { text: `${on} de ${st.length} ${on === 1 ? "ligada" : "ligadas"}`, on: on > 0 }; }
  }
  if (g.id === "cuidado") {
    const w = items.find((i) => i.id === "whatsapp");
    const st = w ? stateOf(w, s) : null;
    if (st) return { text: `WhatsApp ${st.text.toLowerCase()}`, on: st.on, alert: st.alert };
  }
  return { text: g.hint };
}
export const stateOf = (i: ConfigItem, s: ConfigSnapshot): ConfigState | null => i.state?.(s) ?? null;

export const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[“”"/]/g, " ").replace(/\s+/g, " ").trim();
/** Busca por nome, frase e sinônimos, sem acento: todas as palavras precisam aparecer. Nome primeiro, depois palavras-chave, depois a frase. */
export function searchConfig<T extends Pick<ConfigItem, "label" | "description" | "keywords">>(items: T[], q: string): T[] {
  const query = normalize(q);
  if (!query) return items;
  const words = query.split(" ");
  return items
    .map((i, idx) => {
      const name = normalize(i.label), kw = normalize(i.keywords.join(" | ")), all = `${name} | ${kw} | ${normalize(i.description)}`;
      if (!words.every((w) => all.includes(w))) return null;
      const score = name.includes(query) ? 4 : kw.includes(query) ? 3 : words.every((w) => name.includes(w)) ? 2 : 1;
      return { i, idx, score };
    })
    .filter((x): x is { i: T; idx: number; score: number } => !!x)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((x) => x.i);
}

const splitHref = (href: string) => { const [path, qs = ""] = href.split("?"); return { path, params: new URLSearchParams(qs) }; };
/** Qual item é a página aberta. Página inteira sem `parte` (endereço antigo) não é um item: mostra tudo, como antes. */
export function matchConfigItem(pathname: string, search: string): ConfigItem | null {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const i of CONFIG_ITEMS) {
    const { path, params } = splitHref(i.href);
    if (path !== pathname && !i.also?.includes(pathname)) continue;
    if (path !== pathname) return i;
    if ([...params.entries()].every(([k, v]) => sp.get(k) === v)) return i;
  }
  return null;
}
