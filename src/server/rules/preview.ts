import { candidatesFor, tooOldForSend } from "./engine";
import { sendsMessages } from "./templates";
import type { AutomationInput } from "./types";

/** `count`: leads que se encaixam. `sendCount`: quantos receberiam mensagem (os mais velhos que o teto de idade ficam de fora). */
export async function previewCandidates(v: AutomationInput, now = new Date()) {
  let c = await candidatesFor(v.trigger, now);
  for (const cond of v.conditions) if (cond.type === "etapa_em") c = c.filter((x) => cond.stages.includes(x.stageKey));
  const sendCount = sendsMessages(v.actions) ? c.filter((x) => !tooOldForSend(v.trigger, x, now)).length : 0;
  return { count: c.length, sendCount, sample: c.slice(0, 5).map((x) => x.contactName ?? x.phone) };
}
