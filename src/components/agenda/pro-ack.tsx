import type { DayAck } from "@/server/domain/pro/acks";
import { dueLabel } from "@/lib/next-action";
import { cn } from "@/lib/cn";

/** No topo da coluna da profissional: "Viu ontem 19:02" ou "Mudou depois que ela viu". */
export function ProAckLine({ ack, nowMs }: { ack?: DayAck; nowMs: number }) {
  if (!ack) return null;
  return (
    <span className={cn("block truncate text-xs font-medium", ack.changedAfter ? "text-alert" : "text-ok")}>
      {ack.changedAfter ? "Mudou depois que ela viu" : `Viu ${dueLabel(Date.parse(ack.ackedAt), nowMs)}`}
    </span>
  );
}
