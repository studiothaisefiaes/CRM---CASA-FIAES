import { candidatesFor, conditionsHold, getBusinessHours, tooOldForSend } from "./engine";
import { sendsMessages } from "./templates";
import { isEventTrigger, type AutomationInput } from "./types";

/**
 * `count`: leads que se encaixam. `sendCount`: quantos receberiam mensagem (os mais velhos que o teto de idade ficam de fora).
 * Gatilho por acontecimento não tem "quem se encaixa agora": vale para o que acontecer depois de ligar (zero).
 */
export async function previewCandidates(v: AutomationInput, now = new Date()) {
  if (isEventTrigger(v.trigger)) return { count: 0, sendCount: 0, sample: [] as string[] };
  let c = await candidatesFor(v.trigger, now);
  for (const cond of v.conditions) if (cond.type === "etapa_em") c = c.filter((x) => cond.stages.includes(x.stageKey));
  const others = v.conditions.filter((x) => x.type !== "etapa_em");
  if (others.length) {
    const hours = await getBusinessHours();
    const keep: typeof c = [];
    for (const x of c) if (await conditionsHold(others, x, now, hours)) keep.push(x);
    c = keep;
  }
  const sendCount = sendsMessages(v.actions) ? c.filter((x) => !tooOldForSend(v.trigger, x, now)).length : 0;
  return { count: c.length, sendCount, sample: c.slice(0, 5).map((x) => x.contactName ?? x.phone) };
}
