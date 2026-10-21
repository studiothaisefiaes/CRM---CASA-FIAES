/**
 * Depois do atendimento (Fase B, item 11): quando a visita é concluída, uma mensagem para a cliente N minutos depois, dentro de uma janela
 * de horas de Salvador. Parte pura (servidor, fila e tela). Nasce DESLIGADO; ligar é pela Virada (Task 10). Tudo configurável (regra do dono).
 */
import { bahiaParts, slotMs } from "./schedule";
import { shiftDay } from "./agenda";
import { CASA_AGRADECIMENTO, CASA_NOTA_ALTA, CASA_PESQUISA_TITULO } from "./casa-texts";

/** `depois_atendimento:<visita>`: um item por visita, para sempre (o que já existe, em qualquer situação, não é refeito). */
export const AFTER_VISIT_SOURCE = "depois_atendimento:";

export type AfterVisitMode = "desligado" | "agradecimento" | "pesquisa";
export type AfterVisitConfig = {
  mode: AfterVisitMode;
  /** Minutos depois da conclusão (30 a 1440). */
  delayMinutes: number;
  /** Janela de envio no relógio de Salvador: de `janelaInicio`:00 até antes de `janelaFim`:00. */
  janelaInicio: number;
  janelaFim: number;
  /** Passou disso desde a conclusão, não manda mais (1 a 72 h). */
  horasMax: number;
  textoAgradecimento: string;
  tituloPesquisa: string;
  textoNotaAlta: string;
  linkGoogle: string | null;
  /** Pesquisa de satisfação: nota a partir da qual a cliente recebe o link do Google; abaixo disso é nota baixa (padrão 4: baixa = 1 a 3). */
  notaAltaMin: 4 | 5;
  /** Aviso para a gestão na nota baixa: {nome}, {nota}, {servicos}, {profissionais}. */
  textoNotaBaixa: string;
  /** Etiqueta que a cliente recebe na nota baixa. */
  etiquetaNotaBaixa: string;
};

export const AFTER_VISIT_LIMITS = {
  delayMinutes: { min: 30, max: 1440 }, janelaInicio: { min: 0, max: 23 }, janelaFim: { min: 1, max: 24 }, horasMax: { min: 1, max: 72 },
} as const;

/** Aviso padrão da nota baixa para a gestão (Task 9). */
export const NOTA_BAIXA_AVISO = "{nome} deu nota {nota} para {servicos} com {profissionais}. Fale com ela hoje.";
export const NOTA_BAIXA_ETIQUETA = "Nota baixa";

export const AFTER_VISIT_DEFAULTS: AfterVisitConfig = {
  mode: "desligado", delayMinutes: 120, janelaInicio: 8, janelaFim: 20, horasMax: 24,
  textoAgradecimento: CASA_AGRADECIMENTO, tituloPesquisa: CASA_PESQUISA_TITULO, textoNotaAlta: CASA_NOTA_ALTA, linkGoogle: null, notaAltaMin: 4,
  textoNotaBaixa: NOTA_BAIXA_AVISO, etiquetaNotaBaixa: NOTA_BAIXA_ETIQUETA,
};

/* ---------- Pesquisa de satisfação (Task 9) ---------- */

/** Opções fixas da enquete: a nota é o número do começo. */
export const SATISFACTION_OPTIONS = ["5 · Excelente", "4 · Muito bom", "3 · Bom", "2 · Ruim", "1 · Muito ruim"] as const;
/** A nota de uma opção da enquete, ou null se a opção não é da pesquisa. */
export function scoreOf(option: string): 1 | 2 | 3 | 4 | 5 | null {
  const o = option.trim().toLowerCase();
  const i = SATISFACTION_OPTIONS.findIndex((x) => x.toLowerCase() === o);
  return i < 0 ? null : ((5 - i) as 1 | 2 | 3 | 4 | 5);
}
/** É a enquete da Pesquisa de satisfação (as mesmas opções, na mesma ordem)? */
export const isSatisfactionPoll = (values: readonly string[] | null | undefined) =>
  !!values && values.length === SATISFACTION_OPTIONS.length && values.every((v, i) => v === SATISFACTION_OPTIONS[i]);
/** `pesquisa_nota_alta:<id da mensagem da enquete>`: a mensagem da nota alta, uma vez por enquete. */
export const SATISFACTION_HIGH_SOURCE = "pesquisa_nota_alta:";
/** Uma pesquisa só por visita (regra × Depois do atendimento): o motivo de não mandar a segunda. */
export const SURVEY_ALREADY = "A cliente já recebeu a Pesquisa de satisfação desta visita.";

