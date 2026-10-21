import { requirePerm } from "@/server/auth/session";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { settings, users } from "@/server/db/schema";
import { getBusinessHours } from "@/server/domain/hours";
import { getAutoReply } from "@/server/domain/messaging-settings";
import { getAutoMessage } from "@/server/domain/auto-message-settings";
import { summarizeHours } from "@/lib/hours-summary";
import { AutoReplyEditor } from "@/components/config/messages";
import { AutoMessageEditor } from "@/components/config/auto-messages";

export const metadata = { title: "Mensagens automáticas" };

/** Cada mensagem é um item de Configurações › Mensagens automáticas (`?parte=`); sem `parte` (endereço antigo), mostra as quatro. */
const PARTES = ["fora-do-horario", "boas-vindas", "ausencia", "encerramento"] as const;

export default async function MensagensPage({ searchParams }: PageProps<"/config/mensagens">) {
  await requirePerm("config.sistema");
  const p = (await searchParams).parte;
  const parte = PARTES.find((x) => x === p);
  const show = (x: (typeof PARTES)[number]) => !parte || parte === x;
  const [reply, hours, savedHours, welcome, away, closing, [{ n: disponiveis }]] = await Promise.all([
    getAutoReply(), getBusinessHours(), db.select({ key: settings.key }).from(settings).where(eq(settings.key, "business_hours")),
    getAutoMessage("boas_vindas"), getAutoMessage("ausencia"), getAutoMessage("encerramento"),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.active, true), eq(users.availability, "disponivel"))),
  ]);
  return (
    <div className={parte ? "flex flex-col gap-6" : "grid items-start gap-6 min-[1100px]:grid-cols-2"}>
      {show("fora-do-horario") && <AutoReplyEditor initial={reply} hoursSummary={summarizeHours(hours)} hoursSaved={savedHours.length > 0} />}
      {show("boas-vindas") && <AutoMessageEditor kind="boas_vindas" initial={welcome} />}
      {show("ausencia") && <AutoMessageEditor kind="ausencia" initial={away}
        note={`Agora: ${disponiveis} ${disponiveis === 1 ? "pessoa Disponível" : "pessoas Disponíveis"} no CRM. Com ninguém Disponível, toda cliente que escrever com a Casa aberta recebe este texto (uma vez a cada 12 h).`} />}
      {show("encerramento") && <AutoMessageEditor kind="encerramento" initial={closing} />}
    </div>
  );
}
