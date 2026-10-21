import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { professionals } from "../db/schema";
import { resetDb } from "../../../test/db";
import { ap, bahia, CASA_TER_SAB, cliente, NOW, setSetting, setupAgenda } from "../../../test/agenda-fixtures";
import { agendaRange } from "@/lib/agenda";
import { getAgendaWeekByPro } from "./agenda-week";

beforeEach(async () => { await resetDb(); });

it("Review Focus 3: semana que atravessa o fim do mês, com clientes, horas e folgas por profissional", async () => {
  const s = await setupAgenda();
  await setSetting("business_hours", CASA_TER_SAB);
  await db.insert(professionals).values({ name: "CARLA" }); // sem horário próprio: segue a Casa (ter–sáb); MAIÚSCULAS como vem do Avec, a tela mostra "Carla"
  const p = await cliente("Paula Souza"), q = await cliente("Joana Lima");
  await ap({ startsAt: bahia(31, 10), contactId: p.contactId, professionalId: s.ana.id });
  await ap({ startsAt: bahia(31, 11), contactId: q.contactId, professionalId: s.ana.id, serviceId: s.hidratacao.id, serviceLabel: "Hidratação", durationMin: null });
  await ap({ startsAt: new Date(Date.UTC(2026, 10, 1, 12)), contactId: p.contactId, professionalId: s.ana.id }); // 01/11, 09:00 em Salvador
  const crm = await ap({ startsAt: bahia(30, 10), contactId: p.contactId, professionalId: s.ana.id, status: "cancelado" });
  await ap({ startsAt: bahia(30, 10), contactId: p.contactId, professionalId: s.ana.id, avecTwinOf: crm.id });
  const rows = await getAgendaWeekByPro(agendaRange({ d: "2026-10-29", v: "semana" }, NOW));
  expect(rows.map((r) => r.name)).toEqual(["Ana", "Bia", "Carla"]);
  const ana = rows[0];
  expect(ana.cells.map((c) => c.day)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  expect(ana.cells.find((c) => c.day === "2026-10-31")).toEqual({ day: "2026-10-31", clients: 2, minutes: 105, off: false });
  expect(ana.cells.find((c) => c.day === "2026-11-01")).toMatchObject({ clients: 1, minutes: 60 });
  expect(ana.cells.find((c) => c.day === "2026-10-30")).toMatchObject({ clients: 0, minutes: 0 });
  expect(rows[2].cells.filter((c) => c.off).map((c) => c.day)).toEqual(["2026-10-26", "2026-11-01"]);
});