/** "a", "a e b", "a, b e c". */
export const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`);
export type NotaBaixaVars = { nome: string; nota: number; servicos: string[]; profissionais: string[] };
/** O aviso da nota baixa; sem serviço ou sem profissional na visita, "o atendimento" e "a equipe" (a frase nunca fica quebrada). */
export function renderNotaBaixa(tpl: string, v: NotaBaixaVars): string {
  const vars: Record<string, string> = {
    nome: v.nome, nota: String(v.nota), servicos: andList(v.servicos) || "o atendimento", profissionais: andList(v.profissionais) || "a equipe",
  };
  return tpl.replace(/\{(nome|nota|servicos|profissionais)\}/g, (_m, k: string) => vars[k]).replace(/[ \t]{2,}/g, " ").trim();
}

const minuteOf = (ms: number) => { const t = bahiaParts(ms).time; return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); };
const hourAt = (day: string, h: number) => slotMs(day, "00:00") + h * 3_600_000;

/** Dentro da janela de envio do Depois do atendimento (Salvador)? */
export const inAfterVisitWindow = (ms: number, cfg: Pick<AfterVisitConfig, "janelaInicio" | "janelaFim">) => {
  const m = minuteOf(ms);
  return m >= cfg.janelaInicio * 60 && m < cfg.janelaFim * 60;
};

/** Quando sai: `fromMs` (conclusão + atraso); antes da janela, no início dela no mesmo dia; depois, no início dela no dia seguinte. */
export function afterVisitSendAt(fromMs: number, cfg: Pick<AfterVisitConfig, "janelaInicio" | "janelaFim">): Date {
  if (inAfterVisitWindow(fromMs, cfg)) return new Date(fromMs);
  const day = bahiaParts(fromMs).date;
  return new Date(minuteOf(fromMs) < cfg.janelaInicio * 60 ? hourAt(day, cfg.janelaInicio) : hourAt(shiftDay(day, 1), cfg.janelaInicio));
}

/** Folga para a fila (o drain roda a cada minuto e tem teto por hora) entre a pior espera e o limite. */
export const AFTER_VISIT_SLACK_MIN = 60;

/**
 * A pior espera entre a conclusão e o envio, em minutos: o atraso mais a parte fechada inteira do dia (quando conclusão + atraso cai
 * bem no fim da janela, espera até o início dela no dia seguinte).
 */
export const afterVisitWorstMinutes = (c: Pick<AfterVisitConfig, "delayMinutes" | "janelaInicio" | "janelaFim">) =>
  c.delayMinutes + (24 - (c.janelaFim - c.janelaInicio)) * 60;

const horas = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; };

/**
 * Validação cruzada (fix 1 da Task 8): nenhuma combinação aceita pode cancelar toda mensagem no envio. Regra: a pior espera
 * ({@link afterVisitWorstMinutes}) + {@link AFTER_VISIT_SLACK_MIN} cabe no limite (`horasMax`). Devolve o erro para a tela, ou null.
 */
export function afterVisitTimingError(c: Pick<AfterVisitConfig, "delayMinutes" | "janelaInicio" | "janelaFim" | "horasMax">): string | null {
  if (![c.delayMinutes, c.janelaInicio, c.janelaFim, c.horasMax].every(Number.isFinite)) return null; // campo vazio: o erro é do campo
  if (c.janelaInicio >= c.janelaFim) return "A janela precisa começar antes de terminar.";
  const worst = afterVisitWorstMinutes(c);
  if (worst + AFTER_VISIT_SLACK_MIN <= c.horasMax * 60) return null;
  return `Com ${c.delayMinutes} min depois e a janela das ${c.janelaInicio}h às ${c.janelaFim}h, a mensagem pode levar até ${horas(worst)} para sair. ` +
    `Aumente o limite para pelo menos ${Math.ceil((worst + AFTER_VISIT_SLACK_MIN) / 60)} h, diminua o tempo depois ou alargue a janela.`;
}

export type AfterVisitVars = { primeiro_nome: string; link_google: string };
/** O texto com as variáveis; nome vazio não deixa "Oi, !" nem espaço duplo (como o lembrete). */
export function renderAfterVisit(tpl: string, v: AfterVisitVars): string {
  return tpl.replace(/\{(primeiro_nome|link_google)\}/g, (_m, k: keyof AfterVisitVars) => v[k])
    .replace(/,[ \t]*!/g, "!").replace(/^[ \t]*,[ \t]*/gm, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "").trim();
}
