"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ackDayAction } from "@/app/(pro)/pro/actions";
import { timeOf } from "@/lib/pro-day";
import type { DayAck } from "@/server/domain/pro/acks";

/** "Vi minha agenda de amanhã" e, se mudou depois, o aviso para ela olhar de novo. */
export function AckButton({ day, ack }: { day: string; ack: DayAck | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  if (ack && !ack.changedAfter) return <p role="status" className="text-center text-sm text-ok">Você viu a agenda de amanhã às {timeOf(Date.parse(ack.ackedAt))}.</p>;
  return (
    <div className="flex flex-col gap-1">
      {ack?.changedAfter && <p role="status" className="text-center text-sm font-medium text-alert">A agenda mudou depois que você viu.</p>}
      <Button size="lg" loading={pending} onClick={() => start(async () => { const r = await ackDayAction(day); if (r.ok) router.refresh(); else toast(r.error, "error"); })}>
        Vi minha agenda de amanhã
      </Button>
    </div>
  );
}
