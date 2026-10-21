import { sinceLabel } from "./alert-copy";
import { firstName } from "./authorship";

/** "Resolvida sem resposta por Sara · 14:02" enquanto a cliente não escreve de novo; depois disso, null. */
export function resolvedLabel(d: { resolvedAt: Date | string | null; lastInboundAt: Date | string | null; resolvedByName: string | null }, nowMs: number): string | null {
  if (!d.resolvedAt) return null;
  const at = new Date(d.resolvedAt).getTime();
  if (d.lastInboundAt && new Date(d.lastInboundAt).getTime() > at) return null;
  return `Resolvida sem resposta${d.resolvedByName ? ` por ${firstName(d.resolvedByName)}` : ""} · ${sinceLabel(at, nowMs)}`;
}
