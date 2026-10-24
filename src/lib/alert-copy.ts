/**
 * Os textos que explicam os avisos, num lugar só: seções e linhas da Fila, cabeçalho e painel da conversa, sino e Hoje.
 * A página "O que cada aviso quer dizer" (/ajuda/avisos) é montada destas mesmas constantes e funções: mudar uma frase aqui
 * muda a tela e a ajuda juntas. Puro (servidor e navegador), sempre no relógio de Salvador.
 */
import { dueLabel } from "./next-action";
import { isHiddenNumber } from "./phone-client";
import { firstName } from "./authorship";
import type { QueueSectionKey } from "./queue";
import { SIGNAL_LABEL, SIGNAL_ORDER, type Signal } from "../server/domain/signals";

export const HELP_HREF = "/ajuda/avisos";

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (ms: number) => Math.floor((ms - OFFSET_MS) / DAY_MS);
const hhmm = (ms: number) => { const d = new Date(ms - OFFSET_MS); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const minutesText = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${pad(min % 60)}`);
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type HelpEntry = { id: string; title: string; text: string; example?: string };
export type HelpGroup = { id: string; title: string; entries: HelpEntry[] };

/* ---------- Quem e quando ---------- */
/** "Catarina Souza" → "Catarina": o mesmo `firstName` do Lote 1A (src/lib/authorship.ts), reexportado para quem já importa daqui. */
export { firstName };

/** A cliente num aviso: o nome; sem nome, "cliente com final 1234"; número oculto, "cliente sem nome". Nunca o +55 cru. */
export function clientLabel(name: string | null | undefined, phone: string): string {
  const n = name?.trim();
  if (n) return n;
  if (isHiddenNumber(phone)) return "cliente sem nome";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `cliente com final ${digits.slice(-4)}` : "cliente sem nome";
}

/** "14:02" no mesmo dia; outro dia, sempre com o dia: "ontem 19:40", "sex 10/10 19:40". */
export const sinceLabel = (ms: number, now: number): string => (dayOf(ms) === dayOf(now) ? hhmm(ms) : dueLabel(ms, now));
/** Combinado: "venceu ontem 13:00" ou "vence hoje 15:00" (sempre com o dia). */
export const dueText = (dueMs: number, now: number): string => `${dueMs < now ? "venceu" : "vence"} ${dueLabel(dueMs, now)}`;
export const stoppedText = (days: number): string => `parado há ${days} ${days === 1 ? "dia" : "dias"}`;

/* ---------- Prazo ---------- */
/** O único texto de prazo da linha (Fila, Hoje). Dentro: "Responda em 3 min". Passou: "Passou 4 min do prazo". Sem prazo na etapa: null. */
export function slaText(waitSeconds: number, slaMinutes: number | null): string | null {
  if (!slaMinutes || slaMinutes <= 0) return null;
  const left = slaMinutes * 60 - waitSeconds;
  if (left <= 0) {
    const over = Math.floor(-left / 60);
    return over >= 1 ? `Passou ${minutesText(over)} do prazo` : "O prazo acabou";
  }
  return left < 60 ? "Responda em menos de 1 min" : `Responda em ${Math.ceil(left / 60)} min`;
}
export const WAIT_CLOCK_PREFIX = "Esperando há ";
export const waitClockSuffix = (slaMinutes: number | null): string => (slaMinutes ? ` (prazo ${slaMinutes})` : "");
/** Relógio do cabeçalho da conversa: "Esperando há 12 min (prazo 15)". */
export const waitClockText = (waited: string, slaMinutes: number | null): string => `${WAIT_CLOCK_PREFIX}${waited}${waitClockSuffix(slaMinutes)}`;
export const WAIT_CLOCK_HELP = "Quanto tempo a cliente espera resposta, contando só o horário da Casa. Entre parênteses, o prazo da etapa em minutos.";

/* ---------- Seções da Fila ---------- */
export const SECTION_TITLE: Record<QueueSectionKey, string> = {
  atrasados: "Atrasados", perto: "Quase no prazo", aguardando: "Esperando a Casa responder", "acoes-hoje": "Combinados para hoje e atrasados",
  parados: "Parados", "aguardando-cliente": "Aguardando a cliente", reengajar: "Hora de voltar", arquivadas: "Resolvidas",
};
/** As saídas de uma conversa parada (frase da spec): o botão "Marcar como aguardando cliente" entrou no Lote 1C. */
export const PARADOS_ACTIONS = "Agendar, Aguardar cliente ou Resolver";
/** A frase fixa abaixo do título. `n`: minutos que faltam (Quase no prazo) ou dias parados (Parados), o menor da seção. */
export function sectionHelp(key: QueueSectionKey, n?: number | null): string {
  switch (key) {
    case "atrasados": return "A cliente escreveu e ninguém respondeu no prazo. Responda primeiro.";
    case "perto": return n != null ? `Responda em até ${Math.max(1, n)} min.` : "Responda antes que o prazo acabe.";
    case "aguardando": return "A cliente escreveu; ainda está no prazo.";
    case "acoes-hoje": return "O que a equipe combinou de fazer hoje e o que já venceu.";
    case "parados": return `${n != null ? `Há ${n} ${n === 1 ? "dia" : "dias"} ou mais` : "Há dias"} sem ninguém decidir o próximo passo. Marque ${PARADOS_ACTIONS}.`;
    case "aguardando-cliente": return "A Casa respondeu; agora é com ela.";
    case "reengajar": return "Sem conversa há mais de 90 dias. Vale mandar um oi.";
    case "arquivadas": return "Voltam sozinhas se a cliente escrever.";
  }
}
/** O lado direito do cabeçalho da seção, numa linha: "5 · no prazo". A frase inteira (`sectionHelp`) fica no "?" da seção. */
export function sectionShort(key: QueueSectionKey, count: number, n?: number | null): string {
  const short: Record<QueueSectionKey, string> = {
    atrasados: "responda primeiro", perto: n != null ? `até ${Math.max(1, n)} min` : "quase acabando", aguardando: "no prazo", "acoes-hoje": "hoje",
    parados: n != null ? `há ${n}+ ${n === 1 ? "dia" : "dias"}` : "sem próximo passo", "aguardando-cliente": "com ela", reengajar: "+90 dias", arquivadas: "voltam sozinhas",
  };
  return `${count} · ${short[key]}`;
}
/** Hora da última mensagem na linha da Fila: hoje "09:31", ontem "ontem", antes "13/10" (relógio de Salvador). */
export function lastMessageTime(ms: number, now: number): string {
  const diff = dayOf(now) - dayOf(ms);
  if (diff <= 0) return hhmm(ms);
  if (diff === 1) return "ontem";
  const d = new Date(ms - OFFSET_MS);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}
export const ATTENDANCE_TITLE = "Ela veio?";
export const ATTENDANCE_HELP = "Já passou do horário. Toque em Veio ou Faltou.";
export const SUMMARY_HELP = "O topo da Fila: as abas Todas, Não lidas (mensagem da cliente que ninguém abriu) e Resolvidas. Minhas, Esperando, Sem dono, Atrasados, Combinados, etapa, dona e etiqueta ficam no botão Filtros; o que estiver ligado aparece embaixo da busca, com ✕ para tirar.";
export const ARCHIVED_ROW = "resolvida · volta se a cliente escrever";

/* ---------- Dona, transferência, quem respondeu ---------- */
export const NO_OWNER = "Sem dono";
export const NO_OWNER_HINT = "Ninguém assumiu. Toque em Assumir se for você.";
export function ownerHint(ownerName: string | null, mine: boolean): string {
  if (!ownerName) return NO_OWNER_HINT;
  if (mine) return "Você está cuidando desta conversa.";
  return `${firstName(ownerName)} está cuidando. Assumir tira dela.`;
}
/** "Fulana te passou esta conversa" (para quem recebeu) ou "Fulana passou para Sara" (para quem olha de fora). */
export function transferText(byName: string, toName: string | null, viewerIsNewOwner: boolean): string {
  return viewerIsNewOwner ? `${firstName(byName)} te passou esta conversa` : `${firstName(byName)} passou para ${firstName(toName) ?? "outra pessoa"}`;
}
/** A Casa respondeu e a bola está com a cliente: quem, quando (`at` já com o dia) e por onde. */
export function answeredText(o: { by: string | null; fromPhone: boolean; at: string }): string {
  if (!o.by && !o.fromPhone) return `A mensagem automática saiu ${o.at}; agora é a vez da cliente.`;
  return `${o.by ? firstName(o.by) : "A Casa"} respondeu ${o.at}${o.fromPhone ? " pelo celular" : ""}; agora é a vez da cliente.`;
}

/* ---------- Chips da linha ---------- */
export const CHIP_HELP: Record<string, string> = {
  [NO_OWNER]: NO_OWNER_HINT,
  Novo: "Primeira conversa: chegou hoje.",
  "Agendado hoje": "Tem horário marcado para hoje.",
  "Agendado amanhã": "Tem horário marcado para amanhã.",
  "Convite de retorno": "Recebeu o convite de retorno (mensagem em massa). Se responder, a conversa fica Aberto; sem resposta em 14 dias, volta a ficar Resolvido.",
};
export const SIGNAL_HELP: Record<Signal, string> = {
  reclamacao: "Ela reclamou de algo. Responda com cuidado; a conversa sobe dentro da seção.",
  urgente: "Ela pediu urgência. A conversa sobe dentro da seção.",
  sumiu_apos_preco: "A Casa mandou o valor e ela não respondeu há mais de 1 dia.",
  remarcar_cancelar: "Ela quer remarcar ou cancelar o horário.",
  pediu_preco: "Ela perguntou o valor e a Casa ainda não mandou. Some quando a Casa mandar um valor.",
  pediu_horario: "Ela perguntou por horário e a Casa ainda não ofereceu. Some quando a Casa mandar um horário.",
  evento: "Fala de noiva, casamento, formatura ou festa.",
  pediu_desconto: "Ela perguntou por desconto ou promoção.",
  indicacao: "Veio por indicação de alguém.",
};
export const INTEREST_HELP = "Ela citou um serviço cadastrado (Configurações › Listas).";
export const KEYWORD_HELP = "Palavra-chave cadastrada pela gestão (Configurações › Listas).";
export const TAG_HELP = "Etiqueta que a equipe colocou na cliente. Fica separada dos sinais automáticos.";
const SIGNAL_BY_LABEL = new Map(SIGNAL_ORDER.map((s) => [SIGNAL_LABEL[s], s] as const));
/** A dica (title) de um chip da linha da Fila. */
export function chipHelp(label: string): string {
  if (CHIP_HELP[label]) return CHIP_HELP[label];
  const s = SIGNAL_BY_LABEL.get(label);
  if (s) return SIGNAL_HELP[s];
  return label.startsWith("Interesse: ") ? INTEREST_HELP : KEYWORD_HELP;
}

/* ---------- Cores ---------- */
export const COLOR_HELP: HelpEntry[] = [
  { id: "cor-vermelho", title: "Vermelho", text: "Existe um alerta aberto: a cliente passou do prazo sem resposta. Só fica vermelho quando o alerta existe." },
  { id: "cor-dourado", title: "Dourado", text: "Atenção: a espera passou de 60% do prazo, ou o prazo acabou e o alerta nasce no próximo minuto." },
  { id: "cor-cinza", title: "Cinza", text: "Dentro do prazo." },
  { id: "cor-anel", title: "Anel em volta da foto", text: "Quanto do prazo da etapa já passou. Cores iguais na Fila, no Quadro, na Jornada e no cabeçalho da conversa." },
];

/* ---------- Alertas ---------- */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** O título do combinado sem repetir a cliente: "Retomar contato com Joana Lima" → "retomar contato". */
export function taskTitleFor(title: string, contactName: string | null): string {
  let t = title.trim();
  const full = contactName?.trim();
  for (const n of [full, firstName(full)].filter((x): x is string => !!x)) t = t.replace(new RegExp(`\\s+(com|para|de|da|do)\\s+${escapeRe(n)}\\s*$`, "i"), "");
  t = t.replace(/\s+(com|para)\s+(a cliente|o cliente|\+?\d[\d\s().-]{7,})\s*$/i, "").replace(/\s+[—-]\s+.*$/, "").trim();
  return t ? t[0].toLocaleLowerCase("pt-BR") + t.slice(1) : "combinado";
}
const ownerPart = (ownerName: string | null) => (ownerName ? `Dona: ${firstName(ownerName)}.` : "Sem dono.");
export const alertText = {
  wait: (o: { client: string; sinceMs: number; slaMinutes: number | null; ownerName: string | null; now: number }) =>
    `${o.client} espera resposta desde ${sinceLabel(o.sinceMs, o.now)}${o.slaMinutes ? ` (prazo ${o.slaMinutes} min)` : ""}. ${ownerPart(o.ownerName)}`,
  escalated: (o: { client: string; sinceMs: number; ownerName: string | null; now: number }) =>
    `Escalado: ${o.client} sem resposta desde ${sinceLabel(o.sinceMs, o.now)}. ${ownerPart(o.ownerName)}`,
  taskDue: (o: { title: string; contactName: string | null; client: string; overdue: boolean }) =>
    `${o.overdue ? "Combinado vencido" : "Combinado vencendo"}: ${taskTitleFor(o.title, o.contactName)} (${o.client}).`,
  offer: (client: string) => `A dona não respondeu. Pode assumir ${client}?`,
  claimed: (actor: string | null, client: string) => `${firstName(actor) ?? "Alguém"} assumiu a conversa de ${client}`,
  transferred: (actor: string | null, client: string) => `${firstName(actor) ?? "Alguém"} te passou a conversa de ${client}`,
  /** Lote 1A: outra pessoa respondeu a conversa da dona (a dona não muda). */
  repliedByOther: (actor: string | null, client: string) => `${firstName(actor) ?? "Outra pessoa"} respondeu a conversa de ${client}. Ela continua sua; se for para passar, use Transferir.`,
  birthday: (client: string, day: number, month: number) => `Aniversário de ${client} dia ${pad(day)}/${pad(month)}. Que tal mandar um parabéns?`,
  autoSendFailed: (client: string, why?: string) => `Mensagem automática para ${client} não saiu${why ? ` (${why})` : ""}. Abra a conversa e envie manualmente.`,
  /** Lote 5: alguém chamou a pessoa com @ numa nota interna. */
  mention: (actor: string | null, client: string, excerpt: string) => `${firstName(actor) ?? "Alguém"} te marcou numa nota sobre ${client}: “${excerpt}”`,
  /** Lote 5: mensagem agendada que não saiu (a autora decide se envia). */
  scheduledFailed: (client: string, why: string) => `Mensagem agendada para ${client} não saiu: ${why}. Abra a conversa e decida se envia.`,
  /** Lote 5: ligação atendida que ninguém anotou ainda (lembrete leve). */
  /** Lote 5: a mensagem em massa terminou (para quem confirmou). */
  campaignDone: (name: string, sent: number, failed: number) =>
    `Mensagem em massa “${name}” terminou: ${sent} enviada${sent === 1 ? "" : "s"}${failed ? `, ${failed} não ${failed === 1 ? "saiu" : "saíram"}` : ""}.`,
  callNote: (client: string, duration: string | null) => `Anote a ligação de ${client}${duration ? ` (${duration})` : ""}: o que foi falado?`,
  /** Toda mensagem da cliente, em qualquer etapa (some ao abrir a conversa ou responder). */
  clientMessage: (client: string, preview: string) => `${client} escreveu: “${preview}”`,
};

/* ---------- Sino ---------- */
export type AlertGroup = "espera" | "combinados" | "agenda" | "conversas" | "lembretes" | "sistema" | "outros";
export const ALERT_GROUP_ORDER: AlertGroup[] = ["espera", "combinados", "agenda", "conversas", "lembretes", "sistema", "outros"];
export const ALERT_GROUP_TITLE: Record<AlertGroup, string> = {
  espera: "Esperando resposta", combinados: "Combinados", agenda: "Agenda", conversas: "Quem está com a conversa", lembretes: "Lembretes das clientes", sistema: "WhatsApp e envios", outros: "Outros",
};
const GROUP_OF: Record<string, AlertGroup> = {
  sem_resposta_minutos: "espera", mensagem_cliente: "espera", tarefa_vencendo: "combinados", tarefa_vencida: "combinados",
  folga_pedida: "agenda", link_remarcar: "agenda", link_cancelou: "agenda", pedido_online: "agenda",
  oferta: "conversas", assumiu_sua_conversa: "conversas", transferido_para_voce: "conversas", respondida_por_outra: "conversas", mencao: "conversas", ligacao_sem_nota: "conversas", nota_baixa: "conversas",
  aniversario_em_dias: "lembretes", parado_dias: "lembretes", sem_retorno_cliente_dias: "lembretes", data_recontato: "lembretes", data_cobranca: "lembretes", agendamento_em_horas: "lembretes",
  whatsapp_desconectado: "sistema", whatsapp_sem_conexao: "sistema", envio_automatico_falhou: "sistema", agendada_falhou: "sistema", massa_concluida: "sistema", massa_pausada: "sistema", webhook_falhou: "sistema", mensagem_sem_numero: "sistema", historico_falhou: "sistema", automacao_falhou: "sistema",
};
export const ALERT_TYPES = Object.keys(GROUP_OF);
export const alertGroupOf = (type: string): AlertGroup => GROUP_OF[type] ?? "outros";
export const BELL_LEGEND = [{ tone: "alert", text: "Urgente" }, { tone: "gold", text: "Para saber" }, { tone: "ok", text: "Resolvido" }] as const;

const EX_NOW = Date.UTC(2026, 9, 15, 17, 30); // exemplos da ajuda: 14:30 em Salvador
const EX_SINCE = Date.UTC(2026, 9, 15, 17, 2); // 14:02
export const ALERT_HELP: (HelpEntry & { types: string[] })[] = [
  { id: "alerta-espera", types: ["sem_resposta_minutos"], title: "Espera passou do prazo",
    text: "A cliente escreveu e ninguém respondeu no prazo da etapa. Vai para a dona; sem dona, para a gestão. Some sozinho quando alguém responde.",
    example: alertText.wait({ client: "Fulana", sinceMs: EX_SINCE, slaMinutes: 15, ownerName: "Sara", now: EX_NOW }) },
  { id: "alerta-mensagem", types: ["mensagem_cliente"], title: "A cliente escreveu",
    text: "Chegou mensagem de uma cliente, em qualquer etapa (inclusive Agendado, Na Casa, Atendida e conversa resolvida). Um aviso por conversa: mensagens seguidas renovam o mesmo. Vai para a dona; sem dona, para a gestão. Some quando alguém abre a conversa ou responde.",
    example: alertText.clientMessage("Fulana", "Oi, posso chegar 15 min mais tarde?") },
  { id: "alerta-escalado", types: [], title: "Escalado para a gestão",
    text: "A espera continuou sem resposta e o mesmo aviso subiu para a gestão. A gestão decide se responde ou transfere.",
    example: alertText.escalated({ client: "Fulana", sinceMs: EX_SINCE, ownerName: "Sara", now: EX_NOW }) },
  { id: "alerta-combinado", types: ["tarefa_vencendo", "tarefa_vencida"], title: "Combinado vencendo ou vencido",
    text: "Um combinado está para vencer (ou venceu). Nunca chega com a Casa fechada e não toca som. Um aviso por conversa: o combinado seguinte avisa quando este for concluído. Aberto há 1 dia de expediente, fica vermelho; há 2 dias, aparece também para a gestão. Some quando o combinado é concluído.",
    example: alertText.taskDue({ title: "Retomar contato", contactName: "Fulana", client: "Fulana", overdue: false }) },
  { id: "alerta-folga", types: ["folga_pedida"], title: "Pedido de folga",
    text: "Uma profissional pediu folga ou bloqueio pelo app. Aprove ou recuse na Agenda, em Pedidos. Antes de aprovar, a lista mostra quem está marcada no período; nada é remarcado sozinho.",
    example: "Maiara pediu folga em 20/10 (dia todo). Aprove ou recuse na Agenda." },
  { id: "alerta-link-remarcar", types: ["link_remarcar"], title: "Pediu para remarcar pelo link",
    text: "A cliente tocou em 'Preciso remarcar' na página do horário. É urgente: toca o som e vai para a dona da conversa e para a gestão, com o horário e o melhor horário que ela escreveu. O horário continua marcado: chame a cliente e remarque. O toque abre a conversa; sem conversa aberta, abre a ficha.",
    example: "Rita pediu para remarcar pelo link (sexta, 16/10 às 15:00). Ela não tem conversa aberta: abra a ficha." },
  { id: "alerta-link-cancelou", types: ["link_cancelou"], title: "Cancelou pelo link",
    text: "A cliente cancelou o horário na página do link, com o motivo. O horário ficou livre na Agenda: dá para oferecer a quem está na lista de espera. O toque abre o horário cancelado.",
    example: "Rita cancelou pelo link o horário de sexta, 16/10 às 15:00. Motivo: Imprevisto. O horário ficou livre." },
  { id: "alerta-pedido-site", types: ["pedido_online"], title: "Pedido pelo site",
    text: "Alguém pediu um horário pelo agendamento online. O horário fica guardado até a Casa responder. Confirme ou recuse na Agenda, em Pedidos do site; sem resposta até o início, ele é cancelado sozinho.",
    example: "Paula pediu Corte feminino em sexta, 16/10 às 10:00 pelo site. Confirme ou recuse na Agenda." },
  { id: "alerta-oferta", types: ["oferta"], title: "Pode assumir?",
    text: "A dona não respondeu no prazo e a distribuição oferece a conversa para você. Toque em Assumir para ficar com ela.", example: alertText.offer("Fulana") },
  { id: "alerta-setor-sem-ninguem", types: ["setor_sem_ninguem"], title: "Ninguém livre no setor",
    text: "Uma conversa foi passada para um setor e ninguém dele estava Disponível. Ela fica sem dona, marcada no setor. O texto se edita em Configurações › Recursos › Setores.",
    example: "Ninguém livre no setor Método Fiaes® para atender Fulana." },
  { id: "alerta-assumiu", types: ["assumiu_sua_conversa"], title: "Assumiu a sua conversa",
    text: "Outra pessoa ficou com uma conversa que era sua.", example: alertText.claimed("Cati", "Fulana") },
  { id: "alerta-passou", types: ["transferido_para_voce"], title: "Te passou a conversa",
    text: "Alguém transferiu uma conversa para você. Ela é sua agora.", example: alertText.transferred("Cati", "Fulana") },
  { id: "alerta-respondida", types: ["respondida_por_outra"], title: "Outra pessoa respondeu a sua conversa",
    text: "Alguém da equipe respondeu uma conversa que é sua (pelo CRM ou, pela assinatura, pelo celular). A conversa continua sua; se for para passar, use Transferir. Vem no máximo um aviso por dia para cada conversa.",
    example: alertText.repliedByOther("Cati", "Fulana") },
  { id: "alerta-mencao", types: ["mencao"], title: "Te marcaram numa nota",
    text: "Alguém da equipe escreveu uma nota interna na conversa e te chamou com @. A cliente não vê a nota. Abra a conversa para ler o recado.",
    example: alertText.mention("Sara", "Fulana", "pode conferir o sinal do Pix?") },
  { id: "alerta-ligacao", types: ["ligacao_sem_nota"], title: "Anote a ligação",
    text: "Uma ligação do WhatsApp foi atendida e ninguém anotou o que foi falado. Na conversa, toque em Anotar o que foi falado na linha da ligação. Vai para a dona da conversa (sem dona, para a gestão) e some quando a anotação é salva.",
    example: alertText.callNote("Fulana", "3 min") },
  { id: "alerta-nota-baixa", types: ["nota_baixa"], title: "Nota baixa na Pesquisa de satisfação",
    text: "A cliente deu nota baixa na Pesquisa de satisfação depois do atendimento. Ela não recebe nada automático: fale com ela. A cliente ganha a etiqueta Nota baixa. Se ela mudar o voto para uma nota alta, o aviso se resolve sozinho. O texto, a nota alta mínima e a etiqueta se editam em Configurações › Depois do atendimento.",
    example: "Maria deu nota 2 para Escova com Gilvan. Fale com ela hoje." },
  { id: "alerta-aniversario", types: ["aniversario_em_dias"], title: "Aniversário chegando",
    text: "Uma cliente faz aniversário em breve. Não existe mensagem pronta: escreva o parabéns do seu jeito.", example: alertText.birthday("Fulana", 17, 10) },
  { id: "alerta-lembretes", types: ["parado_dias", "sem_retorno_cliente_dias", "data_recontato", "data_cobranca", "agendamento_em_horas"], title: "Lembretes das automações",
    text: "Avisos configurados em Configurações › Automações: conversa parada, cliente sem retorno, dia de recontato ou de cobrança. Um aviso por conversa e por regra, sem som. A conversa parada que ganhou próximo passo, mudou de etapa ou foi resolvida sai sozinha; a que continua parada fica vermelha em 1 dia de expediente e aparece para a gestão em 2." },
  { id: "alerta-whatsapp", types: ["whatsapp_desconectado", "whatsapp_sem_conexao"], title: "WhatsApp caiu",
    text: "Mensagens novas não estão chegando. Leia o QR code de novo em Configurações › WhatsApp." },
  { id: "alerta-envio", types: ["envio_automatico_falhou"], title: "Mensagem automática não saiu",
    text: "Uma mensagem automática não foi entregue. Abra a conversa e envie manualmente.", example: alertText.autoSendFailed("Fulana", "WhatsApp desconectado") },
  { id: "alerta-agendada", types: ["agendada_falhou"], title: "Mensagem agendada não saiu",
    text: "Uma mensagem agendada não foi enviada: a cliente escreveu antes, quem agendou saiu da equipe, ela perdeu a hora (mais de 2 h de atraso) ou o WhatsApp recusou. Nunca sai sozinha depois disso: abra a conversa e decida.",
    example: alertText.scheduledFailed("Fulana", "a cliente escreveu depois que você agendou") },
  { id: "alerta-massa", types: ["massa_concluida", "massa_pausada"], title: "Mensagem em massa",
    text: "A mensagem em massa terminou (com quantas saíram) ou parou sozinha porque nenhum WhatsApp está conectado. Para continuar, conecte o número e toque em Retomar em Configurações › Mensagem em massa.",
    example: alertText.campaignDone("Retorno de outubro", 85, 2) },
  { id: "alerta-registro", types: ["webhook_falhou", "mensagem_sem_numero"], title: "Mensagem que não entrou no CRM",
    text: "Uma mensagem do WhatsApp não pôde ser registrada. Avise quem cuida do sistema." },
  { id: "alerta-automacao", types: ["automacao_falhou"], title: "Automação que não está rodando",
    text: "Uma automação deu erro e foi pulada (as outras continuam). Confira a configuração dela em Configurações › Automações; se estiver certa, avise quem cuida do sistema. O aviso volta uma vez por dia enquanto o erro continuar." },
  { id: "alerta-historico", types: ["historico_falhou"], title: "Histórico do WhatsApp que não entrou",
    text: "Um lote de conversas antigas, que o WhatsApp manda ao conectar o número, não pôde ser importado. As mensagens novas continuam chegando. Avise quem cuida do sistema." },
];

/* ---------- A página "O que cada aviso quer dizer" ---------- */
const COLOR_WORD = { alert: "Vermelha", gold: "Dourada", ok: "Verde" } as const;
export function helpCatalog(): HelpGroup[] {
  return [
    { id: "fila", title: "A Fila: ordem e prazo", entries: [
      ...(Object.keys(SECTION_TITLE) as QueueSectionKey[]).map((k) => ({ id: `fila-${k}`, title: SECTION_TITLE[k], text: sectionHelp(k) })),
      { id: "fila-ela-veio", title: ATTENDANCE_TITLE, text: ATTENDANCE_HELP },
      { id: "fila-resumo", title: "Abas e filtros", text: SUMMARY_HELP },
    ] },
    { id: "linha", title: "Na linha de cada conversa", entries: [
      { id: "linha-prazo", title: "Prazo", text: "Um texto só: quanto falta para o prazo da etapa ou quanto já passou.", example: `${slaText(4 * 60, 15)} · ${slaText(19 * 60, 15)}` },
      { id: "linha-sem-dono", title: NO_OWNER, text: NO_OWNER_HINT },
      { id: "linha-quem-respondeu", title: "Cati: … e Dona: Sara · respondida por Cati", text: "Antes da última mensagem aparece quem da Casa escreveu (pela pessoa logada no CRM ou pela assinatura do celular). Quando quem respondeu não é a dona, a linha diz as duas." },
      { id: "linha-passou", title: "Fulana te passou esta conversa", text: "Outra pessoa transferiu a conversa e a nova dona ainda não respondeu. Some depois da primeira resposta." },
      { id: "linha-parado", title: "parado há N dias", text: "Ninguém decidiu o próximo passo desde que a conversa entrou nesta etapa." },
      { id: "linha-tentativa", title: "Tentativa 1/3", text: "A Casa está retomando uma cliente que não respondeu: até 3 tentativas (amanhã, em 3 e em 7 dias; depois de um orçamento, em 2, 4 e 8 dias), cada uma em Combinados no dia. Conta quando alguém da Casa escreve no dia ou conclui o combinado. Depois da 3ª, se ela não responder em 2 dias, a conversa vai para Perdido (Não respondeu mais). Nada é enviado sozinho." },
      { id: "linha-pacote", title: "Pacote 3/10", text: "A cliente tem um pacote ativo no Avec: sessões usadas do total. O pacote não é etapa da conversa." },
      ...Object.keys(CHIP_HELP).filter((k) => k !== NO_OWNER).map((k) => ({ id: `chip-${slug(k)}`, title: k, text: CHIP_HELP[k] })),
      ...SIGNAL_ORDER.map((s) => ({ id: `sinal-${s}`, title: SIGNAL_LABEL[s], text: SIGNAL_HELP[s] })),
      { id: "linha-interesse", title: "Interesse: serviço", text: INTEREST_HELP },
      { id: "linha-palavra-chave", title: "Palavra-chave", text: KEYWORD_HELP },
      { id: "linha-etiqueta", title: "Etiqueta (com borda)", text: TAG_HELP },
      { id: "linha-limite", title: "No máximo 2 sinais", text: "Cada linha mostra no máximo 2 sinais automáticos, os mais importantes primeiro." },
    ] },
    { id: "cores", title: "Cores e anel", entries: COLOR_HELP },
    { id: "conversa", title: "Na conversa", entries: [
      { id: "conversa-relogio", title: "Esperando há…", text: WAIT_CLOCK_HELP, example: waitClockText("12 min", 15) },
      { id: "conversa-por-que", title: "Por que está esperando", text: "Diz quem falou por último, quando (sempre com o dia) e por onde.", example: answeredText({ by: "Cati", fromPhone: true, at: "ontem 13:15" }) },
      { id: "conversa-responsavel", title: "Responsável", text: "Quem está cuidando da conversa. Assumir tira a conversa dela.", example: ownerHint("Sara", false) },
      { id: "conversa-compareceu", title: "Ela veio?", text: "Só aparece depois do horário marcado. Antes disso não dá para saber se ela veio." },
      { id: "conversa-status", title: "Status: Aberto, Aguardando, Resolvido", text: "Ao lado da etapa. Aberto: a cliente espera a Casa (fica vermelho se passou do prazo). Aguardando: a Casa respondeu e agora é a vez da cliente. Resolvido: a conversa terminou e sai da lista; volta sozinha para Aberto se a cliente escrever. Muda sozinho, mas dá para trocar à mão." },
    ] },
    { id: "sino", title: "Sino", entries: [
      { id: "sino-cores", title: "Bolinhas", text: BELL_LEGEND.map((l) => `${COLOR_WORD[l.tone]}: ${l.text.toLowerCase()}`).join(" · ") },
      { id: "sino-filtros", title: "Para mim e Para a gestão", text: "Para mim: avisos no seu nome. Para a gestão: avisos sem dona e escalados (só para quem recebe escaladas)." },
      { id: "sino-resolver", title: "Resolver", text: "Tira o aviso do sino quando você já cuidou. A espera não tem Resolver: some sozinha quando alguém responde." },
      ...ALERT_HELP.map(({ types: _types, ...e }) => e),
    ] },
    { id: "hoje", title: "Tela Hoje", entries: [
      { id: "hoje-equipe-agora", title: "Equipe agora", text: "Quem está respondendo (pelo CRM ou, pela assinatura, pelo celular), quantas conversas esperam cada uma e quantas estão sem dono." },
      { id: "hoje-sem-responsavel", title: "Sem responsável", text: "Combinados que não são de ninguém. Toda tarefa nova já vai para a dona da conversa ou, sem dona, para quem respondeu por último; esta aba mostra o que sobrou." },
      { id: "hoje-aniversarios", title: "Aniversários da semana", text: "Todas as clientes que fazem aniversário nos próximos 7 dias, com ou sem conversa aberta." },
    ] },
  ];
}
