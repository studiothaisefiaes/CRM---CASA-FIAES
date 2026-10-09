import { candidatesFor } from "./engine";
import type { AutomationInput } from "./types";

export async function previewCandidates(v: AutomationInput, now = new Date()) {
  let c = await candidatesFor(v.trigger, now);
  for (const cond of v.conditions) if (cond.type === "etapa_em") c = c.filter((x) => cond.stages.includes(x.stageKey));
  return { count: c.length, sample: c.slice(0, 5).map((x) => x.contactName ?? x.phone) };
}
